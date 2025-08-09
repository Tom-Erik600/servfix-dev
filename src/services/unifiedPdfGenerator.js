// src/services/unifiedPdfGenerator.js - Kombinert og forbedret versjon
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
        if (process.env.K_SERVICE) {
          this.storage = new Storage({ projectId: process.env.GCP_PROJECT_ID || 'servfix' });
          console.log('✅ Using Google Cloud default credentials (Cloud Run)');
        } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
          const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS);
          this.storage = new Storage({ projectId: process.env.GCP_PROJECT_ID || 'servfix', credentials });
          console.log('✅ Using Google Cloud credentials from env variable');
        } else {
          const credentials = require('../config/serviceAccountKey.json');
          this.storage = new Storage({ projectId: process.env.GCP_PROJECT_ID || 'servfix', credentials });
          console.log('✅ Using Google Cloud credentials from file');
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
      if (process.env.K_SERVICE) {
        options.executablePath = '/usr/bin/chromium';
      } else if (process.env.PUPPETEER_EXECUTABLE_PATH) {
        options.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
      }
      this.browser = await puppeteer.launch(options);
    } catch (error) {
      console.error('❌ Failed to launch Puppeteer:', error.message);
      try {
        this.browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
      } catch (fallbackError) {
        throw new Error(`Cannot launch browser: ${fallbackError.message}`);
      }
    }
  }

  async generateReport(serviceReportId, tenantId) {
    console.log(`📄 Starting PDF generation for report ${serviceReportId}`);
    try {
      await this.init();
      const reportData = await this.fetchReportData(serviceReportId, tenantId);
      const companySettings = await this.loadCompanySettings(tenantId);
      const html = await this.generateHTML(reportData, companySettings);
      const pdfBuffer = await this.generatePDF(html);
      const pdfPath = await this.savePDF(pdfBuffer, reportData, tenantId);
      await this.updateReportPDFPath(serviceReportId, pdfPath, tenantId);
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
    const query = `
      SELECT 
        sr.id, sr.order_id, sr.equipment_id, sr.checklist_data, sr.products_used,
        sr.additional_work, sr.status, sr.signature_data, sr.photos, sr.created_at,
        sr.completed_at, sr.pdf_path, sr.pdf_generated,
        o.id as order_number, o.customer_name as company_name, o.description as order_description,
        o.scheduled_date as service_date, o.customer_data,
        o.customer_data->>'email' as company_email, o.customer_data->>'phone' as company_phone,
        o.customer_data->>'address' as company_address,
        e.name as equipment_name, e.type as equipment_type, e.location as equipment_location,
        e.serial_number as equipment_serial, e.data as equipment_data,
        t.name as technician_name, t.initials as technician_initials
      FROM service_reports sr
      LEFT JOIN orders o ON sr.order_id = o.id
      LEFT JOIN equipment e ON sr.equipment_id = e.id
      LEFT JOIN technicians t ON o.technician_id = t.id
      WHERE sr.id = $1
    `;
    const result = await pool.query(query, [serviceReportId]);
    if (result.rows.length === 0) throw new Error('Service report not found');
    
    const data = result.rows[0];
    
    // Parse JSON fields safely
    data.checklist_data = this.safeJsonParse(data.checklist_data, {});
    data.equipment_data = this.safeJsonParse(data.equipment_data, {});
    const customerData = this.safeJsonParse(data.customer_data, {});
    data.contact_person = customerData?.contact_person || '';

    const systemNumber = data.equipment_data?.system_nummer || data.equipment_data?.systemNumber || data.equipment_serial || '-';
    
    data.all_equipment = [{
      id: data.equipment_id,
      type: data.equipment_type,
      location: data.equipment_location,
      name: data.equipment_name,
      system_number: systemNumber,
      betjener: data.equipment_data?.betjener || '-',
      report_id: data.id
    }];

    let checklistTemplate = null;
    try {
      const templateResult = await pool.query('SELECT template_data FROM checklist_templates WHERE equipment_type = $1', [data.equipment_type]);
      if (templateResult.rows.length > 0) {
        checklistTemplate = templateResult.rows[0].template_data;
      }
    } catch (e) { console.error('Could not fetch checklist template:', e); }

    if (data.checklist_data && data.checklist_data.components) {
      data.checklist_data.components = data.checklist_data.components.map(component => {
        if (!component.name && component.details) {
          component.name = Object.values(component.details).filter(v => v).join(' - ') || 'Sjekkliste';
        }
        if (checklistTemplate && checklistTemplate.checklistItems && component.checklist) {
          component.checkpoints = checklistTemplate.checklistItems.map(item => {
            const value = component.checklist[item.id] || {};
            return {
              id: item.id,
              name: item.label,
              status: value.status || 'na',
              comment: value.comment || value.avvikComment || value.byttetComment || '',
              inputType: item.inputType,
              value: value.value,
              temperature: value.temperature,
              efficiency: value.efficiency,
              formula: value.formula,
              selectedOption: value.selectedOption,
              tilstandsgrad: value.tilstandsgrad,
              konsekvensgrad: value.konsekvensgrad,
              unit: item.unit,
              images: value.images || [],
              componentName: component.name // For avvik mapping
            };
          });
        }
        return component;
      });
    }

    data.avvik = [];
    let avvikCounter = 1;
    if (data.checklist_data && data.checklist_data.components) {
      data.checklist_data.components.forEach(component => {
        if (component.checkpoints) {
          component.checkpoints.forEach(checkpoint => {
            if (checkpoint.status === 'avvik' && checkpoint.comment) {
              data.avvik.push({
                id: String(avvikCounter++).padStart(3, '0'),
                systemnummer: systemNumber,
                component: component.name,
                checkpoint: checkpoint.name,
                description: checkpoint.comment,
                images: checkpoint.images || []
              });
            }
          });
        }
      });
    }
    
    data.overall_comment = data.checklist_data?.overallComment || '';
    data.photos = data.photos || [];
    return data;
  }

  safeJsonParse(jsonString, defaultValue) {
    if (typeof jsonString !== 'string') return jsonString || defaultValue;
    try {
      return JSON.parse(jsonString);
    } catch (e) {
      return defaultValue;
    }
  }

  async loadCompanySettings(tenantId) {
    const settings = {
      company: { name: 'Air-Tech AS', address: 'Stanseveien 18, 0975 Oslo', phone: '+47 91 52 40 40', email: 'post@air-tech.no', orgNr: '889 558 652', website: 'www.air-tech.no' },
      logoBase64: null
    };
    if (!this.bucket) return settings;
    try {
      const settingsFile = this.bucket.file(`tenants/${tenantId}/settings.json`);
      const [exists] = await settingsFile.exists();
      if (exists) {
        const [content] = await settingsFile.download();
        const savedSettings = JSON.parse(content.toString());
        if (savedSettings.companyInfo) {
          settings.company = { ...settings.company, ...savedSettings.companyInfo };
        }
        if (savedSettings.logo?.url) {
          settings.logoBase64 = await this.downloadLogoFromUrl(savedSettings.logo.url);
        }
      }
    } catch (error) { console.error('Error loading company settings:', error); }
    return settings;
  }

  async downloadLogoFromUrl(logoUrl) {
    if (!logoUrl) return null;
    try {
        if (logoUrl.includes('storage.googleapis.com') && this.bucket) {
            const filePath = logoUrl.split(`${this.bucket.name}/`)[1];
            if (filePath) {
                const file = this.bucket.file(filePath);
                const [exists] = await file.exists();
                if (exists) {
                    const [buffer] = await file.download();
                    const mimeType = filePath.endsWith('.png') ? 'image/png' : 'image/jpeg';
                    return `data:${mimeType};base64,${buffer.toString('base64')}`;
                }
            }
        }
        return logoUrl;
    } catch (error) {
        console.error('Error downloading logo:', error);
        return null;
    }
  }

  // ===================================================================
  // HTML AND PDF GENERATION LOGIC
  // ===================================================================

  async generateHTML(data, settings) {
    this.avvikMap = new Map();
    if (data.avvik) {
        data.avvik.forEach(avvik => {
            const key = `${avvik.component}#${avvik.checkpoint}`;
            this.avvikMap.set(key, avvik.id);
        });
    }

    const css = this.getCSS();
    const company = settings.company || {};
    const logoHtml = settings.logoBase64 ? `<img src="${settings.logoBase64}" alt="${company.name}" class="logo">` : '';
    const reportDate = new Date(data.service_date || data.created_at).toLocaleDateString('no-NO');
    const technician = data.technician_name || '[Navn ansatt]';

    return `
    <!DOCTYPE html>
    <html lang="no">
    <head>
        <meta charset="UTF-8">
        <title>Servicerapport ${data.order_number || data.id}</title>
        <style>${css}</style>
    </head>
    <body>
        <div class="page-container">
            <header class="header">
                <div class="company-details">
                    ${logoHtml}
                </div>
                <div class="report-title-box">
                    <h1>Servicerapport</h1>
                    <p>${data.company_name || '[Kundenavn]'}</p>
                </div>
            </header>

            <main>
                <section class="section info-section">
                    <div class="info-grid">
                        <div class="info-block"><span class="label">Kunde</span>${data.company_name || '[Kundenavn]'}</div>
                        <div class="info-block"><span class="label">Utført av</span>${technician}</div>
                        <div class="info-block"><span class="label">Anleggsadresse</span>${data.company_address || '[Adresse]'}</div>
                        <div class="info-block"><span class="label">Dato for service</span>${reportDate}</div>
                        <div class="info-block"><span class="label">Kontaktperson</span>${data.contact_person || '[Mottaker]'}</div>
                        <div class="info-block"><span class="label">Ordrenummer</span>${data.order_number || '[Kundenummer]'}</div>
                    </div>
                    <p class="intro-text">Servicearbeidet som ble avtalt for de angitte anleggene er nå fullført i tråd med avtalen.</p>
                </section>

                <section class="section">
                    <h2 class="section-header">Anlegg- og systemoversikt</h2>
                    <table class="styled-table">
                        <thead><tr><th>Systemtype</th><th>Systemnummer</th><th>Plassering</th><th>Betjener</th></tr></thead>
                        <tbody>
                            ${data.all_equipment.map(eq => `<tr><td>${eq.type || '-'}</td><td>${eq.system_number || '-'}</td><td>${eq.location || '-'}</td><td>${eq.betjener || '-'}</td></tr>`).join('')}
                        </tbody>
                    </table>
                    <p class="footnote">Anlegg som ikke har blitt rapportert med avvik, er vurdert som funksjonelt og teknisk i orden.</p>
                </section>
                
                ${data.avvik && data.avvik.length > 0 ? this.generateAvvikSection(data.avvik) : ''}

                <section class="section page-break-before-auto">
                    <h2 class="section-header">Resultat fra sjekklister</h2>
                    ${data.checklist_data.components.map(component => this.generateComponentChecklist(component)).join('')}
                </section>
                
                ${(data.overall_comment || (data.photos && data.photos.length > 0)) ? this.generateSummarySection(data) : ''}
            </main>

            <footer class="footer-section">
                <div class="signature-area">
                    <p>Med vennlig hilsen,</p>
                    <p><strong>${company.name}</strong></p>
                    <div class="signature-line"></div>
                    <p>${technician}</p>
                </div>
                <div class="footer-grid">
                    <div class="footer-company-info">
                        <p><strong>${company.name}</strong></p>
                        <p>${company.address || ''}</p>
                    </div>
                    <div class="footer-contact-info">
                         <p>Telefon: ${company.phone || ''}</p>
                         <p>Epost: ${company.email || ''}</p>
                         <p>Org.nr: ${company.orgNr || ''}</p>
                    </div>
                </div>
            </footer>
        </div>
    </body>
    </html>`;
  }

  generateAvvikSection(avviks) {
    return `
      <section class="section">
          <h2 class="section-header avvik-header">Registrerte avvik</h2>
          ${avviks.map(avvik => `
              <div class="avvik-item">
                  <div class="avvik-details">
                      <div class="avvik-header">
                          <span class="id">AVVIK ID: ${avvik.id}</span>
                          <span class="component-info">${avvik.component} / ${avvik.checkpoint}</span>
                      </div>
                      <p class="avvik-comment">${avvik.description || ''}</p>
                  </div>
                  ${avvik.images && avvik.images.length > 0 ? `<div class="avvik-images">${avvik.images.map(img => `<img src="${img}" alt="Bilde for avvik ${avvik.id}" class="avvik-image">`).join('')}</div>` : ''}
              </div>
          `).join('')}
      </section>`;
  }

  generateComponentChecklist(component) {
    if (!component.checkpoints || component.checkpoints.length === 0) return '';

    return `
      <div class="component-checklist">
        <h3 class="component-name">${component.name || 'Sjekkliste'}</h3>
        <table class="styled-table">
          <thead>
            <tr>
              <th style="width: 45%;">Sjekkpunkt</th>
              <th style="width: 15%; text-align: center;">Status</th>
              <th>Merknad / Resultat</th>
            </tr>
          </thead>
          <tbody>
            ${component.checkpoints.map(item => {
              let statusHtml = '';
              const avvikId = (item.status === 'avvik') ? this.avvikMap.get(`${item.componentName}#${item.name}`) : '';

              switch (item.status) {
                case 'ok':
                  statusHtml = `<span class="status status-ok">OK</span>`;
                  break;
                case 'byttet':
                  statusHtml = `<span class="status status-byttet">BYTTET</span>`;
                  break;
                case 'avvik':
                  statusHtml = `<span class="status status-avvik">AVVIK</span> ${avvikId ? `<span class="avvik-id-ref">(ID: ${avvikId})</span>` : ''}`;
                  break;
                default:
                  statusHtml = `<span class="status status-na">Ikke relevant</span>`;
                  break;
              }
              
              let resultText = '';
              if (item.status !== 'avvik' && item.comment) {
                resultText = item.comment;
              } else if (item.inputType === 'temperature' && item.temperature) {
                resultText = `Målt: ${item.temperature}°C`;
              } else if (item.inputType === 'virkningsgrad' && item.efficiency) {
                resultText = `Virkningsgrad: ${item.efficiency}%`;
              } else if (item.inputType === 'numeric' && item.value !== undefined) {
                resultText = `Verdi: ${item.value} ${item.unit || ''}`.trim();
              } else if (item.selectedOption) {
                resultText = `Valg: ${item.selectedOption}`;
              }

              const mainRow = `
                <tr>
                  <td>${item.name || 'Ukjent sjekkpunkt'}</td>
                  <td class="center">${statusHtml}</td>
                  <td>${resultText}</td>
                </tr>
              `;

              let imageRow = '';
              if (item.images && item.images.length > 0) {
                imageRow = `
                  <tr class="image-row">
                    <td></td>
                    <td colspan="2">
                      <div class="checklist-images">
                        ${item.images.map(img => `<img src="${img}" alt="Bilde for ${item.name}" class="checklist-image">`).join('')}
                      </div>
                    </td>
                  </tr>
                `;
              }
              
              return mainRow + imageRow;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  }
  
  generateSummarySection(data) {
    return `
      <section class="section summary-section page-break-before-auto">
          <h2 class="section-header">Oppsummering og dokumentasjon</h2>
          <div class="summary-content">
            ${data.overall_comment ? `<div class="summary-comment"><strong>Øvrige kommentarer:</strong><br>${data.overall_comment.replace(/\n/g, '<br>')}</div>` : ''}
            
            ${data.photos && data.photos.length > 0 ? `
            <div class="documentation-photos">
                <h3>Dokumentasjon</h3>
                <div class="photos-grid">
                    ${data.photos.map((photo, index) => `
                    <div class="photo-container">
                        <img src="${photo}" alt="Bilde ${index + 1}" class="photo">
                        <p class="photo-caption">Bilde ${index + 1}</p>
                    </div>`).join('')}
                </div>
            </div>` : ''}
          </div>
      </section>`;
  }

  getCSS() {
    return `
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
      
      :root {
        --brand-blue: #00529B;
        --dark-blue: #003366;
        --light-gray: #f4f4f4;
        --border-color: #e0e0e0;
        --text-dark: #333333;
        --text-light: #666666;
        --status-ok: #28a745;
        --status-byttet: #ff7b00;
        --status-avvik: #dc3545;
      }
      
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { font-family: 'Inter', Arial, sans-serif; font-size: 9pt; line-height: 1.5; color: var(--text-dark); background: #ffffff; }
      .page-container { width: 100%; min-height: 297mm; padding: 15mm; }
      .page-break-before-auto { page-break-before: auto; }

      .header { display: flex; justify-content: space-between; align-items: flex-start; gap: 40px; padding-bottom: 15px; border-bottom: 2px solid var(--brand-blue); margin-bottom: 25px; }
      .company-details .logo { max-width: 200px; max-height: 80px; margin-bottom: 15px; }
      .report-title-box { text-align: right; padding-top: 10px; }
      .report-title-box h1 { font-size: 24pt; font-weight: 700; color: var(--brand-blue); margin-bottom: 5px; }
      .report-title-box p { font-size: 11pt; font-weight: 500; color: var(--text-light); }

      .section { margin-bottom: 25px; page-break-inside: avoid; }
      .section.info-section { background-color: #f9f9f9; padding: 15px; border-radius: 4px; border: 1px solid var(--border-color); }
      .section-header { font-size: 14pt; font-weight: 600; color: var(--dark-blue); margin-bottom: 15px; padding-bottom: 5px; border-bottom: 1px solid var(--border-color); }
      .section-header.avvik-header { color: var(--status-avvik); border-bottom-color: var(--status-avvik); }

      .info-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px 20px; font-size: 9pt; margin-bottom: 15px; }
      .info-block .label { font-weight: 600; color: var(--text-light); display: block; margin-bottom: 1px; font-size: 8pt; text-transform: uppercase; }
      .intro-text { margin-top: 20px; font-style: italic; color: var(--text-light); text-align: center; font-size: 8.5pt; }

      .styled-table { width: 100%; border-collapse: collapse; font-size: 9pt; }
      .styled-table th, .styled-table td { padding: 9px 12px; border-bottom: 1px solid var(--border-color); text-align: left; vertical-align: top; }
      .styled-table th { background-color: var(--light-gray); font-weight: 600; color: var(--dark-blue); border-bottom-width: 2px; border-bottom-color: #ccc; }
      .styled-table tr:last-child td { border-bottom: none; }
      .styled-table .center { text-align: center; }
      .footnote { font-size: 8pt; font-style: italic; color: var(--text-light); margin-top: 8px; }

      .avvik-item { border-left: 4px solid var(--status-avvik); margin-bottom: 15px; background: #fff; padding: 12px; border: 1px solid var(--border-color); border-radius: 4px; }
      .avvik-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
      .avvik-header .id { font-size: 10pt; font-weight: 700; color: var(--status-avvik); }
      .avvik-header .component-info { font-size: 9pt; font-weight: 500; text-align: right; color: var(--text-light); }
      .avvik-comment { font-size: 9pt; }
      .avvik-images { padding-top: 10px; display: flex; gap: 10px; flex-wrap: wrap; }
      .avvik-image { width: 90px; height: 90px; object-fit: cover; border-radius: 4px; border: 1px solid var(--border-color); }

      .component-checklist { margin-bottom: 20px; }
      .component-name { font-size: 12pt; font-weight: 600; color: var(--dark-blue); padding: 8px; background-color: var(--light-gray); border-radius: 4px; margin-bottom: 10px; }
      
      .status { font-weight: 600; text-transform: uppercase; font-size: 8.5pt; }
      .status-ok { color: var(--status-ok); }
      .status-byttet { color: var(--status-byttet); }
      .status-avvik { color: var(--status-avvik); }
      .status-na { color: var(--text-light); font-weight: 400; }
      .avvik-id-ref { font-size: 8pt; color: var(--text-light); margin-left: 5px; }

      .image-row td { padding: 5px 12px; border-bottom: 1px solid var(--border-color); background-color: #fafafa; }
      .checklist-images { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
      .checklist-image { height: 70px; width: 70px; object-fit: cover; border-radius: 4px; border: 1px solid var(--border-color); }

      .summary-section { margin-top: 30px; }
      .summary-content { padding: 15px; background-color: #f9f9f9; border-radius: 4px; border: 1px solid var(--border-color); }
      .summary-comment { white-space: pre-wrap; margin-bottom: 20px; }
      .documentation-photos h3 { font-size: 11pt; color: var(--dark-blue); margin-bottom: 10px; }
      .photos-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
      .photo-container { text-align: center; }
      .photo { width: 100%; height: 120px; object-fit: cover; border-radius: 4px; border: 1px solid var(--border-color); }
      .photo-caption { font-size: 8pt; color: var(--text-light); margin-top: 4px; }

      .footer-section { margin-top: 40px; padding-top: 20px; border-top: 2px solid var(--brand-blue); font-size: 8pt; color: var(--text-light); }
      .signature-area { margin-bottom: 30px; }
      .signature-area p { margin-bottom: 5px; }
      .signature-line { border-bottom: 1px solid var(--text-dark); margin-top: 50px; width: 250px; }
      .footer-grid { display: flex; justify-content: space-between; align-items: flex-start; }
      .footer-grid p { margin: 0; line-height: 1.4; }
    `;
  }

  async generatePDF(html) {
    const page = await this.browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdfBuffer = await page.pdf({
      format: 'A4',
      margin: { top: '15mm', right: '10mm', bottom: '15mm', left: '10mm' },
      printBackground: true,
      displayHeaderFooter: false
    });
    await page.close();
    return pdfBuffer;
  }

  async savePDF(pdfBuffer, data, tenantId) {
    const timestamp = Date.now();
    const filename = `${data.order_number}_${data.equipment_id}_${timestamp}.pdf`;
    const relativePath = `reports/${new Date().getFullYear()}/${String(new Date().getMonth() + 1).padStart(2, '0')}/${filename}`;
    
    if (this.bucket) {
      const file = this.bucket.file(`tenants/${tenantId}/${relativePath}`);
      await file.save(pdfBuffer, { metadata: { contentType: 'application/pdf' } });
      return relativePath;
    }
    
    const localDir = path.join(__dirname, '../../servfix-files/tenants', tenantId, 'reports', new Date().getFullYear().toString(), String(new Date().getMonth() + 1).padStart(2, '0'));
    await fs.mkdir(localDir, { recursive: true });
    const localPath = path.join(localDir, filename);
    await fs.writeFile(localPath, pdfBuffer);
    return relativePath;
  }

  async updateReportPDFPath(serviceReportId, pdfPath, tenantId) {
    const pool = await db.getTenantConnection(tenantId);
    await pool.query(
      'UPDATE service_reports SET pdf_path = $1, pdf_generated = true WHERE id = $2',
      [pdfPath, serviceReportId]
    );
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}

module.exports = UnifiedPDFGenerator;
