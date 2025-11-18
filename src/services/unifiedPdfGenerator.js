// src/services/unifiedPdfGenerator.js
'use strict';

const path = require('path');
const fs = require('fs').promises;
const puppeteer = require('puppeteer');
const { Storage } = require('@google-cloud/storage');
const db = require('../config/database');

class UnifiedPDFGenerator {
  constructor() {
    this.browser = null;
    
    // Intelligent bucket selection
    let bucketName = process.env.GCS_BUCKET_NAME;
    if (!bucketName) {
      const env = process.env.NODE_ENV || 'development';
      if (env === 'production') {
        bucketName = 'servfix-files';
        console.warn('⚠️ UnifiedPDF: Using fallback prod bucket');
      } else if (env === 'staging' || env === 'test') {
        bucketName = 'servfix-files-test';
        console.warn('⚠️ UnifiedPDF: Using fallback test bucket');
      }
      // In development, leave as undefined (GCS will be disabled)
    }

    if (bucketName) {
      try {
        this.storage = new Storage({ projectId: process.env.GCP_PROJECT_ID || undefined });
        this.bucket = this.storage.bucket(bucketName);
        console.log('✅ GCS init:', bucketName);
      } catch (e) {
        console.warn('⚠️  GCS init feilet:', e.message);
        this.storage = null; this.bucket = null;
      }
    } else {
      console.warn('ℹ️ Ingen GCS bucket konfigurert.');
      this.storage = null; this.bucket = null;
    }
  }

  /* ===========================
   * Lifecycle
   * =========================== */
  async init() {
    if (this.browser) return;
    const opts = {
      headless: process.env.NODE_ENV === 'production' ? true : 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    };
    try {
      this.browser = await puppeteer.launch(opts);
    } catch (err) {
      console.error('❌ Puppeteer launch feilet, fallback:', err.message);
      this.browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    }
  }

  async close() {
    if (!this.browser) return;
    try { await this.browser.close(); } catch (_) {}
    this.browser = null;
  }

  /* ===========================
   * Helpers
   * =========================== */
  safeJsonParse(input, fallback) {
    try {
      if (!input) return fallback;
      if (typeof input === 'object') return input;
      return JSON.parse(input);
    } catch { return fallback; }
  }

  escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* ===========================
   * Company settings (logo / info)
   * =========================== */
  async loadCompanySettings(tenantId) {
  console.log(`🔧 Loading company settings from JSON for tenant: ${tenantId}`);
  
  // Default settings
  const defaults = {
    company: {
      name: 'Air-Tech AS',
      address: 'Stanseveien 18, 0975 Oslo',
      phone: '+47 91 52 40 40',
      email: 'post@air-tech.no',
      orgnr: '889 558 652',
      website: 'www.air-tech.no',
    },
    logoBase64: null,
  };

  if (!this.bucket) {
    console.warn('⚠️ No GCS bucket, using defaults');
    return defaults;
  }

  try {
    // Last settings.json fra GCS
    const settingsPath = `tenants/${tenantId}/assets/settings.json`;
    const settingsFile = this.bucket.file(settingsPath);
    const [settingsExists] = await settingsFile.exists();
    
    let settings = {};
    if (settingsExists) {
      const [contents] = await settingsFile.download();
      settings = JSON.parse(contents.toString());
      console.log('✅ Settings loaded from GCS JSON');
      
      // Oppdater company-info fra settings.json
      if (settings.companyInfo) {
        defaults.company = {
          name: settings.companyInfo.name || defaults.company.name,
          address: settings.companyInfo.address || defaults.company.address,
          phone: settings.companyInfo.phone || defaults.company.phone,
          email: settings.companyInfo.email || defaults.company.email,
          orgnr: settings.companyInfo.cvr || defaults.company.orgnr,
          website: defaults.company.website,
        };
        console.log('✅ Company info loaded from settings:', defaults.company);
      }
    } else {
      console.log('ℹ️ No settings file found, using defaults');
    }
    
    // Last logo hvis det finnes
    if (settings.logo && settings.logo.url) {
      try {
        console.log(`📥 Attempting to load logo from: ${settings.logo.url}`);
        
        const bucketName = this.bucket.name;
        const logoPath = settings.logo.url.replace(`https://storage.googleapis.com/${bucketName}/`, '');
        const logoFile = this.bucket.file(logoPath);
        const [logoExists] = await logoFile.exists();
        
        if (logoExists) {
          const [logoBuffer] = await logoFile.download();
          const logoExtension = logoPath.split('.').pop().toLowerCase();
          const mimeType = logoExtension === 'png' ? 'image/png' : 'image/jpeg';
          defaults.logoBase64 = `data:${mimeType};base64,${logoBuffer.toString('base64')}`;
          console.log('✅ Logo loaded and converted to base64');
        } else {
          console.warn('⚠️ Logo file does not exist in GCS:', logoPath);
        }
      } catch (logoError) {
        console.error('❌ Error loading logo:', logoError.message);
      }
    } else {
      console.log('ℹ️ No logo URL in settings');
    }
    
    return defaults;
    
  } catch (error) {
    console.error('❌ Error loading settings:', error.message);
    return defaults;
  }
}

