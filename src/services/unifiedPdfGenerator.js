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
      let reportData = await this.fetchReportData(serviceReportId, tenantId);
      
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
    data.tenant_id = tenantId;

    const customerData = this.safeJsonParse(data.customer_data, {});
    data.contact_person = data.contact_person || customerData?.contact_person || '';

    return data;
  }

  async processAirTechData(data) {
  console.log('🔧 Starting Air-Tech data processing...');
  
  // DEBUG: Log all available customer data
  console.log('🔍 DEBUG Customer data:', {
    customer_name: data.customer_name,
    company_name: data.company_name,
    customer_data: data.customer_data,
    checklist_data_components: data.checklist_data?.components?.length || 0,
    available_fields: Object.keys(data).filter(key => 
      key.toLowerCase().includes('customer') || 
      key.toLowerCase().includes('company')
    )
  });

  // KRITISK FIX: Bygg equipment overview fra components
  this.buildEquipmentOverviewFromComponents(data);

  // Load checklist template (bevar eksisterende logikk)
  let checklistTemplate = null;
  try {
    const pool = await db.getTenantConnection(data.tenant_id);
    const templateResult = await pool.query(
      'SELECT template_data FROM checklist_templates WHERE equipment_type = $1', 
      [data.equipment_type]
    );
    if (templateResult.rows.length > 0) {
      checklistTemplate = templateResult.rows[0].template_data;
      console.log('✅ Loaded Air-Tech template for', data.equipment_type);
    } else {
      console.warn('⚠️ No Air-Tech template found for', data.equipment_type, '- using fallback');
      checklistTemplate = this.getAirTechTemplate(data.equipment_type);
    }
  } catch (e) { 
    console.error('❌ Could not fetch checklist template:', e.message);
    checklistTemplate = this.getAirTechTemplate(data.equipment_type);
  }

  // Prosesser checklist_data til Air-Tech checkpoint format (bevar eksisterende)
  if (data.checklist_data && data.checklist_data.components) {
    data.checklist_data.components = data.checklist_data.components.map(component => {
      component.originalChecklist = component.checklist;

      if (!component.name && component.details) {
        const details = component.details;
        if (details.etasje && details.leilighet_nr && details.aggregat_type && details.system_nummer) {
          component.name = `${details.etasje} - ${details.leilighet_nr} - ${details.aggregat_type} - ${details.system_nummer}`;
        } else {
          component.name = Object.values(details).filter(v => v).join(' - ') || 'Sjekkliste';
        }
      }

      if (component.checklist && checklistTemplate) {
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
            images: value.images || [],
            componentName: component.name
          };
        });
      } else if (component.checklist) {
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

  // KRITISK FIX: Ekstrakterer avvik med systemfelter
  this.extractAvvikFromComponents(data);

  data.overall_comment = data.checklist_data?.overallComment || '';
  
  console.log(`✅ Air-Tech PDF Data processed: ${data.checklist_data.components?.length || 0} components, ${data.avvik.length} avvik found`);
  
  return data;
}
// NY METODE: Bygg equipment overview fra checklist components
buildEquipmentOverviewFromComponents(data) {
  console.log('🔧 Building equipment overview from components...');
  
  if (data.checklist_data?.components?.length > 0) {
    console.log('📋 Found components, extracting system fields...');
    
    data.all_equipment = data.checklist_data.components.map((component, index) => {
      console.log(`🔍 Component ${index + 1} data:`, {
        details: component.details,
        detailsWithLabels: component.detailsWithLabels,
        name: component.name
      });
      
      // KRITISK FIX: Hent systemfelter fra riktig sted
      const systemNumber = this.extractSystemField(component, 'system_nummer') ||
                          this.extractSystemField(component, 'systemnummer') || '';
      
      const plassering = this.extractSystemField(component, 'plassering') ||
                  this.extractSystemField(component, 'location') || 
                  this.extractSystemField(component, 'leilighet_nr') ||
                  this.extractSystemField(component, 'etasje') ||
                  this.extractSystemField(component, 'room') ||
                  this.extractSystemField(component, 'rom') ||
                  this.extractSystemField(component, 'bygning') ||
                  this.extractSystemField(component, 'building') ||
                  '';;

      const betjener = this.extractSystemField(component, 'betjener') ||
                this.extractSystemField(component, 'operator') || 
                this.extractSystemField(component, 'tekniker') ||        // LEGG TIL
                'Air-Tech AS';                                           // LEGG TIL DEFAULT;
      
      const viftetype = this.extractSystemField(component, 'viftetype') ||
                       this.extractSystemField(component, 'aggregat_type') || '';
      
      console.log(`📊 Extracted fields for component ${index + 1}:`, {
        systemNumber, 
        plassering, 
        betjener, 
        viftetype,
        // DEBUG: Vis alle tilgjengelige felter
        allDetailsFields: component.details ? Object.keys(component.details) : 'No details',
        allDetailsWithLabelsFields: component.detailsWithLabels ? Object.keys(component.detailsWithLabels) : 'No detailsWithLabels'
      });
      
      return {
        type: viftetype || data.equipment_type || '',
        system_number: systemNumber,
        location: plassering,
        betjener: betjener
      };
    });
    
    console.log('✅ Built all_equipment from components:', data.all_equipment);
  } else {
    console.log('⚠️ No components found, using fallback equipment data');
    const systemNumber = data.equipment_data?.system_nummer || 
                        data.equipment_data?.systemNumber || 
                        data.equipment_serial || '';
    
    data.all_equipment = [{
      type: data.equipment_type || '',
      system_number: systemNumber,
      location: data.equipment_location || '',
      betjener: data.equipment_data?.betjener || ''
    }];
  }
}

// HJELPEMETODE: Ekstrakterer systemfelt fra component
extractSystemField(component, fieldName) {
  // Prøv først detailsWithLabels (ny struktur med labels)
  if (component.detailsWithLabels && component.detailsWithLabels[fieldName]) {
    return component.detailsWithLabels[fieldName].value || '';
  }
  
  // Fallback til details (gammel struktur)
  if (component.details && component.details[fieldName]) {
    return component.details[fieldName];
  }
  
  return '';
}

// NY METODE: Ekstrakterer avvik med systemfelter og bilder
extractAvvikFromComponents(data) {
  console.log('🚨 Extracting avvik from components...');
  
  data.avvik = [];
  let avvikCounter = 1;

  if (data.checklist_data?.components) {
    data.checklist_data.components.forEach((component, componentIndex) => {
      const systemNumber = this.extractSystemField(component, 'system_nummer') ||
                          this.extractSystemField(component, 'systemnummer') || 
                          `Komponent ${componentIndex + 1}`;
      
      if (component.checkpoints) {
        component.checkpoints.forEach(checkpoint => {
          if (checkpoint.status === 'avvik' && checkpoint.comment) {
            const avvikData = {
              avvik_id: String(avvikCounter++).padStart(3, '0'),    // ✅ RIKTIG
              systemnummer: systemNumber,
              komponent: checkpoint.name,                           // ✅ RIKTIG - sjekkpunkt-navn
              kommentar: checkpoint.comment,                        // ✅ RIKTIG
              images: checkpoint.images || [],
// DEBUG: Log bildetype
_debug_images: checkpoint.images ? {
  count: checkpoint.images.length,
  types: checkpoint.images.map(img => typeof img),
  firstImageStructure: checkpoint.images[0]
} : 'No images'
            };
            
            data.avvik.push(avvikData);
            
            console.log(`🚨 Found avvik ${avvikData.id}:`, {
              system: systemNumber,
              checkpoint: checkpoint.name,
              hasImages: avvikData.images.length > 0
            });
          }
        });
      }
    });
  }
  
  console.log(`✅ Extracted ${data.avvik.length} total avvik`);
}

// HJELPEMETODE: Forbedret kundenavn-ekstraksjons
extractCustomerName(data) {
  console.log('🔍 DEBUG All available customer data:', {
    customer_name: data.customer_name,
    company_name: data.company_name,
    customer_data: data.customer_data,
    available_customer_fields: Object.keys(data).filter(key => 
      key.toLowerCase().includes('customer') || 
      key.toLowerCase().includes('company') ||
      key.toLowerCase().includes('name')
    )
  });

  const customerName = data.customer_name || 
                      data.company_name ||
                      data.customer_data?.name || 
                      data.customer_data?.company_name ||
                      data.customerName ||
                      data.name ||
                      'Kunde ikke funnet';

  console.log('✅ Resolved customer name:', customerName);
  return customerName;
}

  getReportTheme(equipmentType) {
    const themes = {
      'boligventilasjon': {
        title: 'SERVICERAPPORT BOLIGVENTILASJON',
        table: {
          equipmentOverviewHeadings: ['Systemtype', 'Systemnummer', 'Plassering', 'Betjener'],
          checklistHeadings: ['Sjekkpunkt', 'Status', 'Merknad / Resultat']
        },
        show: { equipmentOverview: true, checklistResults: true, avvik: true, summary: true },
        cssMods: { rowDensity: 'compact', tableHeaderWeight: '600', headerUppercase: true }
      },
      'ventilasjon': {
        title: 'SERVICERAPPORT VENTILASJON',
        table: {
          equipmentOverviewHeadings: ['Systemtype', 'Systemnummer', 'Plassering', 'Betjener'],
          checklistHeadings: ['Sjekkpunkt', 'Status', 'Merknad / Resultat']
        },
        show: { equipmentOverview: true, checklistResults: true, avvik: true, summary: true },
        cssMods: { rowDensity: 'normal', tableHeaderWeight: '600', headerUppercase: true }
      },
      'vifter': {
        title: 'SERVICERAPPORT VIFTER',
        table: {
          equipmentOverviewHeadings: ['Viftetype', 'Systemnummer', 'Plassering', 'Betjener'],
          checklistHeadings: ['Sjekkpunkt', 'Status', 'Merknad / Resultat']
        },
        show: { equipmentOverview: true, checklistResults: true, avvik: true, summary: true },
        cssMods: { rowDensity: 'normal', tableHeaderWeight: '600', headerUppercase: true }
      },
      'custom': {
        title: 'SERVICERAPPORT (TILPASSET)',
        table: {
          equipmentOverviewHeadings: ['Systemtype', 'Systemnummer', 'Plassering', 'Betjener'],
          checklistHeadings: ['Sjekkpunkt', 'Status', 'Merknad / Resultat']
        },
        show: { equipmentOverview: false, checklistResults: false, avvik: false, summary: true },
        cssMods: { rowDensity: 'normal', tableHeaderWeight: '600', headerUppercase: true }
      }
    };

    return themes[equipmentType] || themes['ventilasjon'];
  }

  renderEquipmentOverviewTable(data, theme) {
    if (!data.all_equipment || data.all_equipment.length === 0) {
      return '';
    }

    const headings = theme.table.equipmentOverviewHeadings;
    
    return `
    <section class="section equipment-overview">
        <h2 class="section-header">Oversikt over kontrollerte systemer</h2>
        <table class="styled-table">
            <thead>
                <tr>
                    <th style="width: 25%">${headings[0]}</th>
                    <th style="width: 20%">${headings[1]}</th>
                    <th style="width: 35%">${headings[2]}</th>
                    <th style="width: 20%">${headings[3]}</th>
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
  `;
  }

// HJELPEMETODE: Rendrer avvikstabell (ERSTATTER gamle avvik-seksjoner)
renderAvvikTable(data) {
  if (!data.avvik || data.avvik.length === 0) {
    return '';
  }

  return `
    <section class="avvik-section">
        <h2 class="section-header avvik-header">Registrerte avvik</h2>
        
        <table class="styled-table avvik-table">
            <thead>
                <tr>
                    <th style="width: 12%">Avvik ID</th>
                    <th style="width: 18%">Systemnummer</th>
                    <th style="width: 25%">Komponent</th>
                    <th style="width: 45%">Kommentar/Tiltak</th>
                </tr>
            </thead>
            <tbody>
                ${data.avvik.map(avvik => `
                    <tr>
                        <td><strong>${avvik.avvik_id}</strong></td>
                        <td>${avvik.systemnummer}</td>
                        <td>${avvik.komponent}</td>
                        <td>${avvik.kommentar}</td>
                    </tr>
                    ${avvik.images && avvik.images.length > 0 ? `
                    <tr class="avvik-images-row">
                        <td colspan="4">
                            <div class="avvik-images">
                                <strong>Avviksbilder:</strong>
                                <div class="images-grid">
                                    ${avvik.images.map((image, index) => `
                                        <img src="${typeof image === 'object' ? image.url : image}" alt="Avviksbilde ${index + 1}" class="avvik-image">
                                    `).join('')}
                                </div>
                            </div>
                        </td>
                    </tr>
                    ` : ''}
                `).join('')}
            </tbody>
        </table>
    </section>
  `;
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

  generateComponentChecklist(component, theme) {
  if (!component.checkpoints || component.checkpoints.length === 0) {
    return '';
  }

  const headers = theme?.table?.checklistHeadings || ['Sjekkpunkt', 'Status', 'Merknad / Resultat'];

  return `
    <div class="component-checklist page-break-avoid" style="break-inside: avoid;">
        <div class="component-name">${component.name || 'Ukjent komponent'}</div>
        <table class="styled-table">
            <thead>
                <tr>
                    <th style="width: 45%">${headers[0]}</th>
                    <th style="width: 15%; text-align: center">${headers[1]}</th>
                    <th style="width: 40%">${headers[2]}</th>
                </tr>
            </thead>
            <tbody>
                ${component.checkpoints.map(checkpoint => {
                  let statusText = '';
                  let statusClass = 'status-na';
                  
                  switch(checkpoint.status) {
                    case 'ok':
                      statusText = 'OK';
                      statusClass = 'status-ok';
                      break;
                    case 'byttet':
                      statusText = 'BYTTET';
                      statusClass = 'status-byttet';
                      break;
                    case 'avvik':
                      statusText = 'AVVIK';
                      statusClass = 'status-avvik';
                      break;
                    default:
                      statusText = 'Ikke relevant';
                      statusClass = 'status-na';
                  }

                  const comment = checkpoint.comment || '';
                  const hasImages = checkpoint.images && checkpoint.images.length > 0;

                  return `
                    <tr>
                        <td>${checkpoint.name}</td>
                        <td class="center">
                            <span class="status ${statusClass}">${statusText}</span>
                        </td>
                        <td>${comment}</td>
                    </tr>
                    ${hasImages ? `
                    <tr class="image-row">
                        <td colspan="3">
                            <div class="checklist-images">
                                ${checkpoint.images.map((img, index) => `
                                    <img src="${typeof img === 'object' ? img.url : img}" alt="${img.description || `Bilde ${index + 1}`}" class="checklist-image" />
                                `).join('')}
                            </div>
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

  async generateHTML(data, settings) {
    // KRITISK FIX: Forbedret kundenavn-ekstraksjons
    const customerName = this.extractCustomerName(data);

    // KRITISK FIX: Prosesser data først for å bygge equipment overview
    data = await this.processAirTechData(data);

    // Logoet kommer allerede fra loadCompanySettings() eller lignende
    // Sjekk først settings.logoBase64, deretter settings.logo_base64
    const logoBase64 = settings?.logoBase64 || settings?.logo_base64 || null;
    const theme = this.getReportTheme(data.equipment_type);
    const equipmentTypeClass = (data.equipment_type || 'generic').toLowerCase();
    
    const reportDate = new Date(data.created_at).toLocaleDateString('nb-NO');
    const technician = data.technician_name || 'Ukjent tekniker';
    const companyName = settings?.companyName || 'Air-Tech AS';
  
    return `
    <!DOCTYPE html>
    <html lang="no">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${theme.title} ${data.id}</title>
        <style>
            ${this.getAirTechCSS(theme)}
        </style>
    </head>
    <body class="type-${equipmentTypeClass}">
        <div class="pdf-container">
            <header class="header-section">
                <div class="header-content">
                    <div class="header-left">
                        <h1 class="main-title">Servicerapport: ${customerName}</h1>
                    </div>
                    <div class="header-right">
                        ${logoBase64 ? 
                          `<img src="${logoBase64}" alt="Air-Tech AS" class="company-logo">` :
                          `<div class="logo-placeholder">Air-Tech AS</div>`
                        }
                    </div>
                </div>
                <div class="header-divider"></div>
            </header>
            <section class="customer-info-table">
                <table class="info-table">
                    <tr>
                        <td class="info-label">Avtalenummer:</td>
                        <td class="info-value"></td>
                        <td class="info-label">Besøk nr:</td>
                        <td class="info-value"></td>
                        <td class="info-label">Årstall</td>
                        <td class="info-value">${new Date(data.created_at).getFullYear()}</td>
                    </tr>
                    <tr>
                        <td class="info-label">Kundenummer</td>
                        <td class="info-value">${data.customer_data?.id || data.customer_id || ''}</td>
                        <td class="info-label">Kundenavn</td>
                        <td class="info-value">${data.customer_name || data.customer_data?.name || ''}</td>
                        <td class="info-label">Mottaker av rapport</td>
                        <td class="info-value">${data.customer_data?.contactPerson || data.contact_person || ''}</td>
                    </tr>
                    <tr>
                        <td class="info-label">Byggnavn</td>
                        <td class="info-value">${data.equipment_location || data.location || data.equipment_name || ''}</td>
                        <td class="info-label">Adresse</td>
                        <td class="info-value">${data.customer_address || data.address || data.customer_data?.address || ''}</td>
                        <td class="info-label">Post nr.</td>
                        <td class="info-value">${data.customer_data?.postalCode || data.postal_code || ''}</td>
                    </tr>
                    <tr>
                        <td class="info-label">Rapport dato:</td>
                        <td class="info-value">${new Date(data.created_at).toLocaleDateString('nb-NO')}</td>
                        <td class="info-label">Utført av:</td>
                        <td class="info-value">${data.technician_name || ''}</td>
                        <td class="info-label">Vår kontaktperson</td>
                        <td class="info-value">${data.technician_name || ''}</td>
                    </tr>
                </table>
            </section>
            <section class="service-agreement-text">
                <p>Servicearbeidet som ble avtalt for de angitte anleggene er nå fullført i tråd med avtalen. I henhold til vår serviceavtale oversender vi en servicerapport etter fullført servicebesøk.</p>
            </section>
            <section class="equipment-overview">
                <h2 class="section-header">Anlegg- og systemoversikt</h2>
                <table class="styled-table">
                    <thead>
                        <tr>
                            <th style="width: 25%">Systemtype</th>
                            <th style="width: 25%">Systemnummer</th>
                            <th style="width: 25%">Plassering</th>
                            <th style="width: 25%">Betjener</th>
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
            
  
            <main>
                
                ${this.renderAvvikTable(data)}
  
                
  
                ${theme.show.checklistResults && data.checklist_data?.components?.length ? `
                <section class="section page-break-before page-break-avoid">
                    <h2 class="section-header">Resultat fra sjekklister</h2>
                    ${data.checklist_data.components.map(component => this.generateComponentChecklist(component, theme)).join('')}
                </section>
                ` : ''}
                
                ${theme.show.summary && (data.overall_comment || (data.photos && data.photos.length > 0)) ? this.generateSummarySection(data) : ''}
            </main>
  
            <footer class="footer-section">
    <div class="signature-section">
        <p>Med vennlig hilsen,</p>
        <p><strong>${companyName}</strong></p>
        <div class="signature-placeholder">
            <span>[Navn ansatt]</span>
            <span style="text-align: center;">[Stilling ansatt]</span>
            <span style="text-align: right;">[Dato]</span>
        </div>
    </div>
    
    <div class="page-footer">
        <div class="footer-content">
            <div class="footer-left">
                <p><strong>${companyName}</strong></p>
                <p>Stanseveien 18, 0975 Oslo</p>
                <p><a href="www.air-tech.no">www.air-tech.no</a></p>
            </div>
            <div class="footer-center">
                <p>Telefon: +47 91 52 40 40</p>
                <p>Epost: post@air-tech.no</p>
                <p>Org.nr: 889 558 652</p>
            </div>
            <div class="footer-right">
                <p>Side 4 av 4</p>
            </div>
        </div>
    </div>
</footer>
        </div>
    </body>
    </html>`;
  }

  getAirTechCSS(theme) {
    const density = theme?.cssMods?.rowDensity || 'normal';
    const cellPadding = density === 'compact' ? '8px 10px' : '10px 12px';
    
    return `
      @page { 
        size: A4; 
        margin: 14mm 16mm; 
      } 
      
      body {
        font-family: Arial, Helvetica, sans-serif;
        font-size: 10pt;
        line-height: 1.45;
        color: #222;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
        margin: 0;
        padding: 0;
      }
  
      :root {
        --brand-blue: #0B5FAE;        /* Hovedfarge */
        --brand-blue-2: #094E90;      /* Mørkere variant */
        --border-color: #D9E1EA;      /* Tabellborder */
        --row-alt: #F6F8FB;           /* Alternerende rader */
        --text-color: #222222;        /* Primær tekst */
        --muted-text: #555555;        /* Sekundær tekst */
        --status-ok: #28A745;         /* OK status */
        --status-byttet: #FD7E14;     /* Byttet status */
        --status-avvik: #DC3545;      /* Avvik status */
        --status-na: #6C757D;         /* Ikke relevant */
        --info-table-bg: #F8F9FA;     /* Grå bakgrunn for info-tabell */
        --info-table-border: #DEE2E6; /* Mørkere grå rammer */
      }
  
      .pdf-container { 
        max-width: 210mm; 
        margin: 0 auto; 
        background: white; 
      }
  
      /* HEADER - Hvit bakgrunn som ønsket */
      .header-section {
        background: white;
        color: var(--text-color);
        padding: 20px 22px 10px;
        margin-bottom: 20px;
      }
  
      .header-content {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
      }
  
      .header-left {
        flex: 1;
      }
  
      .main-title {
        font-size: 24pt;
        font-weight: 700;
        color: var(--brand-blue);
        margin: 0;
        font-family: Arial, Helvetica, sans-serif;
      }
  
      .header-right {
        display: flex;
        align-items: flex-start;
      }
  
      .company-logo {
        height: 80px;
        width: auto;
        max-width: 150px;
        object-fit: contain;
      }
  
      .logo-placeholder {
        height: 80px;
        width: 150px;
        background: var(--brand-blue);
        color: white;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 4px;
        font-weight: bold;
        font-size: 16px;
      }
  
      .header-divider {
        border-bottom: 2px solid var(--brand-blue);
        margin-top: 15px;
      }

      /* KUNDE INFO-TABELL */
        .customer-info-table {
        margin-bottom: 20px;
        }

        .info-table {
        width: 100%;
        border-collapse: collapse;
        background: var(--info-table-bg);
        border: 1px solid var(--info-table-border);
        }

        .info-table td {
        padding: 8px 12px;
        border: 1px solid var(--info-table-border);
        font-size: 10pt;
        font-family: Arial, Helvetica, sans-serif;
        }

        .info-label {
        font-weight: 700;
        color: var(--text-color);
        background: var(--info-table-bg);
        width: 16.66%; /* 6 kolonner */
        }

        .info-value {
        color: var(--text-color);
        background: var(--info-table-bg);
        width: 16.66%;
        }
  
      /* SEKSJONER */
      .section { margin-bottom: 18px; }
      .section-header {
        font-size: 14pt;
        font-weight: 700;
        color: var(--brand-blue);
        margin: 20px 0 10px 0;
        padding-bottom: 6px;
        border-bottom: 2px solid var(--brand-blue);
      }
  
      .avvik-header {
        color: var(--status-avvik) !important;
        border-bottom-color: var(--status-avvik) !important;
      }
  
      /* TABELLER */
      .styled-table {
        width: 100%;
        border-collapse: collapse;
        margin-bottom: 20px;
        border: 1px solid var(--border-color);
      }
  
      .styled-table th {
        background: var(--brand-blue);
        color: white;
        padding: 10px 12px;
        text-align: left;
        font-weight: 600;
        font-size: 11pt;
        border-bottom: 1px solid var(--border-color);
      }
  
      .styled-table td {
        padding: 10px 12px;
        border-bottom: 1px solid var(--border-color);
        font-size: 10pt;
      }
  
      .styled-table tbody tr:nth-child(even) {
        background: var(--row-alt);
      }
  
      /* KOMPONENT NAVN - Ren tekst som referanse */
      .component-name {
        font-size: 11.5pt;
        font-weight: 700;
        color: var(--brand-blue);
        margin: 10px 0 6px;
        /* INGEN bakgrunn eller border */
      }
  
      /* STATUS */
      .status { 
        font-size: 8pt; 
        font-weight: 700; 
        text-transform: uppercase; 
        letter-spacing: 0.2px; 
      }
      .status-ok { color: #28A745; }
      .status-byttet { color: #FD7E14; }
      .status-avvik { color: #DC3545; }
      .status-na { color: #6C757D; font-weight: 400; }
  
      /* AVVIK STYLING */
      .avvik-section {
          background: #fef2f2;
          padding: 20px;
          border-radius: 8px;
          border: 2px solid #fecaca;
          margin-bottom: 30px;
      }

      .avvik-header {
          color: #dc2626 !important;
          border-bottom-color: #dc2626 !important;
      }

      .avvik-notice {
          background: #fee2e2;
          padding: 12px;
          border-radius: 6px;
          margin-bottom: 20px;
          border-left: 4px solid #dc2626;
      }

      .avvik-item {
          background-color: white;
          border: 1px solid #fecaca;
          border-left: 4px solid #dc2626;
          padding: 15px;
          margin-bottom: 15px;
          border-radius: 6px;
      }

      .avvik-header-info {
          margin-bottom: 8px;
      }

      .avvik-id {
          font-weight: 700;
          color: #dc2626;
          font-size: 12px;
      }

      .component-info {
          font-size: 11px;
          color: #6b7280;
          margin-left: 10px;
      }

      .avvik-comment {
          font-size: 11pt;
          color: #1f2937;
          margin-bottom: 10px;
      }

      .avvik-images {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
          margin-top: 10px;
      }

      .avvik-image {
          width: 120px;
          height: 90px;
          object-fit: cover;
          border-radius: 4px;
          border: 1px solid #d1d5db;
      }

/* AVVIKSTABELL STYLING */
.avvik-table {
  border: 2px solid var(--status-avvik);
}

.avvik-table th {
  background: var(--status-avvik) !important;
  color: white;
  font-weight: 700;
}

.avvik-images-row td {
  background: #fef2f2;
  border-top: 1px dashed var(--status-avvik);
}

.avvik-images {
  padding: 10px 0;
}

.images-grid {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 8px;
}

.avvik-image {
  max-width: 120px;
  max-height: 80px;
  object-fit: cover;
  border: 1px solid #ddd;
  border-radius: 4px;
}
  
      /* SIDEBRUDD */
      .page-break-before { 
        page-break-before: always; 
        break-before: page; 
      }
      .page-break-avoid { 
        page-break-inside: avoid; 
        break-inside: avoid; 
      }
  
      /* FOOTER */
/* SIGNATUR OG FOOTER STYLING */
.signature-section {
  margin: 40px 0;
  page-break-inside: avoid;
}

.signature-placeholder {
  display: flex;
  justify-content: space-between;
  margin-top: 60px;
  padding-top: 20px;
  border-top: 1px solid #333;
  font-size: 12px;
  color: #666;
}

.page-footer {
  margin-top: 40px;
  padding: 20px 0;
  border-top: 2px solid var(--brand-blue);
  font-size: 10px;
}

.footer-content {
  display: flex;
  justify-content: space-between;
  width: 100%;
}

.footer-left,
.footer-center,
.footer-right {
  flex: 1;
}

.footer-right {
  text-align: right;
}

/* OPPDATER AVVIK CSS - HVIT BAKGRUNN */
.avvik-section {
  background: white !important;  /* Overstyr rosa bakgrunn */
  padding: 0 !important;         /* Fjern ekstra padding */
  border: none !important;       /* Fjern rosa grense */
  border-radius: 0 !important;   /* Fjern rundede hjørner */
  margin-bottom: 30px;
}


  
      .center { text-align: center; }

      .service-agreement-text {
        margin: 20px 0;
      }

      .service-agreement-text p {
        font-size: 11pt;
        line-height: 1.4;
        color: var(--text-color);
        font-family: Arial, Helvetica, sans-serif;
        margin: 0;
      }
  
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

  findVirkningsgradData(component, checkpointId) {
    // Søk i original checklist-data for virkningsgrad
    const originalData = component.originalChecklist || component.checklist;
    if (!originalData) return null;
    
    // Sjekk for virkn1, virkn2, etc.
    for (const [key, value] of Object.entries(originalData)) {
      if (key.startsWith('virkn') && typeof value === 'object' && value.virkningsgrad !== undefined) {
        return value;
      }
    }
    return null;
  }

  findTilstandData(component, checkpointId) {
    // Søk etter tilstand1, tilstand2, etc.
    const originalData = component.originalChecklist || component.checklist;
    if (!originalData) return null;
    
    for (const [key, value] of Object.entries(originalData)) {
      if (key.startsWith('tilstand') && typeof value === 'string') {
        return value;
      }
    }
    return null;
  }

  findKonsekvensData(component, checkpointId) {
    // Søk etter konsekvens1, konsekvens2, etc.  
    const originalData = component.originalChecklist || component.checklist;
    if (!originalData) return null;
    
    for (const [key, value] of Object.entries(originalData)) {
      if (key.startsWith('konsekvens') && typeof value === 'string') {
        return value;
      }
    }
    return null;
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}

module.exports = UnifiedPDFGenerator;