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

  // === HJELPEMETODER ===
  safeJsonParse(jsonString, defaultValue = null) {
    try {
      if (!jsonString) return defaultValue;
      if (typeof jsonString === 'object') return jsonString; // Allerede parsed
      return JSON.parse(jsonString);
    } catch (error) {
      console.warn('JSON parse error:', error.message);
      return defaultValue;
    }
  }

/**
 * Normaliserer checklist_data til enhetlig format
 * Støtter både gammelt format (components array) og nytt format (flat struktur)
 */
normalizeChecklistStructure(checklist_data) {
  console.log('🔄 Normalizing checklist structure...');
  
  // Hvis allerede i components-format, returner som den er
  if (checklist_data?.components?.length) {
    console.log('✅ Already in components format');
    return checklist_data;
  }
  
  // Hvis flat format (nytt), konverter til components
  if (checklist_data?.checklist) {
    console.log('🔄 Converting from flat format to components');
    return {
      components: [{
        details: checklist_data.systemFields || checklist_data.details || {},
        checklist: checklist_data.checklist,
        metadata: checklist_data.metadata || {}
      }],
      overallComment: checklist_data.overallComment || ''
    };
  }
  
  console.warn('⚠️ Empty or invalid checklist_data');
  return { components: [], overallComment: '' };
}

  escapeHtml(unsafe) {
    if (unsafe === null || unsafe === undefined) return '';
    return unsafe
      .toString()
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  async close() {
    if (this.browser) {
      try {
        await this.browser.close();
        console.log('✅ Puppeteer browser closed.');
      } catch (error) {
        console.error('❌ Error closing Puppeteer browser:', error);
      } finally {
        this.browser = null;
      }
    }
  }

  // === KONFIGURASJON ===
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
        'ventilasjonsaggregat': {
            title: 'SERVICERAPPORT VENTILASJONSAGGREGAT',
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
        }
    };

    return themes[equipmentType] || themes['ventilasjon'];
}

  extractCustomerName(data) {
    return data.customer_name || 
           data.company_name || 
           data.customer_data?.name ||
           data.customer_data?.customer_name ||
           'Ukjent kunde';
  }

  // === FIRMA-INNSTILLINGER FRA JSON ===
  async loadCompanySettings(tenantId) {
    console.log(`🔧 Loading company settings from JSON for tenant: ${tenantId}`);
    
    try {
      if (!this.bucket) {
        console.log('ℹ️ No GCS bucket, using defaults');
        return {
          companyInfo: { name: 'Air-Tech AS' },
          logo_base64: null
        };
      }

      // Last innstillinger fra JSON-fil
      const settingsPath = `tenants/${tenantId}/assets/settings.json`;
      const file = this.bucket.file(settingsPath);
      const [exists] = await file.exists();
      
      let settings = {};
      if (exists) {
        const [contents] = await file.download();
        settings = JSON.parse(contents.toString());
        console.log('✅ Settings loaded from GCS JSON file');
      } else {
        console.log('ℹ️ No settings file found, using defaults');
      }
      
      // Last logo hvis det finnes
      let logoBase64 = null;
      if (settings.logo && settings.logo.url) {
        try {
          const bucketName = process.env.GCS_BUCKET_NAME || 'servfix-files';
          const logoPath = settings.logo.url.replace(`https://storage.googleapis.com/${bucketName}/`, '');
          const logoFile = this.bucket.file(logoPath);
          const [logoExists] = await logoFile.exists();
          
          if (logoExists) {
            const [logoBuffer] = await logoFile.download();
            const logoExtension = logoPath.split('.').pop().toLowerCase();
            const mimeType = logoExtension === 'png' ? 'image/png' : 'image/jpeg';
            logoBase64 = `data:${mimeType};base64,${logoBuffer.toString('base64')}`;
            console.log('✅ Logo loaded successfully');
          }
        } catch (logoError) {
          console.warn('⚠️ Could not load logo:', logoError.message);
        }
      }
      
      return {
        companyInfo: settings.companyInfo || { name: 'Air-Tech AS' },
        quoteSettings: settings.quoteSettings || {},
        logoBase64: logoBase64
      };
      
    } catch (error) {
      console.warn('⚠️ Could not load company settings:', error.message);
      return {
        companyInfo: { name: 'Air-Tech AS' },
        quoteSettings: {},
        logoBase64: null
      };
    }
  }

  // === DATA-PROSESSERING ===
  async processAirTechData(data) {
    console.log('🔧 Starting Air-Tech data processing...');
    
    this.buildEquipmentOverview(data);
    const processedChecklist = await this.processChecklistData(data, data.checklist_data); // LEGG TIL AWAIT!
    
    data.equipmentSections = processedChecklist.equipmentSections;
    data.avvik = processedChecklist.avvik;
    
    console.log('✅ Air-Tech data processing complete');
    return data;
  }

  buildEquipmentOverview(data) {
    if (!data.checklist_data || !data.checklist_data.components) {
        data.all_equipment = [{
            type: data.equipment_type || 'Ukjent type',
            system_number: 'N/A',
            location: data.equipment_location || 'Ikke spesifisert',
            betjener: 'Ikke spesifisert'
        }];
        return;
    }

    // Hent fra checklist_data components
    data.all_equipment = data.checklist_data.components.map(component => ({
        type: data.equipment_type || component.type || 'System',
        system_number: component.systemnummer || component.system_number || component.name || 'N/A',
        location: component.plassering || component.location || data.equipment_location || 'Ikke spesifisert',
        betjener: component.betjener || component.operator || 'Ikke spesifisert'
    }));
}

  async fetchChecklistTemplate(tenantId, equipmentType) {
    try {
        console.log(`🔍 Looking up template for equipment_type: ${equipmentType}`);
        const pool = await db.getTenantConnection(tenantId);
        const result = await pool.query(
            'SELECT template_data FROM checklist_templates WHERE equipment_type = $1 LIMIT 1',
            [equipmentType]
        );
        
        console.log(`📋 Query result: ${result.rows.length} rows found`);
        
        if (result.rows.length > 0) {
            const templateData = this.safeJsonParse(result.rows[0].template_data, {});
            console.log('📋 Template found with', templateData.checklistItems?.length || 0, 'items');
            return templateData;
        }
        
        console.log('⚠️ No template found for', equipmentType);
        return { checklistItems: [] };
    } catch (error) {
        console.error('❌ fetchChecklistTemplate ERROR:', error.message);
        return { checklistItems: [] };
    }
}

