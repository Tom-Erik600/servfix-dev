// src/services/pdfGenerator.js
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs').promises;
const db = require('../config/database');

class ServiceReportPDFGenerator {
  constructor() {
    this.browser = null;
  }

  async init() {
    if (!this.browser) {
      this.browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
    }
  }

  async generateReport(serviceReportId, tenantId) {
    await this.init();
    
    try {
      // Hent all nødvendig data
      const reportData = await this.fetchReportData(serviceReportId, tenantId);
      
      // Generer HTML
      const html = await this.generateHTML(reportData);
      
      // Lag PDF
      const pdfBuffer = await this.generatePDF(html);
      
      // Lagre PDF til fil
      const pdfPath = await this.savePDF(pdfBuffer, reportData);
      
      // Oppdater database med PDF-path
      await this.updateReportPDFPath(serviceReportId, pdfPath, tenantId);
      
      return pdfPath;
      
    } catch (error) {
      console.error('PDF generering feilet:', error);
      throw error;
    }
  }

  async fetchReportData(serviceReportId, tenantId) {
    const pool = await db.getTenantConnection(tenantId);
    
    // Hent servicerapport med joins
    const query = `
      SELECT 
        sr.*,
        o.id as order_id,
        o.customer_name,
        o.description as order_description,
        o.scheduled_date,
        e.name as equipment_name,
        e.type as equipment_type,
        e.data as equipment_data,
        t.name as technician_name,
        ct.template_data
      FROM service_reports sr
      JOIN orders o ON sr.order_id = o.id
      JOIN equipment e ON sr.equipment_id = e.id
      JOIN technicians t ON o.technician_id = t.id
      LEFT JOIN checklist_templates ct ON ct.equipment_type = e.type
      WHERE sr.id = $1
    `;
    
    const result = await pool.query(query, [serviceReportId]);
    
    if (result.rows.length === 0) {
      throw new Error('Servicerapport ikke funnet');
    }
    
    return result.rows[0];
  }

