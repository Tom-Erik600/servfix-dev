// src/services/unifiedPdfGenerator.js - Air-Tech PDF Generator med riktig mal, logo og avvik
const puppeteer = require('puppeteer');
const db = require('../config/database');
const fs = require('fs').promises;
const path = require('path');
const { Storage } = require('@google-cloud/storage');

class UnifiedPDFGenerator {
  constructor() {
    this.browser = null;
    this.avvikMap = new Map();
    
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
      // MILJØ-SPESIFIKKE INNSTILLINGER
      const isProduction = process.env.NODE_ENV === 'production';
      const isWindows = process.platform === 'win32';

      console.log(`🔧 Environment: ${isProduction ? 'PRODUCTION' : 'DEVELOPMENT'}`);
      console.log(`🔧 Platform: ${process.platform}`);

      const options = {
        headless: isProduction ? true : 'new',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu'
        ]
      };

      // PRODUKSJON (Google Cloud Run)
      if (process.env.K_SERVICE) {
        options.executablePath = '/usr/bin/chromium';
        options.args.push(
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
          '--no-first-run',
          '--no-zygote',
          '--single-process'
        );
      } 
      // DEVELOPMENT (Windows)
      else if (!isProduction && isWindows) {
        console.log('🚀 Configuring for Windows development...');
        options.args.push(
          '--disable-web-security',
          '--disable-features=TranslateUI',
          '--disable-extensions',
          '--disable-plugins',
          '--run-all-compositor-stages-before-draw',
          '--disable-background-timer-throttling',
          '--disable-renderer-backgrounding',
          '--disable-backgrounding-occluded-windows',
          '--memory-pressure-off'
        );
        
        if (process.env.PUPPETEER_EXECUTABLE_PATH) {
          options.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
        }
      } 
      // ANDRE MILJØER
      else {
        if (process.env.PUPPETEER_EXECUTABLE_PATH) {
          options.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
        }
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
      
      // Save debug HTML for development
      await this.debugSaveHTML(html, serviceReportId);
      
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

  // KRITISK FIX: Komplett revidert fetchReportData som følger Air-Tech templates
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
        o.customer_data->>'contact_person' as contact_person,
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
    data.products_used = this.safeJsonParse(data.products_used, []);
    data.additional_work = this.safeJsonParse(data.additional_work, []);
    data.photos = data.photos || [];

    const customerData = this.safeJsonParse(data.customer_data, {});
    data.contact_person = data.contact_person || customerData?.contact_person || '';

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

    // KRITISK: Load Air-Tech template basert på equipment type
    let checklistTemplate = null;
    try {
      const templateResult = await pool.query(
        'SELECT template_data FROM checklist_templates WHERE equipment_type = $1', 
        [data.equipment_type]
      );
      if (templateResult.rows.length > 0) {
        checklistTemplate = templateResult.rows[0].template_data;
        console.log('✅ Loaded Air-Tech template for', data.equipment_type);
      } else {
        console.warn('⚠️ No Air-Tech template found for', data.equipment_type, '- using fallback');
        // Use built-in Air-Tech template as fallback
        checklistTemplate = this.getAirTechTemplate(data.equipment_type);
      }
    } catch (e) { 
      console.error('❌ Could not fetch checklist template:', e.message);
      checklistTemplate = this.getAirTechTemplate(data.equipment_type);
    }

    // Prosesser checklist_data til Air-Tech checkpoint format
    if (data.checklist_data && data.checklist_data.components) {
      data.checklist_data.components = data.checklist_data.components.map(component => {
        // Set komponent navn basert på details
        if (!component.name && component.details) {
          const details = component.details;
          if (details.etasje && details.leilighet_nr && details.aggregat_type && details.system_nummer) {
            component.name = `${details.etasje} - ${details.leilighet_nr} - ${details.aggregat_type} - ${details.system_nummer}`;
          } else {
            component.name = Object.values(details).filter(v => v).join(' - ') || 'Sjekkliste';
          }
        }

        // KRITISK: Konverter checklist til Air-Tech checkpoint format
        if (component.checklist && checklistTemplate) {
          component.checkpoints = checklistTemplate.checklistItems.map(item => {
            const value = component.checklist[item.id] || {};
            return {
              id: item.id,
              name: item.label, // Use Air-Tech labels!
              status: value.status || 'na',
              comment: value.comment || value.avvikComment || value.byttetComment || '',
              inputType: item.inputType,
              value: value.value,
              temperature: value.temperature,
              efficiency: value.efficiency,
              images: value.images || [], // KRITISK: Include images!
              componentName: component.name
            };
          });
        } else if (component.checklist) {
          // Fallback hvis template mangler
          component.checkpoints = Object.entries(component.checklist).map(([key, value]) => ({
            id: key,
            name: this.formatCheckpointName(key),
            status: value?.status || 'na',
            comment: value?.comment || value?.avvikComment || value?.byttetComment || '',
            images: value?.images || [],
            componentName: component.name
          }));
        }
        
        return component;
      });
    }

    // KRITISK: Ekstrakterer avvik fra alle komponenter
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
                component: component.name || 'Ukjent komponent',
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
    
    console.log(`✅ Air-Tech PDF Data processed: ${data.checklist_data.components?.length || 0} components, ${data.avvik.length} avvik found`);
    if (data.avvik.length > 0) {
      console.log('🚨 Avvik found:', data.avvik.map(a => `${a.id}: ${a.checkpoint} - ${a.description}`));
    }
    
    return data;
  }