/**
 * Henter avvik-ID fra data, med fallback
 */
getAvvikId(itemData, fallbackIndex) {
  // Prøv flere mulige felt-navn
  const id = itemData.avvik_id ?? 
             itemData.avviknr ?? 
             itemData.avvikNr ?? 
             itemData.id;
  
  // Hvis ID finnes, returner den
  if (id !== undefined && id !== null) {
    return id;
  }
  
  // Fallback: bruk index + 1
  return fallbackIndex + 1;
}

/**
 * Sjekker om et item har faktisk data som skal vises
 */
itemHasData(item) {
  // Sjekk om value finnes og ikke er tom
  const hasValue = item.value !== null && 
                   item.value !== undefined && 
                   item.value !== '';
  
  // Sjekk om kommentar finnes
  const hasComment = item.comment && 
                     typeof item.comment === 'string' && 
                     item.comment.trim() !== '';
  
  // Sjekk om bilder finnes
  const hasImages = item.images && 
                    Array.isArray(item.images) && 
                    item.images.length > 0;
  
  return hasValue || hasComment || hasImages;
}

  async processChecklistData(data, checklistData) {
    console.log('🔍 DEBUG checklist_data:', JSON.stringify(checklistData, null, 2));
    console.log('🔍 DEBUG equipment_type:', data.equipment_type);
    
    try {
        // HENT TEMPLATE for navn-mapping
        const template = await this.fetchChecklistTemplate('airtech', data.equipment_type);
        console.log('📋 Template found:', !!template, 'with', template.checklistItems?.length || 0, 'items');
        
        // BYGG ROBUST lookup-map som takler ALLE items
        const nameLookup = {};
        if (template.checklistItems) {
            template.checklistItems.forEach(item => {
                nameLookup[item.id] = item.label || item.name || `Sjekkpunkt ${item.id}`;
            });
        }
        
        console.log('📋 Name lookup created:', Object.keys(nameLookup).length, 'mappings');
        
        const result = { equipmentSections: [], avvik: [] };
        
        if (!checklistData?.components) {
            console.log('⚠️ No checklist components found');
            return result;
        }
        
        checklistData.components.forEach((component, idx) => {
            if (!component.checklist) return;
            
            const details = component.details || {};
            const sectionName = `${details.etasje || '1'} - ${details.leilighet_nr || '1'} - ${details.aggregat_type || 'Aggregat'} - ${details.system_nummer || 'System'}`;
            
            const checkpoints = [];
            
            // ROBUST: Iterer gjennom ALLE faktiske items i data - ikke template
            Object.entries(component.checklist).forEach(([itemId, itemData]) => {
                // FALLBACK: Hvis template ikke har dette item, lag beskrivende navn
                const actualName = nameLookup[itemId] || 
                                 this.generateFallbackName(itemId) || 
                                 `Sjekkpunkt ${itemId}`;
                
                const checkpoint = {
                    item_id: itemId,
                    name: actualName,
                    status: (itemData.status || 'ok').toUpperCase(),
                    comment: itemData.avvikComment || itemData.byttetComment || itemData.comment || '',
                    images: []
                };
                
                checkpoints.push(checkpoint);
                
                // Legg til avvik
                if (itemData.status === 'avvik') {
                  result.avvik.push({
                    item_id: itemId,
                    avvik_id: this.getAvvikId(itemData, result.avvik.length), // NYTT!
                    systemnummer: data.equipment_serial || details.system_nummer || sectionName,
                    equipment_name: data.equipment_name,
                    komponent: actualName,
                    kommentar: itemData.avvikComment || itemData.comment || 'Ingen beskrivelse',
                    images: [] // Fylles senere
                  });
                }
            });
            
            // FILTER: Kun checkpoints med data
            const filteredCheckpoints = checkpoints.filter(cp => this.itemHasData(cp));

            if (filteredCheckpoints.length > 0) {
                result.equipmentSections.push({
                    name: sectionName,
                    checkpoints: filteredCheckpoints // ENDRET fra checkpoints
                });
            }
        });
        
        console.log('✅ Processed', result.equipmentSections.length, 'sections with', result.avvik.length, 'avvik');
        return result;
        
    } catch (error) {
        console.error('❌ processChecklistData ERROR:', error.message);
        console.error('❌ Stack:', error.stack);
        
        // FALLBACK: Returner basic struktur
        return { equipmentSections: [], avvik: [] };
    }
}

  generateFallbackName(itemId) {
    // Generer beskrivende navn basert på itemId mønster
    const patterns = {
        'item': 'Sjekkpunkt',
        'temp': 'Temperatur',
        'virkn': 'Virkningsgrad', 
        'tilstand': 'Tilstandsgrad',
        'konsekvens': 'Konsekvensgrad'
    };
    
    for (const [pattern, name] of Object.entries(patterns)) {
        if (itemId.startsWith(pattern)) {
            const number = itemId.replace(pattern, '');
            return `${name} ${number}`;
        }
    }
    
    return `Ukjent punkt ${itemId}`;
}

  // === RENDERING METODER ===
  renderEquipmentOverviewTable(data, theme) {
  const systems = data.systemsFirstPage || data.all_equipment || [];
  
  if (systems.length === 0) {
    return '';
  }
  
  const headings = theme.table.equipmentOverviewHeadings;
  const rows = systems.map(equip => `
    <tr>
      <td>${this.escapeHtml(equip.type || '')}</td>
      <td>${this.escapeHtml(equip.system_number || '')}</td>
      <td>${this.escapeHtml(equip.location || '')}</td>
      <td>${this.escapeHtml(equip.betjener || '')}</td>
    </tr>
  `).join('');

  const moreSystemsNote = data.systemsAppendix && data.systemsAppendix.length > 0
    ? `<p class="muted-note">+ ${data.systemsAppendix.length} flere anlegg – se neste side.</p>`
    : '';

  return `
    <section class="equipment-overview">
      <h2>Systemoversikt</h2>
      <table class="overview-table">
        <thead>
          <tr>
            ${headings.map(h => `<th>${this.escapeHtml(h)}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
      ${moreSystemsNote}
    </section>
  `;
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

  async fetchReportData(reportId, tenantId) {
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
        e.systemnavn as equipment_name, e.systemtype as equipment_type, e.location as equipment_location,
        e.systemnummer as equipment_serial,
        t.name as technician_name, t.initials as technician_initials
      FROM service_reports sr
      LEFT JOIN orders o ON sr.order_id = o.id
      LEFT JOIN equipment e ON sr.equipment_id = e.id
      LEFT JOIN technicians t ON o.technician_id = t.id
      WHERE sr.id = $1
    `;
    const result = await pool.query(query, [reportId]);
    if (result.rows.length === 0) throw new Error('Service report not found');
    
    const data = result.rows[0];
    
    // Parse JSON fields safely
    data.checklist_data = this.safeJsonParse(data.checklist_data, {});

    // Normaliser checklist_data struktur
    data.checklist_data = this.normalizeChecklistStructure(data.checklist_data);
    console.log('📊 Normalized checklist structure:', {
      componentCount: data.checklist_data.components?.length || 0,
      hasOverallComment: !!data.checklist_data.overallComment
    });

    data.equipment_data = this.safeJsonParse(data.equipment_data, {});
    data.products_used = this.safeJsonParse(data.products_used, []);
    data.additional_work = this.safeJsonParse(data.additional_work, []);
    data.photos = data.photos || [];
    data.tenant_id = tenantId;

    const customerData = this.safeJsonParse(data.customer_data, {});
    data.contact_person = data.contact_person || customerData?.contact_person || '';

    // **NYTT: Hent avvik-bilder fra avvik_images tabellen**
    const avvikImagesQuery = `
        SELECT 
            ai.id,
            ai.service_report_id,
            ai.avvik_number,
            ai.checklist_item_id,
            ai.image_url,
            ai.metadata,
            ai.uploaded_at
        FROM avvik_images ai
        WHERE ai.service_report_id = $1
        ORDER BY ai.avvik_number ASC, ai.uploaded_at ASC
    `;
    
    const avvikImagesResult = await pool.query(avvikImagesQuery, [reportId]);
    const avvikImages = avvikImagesResult.rows;
    
    console.log(`📸 Found ${avvikImages.length} avvik images for report ${reportId}`);

    // **ALTERNATIV: Hent bilder fra checklist_data JSON**
    const checklistDataImages = this.extractImagesFromChecklistData(data.checklist_data);
    console.log(`📸 Found ${checklistDataImages.length} images in checklist_data`);

    // **Kombiner alle bilde-kilder**
    const allChecklistImages = [...checklistDataImages];

    // For bakoverkompatibilitet, treat checklist_data images som checklist_images
    const checklistImages = allChecklistImages;
    
    // **Legg til bilder i data-objektet**
    data.avvik_images = avvikImages;
    data.checklist_images = checklistImages;
    
    // **Group avvik images by checklist_item_id for lettere tilgang**
    data.avvik_images_by_item = {};
    avvikImages.forEach(img => {
        if (img.checklist_item_id) {
            if (!data.avvik_images_by_item[img.checklist_item_id]) {
                data.avvik_images_by_item[img.checklist_item_id] = [];
            }
            data.avvik_images_by_item[img.checklist_item_id].push(img);
        }
    });
    
    // **Group checklist images by checklist_item_id**
    data.checklist_images_by_item = {};
    checklistImages.forEach(img => {
        if (img.checklist_item_id) {
            if (!data.checklist_images_by_item[img.checklist_item_id]) {
                data.checklist_images_by_item[img.checklist_item_id] = [];
            }
            data.checklist_images_by_item[img.checklist_item_id].push(img);
        }
    });
    
    console.log('✅ Report data fetched with images:', {
        hasAvvikImages: avvikImages.length > 0,
        hasChecklistImages: checklistImages.length > 0,
        avvikItemsWithImages: Object.keys(data.avvik_images_by_item).length,
        checklistItemsWithImages: Object.keys(data.checklist_images_by_item).length
    });

    return data;
  }

  async generateHTML(data, settings) {
    console.log('🎨 Generating HTML for PDF...');
    
    const customerName = this.extractCustomerName(data);

    // LEGG TIL OMFATTENDE DEBUG LOGGING:
    console.log('🔍 DEBUG - Data before processing:', {
      hasChecklistData: !!data.checklist_data,
      checklistDataKeys: data.checklist_data ? Object.keys(data.checklist_data) : [],
      hasComponents: !!data.checklist_data?.components,
      componentCount: data.checklist_data?.components?.length || 0,
      hasOverallComment: !!data.overall_comment,
      overallCommentLength: data.overall_comment?.length || 0,
      equipmentType: data.equipment_type,
      reportId: data.id
    });

    data = await this.processAirTechData(data);

    console.log('🔍 DEBUG - Data after processing:', {
      equipmentSectionsCount: data.equipmentSections?.length || 0,
      avvikCount: data.avvik?.length || 0,
      totalCheckpoints: data.equipmentSections?.reduce((sum, s) => sum + (s.checkpoints?.length || 0), 0) || 0,
      firstSectionName: data.equipmentSections?.[0]?.name,
      firstAvvikId: data.avvik?.[0]?.avvik_id
    });

// === DATA PREPARATION ===
console.log('📋 Preparing data for PDF rendering...');

// 1) Auto-splitt systemoversikt
const MAX_SYSTEMS_ON_PAGE_1 = 7;
data.systemsFirstPage = (data.all_equipment || []).slice(0, MAX_SYSTEMS_ON_PAGE_1);
data.systemsAppendix = (data.all_equipment || []).slice(MAX_SYSTEMS_ON_PAGE_1);

console.log(`  Systems on page 1: ${data.systemsFirstPage.length}`);
console.log(`  Systems in appendix: ${data.systemsAppendix.length}`);

// 2) Begrens bilder på side 1
const MAX_IMAGES_ON_PAGE_1 = 4;
const allPhotos = data.photos || [];
data.documentation_photos = allPhotos.slice(0, MAX_IMAGES_ON_PAGE_1);
data.moreDocumentationPhotos = allPhotos.slice(MAX_IMAGES_ON_PAGE_1);

console.log(`  Photos on page 1: ${data.documentation_photos.length}`);
console.log(`  Photos in appendix: ${data.moreDocumentationPhotos.length}`);

// 3) Injiser bilder fra maps
const byItemAvvik = data.avvik_images_by_item || {};
const byItemChk = data.checklist_images_by_item || {};

console.log(`  Avvik images map: ${Object.keys(byItemAvvik).length} keys`);
console.log(`  Checklist images map: ${Object.keys(byItemChk).length} keys`);

// 3a) Bilder på checkpoints
let checkpointImagesCount = 0;
(data.equipmentSections || []).forEach(section => {
  (section.checkpoints || []).forEach(cp => {
    if (!cp.item_id) return;
    
    const imgs = [
      ...(byItemChk[cp.item_id] || []),
      ...(byItemAvvik[cp.item_id] || [])
    ];
    
    if (imgs.length > 0) {
      cp.images = imgs.map(x => ({
        url: x.image_url || x.url,
        description: x.caption || x.metadata?.description || ''
      }));
      checkpointImagesCount += cp.images.length;
    }
  });
});

console.log(`  ✅ Injected ${checkpointImagesCount} images to checkpoints`);

// 3b) Bilder på avvik
let avvikImagesCount = 0;
(data.avvik || []).forEach(a => {
  if (!a.item_id) return;
  
  const imgs = [
    ...(byItemAvvik[a.item_id] || []),
    ...(byItemChk[a.item_id] || [])
  ];
  
  if (imgs.length > 0) {
    a.images = imgs.map(x => ({
      url: x.image_url || x.url,
      description: x.caption || x.metadata?.description || ''
    }));
    avvikImagesCount += a.images.length;
  }
});

console.log(`  ✅ Injected ${avvikImagesCount} images to avvik`);
console.log('✅ Data preparation complete\n');

    const logoBase64 = settings?.logoBase64 || null;
    const theme = this.getReportTheme(data.equipment_type);
    const equipmentTypeClass = (data.equipment_type || 'generic').toLowerCase();
    
    const technician = data.technician_name || 'Ukjent tekniker';
    const companyName = settings?.companyInfo?.name || 'Air-Tech AS';
  
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
                        <h1 class="main-title">${theme.title}</h1>
                        <p class="report-id">Rapport-ID: SR-${data.id}</p>
                    </div>
                    <div class="header-right">
                    </div>
                </div>
                <div class="header-divider"></div>
            </header>
            
            <!-- Logo for alle sider -->
            ${logoBase64 ? `<img src="${logoBase64}" alt="Air-Tech AS" class="page-logo-fixed">` : ''}
            
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
                        <td class="info-value">${customerName}</td>
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
                        <td class="info-value">${technician}</td>
                        <td class="info-label">Vår kontaktperson</td>
                        <td class="info-value">${technician}</td>
                    </tr>
                </table>
            </section>
            
            <section class="service-agreement-text">
                <p>Servicearbeidet som ble avtalt for de angitte anleggene er nå fullført i tråd med avtalen. I henhold til vår serviceavtale oversender vi en servicerapport etter fullført servicebesøk.</p>
            </section>

            <!-- SIDE 1: OVERSIKT -->
            ${this.renderEquipmentOverviewTable(data, theme)}
            ${this.renderAvvikTable(data)}
            ${this.generateSummarySection(data)}
            
            <!-- APPENDIX: Flere anlegg hvis >7 -->
            ${data.systemsAppendix && data.systemsAppendix.length > 0 ? `
              <div class="page-break"></div>
              <section class="section">
                <h2 class="section-header">Systemoversikt (fortsettelse)</h2>
                <table class="overview-table">
                  <thead>
                    <tr>
                      ${theme.table.equipmentOverviewHeadings.map(h => `<th>${this.escapeHtml(h)}</th>`).join('')}
                    </tr>
                  </thead>
                  <tbody>
                    ${data.systemsAppendix.map(equip => `
                      <tr>
                        <td>${this.escapeHtml(equip.type || '')}</td>
                        <td>${this.escapeHtml(equip.system_number || '')}</td>
                        <td>${this.escapeHtml(equip.location || '')}</td>
                        <td>${this.escapeHtml(equip.betjener || '')}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </section>
            ` : ''}
            
            <!-- NY SIDE: DETALJERTE SJEKKLISTER -->
            <div class="page-break"></div>
            <section class="section">
              <h2 class="section-header">Detaljerte sjekkpunkter og resultater</h2>
              ${this.renderChecklistResults(data, theme)}
            </section>
            
            <!-- APPENDIX: Flere bilder hvis >4 -->
            ${data.moreDocumentationPhotos && data.moreDocumentationPhotos.length > 0 ? `
              <section class="section">
                <h2 class="section-header">Dokumentasjonsbilder (fortsettelse)</h2>
                <div class="photos-grid">
                  ${data.moreDocumentationPhotos.map(photo => `
                    <div class="photo-container">
                      <img src="${photo.url}" alt="${this.escapeHtml(photo.caption || 'Dokumentasjonsbilde')}" class="photo">
                      ${photo.caption ? `<span class="photo-caption">${this.escapeHtml(photo.caption)}</span>` : ''}
                    </div>
                  `).join('')}
                </div>
              </section>
            ` : ''}
            
            <div class="page-footer">
                <div class="footer-content">
                    <div class="footer-left">
                        <strong>Air-Tech AS</strong><br>
                        Stanseveien 18, 0975 Oslo<br>
                        www.air-tech.no
                    </div>
                    <div class="footer-center">
                        Telefon: +47 91 52 40 40<br>
                        Epost: post@air-tech.no<br>
                        Org.nr: 889 558 652
                    </div>
                    <div class="footer-right">
                        Side 1 av 1
                    </div>
                </div>
            </div>
        </div>
    </body>
    </html>`;
  }

renderAvvikTable(data) {
  if (!data.avvik || data.avvik.length === 0) {
    console.log('ℹ️ No avvik to render');
    return '';
  }
  
  console.log(`📋 Rendering ${data.avvik.length} avvik with images`);
  
  const rows = data.avvik.map(avvik => {
    // Vis avvik-ID med padding
    const avvikIdFormatted = String(avvik.avvik_id || 1).padStart(3, '0');
    
    // Bilderad - VIS KUN hvis bilder finnes
    const imgRow = (avvik.images && avvik.images.length > 0)
      ? `
        <tr class="avvik-images-row">
          <td colspan="5">
            <div class="avvik-images">
              <strong>Bilder for AVVIK ${avvikIdFormatted}:</strong>
              <div class="images-grid">
                ${avvik.images.map(img => `
                  <img class="avvik-image" 
                       src="${img.url}" 
                       alt="${this.escapeHtml(img.description || img.caption || 'Avvikbilde')}" />
                `).join('')}
              </div>
            </div>
          </td>
        </tr>`
      : '';

    return `
      <tr class="avvik-row">
        <td class="avvik-id">AVVIK ${avvikIdFormatted}</td>
        <td><strong>${this.escapeHtml(avvik.equipment_name || 'N/A')}</strong></td>
        <td>${this.escapeHtml(avvik.systemnummer || 'N/A')}</td>
        <td>${this.escapeHtml(avvik.komponent)}</td>
        <td>${this.escapeHtml(avvik.kommentar)}</td>
      </tr>
      ${imgRow}
    `;
  }).join('');

  return `
    <section class="avvik-section">
      <h2 class="section-header avvik-header">🚨 Registrerte avvik</h2>
      <p class="avvik-warning">VIKTIG: Følgende avvik ble registrert under servicen og krever oppmerksomhet:</p>
      <table class="avvik-table styled-table">
        <thead>
          <tr class="avvik-header-row">
            <th>Avvik ID</th>
            <th>Anlegg</th>
            <th>Systemnummer</th>
            <th>Komponent</th>
            <th>Kommentar/Tiltak</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </section>
  `;
}

    renderChecklistResults(data, theme) {
        if (!data.equipmentSections || data.equipmentSections.length === 0) {
            return '';
        }

        const checklistHtml = data.equipmentSections.map(section => {
            const sectionHeader = section.name ? `<h3 class="section-header">${this.escapeHtml(section.name)}</h3>` : '';
            
            const checkpointsHtml = section.checkpoints.map(checkpoint => {
                const statusClass = `status-${checkpoint.status.toLowerCase()}`;
                const imagesHtml = checkpoint.images && checkpoint.images.length > 0 ? `
                    <tr class="image-row">
                        <td colspan="3">
                            <div class="checklist-images">
                                ${checkpoint.images.map(img => `
                                    <div class="image-container">
                                        <img src="${img.url}" alt="${this.escapeHtml(img.description || 'Bilde')}" class="checklist-image">
                                        ${img.description ? `<span class="image-caption">${this.escapeHtml(img.description)}</span>` : ''}
                                    </div>
                                `).join('')}
                            </div>
                        </td>
                    </tr>
                ` : '';

                return `
                    <tr>
                        <td>${this.escapeHtml(checkpoint.name)}</td>
                        <td class="status-cell ${statusClass}">${this.escapeHtml(checkpoint.status)}</td>
                        <td>${this.escapeHtml(checkpoint.comment)}</td>
                    </tr>
                    ${imagesHtml}
                `;
            }).join('');

            return `
                <div class="section">
                    ${sectionHeader}
                    <table class="styled-table">
                        <thead>
                            <tr>
                                ${theme.table.checklistHeadings.map(h => `<th>${this.escapeHtml(h)}</th>`).join('')}
                            </tr>
                        </thead>
                        <tbody>
                            ${checkpointsHtml}
                        </tbody>
                    </table>
                </div>
            `;
        }).join('');

        return `
            <section class="section">
                <h2 class="section-header">Sjekkpunkter og resultater</h2>
                ${checklistHtml}
            </section>
        `;
    }

    generateSummarySection(data) {
        const productsUsedHtml = data.products_used && data.products_used.length > 0 ? `
            <h3>Produkter brukt:</h3>
            <ul>
                ${data.products_used.map(product => `<li>${this.escapeHtml(product.name || '')} (${this.escapeHtml(product.quantity || '')})</li>`).join('')}
            </ul>
        ` : '';

        const additionalWorkHtml = data.additional_work && data.additional_work.length > 0 ? `
            <h3>Utførte tilleggsarbeider:</h3>
            <ul>
                ${data.additional_work.map(work => `<li>${this.escapeHtml(work.description || '')}</li>`).join('')}
            </ul>
        ` : '';

        const overallCommentHtml = data.overall_comment ? `
            <h3>Generell kommentar:</h3>
            <p>${this.escapeHtml(data.overall_comment)}</p>
        ` : '';

        const signatureHtml = data.signature_data?.signatureImage || data.signature_data?.name ? `
            <div class="signature-section">
                <h3>Signatur:</h3>
                ${data.signature_data.signatureImage ? `<img src="${data.signature_data.signatureImage}" alt="Signatur" style="max-width: 200px; max-height: 100px; display: block; margin-bottom: 10px;">` : ''}
                <p>Signert av: ${this.escapeHtml(data.signature_data.name || 'Ukjent')}</p>
                <p>Dato: ${new Date(data.signature_data.timestamp).toLocaleDateString('nb-NO')}</p>
            </div>
        ` : '';

        const photosHtml = data.documentation_photos && data.documentation_photos.length > 0 ? `
  <div class="documentation-photos">
    <h3>Dokumentasjonsbilder:</h3>
    <div class="photos-grid">
      ${data.documentation_photos.map(photo => `
        <div class="photo-container">
          <img src="${photo.url}" alt="${this.escapeHtml(photo.caption || 'Dokumentasjonsbilde')}" class="photo">
          ${photo.caption ? `<span class="photo-caption">${this.escapeHtml(photo.caption)}</span>` : ''}
        </div>
      `).join('')}
    </div>
    ${data.moreDocumentationPhotos && data.moreDocumentationPhotos.length > 0 
      ? `<p class="muted-note">+ ${data.moreDocumentationPhotos.length} flere bilder – se appendix.</p>` 
      : ''}
  </div>
` : '';

        // TEKNIKER-SIGNATUR - automatisk utfylling
        const technicianSignatureHtml = `
            <div class="signature-placeholder">
                <div class="signature-left">
                    <span>Tekniker: ${this.escapeHtml(data.technician_name || 'Ukjent tekniker')}</span>
                    <span>Stilling: Servicetekniker</span>
                    <span>Dato: ${new Date(data.completed_at || data.created_at).toLocaleDateString('nb-NO')}</span>
                </div>
                <div style="margin-top: 40px; border-top: 1px solid #333; width: 200px;">
                    <small>Underskrift</small>
                </div>
            </div>
        `;

        if (!productsUsedHtml && !additionalWorkHtml && !overallCommentHtml && !signatureHtml && !photosHtml) {
            return technicianSignatureHtml; // Vis i det minste tekniker-signatur
        }

        return `
            <section class="section">
                <h2 class="section-header">Oppsummering og utførte arbeider</h2>
                ${overallCommentHtml}
                ${productsUsedHtml}
                ${additionalWorkHtml}
                ${photosHtml}
                ${signatureHtml}
                ${technicianSignatureHtml}
            </section>
        `;
    }

  getAirTechCSS(theme) {
    const rowPadding = theme.cssMods?.rowDensity === 'compact' ? '8px 10px' : '10px 12px';
    
    return `
        /* AVVIK TABELL - ROSA/RØD */
.avvik-section {
    margin: 25px 0;
    background-color: #fdf2f8;
    border: 2px solid #f472b6;
    border-radius: 8px;
    padding: 15px;
}

.avvik-header-row th {
    background-color: #dc2626 !important;
    color: white !important;
    font-weight: 700;
}

.avvik-table {
    background-color: #fef7f7;
}

/* SYSTEMOVERSIKT TABELL - BLÅ */
.equipment-overview h2 {
    color: var(--brand-blue);
    font-size: 14pt;
    font-weight: 700;
    margin-bottom: 10px;
    border-bottom: 2px solid var(--brand-blue);
    padding-bottom: 5px;
}

.overview-table thead th {
    background-color: var(--brand-blue) !important;
    color: white !important;
    font-weight: 700;
}

.overview-table {
    border: 2px solid var(--brand-blue);
}
/* LOGO FIXED PÅ ALLE SIDER */
.page-logo-fixed {
    position: fixed;
    top: 5mm;
    right: 15mm;
    width: 80px;
    height: auto;
    max-height: 50px;
    object-fit: contain;
    z-index: 1000;
}

@page { 
    size: A4;
    margin: 25mm 15mm 20mm 15mm;
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
            --brand-blue: #0B5FAE;
            --brand-blue-2: #094E90;
            --border-color: #D9E1EA;
            --row-alt: #F6F8FB;
            --text-color: #222222;
            --muted-text: #555555;
            --status-ok: #28A745;
            --status-byttet: #FD7E14;
            --status-avvik: #DC3545;
            --status-na: #6C757D;
            --info-table-bg: #F8F9FA;
            --info-table-border: #DEE2E6;
        }
    
        .pdf-container { 
            max-width: 210mm; 
            margin: 0 auto; 
            background: white; 
        }
    
        /* HEADER - Logo til høyre */
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
            width: 100%;
        }
    
        .header-left {
            flex: 1;
            padding-right: 20px;
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
            flex-shrink: 0;
            margin-left: auto;
        }
    
        .company-logo {
            height: 80px;
            width: auto;
            max-width: 150px;
            object-fit: contain;
            display: block;
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
            width: 16.66%;
        }

        .info-value {
            color: var(--text-color);
            background: var(--info-table-bg);
            width: 16.66%;
        }
    
        /* SERVICEAVTALE TEKST */
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
    
        /* SEKSJONER */
        .section { 
            margin-bottom: 18px; 
        }
        
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
            padding: ${rowPadding};
            border-bottom: 1px solid var(--border-color);
            font-size: 10pt;
        }
    
        .styled-table tbody tr:nth-child(even) {
            background: var(--row-alt);
        }

        /* AVVIK TABELL - ROSA STYLING */
.avvik-section {
    margin: 25px 0;
    background-color: #fef2f2;
    border: 2px solid #fca5a5;
    border-radius: 8px;
    padding: 15px;
}

.avvik-table-header th {
    background-color: #f87171 !important;
    color: white !important;
}

.avvik-row:nth-child(even) td {
    background-color: #fef7f7 !important;
}

        /* STATUS STYLING */
        .status-cell {
            text-align: center;
            font-weight: 600;
        }

        .status-ok { color: var(--status-ok); }
        .status-byttet { color: var(--status-byttet); }
        .status-avvik { 
            color: var(--status-avvik) !important;
            background: #fef2f2 !important;
        }
        .status-na { color: var(--status-na); }

        /* PAGE BREAK */
        .page-break {
          page-break-before: always;
          break-before: page;
          height: 0;
          margin: 0;
          padding: 0;
        }

        .detailed-checklists {
          margin-top: 20px;
        }

        /* AVVIK BILDER */
        .avvik-images-row {
          background: #fef2f2 !important;
          border-top: 2px dashed #fca5a5 !important;
        }

        .avvik-images {
          padding: 12px;
        }

        .avvik-images strong {
          color: var(--status-avvik);
          font-size: 11pt;
          margin-bottom: 10px;
          display: block;
        }

        .images-grid {
          display: flex;
          gap: 12px;
          flex-wrap: wrap;
          margin-top: 10px;
        }

        .avvik-image {
          max-width: 180px;
          max-height: 120px;
          object-fit: cover;
          border: 2px solid #fee2e2;
          border-radius: 6px;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }

        /* CHECKLIST BILDER */
        .image-row {
            background: #f8fafc !important;
            border-top: 1px dashed #94a3b8 !important;
        }

        .checklist-images {
            padding: 12px 0;
            display: flex;
            gap: 15px;
            flex-wrap: wrap;
        }

        .image-container {
            text-align: center;
            flex: 0 0 auto;
        }

        .checklist-image {
            max-width: 120px;
            max-height: 80px;
            object-fit: cover;
            border: 2px solid #e2e8f0;
            border-radius: 6px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            display: block;
            margin-bottom: 4px;
        }

        .image-caption {
            font-size: 9pt;
            color: #64748b;
            line-height: 1.2;
            max-width: 120px;
            word-wrap: break-word;
        }

        /* SIGNATUR */
        .signature-section {
            margin: 40px 0;
            page-break-inside: avoid;
        }

        .signature-section p {
            margin: 8px 0;
            font-size: 12pt;
            line-height: 1.4;
        }

        .signature-placeholder {
            margin-top: 60px;
            padding: 20px 0;
            page-break-inside: avoid;
        }

        .signature-left {
            text-align: left;
            line-height: 1.8;
            font-size: 11pt;
        }

        .signature-left span {
            display: block;
            font-weight: 500;
            margin-bottom: 5px;
        }

        /* FOOTER */
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

        /* GENERELLE BILDER */
        .documentation-photos {
            margin: 20px 0;
        }

        .photos-grid {
            display: flex;
            gap: 15px;
            flex-wrap: wrap;
            margin-top: 10px;
        }

        .photo-container {
            text-align: center;
        }

        .photo {
            max-width: 150px;
            max-height: 100px;
            object-fit: cover;
            border: 2px solid #e2e8f0;
            border-radius: 6px;
            margin-bottom: 4px;
        }

        .photo-caption {
            font-size: 9pt;
            color: #64748b;
        }

        /* PAGE BREAK */
        .page-break {
          page-break-before: always;
          break-before: page;
          height: 0;
          margin: 0;
          padding: 0;
        }

        /* MUTED NOTE */
        .muted-note {
          font-size: 10pt;
          color: #666;
          font-style: italic;
          margin-top: 8px;
          margin-bottom: 0;
        }

        /* AVVIK IMAGES */
        .avvik-images-row {
          background: #fef2f2 !important;
          border-top: 2px dashed #fca5a5 !important;
        }

        .avvik-images {
          padding: 12px;
        }

        .avvik-images strong {
          color: var(--status-avvik);
          font-size: 11pt;
          margin-bottom: 10px;
          display: block;
        }

        .images-grid {
          display: flex;
          gap: 12px;
          flex-wrap: wrap;
          margin-top: 10px;
        }

        .avvik-image {
          max-width: 180px;
          max-height: 120px;
          object-fit: cover;
          border: 2px solid #fee2e2;
          border-radius: 6px;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }

        /* SYSTEMS TABLE - BRED */
        .overview-table {
          width: 100%;
          table-layout: fixed;
        }

        .overview-table th:nth-child(1) { width: 28%; }
        .overview-table th:nth-child(2) { width: 22%; }
        .overview-table th:nth-child(3) { width: 28%; }
        .overview-table th:nth-child(4) { width: 22%; }

        /* EQUIPMENT SUMMARY (hvis mangler) */
        .equipment-summary {
          font-size: 12pt;
          color: #666;
          margin-top: 5px;
          margin-bottom: 3px;
          font-weight: 500;
        }
        
        /* RESPONSIVITET */
        @media print {
            .pdf-container { margin: 0; max-width: none; }
            .header-section { margin-bottom: 20px; }
            .section { page-break-inside: avoid; }
            .avvik-item { page-break-inside: avoid; }
        }
    `
  }

  // === PDF-HÅNDTERING ===
  async generatePDF(html) {
    if (!this.browser) {
      throw new Error('Browser not initialized');
    }

    let page = null;
    try {
      page = await this.browser.newPage();
      
      await page.setContent(html, { 
        waitUntil: 'networkidle2',
        timeout: 30000 
      });

      // Emulér print-media for konsistent CSS
      await page.emulateMediaType('print');

      // Vent litt for at alle bilder skal laste
      await new Promise(resolve => setTimeout(resolve, 3000));  // Øk til 3 sekunder

      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { 
          top: '20mm', 
          right: '15mm', 
          bottom: '20mm', 
          left: '15mm' 
        }
      });

      console.log(`✅ PDF generated: ${Math.round(pdfBuffer.length / 1024)}KB`);
      return pdfBuffer;

    } finally {
      if (page) {
        await page.close();
      }
    }
  }

  async savePDF(pdfBuffer, reportData, tenantId) {
    const timestamp = Date.now();
    const orderId = reportData.order_id;
    const equipmentId = reportData.equipment_id;
    const year = new Date().getFullYear();
    const month = String(new Date().getMonth() + 1).padStart(2, '0');

    // Generer filnavn
    const fileName = `servicerapport_${reportData.id}_${timestamp}.pdf`;
    
    if (this.bucket) {
      // Google Cloud Storage
      const gcsPath = `tenants/${tenantId}/service-reports/${year}/${month}/${orderId}/${equipmentId}/${fileName}`;
      const relativePath = `service-reports/${year}/${month}/${orderId}/${equipmentId}/${fileName}`;
      
      try {
        const file = this.bucket.file(gcsPath);
        await file.save(pdfBuffer, {
          metadata: {
            contentType: 'application/pdf'
          }
        });
        
        console.log(`✅ PDF saved to GCS: ${gcsPath}`);
        return relativePath; // Return path WITHOUT tenants prefix
        
      } catch (error) {
        console.error('❌ Failed to save to GCS:', error.message);
        // Fallback til lokal lagring
      }
    }

    // Lokal lagring som fallback
    const fs = require('fs').promises;
    const path = require('path');
    
    const localDir = path.join(process.cwd(), 'servfix-files', 'tenants', tenantId, 'reports', year.toString(), month);
    await fs.mkdir(localDir, { recursive: true });
    
    const localPath = path.join(localDir, fileName);
    await fs.writeFile(localPath, pdfBuffer);
    
    const relativePath = `reports/${year}/${month}/${fileName}`;
    console.log(`✅ PDF saved locally: ${relativePath}`);
    return relativePath;
  }

  async updateReportPDFPath(reportId, pdfPath, tenantId) {
    const pool = await db.getTenantConnection(tenantId);
    await pool.query(
      'UPDATE service_reports SET pdf_path = $1, pdf_generated = true WHERE id = $2',
      [pdfPath, reportId]
    );
    console.log(`✅ Database updated: report ${reportId} -> ${pdfPath}`);
  }

  async debugSaveHTML(html, reportId) {
    if (process.env.NODE_ENV !== 'production') {
      try {
        const fs = require('fs').promises;
        const path = require('path');
        
        const debugDir = path.join(process.cwd(), 'test-output');
        await fs.mkdir(debugDir, { recursive: true });
        
        const debugPath = path.join(debugDir, `debug-report-${reportId}-${Date.now()}.html`);
        await fs.writeFile(debugPath, html, 'utf8');
        
        console.log(`🐛 Debug HTML saved: ${debugPath}`);
      } catch (error) {
        console.warn('⚠️ Could not save debug HTML:', error.message);
      }
    }
  }
