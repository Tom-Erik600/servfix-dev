// src/services/unifiedPdfGenerator.js
'use strict';

const path = require('path');
const fs = require('fs').promises;
const puppeteer = require('puppeteer');
const { Storage } = require('@google-cloud/storage');
const db = require('../config/database'); // getTenantConnection(tenantId)

class UnifiedPDFGenerator {
  constructor() {
    this.browser = null;

    // Init GCS (valgfritt i dev)
    const bucketName =
      process.env.GCS_BUCKET_NAME ||
      process.env.GCS_BUCKET ||
      process.env.GOOGLE_CLOUD_BUCKET ||
      process.env.GCLOUD_STORAGE_BUCKET ||
      null;

    if (bucketName) {
      try {
        // Cloud Run (default creds) eller lokale creds (GOOGLE_APPLICATION_CREDENTIALS peker til fil)
        this.storage = new Storage({
          projectId: process.env.GCP_PROJECT_ID || process.env.GCLOUD_PROJECT || undefined,
        });
        this.bucket = this.storage.bucket(bucketName);
        console.log('✅ GCS init:', bucketName);
      } catch (e) {
        console.warn('⚠️  GCS init feilet:', e.message);
        this.storage = null;
        this.bucket = null;
      }
    } else {
      console.warn('ℹ️ Ingen GCS bucket konfigurert. Offentlig opplasting vil ikke fungere.');
      this.storage = null;
      this.bucket = null;
    }
  }

  /* ===========================
   * Lifecycle
   * =========================== */
  async init() {
    if (this.browser) return;
    const isProd = process.env.NODE_ENV === 'production';
    const opts = {
      headless: isProd ? true : 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    };

    if (process.env.K_SERVICE) {
      // Cloud Run
      opts.executablePath = '/usr/bin/chromium';
      opts.args.push(
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--no-first-run',
        '--no-zygote',
        '--single-process'
      );
    } else if (process.env.PUPPETEER_EXECUTABLE_PATH) {
      opts.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    }

    try {
      this.browser = await puppeteer.launch(opts);
    } catch (err) {
      console.error('❌ Puppeteer launch feilet, fallback:', err.message);
      this.browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
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
    } catch {
      return fallback;
    }
  }

  escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /* ===========================
   * Company settings (logo / info)
   * =========================== */
  async loadCompanySettings(tenantId) {
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

    if (!this.bucket) return defaults;

    // 1) settings.json (valgfritt)
    try {
      const settingsPath = `tenants/${tenantId}/assets/settings.json`;
      const file = this.bucket.file(settingsPath);
      const [exists] = await file.exists();
      if (exists) {
        const [buf] = await file.download();
        const json = JSON.parse(buf.toString());
        if (json.companyInfo) {
          defaults.company = {
            ...defaults.company,
            ...json.companyInfo,
          };
        }
        // 2) logo via settings (hvis gitt)
        if (json.logo?.url) {
          const bucketName = this.bucket.name;
          const rel = json.logo.url.replace(`https://storage.googleapis.com/${bucketName}/`, '');
          const logoFile = this.bucket.file(rel);
          const [lexists] = await logoFile.exists();
          if (lexists) {
            const [lbuf] = await logoFile.download();
            const ext = (rel.split('.').pop() || 'png').toLowerCase();
            const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png';
            defaults.logoBase64 = `data:${mime};base64,${lbuf.toString('base64')}`;
          }
        }
      }
    } catch (e) {
      console.warn('⚠️  Kunne ikke lese settings.json:', e.message);
    }

    // 3) Fallback logo (fast sti)
    if (!defaults.logoBase64) {
      try {
        const candidate = `tenants/${tenantId}/assets/logo.png`;
        const file = this.bucket.file(candidate);
        const [exists] = await file.exists();
        if (exists) {
          const [buf] = await file.download();
          defaults.logoBase64 = `data:image/png;base64,${buf.toString('base64')}`;
        }
      } catch (e) {
        // ignorer
      }
    }

    return defaults;
  }

