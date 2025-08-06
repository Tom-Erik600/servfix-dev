// src/services/dynamicPdfGenerator.js - Uses actual dynamic templates
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs').promises;
const db = require('../config/database');

class DynamicPDFGenerator {
  constructor() {
    this.browser = null;
    this.checklistTemplates = null;
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
    
    // Load actual checklist templates from database
    if (!this.checklistTemplates) {
      await this.loadChecklistTemplates();
    }
  }

  async loadChecklistTemplates() {
    try {
      const pool = await db.getTenantConnection('airtech'); // Default tenant for templates
      const result = await pool.query('SELECT * FROM checklist_templates');
      
      // Transform to frontend format
      const facilityTypes = result.rows.map(row => ({
        id: row.name.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
        name: row.name,
        ...row.template_data
      }));
      
      this.checklistTemplates = { facilityTypes };
      console.log(`📋 Loaded ${facilityTypes.length} checklist templates for PDF generation`);
      
    } catch (error) {
      console.error('Error loading checklist templates for PDF:', error);
      // Fallback to empty templates
      this.checklistTemplates = { facilityTypes: [] };
    }
  }

  // Smart template detection based on equipment type and name
  getTemplateForEquipment(equipmentType, equipmentName = '') {
    if (!this.checklistTemplates || !this.checklistTemplates.facilityTypes) {
      return this.getDefaultTemplate();
    }
    
    const type = equipmentType?.toLowerCase() || '';
    const name = equipmentName?.toLowerCase() || '';
    
    // Find exact match by ID first
    let template = this.checklistTemplates.facilityTypes.find(t => t.id === type);
    
    // If no exact match, try name matching
    if (!template) {
      template = this.checklistTemplates.facilityTypes.find(t => 
        t.name.toLowerCase().includes(type) ||
        type.includes(t.name.toLowerCase()) ||
        t.name.toLowerCase().includes(name) ||
        name.includes(t.name.toLowerCase())
      );
    }
    
    return template || this.getDefaultTemplate();
  }

  getDefaultTemplate() {
    return {
      id: 'standard',
      name: 'Standard service',
      systemFields: [
        { name: "beskrivelse", label: "Beskrivelse", required: true, order: 1 }
      ],
      checklistItems: [],
      allowProducts: true,
      allowAdditionalWork: true,
      allowComments: true,
      hasDriftSchedule: false
    };
  }

  // Smart icon and color selection based on template name/type
  getTemplateDesign(template) {
    const name = template.name.toLowerCase();
    const id = template.id.toLowerCase();
    
    // Keywords-based detection for icons and colors
    const designs = {
      ventilasjon: { icon: '🌪️', color: '#059669', accent: '#ecfdf5', title: 'Ventilasjonsservice' },
      kjøling: { icon: '❄️', color: '#0ea5e9', accent: '#f0f9ff', title: 'Kjøleservice' },
      kjoling: { icon: '❄️', color: '#0ea5e9', accent: '#f0f9ff', title: 'Kjøleservice' },
      varmepumpe: { icon: '🔥', color: '#dc2626', accent: '#fef2f2', title: 'Varmepumpeservice' },
      varme: { icon: '🔥', color: '#dc2626', accent: '#fef2f2', title: 'Varmeservice' },
      pumpe: { icon: '🔥', color: '#dc2626', accent: '#fef2f2', title: 'Pumpeservice' },
      luftbehandling: { icon: '💨', color: '#7c3aed', accent: '#f3e8ff', title: 'Luftbehandlingsservice' },
      luft: { icon: '💨', color: '#7c3aed', accent: '#f3e8ff', title: 'Luftservice' },
      spjeld: { icon: '⚙️', color: '#ea580c', accent: '#fff7ed', title: 'Spjeldservice' },
      styring: { icon: '🎛️', color: '#0d9488', accent: '#f0fdfa', title: 'Styringsservice' },
      drift: { icon: '🔄', color: '#7c2d12', accent: '#fef7f0', title: 'Driftsservice' }
    };
    
    // Find matching design based on name/id keywords
    for (const [keyword, design] of Object.entries(designs)) {
      if (name.includes(keyword) || id.includes(keyword)) {
        return design;
      }
    }
    
    // Default design
    return {
      icon: '⚙️',
      color: '#3b82f6',
      accent: '#f8fafc',
      title: template.name + ' service'
    };
  }

