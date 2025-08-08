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
    
    // SQL med KUN kolonner fra din databasestruktur
    const query = `
      SELECT 
        -- Fra service_reports (verifisert mot din struktur)
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
        
        -- Fra orders (verifisert mot din struktur)
        o.id as order_number,
        o.customer_name as company_name,
        o.description as order_description,
        o.scheduled_date as service_date,
        o.customer_data,
        
        -- Ekstraher fra customer_data JSON (dette er trygt)
        o.customer_data->>'email' as company_email,
        o.customer_data->>'phone' as company_phone,
        o.customer_data->>'address' as company_address,
        
        -- Fra equipment (verifisert mot din struktur)
        e.name as equipment_name,
        e.type as equipment_type,
        e.location as equipment_location,
        e.serial_number as equipment_serial,
        
        -- Fra technicians (verifisert mot din struktur)
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
      throw new Error(`Service report ${serviceReportId} not found`);
    }
    
    const data = result.rows[0];
    console.log('📊 Report data found:', {
      id: data.id,
      order: data.order_number,
      equipment: data.equipment_name,
      technician: data.technician_name
    });
    
    // Parse JSON fields
    if (data.checklist_data && typeof data.checklist_data === 'string') {
      data.checklist_data = JSON.parse(data.checklist_data);
    }
    if (data.products_used && typeof data.products_used === 'string') {
      data.products_used = JSON.parse(data.products_used);
    }
    if (data.additional_work && typeof data.additional_work === 'string') {
      data.additional_work = JSON.parse(data.additional_work);
    }
    if (data.customer_data && typeof data.customer_data === 'string') {
      data.customer_data = JSON.parse(data.customer_data);
    }
    
    // Håndter avvik basert på checklist_data
    data.avvik = [];
    if (data.checklist_data && data.checklist_data.components) {
      data.checklist_data.components.forEach(component => {
        if (component.checkpoints) {
          component.checkpoints.forEach(checkpoint => {
            if (checkpoint.status === 'avvik' && checkpoint.comment) {
              data.avvik.push({
                description: checkpoint.comment,
                checkpointName: checkpoint.name,
                componentName: component.name
              });
            }
          });
        }
      });
    }
    
    // Sett overall comment fra checklist_data
    data.overall_comment = data.checklist_data?.overallComment || '';
    
    return data;
  }

  async loadCompanySettings(tenantId) {
    const settings = {
      company: {
        name: 'Air-Tech AS',
        address: 'Industrigata 1, 2000 Lillestrøm',
        phone: '+47 123 45 678',
        email: 'post@air-tech.no'
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
        Object.assign(settings, savedSettings);
        console.log('✅ Company settings loaded from GCS');
      }
      
      // Last ned logo hvis den finnes
      if (settings.company?.logo) {
        settings.logoBase64 = await this.downloadLogo(settings.company.logo);
      }
      
    } catch (error) {
      console.error('Error loading company settings:', error);
    }
    
    return settings;
  }

  async downloadLogo(logoPath) {
    if (!this.bucket || !logoPath) return null;
    
    try {
      const file = this.bucket.file(logoPath);
      const [exists] = await file.exists();
      
      if (!exists) return null;
      
      const [buffer] = await file.download();
      const mimeType = logoPath.endsWith('.png') ? 'image/png' : 'image/jpeg';
      return `data:${mimeType};base64,${buffer.toString('base64')}`;
      
    } catch (error) {
      console.error('Error downloading logo:', error);
      return null;
    }
  }

  async generateHTML(data, settings) {
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
        ${this.generateAnleggOversikt(data)}
        ${this.generateAvvik(data)}
        ${this.generateSjekklister(data)}
        ${this.generateKommentarer(data)}
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
    
    return `
      <div class="header">
        <div class="company-section">
          ${logoHtml}
          <div class="company-name">${company.name || 'ServFix'}</div>
          <div class="company-details">
            ${company.address || ''}<br>
            Tlf: ${company.phone || ''}<br>
            ${company.email || ''}
          </div>
        </div>
        <div class="report-info">
          <div class="report-title">SERVICERAPPORT</div>
          <div class="report-number">Rapport: ${data.id}</div>
          <div class="report-date">Dato: ${new Date(data.service_date || data.created_at).toLocaleDateString('no-NO')}</div>
        </div>
      </div>
    `;
  }

  generateOrderInfo(data) {
    return `
      <div class="section order-info">
        <h2>Ordreinformasjon</h2>
        <div class="info-grid">
          <div class="info-item">
            <span class="label">Ordrenummer:</span>
            <span class="value">${data.order_number || 'Ikke angitt'}</span>
          </div>
          <div class="info-item">
            <span class="label">Servicedato:</span>
            <span class="value">${data.service_date ? new Date(data.service_date).toLocaleDateString('no-NO') : 'Ikke angitt'}</span>
          </div>
          <div class="info-item">
            <span class="label">Tekniker:</span>
            <span class="value">${data.technician_name || data.technician_initials || 'Ikke angitt'}</span>
          </div>
        </div>
      </div>
    `;
  }

  generateAnleggOversikt(data) {
    return `
      <div class="section">
        <h2>Anlegg og System</h2>
        <div class="info-grid">
          <div class="info-item">
            <span class="label">Kunde:</span>
            <span class="value">${data.company_name || 'Ikke angitt'}</span>
          </div>
          <div class="info-item">
            <span class="label">Adresse:</span>
            <span class="value">${data.company_address || 'Ikke angitt'}</span>
          </div>
          <div class="info-item">
            <span class="label">Anlegg:</span>
            <span class="value">${data.equipment_name || 'Ikke angitt'}</span>
          </div>
          <div class="info-item">
            <span class="label">Type:</span>
            <span class="value">${data.equipment_type || 'Ikke angitt'}</span>
          </div>
          <div class="info-item">
            <span class="label">Plassering:</span>
            <span class="value">${data.equipment_location || 'Ikke angitt'}</span>
          </div>
        </div>
      </div>
    `;
  }

  generateAvvik(data) {
    if (!data.avvik || data.avvik.length === 0) {
      return '';
    }
    
    return `
      <div class="section avvik-section">
        <h2 class="avvik-header">⚠️ Avvik (${data.avvik.length} stk)</h2>
        ${data.avvik.map((avvik, index) => `
          <div class="avvik-item">
            <div class="avvik-number">${String(index + 1).padStart(3, '0')}</div>
            <div class="avvik-content">
              <div class="avvik-description">${avvik.description || 'Ingen beskrivelse'}</div>
              ${avvik.checkpointName ? `<div class="avvik-checkpoint">Sjekkpunkt: ${avvik.checkpointName}</div>` : ''}
              ${avvik.componentName ? `<div class="avvik-checkpoint">Komponent: ${avvik.componentName}</div>` : ''}
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  generateSjekklister(data) {
    if (!data.checklist_data || !data.checklist_data.components || data.checklist_data.components.length === 0) {
      return '';
    }
    
    return `
      <div class="section">
        <h2>Sjekklister</h2>
        ${data.checklist_data.components.map(component => `
          <div class="checklist-component">
            <h3>${component.name || 'Ukjent komponent'}</h3>
            <table class="checklist-table">
              <thead>
                <tr>
                  <th>Sjekkpunkt</th>
                  <th>Status</th>
                  <th>Kommentar</th>
                </tr>
              </thead>
              <tbody>
                ${(component.checkpoints || []).map(cp => `
                  <tr>
                    <td>${cp.name || 'Ukjent sjekkpunkt'}</td>
                    <td>
                      ${this.getStatusBadge(cp.status)}
                    </td>
                    <td>${cp.comment || '-'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `).join('')}
      </div>
    `;
  }

  getStatusBadge(status) {
    const statusMap = {
      'ok': '<span class="status-ok">OK</span>',
      'avvik': '<span class="status-avvik">Avvik</span>',
      'byttet': '<span class="status-byttet">Byttet</span>',
      'na': '<span class="status-na">N/A</span>'
    };
    return statusMap[status] || '<span class="status-na">-</span>';
  }

  generateKommentarer(data) {
    if (!data.overall_comment) {
      return '';
    }
    
    return `
      <div class="section">
        <h2>Generelle kommentarer</h2>
        <div class="comment-box">
          <div class="comment-text">${data.overall_comment}</div>
        </div>
      </div>
    `;
  }

  generateFooter(data, settings) {
    const company = settings.company || {};
    const generatedDate = new Date().toLocaleDateString('no-NO', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    
    return `
      <div class="footer">
        <div class="signature-grid">
          <div class="signature-box">
            <span class="signature-label">Tekniker</span>
            <div class="signature-line"></div>
            <div class="signature-name">${data.technician_name || 'Ikke angitt'}</div>
          </div>
          <div class="signature-box">
            <span class="signature-label">Kunde</span>
            <div class="signature-line"></div>
            <div class="signature-name">${data.company_name || 'Ikke angitt'}</div>
          </div>
        </div>
        <div class="footer-info">
          <div>${company.name || 'Air-Tech AS'}</div>
          <div>Side 1 av 1</div>
          <div>${generatedDate}</div>
        </div>
      </div>
    `;
  }

  async generatePDF(html) {
    if (!this.browser) {
      throw new Error('Browser not initialized');
    }
    
    const page = await this.browser.newPage();
    
    try {
      await page.setContent(html, {
        waitUntil: 'networkidle0'
      });
      
      const pdfBuffer = await page.pdf({
        format: 'A4',
        margin: {
          top: '10mm',
          right: '10mm',
          bottom: '10mm',
          left: '10mm'
        },
        printBackground: true,
        preferCSSPageSize: true
      });
      
      return pdfBuffer;
    } finally {
      await page.close();
    }
  }

  async savePDF(pdfBuffer, data, tenantId) {
    const year = new Date().getFullYear();
    const month = String(new Date().getMonth() + 1).padStart(2, '0');
    const timestamp = new Date().toISOString().slice(0, 16).replace(/[:-]/g, '');
    const filename = `${data.order_number || data.id}_${data.equipment_id}_${timestamp}.pdf`;
    
    if (this.bucket) {
      // Save to Google Cloud Storage
      const filePath = `tenants/${tenantId}/reports/${year}/${month}/${filename}`;
      const file = this.bucket.file(filePath);
      
      console.log('📤 Uploading PDF to GCS:', filePath);
      await file.save(pdfBuffer, {
        metadata: {
          contentType: 'application/pdf'
        }
      });
      
      console.log('✅ PDF uploaded to GCS');
      return `reports/${year}/${month}/${filename}`;
      
    } else {
      // Save locally (fallback for local development)
      const dir = path.join(__dirname, '../../servfix-files/tenants', tenantId, 'reports', String(year), month);
      await fs.mkdir(dir, { recursive: true });
      
      const filePath = path.join(dir, filename);
      await fs.writeFile(filePath, pdfBuffer);
      
      console.log('💾 PDF saved locally:', filePath);
      return `reports/${year}/${month}/${filename}`;
    }
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

  getCSS() {
    return `
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
      
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }
      
      body {
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
        font-size: 11pt;
        line-height: 1.6;
        color: #1f2937;
        background: #ffffff;
      }
      
      .page-container {
        max-width: 210mm;
        margin: 0 auto;
        padding: 10mm;
      }
      
      /* Header med gradient */
      .header {
        background: linear-gradient(135deg, #0066cc 0%, #004499 100%);
        color: white;
        padding: 20px 30px;
        border-radius: 10px;
        margin-bottom: 30px;
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
      }
      
      .company-section {
        flex: 1;
      }
      
      .logo {
        max-width: 180px;
        max-height: 70px;
        margin-bottom: 10px;
        display: block;
      }
      
      .company-name {
        font-size: 24pt;
        font-weight: 700;
        margin-bottom: 5px;
      }
      
      .company-details {
        font-size: 10pt;
        opacity: 0.9;
        line-height: 1.4;
      }
      
      .report-info {
        text-align: right;
        min-width: 200px;
      }
      
      .report-title {
        font-size: 18pt;
        font-weight: 700;
        margin-bottom: 10px;
      }
      
      .report-number {
        font-size: 12pt;
        margin-bottom: 5px;
      }
      
      .report-date {
        font-size: 11pt;
        opacity: 0.9;
      }
      
      /* Sections */
      .section {
        margin-bottom: 30px;
        background: #f9fafb;
        padding: 20px;
        border-radius: 8px;
        border: 1px solid #e5e7eb;
      }
      
      .section h2 {
        font-size: 16pt;
        font-weight: 700;
        color: #1f2937;
        margin-bottom: 15px;
        padding-bottom: 10px;
        border-bottom: 2px solid #3b82f6;
      }
      
      .section h3 {
        font-size: 14pt;
        font-weight: 600;
        color: #374151;
        margin-top: 20px;
        margin-bottom: 10px;
      }
      
      /* Info grid */
      .info-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 15px;
      }
      
      .info-item {
        display: flex;
        gap: 10px;
      }
      
      .label {
        font-weight: 600;
        color: #6b7280;
        min-width: 120px;
      }
      
      .value {
        color: #111827;
      }
      
      /* Avvik section */
      .avvik-section {
        background: #fef2f2;
        border: 1px solid #fecaca;
      }
      
      .avvik-header {
        color: #dc2626;
        border-bottom-color: #dc2626;
      }
      
      .avvik-item {
        display: flex;
        gap: 15px;
        margin-bottom: 15px;
        padding: 15px;
        background: white;
        border-radius: 6px;
        border: 1px solid #fecaca;
      }
      
      .avvik-number {
        font-size: 18pt;
        font-weight: 700;
        color: #dc2626;
      }
      
      .avvik-content {
        flex: 1;
      }
      
      .avvik-description {
        font-weight: 500;
        margin-bottom: 5px;
      }
      
      .avvik-checkpoint {
        font-size: 10pt;
        color: #6b7280;
      }
      
      /* Checklist table */
      .checklist-component {
        margin-bottom: 25px;
      }
      
      .checklist-table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 10px;
      }
      
      .checklist-table th {
        background: #e5e7eb;
        padding: 10px;
        text-align: left;
        font-weight: 600;
        font-size: 10pt;
        color: #374151;
      }
      
      .checklist-table td {
        padding: 10px;
        border-bottom: 1px solid #e5e7eb;
        font-size: 10pt;
      }
      
      .checklist-table tr:last-child td {
        border-bottom: none;
      }
      
      /* Status badges */
      .status-ok {
        background: #d1fae5;
        color: #065f46;
        padding: 4px 12px;
        border-radius: 4px;
        font-weight: 600;
        display: inline-block;
      }
      
      .status-avvik {
        background: #fee2e2;
        color: #991b1b;
        padding: 4px 12px;
        border-radius: 4px;
        font-weight: 600;
        display: inline-block;
      }
      
      .status-byttet {
        background: #dbeafe;
        color: #1e40af;
        padding: 4px 12px;
        border-radius: 4px;
        font-weight: 600;
        display: inline-block;
      }
      
      .status-na {
        background: #f3f4f6;
        color: #6b7280;
        padding: 4px 12px;
        border-radius: 4px;
        font-weight: 600;
        display: inline-block;
      }
      
      /* Kommentar boks */
      .comment-box {
        background: #f0f9ff;
        border: 1px solid #bae6fd;
        border-radius: 8px;
        padding: 20px;
        margin-top: 20px;
      }
      
      .comment-text {
        white-space: pre-wrap;
        color: #0c4a6e;
      }
      
      /* Footer/Signatur */
      .footer {
        margin-top: 50px;
        padding-top: 30px;
        border-top: 2px solid #e5e7eb;
      }
      
      .signature-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 50px;
        margin-bottom: 30px;
      }
      
      .signature-box {
        text-align: center;
      }
      
      .signature-label {
        font-weight: 600;
        color: #4b5563;
        margin-bottom: 50px;
        display: block;
      }
      
      .signature-line {
        border-bottom: 2px solid #4b5563;
        margin-bottom: 10px;
        height: 40px;
      }
      
      .signature-name {
        font-size: 10pt;
        color: #6b7280;
      }
      
      .footer-info {
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 10pt;
        color: #6b7280;
        margin-top: 30px;
      }
      
      /* Utility classes */
      .text-center { text-align: center; }
      .text-right { text-align: right; }
      .font-bold { font-weight: 600; }
      
      @media print {
        body { margin: 0; }
        .page-container { padding: 5mm; }
        .header { break-inside: avoid; }
        .section { break-inside: avoid; }
        .table { break-inside: avoid; }
      }
    `;
  }
}

module.exports = UnifiedPDFGenerator;