  /* ===========================
   * DB Fetch
   * =========================== */
  async fetchReportData(reportId, tenantId) {
    const pool = await db.getTenantConnection(tenantId);

    // rapport + alle ferdigstilte rapporter på samme ordre
    const q = `
      SELECT 
        sr.id, sr.order_id, sr.equipment_id, sr.checklist_data, sr.photos,
        sr.status, sr.completed_at, sr.created_at, sr.pdf_path, sr.pdf_generated,
        o.id              AS order_number,
        o.customer_name   AS customer_name,
        o.customer_data   AS customer_data,
        o.scheduled_date  AS service_date,
        e.systemnavn      AS equipment_name,
        e.systemtype      AS equipment_type,
        e.location        AS equipment_location,
        e.systemnummer    AS equipment_serial,
        t.name            AS technician_name,

        ARRAY_AGG(
          json_build_object(
            'report_id',          sr2.id,
            'equipment_id',       sr2.equipment_id,
            'equipment_name',     e2.systemnavn,
            'equipment_type',     e2.systemtype,
            'equipment_location', e2.location,
            'system_nummer',      e2.systemnummer,
            'checklist_data',     sr2.checklist_data,
            'photos',             sr2.photos
          )
        ) FILTER (WHERE sr2.id IS NOT NULL) AS all_reports

      FROM service_reports sr
      LEFT JOIN orders o        ON o.id = sr.order_id
      LEFT JOIN equipment e     ON e.id = sr.equipment_id
      LEFT JOIN technicians t   ON t.id = o.technician_id
      LEFT JOIN service_reports sr2 ON sr2.order_id = sr.order_id AND sr2.status = 'completed'
      LEFT JOIN equipment e2    ON e2.id = sr2.equipment_id
      WHERE sr.id = $1
      GROUP BY sr.id, o.id, e.id, t.id
      LIMIT 1;
    `;
    const { rows } = await pool.query(q, [reportId]);
    if (!rows.length) throw new Error(`Report not found: ${reportId}`);

    const row = rows[0];

    // parse JSON
    row.customer_data = this.safeJsonParse(row.customer_data, {});
    row.checklist_data = this.safeJsonParse(row.checklist_data, {});
    row.photos = Array.isArray(row.photos) ? row.photos : this.safeJsonParse(row.photos, []) || [];

    row.all_reports = (row.all_reports || []).map(r => ({
      ...r,
      checklist_data: this.safeJsonParse(r.checklist_data, {}),
      photos: Array.isArray(r.photos) ? r.photos : this.safeJsonParse(r.photos, []) || [],
    }));

    // Avvik-bilder for denne rapporten (brukes i mapping etterpå)
    const avvikImagesQ = `
      SELECT checklist_item_id, image_url, avvik_number, uploaded_at
      FROM avvik_images
      WHERE service_report_id = $1
      ORDER BY avvik_number ASC, uploaded_at ASC
    `;
    const avvikRes = await pool.query(avvikImagesQ, [reportId]);
    row.avvik_images = avvikRes.rows || [];

    return { ...row, tenant_id: tenantId };
  }

  /* ===========================
   * Normalisering
   * =========================== */
  normalizeChecklistStructure(checklist) {
    if (!checklist) return { components: [] };

    if (Array.isArray(checklist.components)) {
      return checklist;
    }

    if (checklist?.checklist) {
      const details = checklist.systemFields || checklist.details || {};
      let componentName = 'Sjekkliste';
      if (details.etasje && details.leilighet_nr) {
        componentName = `Etasje ${details.etasje} - Leilighet ${details.leilighet_nr}`;
      } else if (details.etasje) {
        componentName = `Etasje ${details.etasje}`;
      } else if (details.leilighet_nr) {
        componentName = `Leilighet ${details.leilighet_nr}`;
      }
      return {
        components: [{
          name: componentName,
          details,
          checklist: checklist.checklist,
          metadata: checklist.metadata || {},
        }],
        overallComment: checklist.overallComment || '',
      };
    }

    return { components: [] };
  }

  /* ===========================
   * Templates (valgfritt)
   * =========================== */
  async fetchChecklistTemplate(tenantId, equipmentType) {
    try {
      const pool = await db.getTenantConnection(tenantId);
      const res = await pool.query(
        'SELECT template_data FROM checklist_templates WHERE equipment_type = $1 LIMIT 1',
        [equipmentType]
      );
      if (res.rows.length) {
        return this.safeJsonParse(res.rows[0].template_data, { checklistItems: [] });
      }
      return { checklistItems: [] };
    } catch {
      return { checklistItems: [] };
    }
  }