extractImagesFromChecklistData(checklistData) {
    const extractedImages = [];
    
    if (!checklistData?.components) {
        return extractedImages;
    }
    
    checklistData.components.forEach((component, componentIndex) => {
        if (component.checklist) {
            Object.entries(component.checklist).forEach(([itemId, itemData]) => {
                // Sjekk etter bilder i itemData
                if (itemData.images && Array.isArray(itemData.images)) {
                    itemData.images.forEach(imageUrl => {
                        extractedImages.push({
                            checklist_item_id: itemId,
                            image_url: imageUrl,
                            image_type: itemData.status === 'AVVIK' ? 'avvik' : 'checklist',
                            component_index: componentIndex,
                            source: 'checklist_data'
                        });
                    });
                }
                
                // Sjekk etter bilder i comment (hvis they are stored as URLs)
                if (itemData.comment && typeof itemData.comment === 'string') {
                    const urlRegex = /https:\/\/storage\.googleapis\.com\/[^\s]+/g;
                    const urls = itemData.comment.match(urlRegex);
                    if (urls) {
                        urls.forEach(url => {
                            extractedImages.push({
                                checklist_item_id: itemId,
                                image_url: url,
                                image_type: itemData.status === 'AVVIK' ? 'avvik' : 'checklist',
                                component_index: componentIndex,
                                source: 'comment_urls'
                            });
                        });
                    }
                }
            });
        }
    });
    
    console.log(`📸 Extracted ${extractedImages.length} images from checklist_data`);
    return extractedImages;
}

} // END AV KLASSE

module.exports = UnifiedPDFGenerator;