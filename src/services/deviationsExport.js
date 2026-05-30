'use strict';

const { launchBrowserSafely } = require('../utils/safePuppeteer');
const nodeFetch = globalThis.fetch || require('node-fetch');

function generateDeviationsCsv(deviations) {
  const BOM = '\uFEFF';
  const HEADERS = ['id','equipmentName','checklistItemLabel','status','severity','openedAt','daysOpen','assignedToName','deadline','observationCount','closedAt','closureMode','closureComment'];

  function escapeField(value) {
    if (value === null || value === undefined) return '';
    const str = String(value);
    if (str.includes(',') || str.includes('\n') || str.includes('\r') || str.includes('"')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }

  function formatDate(val) {
    if (!val) return '';
    const d = val instanceof Date ? val : new Date(val);
    if (isNaN(d.getTime())) return '';
    return d.toISOString().slice(0, 10);
  }

  const rows = [HEADERS.join(',')];

  for (const d of deviations) {
    const openedMs = d.openedAt instanceof Date ? d.openedAt.getTime() : new Date(d.openedAt).getTime();
    const closedMs = d.closedAt ? (d.closedAt instanceof Date ? d.closedAt.getTime() : new Date(d.closedAt).getTime()) : Date.now();
    const daysOpen = Math.floor((closedMs - openedMs) / 86400000);

    const fields = [
      d.id,
      d.equipmentName,
      d.checklistItemLabel,
      d.status,
      d.severity,
      formatDate(d.openedAt),
      daysOpen >= 0 ? daysOpen : 0,
      d.assignedToName,
      formatDate(d.deadline),
      d.observationCount,
      formatDate(d.closedAt),
      d.closureMode,
      d.closureComment
    ];
    rows.push(fields.map(escapeField).join(','));
  }

  return BOM + rows.join('\r\n');
}

async function fetchAsBase64(url) {
  if (!url || url.startsWith('data:')) return url;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await nodeFetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    const mime = url.endsWith('.png') ? 'image/png' : url.endsWith('.gif') ? 'image/gif' : 'image/jpeg';
    return `data:${mime};base64,${buffer.toString('base64')}`;
  } catch (e) {
    return null;
  }
}

async function inlineImagesForPdf(imageUrls, maxImages = 6) {
  const limited = imageUrls.slice(0, maxImages);
  const extra = imageUrls.length - limited.length;
  const results = await Promise.allSettled(limited.map(url => fetchAsBase64(url)));
  return { inlined: results.map(r => r.status === 'fulfilled' ? r.value : null), extra };
}