  generateFallbackName(itemId) {
    const patterns = {
      'item': 'Sjekkpunkt',
      'temp': 'Temperatur',
      'virkn': 'Virkningsgrad',
      'tilstand': 'Tilstandsgrad',
      'konsekvens': 'Konsekvensgrad',
    };
    for (const [p, name] of Object.entries(patterns)) {
      if ((itemId || '').startsWith(p)) {
        const num = (itemId || '').replace(p, '');
        return `${name} ${num}`;
      }
    }
    if (!itemId) return 'Ukjent punkt';
    const text = itemId.replace(/_/g, ' ');
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  itemHasData(checkpoint) {
    const s = (checkpoint.status || '').toLowerCase();
    if (!s) return false;
    return s !== 'na' && s !== 'ikke relevant';
  }

  buildEquipmentOverview(data) {
    if (!Array.isArray(data.all_reports) || !data.all_reports.length) {
      data.all_equipment = [{
        systemtype: data.equipment_type || 'System',
        systemnummer: data.equipment_serial || 'N/A',
        plassering: data.equipment_location || 'Ikke spesifisert',
        betjener: 'Ikke spesifisert',
      }];
      return;
    }

    data.all_equipment = data.all_reports.map(r => ({
      systemtype: r.equipment_type || 'System',
      systemnummer: r.system_nummer || 'N/A',
      plassering: r.equipment_location || 'Ikke spesifisert',
      betjener: 'Ikke spesifisert',
    }));
  }

  extractImagesFromChecklistData(checklistData) {
    const out = [];
    if (!checklistData?.components) return out;

    checklistData.components.forEach((component, idx) => {
      if (!component?.checklist) return;
      Object.entries(component.checklist).forEach(([itemId, itemData]) => {
        if (Array.isArray(itemData?.images)) {
          itemData.images.forEach(url => {
            out.push({
              checklist_item_id: itemId,
              image_url: url,
              image_type: (itemData.status || '').toLowerCase() === 'avvik' ? 'avvik' : 'checklist',
              component_index: idx,
              source: 'checklist_data',
            });
          });
        }
        if (itemData?.comment && typeof itemData.comment === 'string') {
          const urlRegex = /https:\/\/storage\.googleapis\.com\/[^\s)]+/g;
          const urls = itemData.comment.match(urlRegex) || [];
          urls.forEach(url => {
            out.push({
              checklist_item_id: itemId,
              image_url: url,
              image_type: (itemData.status || '').toLowerCase() === 'avvik' ? 'avvik' : 'checklist',
              component_index: idx,
              source: 'comment_urls',
            });
          });
        }
      });
    });

    return out;
  }