  async generateReport(serviceReportId, tenantId) {
    await this.init();
    
    try {
      const reportData = await this.fetchReportData(serviceReportId, tenantId);
      const template = this.getTemplateForEquipment(reportData.equipment_type, reportData.equipment_name);
      const design = this.getTemplateDesign(template);
      
      console.log(`📋 Using template: ${template.name} with design: ${design.title}`);
      
      const html = await this.generateDynamicHTML(reportData, template, design);
      const pdfBuffer = await this.generatePDF(html);
      const pdfPath = await this.savePDF(pdfBuffer, reportData);
      await this.updateReportPDFPath(serviceReportId, pdfPath, tenantId);
      
      return pdfPath;
      
    } catch (error) {
      console.error('Dynamic PDF generering feilet:', error);
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

  async generateDynamicHTML(data, template, design) {
    const css = this.getDynamicCSS(design);
    const header = this.generateDynamicHeader(data, template, design);
    const overview = this.generateOverviewSection(data);
    const equipmentInfo = this.generateDynamicEquipmentInfo(data, template);
    const checklist = this.generateDynamicChecklist(data, template);
    const products = template.allowProducts ? this.generateProductsUsed(data) : '';
    const additionalWork = template.allowAdditionalWork ? this.generateAdditionalWork(data) : '';
    const summary = template.allowComments ? this.generateSummarySection(data) : '';
    const driftSchedule = template.hasDriftSchedule ? this.generateDriftScheduleSection(data, template) : '';
    const photos = this.generatePhotos(data);
    const footer = this.generateEnhancedFooter(data);
    
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
        ${driftSchedule}
        ${products}
        ${additionalWork}
        ${summary}
        ${photos}
        ${footer}
    </body>
    </html>
    `;
  }

  getDynamicCSS(design) {
    return `
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
      
      :root {
        --primary-color: ${design.color};
        --accent-color: ${design.accent};
        --primary-light: ${this.lightenColor(design.color, 30)};
      }
      
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
        background: linear-gradient(135deg, var(--primary-color) 0%, var(--primary-light) 100%);
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
        width: 70px;
        height: 70px;
        background: rgba(255, 255, 255, 0.15);
        border-radius: 12px;
        display: flex;
        align-items: center;
        justify-content: center;
        margin-right: 20px;
        backdrop-filter: blur(10px);
        font-size: 24px;
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
        background: var(--accent-color);
        border: 1px solid var(--primary-color);
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
        background: var(--primary-color);
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
        background: linear-gradient(135deg, var(--accent-color) 0%, #f1f5f9 100%);
        padding: 15px 20px;
        border-radius: 10px 10px 0 0;
        border-left: 4px solid var(--primary-color);
        margin-bottom: 0;
      }
      
      .section-title {
        font-size: 18px;
        font-weight: 600;
        color: #1e293b;
        margin: 0;
        display: flex;
        align-items: center;
      }
      
      .section-icon {
        font-size: 20px;
        margin-right: 10px;
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
        background: linear-gradient(135deg, var(--primary-color) 0%, var(--primary-light) 100%);
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
        background: var(--accent-color);
        border: 1px solid var(--primary-color);
        border-radius: 12px;
        padding: 20px;
        margin: 20px 0;
      }
      
      .summary-title {
        font-size: 16px;
        font-weight: 600;
        color: #374151;
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
        border-top: 3px solid var(--primary-color);
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

  lightenColor(color, percent) {
    const num = parseInt(color.replace("#", ""), 16);
    const amt = Math.round(2.55 * percent);
    const R = Math.min(255, (num >> 16) + amt);
    const G = Math.min(255, (num >> 8 & 0x00FF) + amt);
    const B = Math.min(255, (num & 0x0000FF) + amt);
    return "#" + (0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1);
  }

  generateDynamicHeader(data, template, design) {
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

    return `
    <div class="header">
        <div class="company-info">
            <div class="logo-container">
                ${design.icon}
            </div>
            <div class="company-details">
                <h1>Air-Tech AS</h1>
                <div class="subtitle">Profesjonell ventilasjon og kjøling</div>
                <div class="company-contact">
                    Stanseveien 18, 0975 Oslo<br>
                    post@air-tech.no | Tlf: +47 22 00 00 00
                </div>
            </div>
        </div>
        <div class="report-header">
            <h2 class="report-title">${design.title}</h2>
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

  generateDynamicEquipmentInfo(data, template) {
    const equipmentData = data.equipment_data || {};
    
    let html = `
    <div class="section page-break-avoid">
        <div class="section-header">
            <h3 class="section-title">
                <span class="section-icon">🏭</span>
                Anleggsinformasjon - ${template.name}
            </h3>
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
    `;
    
    // Add dynamic system fields from template
    if (template.systemFields && template.systemFields.length > 0) {
      template.systemFields
        .sort((a, b) => a.order - b.order)
        .forEach(field => {
          const value = equipmentData[field.name] || 'Ikke angitt';
          html += `
                <div class="info-row">
                    <span class="info-label">${field.label}</span>
                    <span class="info-value">${value}</span>
                </div>
          `;
        });
    }
    
    html += `
            </div>
        </div>
    </div>
    `;
    
    return html;
  }

  generateDynamicChecklist(data, template) {
    const checklistData = data.checklist_data || {};
    const components = checklistData.components || [];
    
    if (components.length === 0) {
      return `
      <div class="section">
          <div class="section-header">
              <h3 class="section-title">
                  <span class="section-icon">📋</span>
                  Serviceskjekkliste
              </h3>
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
            <h3 class="section-title">
                <span class="section-icon">📋</span>
                Serviceskjekkliste - ${template.name}
            </h3>
        </div>
        <div class="section-content">
    `;
    
    components.forEach((component, index) => {
      html += this.generateDynamicComponentChecklist(component, template, index);
    });
    
    html += '</div></div>';
    return html;
  }

  generateDynamicComponentChecklist(component, template, componentIndex) {
    const checklist = component.checklist || {};
    
    let html = `
    <div style="margin-bottom: 25px;">
        <h4 style="color: #374151; font-size: 15px; font-weight: 600; margin-bottom: 15px; padding: 8px 12px; background: var(--accent-color); border-radius: 6px; border-left: 3px solid var(--primary-color);">
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
    
    // Use template checklistItems to know what to show, but get actual data from checklist
    if (template.checklistItems && template.checklistItems.length > 0) {
      template.checklistItems
        .sort((a, b) => a.order - b.order)
        .forEach(templateItem => {
          const checklistValue = checklist[templateItem.id] || {};
          const status = this.formatChecklistStatus(checklistValue.status);
          const comment = checklistValue.comment || '';
          
          html += `
                    <tr>
                        <td style="font-weight: 500;">${templateItem.label}</td>
                        <td>${status}</td>
                        <td style="font-size: 11px; color: #6b7280;">${comment}</td>
                    </tr>
          `;
        });
    } else {
      // Fallback: show all checklist data we have
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
    }
    
    html += `
            </tbody>
        </table>
    </div>
    `;
    
    return html;
  }

  generateDriftScheduleSection(data, template) {
    if (!template.hasDriftSchedule || !template.driftScheduleConfig) {
      return '';
    }
    
    const driftData = data.checklist_data?.driftSchedule || {};
    const config = template.driftScheduleConfig;
    
    let html = `
    <div class="section page-break-avoid">
        <div class="section-header">
            <h3 class="section-title">
                <span class="section-icon">🕐</span>
                ${config.title || 'Driftstider'}
            </h3>
        </div>
        <div class="section-content">
            <table class="modern-table">
                <thead>
                    <tr>
                        <th>Dag</th>
    `;
    
    (config.fields || ['Start', 'Stopp']).forEach(field => {
      html += `<th>${field}</th>`;
    });
    
    html += `
                    </tr>
                </thead>
                <tbody>
    `;
    
    (config.days || ['Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag', 'Søndag']).forEach(day => {
      html += `
                    <tr>
                        <td style="font-weight: 500;">${day}</td>
      `;
      
      (config.fields || ['Start', 'Stopp']).forEach(field => {
        const value = driftData[day]?.[field] || '-';
        html += `<td>${value}</td>`;
      });
      
      html += `</tr>`;
    });
    
    html += `
                </tbody>
            </table>
        </div>
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
            <h3 class="section-title">
                <span class="section-icon">📦</span>
                Brukte produkter og materialer
            </h3>
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
                    <tr style="background: var(--accent-color); font-weight: 600;">
                        <td colspan="3" style="text-align: right; border-top: 2px solid var(--primary-color);">Totalsum materialer:</td>
                        <td style="text-align: right; border-top: 2px solid var(--primary-color);">${totalSum.toLocaleString('no-NO', {style: 'currency', currency: 'NOK'})}</td>
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
            <h3 class="section-title">
                <span class="section-icon">⚡</span>
                Tilleggsarbeid
            </h3>
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
                    <tr style="background: var(--accent-color); font-weight: 600;">
                        <td style="border-top: 2px solid var(--primary-color);">Totalsum tilleggsarbeid:</td>
                        <td style="text-align: center; border-top: 2px solid var(--primary-color);">${totalHours}t</td>
                        <td style="border-top: 2px solid var(--primary-color);"></td>
                        <td style="text-align: right; border-top: 2px solid var(--primary-color);">${totalCost.toLocaleString('no-NO', {style: 'currency', currency: 'NOK'})}</td>
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
                <span class="section-icon">💬</span>
                Oppsummering og kommentarer
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
            <h3 class="section-title">
                <span class="section-icon">📸</span>
                Dokumentasjon fra service
            </h3>
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

  generateEnhancedFooter(data) {
    const generatedDate = new Date().toLocaleDateString('no-NO', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    
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
                Air-Tech AS | CVF nr. 123 456 789
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

module.exports = DynamicPDFGenerator;