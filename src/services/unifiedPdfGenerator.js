// src/services/unifiedPdfGenerator.js
const puppeteer = require('puppeteer');
const db = require('../config/database');
const fs = require('fs').promises;
const path = require('path');
const { Storage } = require('@google-cloud/storage');

class UnifiedPDFGenerator {
  constructor() {
    this.browser = null;
    
    // Initialize Google Cloud Storage
    if (process.env.NODE_ENV === 'production' || process.env.USE_CLOUD_STORAGE === 'true') {
      try {
        // I Cloud Run, bruk Application Default Credentials
        if (process.env.K_SERVICE) {
          // Cloud Run miljø - bruk default credentials
          this.storage = new Storage({
            projectId: process.env.GCP_PROJECT_ID || 'servfix'
          });
          console.log('✅ Using Google Cloud default credentials (Cloud Run)');
        } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
          // Lokal miljø med credentials i environment variable
          const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS);
          this.storage = new Storage({
            projectId: process.env.GCP_PROJECT_ID || 'servfix',
            credentials: credentials
          });
          console.log('✅ Using Google Cloud credentials from env variable');
        } else {
          // Prøv å laste fra fil (kun for lokal utvikling)
          try {
            const credentials = require('../config/serviceAccountKey.json');
            this.storage = new Storage({
              projectId: process.env.GCP_PROJECT_ID || 'servfix',
              credentials: credentials
            });
            console.log('✅ Using Google Cloud credentials from file');
          } catch (fileError) {
            console.warn('⚠️ No credentials file found, using default credentials');
            this.storage = new Storage({
              projectId: process.env.GCP_PROJECT_ID || 'servfix'
            });
          }
        }
        
        this.bucket = this.storage.bucket(process.env.GCS_BUCKET_NAME || 'servfix-files');
        console.log('✅ Google Cloud Storage initialized for bucket:', process.env.GCS_BUCKET_NAME || 'servfix-files');
      } catch (error) {
        console.error('⚠️ Could not initialize Google Cloud Storage:', error.message);
        this.storage = null;
        this.bucket = null;
      }
    }
  }

  async init() {
    try {
      const options = {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--no-first-run',
          '--no-zygote',
          '--single-process'
        ]
      };

      // I Cloud Run, bruk alltid /usr/bin/chromium
      if (process.env.K_SERVICE) {
        options.executablePath = '/usr/bin/chromium';
        console.log('🚀 Using Cloud Run Chromium path: /usr/bin/chromium');
      } else if (process.env.PUPPETEER_EXECUTABLE_PATH) {
        options.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
        console.log('🚀 Using custom Chromium path:', process.env.PUPPETEER_EXECUTABLE_PATH);
      }

      console.log('🚀 Launching Puppeteer...');
      this.browser = await puppeteer.launch(options);
      console.log('✅ Puppeteer launched successfully');
      
    } catch (error) {
      console.error('❌ Failed to launch Puppeteer:', error.message);
      
      // Prøv en gang til med default innstillinger
      try {
        console.log('🔄 Retrying with default Puppeteer settings...');
        this.browser = await puppeteer.launch({
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        console.log('✅ Puppeteer launched with fallback settings');
      } catch (fallbackError) {
        console.error('❌ Puppeteer launch failed completely:', fallbackError.message);
        throw new Error(`Cannot launch browser: ${fallbackError.message}`);
      }
    }
  }

  async generateReport(serviceReportId, tenantId) {
    console.log(`📄 Starting PDF generation for report ${serviceReportId}`);
    
    try {
      await this.init();
      const reportData = await this.fetchReportData(serviceReportId, tenantId);
      console.log('✅ Report data fetched');
      
      const companySettings = await this.loadCompanySettings(tenantId);
      console.log('✅ Company settings loaded');
      
      const html = await this.generateHTML(reportData, companySettings);
      console.log('✅ HTML generated');
      
      const pdfBuffer = await this.generatePDF(html);
      console.log('✅ PDF buffer created');
      
      const pdfPath = await this.savePDF(pdfBuffer, reportData, tenantId);
      console.log('✅ PDF saved:', pdfPath);
      
      await this.updateReportPDFPath(serviceReportId, pdfPath, tenantId);
      console.log('✅ Database updated with PDF path');
      
      return pdfPath;
      
    } catch (error) {
      console.error('❌ PDF generation failed:', error);
      throw error;
    } finally {
      await this.close();
    }
  }

  async fetchReportData(serviceReportId, tenantId) {
    const pool = await db.getTenantConnection(tenantId);
    
    // SQL med KUN kolonner som FAKTISK eksisterer (fra fungerende versjon)
    const query = `
      SELECT 
        -- Fra service_reports
        sr.id,
        sr.order_id,
        sr.equipment_id,
        sr.checklist_data,
        sr.products_used,
        sr.additional_work,
        sr.status,
        sr.signature_data,
        sr.photos,
        sr.created_at,
        sr.completed_at,
        sr.pdf_path,
        sr.pdf_generated,
        
        -- Fra orders
        o.id as order_number,
        o.customer_name as company_name,
        o.description as order_description,
        o.scheduled_date as service_date,
        o.customer_data,
        
        -- Fra customer_data JSON
        o.customer_data->>'email' as company_email,
        o.customer_data->>'phone' as company_phone,
        o.customer_data->>'address' as company_address,
        
        -- Fra equipment - KUN eksisterende kolonner!
        e.name as equipment_name,
        e.type as equipment_type,
        e.location as equipment_location,
        e.serial_number as equipment_serial,
        e.data as equipment_data,
        
        -- Fra technicians - KUN eksisterende kolonner!
        t.name as technician_name,
        t.initials as technician_initials
        
      FROM service_reports sr
      LEFT JOIN orders o ON sr.order_id = o.id
      LEFT JOIN equipment e ON sr.equipment_id = e.id
      LEFT JOIN technicians t ON o.technician_id = t.id
      WHERE sr.id = $1
    `;
    
    console.log('🔍 Fetching report data for:', serviceReportId);
    const result = await pool.query(query, [serviceReportId]);
    
    if (result.rows.length === 0) {
      throw new Error('Service report not found');
    }
    
    const data = result.rows[0];
    
    // Parse JSON fields
    try {
      data.checklist_data = typeof data.checklist_data === 'string' ? 
        JSON.parse(data.checklist_data) : data.checklist_data;
    } catch (e) {
      data.checklist_data = {};
    }
    
    // Parse equipment data JSON
    try {
      data.equipment_data = typeof data.equipment_data === 'string' ? 
        JSON.parse(data.equipment_data) : data.equipment_data || {};
    } catch (e) {
      data.equipment_data = {};
    }
    
    // Parse customer_data for contact person
    try {
      const customerData = typeof data.customer_data === 'string' ? 
        JSON.parse(data.customer_data) : data.customer_data;
      data.contact_person = customerData?.contact_person || '';
    } catch (e) {
      data.contact_person = '';
    }
    
    // Hent systemNumber fra equipment.data JSON
    const systemNumber = data.equipment_data?.systemNumber || 
                        data.equipment_data?.system_number || 
                        data.equipment_serial || 
                        '-';
    
    // Lag en enkel equipment liste med kun current equipment
    data.all_equipment = [{
      id: data.equipment_id,
      type: data.equipment_type,
      location: data.equipment_location,
      name: data.equipment_name,
      system_number: systemNumber,
      report_id: data.id
    }];
    
    // Hent checklist template for å få riktige labels
    let checklistTemplate = null;
    try {
      const templateResult = await pool.query(
        'SELECT * FROM checklist_templates WHERE equipment_type = $1',
        [data.equipment_type]
      );
      if (templateResult.rows.length > 0) {
        checklistTemplate = templateResult.rows[0].template_data;
      }
    } catch (e) {
      console.error('Could not fetch checklist template:', e);
    }
    
    // Berik komponentene med template info
    if (data.checklist_data && data.checklist_data.components) {
      data.checklist_data.components = data.checklist_data.components.map(component => {
        // Hvis vi har template, berik med checkpoints
        if (checklistTemplate && checklistTemplate.checklistItems && component.checklist) {
          component.checkpoints = checklistTemplate.checklistItems.map(item => {
            const value = component.checklist[item.id];
            let status = 'na';
            let comment = '';
            
            if (value) {
              if (typeof value === 'object') {
                status = value.status || 'na';
                comment = value.comment || value.avvikComment || value.byttetComment || '';
              } else {
                // Håndter enkle verdier
                status = value;
              }
            }
            
            return {
              id: item.id,
              name: item.label,
              status: status,
              comment: comment,
              inputType: item.inputType
            };
          });
        }
        
        // Sett component name fra details
        if (!component.name && component.details) {
          const detailValues = Object.values(component.details).filter(v => v);
          component.name = detailValues.join(' - ') || 'Sjekkliste';
        }
        
        return component;
      });
    }
    
    // Hent avvik bilder
    try {
      const avvikImagesResult = await pool.query(
        `SELECT avvik_number, image_url, checklist_item_id 
         FROM avvik_images 
         WHERE service_report_id = $1 
         ORDER BY avvik_number`,
        [serviceReportId]
      );
      data.avvikImages = avvikImagesResult.rows;
    } catch (e) {
      console.error('Could not fetch avvik images:', e);
      data.avvikImages = [];
    }
    
    // Ekstraher avvik med bilder
    data.avvik = [];
    let avvikCounter = 1;
    
    if (data.checklist_data && data.checklist_data.components) {
      data.checklist_data.components.forEach(component => {
        if (component.checkpoints) {
          component.checkpoints.forEach(checkpoint => {
            if (checkpoint.status === 'avvik' && checkpoint.comment) {
              const avvikId = String(avvikCounter).padStart(3, '0');
              
              // Finn bilder for dette avviket
              const avvikBilder = data.avvikImages.filter(img => 
                img.checklist_item_id === checkpoint.id
              );
              
              data.avvik.push({
                id: avvikId,
                systemnummer: systemNumber,
                component: component.name,
                checkpoint: checkpoint.name,
                description: checkpoint.comment,
                images: avvikBilder.map(img => img.image_url)
              });
              avvikCounter++;
            }
          });
        }
      });
    }
    
    // Sett overall comment fra checklist_data
    data.overall_comment = data.checklist_data?.overallComment || '';
    
    // Photos er allerede en ARRAY i databasen
    data.photos = data.photos || [];
    
    return data;
  }

  async loadCompanySettings(tenantId) {
    const settings = {
      company: {
        name: 'Air-Tech AS',
        address: 'Stanseveien 18, 0975 Oslo',
        phone: '+47 91 52 40 40',
        email: 'post@air-tech.no',
        orgNr: '889 558 652'
      },
      logoBase64: null
    };
    
    if (!this.bucket) {
      console.log('⚠️ No bucket available, using default settings');
      return settings;
    }
    
    try {
      // Hent settings.json
      const settingsFile = this.bucket.file(`tenants/${tenantId}/settings.json`);
      const [exists] = await settingsFile.exists();
      
      if (exists) {
        const [content] = await settingsFile.download();
        const savedSettings = JSON.parse(content.toString());
        
        // Settings structure: settings.companyInfo and settings.logo
        if (savedSettings.companyInfo) {
          settings.company = {
            name: savedSettings.companyInfo.name || settings.company.name,
            address: savedSettings.companyInfo.address || settings.company.address,
            phone: savedSettings.companyInfo.phone || settings.company.phone,
            email: savedSettings.companyInfo.email || settings.company.email,
            orgNr: savedSettings.companyInfo.cvr || settings.company.orgNr
          };
        }
        
        console.log('✅ Company settings loaded from GCS');
        
        // Logo ligger direkte i settings.logo.url
        if (savedSettings.logo?.url) {
          settings.logoBase64 = await this.downloadLogoFromUrl(savedSettings.logo.url);
        }
      }
      
    } catch (error) {
      console.error('Error loading company settings:', error);
    }
    
    return settings;
  }

  async downloadLogoFromUrl(logoUrl) {
    if (!logoUrl) return null;
    
    try {
      // Hvis det er en GCS URL, last ned via bucket
      if (logoUrl.includes('storage.googleapis.com') && this.bucket) {
        // Ekstraher file path fra URL
        const matches = logoUrl.match(/\/([^\/]+)\/(.+)$/);
        if (matches && matches[2]) {
          const filePath = matches[2];
          const file = this.bucket.file(filePath);
          const [exists] = await file.exists();
          
          if (exists) {
            const [buffer] = await file.download();
            const mimeType = filePath.endsWith('.png') ? 'image/png' : 'image/jpeg';
            return `data:${mimeType};base64,${buffer.toString('base64')}`;
          }
        }
      }
      
      // Fallback: prøv å laste ned direkte
      console.log('Attempting direct logo download from:', logoUrl);
      return logoUrl; // Returner URL direkte hvis vi ikke kan konvertere
      
    } catch (error) {
      console.error('Error downloading logo:', error);
      return null;
    }
  }

  async generateHTML(data, settings) {
    // Lagre data for avvik mapping
    this.currentReportData = data;
    
    const css = this.getCSS();
    const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Servicerapport ${data.order_number || data.id}</title>
    <style>${css}</style>
</head>
<body>
    <div class="page-container">
        ${this.generateHeader(data, settings)}
        ${this.generateOrderInfo(data)}
        ${this.generateSystemOversikt(data)}
        ${data.avvik.length > 0 ? this.generateAvvik(data) : ''}
        ${this.generateSjekklister(data)}
        ${this.generateOppsummering(data)}
        ${this.generatePhotos(data)}
        ${this.generateFooter(data, settings)}
    </div>
</body>
</html>`;
    
    return html;
  }

  generateHeader(data, settings) {
    const company = settings.company || {};
    const logoHtml = settings.logoBase64 
      ? `<img src="${settings.logoBase64}" alt="${company.name}" class="logo">`
      : '';
    
    const reportDate = new Date(data.service_date || data.created_at).toLocaleDateString('no-NO');
    const visitNumber = data.checklist_data?.visitNumber || '1';
    const year = new Date().getFullYear();
    
    return `
      <div class="header">
        <div class="company-box">
          ${logoHtml}
          <div class="company-info">
            <div class="company-name">${company.name}</div>
            <div>${company.address || ''}</div>
            <div>www.air-tech.no</div>
            <div>Telefon: ${company.phone || ''}</div>
            <div>Epost: ${company.email || ''}</div>
            <div>Org.nr.: ${company.orgNr || ''}</div>
          </div>
        </div>
        <div class="report-header">
          <h1>Servicerapport: ${data.company_name || '[Kundenavn]'}</h1>
          <table class="header-table">
            <tr>
              <td><strong>Avtalenummer:</strong></td>
              <td>[Avtalenr.]</td>
              <td><strong>Besøk nr:</strong></td>
              <td>${visitNumber}</td>
              <td><strong>Årstall:</strong></td>
              <td>${year}</td>
            </tr>
          </table>
        </div>
      </div>
    `;
  }

  generateOrderInfo(data) {
    const reportDate = new Date(data.service_date || data.created_at).toLocaleDateString('no-NO');
    
    return `
      <div class="section info-section">
        <table class="info-table">
          <tr>
            <td class="label">Kundenummer</td>
            <td class="value">${data.order_number || '[Kundenummer]'}</td>
            <td class="label">Kundenavn</td>
            <td class="value">${data.company_name || '[Kundenavn]'}</td>
            <td class="label">Mottaker av rapport</td>
            <td class="value">${data.contact_person || '[Mottaker]'}</td>
          </tr>
          <tr>
            <td class="label">Byggnavn</td>
            <td class="value">${data.company_name || '[Byggnavn]'}</td>
            <td class="label">Adresse</td>
            <td class="value">${data.company_address || '[Adresse]'}</td>
            <td class="label">Post nr.</td>
            <td class="value">[Postnr]</td>
            <td class="label">Poststed</td>
            <td class="value">[Poststed]</td>
          </tr>
          <tr>
            <td class="label">Rapport dato:</td>
            <td class="value">${reportDate}</td>
            <td class="label">Utført av:</td>
            <td class="value">${data.technician_name || '[Vår tekn.]'}</td>
            <td class="label">Vår kontaktperson</td>
            <td class="value">[Vår ref.]</td>
          </tr>
        </table>
        
        <div class="info-text">
          <p><em>Servicearbeidet som ble avtalt for de angitte anleggene er nå fullført i tråd med avtalen.</em></p>
          <p><em>I henhold til vår serviceavtale oversender vi en servicerapport etter fullført servicebesøk.</em></p>
        </div>
      </div>
    `;
  }

  generateSystemOversikt(data) {
    return `
      <div class="section">
        <h2 class="section-header">Anlegg- og systemoversikt</h2>
        <table class="system-table">
          <thead>
            <tr>
              <th>Systemtype</th>
              <th>Systemnummer</th>
              <th>Plassering</th>
              <th>Betjener</th>
            </tr>
          </thead>
          <tbody>
            ${data.all_equipment.map(eq => {
              return `
                <tr class="${eq.report_id ? 'has-report' : 'no-report'}">
                  <td>${eq.type || '-'}</td>
                  <td>${eq.system_number || '-'}</td>
                  <td>${eq.location || '-'}</td>
                  <td>-</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
        <p class="footnote">Anlegg som ikke har blitt rapportert med avvik, er vurdert som funksjonelt og teknisk i orden</p>
      </div>
    `;
  }

  generateAvvik(data) {
    if (!data.avvik || data.avvik.length === 0) {
      return '';
    }
    
    return `
      <div class="section avvik-section">
        <h2 class="section-header avvik-header">Registrerte avvik - Tekst</h2>
        ${data.avvik.map(avvik => `
          <div class="avvik-item-container">
            <table class="avvik-table">
              <thead>
                <tr>
                  <th style="width: 10%">Avvik ID</th>
                  <th style="width: 15%">Systemnummer</th>
                  <th style="width: 20%">Komponent</th>
                  <th style="width: 55%">Kommentar</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td class="avvik-id">${avvik.id}</td>
                  <td>${avvik.systemnummer || '-'}</td>
                  <td>${avvik.component || '-'}</td>
                  <td>${avvik.description || '-'}</td>
                </tr>
              </tbody>
            </table>
            ${avvik.images && avvik.images.length > 0 ? `
              <div class="avvik-images">
                <p class="avvik-images-label">Bilder for avvik ${avvik.id}:</p>
                <div class="avvik-images-grid">
                  ${avvik.images.map((img, index) => `
                    <div class="avvik-image-container">
                      <img src="${img}" alt="Avvik ${avvik.id} - Bilde ${index + 1}" class="avvik-image">
                    </div>
                  `).join('')}
                </div>
              </div>
            ` : ''}
          </div>
        `).join('')}
      </div>
    `;
  }

  generateSjekklister(data) {
    if (!data.checklist_data || !data.checklist_data.components || data.checklist_data.components.length === 0) {
      return '';
    }
    
    // Identifiser type basert på equipment_type
    const equipmentType = data.equipment_type?.toLowerCase() || '';
    let checklistTitle = 'Sjekkliste';
    
    if (equipmentType.includes('boligventilasjon')) {
      checklistTitle = 'Sjekkliste Boligventilasjon';
    } else if (equipmentType.includes('vifte')) {
      checklistTitle = 'Sjekkliste Ventilasjonsvifter';
    } else if (equipmentType.includes('ventilasjon')) {
      checklistTitle = 'Sjekkliste Ventilasjon';
    }
    
    return `
      <div class="section checklist-section page-break-before">
        <h2 class="section-header">${checklistTitle}</h2>
        ${data.checklist_data.components.map(component => this.generateComponentChecklist(component)).join('')}
      </div>
    `;
  }

  generateComponentChecklist(component) {
    // Håndter både checkpoints array og checklist objekt
    let checklistItems = [];
    
    if (component.checkpoints && Array.isArray(component.checkpoints)) {
      // Hvis vi har checkpoints array (beriket med template data)
      checklistItems = component.checkpoints;
    } else if (component.checklist) {
      // Fallback: konverter checklist objekt til array
      checklistItems = Object.entries(component.checklist).map(([key, value]) => ({
        id: key,
        name: value.label || key,
        status: value.status || 'na',
        comment: value.comment || value.avvikComment || '',
        inputType: value.inputType || 'ok_avvik'
      }));
    }
    
    if (checklistItems.length === 0) {
      return `
        <div class="component-checklist">
          <h3 class="component-name">${component.name || 'Sjekkliste'}</h3>
          <p style="font-style: italic; color: #666;">Ingen sjekkpunkter registrert</p>
        </div>
      `;
    }
    
    return `
      <div class="component-checklist">
        <h3 class="component-name">${component.name || 'Sjekkliste'}</h3>
        <table class="checklist-table">
          <thead>
            <tr>
              <th style="width: 60%">Beskrivelse</th>
              <th style="width: 15%">OK</th>
              <th style="width: 15%">Avvik</th>
              <th style="width: 10%">Avvik ID</th>
            </tr>
          </thead>
          <tbody>
            ${checklistItems.map(item => {
              const isOk = item.status === 'ok';
              const isAvvik = item.status === 'avvik';
              const isByttet = item.status === 'byttet';
              
              // For byttet status, vis som OK med kommentar
              const showAsOk = isOk || isByttet;
              
              return `
                <tr>
                  <td>${item.name || 'Ukjent sjekkpunkt'}</td>
                  <td class="center">${showAsOk ? '☑' : '☐'}</td>
                  <td class="center">${isAvvik ? '☑' : '☐'}</td>
                  <td class="center">${isAvvik ? this.getAvvikId(item) : '-'}</td>
                </tr>
                ${item.comment && item.status !== 'avvik' ? `
                  <tr class="comment-row">
                    <td colspan="4" style="font-size: 8pt; font-style: italic; padding-left: 20px;">
                      ${isByttet ? 'Byttet: ' : ''}${item.comment}
                    </td>
                  </tr>
                ` : ''}
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  }
  
  getAvvikId(item) {
    // Finn avvik ID basert på item
    if (!this.avvikMap) {
      this.avvikMap = {};
      let counter = 1;
      this.currentReportData?.avvik?.forEach(avvik => {
        this.avvikMap[`${avvik.component}_${avvik.checkpoint}`] = String(counter).padStart(3, '0');
        counter++;
      });
    }
    
    const key = `${item.componentName || ''}_${item.name}`;
    return this.avvikMap[key] || '-';
  }

  async generateHTML(data, settings) {
    // Lagre data for avvik mapping
    this.currentReportData = data;
    
    const css = this.getCSS();
    const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Servicerapport ${data.order_number || data.id}</title>
    <style>${css}</style>
</head>
<body>
    <div class="page-container">
        ${this.generateHeader(data, settings)}
        ${this.generateOrderInfo(data)}
        ${this.generateSystemOversikt(data)}
        ${data.avvik.length > 0 ? this.generateAvvik(data) : ''}
        ${this.generateSjekklister(data)}
        ${this.generateOppsummeringOgBilder(data)}
        ${this.generateFooter(data, settings)}
    </div>
</body>
</html>`;
    
    return html;
  }

  generateOppsummeringOgBilder(data) {
    const overallComment = data.overall_comment || data.checklist_data?.overallComment || '';
    const hasComment = overallComment && overallComment.trim() !== '';
    const hasPhotos = data.photos && data.photos.length > 0;
    
    if (!hasComment && !hasPhotos) {
      return '';
    }
    
    return `
      <div class="section oppsummering-bilder-section">
        <h2 class="section-header">Oppsummering og kommentarer</h2>
        <div class="oppsummering-content">
          ${hasComment ? `
            <div class="comment-box">
              <p class="footnote">Eventuelle avvik er kommentert i ovennevnte tabell. Eventuelle bilder vises nedenfor.</p>
              <p class="comment-label">Øvrige kommentarer:</p>
              <div class="comment-content">
                ${overallComment}
              </div>
            </div>
          ` : ''}
          
          ${hasPhotos ? `
            <div class="dokumentasjon-section">
              <h3 class="subsection-header">Dokumentasjon</h3>
              <div class="photos-grid">
                ${data.photos.map((photo, index) => `
                  <div class="photo-container">
                    <img src="${photo}" alt="Bilde ${index + 1}" class="photo">
                    <p class="photo-caption">Bilde ${index + 1}</p>
                  </div>
                `).join('')}
              </div>
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }

  generateFooter(data, settings) {
    const company = settings.company || {};
    const technician = data.technician_name || '[Navn ansatt]';
    const generatedDate = new Date().toLocaleDateString('no-NO');
    const location = '[Sted]';
    
    return `
      <div class="footer-section">
        <div class="signature-section">
          <p>Med vennlig hilsen</p>
          <p class="company-name">${company.name}</p>
          
          <div class="signature-grid">
            <div class="signature-box">
              <div class="signature-line"></div>
              <p>${technician}</p>
              <p>[Stilling ansatt]</p>
            </div>
            <div class="signature-box">
              <div class="signature-line"></div>
              <p>${location}</p>
              <p></p>
            </div>
            <div class="signature-box">
              <div class="signature-line"></div>
              <p>${generatedDate}</p>
              <p></p>
            </div>
          </div>
        </div>
        
        <div class="footer-info">
          <div class="footer-company">
            <p><strong>${company.name}</strong></p>
            <p>${company.address || ''}</p>
            <p>www.air-tech.no</p>
          </div>
          <div class="footer-contact">
            <p>Telefon: ${company.phone || ''}</p>
            <p>Epost: ${company.email || ''}</p>
            <p>Org.nr.: ${company.orgNr || ''}</p>
          </div>
          <div class="footer-page">
            <p>Side <span class="page"></span> av <span class="pages"></span></p>
          </div>
        </div>
      </div>
    `;
  }

  getCSS() {
    return `
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
      
      :root {
        --air-tech-blue: #0066cc;
        --air-tech-dark-blue: #004499;
        --air-tech-light-blue: #e6f2ff;
        --avvik-red: #dc3545;
        --success-green: #28a745;
        --border-gray: #dee2e6;
        --text-gray: #495057;
        --light-gray: #f8f9fa;
      }
      
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }
      
      body {
        font-family: 'Inter', Arial, sans-serif;
        font-size: 9pt;
        line-height: 1.4;
        color: #000;
        background: #ffffff;
      }
      
      .page-container {
        width: 210mm;
        min-height: 297mm;
        margin: 0 auto;
        padding: 15mm 15mm;
      }
      
      /* Header */
      .header {
        display: flex;
        justify-content: space-between;
        margin-bottom: 20px;
        gap: 20px;
      }
      
      .company-box {
        flex: 0 0 40%;
        border: 1px solid var(--border-gray);
        border-radius: 8px;
        padding: 15px;
        background: var(--light-gray);
        box-shadow: 0 2px 4px rgba(0,0,0,0.05);
      }
      
      .logo {
        max-width: 140px;
        max-height: 60px;
        margin-bottom: 10px;
        display: block;
      }
      
      .company-info {
        font-size: 8pt;
        line-height: 1.4;
        color: #333;
      }
      
      .company-name {
        font-weight: 600;
        font-size: 10pt;
        margin-bottom: 5px;
        color: var(--air-tech-dark-blue);
      }
      
      .report-header {
        flex: 1;
        text-align: center;
        display: flex;
        flex-direction: column;
        justify-content: center;
      }
      
      .report-header h1 {
        font-size: 16pt;
        color: var(--air-tech-blue);
        margin-bottom: 10px;
        font-weight: 700;
      }
      
      .header-table {
        width: 100%;
        font-size: 8pt;
        margin-top: 10px;
        border-collapse: collapse;
      }
      
      .header-table td {
        padding: 3px 8px;
        text-align: left;
        border: 1px solid var(--border-gray);
      }
      
      .header-table td:nth-child(odd) {
        font-weight: 600;
        background: var(--light-gray);
        width: 30%;
      }
      
      /* Info Section */
      .info-section {
        margin-bottom: 20px;
      }
      
      .info-table {
        width: 100%;
        font-size: 8pt;
        border-collapse: collapse;
        margin-bottom: 10px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      }
      
      .info-table td {
        padding: 5px 8px;
        border: 1px solid var(--border-gray);
      }
      
      .info-table .label {
        font-weight: 600;
        background: var(--light-gray);
        width: 12%;
      }
      
      .info-table .value {
        width: 21%;
      }
      
      .info-text {
        margin-top: 10px;
        font-style: italic;
        font-size: 8pt;
        color: var(--text-gray);
        text-align: center;
        padding: 10px;
        background: var(--air-tech-light-blue);
        border-radius: 5px;
      }
      
      /* Sections */
      .section {
        margin-bottom: 25px;
      }
      
      .section-header {
        font-size: 11pt;
        font-weight: 600;
        color: var(--air-tech-blue);
        background: var(--air-tech-light-blue);
        padding: 8px 12px;
        margin-bottom: 10px;
        border-radius: 5px;
        border-left: 4px solid var(--air-tech-blue);
      }
      
      .avvik-header {
        background: #fee;
        color: var(--avvik-red);
        border-left-color: var(--avvik-red);
      }
      
      /* Tables */
      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 8pt;
      }
      
      th {
        background: var(--light-gray);
        font-weight: 600;
        text-align: left;
        padding: 6px 8px;
        border: 1px solid var(--border-gray);
        font-size: 8pt;
      }
      
      td {
        padding: 5px 8px;
        border: 1px solid var(--border-gray);
        vertical-align: top;
      }
      
      .center {
        text-align: center;
      }
      
      /* System table */
      .system-table {
        font-size: 8pt;
        box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      }
      
      .footnote {
        font-size: 7pt;
        font-style: italic;
        color: var(--text-gray);
        margin-top: 5px;
      }
      
      /* Avvik */
      .avvik-section {
        page-break-inside: avoid;
        margin-bottom: 25px;
      }
      
      .avvik-item-container {
        margin-bottom: 20px;
        border: 1px solid var(--border-gray);
        border-radius: 5px;
        overflow: hidden;
        box-shadow: 0 2px 4px rgba(0,0,0,0.05);
      }
      
      .avvik-table {
        margin-bottom: 0;
        box-shadow: none;
      }
      
      .avvik-table td {
        font-size: 8pt;
      }
      
      .avvik-id {
        font-weight: 700;
        color: var(--avvik-red);
        text-align: center;
        font-size: 10pt;
      }
      
      .avvik-images {
        background: #fafafa;
        padding: 10px;
        border-top: 1px solid var(--border-gray);
      }
      
      .avvik-images-label {
        font-weight: 600;
        font-size: 8pt;
        margin-bottom: 8px;
        color: var(--text-gray);
      }
      
      .avvik-images-grid {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      
      .avvik-image-container {
        width: 80px;
        height: 80px;
      }
      
      .avvik-image {
        width: 100%;
        height: 100%;
        object-fit: cover;
        border: 1px solid var(--border-gray);
        border-radius: 4px;
      }
      
      /* Checklist */
      .checklist-section {
        page-break-inside: avoid;
      }
      
      .component-checklist {
        margin-bottom: 20px;
        page-break-inside: avoid;
      }
      
      .component-name {
        font-size: 9pt;
        font-weight: 600;
        color: var(--air-tech-dark-blue);
        margin-bottom: 8px;
        padding: 6px 10px;
        background: var(--light-gray);
        border-left: 3px solid var(--air-tech-blue);
        border-radius: 0 5px 5px 0;
      }
      
      .checklist-table {
        margin-bottom: 10px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      }
      
      .checklist-table td {
        font-size: 8pt;
      }
      
      .comment-row td {
        background: #fafafa;
        border-top: none;
        font-size: 7pt;
        color: var(--text-gray);
      }
      
      /* Oppsummering og bilder */
      .oppsummering-bilder-section {
        background: var(--light-gray);
        padding: 20px;
        border-radius: 8px;
        page-break-inside: avoid;
        margin-top: 30px;
      }
      
      .oppsummering-content {
        background: white;
        padding: 15px;
        border-radius: 5px;
      }
      
      .comment-box {
        margin-bottom: 20px;
      }
      
      .comment-label {
        font-weight: 600;
        margin-bottom: 8px;
        font-size: 9pt;
        color: var(--air-tech-dark-blue);
      }
      
      .comment-content {
        min-height: 40px;
        white-space: pre-wrap;
        font-size: 8pt;
        padding: 10px;
        background: var(--light-gray);
        border-radius: 5px;
      }
      
      .subsection-header {
        font-size: 10pt;
        font-weight: 600;
        color: var(--air-tech-dark-blue);
        margin: 20px 0 10px 0;
        padding-bottom: 5px;
        border-bottom: 1px solid var(--border-gray);
      }
      
      /* Photos */
      .dokumentasjon-section {
        margin-top: 20px;
      }
      
      .photos-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 10px;
        margin-top: 10px;
      }
      
      .photo-container {
        text-align: center;
        page-break-inside: avoid;
      }
      
      .photo {
        width: 100%;
        height: 100px;
        object-fit: cover;
        border: 1px solid var(--border-gray);
        border-radius: 5px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      }
      
      .photo-caption {
        font-size: 7pt;
        color: var(--text-gray);
        margin-top: 3px;
      }
      
      /* Footer */
      .footer-section {
        margin-top: 40px;
        padding-top: 20px;
        border-top: 2px solid var(--air-tech-blue);
      }
      
      .signature-section {
        margin-bottom: 20px;
      }
      
      .company-name {
        font-weight: 600;
        margin: 8px 0;
      }
      
      .signature-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 20px;
        margin-top: 30px;
      }
      
      .signature-box {
        text-align: center;
      }
      
      .signature-line {
        border-bottom: 1px solid #333;
        margin-bottom: 5px;
        height: 30px;
      }
      
      .footer-info {
        display: flex;
        justify-content: space-between;
        align-items: flex-end;
        margin-top: 20px;
        padding: 15px;
        background: var(--light-gray);
        border-radius: 5px;
        font-size: 7pt;
      }
      
      .footer-company p,
      .footer-contact p {
        margin: 1px 0;
        font-size: 7pt;
      }
      
      /* Page breaks */
      .page-break-before {
        page-break-before: always;
      }
      
      .page-break-avoid {
        page-break-inside: avoid;
      }
      
      /* Print styles */
      @media print {
        body {
          margin: 0;
          padding: 0;
        }
        
        .page-container {
          width: 100%;
          margin: 0;
          padding: 15mm;
        }
      }
    `;
  }

  async generatePDF(html) {
    const page = await this.browser.newPage();
    
    await page.setContent(html, {
      waitUntil: 'networkidle0'
    });
    
    const pdfBuffer = await page.pdf({
      format: 'A4',
      margin: {
        top: '15mm',
        right: '10mm',
        bottom: '15mm',
        left: '10mm'
      },
      printBackground: true,
      displayHeaderFooter: false
    });
    
    await page.close();
    return pdfBuffer;
  }

  async savePDF(pdfBuffer, data, tenantId) {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const timestamp = Date.now();
    
    const filename = `${data.order_number}_${data.equipment_id}_${timestamp}.pdf`;
    const relativePath = `reports/${year}/${month}/${filename}`;
    
    // Cloud Storage
    if (this.bucket) {
      try {
        const file = this.bucket.file(`tenants/${tenantId}/${relativePath}`);
        await file.save(pdfBuffer, {
          metadata: {
            contentType: 'application/pdf'
          }
        });
        console.log('✅ PDF uploaded to GCS');
        return relativePath;
      } catch (error) {
        console.error('Failed to upload to GCS:', error);
      }
    }
    
    // Local fallback
    const localDir = path.join(__dirname, '../../servfix-files/tenants', tenantId, 'reports', year, month);
    await fs.mkdir(localDir, { recursive: true });
    
    const localPath = path.join(localDir, filename);
    await fs.writeFile(localPath, pdfBuffer);
    
    console.log('✅ PDF saved locally');
    return relativePath;
  }

  async updateReportPDFPath(serviceReportId, pdfPath, tenantId) {
    const pool = await db.getTenantConnection(tenantId);
    
    // Bruk de FAKTISKE kolonnene som eksisterer i tabellen
    await pool.query(
      'UPDATE service_reports SET pdf_path = $1, pdf_generated = true WHERE id = $2',
      [pdfPath, serviceReportId]
    );
    
    console.log('✅ PDF path updated in database');
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}

module.exports = UnifiedPDFGenerator;