  /* ===========================
   * Prosessering til PDF-modell
   * =========================== */
  async processAirTechData(row) {
    const data = { ...row };

    // 1) Systemoversikt
    this.buildEquipmentOverview(data);

    // 2) Navn-mapping fra template
    const template = await this.fetchChecklistTemplate(data.tenant_id, data.equipment_type);
    const nameLookup = {};
    if (Array.isArray(template.checklistItems)) {
      template.checklistItems.forEach(it => {
        if (it?.id && (it.label || it.name)) {
          nameLookup[it.id] = it.label || it.name;
        }
      });
    }

    // 3) Sjekklister + avvik (fra alle anlegg/rapporter)
    const result = { equipmentSections: [], avvik: [] };
    let avvikCounter = 1;

    if (Array.isArray(data.all_reports)) {
      for (const report of data.all_reports) {
        const normalized = this.normalizeChecklistStructure(report.checklist_data);
        if (!normalized?.components?.length) continue;

        const systemRef = `${report.system_nummer || 'N/A'} - ${report.equipment_name || ''}`;
        const sectionNameFallback = report.equipment_name || systemRef;

        normalized.components.forEach(component => {
          if (!component.checklist) return;

          const sectionName = component.name || sectionNameFallback;
          const checkpoints = [];

          Object.entries(component.checklist).forEach(([itemId, itemData]) => {
            const actualName = nameLookup[itemId] || this.generateFallbackName(itemId) || `Sjekkpunkt ${itemId}`;

            const cp = {
              item_id: itemId,
              name: actualName,
              status: (itemData.status || 'ok').toUpperCase(),
              comment: itemData.avvikComment || itemData.byttetComment || itemData.comment || '',
              system_ref: systemRef,
              images: [],
            };
            checkpoints.push(cp);

            if ((itemData.status || '').toLowerCase() === 'avvik') {
              result.avvik.push({
                item_id: itemId,
                avvik_id: String(avvikCounter++).padStart(3, '0'),
                systemnummer: report.system_nummer || 'N/A',
                systemnavn: report.equipment_name || '',
                komponent: actualName,
                seksjon: sectionName,
                kommentar: itemData.avvikComment || itemData.comment || 'Ingen beskrivelse',
                images: [],
              });
            }
          });

          const filtered = checkpoints.filter(cp => this.itemHasData(cp));
          if (filtered.length > 0) {
            result.equipmentSections.push({
              name: sectionName,
              system_ref: systemRef,
              checkpoints: filtered,
            });
          }
        });
      }
    }

    // 4) Bilder: bygg maps (avvik + sjekkliste)
    const byItemAvvik = {};
    const byItemChk = {};
    (data.avvik_images || []).forEach(x => {
      if (!x.checklist_item_id) return;
      byItemAvvik[x.checklist_item_id] = byItemAvvik[x.checklist_item_id] || [];
      byItemAvvik[x.checklist_item_id].push(x);
    });
    const extractedFromChecklist = this.extractImagesFromChecklistData(
      this.normalizeChecklistStructure(data.checklist_data)
    );
    extractedFromChecklist.forEach(x => {
      if (!x.checklist_item_id) return;
      byItemChk[x.checklist_item_id] = byItemChk[x.checklist_item_id] || [];
      byItemChk[x.checklist_item_id].push(x);
    });

    // 4a) Injiser bilder på checkpoints
    result.equipmentSections.forEach(section => {
      section.checkpoints.forEach(cp => {
        const imgs = [
          ...(byItemChk[cp.item_id] || []),
          ...(byItemAvvik[cp.item_id] || []),
        ];
        if (imgs.length) {
          cp.images = imgs.map(x => ({
            url: x.image_url || x.url,
            description: x.caption || x.metadata?.description || '',
          }));
        }
      });
    });

    // 4b) Injiser bilder på avvik
    result.avvik.forEach(a => {
      const imgs = [
        ...(byItemAvvik[a.item_id] || []),
        ...(byItemChk[a.item_id] || []),
      ];
      if (imgs.length) {
        a.images = imgs.map(x => ({
          url: x.image_url || x.url,
          description: x.caption || x.metadata?.description || '',
        }));
      }
    });

    // 5) Førsteside-splitt for systemer/bilder
    const MAX_SYSTEMS_ON_PAGE_1 = 7;
    const MAX_IMAGES_ON_PAGE_1 = 4;
    data.all_equipment = data.all_equipment || [];
    data.systemsFirstPage = data.all_equipment.slice(0, MAX_SYSTEMS_ON_PAGE_1);
    data.systemsAppendix = data.all_equipment.slice(MAX_SYSTEMS_ON_PAGE_1);

    const allPhotos = Array.isArray(data.photos) ? data.photos : [];
    data.documentation_photos = allPhotos.slice(0, MAX_IMAGES_ON_PAGE_1);
    data.moreDocumentationPhotos = allPhotos.slice(MAX_IMAGES_ON_PAGE_1);

    return {
      ...data,
      equipmentSections: result.equipmentSections,
      avvik: result.avvik,
    };
  }

  /* ===========================
   * Theming & Rendering
   * =========================== */
  getReportTheme(equipmentTypeRaw) {
    const equipmentType = (equipmentTypeRaw || '').toLowerCase();
    const themes = {
      boligventilasjon: {
        title: 'SERVICERAPPORT BOLIGVENTILASJON',
        table: {
          equipmentOverviewHeadings: ['Systemtype', 'Systemnummer', 'Plassering', 'Betjener'],
          checklistHeadings: ['Sjekkpunkt', 'Status', 'Merknad / Resultat'],
        },
      },
      vifter: {
        title: 'SERVICERAPPORT VIFTER',
        table: {
          equipmentOverviewHeadings: ['Systemtype', 'Systemnummer', 'Plassering', 'Betjener'],
          checklistHeadings: ['Sjekkpunkt', 'Status', 'Merknad / Resultat'],
        },
      },
      default: {
        title: 'SERVICERAPPORT',
        table: {
          equipmentOverviewHeadings: ['Systemtype', 'Systemnummer', 'Plassering', 'Betjener'],
          checklistHeadings: ['Sjekkpunkt', 'Status', 'Merknad / Resultat'],
        },
      },
    };
    return themes[equipmentType] || themes.default;
  }

