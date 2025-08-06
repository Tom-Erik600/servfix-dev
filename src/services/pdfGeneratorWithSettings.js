// src/services/pdfGeneratorWithSettings.js - PDF Generator with logo and company info from JSON
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs').promises;
const db = require('../config/database');
const { Storage } = require('@google-cloud/storage');

class PDFGeneratorWithSettings {
  constructor() {
    this.browser = null;
    this.settingsCache = new Map(); // Cache settings per tenant
    this.storage = new Storage({
      projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
      keyFilename: process.env.GOOGLE_CLOUD_KEY_FILE,
    });
    this.bucket = this.storage.bucket(process.env.GCS_BUCKET_NAME || 'servfix-files');
  }

  async init() {
    if (!this.browser) {
      this.browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox', 
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu'
        ],
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium'
      });
    }
  }

  // Load settings from JSON file in bucket
  async loadTenantSettings(tenantId) {
    // Check cache first (valid for 5 minutes)
    const cached = this.settingsCache.get(tenantId);
    if (cached && (Date.now() - cached.timestamp) < 5 * 60 * 1000) {
      return cached.settings;
    }
    
    try {
      const settingsPath = `tenants/${tenantId}/assets/settings.json`;
      const file = this.bucket.file(settingsPath);
      const [exists] = await file.exists();
      
      let settings;
      if (exists) {
        const [contents] = await file.download();
        settings = JSON.parse(contents.toString());
        console.log(`📋 Settings loaded from GCS for ${tenantId}`);
      } else {
        settings = this.getDefaultSettings(tenantId);
        console.log(`📝 Using default settings for ${tenantId}`);
      }
      
      // Cache settings
      this.settingsCache.set(tenantId, {
        settings: settings,
        timestamp: Date.now()
      });
      
      return settings;
      
    } catch (error) {
      console.error(`Error loading settings for ${tenantId}:`, error);
      const defaultSettings = this.getDefaultSettings(tenantId);
      this.settingsCache.set(tenantId, {
        settings: defaultSettings,
        timestamp: Date.now()
      });
      return defaultSettings;
    }
  }

  getDefaultSettings(tenantId) {
    return {
      tenantId: tenantId,
      companyInfo: {
        name: "Air-Tech AS",
        address: "Stanseveien 18, 0975 Oslo",
        phone: "+47 22 00 00 00",
        email: "post@air-tech.no",
        cvr: "123 456 789"
      },
      logo: {
        url: null,
        uploadedAt: null
      },
      lastUpdated: new Date().toISOString()
    };
  }

  // Download logo as base64 for embedding in PDF
  async getLogoAsBase64(logoUrl) {
    if (!logoUrl) return null;
    
    try {
      console.log(`🖼️ Downloading logo for PDF: ${logoUrl}`);
      
      // Extract file path from URL
      const urlParts = logoUrl.split('/');
      const filePath = urlParts.slice(4).join('/'); // Remove https://storage.googleapis.com/bucketname/
      
      const file = this.bucket.file(filePath);
      const [buffer] = await file.download();
      
      // Determine MIME type from file extension
      const extension = path.extname(filePath).toLowerCase();
      const mimeMap = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.svg': 'image/svg+xml',
        '.gif': 'image/gif'
      };
      const mimeType = mimeMap[extension] || 'image/png';
      
      const base64 = `data:${mimeType};base64,${buffer.toString('base64')}`;
      console.log(`✅ Logo converted to base64 (${Math.round(buffer.length / 1024)}KB)`);
      
      return base64;
      
    } catch (error) {
      console.error('Error downloading logo for PDF:', error);
      return null;
    }
  }

  async generateReport(serviceReportId, tenantId) {
    await this.init();
    
    try {
      // Load tenant settings (logo + company info)
      const settings = await this.loadTenantSettings(tenantId);
      
      // Load report data
      const reportData = await this.fetchReportData(serviceReportId, tenantId);
      
      // Get logo as base64 if available
      let logoBase64 = null;
      if (settings.logo?.url) {
        logoBase64 = await this.getLogoAsBase64(settings.logo.url);
        console.log(`🖼️ Logo ${logoBase64 ? 'loaded' : 'failed to load'} for PDF`);
      }
      
      // Generate HTML with settings
      const html = await this.generateHTMLWithSettings(reportData, settings, logoBase64);
      const pdfBuffer = await this.generatePDF(html);
      const pdfPath = await this.savePDF(pdfBuffer, reportData);
      await this.updateReportPDFPath(serviceReportId, pdfPath, tenantId);
      
      return pdfPath;
      
    } catch (error) {
      console.error('PDF generering med settings feilet:', error);
      throw error;
    }
  }

  async fetchReportData(serviceReportId, tenantId) {
    const pool = await db.getTenantConnection(tenantId);
    
    const query = `
      SELECT 
        sr.*,
        o.customer_name,
        o.description as order_description,
        o.scheduled_date,
        o.customer_email,
        o.customer_phone,
        o.address,
        o.notes as order_notes,
        e.name as equipment_name,
        e.type as equipment_type,
        e.data as equipment_data,
        u.name as technician_name,
        u.email as technician_email
      FROM service_reports sr
      LEFT JOIN orders o ON sr.order_id = o.id
      LEFT JOIN equipment e ON sr.equipment_id = e.id
      LEFT JOIN users u ON o.assigned_technician_id = u.id
      WHERE sr.id = $1
    `;
    
    const result = await pool.query(query, [serviceReportId]);
    return result.rows[0];
  }

  async generateHTMLWithSettings(data, settings, logoBase64) {
    const css = this.getEnhancedCSS();
    const header = this.generateHeaderWithLogo(data, settings, logoBase64);
    const overview = this.generateOverviewSection(data);
    const equipmentInfo = this.generateEquipmentInfo(data);
    const checklist = this.generateChecklist(data);
    const products = this.generateProductsUsed(data);
    const additionalWork = this.generateAdditionalWork(data);
    const summary = this.generateSummarySection(data);
    const photos = this.generatePhotos(data);
    const footer = this.generateFooterWithSettings(data, settings);
    
    return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <style>${css}</style>
    </head>
    <body>
        ${header}
        ${overview}
        ${equipmentInfo}
        ${checklist}
        ${products}
        ${additionalWork}
        ${summary}
        ${photos}
        ${footer}
    </body>
    </html>
    `;
  }

  getEnhancedCSS() {
    return `
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
      
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }
      
      body {
        font-family: 'Inter', Arial, sans-serif;
        font-size: 13px;
        line-height: 1.5;
        color: #1f2937;
        background: #ffffff;
      }
      
      .header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: 40px;
        padding: 30px 30px 25px 30px;
        background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%);
        color: white;
        border-radius: 12px;
        position: relative;
        overflow: hidden;
      }
      
      .header::before {
        content: '';
        position: absolute;
        top: 0;
        right: 0;
        width: 200px;
        height: 100%;
        background: rgba(255, 255, 255, 0.05);
        transform: skew(-15deg) translateX(50px);
      }
      
      .company-info {
        display: flex;
        align-items: center;
        z-index: 2;
      }
      
      .logo-container {
        width: 80px;
        height: 80px;
        background: rgba(255, 255, 255, 0.15);
        border-radius: 12px;
        display: flex;
        align-items: center;
        justify-content: center;
        margin-right: 20px;
        backdrop-filter: blur(10px);
      }
      
      .company-logo {
        max-width: 70px;
        max-height: 70px;
        border-radius: 8px;
      }
      
      .logo-placeholder {
        font-size: 24px;
        font-weight: 700;
        color: white;
      }
      
      .company-details h1 {
        margin: 0 0 5px 0;
        font-size: 28px;
        font-weight: 700;
        text-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
      }
      
      .company-details .subtitle {
        font-size: 14px;
        opacity: 0.9;
        font-weight: 500;
      }
      
      .company-contact {
        font-size: 12px;
        opacity: 0.8;
        margin-top: 8px;
        line-height: 1.4;
      }
      
      .report-header {
        text-align: right;
        z-index: 2;
      }
      
      .report-title {
        font-size: 24px;
        font-weight: 700;
        margin: 0 0 8px 0;
        text-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
      }
      
      .report-meta {
        font-size: 14px;
        opacity: 0.9;
        line-height: 1.4;
      }
      
      .overview-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 20px;
        margin-bottom: 30px;
      }
      
      .overview-card {
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 12px;
        padding: 20px;
        position: relative;
      }
      
      .overview-card::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 4px;
        background: linear-gradient(90deg, #3b82f6, #8b5cf6);
        border-radius: 12px 12px 0 0;
      }
      
      .card-title {
        font-size: 16px;
        font-weight: 600;
        color: #374151;
        margin-bottom: 15px;
        display: flex;
        align-items: center;
      }
      
      .card-icon {
        font-size: 18px;
        margin-right: 8px;
      }
      
      .info-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 8px 0;
        border-bottom: 1px solid #e5e7eb;
      }
      
      .info-row:last-child {
        border-bottom: none;
      }
      
      .info-label {
        font-weight: 500;
        color: #6b7280;
        font-size: 12px;
      }
      
      .info-value {
        font-weight: 600;
        color: #111827;
        text-align: right;
      }
      
      .section {
        margin-bottom: 35px;
        break-inside: avoid;
      }
      
      .section-header {
        background: linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%);
        padding: 15px 20px;
        border-radius: 10px 10px 0 0;
        border-left: 4px solid #3b82f6;
        margin-bottom: 0;
      }
      
      .section-title {
        font-size: 18px;
        font-weight: 600;
        color: #1e293b;
        margin: 0;
      }
      
      .section-content {
        background: white;
        border: 1px solid #e2e8f0;
        border-top: none;
        border-radius: 0 0 10px 10px;
        padding: 20px;
      }
      
      .modern-table {
        width: 100%;
        border-collapse: separate;
        border-spacing: 0;
        border-radius: 8px;
        overflow: hidden;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
        margin-bottom: 20px;
      }
      
      .modern-table th {
        background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%);
        color: white;
        padding: 12px 15px;
        font-weight: 600;
        font-size: 12px;
        text-align: left;
        border: none;
      }
      
      .modern-table td {
        padding: 12px 15px;
        border-bottom: 1px solid #f1f5f9;
        background: white;
        font-size: 12px;
      }
      
      .modern-table tbody tr:hover {
        background: #f8fafc;
      }
      
      .modern-table tbody tr:last-child td {
        border-bottom: none;
      }
      
      .status-indicator {
        display: inline-flex;
        align-items: center;
        padding: 4px 8px;
        border-radius: 20px;
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      
      .status-ok {
        background: #dcfce7;
        color: #166534;
        border: 1px solid #bbf7d0;
      }
      
      .status-avvik {
        background: #fef2f2;
        color: #dc2626;
        border: 1px solid #fecaca;
      }
      
      .status-byttet {
        background: #dbeafe;
        color: #1d4ed8;
        border: 1px solid #bfdbfe;
      }
      
      .status-na {
        background: #f3f4f6;
        color: #6b7280;
        border: 1px solid #d1d5db;
      }
      
      .photo-gallery {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 15px;
        margin-top: 20px;
      }
      
      .photo-item {
        position: relative;
        border-radius: 8px;
        overflow: hidden;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        aspect-ratio: 4/3;
      }
      
      .photo-item img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      
      .summary-box {
        background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%);
        border: 1px solid #0ea5e9;
        border-radius: 12px;
        padding: 20px;
        margin: 20px 0;
      }
      
      .summary-title {
        font-size: 16px;
        font-weight: 600;
        color: #0c4a6e;
        margin-bottom: 12px;
        display: flex;
        align-items: center;
      }
      
      .summary-content {
        color: #374151;
        line-height: 1.6;
      }
      
      .footer {
        margin-top: 50px;
        padding: 25px 30px;
        background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
        border-radius: 12px;
        border-top: 3px solid #3b82f6;
        text-align: center;
      }
      
      .signature-section {
        margin-top: 40px;
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 40px;
      }
      
      .signature-box {
        border-top: 2px solid #d1d5db;
        padding-top: 10px;
        text-align: center;
      }
      
      .signature-label {
        font-size: 12px;
        color: #6b7280;
        font-weight: 500;
      }
      
      .signature-name {
        font-size: 14px;
        font-weight: 600;
        color: #374151;
        margin-top: 5px;
      }
      
      .footer-content {
        display: flex;
        justify-content: space-between;
        align-items: center;
        flex-wrap: wrap;
        gap: 15px;
        margin-top: 30px;
      }
      
      .footer-left, .footer-right {
        color: #6b7280;
        font-size: 11px;
      }
      
      .footer-center {
        font-weight: 600;
        color: #374151;
        font-size: 12px;
      }
      
      @media print {
        body { print-color-adjust: exact; }
        .header::before { display: none; }
      }
    `;
  }

  generateHeaderWithLogo(data, settings, logoBase64) {
    const reportDate = new Date().toLocaleDateString('no-NO', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    
    const serviceDate = new Date(data.scheduled_date).toLocaleDateString('no-NO', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    const companyInfo = settings.companyInfo || {};

    return `
    <div class="header">
        <div class="company-info">
            <div class="logo-container">
                ${logoBase64 
                  ? `<img src="${logoBase64}" alt="Company Logo" class="company-logo">` 
                  : `<div class="logo-placeholder">AT</div>`
                }
            </div>
            <div class="company-details">
                <h1>${companyInfo.name || 'Air-Tech AS'}</h1>
                <div class="subtitle">Profesjonell ventilasjon og kjøling</div>
                <div class="company-contact">
                    ${companyInfo.address || 'Stanseveien 18, 0975 Oslo'}<br>
                    ${companyInfo.email || 'post@air-tech.no'} | ${companyInfo.phone || 'Tlf: +47 22 00 00 00'}
                </div>
            </div>
        </div>
        <div class="report-header">
            <h2 class="report-title">Servicerapport</h2>
            <div class="report-meta">
                <div><strong>Rapport #:</strong> ${data.id || 'N/A'}</div>
                <div><strong>Generert:</strong> ${reportDate}</div>
                <div><strong>Service utført:</strong> ${serviceDate}</div>
            </div>
        </div>
    </div>
    `;
  }

  generateOverviewSection(data) {
    return `
    <div class="overview-grid">
        <div class="overview-card">
            <h3 class="card-title">
                <span class="card-icon">👤</span>
                Kundeinfo
            </h3>
            <div class="info-row">
                <span class="info-label">Kunde</span>
                <span class="info-value">${data.customer_name || 'Ikke angitt'}</span>
            </div>
            <div class="info-row">
                <span class="info-label">Adresse</span>
                <span class="info-value">${data.address || 'Ikke angitt'}</span>
            </div>
            <div class="info-row">
                <span class="info-label">E-post</span>
                <span class="info-value">${data.customer_email || 'Ikke angitt'}</span>
            </div>
            <div class="info-row">
                <span class="info-label">Telefon</span>
                <span class="info-value">${data.customer_phone || 'Ikke angitt'}</span>
            </div>
        </div>
        
        <div class="overview-card">
            <h3 class="card-title">
                <span class="card-icon">🔧</span>
                Serviceoppdrag
            </h3>
            <div class="info-row">
                <span class="info-label">Ordre nr.</span>
                <span class="info-value">${data.order_id}</span>
            </div>
            <div class="info-row">
                <span class="info-label">Tekniker</span>
                <span class="info-value">${data.technician_name || 'Ikke angitt'}</span>
            </div>
            <div class="info-row">
                <span class="info-label">Servicedato</span>
                <span class="info-value">${new Date(data.scheduled_date).toLocaleDateString('no-NO')}</span>
            </div>
            <div class="info-row">
                <span class="info-label">Status</span>
                <span class="info-value status-indicator status-ok">Ferdigstilt</span>
            </div>
        </div>
    </div>
    `;
  }

  generateEquipmentInfo(data) {
    const equipmentData = data.equipment_data || {};
    
    return `
    <div class="section page-break-avoid">
        <div class="section-header">
            <h3 class="section-title">🏭 Anleggsinformasjon</h3>
        </div>
        <div class="section-content">
            <div class="overview-grid">
                <div class="info-row">
                    <span class="info-label">Anleggstype</span>
                    <span class="info-value">${data.equipment_type || 'Ikke angitt'}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Anleggsnavn</span>
                    <span class="info-value">${data.equipment_name || 'Ikke angitt'}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Systemnummer</span>
                    <span class="info-value">${equipmentData.systemNumber || equipmentData.system_number || 'Ikke angitt'}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Plassering</span>
                    <span class="info-value">${equipmentData.location || equipmentData.placement || 'Ikke angitt'}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Beskrivelse</span>
                    <span class="info-value">${equipmentData.description || equipmentData.beskrivelse || 'Ikke angitt'}</span>
                </div>
            </div>
        </div>
    </div>
    `;
  }

  generateChecklist(data) {
    const checklistData = data.checklist_data || {};
    const components = checklistData.components || [];
    
    if (components.length === 0) {
      return `
      <div class="section">
          <div class="section-header">
              <h3 class="section-title">📋 Serviceskjekkliste</h3>
          </div>
          <div class="section-content">
              <p style="color: #6b7280; font-style: italic;">Ingen sjekkliste data dokumentert.</p>
          </div>
      </div>
      `;
    }
    
    let html = `
    <div class="section page-break-avoid">
        <div class="section-header">
            <h3 class="section-title">📋 Serviceskjekkliste</h3>
        </div>
        <div class="section-content">
    `;
    
    components.forEach((component, index) => {
      html += this.generateComponentChecklist(component, index);
    });
    
    html += '</div></div>';
    return html;
  }

  generateComponentChecklist(component, componentIndex) {
    const checklist = component.checklist || {};
    
    let html = `
    <div style="margin-bottom: 25px;">
        <h4 style="color: #374151; font-size: 15px; font-weight: 600; margin-bottom: 15px; padding: 8px 12px; background: #f8fafc; border-radius: 6px; border-left: 3px solid #3b82f6;">
            ${component.name || `Komponent ${componentIndex + 1}`}
        </h4>
        <table class="modern-table">
            <thead>
                <tr>
                    <th style="width: 60%;">Kontrollpunkt</th>
                    <th style="width: 20%;">Status</th>
                    <th style="width: 20%;">Kommentar</th>
                </tr>
            </thead>
            <tbody>
    `;
    
    Object.entries(checklist).forEach(([key, value]) => {
      const status = this.formatChecklistStatus(value.status);
      const comment = value.comment || '';
      const label = value.label || key;
      
      html += `
                <tr>
                    <td style="font-weight: 500;">${label}</td>
                    <td>${status}</td>
                    <td style="font-size: 11px; color: #6b7280;">${comment}</td>
                </tr>
      `;
    });
    
    html += `
            </tbody>
        </table>
    </div>
    `;
    
    return html;
  }

  formatChecklistStatus(status) {
    const statusMap = {
      'ok': '<span class="status-indicator status-ok">✓ OK</span>',
      'avvik': '<span class="status-indicator status-avvik">⚠ Avvik</span>',
      'byttet': '<span class="status-indicator status-byttet">🔄 Byttet</span>',
      'na': '<span class="status-indicator status-na">− Ikke aktuelt</span>'
    };
    
    return statusMap[status] || '<span class="status-indicator status-na">− Ikke sjekket</span>';
  }

  generateProductsUsed(data) {
    const products = data.products_used || [];
    
    if (products.length === 0) {
      return '';
    }
    
    let html = `
    <div class="section page-break-avoid">
        <div class="section-header">
            <h3 class="section-title">📦 Brukte produkter og materialer</h3>
        </div>
        <div class="section-content">
            <table class="modern-table">
                <thead>
                    <tr>
                        <th>Produktnavn</th>
                        <th style="width: 15%;">Antall</th>
                        <th style="width: 20%;">Enhetspris</th>
                        <th style="width: 20%;">Total</th>
                    </tr>
                </thead>
                <tbody>
    `;
    
    let totalSum = 0;
    products.forEach(product => {
      const quantity = product.quantity || 0;
      const price = product.price || 0;
      const total = quantity * price;
      totalSum += total;
      
      html += `
                    <tr>
                        <td style="font-weight: 500;">${product.name || 'Ukjent produkt'}</td>
                        <td style="text-align: center;">${quantity}</td>
                        <td style="text-align: right;">${price.toLocaleString('no-NO', {style: 'currency', currency: 'NOK'})}</td>
                        <td style="text-align: right; font-weight: 600;">${total.toLocaleString('no-NO', {style: 'currency', currency: 'NOK'})}</td>
                    </tr>
      `;
    });
    
    html += `
                    <tr style="background: #f1f5f9; font-weight: 600;">
                        <td colspan="3" style="text-align: right; border-top: 2px solid #3b82f6;">Totalsum materialer:</td>
                        <td style="text-align: right; border-top: 2px solid #3b82f6;">${totalSum.toLocaleString('no-NO', {style: 'currency', currency: 'NOK'})}</td>
                    </tr>
                </tbody>
            </table>
        </div>
    </div>
    `;
    
    return html;
  }

  generateAdditionalWork(data) {
    const additionalWork = data.additional_work || [];
    
    if (additionalWork.length === 0) {
      return '';
    }
    
    let html = `
    <div class="section page-break-avoid">
        <div class="section-header">
            <h3 class="section-title">⚡ Tilleggsarbeid</h3>
        </div>
        <div class="section-content">
            <table class="modern-table">
                <thead>
                    <tr>
                        <th>Beskrivelse</th>
                        <th style="width: 15%;">Timer</th>
                        <th style="width: 20%;">Timepris</th>
                        <th style="width: 20%;">Total</th>
                    </tr>
                </thead>
                <tbody>
    `;
    
    let totalHours = 0;
    let totalCost = 0;
    
    additionalWork.forEach(work => {
      const hours = work.hours || 0;
      const price = work.price || 0;
      const total = hours * price;
      
      totalHours += hours;
      totalCost += total;
      
      html += `
                    <tr>
                        <td style="font-weight: 500;">${work.description || 'Ikke beskrevet'}</td>
                        <td style="text-align: center;">${hours}t</td>
                        <td style="text-align: right;">${price.toLocaleString('no-NO', {style: 'currency', currency: 'NOK'})}</td>
                        <td style="text-align: right; font-weight: 600;">${total.toLocaleString('no-NO', {style: 'currency', currency: 'NOK'})}</td>
                    </tr>
      `;
    });
    
    html += `
                    <tr style="background: #f1f5f9; font-weight: 600;">
                        <td style="border-top: 2px solid #3b82f6;">Totalsum tilleggsarbeid:</td>
                        <td style="text-align: center; border-top: 2px solid #3b82f6;">${totalHours}t</td>
                        <td style="border-top: 2px solid #3b82f6;"></td>
                        <td style="text-align: right; border-top: 2px solid #3b82f6;">${totalCost.toLocaleString('no-NO', {style: 'currency', currency: 'NOK'})}</td>
                    </tr>
                </tbody>
            </table>
        </div>
    </div>
    `;
    
    return html;
  }

  generateSummarySection(data) {
    const overallComment = data.notes || data.overall_comment || '';
    
    if (!overallComment.trim()) {
      return '';
    }
    
    return `
    <div class="section page-break-avoid">
        <div class="summary-box">
            <h3 class="summary-title">
                💬 Oppsummering og kommentarer
            </h3>
            <div class="summary-content">
                ${overallComment.replace(/\n/g, '<br>')}
            </div>
        </div>
    </div>
    `;
  }

  generatePhotos(data) {
    const photos = data.photos || [];
    
    if (photos.length === 0) {
      return '';
    }
    
    let html = `
    <div class="section page-break-before">
        <div class="section-header">
            <h3 class="section-title">📸 Dokumentasjon fra service</h3>
        </div>
        <div class="section-content">
            <div class="photo-gallery">
    `;
    
    photos.forEach((photo, index) => {
      html += `
                <div class="photo-item">
                    <img src="${photo}" alt="Servicebilde ${index + 1}">
                </div>
      `;
    });
    
    html += `
            </div>
        </div>
    </div>
    `;
    
    return html;
  }

  generateFooterWithSettings(data, settings) {
    const generatedDate = new Date().toLocaleDateString('no-NO', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    const companyInfo = settings.companyInfo || {};
    
    return `
    <div class="footer">
        <div class="signature-section">
            <div class="signature-box">
                <div class="signature-label">Tekniker</div>
                <div class="signature-name">${data.technician_name || 'Ikke angitt'}</div>
            </div>
            <div class="signature-box">
                <div class="signature-label">Kunde (signatur)</div>
                <div style="height: 40px;"></div>
            </div>
        </div>
        
        <div class="footer-content">
            <div class="footer-left">
                Rapport generert: ${generatedDate}
            </div>
            <div class="footer-center">
                ${companyInfo.name || 'Air-Tech AS'} | CVR: ${companyInfo.cvr || '123 456 789'}
            </div>
            <div class="footer-right">
                Side 1 av 1
            </div>
        </div>
    </div>
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
        right: '15mm',
        bottom: '15mm',
        left: '15mm'
      },
      printBackground: true,
      preferCSSPageSize: true
    });
    
    await page.close();
    return pdfBuffer;
  }

  async savePDF(pdfBuffer, data) {
    const year = new Date().getFullYear();
    const month = String(new Date().getMonth() + 1).padStart(2, '0');
    
    const dir = path.join(__dirname, '../servfix-files/tenants/airtech/reports', String(year), month);
    await fs.mkdir(dir, { recursive: true });
    
    const timestamp = new Date().toISOString().slice(0, 16).replace(/[:-]/g, '');
    const filename = `${data.order_id}_${data.equipment_id}_${data.equipment_type}_${timestamp}.pdf`;
    const filePath = path.join(dir, filename);
    
    await fs.writeFile(filePath, pdfBuffer);
    
    return `reports/${year}/${month}/${filename}`;
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

module.exports = PDFGeneratorWithSettings;