  /* ===========================
   * DB Fetch
   * =========================== */
  async fetchReportData(reportId, tenantId) {
    const pool = await db.getTenantConnection(tenantId);
    const q = `
      SELECT 
        sr.id, sr.order_id, sr.equipment_id, sr.checklist_data, sr.photos,
        sr.products_used, sr.additional_work,
        sr.status, sr.completed_at, sr.created_at,
        o.id AS order_number, o.customer_name, o.customer_data, o.scheduled_date AS service_date,
        e.systemnavn AS equipment_name, e.systemtype AS equipment_type, e.location AS equipment_location, e.systemnummer AS equipment_serial,
  e.betjener AS equipment_betjener,
        t.name AS technician_name,
        ARRAY_AGG(
          json_build_object(
            'report_id', sr2.id, 'equipment_id', sr2.equipment_id, 'equipment_name', e2.systemnavn,
            'equipment_type', e2.systemtype, 'equipment_location', e2.plassering, 'system_nummer', e2.systemnummer,
    'equipment_betjener', e2.betjener,
            'checklist_data', sr2.checklist_data, 'photos', sr2.photos
          )
        ) FILTER (WHERE sr2.id IS NOT NULL) AS all_reports
      FROM service_reports sr
      LEFT JOIN orders o ON o.id = sr.order_id
      LEFT JOIN equipment e ON e.id = sr.equipment_id
      LEFT JOIN technicians t ON t.id = o.technician_id
      LEFT JOIN service_reports sr2 ON sr2.order_id = sr.order_id AND sr2.status = 'completed'
      LEFT JOIN equipment e2 ON e2.id = sr2.equipment_id
      WHERE sr.id = $1
      GROUP BY sr.id, o.id, e.id, t.id
      LIMIT 1;
    `;
    const { rows } = await pool.query(q, [reportId]);
    if (!rows.length) throw new Error(`Report not found: ${reportId}`);
    const row = rows[0];

    row.customer_data = this.safeJsonParse(row.customer_data, {});
    row.checklist_data = this.safeJsonParse(row.checklist_data, {});
    row.photos = this.safeJsonParse(row.photos, []) || [];
    // Parse products og additional work fra database-kolonner
    row.products_used = this.safeJsonParse(row.products_used, []) || [];
    row.additional_work = this.safeJsonParse(row.additional_work, []) || [];

    console.log('📦 Products from DB:', row.products_used.length, 'items');
    console.log('🔧 Additional work from DB:', row.additional_work.length, 'items');
    row.all_reports = (row.all_reports || []).map(r => ({
      ...r,
      checklist_data: this.safeJsonParse(r.checklist_data, {}),
      photos: this.safeJsonParse(r.photos, []) || [],
    }));

    const allReportIds = (row.all_reports || []).map(r => r.report_id).filter(id => id);
    if (!allReportIds.includes(reportId)) allReportIds.push(reportId);

    const avvikImagesQ = `
      SELECT service_report_id, checklist_item_id, image_url, metadata
      FROM avvik_images WHERE service_report_id = ANY($1::text[])
    `;
    const avvikRes = await pool.query(avvikImagesQ, [allReportIds]);
    row.avvik_images = avvikRes.rows || [];
    console.log(`📸 Loaded ${row.avvik_images.length} avvik images for order ${row.order_id}`);
    
    return { ...row, tenant_id: tenantId };
  }

  /* ===========================
   * Normalisering & Data Helpers
   * =========================== */
  normalizeChecklistStructure(checklist) {
    if (!checklist) return { components: [] };
    if (Array.isArray(checklist.components)) return checklist;
    if (checklist?.checklist) return { components: [{ name: 'Sjekkliste', checklist: checklist.checklist }] };
    return { components: [] };
  }

  async fetchChecklistTemplate(tenantId, equipmentType) {
    try {
      const pool = await db.getTenantConnection(tenantId);
      const res = await pool.query('SELECT template_data FROM checklist_templates WHERE equipment_type = $1 LIMIT 1', [equipmentType]);
      return res.rows.length ? this.safeJsonParse(res.rows[0].template_data, { checklistItems: [] }) : { checklistItems: [] };
    } catch { return { checklistItems: [] }; }
  }