  renderEquipmentOverviewTable(data, theme) {
    const systems = data.systemsFirstPage || data.all_equipment || [];
    if (!systems.length) return '';

    const headings = theme.table.equipmentOverviewHeadings || ['Systemtype', 'Systemnummer', 'Plassering', 'Betjener'];
    const rows = systems.map(e => `
      <tr>
        <td>${this.escapeHtml(e.systemtype || '')}</td>
        <td>${this.escapeHtml(e.systemnummer || '')}</td>
        <td>${this.escapeHtml(e.plassering || '')}</td>
        <td>${this.escapeHtml(e.betjener || '')}</td>
      </tr>
    `).join('');

    const more = data.systemsAppendix && data.systemsAppendix.length
      ? `<p class="muted-note">+ ${data.systemsAppendix.length} flere anlegg – se neste side.</p>`
      : '';

    return `
      <section class="section avoid-break">
        <h2 class="section-header">Systemoversikt</h2>
        <table class="styled-table overview-table">
          <thead>
            <tr>${headings.map(h => `<th>${this.escapeHtml(h)}</th>`).join('')}</tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        ${more}
      </section>
    `;
  }

  renderAvvikTable(data) {
    if (!data.avvik || !data.avvik.length) return '';
    const rows = data.avvik.map(a => {
      const id = String(a.avvik_id || '').padStart(3, '0');
      const imagesRow = (a.images && a.images.length)
        ? `
          <tr class="avvik-images-row">
            <td colspan="5">
              <div class="avvik-images">
                <strong>Bilder for AVVIK ${this.escapeHtml(id)}:</strong>
                <div class="images-grid">
                  ${a.images.map(img => `
                    <img class="avvik-image" src="${img.url}" alt="${this.escapeHtml(img.description || 'Avvikbilde')}"/>
                  `).join('')}
                </div>
              </div>
            </td>
          </tr>
        `
        : '';

      return `
        <tr>
          <td>${this.escapeHtml(id)}</td>
          <td>${this.escapeHtml(a.systemnavn || '')}</td>
          <td>${this.escapeHtml(a.systemnummer || '')}</td>
          <td>${this.escapeHtml(a.komponent || '')}</td>
          <td>${this.escapeHtml(a.kommentar || '')}</td>
        </tr>
        ${imagesRow}
      `;
    }).join('');

    return `
      <section class="section avoid-break">
        <h2 class="section-header">Registrerte avvik</h2>
        <p>Følgende avvik ble registrert under servicen:</p>
        <table class="styled-table avvik-table">
          <thead>
            <tr class="avvik-header-row">
              <th>Avvik ID</th>
              <th>Anlegg</th>
              <th>Systemnummer</th>
              <th>Komponent</th>
              <th>Kommentar</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </section>
    `;
  }

  renderChecklistResults(data, theme) {
    if (!data.equipmentSections || !data.equipmentSections.length) {
      return '<p>Ingen sjekkpunkter registrert.</p>';
    }

    const html = data.equipmentSections.map(section => {
      const rows = section.checkpoints.map(cp => {
        const statusClass = `status-${(cp.status || '').toLowerCase()}`;
        const imagesHtml = (cp.images && cp.images.length)
          ? `
            <tr class="image-row">
              <td colspan="3">
                <div class="checklist-images">
                  ${cp.images.map(img => `
                    <div class="image-container">
                      <img src="${img.url}" class="checklist-image" alt="${this.escapeHtml(img.description || 'Bilde')}"/>
                      ${img.description ? `<span class="image-caption">${this.escapeHtml(img.description)}</span>` : ''}
                    </div>
                  `).join('')}
                </div>
              </td>
            </tr>
          `
          : '';

        return `
          <tr>
            <td>${this.escapeHtml(cp.name)}</td>
            <td class="status-cell ${statusClass}">${this.escapeHtml(cp.status)}</td>
            <td>${this.escapeHtml(cp.comment || '')}</td>
          </tr>
          ${imagesHtml}
        `;
      }).join('');

      return `
        <div class="section avoid-break">
          <h3 class="section-subheader">${this.escapeHtml(section.system_ref || section.name)}</h3>
          <table class="styled-table">
            <thead>
              <tr>${(theme.table.checklistHeadings || ['Sjekkpunkt', 'Status', 'Merknad / Resultat']).map(h => `<th>${this.escapeHtml(h)}</th>`).join('')}</tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      `;
    }).join('');

    return html;
  }