  async generateHTML(data) {
    const template = data.template_data || {};
    
    // Base HTML struktur
    let html = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <style>
            ${this.getBaseCSS()}
        </style>
    </head>
    <body>
        ${this.generateHeader(data)}
        ${this.generateOrderInfo(data)}
        ${this.generateEquipmentInfo(data)}
        ${this.generateChecklist(data, template)}
        ${this.generateProducts(data)}
        ${this.generateAdditionalWork(data)}
        ${this.generatePhotos(data)}
        ${this.generateFooter(data)}
    </body>
    </html>
    `;
    
    return html;
  }

  generateHeader(data) {
    return `
    <div class="header">
        <div class="company-info">
            <img src="data:image/svg+xml;base64,${this.getLogoBase64()}" alt="Air-Tech AS" class="logo">
            <div class="company-details">
                <h1>Air-Tech AS</h1>
                <p>Stanseveien 18, 0975 Oslo</p>
                <p>Telefon: +47915240403 | Epost: post@air-tech.no</p>
                <p>Org.nr.: 889 558 652</p>
            </div>
        </div>
        <div class="report-title">
            <h2>Servicerapport</h2>
            <p>Ordre: ${data.order_id}</p>
            <p>Equipment: ${data.equipment_name}</p>
        </div>
    </div>
    `;
  }

  generateOrderInfo(data) {
    return `
    <div class="section">
        <h3>Ordreinformasjon</h3>
        <div class="info-grid">
            <div class="info-item">
                <span class="label">Kunde:</span>
                <span class="value">${data.customer_name || 'Ikke angitt'}</span>
            </div>
            <div class="info-item">
                <span class="label">Servicedato:</span>
                <span class="value">${new Date(data.scheduled_date).toLocaleDateString('no-NO')}</span>
            </div>
            <div class="info-item">
                <span class="label">Tekniker:</span>
                <span class="value">${data.technician_name}</span>
            </div>
            <div class="info-item">
                <span class="label">Beskrivelse:</span>
                <span class="value">${data.order_description || 'Rutineservice'}</span>
            </div>
        </div>
    </div>
    `;
  }

  generateEquipmentInfo(data) {
    const equipmentData = data.equipment_data || {};
    
    return `
    <div class="section">
        <h3>Anleggsinformasjon</h3>
        <div class="info-grid">
            <div class="info-item">
                <span class="label">Anleggstype:</span>
                <span class="value">${data.equipment_type}</span>
            </div>
            <div class="info-item">
                <span class="label">Navn:</span>
                <span class="value">${data.equipment_name}</span>
            </div>
            <div class="info-item">
                <span class="label">Systemnummer:</span>
                <span class="value">${equipmentData.systemNumber || 'Ikke angitt'}</span>
            </div>
            <div class="info-item">
                <span class="label">Plassering:</span>
                <span class="value">${equipmentData.location || 'Ikke angitt'}</span>
            </div>
        </div>
    </div>
    `;
  }

  generateChecklist(data, template) {
    const checklistData = data.checklist_data || {};
    const components = checklistData.components || [];
    
    if (components.length === 0) {
      return '<div class="section"><h3>Sjekkliste</h3><p>Ingen sjekkliste data tilgjengelig.</p></div>';
    }
    
    let html = `
    <div class="section checklist-section">
        <h3>Sjekkliste - ${template.name || data.equipment_type}</h3>
    `;
    
    components.forEach((component, index) => {
      html += this.generateComponentChecklist(component, template, index);
    });
    
    html += '</div>';
    return html;
  }

  generateComponentChecklist(component, template, componentIndex) {
    const checklist = component.checklist || {};
    const templateItems = template.checklistItems || [];
    
    let html = `
    <div class="checklist-component">
        <h4>Komponent ${componentIndex + 1}</h4>
        <table class="checklist-table">
            <thead>
                <tr>
                    <th>Element</th>
                    <th>Status</th>
                    <th>Kommentar</th>
                </tr>
            </thead>
            <tbody>
    `;
    
    templateItems.forEach(item => {
      const itemData = checklist[item.id] || {};
      const status = this.formatChecklistStatus(itemData, item.inputType);
      const comment = itemData.comment || itemData.avvikComment || '';
      
      html += `
        <tr>
            <td>${item.label}</td>
            <td class="status-cell">${status}</td>
            <td>${comment}</td>
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

  formatChecklistStatus(itemData, inputType) {
    switch (inputType) {
      case 'ok_avvik':
        if (itemData.status === 'ok') return '<span class="status-ok">✓ OK</span>';
        if (itemData.status === 'avvik') return '<span class="status-avvik">⚠ Avvik</span>';
        return '<span class="status-empty">-</span>';
      
      case 'ok_avvik_byttet':
        if (itemData.status === 'ok') return '<span class="status-ok">✓ OK</span>';
        if (itemData.status === 'avvik') return '<span class="status-avvik">⚠ Avvik</span>';
        if (itemData.status === 'byttet') return '<span class="status-byttet">🔄 Byttet</span>';
        return '<span class="status-empty">-</span>';
      
      case 'temperature':
        return itemData.value ? `${itemData.value}°C` : '-';
      
      case 'checkbox':
        return itemData.checked ? '☑' : '☐';
      
      case 'text':
        return itemData.value || '-';
      
      default:
        return itemData.value || '-';
    }
  }

  generateProducts(data) {
    const productsUsed = data.products_used || [];
    
    if (productsUsed.length === 0) {
      return '';
    }
    
    let html = `
    <div class="section">
        <h3>Brukte produkter</h3>
        <table class="products-table">
            <thead>
                <tr>
                    <th>Produkt</th>
                    <th>Antall</th>
                    <th>Pris</th>
                </tr>
            </thead>
            <tbody>
    `;
    
    productsUsed.forEach(product => {
      html += `
        <tr>
            <td>${product.name}</td>
            <td>${product.quantity || 1}</td>
            <td>${product.price || 0} NOK</td>
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

  generateAdditionalWork(data) {
    const additionalWork = data.additional_work || [];
    
    if (additionalWork.length === 0) {
      return '';
    }
    
    let html = `
    <div class="section">
        <h3>Tilleggsarbeid</h3>
        <table class="work-table">
            <thead>
                <tr>
                    <th>Beskrivelse</th>
                    <th>Timer</th>
                    <th>Pris</th>
                </tr>
            </thead>
            <tbody>
    `;
    
    additionalWork.forEach(work => {
      html += `
        <tr>
            <td>${work.description}</td>
            <td>${work.hours || 0}</td>
            <td>${work.price || 0} NOK</td>
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

  generatePhotos(data) {
    const photos = data.photos || [];
    
    if (photos.length === 0) {
      return '';
    }
    
    let html = `
    <div class="section photos-section">
        <h3>Bilder fra service</h3>
        <div class="photos-grid">
    `;
    
    photos.forEach(photo => {
      html += `<img src="${photo}" alt="Servicebilde" class="service-photo">`;
    });
    
    html += `
        </div>
    </div>
    `;
    
    return html;
  }

  generateFooter(data) {
    return `
    <div class="footer">
        <p>Servicerapporten er generert automatisk ${new Date().toLocaleDateString('no-NO')}</p>
        <p>Air-Tech AS | Stanseveien 18, 0975 Oslo | post@air-tech.no</p>
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
        top: '20mm',
        right: '15mm',
        bottom: '20mm',
        left: '15mm'
      },
      printBackground: true
    });
    
    await page.close();
    return pdfBuffer;
  }

  async savePDF(pdfBuffer, data) {
    const year = new Date().getFullYear();
    const month = String(new Date().getMonth() + 1).padStart(2, '0');
    
    const dir = path.join(__dirname, '../servfix-files/tenants/airtech/reports', String(year), month);
    await fs.mkdir(dir, { recursive: true });
    
    const filename = `${data.order_id}_${data.equipment_id}_${data.equipment_type}_${Date.now()}.pdf`;
    const filePath = path.join(dir, filename);
    
    await fs.writeFile(filePath, pdfBuffer);
    
    // Return relative path for database storage
    return `reports/${year}/${month}/${filename}`;
  }

  async updateReportPDFPath(serviceReportId, pdfPath, tenantId) {
    const pool = await db.getTenantConnection(tenantId);
    
    await pool.query(
      'UPDATE service_reports SET pdf_path = $1, pdf_generated = true WHERE id = $2',
      [pdfPath, serviceReportId]
    );
  }

  getBaseCSS() {
    return `
      body { font-family: Arial, sans-serif; font-size: 12px; line-height: 1.4; margin: 0; }
      .header { display: flex; justify-content: space-between; margin-bottom: 30px; padding-bottom: 20px; border-bottom: 2px solid #0066cc; }
      .company-info { display: flex; align-items: center; }
      .logo { width: 80px; height: 60px; margin-right: 20px; }
      .company-details h1 { margin: 0; color: #0066cc; font-size: 24px; }
      .company-details p { margin: 2px 0; color: #666; }
      .report-title { text-align: right; }
      .report-title h2 { margin: 0; color: #0066cc; font-size: 20px; }
      .section { margin-bottom: 25px; }
      .section h3 { color: #0066cc; border-bottom: 1px solid #ddd; padding-bottom: 5px; margin-bottom: 15px; }
      .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
      .info-item { display: flex; }
      .info-item .label { font-weight: bold; min-width: 120px; }
      .checklist-table, .products-table, .work-table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
      .checklist-table th, .products-table th, .work-table th,
      .checklist-table td, .products-table td, .work-table td { 
        border: 1px solid #ddd; padding: 8px; text-align: left; 
      }
      .checklist-table th, .products-table th, .work-table th { background-color: #f5f5f5; font-weight: bold; }
      .status-ok { color: green; font-weight: bold; }
      .status-avvik { color: red; font-weight: bold; }
      .status-byttet { color: blue; font-weight: bold; }
      .status-empty { color: #999; }
      .photos-grid { display: flex; flex-wrap: wrap; gap: 10px; }
      .service-photo { max-width: 200px; max-height: 150px; object-fit: cover; border: 1px solid #ddd; }
      .footer { margin-top: 50px; padding-top: 20px; border-top: 1px solid #ddd; text-align: center; color: #666; font-size: 10px; }
      .checklist-component { margin-bottom: 20px; }
      .checklist-component h4 { color: #333; margin-bottom: 10px; }
    `;
  }

  getLogoBase64() {
    // Placeholder - ersatt med faktisk Air-Tech logo i base64
    return 'PHN2ZyB3aWR0aD0iMTAwIiBoZWlnaHQ9IjUwIj48dGV4dCB4PSI1MCIgeT0iMjUiIHRleHQtYW5jaG9yPSJtaWRkbGUiPkFpci1UZWNoPC90ZXh0Pjwvc3ZnPg==';
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}

module.exports = ServiceReportPDFGenerator;