function formatDateNorsk(val) {
  if (!val) return '';
  const d = val instanceof Date ? val : new Date(val);
  if (isNaN(d.getTime())) return '';
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${day}.${month}.${d.getFullYear()}`;
}

function escapeHtml(str) {
  return String(str || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function generateDeviationsPdf(deviations, tenantSettings = {}, options = {}) {
  const companyName = tenantSettings?.companyInfo?.name || '';
  const logoUrl = tenantSettings?.logo?.url || null;

  const logoBase64 = logoUrl ? await fetchAsBase64(logoUrl) : null;

  const today = new Date();
  const generatedDate = formatDateNorsk(today);

  const devCards = [];
  for (const dev of deviations) {
    const observations = (dev.observations || []).slice(0, 20);
    const extraObs = (dev.observations || []).length - observations.length;

    const imageUrls = (dev.images || []).map(img => img.image_url || img.url).filter(Boolean);
    const { inlined: inlinedImages, extra: extraImgs } = await inlineImagesForPdf(imageUrls, 6);

    const obsHtml = observations.map(obs => `
      <div class="obs-item">
        <span class="obs-date">${formatDateNorsk(obs.observed_at || obs.createdAt)}</span>
        <span class="obs-text">${escapeHtml(obs.comment || obs.text || '')}</span>
      </div>
    `).join('');

    const imgsHtml = inlinedImages.map(src => src
      ? `<img src="${src}" style="max-width:120px;max-height:120px;object-fit:cover;border-radius:4px;" alt="Bilde">`
      : `<div class="img-fallback">(bilde finnes)</div>`
    ).join('');

    devCards.push(`
      <div class="dev-card">
        <div class="dev-header">
          <span class="dev-id">#${dev.id}</span>
          <span class="dev-equipment">${escapeHtml(dev.equipmentName)}</span>
          <span class="dev-severity sev-${dev.severity || ''}">${dev.severity || ''}</span>
          <span class="dev-status">${dev.status || ''}</span>
        </div>
        <div class="dev-meta">
          <span>Sjekkpunkt: ${escapeHtml(dev.checklistItemLabel)}</span>
          <span>Åpnet: ${formatDateNorsk(dev.openedAt)}</span>
          ${dev.deadline ? `<span>Deadline: ${formatDateNorsk(dev.deadline)}</span>` : ''}
          ${dev.assignedToName ? `<span>Tildelt: ${escapeHtml(dev.assignedToName)}</span>` : ''}
        </div>
        ${observations.length > 0 ? `
          <div class="dev-obs">
            <h4>Observasjoner (${observations.length})</h4>
            ${obsHtml}
            ${extraObs > 0 ? `<p class="overflow-note">+ ${extraObs} observasjoner ikke vist</p>` : ''}
          </div>
        ` : ''}
        ${inlinedImages.length > 0 ? `
          <div class="dev-images">
            ${imgsHtml}
            ${extraImgs > 0 ? `<p class="overflow-note">+ ${extraImgs} bilder ikke vist</p>` : ''}
          </div>
        ` : ''}
      </div>
    `);
  }

  const html = `<!DOCTYPE html>
<html lang="no">
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; font-size: 12px; color: #333; margin: 0; padding: 0; }
    .header { display: flex; align-items: center; gap: 16px; padding: 20px 30px; border-bottom: 2px solid #E5E7EB; }
    .header img { max-height: 60px; }
    .header-text h1 { font-size: 18px; margin: 0 0 4px 0; }
    .header-text p { font-size: 11px; color: #6B7280; margin: 0; }
    .summary { padding: 16px 30px; background: #F9FAFB; border-bottom: 1px solid #E5E7EB; font-size: 12px; }
    .dev-card { margin: 16px 30px; padding: 16px; border: 1px solid #E5E7EB; border-radius: 6px; page-break-inside: avoid; }
    .dev-header { display: flex; gap: 12px; align-items: center; margin-bottom: 8px; flex-wrap: wrap; }
    .dev-id { font-weight: 700; color: #374151; }
    .dev-equipment { font-weight: 600; }
    .dev-severity { padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; }
    .sev-høy { background: #FEE2E2; color: #B91C1C; }
    .sev-medium { background: #FEF3C7; color: #92400E; }
    .sev-lav { background: #D1FAE5; color: #065F46; }
    .dev-status { font-size: 11px; color: #6B7280; }
    .dev-meta { font-size: 11px; color: #6B7280; display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 10px; }
    .dev-obs h4 { font-size: 11px; font-weight: 600; margin: 8px 0 4px 0; color: #374151; }
    .obs-item { font-size: 11px; padding: 4px 0; border-bottom: 1px solid #F3F4F6; }
    .obs-date { color: #9CA3AF; margin-right: 8px; }
    .dev-images { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
    .img-fallback { width: 80px; height: 60px; background: #F3F4F6; border-radius: 4px; display: flex; align-items: center; justify-content: center; font-size: 10px; color: #9CA3AF; }
    .overflow-note { font-size: 11px; color: #9CA3AF; margin: 4px 0; font-style: italic; }
  </style>
</head>
<body>
  <div class="header">
    ${logoBase64 ? `<img src="${logoBase64}" alt="Logo">` : ''}
    <div class="header-text">
      <h1>${escapeHtml(companyName) || 'Avviksrapport'}</h1>
      <p>Generert: ${generatedDate} &nbsp;|&nbsp; Antall avvik: ${deviations.length}</p>
    </div>
  </div>
  <div class="summary">
    <strong>Totalt: ${deviations.length} avvik</strong>
  </div>
  ${devCards.join('\n')}
</body>
</html>`;

  const browser = await launchBrowserSafely();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdfBuffer = await page.pdf({
      format: 'A4',
      landscape: false,
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: '<div style="font-size:9px;text-align:center;width:100%;color:#9CA3AF;">Side <span class="pageNumber"></span> av <span class="totalPages"></span></div>',
      margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' }
    });
    await page.close();
    return Buffer.from(pdfBuffer);
  } finally {
    await browser.close();
  }
}

module.exports = { generateDeviationsCsv, generateDeviationsPdf };