  // Air-Tech template fallbacks
  getAirTechTemplate(equipmentType) {
    const templates = {
      'boligventilasjon': {
        checklistItems: [
          { id: 'item1', label: 'Funksjonskontroll', inputType: 'ok_avvik' },
          { id: 'item2', label: 'Vifter', inputType: 'ok_avvik' },
          { id: 'item3', label: 'Varmegjenvinner', inputType: 'ok_avvik' },
          { id: 'item4', label: 'Filter (tilluft)', inputType: 'ok_byttet_avvik' },
          { id: 'item5', label: 'Filter (avtrekk)', inputType: 'ok_byttet_avvik' },
          { id: 'item6', label: 'Varme', inputType: 'ok_avvik' }
        ]
      },
      'vifter': {
        checklistItems: [
          { id: 'item1', label: 'Funksjonskontroll', inputType: 'ok_avvik' },
          { id: 'item2', label: 'Frekvensomformer', inputType: 'ok_avvik' },
          { id: 'item3', label: 'Motor', inputType: 'ok_avvik' },
          { id: 'item4', label: 'Regulering / styring', inputType: 'ok_avvik' },
          { id: 'item5', label: 'Viftehjul', inputType: 'ok_avvik' },
          { id: 'item6', label: 'Varme', inputType: 'ok_avvik' },
          { id: 'item7', label: 'Filter/reimer', inputType: 'ok_byttet_avvik' }
        ]
      }
    };
    
    return templates[equipmentType] || templates['boligventilasjon'];
  }

  formatCheckpointName(id) {
    const nameMap = {
      'item1': 'Funksjonskontroll',
      'item2': 'Vifter', 
      'item3': 'Varmegjenvinner',
      'item4': 'Filter (tilluft)',
      'item5': 'Filter (avtrekk)',
      'item6': 'Varme'
    };
    
    return nameMap[id] || id.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').replace(/^./, str => str.toUpperCase()).trim();
  }