  generateFallbackName(itemId) {
    if (!itemId) return 'Ukjent punkt';
    const text = itemId.replace(/_/g, ' ');
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  itemHasData(checkpoint) {
    const s = (checkpoint.status || '').toLowerCase();
    return s && s !== 'na' && s !== 'ikke relevant';
  }

  buildEquipmentOverview(data) {
    data.all_equipment = (data.all_reports || []).map(r => ({
      systemtype: r.equipment_type || 'System',
      systemnummer: r.system_nummer || 'N/A',
      plassering: r.equipment_location || 'Ikke spesifisert',
      betjener: r.equipment_betjener || 'Ikke spesifisert',
    }));
  }

  /* ===========================
   * Bildebehandling
   * =========================== */
  async fetchAsBuffer(url) {
    if (url.startsWith('https://storage.googleapis.com/')) {
      if (!this.bucket) throw new Error('GCS bucket is not initialized');
      const bucketName = this.bucket.name;
      const relativePath = url.replace(`https://storage.googleapis.com/${bucketName}/`, '');
      const [buffer] = await this.bucket.file(relativePath).download();
      return buffer;
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  async inlineAllImages(data) {
    const collect = [];
    (data.documentation_photos || []).forEach(p => p?.url && collect.push(p));
    (data.equipmentSections || []).forEach(sec => (sec.checkpoints || []).forEach(cp => (cp.images || []).forEach(img => img?.url && collect.push(img))));
    (data.avvik || []).forEach(a => (a.images || []).forEach(img => img?.url && collect.push(img)));
    
    console.log(`🖼️ Converting ${collect.length} images to base64...`);
    for (const obj of collect) {
      if (!obj.url || obj.url.startsWith('data:')) continue;
      try {
        const buf = await this.fetchAsBuffer(obj.url);
        const mime = obj.url.endsWith('.png') ? 'image/png' : obj.url.endsWith('.gif') ? 'image/gif' : 'image/jpeg';
        obj.url = `data:${mime};base64,${buf.toString('base64')}`;
      } catch (e) {
        console.error(`  ❌ Image conversion failed:`, e.message);
      }
    }
    console.log(`✅ Image conversion complete`);
    return data;
  }

  /* ===========================
   * Prosessering til PDF-modell
   * =========================== */
  async processAirTechData(row) {
    const data = { ...row };
    this.buildEquipmentOverview(data);

    const result = { equipmentSections: [], avvik: [] };
    let avvikCounter = 1;

    // Bygg "super-kart" for avviksbilder med nøkkelen: "rapportId:tekniskId"
    const imagesByReportAndItem = {};
    (data.avvik_images || []).forEach(img => {
      const normalizedId = (img.checklist_item_id || '').toLowerCase().trim();
      if (!img.service_report_id || !normalizedId) return;
      const key = `${img.service_report_id}:${normalizedId}`;
      imagesByReportAndItem[key] = imagesByReportAndItem[key] || [];
      imagesByReportAndItem[key].push(img);
    });

    if (Array.isArray(data.all_reports)) {
      for (const report of data.all_reports) {
        // ==================================================================
        // FIKS 1: Hent riktig mal for HVERT anlegg inne i løkken
        // ==================================================================
        const template = await this.fetchChecklistTemplate(data.tenant_id, report.equipment_type);
        
        const normalized = this.normalizeChecklistStructure(report.checklist_data);
        if (!normalized?.components?.length) continue;

        const systemRef = `${report.system_nummer || 'N/A'} - ${report.equipment_name || ''}`;
        
        // ✅ VIKTIG: Hent driftSchedule UTENFOR component-loop
        // Driftstider gjelder for hele anlegget, ikke per component
        const driftSchedule = report.checklist_data?.driftSchedule || {};

        console.log(`📅 Driftstider for ${report.equipment_name}:`, {
          hasDriftSchedule: Object.keys(driftSchedule).length > 0,
          driftScheduleKeys: Object.keys(driftSchedule),
          firstDay: driftSchedule['mandag']
        });

        normalized.components.forEach(component => {
          if (!component.checklist) return;
          // ALLTID bruk systemRef som overskrift (inneholder systemnummer og navn)
          const sectionName = systemRef;
          const checkpoints = [];

          Object.entries(component.checklist).forEach(([transformedId, itemData]) => {
            const templateItem = (template.checklistItems || []).find(tItem => {
              const labelKey = ((tItem.label || tItem.name) || '').trim().toLowerCase().replace(/\s+/g, '_').replace(/[^\w_æøå]/g, '');
              return labelKey === transformedId;
            });

            // ==================================================================
            // FIKS 2: Korrekt fallback-logikk. Vi MÅ ha en original ID.
            // ==================================================================
            if (!templateItem) return; // Hvis vi ikke finner sjekkpunktet i malen, kan vi ikke fortsette
            const originalItemId = templateItem.id;
            
            const normalizedOriginalId = (originalItemId || '').toLowerCase().trim();
            const imageKey = `${report.report_id}:${normalizedOriginalId}`;
            const imagesForThisItem = imagesByReportAndItem[imageKey] || [];
            
            const actualName = templateItem.label || templateItem.name;

            const cp = {
              item_id: originalItemId,
              name: actualName,
              status: (itemData.status || 'ok').toUpperCase(),
              comment: itemData.avvikComment || itemData.byttetComment || itemData.comment || '',
              images: imagesForThisItem.map(img => ({ url: img.image_url, description: img.metadata?.description || '' })),
            };
            checkpoints.push(cp);

            if ((itemData.status || '').toLowerCase() === 'avvik') {
              result.avvik.push({
                item_id: originalItemId,
                avvik_id: String(avvikCounter++).padStart(3, '0'),
                systemnummer: report.system_nummer || 'N/A',
                systemnavn: report.equipment_name || '',
                komponent: actualName,
                kommentar: itemData.avvikComment || itemData.comment || 'Ingen beskrivelse',
                images: imagesForThisItem.map(img => ({ url: img.image_url, description: img.metadata?.description || '' })),
              });
            }
          });
          
          const filtered = checkpoints.filter(cp => this.itemHasData(cp));
          if (filtered.length > 0) {
            // ✅ Bruk driftSchedule fra report-nivå, ikke component-nivå
            result.equipmentSections.push({ 
              name: sectionName, 
              system_ref: systemRef, 
              checkpoints: filtered,
              driftSchedule: driftSchedule  // ✅ Fra report.checklist_data
            });
          }
        });
      }
    }
    
    // Håndter dokumentasjonsbilder (generelle bilder)
    data.documentation_photos = (data.all_reports || []).reduce((acc, r) => acc.concat(r.photos || []), [])
      .map(url => typeof url === 'string' ? { url, caption: '' } : url);
    
    // ==================================================================
    // FIKS 3: Korrekt bruk av camelCase for oppsummering
    // ==================================================================
    const primaryReportData = data.checklist_data || (data.all_reports && data.all_reports[0]?.checklist_data);
    if (primaryReportData) {
      data.overallComment = primaryReportData.overallComment || '';
    }

    // Bruk alltid row-level products_used og additional_work (ikke fra checklist_data)
    data.products_used = data.products_used || [];
    data.additional_work = data.additional_work || [];

    console.log('🔍 processAirTechData - Final data check:', {
      hasProducts: data.products_used.length > 0,
      hasWork: data.additional_work.length > 0,
      productCount: data.products_used.length,
      workCount: data.additional_work.length
    });

    return { ...data, ...result };
  }

  /* ===========================
   * Rendering (HTML & CSS)
   * =========================== */
  getReportTheme(equipmentTypeRaw) {
    const equipmentType = (equipmentTypeRaw || '').toLowerCase();
    const themes = {
      boligventilasjon: { title: 'SERVICERAPPORT BOLIGVENTILASJON' },
      default: { title: 'SERVICERAPPORT' },
    };
    return themes[equipmentType] || themes.default;
  }

  renderEquipmentOverviewTable(data) {
    const systems = data.all_equipment || [];
    if (!systems.length) return '';
    
    // NYTT: Hent systemfelter fra første system (alle har samme mal)
    const firstReport = (data.all_reports || [])[0];
    const systemData = firstReport?.checklist_data?.systemData || {};
    const template = firstReport?.checklist_data?.metadata?.template || {};
    const systemFields = template.systemFields || [];
    
    // NYTT: Bygg dynamisk systemfelter-visning
    const systemFieldsHTML = systemFields
      .sort((a, b) => a.order - b.order)
      .map(field => {
        const value = systemData[field.name] || 'Ikke spesifisert';
        return `<strong>${this.escapeHtml(field.label)}:</strong> ${this.escapeHtml(value)}`;
      })
      .join(', ');
    
    const systemFieldsSection = systemFieldsHTML ? 
      `<p style="font-size: 11pt; margin-bottom: 12px; line-height: 1.6;">${systemFieldsHTML}</p>` : '';
    
    // Eksisterende tabell
    const rows = systems.map(e => `
      <tr>
        <td>${this.escapeHtml(e.systemtype)}</td>
        <td>${this.escapeHtml(e.systemnummer)}</td>
        <td>${this.escapeHtml(e.plassering)}</td>
        <td>${this.escapeHtml(e.betjener)}</td>
      </tr>`).join('');
    
    return `
      <section class="section avoid-break">
        <h2 class="section-header">Systemoversikt</h2>
        ${systemFieldsSection}
        <table class="styled-table equipment-overview">
          <thead><tr><th>Systemtype</th><th>Systemnummer</th><th>Plassering</th><th>Betjener</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </section>`;
  }

  renderAvvikTable(data) {
  console.log('🔍 renderAvvikTable called with:', {
    hasAvvik: !!data.avvik,
    avvikLength: data.avvik?.length || 0,
    avvikData: data.avvik
  });
  
  if (!data.avvik || !data.avvik.length) {
    console.log('⚠️ No avvik to render - showing "Ingen avvik" message');
    return `
      <section class="section avoid-break avvik-section">
        <h2 class="section-header">Registrerte avvik</h2>
        <p style="font-size: 13pt; font-weight: 600; color: #059669; margin: 20px 0; text-align: center;">
          Ingen avvik funnet!
        </p>
      </section>`;
  }
  
  const rows = data.avvik.map(a => `
    <tr>
      <td>${this.escapeHtml(a.avvik_id)}</td>
      <td>${this.escapeHtml(a.systemnavn)}</td>
      <td>${this.escapeHtml(a.systemnummer)}</td>
      <td>${this.escapeHtml(a.komponent)}</td>
      <td>${this.escapeHtml(a.kommentar)}</td>
    </tr>`).join('');
  
  console.log(`✅ Rendering ${data.avvik.length} avvik rows`);
  
  return `
    <section class="section avoid-break avvik-section">
      <h2 class="section-header">Registrerte avvik</h2>
      <p>Følgende avvik ble registrert under servicen.</p>
      <table class="styled-table avvik-table">
        <thead><tr><th>Avvik ID</th><th>Anlegg</th><th>Systemnummer</th><th>Komponent</th><th>Kommentar</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </section>`;
}

  renderChecklistResults(data) {
    if (!data.equipmentSections || !data.equipmentSections.length) return '';
    
    return data.equipmentSections.map(section => {
      const rows = section.checkpoints.map(cp => {
        const statusClass = `status-${(cp.status || '').toLowerCase()}`;
        
        const imagesHtml = (cp.images && cp.images.length > 0) ? `
          <div class="checklist-images">
            <div class="images-grid-inline">
              ${cp.images.map(img => `
                <div class="image-container-inline">
                  <img src="${img.url}" class="checklist-image" alt="${this.escapeHtml(img.description || 'Bilde')}"/>
                  ${img.description ? `<span class="image-caption">${this.escapeHtml(img.description)}</span>` : ''}
                </div>
              `).join('')}
            </div>
          </div>` : '';

        const statusBadge = cp.status ? `<span class="status-badge status-${cp.status.toLowerCase()}">${this.escapeHtml(cp.status)}</span>` : '';
        const merknad = cp.comment ? `<span class="merknad-text">${this.escapeHtml(cp.comment)}</span>` : '';

        return `
          <tr>
            <td>${this.escapeHtml(cp.name)}</td>
            <td style="text-align:center;">${statusBadge}</td>
            <td>
              <div class="merknad-cell">
                ${merknad}
                ${imagesHtml}
              </div>
            </td>
          </tr>`;
      }).join('');

      // ============ NYT TILLEGG: DRIFTSTIDER =============
      const driftScheduleHtml = section.driftSchedule ? this.renderDriftSchedule(section.driftSchedule) : '';
const productsHtml = (data.products_used && data.products_used.length > 0) ? this.renderProductsTable(data.products_used) : '';
const workHtml = (data.additional_work && data.additional_work.length > 0) ? this.renderWorkTable(data.additional_work) : '';
      // ==================================================

      return `
        <div class="checklist-section">
          <h3 class="checklist-section-header">${this.escapeHtml(section.name)}</h3>
          <table class="styled-table">
            <thead>
              <tr>
                <th>Sjekkpunkt</th>
                <th style="text-align:center;">Status</th>
                <th >Merknad / Dokumentasjon</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          ${driftScheduleHtml}
${productsHtml}
${workHtml}
        </div>`;
    }).join('');
  }

renderDriftSchedule(schedule) {
  if (!schedule || Object.keys(schedule).length === 0) {
    console.log('⚠️ No driftSchedule data to render');
    return '';
  }
  
  console.log('📅 Rendering driftSchedule:', schedule);
  
  const days = ['mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag', 'søndag'];
  const dayLabels = ['Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag', 'Søndag'];
  
  // Start og stopp rows
  const startRow = days.map((day, idx) => {
    const value = schedule[day]?.start || '-';
    return `<td>${this.escapeHtml(value)}</td>`;
  }).join('');
  
  const stoppRow = days.map((day, idx) => {
    const value = schedule[day]?.stopp || '-';
    return `<td>${this.escapeHtml(value)}</td>`;
  }).join('');
  
  const headers = dayLabels.map(label => `<th style="width: 14.28%; text-align: center;">${label}</th>`).join('');
  
  return `
    <div style="margin-top: 20px;">
      <h4 style="color: #0B5FAE; font-size: 11pt; margin-bottom: 10px;">Driftstider</h4>
      <table class="styled-table drift-schedule-table" style="table-layout: fixed; width: 100%;">
        <thead>
          <tr>
            <th style="text-align: left; width: 60px;"></th>
            ${headers}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="text-align: left; font-weight: 600;">Start</td>
            ${startRow}
          </tr>
          <tr>
            <td style="text-align: left; font-weight: 600;">Stopp</td>
            ${stoppRow}
          </tr>
        </tbody>
      </table>
    </div>`;
}

renderProductsTable(products) {
  if (!products || products.length === 0) return '';
  
  const rows = products.map(p => `
    <tr>
      <td>${this.escapeHtml(p.name || '')}</td>
      <td style="text-align: center;">${this.escapeHtml(String(p.quantity || '1'))}</td>
      <td style="text-align: right;">${p.price ? `kr ${p.price.toLocaleString('nb-NO')}` : '-'}</td>
      <td style="text-align: right;">${p.total ? `kr ${p.total.toLocaleString('nb-NO')}` : '-'}</td>
    </tr>
  `).join('');
  
  return `
    <div style="margin-top: 20px;">
      <h4 style="color: #0B5FAE; font-size: 11pt; margin-bottom: 10px;">Produkter brukt</h4>
      <table class="styled-table products-table">
        <thead>
          <tr>
            <th style="width: 50%;">Produkt</th>
            <th style="width: 10%; text-align: center;">Antall</th>
            <th style="width: 20%; text-align: right;">Pris</th>
            <th style="width: 20%; text-align: right;">Total</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>`;
}

renderWorkTable(work) {
  if (!work || work.length === 0) return '';
  
  const rows = work.map(w => `
    <tr>
      <td>${this.escapeHtml(w.description || '')}</td>
      <td style="text-align: center;">${this.escapeHtml(String(w.hours || '-'))}</td>
      <td style="text-align: right;">${w.price ? `kr ${w.price.toLocaleString('nb-NO')}` : '-'}</td>
      <td style="text-align: right;">${w.total ? `kr ${w.total.toLocaleString('nb-NO')}` : '-'}</td>
    </tr>
  `).join('');
  
  return `
    <div style="margin-top: 20px;">
      <h4 style="color: #0B5FAE; font-size: 11pt; margin-bottom: 10px;">Utførte tilleggsarbeider</h4>
      <table class="styled-table work-table">
        <thead>
          <tr>
            <th style="width: 50%;">Beskrivelse</th>
            <th style="width: 10%; text-align: center;">Timer</th>
            <th style="width: 20%; text-align: right;">Timepris</th>
            <th style="width: 20%; text-align: right;">Total</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>`;
}

  generateSummarySection(data, settings) {
  const hasContent = data.overallComment || 
                     (data.documentation_photos && data.documentation_photos.length > 0);

  if (!hasContent) return '';

  const commentHtml = data.overallComment 
    ? `<p style="margin: 0 0 20px 0; line-height: 1.6;">${this.escapeHtml(data.overallComment)}</p>` 
    : '';
  
  const photosHtml = (data.documentation_photos && data.documentation_photos.length > 0) 
    ? `<div class="photos-grid">${data.documentation_photos.map(photo => 
        `<div class="photo-container">
          <img src="${photo.url}" class="photo" alt="${this.escapeHtml(photo.caption || 'Bilde')}"/>
        </div>`
      ).join('')}</div>` 
    : '';

  return `
    <section class="section">
      <h2 class="section-header">Oppsummering og utførte arbeider</h2>
      ${commentHtml}
      ${photosHtml}
    </section>`;
}

  generateSignSection(data, settings) {
    const technician = data.technician_name || 'Ukjent tekniker';
    const reportDate = new Date(data.completed_at || data.created_at).toLocaleDateString('nb-NO');

    return `
      <section class="section sign-section avoid-break">
        <p class="closing">Med vennlig hilsen<br><strong>${this.escapeHtml((settings.company || {}).name || 'Air-Tech AS')}</strong></p>
        
        <div class="signature-details">
          <div class="technician-info">
            ${this.escapeHtml(technician)}<br>
            Servicetekniker
          </div>
          <div class="location-date">
            Oslo, ${reportDate}
          </div>
        </div>
      </section>`;
  }

  getAirTechCSS() {
    return `
      @page { size: A4; margin: 25mm 15mm 20mm 15mm; }
      html, body { font-family: Arial, sans-serif; color:#111; font-size:10pt; line-height: 1.4; }
      * { -webkit-print-color-adjust: exact; print-color-adjust: exact; box-sizing: border-box; }
      .header-container { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0B5FAE; padding-bottom: 8px; margin-bottom: 10px; }
      .header-text { flex-grow: 1; }
      
      .main-title { font-size: 24pt; margin: 0 0 4px 0; color:#0B5FAE; }
      .report-id { color:#374151; margin: 0; font-size: 10pt; }
      .section { margin-top: 16px; }
      .section-header { font-size: 13pt; margin: 0 0 8px 0; color:#0B5FAE; border-bottom:1px solid #0B5FAE; padding-bottom: 4px; }
      .section-subheader { font-size: 12pt; margin: 12px 0 6px 0; }
      .avoid-break { page-break-inside: avoid; }
      .page-break { page-break-before: always; }
      /* === KUNDEINFO-TABELL (ENKEL TABELL-MODELL) === */
      .main-info-table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 10px;
        border: 1px solid #dee2e6;
      }
      .main-info-table td {
        width: 33.33%;
        vertical-align: top;
        border: 1px solid #dee2e6;
        padding: 8px 12px;
      }
      .main-info-table .meta-row td {
        /* Tykkere toppkant kun for den nederste raden */
        border-top: 2px solid #adb5bd;
      }
      .nested-table { width: 100%; border-collapse: collapse; }
      .nested-table td { padding: 5px 0; }
      .info-cell .label { font-size: 8pt; color: #6c757d; text-transform: uppercase; margin-bottom: 2px; }
      .info-cell .data { font-size: 10pt; font-weight: 600; color: #212529; }
      table.styled-table { width: 100%; border-collapse: collapse; margin-top: 5px; }
      table.styled-table th, table.styled-table td { padding: 8px 10px; text-align: left; vertical-align: top; } /* Fjernet border-bottom */
      table.styled-table tr { border-bottom: 1px solid #e5e7eb; } /* Lagt til border på raden */
      table.styled-table thead tr { background: #f3f4f6; font-size: 9.5pt; }
      .status-cell { font-weight: 600; text-transform: uppercase; text-align:center; }
      .status-ok { color:#059669; } .status-byttet { color:#0369a1; } .status-avvik { color:#dc2626; } .status-na { color:#6b7280; }
      .status-badge { display: inline-block; padding: 3px 8px; border-radius: 4px; font-weight: 600; min-width: 60px; text-align: center; }
      .status-badge.status-byttet { background-color: #e0f2fe; color: #0369a1; }
      .status-badge.status-avvik { background-color: #fee2e2; color: #b91c1c; }
      .avvik-section .section-header { color: #dc2626; border-bottom-color: #dc2626; }
      .avvik-table thead { background:#fee2e2; }
      .avvik-table tbody tr { background: #fff7f7; }
      .avvik-table tbody tr:nth-child(even) { background: #fef2f2; }
      /* === STILER FOR BILDER I SJEKKLISTE (NY OG FORBEDRET) === */
      .merknad-cell {
        /* ENDRET HER: Stabler elementer vertikalt (under hverandre) */
        display: flex;
        flex-direction: column; 
        align-items: flex-start; /* Venstrejusterer alt innhold */
        gap: 10px; /* Mellomrom mellom tekst og bilde-seksjon */
      }
      .merknad-text {
        /* Ingen endring nødvendig her */
      }
      .checklist-images {
        /* Ingen endring nødvendig her */
      }
      .images-grid-inline {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        /* ENDRET HER: Venstrejusterer bildene i gridden */
        justify-content: flex-start; 
      }
      .image-container-inline {
        max-width: 100px;
      }
      .checklist-image {
        max-width: 100px;
        max-height: 75px;
        object-fit: contain;
        border: 2px solid #e2e8f0;
        border-radius: 4px;
        display: block;
      }
      .image-caption {
        font-size: 8pt;
        color: #64748b;
        display: block;
        margin-top: 3px;
        line-height: 1.2;
        max-width: 100px;
      }
      .photos-grid { display: flex; gap: 10px; flex-wrap: wrap; margin: 8px 0; }
      .photo-container { display: inline-block; max-width: 140px; }
      .photo { max-width: 140px; max-height: 95px; object-fit: contain; border: 2px solid #e2e8f0; border-radius: 4px; }
      /* === SIGNATUR-SEKSJON (NY) === */
      .sign-section {
        margin-top: 50px; /* Mer luft over */
        border-top: 1px solid #0B5FAE; /* Tynn blå linje over */
        padding-top: 20px;
      }
      .closing {
        margin-bottom: 25px;
        line-height: 1.5;
      }
      .signature-details {
        display: flex;
        justify-content: space-between; /* Plasserer elementer på hver sin side */
        align-items: flex-end; /* Justerer bunnen av tekstblokkene */
        font-size: 10pt;
        color: #374151;
        line-height: 1.5;
      }
      table.styled-table th:nth-child(1) { width: 50%; }
      table.styled-table th:nth-child(2) { width: 15%; text-align: center; }
      table.styled-table th:nth-child(3) { width: 35%; }

/* Kolonne-bredder for systemoversikt-tabell */
.styled-table.equipment-overview th:nth-child(1) { width: 5%; }   /* Nr */
.styled-table.equipment-overview th:nth-child(2) { width: 15%; }  /* Systemtype - redusert fra ~25% */
.styled-table.equipment-overview th:nth-child(3) { width: 20%; }  /* Systemnummer */
.styled-table.equipment-overview th:nth-child(4) { width: 25%; }  /* Plassering */
.styled-table.equipment-overview th:nth-child(5) { width: 35%; }  /* Betjener - økt fra ~25% */

/* Kolonne-bredder for avvik-tabell */
.avvik-table th:nth-child(1) { width: 5%; }   /* Avvik ID */
.avvik-table th:nth-child(2) { width: 15%; }  /* Anlegg */
.avvik-table th:nth-child(3) { width: 12%; }  /* Systemnummer */
.avvik-table th:nth-child(4) { width: 13%; }  /* Komponent */
.avvik-table th:nth-child(5) { width: 55%; }  /* Kommentar - økt for bedre lesbarhet */
      .equipment-summary { margin: 20px 0; }

/* Produkter tabell */
.products-table th:nth-child(1) { width: 50%; }
.products-table th:nth-child(2) { width: 10%; text-align: center; }
.products-table th:nth-child(3) { width: 20%; text-align: right; }
.products-table th:nth-child(4) { width: 20%; text-align: right; }
.products-table td:nth-child(2) { text-align: center; }
.products-table td:nth-child(3) { text-align: right; }
.products-table td:nth-child(4) { text-align: right; }

/* Arbeid tabell */
.work-table th:nth-child(1) { width: 50%; }
.work-table th:nth-child(2) { width: 10%; text-align: center; }
.work-table th:nth-child(3) { width: 20%; text-align: right; }
.work-table th:nth-child(4) { width: 20%; text-align: right; }
.work-table td:nth-child(2) { text-align: center; }
.work-table td:nth-child(3) { text-align: right; }
.work-table td:nth-child(4) { text-align: right; }
      .equipment-header { font-size: 14pt; color: #0B5FAE; margin: 0 0 10px 0; padding-bottom: 5px; border-bottom: 1px solid #0B5FAE; }
      .system-number { font-size: 11pt; color: #6b7280; font-weight: normal; }
      .equipment-comment { margin: 10px 0; padding: 10px; background: #fff; border-left: 3px solid #0B5FAE; font-style: italic; }
      .equipment-summary h4 { font-size: 11pt; margin: 15px 0 8px 0; color: #374151; }
      .equipment-avvik-section { margin-top: 15px; }
      .avvik-detail { margin: 10px 0; padding: 10px; background: #fff; border-left: 3px solid #dc2626; }
      .avvik-images-inline { margin-top: 10px; }
      .images-grid { display: flex; gap: 10px; flex-wrap: wrap; }
      .image-container { display: inline-block; max-width: 140px; text-align: center; }
      .avvik-image-small { max-width: 140px; max-height: 100px; object-fit: contain; border: 2px solid #fca5a5; border-radius: 4px; }
    
/* Driftstider-tabell */
.drift-schedule-table { 
  width: 100%;
  border-collapse: collapse;
  font-size: 9pt; 
  margin-top: 8px;
  background: white;
}
.drift-schedule-table th { 
  background: #0B5FAE !important; 
  color: white !important;
  text-align: center;
  padding: 8px 4px;
  font-size: 9pt;
  border: 1px solid #0B5FAE;
}
.drift-schedule-table td { 
  text-align: center;
  padding: 8px 4px;
  border: 1px solid #e5e7eb;
  background: white;
}
.drift-schedule-table td:first-child { 
  text-align: left; 
  font-weight: 600;
  width: 60px;
  background: #f3f4f6;
  color: #374151;
}
.drift-schedule-table tbody tr:nth-child(even) td {
  background: #f9fafb;
}
.drift-schedule-table tbody tr:nth-child(even) td:first-child {
  background: #f3f4f6;
}
`;
  }

  getRecipientFromCustomerData(customerData) {
    if (!customerData) return '';
    const contacts = customerData.contacts || [];
    const match = contacts.find(c => (c.last_name || '').toLowerCase() === 'servfixmail');
    return match?.email || customerData.email || '';
  }

  getOrderLocationFromCustomer(customerData, equipmentLocation) {
    console.log('🔍 DEBUG Location Data:', JSON.stringify({
      hasCustomerData: !!customerData,
      customerDataKeys: customerData ? Object.keys(customerData) : [],
      physicalAddress: customerData?.physicalAddress,
      post_address: customerData?.post_address,
      equipmentLocation: equipmentLocation,
      fullCustomerData: customerData
    }, null, 2));
    // Prioriter:
    // 1. equipment.location (byggnavn) - fra equipment-tabellen
    // 2. physicalAddress fra Tripletex (via customerData)
    // 3. Fallback til post_address
    
    const physicalAddress = customerData?.physicalAddress || '';
    const postAddress = customerData?.post_address || {};
    
    // Parse physicalAddress hvis det finnes (format: "Adresse, PostnrBy")
    let address = '';
    let postalCode = '';
    
    if (physicalAddress) {
      // Split på komma for å separere adresse og postnr/by
      const parts = physicalAddress.split(',').map(p => p.trim());
      if (parts.length >= 2) {
        address = parts[0];
        // Siste del inneholder postnr og by
        const postalPart = parts[parts.length - 1];
        // Ekstraher postnummer (4 siffer i starten)
        const postalMatch = postalPart.match(/^(\d{4})\s+(.+)$/);
        if (postalMatch) {
          postalCode = `${postalMatch[1]} ${postalMatch[2]}`;
        } else {
          postalCode = postalPart;
        }
      } else {
        address = physicalAddress;
      }
    } else {
      // Fallback til post_address struktur
      address = postAddress.addressLine1 || '';
      postalCode = postAddress.postalCode ? 
        `${postAddress.postalCode} ${postAddress.city || ''}`.trim() : '';
    }
    
    return {
      buildingName: equipmentLocation || customerData?.location?.name || '',
      address: address,
      postalCode: postalCode,
    };
  }

  generateHTML(data, settings) {
    const theme = this.getReportTheme(data.equipment_type);
    const logoTag = ''; // Logo er nå i headerTemplate i stedet
    const customerName = data.customer_name || '';
    const recipient = this.getRecipientFromCustomerData(data.customer_data);
    const where = this.getOrderLocationFromCustomer(data.customer_data, data.equipment_location);

    console.log('🔍 DEBUG Where Result:', JSON.stringify(where, null, 2));
    console.log('🔍 DEBUG Full data.customer_data:', JSON.stringify(data.customer_data, null, 2));
    const technician = data.technician_name || 'Ukjent tekniker';

    const equipmentOverview = this.renderEquipmentOverviewTable(data);
    const avvikTable = this.renderAvvikTable(data);
    const summarySection = this.generateSummarySection(data, settings);
    const checklistSections = this.renderChecklistResults(data);
    const signSection = this.generateSignSection(data, settings);

    return `
      <!DOCTYPE html><html lang="no"><head><meta charset="utf-8"/>
      <title>${this.escapeHtml(theme.title)} ${this.escapeHtml(data.id)}</title>
      <style>${this.getAirTechCSS()}</style></head><body>
      <div class="pdf-container">
      <header class="header-container">
        <div class="header-text">
          <h1 class="main-title">Servicerapport: ${this.escapeHtml(customerName)}</h1>
          <p class="report-id">
            Ordre ${this.escapeHtml(data.order_number || '')} • ${new Date(data.completed_at || data.created_at).toLocaleDateString('nb-NO')}
          </p>
        </div>

      </header>

      <section class="section avoid-break">
        <table class="main-info-table">
          <tbody>
            <tr>
              <td><div class="info-cell"><div class="label">Avtalenummer</div><div class="data">${this.escapeHtml(data.customer_data?.agreementId || 'N/A')}</div></div></td>
              <td><div class="info-cell"><div class="label">Besøk nr</div><div class="data">N/A</div></div></td>
              <td><div class="info-cell"><div class="label">Årstall</div><div class="data">${new Date(data.created_at).getFullYear()}</div></div></td>
            </tr>
            <tr>
              <td><div class="info-cell"><div class="label">Kundenummer</div><div class="data">${this.escapeHtml(data.customer_data?.id || '')}</div></div></td>
              <td><div class="info-cell"><div class="label">Kundenavn</div><div class="data">${this.escapeHtml(customerName)}</div></div></td>
              <td><div class="info-cell"><div class="label">Mottaker av rapport</div><div class="data">${this.escapeHtml(recipient)}</div></div></td>
            </tr>
            <tr>
              <td><div class="info-cell"><div class="label">Byggnavn</div><div class="data">${this.escapeHtml(where.buildingName || 'Ikke spesifisert')}</div></div></td>
              <td><div class="info-cell"><div class="label">Adresse</div><div class="data">${this.escapeHtml(where.address || 'Ikke spesifisert')}</div></div></td>
              <td><div class="info-cell"><div class="label">Post nr. / Poststed</div><div class="data">${this.escapeHtml(where.postalCode || 'Ikke spesifisert')}</div></div></td>
            </tr>
            <tr class="meta-row">
              <td><div class="info-cell"><div class="label">Rapport dato</div><div class="data">${new Date(data.completed_at || data.created_at).toLocaleDateString('nb-NO')}</div></div></td>
              <td><div class="info-cell"><div class="label">Utført av</div><div class="data">${this.escapeHtml(technician)}</div></div></td>
              <td><div class="info-cell"><div class="label">Vår kontaktperson</div><div class="data">${this.escapeHtml(technician)}</div></div></td>
            </tr>
          </tbody>
        </table>
      </section>
        <section class="section">
          <p>Servicearbeidet som ble avtalt for de angitte anleggene er nå fullført i tråd med avtalen. I henhold til vår serviceavtale oversender vi en servicerapport etter fullført servicebesøk.</p>
        </section>
        
        ${equipmentOverview}
        ${avvikTable}
        ${signSection}
        
        ${checklistSections ? `
        <div class="page-break"></div>
        <h2 class="section-header" style="margin-top: 0;">Sjekkpunkter og detaljer</h2>
        ${checklistSections}
        ` : ''}
        
        ${summarySection ? '<div class="page-break"></div>' : ''}
        
        ${summarySection}
      </div></body></html>`;
  }

  /* ===========================
   * PDF / Upload / Orkestrering
   * =========================== */
  async generatePDF(html, settings) {
    if (!this.browser) throw new Error('Browser not initialized');
    const page = await this.browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 45000 });
    await page.emulateMediaType('print');
    
    // Bruk settings i stedet for hardkodede verdier
    const company = settings.company || {
      name: 'Air-Tech AS',
      address: 'Stanseveien 18, 0975 Oslo',
      phone: '+47 91 52 40 40',
      email: 'post@air-tech.no',
      orgnr: '889 558 652',
      website: 'www.air-tech.no'
    };

    const footerTemplate = `
      <div style="width: 100%; font-size: 9px; color: #374151; padding: 10px 40px 0; border-top: 1px solid #c7c7c7; display: flex; justify-content: space-between;">
        <div style="text-align: left;">
          <strong>${company.name}</strong><br>
          ${company.address}<br>
          <a href="https://${company.website}" style="color: #374151; text-decoration: none;">${company.website}</a>
        </div>
        <div style="text-align: left;">
          Telefon: ${company.phone}<br>
          Epost: ${company.email}<br>
          Org.nr: ${company.orgnr}
        </div>
        <div style="text-align: right; align-self: flex-end;">
          Side <span class="pageNumber"></span> av <span class="totalPages"></span>
        </div>
      </div>
    `;

    const pdfBuffer = await page.pdf({
      format: 'A4', printBackground: true, displayHeaderFooter: true,
      headerTemplate: `
  <div style="width: 100%; padding: 0 40px;">
    ${settings.logoBase64 ? `
      <img src="${settings.logoBase64}" 
           alt="logo" 
           style="position: absolute; top: 8mm; right: 15mm; width: 120px; height: auto; max-height: 60px;" />
    ` : ''}
  </div>
`,
      footerTemplate: footerTemplate,
      margin: { top: '20mm', right: '15mm', bottom: '28mm', left: '15mm' } // Økt bunnmarg for å få plass til footer
    });

    await page.close();
    return pdfBuffer;
  }

  async uploadToGCS(tenantId, buffer, reportId, orderId) {
    if (!this.bucket) throw new Error('GCS bucket not initialized');
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const fileName = `servicerapport_${reportId}_${Date.now()}.pdf`;
    const gcsPath = `tenants/${tenantId}/service-reports/${yyyy}/${mm}/${orderId}/${fileName}`;
    
    const file = this.bucket.file(gcsPath);
    await file.save(buffer, { metadata: { contentType: 'application/pdf' } });
    
    const relativePath = `service-reports/${yyyy}/${mm}/${orderId}/${fileName}`;
    console.log(`✅ PDF uploaded to GCS. Relative path: ${relativePath}`);
    return relativePath;
  }

  async updateReportPDFPath(reportId, pdfPath, tenantId) {
    const pool = await db.getTenantConnection(tenantId);
    await pool.query('UPDATE service_reports SET pdf_path = $1, pdf_generated = true WHERE id = $2', [pdfPath, reportId]);
    console.log(`✅ Database updated for: ${reportId}`);
  }

  async debugSaveHTML(html, reportId) {
    if (process.env.NODE_ENV === 'production') return;
    try {
      const debugDir = path.join(process.cwd(), 'test-output');
      await fs.mkdir(debugDir, { recursive: true });
      const debugPath = path.join(debugDir, `debug-report-${reportId}-${Date.now()}.html`);
      await fs.writeFile(debugPath, html, 'utf8');
      console.log(`🐛 Debug HTML saved: ${debugPath}`);
    } catch (e) {
      console.warn('⚠️  Kunne ikke lagre debug HTML:', e.message);
    }
  }

  async generateReport(reportId, tenantId) {
    await this.init();
    try {
      const reportData = await this.fetchReportData(reportId, tenantId);
      const settings = await this.loadCompanySettings(tenantId);
      const processed = await this.processAirTechData(reportData);
      
      console.log('📊 BEFORE INLINE IMAGES:');
      if (processed.avvik?.length) {
        processed.avvik.forEach((a, i) => {
          console.log(`  - Avvik ${i+1} (ID: ${a.avvik_id}): ${a.images?.length || 0} bilder`);
        });
      }

      await this.inlineAllImages(processed);
      
      const html = this.generateHTML(processed, settings);
      await this.debugSaveHTML(html, reportId);
      
      const pdfBuffer = await this.generatePDF(html, settings);
      const relativePath = await this.uploadToGCS(tenantId, pdfBuffer, reportId, reportData.order_id);
      await this.updateReportPDFPath(reportId, relativePath, tenantId);
      
      return relativePath;
    } finally {
      await this.close();
    }
  }
}

module.exports = UnifiedPDFGenerator;