// src/services/unifiedPdfGenerator.js
// Unified PDF Generator for ServFix - Erstatter alle 3 gamle generatorer
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs').promises;
const db = require('../config/database');
const { Storage } = require('@google-cloud/storage');

class UnifiedPDFGenerator {
  constructor() {
    this.browser = null;
    
    // Google Cloud Storage setup
    this.storage = new Storage({
      projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
      keyFilename: process.env.GOOGLE_CLOUD_KEY_FILE,
    });
    this.bucket = this.storage.bucket(process.env.GCS_BUCKET_NAME || 'servfix-files');
  }

  // Initialize Puppeteer browser
  async init() {
    if (!this.browser) {
      const executablePath = process.env.PUPPETEER_SKIP_CHROMIUM_DOWNLOAD === 'true'
        ? (process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium')
        : undefined;

      this.browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--single-process',
          '--no-zygote'
        ],
        executablePath
      });
    }
  }

  // Main entry point for generating report
  async generateReport(serviceReportId, tenantId) {
    await this.init();

    try {
      console.log(`📄 Genererer PDF for rapport ${serviceReportId}...`);

      // Fetch all data with a single query
      const reportData = await this.fetchReportData(serviceReportId, tenantId);
      
      // Load company settings (logo, info)
      const companySettings = await this.loadCompanySettings(tenantId);
      
      // Generate HTML
      const html = await this.generateHTML(reportData, companySettings);
      
      // Create PDF
      const pdfBuffer = await this.generatePDF(html);
      
      // Save to GCS
      const pdfPath = await this.savePDF(pdfBuffer, reportData, tenantId);
      
      // Update database
      await this.updateReportPDFPath(serviceReportId, pdfPath, tenantId);
      
      console.log(`✅ PDF generert og lagret: ${pdfPath}`);
      return pdfPath;
      
    } catch (error) {
      console.error('❌ PDF-generering feilet:', error);
      throw error;
    }
  }

  // Fetch all report data with comprehensive JOINs - OPPDATERT MED RIKTIGE KOLONNENAVN
  async fetchReportData(serviceReportId, tenantId) {
    const pool = await db.getTenantConnection(tenantId);
    
    const query = `
      SELECT 
        sr.*,
        sr.checklist_data,
        sr.products_used,
        sr.additional_work,
        sr.photos,
        sr.checklist_data->>'overallComment' as general_comments,
        sr.order_id,
        sr.equipment_id,
        sr.created_at as service_date,
        o.customer_name,
        o.customer_id,
        o.customer_data,
        o.description as order_description,
        o.scheduled_date,
        e.name as equipment_name,
        e.type as equipment_type,
        e.location as equipment_location,
        e.data as equipment_data,
        t.name as technician_name,
        t.initials as technician_initials
      FROM service_reports sr
      LEFT JOIN orders o ON sr.order_id = o.id
      LEFT JOIN equipment e ON sr.equipment_id = e.id
      LEFT JOIN technicians t ON o.technician_id = t.id
      WHERE sr.id = $1
    `;
    
    const result = await pool.query(query, [serviceReportId]);
    
    if (!result.rows[0]) {
      throw new Error(`Service report ${serviceReportId} not found`);
    }
    
    const data = result.rows[0];
    
    // Parse customer_data hvis den finnes
    if (data.customer_data && typeof data.customer_data === 'object') {
      // customer_data er allerede et objekt fra JSONB
      data.customer_email = data.customer_data.email || data.customer_data.invoiceEmail || '';
      data.customer_phone = data.customer_data.phoneNumber || data.customer_data.phoneNumberMobile || '';
      data.contact_person = data.customer_data.contact || '';
      data.company_address = data.customer_data.physicalAddress || data.customer_data.postalAddress || data.customer_address || '';
      data.customer_number = data.customer_data.customerNumber || '';
    } else {
      // Fallback til eksisterende felter
      data.customer_email = '';
      data.customer_phone = '';
      data.contact_person = '';
      data.company_address = data.customer_address || '';
    }
    
    // Sett company-felter for bakoverkompatibilitet
    data.company_name = data.customer_name;
    data.company_email = data.customer_email;
    data.company_phone = data.customer_phone;
    
    // Parse checklist_data JSON if it exists
    if (data.checklist_data) {
      try {
        data.checklist_data = typeof data.checklist_data === 'string' 
          ? JSON.parse(data.checklist_data) 
          : data.checklist_data;
      } catch (error) {
        console.error('Failed to parse checklist_data:', error);
        data.checklist_data = {};
      }
    }
    
    // Parse products_used
    if (data.products_used) {
      try {
        data.products_used = typeof data.products_used === 'string' 
          ? JSON.parse(data.products_used) 
          : data.products_used;
      } catch (error) {
        console.error('Failed to parse products_used:', error);
        data.products_used = [];
      }
    }
    
    // Parse additional_work
    if (data.additional_work) {
      try {
        data.additional_work = typeof data.additional_work === 'string' 
          ? JSON.parse(data.additional_work) 
          : data.additional_work;
      } catch (error) {
        console.error('Failed to parse additional_work:', error);
        data.additional_work = [];
      }
    }
    
    // Kombiner data for rapport visning
    // Lag report_data struktur fra de separate kolonnene
    data.report_data = {
      components: data.checklist_data?.components || [],
      overallComment: data.checklist_data?.overallComment || data.general_comments || '',
      // Legg til produkter og arbeid til hver komponent hvis nødvendig
      checklists: []
    };
    
    // Konverter komponenter til sjekkliste-format for PDF-generering
    if (data.checklist_data?.components && Array.isArray(data.checklist_data.components)) {
      data.report_data.checklists = data.checklist_data.components.map(component => ({
        name: component.details?.name || 'Sjekkliste',
        items: Object.entries(component.checklist || {}).map(([key, value]) => ({
          name: key,
          status: value?.status || 'na',
          comment: value?.comment || ''
        }))
      }));
    }
    
    // Sett general_comments fra overallComment hvis ikke allerede satt
    if (!data.general_comments && data.checklist_data?.overallComment) {
      data.general_comments = data.checklist_data.overallComment;
    }
    
    // Fetch deviations (avvik) with images
    const avvikQuery = `
      SELECT 
        ai.id,
        ai.avvik_number,
        ai.description,
        ai.checklist_item_id,
        ai.image_url
      FROM avvik_images ai
      WHERE ai.service_report_id = $1
      ORDER BY ai.avvik_number
    `;
    
    const avvikResult = await pool.query(avvikQuery, [serviceReportId]);
    data.avvik = avvikResult.rows;
    
    return data;
  }

  // Load company settings from GCS
  async loadCompanySettings(tenantId) {
    try {
      const settingsPath = `tenants/${tenantId}/assets/settings.json`;
      const file = this.bucket.file(settingsPath);
      const [exists] = await file.exists();
      
      if (exists) {
        const [contents] = await file.download();
        const settings = JSON.parse(contents.toString());
        
        // Convert logo URL to base64 if exists
        if (settings.logo) {
          settings.logoBase64 = await this.getLogoAsBase64(settings.logo);
        }
        
        return settings;
      }
    } catch (error) {
      console.error('Error loading company settings:', error);
    }
    
    // Return default settings
    return {
      company: {
        name: 'Air-Tech AS',
        address: 'Adresse ikke oppgitt',
        phone: 'Telefon ikke oppgitt',
        email: 'post@air-tech.no',
        website: 'www.air-tech.no'
      }
    };
  }

  // Convert logo URL to base64 for embedding in PDF
  async getLogoAsBase64(logoUrl) {
    if (!this.bucket || !logoUrl) return null;
    
    try {
      // Extract file path from URL
      const urlParts = logoUrl.split('/');
      const filePath = urlParts.slice(4).join('/'); // Remove bucket URL prefix
      
      const file = this.bucket.file(filePath);
      const [buffer] = await file.download();
      
      // Determine MIME type
      const extension = path.extname(filePath).toLowerCase();
      const mimeTypes = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.svg': 'image/svg+xml'
      };
      const mimeType = mimeTypes[extension] || 'image/png';
      
      return `data:${mimeType};base64,${buffer.toString('base64')}`;
    } catch (error) {
      console.error('Feil ved konvertering av logo:', error);
      return null;
    }
  }

  // Generate complete HTML document
  async generateHTML(data, settings) {
    const css = this.getCSS();
    const html = `
<!DOCTYPE html>
<html lang="no">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Servicerapport ${data.order_id}</title>
    <style>${css}</style>
</head>
<body>
    <div class="container">
        ${this.generateHeader(data, settings)}
        ${this.generateOrderInfo(data)}
        ${this.generateDeviations(data)}
        ${this.generateChecklists(data)}
        ${this.generateGeneralComments(data)}
        ${this.generateFooter(data, settings)}
    </div>
</body>
</html>`;
    
    return html;
  }

  // CSS styles
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
        font-size: 10pt;
        line-height: 1.5;
        color: #1f2937;
        background: #ffffff;
      }
      
      .container {
        max-width: 210mm;
        margin: 0 auto;
        padding: 15mm;
      }
      
      /* Header Styles */
      .header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: 30px;
        padding-bottom: 20px;
        border-bottom: 2px solid #0066cc;
      }
      
      .company-info {
        flex: 1;
      }
      
      .logo {
        max-width: 150px;
        max-height: 60px;
        margin-bottom: 10px;
      }
      
      .company-details {
        font-size: 9pt;
        color: #4b5563;
      }
      
      .report-header {
        text-align: right;
      }
      
      .report-title {
        font-size: 20pt;
        font-weight: 700;
        color: #0066cc;
        margin-bottom: 5px;
      }
      
      /* Section Styles */
      .section {
        margin-bottom: 25px;
      }
      
      .section-title {
        font-size: 14pt;
        font-weight: 600;
        color: #0066cc;
        margin-bottom: 15px;
        padding-bottom: 5px;
        border-bottom: 1px solid #e5e7eb;
      }
      
      /* Info Grid */
      .info-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 15px;
        margin-bottom: 15px;
      }
      
      .info-item {
        display: flex;
        gap: 10px;
      }
      
      .info-item.full-width {
        grid-column: 1 / -1;
      }
      
      .label {
        font-weight: 600;
        color: #4b5563;
        min-width: 120px;
      }
      
      .value {
        color: #1f2937;
      }
      
      /* Checklist Styles */
      .checklist-container {
        margin-bottom: 20px;
      }
      
      .checklist-title {
        font-size: 12pt;
        font-weight: 600;
        color: #374151;
        margin-bottom: 10px;
      }
      
      .checklist-items {
        border: 1px solid #e5e7eb;
        border-radius: 4px;
      }
      
      .checklist-item {
        display: grid;
        grid-template-columns: 2fr 100px 3fr;
        padding: 8px 12px;
        border-bottom: 1px solid #e5e7eb;
      }
      
      .checklist-item:last-child {
        border-bottom: none;
      }
      
      .checklist-name {
        font-weight: 500;
      }
      
      .checklist-status {
        text-align: center;
        font-weight: 600;
        padding: 2px 8px;
        border-radius: 3px;
      }
      
      .status-ok {
        background: #d1fae5;
        color: #065f46;
      }
      
      .status-avvik {
        background: #fee2e2;
        color: #991b1b;
      }
      
      .status-byttet {
        background: #dbeafe;
        color: #1e40af;
      }
      
      .status-na {
        background: #f3f4f6;
        color: #6b7280;
      }
      
      .checklist-comment {
        color: #4b5563;
        font-style: italic;
      }
      
      /* Deviation Styles */
      .deviation-list {
        list-style: none;
        padding: 0;
      }
      
      .deviation-item {
        margin-bottom: 20px;
        padding: 15px;
        background: #fef2f2;
        border: 1px solid #fecaca;
        border-radius: 4px;
      }
      
      .deviation-header {
        display: flex;
        justify-content: space-between;
        margin-bottom: 10px;
      }
      
      .deviation-number {
        font-weight: 600;
        color: #991b1b;
      }
      
      .deviation-description {
        color: #1f2937;
        margin-bottom: 10px;
      }
      
      .deviation-image {
        max-width: 200px;
        max-height: 150px;
        margin-top: 10px;
        border: 1px solid #e5e7eb;
        border-radius: 4px;
      }
      
      /* Comments Box */
      .comments-box {
        background: #f9fafb;
        border: 1px solid #e5e7eb;
        border-radius: 4px;
        padding: 15px;
      }
      
      .comments-text {
        white-space: pre-wrap;
        color: #1f2937;
      }
      
      /* Footer Styles */
      .footer {
        margin-top: 40px;
        padding-top: 20px;
        border-top: 1px solid #e5e7eb;
      }
      
      .signature-section {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 40px;
        margin-bottom: 30px;
      }
      
      .signature-box {
        text-align: center;
      }
      
      .signature-label {
        font-weight: 600;
        color: #4b5563;
        margin-bottom: 40px;
      }
      
      .signature-line {
        border-bottom: 1px solid #4b5563;
        margin-bottom: 5px;
        height: 40px;
      }
      
      .signature-name {
        font-size: 9pt;
        color: #6b7280;
      }
      
      .footer-info {
        display: flex;
        justify-content: space-between;
        font-size: 9pt;
        color: #6b7280;
      }
      
      @media print {
        body { margin: 0; }
        .container { padding: 10mm; }
      }
    `;
  }

  // Generate header section
  generateHeader(data, settings) {
    const company = settings.company || {};
    const logoHtml = settings.logoBase64 
      ? `<img src="${settings.logoBase64}" alt="${company.name}" class="logo">`
      : '';

    return `
      <div class="header">
        <div class="company-info">
          ${logoHtml}
          <div class="company-details">
            <strong>${company.name || 'Air-Tech AS'}</strong><br>
            ${company.address || 'Adresse ikke oppgitt'}<br>
            Tlf: ${company.phone || 'Ikke oppgitt'}<br>
            E-post: ${company.email || 'post@air-tech.no'}<br>
            Web: ${company.website || 'www.air-tech.no'}
          </div>
        </div>
        <div class="report-header">
          <h1 class="report-title">Servicerapport</h1>
          <div>Rapportnr: ${data.order_id || 'Ikke angitt'}</div>
          <div>Dato: ${this.formatDate(data.service_date)}</div>
        </div>
      </div>
    `;
  }

  // Generate order info section
  generateOrderInfo(data) {
    return `
      <div class="section order-info">
        <h2 class="section-title">Ordreinformasjon</h2>
        <div class="info-grid">
          <div class="info-item">
            <span class="label">Ordrenummer:</span>
            <span class="value">${data.order_id || 'Ikke angitt'}</span>
          </div>
          <div class="info-item">
            <span class="label">Servicedato:</span>
            <span class="value">${this.formatDate(data.service_date)}</span>
          </div>
          <div class="info-item">
            <span class="label">Planlagt dato:</span>
            <span class="value">${this.formatDate(data.scheduled_date)}</span>
          </div>
        </div>
        
        <div class="info-grid">
          <div class="info-item">
            <span class="label">Kunde:</span>
            <span class="value">${data.customer_name || 'Ikke angitt'}</span>
          </div>
          ${data.customer_number ? `
          <div class="info-item">
            <span class="label">Kundenummer:</span>
            <span class="value">${data.customer_number}</span>
          </div>
          ` : ''}
          ${data.contact_person ? `
          <div class="info-item">
            <span class="label">Kontaktperson:</span>
            <span class="value">${data.contact_person}</span>
          </div>
          ` : ''}
        </div>
        
        ${data.company_address ? `
        <div class="info-grid">
          <div class="info-item full-width">
            <span class="label">Adresse:</span>
            <span class="value">${data.company_address}</span>
          </div>
        </div>
        ` : ''}
        
        ${(data.company_phone || data.company_email) ? `
        <div class="info-grid">
          ${data.company_phone ? `
          <div class="info-item">
            <span class="label">Telefon:</span>
            <span class="value">${data.company_phone}</span>
          </div>
          ` : ''}
          ${data.company_email ? `
          <div class="info-item">
            <span class="label">E-post:</span>
            <span class="value">${data.company_email}</span>
          </div>
          ` : ''}
        </div>
        ` : ''}
        
        <div class="info-grid equipment-section">
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
        
        <div class="info-grid">
          <div class="info-item">
            <span class="label">Tekniker:</span>
            <span class="value">${data.technician_name || 'Ikke angitt'} ${data.technician_initials ? `(${data.technician_initials})` : ''}</span>
          </div>
        </div>
      </div>
    `;
  }

  // Generate deviations section
  generateDeviations(data) {
    if (!data.avvik || data.avvik.length === 0) {
      return '';
    }

    const deviationItems = data.avvik.map((avvik, index) => {
      const avvikNumber = String(avvik.avvik_number).padStart(3, '0');
      const imageHtml = avvik.image_url 
        ? `<img src="${avvik.image_url}" alt="Avvik ${avvikNumber}" class="deviation-image">`
        : '';

      return `
        <li class="deviation-item">
          <div class="deviation-header">
            <span class="deviation-number">Avvik ${avvikNumber}</span>
          </div>
          <div class="deviation-description">${avvik.description || 'Ingen beskrivelse'}</div>
          ${imageHtml ? `<div class="deviation-images">${imageHtml}</div>` : ''}
        </li>
      `;
    }).join('');

    return `
      <div class="section">
        <h2 class="section-title">Avvik Oversikt (${data.avvik.length} stk)</h2>
        <ul class="deviation-list">
          ${deviationItems}
        </ul>
      </div>
    `;
  }

  // Generate checklists section
  generateChecklists(data) {
    if (!data.report_data || !data.report_data.checklists || data.report_data.checklists.length === 0) {
      return '';
    }

    const checklistsHtml = data.report_data.checklists.map(checklist => {
      const itemsHtml = checklist.items.map(item => {
        const statusClass = this.getStatusClass(item.status);
        const statusText = this.getStatusText(item.status);
        
        return `
          <div class="checklist-item">
            <div class="checklist-name">${item.name}</div>
            <div class="checklist-status ${statusClass}">${statusText}</div>
            <div class="checklist-comment">${item.comment || ''}</div>
          </div>
        `;
      }).join('');

      return `
        <div class="checklist-container">
          <h3 class="checklist-title">${checklist.name || 'Sjekkliste'}</h3>
          <div class="checklist-items">
            ${itemsHtml}
          </div>
        </div>
      `;
    }).join('');

    return `
      <div class="section">
        <h2 class="section-title">Sjekklister</h2>
        ${checklistsHtml}
      </div>
    `;
  }

  // Generate general comments section
  generateGeneralComments(data) {
    const comments = data.general_comments || data.report_data?.overallComment || '';
    
    if (!comments) {
      return '';
    }

    return `
      <div class="section">
        <h2 class="section-title">Generelle Kommentarer</h2>
        <div class="comments-box">
          <div class="comments-text">${comments}</div>
        </div>
      </div>
    `;
  }

  // Generate footer section
  generateFooter(data, settings) {
    const company = settings.company || {};
    
    return `
      <div class="footer">
        <div class="signature-section">
          <div class="signature-box">
            <div class="signature-label">Tekniker</div>
            <div class="signature-line"></div>
            <div class="signature-name">${data.technician_name || 'Ikke angitt'} ${data.technician_initials ? `(${data.technician_initials})` : ''}</div>
          </div>
          <div class="signature-box">
            <div class="signature-label">Kunde</div>
            <div class="signature-line"></div>
            <div class="signature-name">${data.customer_name || data.contact_person || 'Ikke angitt'}</div>
          </div>
        </div>
        
        <div class="footer-info">
          <div>Generert: ${this.formatDate(new Date())}</div>
          <div>${company.name || 'Air-Tech AS'} | ${company.website || 'www.air-tech.no'}</div>
          <div>Side 1 av 1</div>
        </div>
      </div>
    `;
  }

  // Convert HTML to PDF using Puppeteer
  async generatePDF(html) {
    const page = await this.browser.newPage();
    
    await page.setContent(html, {
      waitUntil: 'networkidle0',
      timeout: 30000
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
      preferCSSPageSize: false
    });
    
    await page.close();
    return pdfBuffer;
  }

  // Save PDF to Google Cloud Storage
  async savePDF(pdfBuffer, data, tenantId) {
    const year = new Date().getFullYear();
    const month = String(new Date().getMonth() + 1).padStart(2, '0');
    
    // Lag filnavn
    const timestamp = new Date().toISOString().slice(0, 16).replace(/[:-]/g, '');
    const filename = `${data.order_id}_${data.equipment_id}_${data.equipment_type}_${timestamp}.pdf`;
    
    // GCS path
    const gcsPath = `tenants/${tenantId}/reports/${year}/${month}/${filename}`;
    
    try {
      // Last opp til GCS
      const file = this.bucket.file(gcsPath);
      
      await file.save(pdfBuffer, {
        metadata: {
          contentType: 'application/pdf',
        },
        resumable: false,
      });
      
      console.log(`✅ PDF uploaded to GCS: ${gcsPath}`);
      
      // Returner relativ path for database lagring
      return `reports/${year}/${month}/${filename}`;
      
    } catch (error) {
      console.error('❌ Failed to upload PDF to GCS:', error);
      
      // Fallback: Lagre lokalt hvis GCS feiler
      const localDir = path.join(
        __dirname, 
        `../../servfix-files/tenants/${tenantId}/reports`,
        String(year),
        month
      );
      
      await fs.mkdir(localDir, { recursive: true });
      const localPath = path.join(localDir, filename);
      await fs.writeFile(localPath, pdfBuffer);
      
      console.log(`⚠️ PDF saved locally as fallback: ${localPath}`);
      return `reports/${year}/${month}/${filename}`;
    }
  }

  // Update database with PDF path
  async updateReportPDFPath(serviceReportId, pdfPath, tenantId) {
    const pool = await db.getTenantConnection(tenantId);
    
    await pool.query(
      'UPDATE service_reports SET pdf_path = $1, pdf_generated = true WHERE id = $2',
      [pdfPath, serviceReportId]
    );
  }

  // Utility methods
  formatDate(date) {
    if (!date) return 'Ikke angitt';
    const d = new Date(date);
    return d.toLocaleDateString('no-NO', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  }

  getStatusClass(status) {
    const statusMap = {
      'ok': 'status-ok',
      'avvik': 'status-avvik',
      'byttet': 'status-byttet',
      'n/a': 'status-na',
      'na': 'status-na'
    };
    return statusMap[status?.toLowerCase()] || 'status-na';
  }

  getStatusText(status) {
    const statusMap = {
      'ok': 'OK',
      'avvik': 'Avvik',
      'byttet': 'Byttet',
      'n/a': 'N/A',
      'na': 'N/A'
    };
    return statusMap[status?.toLowerCase()] || status || 'N/A';
  }

  // Cleanup
  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}

module.exports = UnifiedPDFGenerator;