  // Air-Tech style komponenter
  generateComponentChecklist(component) {
    if (!component.checkpoints || component.checkpoints.length === 0) {
      return '';
    }

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
              
              // KRITISK: Vis kommentar for BYTTET, ikke for AVVIK
              let resultText = '';
              if (item.status === 'byttet' && item.comment) {
                resultText = item.comment;
              } else if (item.status !== 'avvik' && item.comment) {
                resultText = item.comment;
              }

              const mainRow = `
                <tr>
                  <td>${item.name}</td>
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

  // KRITISK: Air-Tech style avvik-seksjon som ALLTID vises når avvik finnes
  generateAvvikSection(avviks) {
    if (!avviks || avviks.length === 0) return '';
    
    return `
      <section class="section avvik-section">
          <h2 class="section-header avvik-header">🚨 Registrerte avvik</h2>
          <div class="avvik-notice">
            <p><strong>VIKTIG:</strong> Følgende avvik ble registrert under servicen og krever oppmerksomhet:</p>
          </div>
          ${avviks.map(avvik => `
              <div class="avvik-item">
                  <div class="avvik-details">
                      <div class="avvik-header-info">
                          <span class="avvik-id">AVVIK ID: ${avvik.id}</span>
                          <span class="component-info">${avvik.component} → ${avvik.checkpoint}</span>
                      </div>
                      <p class="avvik-comment">${avvik.description || 'Ingen beskrivelse'}</p>
                  </div>
                  ${avvik.images && avvik.images.length > 0 ? `
                  <div class="avvik-images">
                      ${avvik.images.map((img, index) => `<img src="${img}" alt="Avvik ${avvik.id} - Bilde ${index + 1}" class="avvik-image">`).join('')}
                  </div>` : ''}
              </div>
          `).join('')}
      </section>`;
  }

  generateSummarySection(data) {
    return `
      <section class="section summary-section page-break-before-auto">
          <h2 class="section-header">Oppsummering og dokumentasjon</h2>
          <div class="summary-content">
            ${data.overall_comment ? `<div class="summary-comment"><strong>Øvrige kommentarer:</strong><br>${data.overall_comment.replace(/\n/g, '<br>')}</div>` : ''}
            
            ${data.photos && data.photos.length > 0 ? `
            <div class="documentation-photos">
                <h3>Dokumentasjonsbilder</h3>
                <div class="photos-grid">
                    ${data.photos.map((photo, index) => `
                        <div class="photo-container">
                            <img src="${photo}" alt="Dokumentasjonsbilde ${index + 1}" class="photo">
                            <div class="photo-caption">Bilde ${index + 1}</div>
                        </div>
                    `).join('')}
                </div>
            </div>` : ''}
          </div>
      </section>
    `;
  }

  // KRITISK FIX: Air-Tech HTML med riktig logo-håndtering og avvik
  async generateHTML(data, settings) {
    this.avvikMap = new Map();
    if (data.avvik && data.avvik.length > 0) {
      data.avvik.forEach(avvik => {
        const key = `${avvik.component}#${avvik.checkpoint}`;
        this.avvikMap.set(key, avvik.id);
      });
    }

    const css = this.getAirTechCSS();
    const company = settings.company || {};
    
    // KRITISK FIX: Riktig logo-håndtering
    let logoHtml = '';
    if (settings.logoBase64) {
      logoHtml = `<img src="${settings.logoBase64}" alt="${company.name} Logo" class="company-logo">`;
    } else {
      logoHtml = `
        <div class="logo-placeholder">
          <div class="logo-text">Air-Tech<br>AS</div>
        </div>`;
    }
    
    const technician = data.technician_name || 'Tekniker';
    const reportDate = new Date(data.service_date || data.created_at).toLocaleDateString('nb-NO');
    
    return `
      <!DOCTYPE html>
      <html lang="no">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Servicerapport ${data.id}</title>
        <style>${css}</style>
      </head>
      <body>
          <div class="pdf-container">
              <header class="header-section">
                  <div class="header-content">
                      <div class="company-info">
                          ${logoHtml}
                          <div class="company-details">
                              <h1 class="company-name">Air-Tech AS</h1>
                              <p class="company-address">${company.address || 'Stanseveien 18, 0975 Oslo'}</p>
                          </div>
                      </div>
                      <div class="report-info">
                          <h2 class="report-title">SERVICERAPPORT</h2>
                          <p class="report-number">SR-${data.id}</p>
                          <p class="report-date">${reportDate}</p>
                      </div>
                  </div>
              </header>

              <main class="main-content">
                  <section class="section customer-info">
                      <div class="info-grid">
                          <div class="info-block">
                              <h3>Kundeopplysninger</h3>
                              <p><strong>BEDRIFT:</strong> ${data.company_name || ''}</p>
                              <p><strong>KONTAKTPERSON:</strong> ${data.contact_person || '-'}</p>
                              <p><strong>ADRESSE:</strong> ${data.company_address || '-'}</p>
                              <p><strong>TELEFON:</strong> ${data.company_phone || '-'}</p>
                          </div>
                          <div class="info-block">
                              <h3>Serviceopplysninger</h3>
                              <p><strong>SERVICEDATO:</strong> ${reportDate}</p>
                              <p><strong>TEKNIKER:</strong> ${technician}</p>
                              <p><strong>ANLEGG:</strong> ${data.equipment_name || ''}</p>
                              <p><strong>TYPE:</strong> ${data.equipment_type || ''}</p>
                              <p><strong>PLASSERING:</strong> ${data.equipment_location || ''}</p>
                          </div>
                      </div>
                  </section>

                  <section class="section equipment-overview">
                      <h2 class="section-header">Oversikt over kontrollerte systemer</h2>
                      <table class="styled-table">
                          <thead>
                              <tr>
                                  <th>Systemtype</th>
                                  <th>Systemnummer</th>
                                  <th>Plassering</th>
                                  <th>Betjener</th>
                              </tr>
                          </thead>
                          <tbody>
                              ${data.all_equipment.map(eq => `
                                  <tr>
                                      <td>${eq.type || ''}</td>
                                      <td>${eq.system_number || ''}</td>
                                      <td>${eq.location || ''}</td>
                                      <td>${eq.betjener || ''}</td>
                                  </tr>
                              `).join('')}
                          </tbody>
                      </table>
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
                      <p><strong>Air-Tech AS</strong></p>
                      <div class="signature-line"></div>
                      <p>${technician}</p>
                  </div>
                  <div class="footer-grid">
                      <div class="footer-company-info">
                          <p><strong>Air-Tech AS</strong></p>
                          <p>Stanseveien 18, 0975 Oslo</p>
                      </div>
                      <div class="footer-contact-info">
                           <p>Telefon: +47 91 52 40 40</p>
                           <p>Epost: post@air-tech.no</p>
                           <p>Org.nr: 889 558 652</p>
                      </div>
                  </div>
              </footer>
          </div>
      </body>
      </html>`;
  }

  // Air-Tech CSS styling
  getAirTechCSS() {
    return `
      :root {
        --brand-blue: #3b5998;
        --dark-blue: #1e3a8a;
        --light-blue: #3b82f6;
        --success-green: #10b981;
        --warning-orange: #f59e0b;
        --error-red: #ef4444;
        --text-dark: #1f2937;
        --text-light: #6b7280;
        --border-color: #d1d5db;
        --light-gray: #f9fafb;
        --status-ok: #059669;
        --status-byttet: #0891b2;
        --status-avvik: #dc2626;
      }

      * { box-sizing: border-box; margin: 0; padding: 0; }
      
      body {
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        line-height: 1.6;
        color: var(--text-dark);
        background: white;
      }

      .pdf-container { max-width: 210mm; margin: 0 auto; background: white; }

      .header-section {
        background: linear-gradient(135deg, var(--brand-blue), var(--dark-blue));
        color: white;
        padding: 30px 30px 25px;
        margin-bottom: 25px;
      }

      .header-content { display: flex; justify-content: space-between; align-items: flex-start; }

      .company-info { display: flex; align-items: center; gap: 20px; }

      .company-logo {
        height: 80px;
        width: auto;
        max-width: 120px;
        object-fit: contain;
        background: white;
        padding: 10px;
        border-radius: 8px;
      }

      .logo-placeholder {
        height: 80px;
        width: 120px;
        background: white;
        color: var(--brand-blue);
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 8px;
        border: 2px solid white;
      }

      .logo-text {
        font-weight: bold;
        font-size: 16px;
        text-align: center;
        line-height: 1.2;
      }

      .company-name { font-size: 28px; font-weight: 700; margin-bottom: 5px; }
      .company-address { font-size: 14px; opacity: 0.9; }

      .report-info { text-align: right; }
      .report-title { font-size: 24px; font-weight: 700; margin-bottom: 8px; }
      .report-number { font-size: 16px; font-weight: 600; margin-bottom: 4px; }
      .report-date { font-size: 14px; opacity: 0.9; }

      .section { margin-bottom: 25px; }
      .section-header {
        font-size: 18px;
        font-weight: 700;
        color: var(--dark-blue);
        margin-bottom: 15px;
        padding-bottom: 8px;
        border-bottom: 2px solid var(--brand-blue);
      }

      .avvik-header {
        color: var(--error-red) !important;
        border-bottom-color: var(--error-red) !important;
      }

      .avvik-section {
        background: #fef2f2;
        padding: 20px;
        border-radius: 8px;
        border: 2px solid #fecaca;
        margin-bottom: 30px;
      }

      .avvik-notice {
        background: #fee2e2;
        padding: 12px;
        border-radius: 6px;
        margin-bottom: 20px;
        border-left: 4px solid var(--error-red);
      }

      .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; }
      .info-block h3 { font-size: 14px; font-weight: 700; color: var(--dark-blue); margin-bottom: 12px; }
      .info-block p { font-size: 12px; margin-bottom: 6px; }

      .styled-table {
        width: 100%;
        border-collapse: collapse;
        margin-bottom: 15px;
        border: 1px solid var(--border-color);
      }

      .styled-table th {
        background-color: var(--brand-blue);
        color: white;
        padding: 12px;
        text-align: left;
        font-weight: 600;
        font-size: 11pt;
      }

      .styled-table td {
        padding: 10px 12px;
        border-bottom: 1px solid var(--border-color);
        font-size: 10pt;
      }

      .styled-table tr:nth-child(even) { background-color: #f8fafc; }

      .avvik-item {
        background-color: white;
        border: 1px solid #fecaca;
        border-left: 4px solid var(--error-red);
        padding: 15px;
        margin-bottom: 15px;
        border-radius: 6px;
      }

      .avvik-header-info {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 8px;
      }

      .avvik-id {
        font-weight: 700;
        color: var(--error-red);
        font-size: 12px;
      }

      .component-info {
        font-size: 11px;
        color: var(--text-light);
      }

      .avvik-comment {
        font-size: 11pt;
        color: var(--text-dark);
        margin-bottom: 10px;
      }

      .avvik-images {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
      }

      .avvik-image { width: 120px; height: 90px; object-fit: cover; border-radius: 4px; border: 1px solid var(--border-color); }

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
      .signature-line { border-bottom: 1px solid var(--border-color); margin: 20px 0 10px 0; width: 300px; }

      .footer-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; }

      .center { text-align: center; }
      .page-break-before-auto { page-break-before: auto; }

      @media print {
        .pdf-container { margin: 0; max-width: none; }
        .header-section { margin-bottom: 20px; }
        .section { page-break-inside: avoid; }
        .avvik-item { page-break-inside: avoid; }
        .component-checklist { page-break-inside: avoid; }
      }
    `;
  }

  safeJsonParse(jsonString, defaultValue) {
    if (typeof jsonString !== 'string') return jsonString || defaultValue;
    try {
      return JSON.parse(jsonString);
    } catch (e) {
      return defaultValue;
    }
  }

  // KRITISK FIX: Riktig logo-lasting fra GCS
  async loadCompanySettings(tenantId) {
    const settings = {
      company: { 
        name: 'Air-Tech AS', 
        address: 'Stanseveien 18, 0975 Oslo', 
        phone: '+47 91 52 40 40', 
        email: 'post@air-tech.no', 
        orgNr: '889 558 652', 
        website: 'www.air-tech.no' 
      },
      logoBase64: null
    };
    
    if (!this.bucket) {
      console.warn('⚠️ No GCS bucket available, skipping logo load');
      return settings;
    }
    
    try {
      // Try to load settings from GCS
      const settingsFile = this.bucket.file(`tenants/${tenantId}/assets/settings.json`);
      const [exists] = await settingsFile.exists();
      if (exists) {
        const [content] = await settingsFile.download();
        const savedSettings = JSON.parse(content.toString());
        if (savedSettings.companyInfo) {
          settings.company = { ...settings.company, ...savedSettings.companyInfo };
        }
        if (savedSettings.logo?.url) {
          console.log(`📥 Loading logo from: ${savedSettings.logo.url}`);
          settings.logoBase64 = await this.downloadLogoFromUrl(savedSettings.logo.url);
        }
      } else {
        console.log(`⚠️ No settings file found for tenant ${tenantId}`);
      }
    } catch (error) { 
      console.error('❌ Error loading company settings:', error.message); 
    }
    
    return settings;
  }

  // KRITISK FIX: Riktig logo-nedlasting
  async downloadLogoFromUrl(logoUrl) {
    if (!logoUrl) return null;
    
    try {
        if (logoUrl.includes('storage.googleapis.com') && this.bucket) {
            // Extract file path from URL: https://storage.googleapis.com/servfix-files/tenants/airtech/assets/logo_1754527591365.jpg
            const pathMatch = logoUrl.match(/storage\.googleapis\.com\/[^\/]+\/(.+)$/);
            if (pathMatch) {
                const filePath = pathMatch[1]; // e.g. "tenants/airtech/assets/logo_1754527591365.jpg"
                console.log(`📥 Downloading logo from GCS: ${filePath}`);
                
                const file = this.bucket.file(filePath);
                const [exists] = await file.exists();
                if (exists) {
                    const [buffer] = await file.download();
                    const mimeType = filePath.endsWith('.png') ? 'image/png' : 'image/jpeg';
                    const base64 = `data:${mimeType};base64,${buffer.toString('base64')}`;
                    console.log(`✅ Logo downloaded successfully (${Math.round(buffer.length / 1024)}KB)`);
                    return base64;
                } else {
                    console.warn(`⚠️ Logo file does not exist: ${filePath}`);
                }
            }
        }
        
        console.warn(`⚠️ Could not parse logo URL: ${logoUrl}`);
        return null;
    } catch (error) {
        console.error('❌ Error downloading logo:', error.message);
        return null;
    }
  }

  async generatePDF(html) {
  const isWindows = process.platform === 'win32';
  const isProduction = process.env.NODE_ENV === 'production';
  
  const page = await this.browser.newPage();
  
  try {
    // MILJØ-SPESIFIKKE PDF-INNSTILLINGER
    const contentOptions = { waitUntil: 'networkidle0' };
    const pdfOptions = {
      format: 'A4',
      margin: { top: '15mm', right: '10mm', bottom: '15mm', left: '10mm' },
      printBackground: true,
      displayHeaderFooter: false,
      preferCSSPageSize: true
    };
    
    // Windows development - legg til timeouts og pauser
    if (!isProduction && isWindows) {
      console.log('🔧 Using Windows-specific PDF settings...');
      contentOptions.timeout = 30000;  // 30 sekunder timeout
      pdfOptions.timeout = 30000;      // 30 sekunder PDF timeout
      
      await page.setContent(html, contentOptions);
      await new Promise(resolve => setTimeout(resolve, 1000)); // 1 sekund pause før PDF
      
    // Produksjon - standard innstillinger
    } else {
      console.log('🔧 Using production PDF settings...');
      await page.setContent(html, contentOptions);
    }
    
    const pdfBuffer = await page.pdf(pdfOptions);
    console.log(`✅ PDF generated successfully (${(pdfBuffer.length / 1024).toFixed(2)} KB)`);
    
    return pdfBuffer;
    
  } catch (error) {
    console.error('❌ PDF generation error:', error.message);
    throw error;
  } finally {
    // Sikre at page lukkes
    try {
      await page.close();
    } catch (closeError) {
      console.warn('⚠️ Could not close page:', closeError.message);
    }
  }
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

  async debugSaveHTML(html, reportId) {
    if (process.env.NODE_ENV !== 'production') {
      try {
        const debugDir = path.join(__dirname, '../../test-output');
        await fs.mkdir(debugDir, { recursive: true });
        const debugPath = path.join(debugDir, `debug_${reportId}_${Date.now()}.html`);
        await fs.writeFile(debugPath, html);
        console.log(`🐛 Debug HTML saved: ${debugPath}`);
      } catch (error) {
        console.warn('Could not save debug HTML:', error.message);
      }
    }
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}

module.exports = UnifiedPDFGenerator;