  generateSummarySection(data, settings) {
    const products = Array.isArray(data.products_used) ? data.products_used : [];
    const work = Array.isArray(data.additional_work) ? data.additional_work : [];
    const overall = data.overall_comment;

    const productsHtml = products.length
      ? `<h3>Produkter brukt:</h3><ul>${products.map(p => `<li>${this.escapeHtml(p.name || '')} (${this.escapeHtml(p.quantity || '')})</li>`).join('')}</ul>`
      : '';

    const workHtml = work.length
      ? `<h3>Utførte tilleggsarbeider:</h3><ul>${work.map(w => `<li>${this.escapeHtml(w.description || '')}</li>`).join('')}</ul>`
      : '';

    const overallHtml = overall
      ? `<h3>Generell kommentar:</h3><p>${this.escapeHtml(overall)}</p>`
      : '';

    const photos = Array.isArray(data.documentation_photos) ? data.documentation_photos : [];
    const photosHtml = photos.length
      ? `
        <div class="documentation-photos">
          <h3>Dokumentasjonsbilder:</h3>
          <div class="photos-grid">
            ${photos.map(photo => `
              <div class="photo-container">
                <img src="${photo.url}" class="photo" alt="${this.escapeHtml(photo.caption || 'Dokumentasjonsbilde')}"/>
                ${photo.caption ? `<span class="photo-caption">${this.escapeHtml(photo.caption)}</span>` : ''}
              </div>
            `).join('')}
          </div>
          ${Array.isArray(data.moreDocumentationPhotos) && data.moreDocumentationPhotos.length
            ? `<p class="muted-note">+ ${data.moreDocumentationPhotos.length} flere bilder – se appendix.</p>`
            : ''
          }
        </div>
      `
      : '';

    const signSection = `
      <section class="section sign-section avoid-break">
        <h2 class="section-header">Signatur</h2>
        <div class="sign-row">
          <div class="sign-block">
            <div class="sign-line"></div>
            <div class="sign-label">Tekniker</div>
          </div>
          <div class="sign-block">
            <div class="sign-line"></div>
            <div class="sign-label">Kunde</div>
          </div>
        </div>
        <p class="closing">Med vennlig hilsen<br><strong>${this.escapeHtml((settings.company || {}).name || 'Air-Tech AS')}</strong></p>
      </section>
    `;

    if (!productsHtml && !workHtml && !overallHtml && !photosHtml) {
      return signSection;
    }

    return `
      <section class="section avoid-break">
        <h2 class="section-header">Oppsummering og utførte arbeider</h2>
        ${overallHtml}
        ${productsHtml}
        ${workHtml}
        ${photosHtml}
      </section>
      ${signSection}
    `;
  }

  getAirTechCSS() {
    // Ingen blå bakgrunn på toppen – cleaner look.
    return `
      @page { size: A4; margin: 28mm 15mm 20mm 15mm; }
      html, body { font-family: Arial, Helvetica, sans-serif; color:#111; font-size:10.5pt; }
      * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }

      /* Fast logo øverst til høyre på alle sider */
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

      .pdf-container { max-width: 210mm; margin: 0 auto; background: #fff; }
      .header-section { position: relative; margin: 0 0 10px 0; padding: 0 0 6px 0; }
      .main-title { font-size: 20pt; margin: 0 0 4px 0; color:#0B5FAE; }
      .report-id { color:#374151; margin: 0; font-size: 10pt; }
      .header-divider { border-bottom: 2px solid #0B5FAE; margin-top: 10px; }

      .section { margin-top: 14px; }
      .section-header { font-size: 13pt; margin: 0 0 8px 0; color:#0B5FAE; border-bottom:2px solid #0B5FAE; padding-bottom: 4px; }
      .section-subheader { font-size: 12pt; margin: 10px 0; }
      .avoid-break { page-break-inside: avoid; }

      table.styled-table { width: 100%; border-collapse: collapse; }
      table.styled-table th, table.styled-table td { padding: 8px 10px; border-bottom: 1px solid #e5e7eb; text-align: left; }
      table.styled-table thead tr { background: #f3f4f6; }
      .overview-table th:nth-child(1){ width: 28%; }
      .overview-table th:nth-child(2){ width: 22%; }
      .overview-table th:nth-child(3){ width: 28%; }
      .overview-table th:nth-child(4){ width: 22%; }

      .status-cell { font-weight: 600; text-transform: uppercase; text-align:center; }
      .status-ok { color:#059669; }
      .status-byttet { color:#0369a1; }
      .status-avvik { color:#dc2626; }
      .status-na { color:#6b7280; }

      /* Avvik – tydelig header uten stor fargeflate */
      .avvik-header-row { background:#fee2e2; }
      .avvik-table tbody tr:nth-child(even){ background: #fef7f7; }

      .avvik-images-row { background:#fef2f2; border-top: 2px dashed #fca5a5; }
      .avvik-images { padding: 10px 0; }
      .images-grid { display:flex; gap: 10px; flex-wrap: wrap; }
      .avvik-image { max-width: 180px; max-height: 120px; object-fit: cover; border: 2px solid #fee; border-radius: 6px; }

      .checklist-images { padding: 10px 0; display:flex; gap:12px; flex-wrap: wrap; }
      .checklist-image { max-width: 120px; max-height: 80px; object-fit: cover; border: 2px solid #e2e8f0; border-radius: 6px; display: block; }
      .image-caption { font-size: 9pt; color:#64748b; display:block; margin-top:2px; max-width: 120px; }

      .documentation-photos .photo { max-width: 150px; max-height: 100px; object-fit: cover; border:2px solid #e2e8f0; border-radius: 6px; }
      .muted-note { color:#666; font-style: italic; margin: 6px 0 0 0; font-size: 10pt; }

      .sign-section .sign-row{ display:flex; gap:24px; }
      .sign-section .sign-block{ flex:1; }
      .sign-section .sign-line{ border-bottom:1px solid #9ca3af; height:38px; margin-bottom:6px; }
      .sign-section .sign-label{ color:#6b7280; font-size:10pt; }
      .closing{ margin-top:10px; }

      /* Firma-footer (blå) med sidetall – rent, uten stor bakgrunnsflate */
      .footer-company {
        position: fixed;
        left: 0; right: 0; bottom: -8mm;
        font-size: 9pt; color: #1d4ed8; text-align: center;
      }
      .page-info { color:#4b5563; margin-left: 6px; }
      .footer-company .page-number::after { content: counter(page); }
      .footer-company .total-pages::after { content: counter(pages); }

      @media print {
        .section { page-break-inside: avoid; }
      }
    `;
  }

