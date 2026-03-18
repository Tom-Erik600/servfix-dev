'use strict';

const puppeteer = require('puppeteer');
const db = require('../config/database');
const gcs = require('../config/gcs');

/**
 * RosPdfGenerator — Service for generating PDF documents for ROS (Risikovurdering og Sårbarhetsanalyse)
 * Follows the pattern from sjaPdfGenerator.js
 *
 * PDF generation ONLY works in GCP (Cloud Run with Puppeteer/Chromium installed).
 * Local Windows development will fail at Puppeteer launch with no fallback.
 */
class RosPdfGenerator {
  constructor() {
    this.browser = null;
    this.bucket = gcs.bucket;
  }

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
    } catch (err) {
      console.error('❌ RosPdfGenerator: Puppeteer launch failed:', err.message);
      throw err;
    }
  }

  async close() {
    if (!this.browser) return;

    try {
      await Promise.race([
        this.browser.close(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Browser close timed out')), 10000)
        )
      ]);
    } catch (err) {
      console.error('⚠️ RosPdfGenerator: Browser close timeout/error:', err.message);
      try {
        this.browser.process()?.kill('SIGKILL');
      } catch (_) {}
    } finally {
      this.browser = null;
    }
  }

  escapeHtml(str) {
    if (!str) return '—';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');
  }

  async loadCompanySettings(tenantId) {
    const defaults = {
      name: 'Air-Tech AS',
      address: 'Stanseveien 18, 0975 Oslo',
      phone: '+47 91 52 40 40',
      email: 'post@air-tech.no',
      logoBase64: null
    };

    if (!this.bucket) return defaults;

    try {
      const settingsPath = `tenants/${tenantId}/assets/settings.json`;
      const file = this.bucket.file(settingsPath);
      const [exists] = await file.exists();
      if (!exists) return defaults;

      const [contents] = await file.download();
      const settings = JSON.parse(contents.toString());

      if (settings.companyInfo) {
        defaults.name = settings.companyInfo.name || defaults.name;
        defaults.address = settings.companyInfo.address || defaults.address;
        defaults.phone = settings.companyInfo.phone || defaults.phone;
        defaults.email = settings.companyInfo.email || defaults.email;
      }

      if (settings.logo?.url) {
        try {
          const logoPath = settings.logo.url.replace(
            `https://storage.googleapis.com/${this.bucket.name}/`, ''
          );
          const logoFile = this.bucket.file(logoPath);
          const [logoExists] = await logoFile.exists();
          if (logoExists) {
            const [logoBuffer] = await logoFile.download();
            const ext = logoPath.split('.').pop().toLowerCase();
            const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
            defaults.logoBase64 = `data:${mime};base64,${logoBuffer.toString('base64')}`;
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
   * Build a 5×5 risk matrix HTML table.
   * Columns = Konsekvens (K) 1–5, Rows = Sannsynlighet (S) 5–1 (high to low).
   * The cell matching actual (s, k) gets a filled circle marker.
   */
  buildRiskMatrix(actualS, actualK) {
    const cellColor = (s, k) => {
      const score = s * k;
      if (score <= 4)  return { bg: '#DCFCE7', border: '#86EFAC', text: '#15803D' };
      if (score <= 9)  return { bg: '#FEF9C3', border: '#FDE047', text: '#A16207' };
      if (score <= 14) return { bg: '#FFEDD5', border: '#FDBA74', text: '#C2410C' };
      return              { bg: '#FEE2E2', border: '#FCA5A5', text: '#B91C1C' };
    };

    const colHeaders = [1, 2, 3, 4, 5];
    const rowHeaders = [5, 4, 3, 2, 1]; // S high to low

    let rows = '';
    for (const s of rowHeaders) {
      let cells = `<td class="matrix-axis-label">${s}</td>`;
      for (const k of colHeaders) {
        const { bg, border, text } = cellColor(s, k);
        const score = s * k;
        const isActive = (s === actualS && k === actualK);
        cells += `
          <td class="matrix-cell${isActive ? ' active' : ''}"
              style="background:${bg};border-color:${border};">
            <span class="cell-score" style="color:${text}">${score}</span>
            ${isActive ? '<span class="cell-dot">●</span>' : ''}
          </td>`;
      }
      rows += `<tr>${cells}</tr>`;
    }

    return `
      <table class="risk-matrix">
        <thead>
          <tr>
            <th class="matrix-corner">S \\ K</th>
            ${colHeaders.map(k => `<th class="matrix-axis-label">${k}</th>`).join('')}
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="matrix-legend">
        <span class="legend-item" style="background:#DCFCE7;border-color:#86EFAC">Lav (1–4)</span>
        <span class="legend-item" style="background:#FEF9C3;border-color:#FDE047">Middels (5–9)</span>
        <span class="legend-item" style="background:#FFEDD5;border-color:#FDBA74">Høy (10–14)</span>
        <span class="legend-item" style="background:#FEE2E2;border-color:#FCA5A5">Svært høy (15–25)</span>
      </div>`;
  }

  generateHtml(ros, company) {
    const e = this.escapeHtml.bind(this);
    const fd = ros.form_data || {};

    const s = parseInt(fd.s) || 0;
    const k = parseInt(fd.k) || 0;
    const score = s && k ? s * k : null;

    let scoreLabel = '—';
    let scoreBg = '#F4F7FA', scoreBorder = '#E2E8F0', scoreColor = '#64748B';
    if (score) {
      if (score <= 4)       { scoreBg='#DCFCE7'; scoreBorder='#86EFAC'; scoreColor='#15803D'; scoreLabel=`${score} — Lav risiko`; }
      else if (score <= 9)  { scoreBg='#FEF9C3'; scoreBorder='#FDE047'; scoreColor='#A16207'; scoreLabel=`${score} — Middels risiko`; }
      else if (score <= 14) { scoreBg='#FFEDD5'; scoreBorder='#FDBA74'; scoreColor='#C2410C'; scoreLabel=`${score} — Høy risiko`; }
      else                  { scoreBg='#FEE2E2'; scoreBorder='#FCA5A5'; scoreColor='#B91C1C'; scoreLabel=`${score} — Svært høy risiko`; }
    }

    const riskMatrixHtml = (s && k) ? this.buildRiskMatrix(s, k) : '<p style="color:#94A3B8;font-size:11px;">Sannsynlighet (S) og/eller Konsekvens (K) ikke angitt.</p>';

    const dato = new Date(ros.created_at).toLocaleDateString('no-NO', {
      day: 'numeric', month: 'long', year: 'numeric'
    });
    const oppdatert = new Date(ros.updated_at).toLocaleDateString('no-NO', {
      day: 'numeric', month: 'long', year: 'numeric'
    });

    return `<!DOCTYPE html>
<html lang="no">
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }

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
    .logo { max-height: 40px; max-width: 120px; margin-bottom: 4px; }

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
    .meta-item { flex: 1; }
    .meta-item label {
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #64748B;
      display: block;
      margin-bottom: 2px;
    }
    .meta-item span { font-size: 11px; font-weight: 600; color: #1E293B; }

    /* Sections */
    .section { margin-bottom: 13px; page-break-inside: avoid; }
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
    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
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
    .field.risk-field {
      background: #FFF7ED;
      border-color: #FED7AA;
    }
    .field.measure-field {
      background: #F0FDF4;
      border-color: #BBF7D0;
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
    .field.risk-field label { color: #EA580C; }
    .field.measure-field label { color: #16A34A; }
    .field p {
      font-size: 11px;
      color: #1E293B;
      line-height: 1.5;
      min-height: 16px;
      word-wrap: break-word;
    }

    /* Risk score badge */
    .score-badge {
      display: inline-block;
      padding: 6px 14px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 700;
      border: 1.5px solid;
    }

    /* Risk matrix */
    .matrix-wrap {
      display: flex;
      gap: 20px;
      align-items: flex-start;
    }
    .matrix-right { flex: 1; }

    .risk-matrix {
      border-collapse: collapse;
      font-size: 10px;
    }
    .risk-matrix th, .risk-matrix td {
      width: 30px;
      height: 26px;
      text-align: center;
      vertical-align: middle;
    }
    .matrix-corner {
      font-size: 9px;
      font-weight: 700;
      color: #64748B;
      background: #F8FAFC;
      border: 1px solid #E2E8F0;
    }
    .matrix-axis-label {
      font-size: 10px;
      font-weight: 700;
      color: #64748B;
      background: #F8FAFC;
      border: 1px solid #E2E8F0;
    }
    .matrix-cell {
      border: 1.5px solid;
      position: relative;
    }
    .matrix-cell.active {
      outline: 2.5px solid #1E293B;
      outline-offset: -2px;
    }
    .cell-score {
      font-size: 9px;
      font-weight: 600;
    }
    .cell-dot {
      display: block;
      font-size: 10px;
      color: #1E293B;
      line-height: 1;
    }
    .matrix-axis-title {
      font-size: 9px;
      font-weight: 700;
      color: #64748B;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 4px;
    }
    .matrix-legend {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-top: 8px;
    }
    .legend-item {
      font-size: 9px;
      font-weight: 600;
      padding: 2px 7px;
      border-radius: 4px;
      border: 1px solid;
      color: #1E293B;
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

    @page { size: A4; margin: 0; }
  </style>
</head>
<body>

<!-- Header -->
<div class="header">
  <div class="header-left">
    ${company.logoBase64 ? `<img src="${company.logoBase64}" class="logo" alt="logo">` : ''}
    <h1>Risikovurdering og Sårbarhetsanalyse</h1>
    <div class="subtitle">ROS-analyse — utarbeidet i henhold til gjeldende HMS-krav</div>
  </div>
  <div class="header-right">
    ${company.logoBase64 ? `<div class="company-name">${e(company.name)}</div>` : `<div class="company-name">${e(company.name)}</div>`}
    <div>${e(company.address)}</div>
    <div>${e(company.phone)}</div>
    <div>${e(company.email)}</div>
  </div>
</div>

<!-- Document metadata -->
<div class="doc-meta">
  <div class="meta-item">
    <label>ROS-nummer</label>
    <span>#${ros.id}</span>
  </div>
  <div class="meta-item">
    <label>Tittel</label>
    <span>${e(ros.title)}</span>
  </div>
  <div class="meta-item">
    <label>Prosjekttype</label>
    <span>${e(ros.project_type) || '—'}</span>
  </div>
  ${ros.category ? `
  <div class="meta-item">
    <label>Arbeidskategori</label>
    <span>${e(ros.category)}</span>
  </div>` : ''}
  <div class="meta-item">
    <label>Opprettet</label>
    <span>${dato}</span>
  </div>
  <div class="meta-item">
    <label>Sist oppdatert</label>
    <span>${oppdatert}</span>
  </div>
  <div class="meta-item">
    <label>Versjon</label>
    <span>v${ros.version || 1}</span>
  </div>
</div>

<!-- Generell informasjon -->
<div class="section">
  <div class="section-title">Generell informasjon</div>
  <div class="info-grid">
    <div class="field">
      <label>Ansvarlig</label>
      <p>${e(fd.responsible)}</p>
    </div>
    <div class="field highlighted">
      <label>Aktuelle problemstillinger</label>
      <p>${e(fd.problems)}</p>
    </div>
  </div>
</div>

<!-- Risikovurdering -->
<div class="section">
  <div class="section-title">Risikovurdering</div>
  <div class="info-grid">
    <div class="field risk-field">
      <label>⚠ Mulig risiko — Hva kan gå galt?</label>
      <p>${e(fd.risks)}</p>
    </div>
    <div class="field risk-field">
      <label>⚠ Antatt konsekvens</label>
      <p>${e(fd.consequence)}</p>
    </div>
  </div>
</div>

<!-- Risikomatrise -->
<div class="section">
  <div class="section-title">Risikomatrise</div>
  <div class="matrix-wrap">
    <div>
      <div class="matrix-axis-title">S = Sannsynlighet &nbsp;·&nbsp; K = Konsekvens</div>
      ${riskMatrixHtml}
    </div>
    <div class="matrix-right">
      <div class="field" style="margin-bottom:8px;">
        <label>Beregnet risikoverdi (S × K)</label>
        <p>
          ${score
            ? `<span class="score-badge" style="background:${scoreBg};border-color:${scoreBorder};color:${scoreColor};">${scoreLabel}&nbsp;&nbsp;(S=${s} × K=${k})</span>`
            : '<span style="color:#94A3B8;">Ikke beregnet</span>'
          }
        </p>
      </div>
    </div>
  </div>
</div>

<!-- Tiltak -->
<div class="section">
  <div class="section-title">Tiltak</div>
  <div class="info-grid">
    <div class="field measure-field">
      <label>✓ Tiltak i prosjekteringsfasen</label>
      <p>${e(fd.measures)}</p>
    </div>
    <div class="field measure-field">
      <label>✓ Tiltak i utførelsesfasen</label>
      <p>${e(fd.executionMeasures)}</p>
    </div>
  </div>
</div>

${(() => {
  const sr = parseInt(fd.s_rest) || 0;
  const kr = parseInt(fd.k_rest) || 0;
  const rScore = sr && kr ? sr * kr : null;
  if (!rScore) return '';
  let rBg, rBorder, rColor, rLabel;
  if (rScore <= 4)       { rBg='#DCFCE7'; rBorder='#86EFAC'; rColor='#15803D'; rLabel='Lav risiko'; }
  else if (rScore <= 9)  { rBg='#FEF9C3'; rBorder='#FDE047'; rColor='#A16207'; rLabel='Middels risiko'; }
  else if (rScore <= 14) { rBg='#FFEDD5'; rBorder='#FDBA74'; rColor='#C2410C'; rLabel='Høy risiko'; }
  else                   { rBg='#FEE2E2'; rBorder='#FCA5A5'; rColor='#B91C1C'; rLabel='Svært høy risiko'; }
  return `
<!-- Restrisiko -->
<div class="section">
  <div class="section-title">Restrisiko etter tiltak</div>
  <div class="info-grid">
    <div class="field">
      <label>Restrisikoverdi (S × K) etter tiltak</label>
      <p><span class="score-badge" style="background:${rBg};border-color:${rBorder};color:${rColor};">${rScore} — ${rLabel}&nbsp;&nbsp;(S=${sr} × K=${kr})</span></p>
    </div>
  </div>
</div>`;
})()}

<!-- Footer -->
<div class="footer">
  <span>ServFix HMS — ${e(company.name)}</span>
  <span>Generert: ${new Date().toLocaleDateString('no-NO')}</span>
  <span>ROS #${ros.id} · v${ros.version || 1}</span>
</div>

</body>
</html>`;
  }

  async generatePdf(html) {
    if (!this.browser) throw new Error('Browser not initialized — call init() first');

    let page;
    try {
      page = await this.browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0', timeout: 45000 });
      await page.emulateMediaType('print');
      return await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '0', right: '0', bottom: '0', left: '0' }
      });
    } finally {
      if (page) await page.close();
    }
  }

  /**
   * Fetches ROS data and returns a PDF buffer.
   * Does not upload to GCS — caller streams buffer directly to client.
   */
  async generate(rosId, tenantId) {
    await this.init();

    try {
      const pool = await db.getTenantConnection(tenantId);
      const result = await pool.query(
        `SELECT * FROM hms_ros WHERE id = $1`,
        [parseInt(rosId)]
      );

      if (!result.rows.length) throw new Error(`ROS #${rosId} ikke funnet`);

      const ros = result.rows[0];
      const company = await this.loadCompanySettings(tenantId);
      const html = this.generateHtml(ros, company);
      return await this.generatePdf(html);
    } finally {
      await this.close();
    }
  }
}

module.exports = RosPdfGenerator;
