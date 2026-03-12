'use strict';

const puppeteer = require('puppeteer');
const db = require('../config/database');
const gcs = require('../config/gcs');

/**
 * SjaPdfGenerator — Service for generating PDF documents for SJA (Sikker Jobb Analyse)
 * Follows the pattern from unifiedPdfGenerator.js and quotePDFGenerator.js
 *
 * PDF generation ONLY works in GCP (Cloud Run with Puppeteer/Chromium installed).
 * Local Windows development will fail at Puppeteer launch with no fallback.
 */
class SjaPdfGenerator {
  constructor() {
    this.browser = null;
    this.bucket = gcs.bucket;
  }

  /**
   * Initialize Puppeteer browser instance
   * Configuration adapted for Cloud Run environment
   */
  async init() {
    if (this.browser) return;

    const opts = {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ]
    };

    if (process.env.NODE_ENV === 'production') {
      opts.executablePath = '/usr/bin/chromium';
    }

    try {
      this.browser = await puppeteer.launch(opts);
      console.log('✅ SjaPdfGenerator: Puppeteer initiated');
    } catch (err) {
      console.error('❌ SjaPdfGenerator: Puppeteer launch failed:', err.message);
      throw err;
    }
  }

  /**
   * Close browser with timeout protection
   * Prevents hanging on browser shutdown (common issue with Puppeteer)
   */
  async close() {
    if (!this.browser) return;

    try {
      await Promise.race([
        this.browser.close(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Browser close timed out')), 10000)
        )
      ]);
      console.log('✅ SjaPdfGenerator: Browser closed');
    } catch (err) {
      console.error('⚠️ SjaPdfGenerator: Browser close timeout/error:', err.message);
      try {
        this.browser.process()?.kill('SIGKILL');
      } catch (_) {
        // Ignore kill errors
      }
    } finally {
      this.browser = null;
    }
  }

  /**
   * Escape HTML special characters to prevent XSS in PDF
   */
  escapeHtml(str) {
    if (!str) return '—';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');
  }

  /**
   * Load company settings and logo from GCS
   * Defaults to Air-Tech AS if no custom settings found
   */
  async loadCompanySettings(tenantId) {
    const defaults = {
      name: 'Air-Tech AS',
      address: 'Stanseveien 18, 0975 Oslo',
      phone: '+47 91 52 40 40',
      email: 'post@air-tech.no',
      logoBase64: null
    };

    if (!this.bucket) {
      console.warn('⚠️ GCS bucket not configured, using defaults');
      return defaults;
    }

    try {
      const settingsPath = `tenants/${tenantId}/assets/settings.json`;
      const file = this.bucket.file(settingsPath);
      const [exists] = await file.exists();

      if (!exists) {
        console.log(`ℹ️ Settings not found at ${settingsPath}, using defaults`);
        return defaults;
      }

      const [contents] = await file.download();
      const settings = JSON.parse(contents.toString());

      // Merge with defaults
      if (settings.companyInfo) {
        defaults.name = settings.companyInfo.name || defaults.name;
        defaults.address = settings.companyInfo.address || defaults.address;
        defaults.phone = settings.companyInfo.phone || defaults.phone;
        defaults.email = settings.companyInfo.email || defaults.email;
      }

      // Load logo from GCS and convert to base64
      if (settings.logo?.url) {
        try {
          const logoPath = settings.logo.url.replace(
            `https://storage.googleapis.com/${this.bucket.name}/`,
            ''
          );
          const logoFile = this.bucket.file(logoPath);
          const [logoExists] = await logoFile.exists();

          if (logoExists) {
            const [logoBuffer] = await logoFile.download();
            const ext = logoPath.split('.').pop().toLowerCase();
            const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
            defaults.logoBase64 = `data:${mime};base64,${logoBuffer.toString('base64')}`;
            console.log('✅ Logo loaded from GCS');
          }
        } catch (logoErr) {
          console.warn('⚠️ Logo loading failed:', logoErr.message);
        }
      }

      return defaults;
    } catch (err) {
      console.warn('⚠️ Settings loading failed:', err.message);
      return defaults;
    }
  }

  /**
   * Generate HTML string for PDF
   * Includes styling for A4 layout with professional formatting
   */
  generateHtml(sja, company) {
    const e = this.escapeHtml.bind(this);

    // Format date in Norwegian
    const dato = new Date(sja.created_at).toLocaleDateString('no-NO', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });

    // Format timestamp
    const timestamp = new Date(sja.created_at).toLocaleString('no-NO', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    return `<!DOCTYPE html>
<html lang="no">
<head>
  <meta charset="UTF-8">
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: 'Helvetica Neue', Arial, sans-serif;
      font-size: 11px;
      color: #1E293B;
      background: white;
      padding: 12mm 15mm;
      line-height: 1.4;
    }

    /* Header */
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      padding-bottom: 10px;
      border-bottom: 3px solid #0E9CB5;
      margin-bottom: 14px;
    }

    .header-left h1 {
      font-size: 20px;
      font-weight: 700;
      color: #0E9CB5;
      letter-spacing: -0.3px;
      margin-bottom: 2px;
    }

    .header-left .subtitle {
      font-size: 11px;
      color: #64748B;
      margin-top: 2px;
    }

    .header-right {
      text-align: right;
      font-size: 10px;
      color: #64748B;
      line-height: 1.6;
    }

    .header-right .company-name {
      font-weight: 700;
      font-size: 12px;
      color: #1E293B;
      margin-bottom: 4px;
    }

    .logo {
      max-height: 40px;
      max-width: 120px;
      margin-bottom: 4px;
    }

    /* Document metadata */
    .doc-meta {
      display: flex;
      gap: 24px;
      background: #F0FBFF;
      border: 1px solid #BAE6F0;
      border-radius: 8px;
      padding: 10px 14px;
      margin-bottom: 14px;
    }

    .meta-item {
      flex: 1;
    }

    .meta-item label {
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #64748B;
      display: block;
      margin-bottom: 2px;
    }

    .meta-item span {
      font-size: 11px;
      font-weight: 600;
      color: #1E293B;
    }

    /* Sections */
    .section {
      margin-bottom: 12px;
      page-break-inside: avoid;
    }

    .section-title {
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.07em;
      color: #0E9CB5;
      border-bottom: 1px solid #BAE6F0;
      padding-bottom: 4px;
      margin-bottom: 8px;
    }

    /* Info grid */
    .info-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }

    .info-grid.single {
      grid-template-columns: 1fr;
    }

    .field {
      background: #F8FAFC;
      border: 1px solid #E2E8F0;
      border-radius: 6px;
      padding: 8px 10px;
    }

    .field.highlighted {
      background: #F0FBFF;
      border-color: #BAE6F0;
      grid-column: 1 / -1;
    }

    .field label {
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #94A3B8;
      display: block;
      margin-bottom: 3px;
    }

    .field p {
      font-size: 11px;
      color: #1E293B;
      line-height: 1.5;
      min-height: 16px;
      word-wrap: break-word;
    }

    /* Risk assessment fields */
    .risk-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }

    .risk-field {
      border-radius: 6px;
      padding: 8px 10px;
      border: 1px solid;
    }

    .risk-field.risks {
      background: #FFF7ED;
      border-color: #FED7AA;
    }

    .risk-field.measures {
      background: #F0FDF4;
      border-color: #BBF7D0;
    }

    .risk-field label {
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      display: block;
      margin-bottom: 3px;
    }

    .risk-field.risks label {
      color: #EA580C;
    }

    .risk-field.measures label {
      color: #16A34A;
    }

    .risk-field p {
      font-size: 11px;
      line-height: 1.5;
      min-height: 40px;
      word-wrap: break-word;
    }

    /* Approval section */
    .approval-row {
      display: flex;
      gap: 12px;
    }

    .approval-box {
      flex: 1;
      border: 1px solid #E2E8F0;
      border-radius: 6px;
      padding: 8px 10px;
      background: #F8FAFC;
    }

    .approval-box label {
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #94A3B8;
      display: block;
      margin-bottom: 3px;
    }

    .approval-box p {
      font-size: 11px;
      color: #1E293B;
      min-height: 16px;
    }

    .signature-line {
      border-bottom: 1px solid #CBD5E1;
      margin-top: 20px;
      margin-bottom: 3px;
    }

    .signature-label {
      font-size: 9px;
      color: #94A3B8;
    }

    /* Footer */
    .footer {
      margin-top: 16px;
      padding-top: 8px;
      border-top: 1px solid #E2E8F0;
      display: flex;
      justify-content: space-between;
      font-size: 9px;
      color: #94A3B8;
    }

    .status-badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 9px;
      font-weight: 700;
      background: #F0FDF4;
      color: #16A34A;
      border: 1px solid #BBF7D0;
    }

    /* Page break handling */
    @page {
      size: A4;
      margin: 0;
    }
  </style>
</head>
<body>

<!-- Header -->
<div class="header">
  <div class="header-left">
    ${
      company.logoBase64
        ? `<img src="${company.logoBase64}" class="logo" alt="company logo">`
        : ''
    }
    <h1>Sikker Jobb Analyse</h1>
    <div class="subtitle">SJA — utarbeidet i henhold til gjeldende HMS-krav</div>
  </div>
  <div class="header-right">
    ${
      company.logoBase64 ? `<div class="company-name">${e(company.name)}</div>` : ''
    }
    <div>${e(company.address)}</div>
    <div>${e(company.phone)}</div>
    <div>${e(company.email)}</div>
  </div>
</div>

<!-- Document metadata -->
<div class="doc-meta">
  <div class="meta-item">
    <label>SJA-nummer</label>
    <span>#${sja.id}</span>
  </div>
  <div class="meta-item">
    <label>Dato</label>
    <span>${dato}</span>
  </div>
  <div class="meta-item">
    <label>Tilknyttet ordre</label>
    <span>${e(sja.order_number) || 'Frittstående'}</span>
  </div>
  <div class="meta-item">
    <label>Status</label>
    <span class="status-badge">${sja.status === 'completed' ? '✓ Fullført' : 'Utkast'}</span>
  </div>
</div>

<!-- Oppdragsinformasjon -->
<div class="section">
  <div class="section-title">Oppdragsinformasjon</div>
  <div class="info-grid">
    <div class="field">
      <label>Tekniker</label>
      <p>${e(sja.technician_id)}</p>
    </div>
    <div class="field">
      <label>Arbeidssted / adresse</label>
      <p>${e(sja.location)}</p>
    </div>
    <div class="field highlighted">
      <label>Beskrivelse av arbeidsoperasjon</label>
      <p>${e(sja.job_description)}</p>
    </div>
  </div>
</div>

<!-- Risikovurdering -->
<div class="section">
  <div class="section-title">Risikovurdering</div>
  <div class="risk-grid">
    <div class="risk-field risks">
      <label>⚠ Identifiserte risikoer</label>
      <p>${e(sja.identified_risks)}</p>
    </div>
    <div class="risk-field measures">
      <label>✓ Tiltak / vernetiltak</label>
      <p>${e(sja.safety_measures)}</p>
    </div>
  </div>
</div>

<!-- Godkjenning -->
<div class="section">
  <div class="section-title">Godkjenning</div>
  <div class="approval-row">
    <div class="approval-box">
      <label>Godkjent av</label>
      <p>${e(sja.approved_by)}</p>
      <div class="signature-line"></div>
      <div class="signature-label">Signatur</div>
    </div>
    <div class="approval-box">
      <label>Dato og tidspunkt</label>
      <p>${timestamp}</p>
    </div>
  </div>
</div>

<!-- Footer -->
<div class="footer">
  <span>ServFix HMS — ${e(company.name)}</span>
  <span>Generert: ${new Date().toLocaleDateString('no-NO')}</span>
  <span>SJA #${sja.id}</span>
</div>

</body>
</html>`;
  }

  /**
   * Convert HTML to PDF using Puppeteer
   */
  async generatePdf(html) {
    if (!this.browser) {
      throw new Error('Browser not initialized — call init() first');
    }

    let page;
    try {
      page = await this.browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0', timeout: 45000 });
      await page.emulateMediaType('print');

      const buffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '0', right: '0', bottom: '0', left: '0' }
      });

      return buffer;
    } finally {
      if (page) {
        await page.close();
      }
    }
  }

  /**
   * Upload PDF buffer to GCS and return public URL
   */
  async uploadToGcs(tenantId, sjaId, buffer) {
    if (!this.bucket) {
      throw new Error('GCS bucket not configured');
    }

    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const fileName = `sja_${sjaId}_${Date.now()}.pdf`;
    const gcsPath = `tenants/${tenantId}/hms/sja/${yyyy}/${mm}/${fileName}`;

    try {
      const file = this.bucket.file(gcsPath);
      await file.save(buffer, { metadata: { contentType: 'application/pdf' } });

      const url = `https://storage.googleapis.com/${this.bucket.name}/${gcsPath}`;
      console.log(`✅ SJA PDF uploaded to GCS: ${url}`);
      return url;
    } catch (err) {
      console.error('❌ GCS upload failed:', err.message);
      throw err;
    }
  }

  /**
   * Main orchestrator method
   * Generates PDF from SJA data and stores URL in database
   */
  async generate(sjaId, tenantId) {
    await this.init();

    try {
      // Fetch SJA data including associated order number
      const pool = await db.getTenantConnection(tenantId);
      const result = await pool.query(
        `SELECT s.*, COALESCE(o.tripletex_order_id::varchar, o.id) AS order_number
         FROM hms_sja s
         LEFT JOIN orders o ON s.order_id = o.id
         WHERE s.id = $1`,
        [sjaId]
      );

      if (!result.rows.length) {
        throw new Error(`SJA #${sjaId} not found`);
      }

      const sja = result.rows[0];
      console.log(`📄 Generating PDF for SJA #${sjaId}...`);

      // Load company settings and branding
      const company = await this.loadCompanySettings(tenantId);

      // Generate HTML template
      const html = this.generateHtml(sja, company);

      // Convert HTML to PDF
      const buffer = await this.generatePdf(html);
      console.log(`✅ PDF generated (${buffer.length} bytes)`);

      // Upload to GCS
      const pdfUrl = await this.uploadToGcs(tenantId, sjaId, buffer);

      // Update database with PDF URL
      await pool.query(
        `UPDATE hms_sja SET pdf_url = $1 WHERE id = $2`,
        [pdfUrl, sjaId]
      );
      console.log(`✅ Database updated with PDF URL`);

      return { pdfUrl, buffer };
    } catch (err) {
      console.error('❌ PDF generation failed:', err.message);
      throw err;
    } finally {
      await this.close();
    }
  }
}

module.exports = SjaPdfGenerator;