  getRecipientFromCustomerData(customerData) {
    if (!customerData) return '';
    const contacts = customerData.contacts || customerData.kontakter || [];
    const match = contacts.find(c => (c.last_name || c.etternavn || '').toLowerCase() === 'servfixmail');
    if (match?.email) return match.email;
    return customerData.email || customerData.contactPerson || '';
  }

  getOrderLocationFromCustomer(customerData) {
    const post = customerData?.post_address
      || customerData?.postadresse
      || customerData?.postalAddress
      || {};
    const loc = customerData?.location || customerData?.lokasjon || {};
    return {
      buildingName: loc.name || loc.byggnavn || '',
      address: post.addressLine1 || post.address || post.adresse || customerData?.address || '',
      postalCode: post.postalCode || post.postnr || post.postal_code || customerData?.postalCode || '',
    };
  }

  generateHTML(data, settings) {
    const theme = this.getReportTheme((data.equipment_type || '').toLowerCase());
    const logoTag = settings.logoBase64 ? `<img src="${settings.logoBase64}" alt="logo" class="page-logo-fixed"/>` : '';
    const customerName = data.customer_name || data.customerData?.name || '';
    const recipient = this.getRecipientFromCustomerData(data.customer_data || {});
    const where = this.getOrderLocationFromCustomer(data.customer_data || {});
    const technician = data.technician_name || 'Ukjent tekniker';

    const equipmentOverview = this.renderEquipmentOverviewTable(data, theme);
    const avvikTable = this.renderAvvikTable(data);
    const checklistSections = this.renderChecklistResults(data, theme);
    const summarySection = this.generateSummarySection(data, settings);

    const appendixSystems = (data.systemsAppendix && data.systemsAppendix.length)
      ? `
        <div class="page-break"></div>
        <section class="section avoid-break">
          <h2 class="section-header">Systemoversikt (fortsettelse)</h2>
          <table class="styled-table overview-table">
            <thead>
              <tr>${theme.table.equipmentOverviewHeadings.map(h => `<th>${this.escapeHtml(h)}</th>`).join('')}</tr>
            </thead>
            <tbody>
              ${data.systemsAppendix.map(equip => `
                <tr>
                  <td>${this.escapeHtml(equip.systemtype || '')}</td>
                  <td>${this.escapeHtml(equip.systemnummer || '')}</td>
                  <td>${this.escapeHtml(equip.plassering || '')}</td>
                  <td>${this.escapeHtml(equip.betjener || '')}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </section>
      `
      : '';

    const footer = `
      <div class="footer footer-company">
        ${this.escapeHtml((settings.company || {}).name || '')}
        &middot; ${this.escapeHtml((settings.company || {}).address || '')}
        &middot; ${this.escapeHtml((settings.company || {}).phone || '')}
        &middot; ${this.escapeHtml((settings.company || {}).email || '')}
        <span class="page-info">— Side <span class="page-number"></span> av <span class="total-pages"></span></span>
      </div>
    `;

    return `
<!DOCTYPE html>
<html lang="no">
<head>
  <meta charset="utf-8"/>
  <title>${this.escapeHtml(theme.title)} ${this.escapeHtml(data.id)}</title>
  <style>${this.getAirTechCSS()}</style>
</head>
<body>
  ${logoTag}
  <div class="pdf-container">
    <header class="header-section">
      <h1 class="main-title">${this.escapeHtml(theme.title)}</h1>
      <p class="report-id">
        ${this.escapeHtml(customerName)} • Ordre ${this.escapeHtml(data.order_number || '')}
        • ${(data.service_date || '').toString().slice(0,10)}
      </p>
      <div class="header-divider"></div>
    </header>

    <section class="section avoid-break">
      <table class="styled-table">
        <thead>
          <tr>
            <th>Avtalenummer</th><th>Besøk nr</th><th>Årstall</th>
            <th>Kundenummer</th><th>Kundenavn</th><th>Mottaker av rapport</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td></td><td></td><td>${new Date(data.created_at).getFullYear()}</td>
            <td>${this.escapeHtml(data.customer_data?.id || data.customer_id || '')}</td>
            <td>${this.escapeHtml(customerName)}</td>
            <td>${this.escapeHtml(recipient)}</td>
          </tr>
          <tr>
            <th>Byggnavn</th><th>Adresse</th><th>Post nr.</th>
            <th>Rapport dato</th><th>Utført av</th><th>Vår kontaktperson</th>
          </tr>
          <tr>
            <td>${this.escapeHtml(where.buildingName)}</td>
            <td>${this.escapeHtml(where.address)}</td>
            <td>${this.escapeHtml(where.postalCode)}</td>
            <td>${new Date(data.created_at).toLocaleDateString('nb-NO')}</td>
            <td>${this.escapeHtml(technician)}</td>
            <td>${this.escapeHtml(technician)}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="section">
      <p>Servicearbeidet som ble avtalt for de angitte anleggene er nå fullført i tråd med avtalen. 
      I henhold til vår serviceavtale oversender vi en servicerapport etter fullført servicebesøk.</p>
    </section>

    ${equipmentOverview}
    ${avvikTable}
    ${summarySection}

    ${appendixSystems}

    <div class="page-break"></div>
    <section class="section">
      <h2 class="section-header">Detaljerte sjekkpunkter og resultater</h2>
      ${checklistSections}
    </section>
  </div>
  ${footer}
</body>
</html>`;
  }

  /* ===========================
   * PDF / Upload
   * =========================== */
  async generatePDF(html) {
    if (!this.browser) throw new Error('Browser not initialized');
    const page = await this.browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle2', timeout: 45000 });
    await page.emulateMediaType('print');
    await new Promise(resolve => setTimeout(resolve, 1500));
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '20mm', right: '15mm', bottom: '20mm', left: '15mm' },
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
    await file.save(buffer, {
      metadata: { contentType: 'application/pdf' }
    });
    
    // LAGRE RELATIV PATH i database, men logg full URL
    const publicUrl = `https://storage.googleapis.com/${this.bucket.name}/${gcsPath}`;
    const relativePath = `service-reports/${yyyy}/${mm}/${orderId}/${fileName}`;
    
    console.log(`✅ PDF uploaded to GCS: ${publicUrl}`);
    console.log(`📁 Relative path stored: ${relativePath}`);
    
    return relativePath;
  }

  async updateReportPDFPath(reportId, pdfPath, tenantId) {
    const pool = await db.getTenantConnection(tenantId);
    await pool.query(
      'UPDATE service_reports SET pdf_path = $1, pdf_generated = true WHERE id = $2',
      [pdfPath, reportId]
    );
    console.log(`✅ Database updated: ${reportId}`);
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

  /* ===========================
   * Orkestrering
   * =========================== */
  async generateReport(reportId, tenantId) {
    await this.init();
    try {
      const reportData = await this.fetchReportData(reportId, tenantId);
      const settings = await this.loadCompanySettings(tenantId);
      const processed = await this.processAirTechData(reportData);
      const html = this.generateHTML(processed, settings);
      await this.debugSaveHTML(html, reportId);
      const pdfBuffer = await this.generatePDF(html);
      
      // UPLOAD til GCS - KUN DETTE
      const publicUrl = await this.uploadToGCS(tenantId, pdfBuffer, reportId, reportData.order_id);
      
      // OPPDATER database med URL
      await this.updateReportPDFPath(reportId, publicUrl, tenantId);
      
      return publicUrl;
    } finally {
      await this.close();
    }
  }
}

module.exports = UnifiedPDFGenerator;
