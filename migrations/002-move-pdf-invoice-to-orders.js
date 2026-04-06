#!/usr/bin/env node

/**
 * Migrasjon: Flytt PDF- og faktura-state fra service_reports til orders
 *
 * Bakgrunn: Systemet ble opprinnelig designet 1 service = 1 rapport = 1 PDF.
 * Virkeligheten er 1 ordre = N anlegg = N servicerapporter = 1 samlet PDF.
 * PDF-path, fakturastatus og sendestatus hører til ordren, ikke individuelle rapporter.
 *
 * Denne migrasjonen:
 *   STEG 1: Legg til nye kolonner på orders-tabellen
 *   STEG 2: Migrer eksisterende data fra service_reports til orders
 *           (bruker første rapport per ordre som kilde for pdf_path/pdf_generated,
 *            og aggregert logikk for boolean-felter)
 *   STEG 3: DROPPER IKKE kolonner fra service_reports (beholdes for sikkerhet)
 *
 * Bruk:
 *   node migrations/002-move-pdf-invoice-to-orders.js                    # Alle tenants
 *   node migrations/002-move-pdf-invoice-to-orders.js --tenant=airtech   # Kun én
 *   node migrations/002-move-pdf-invoice-to-orders.js --dry-run          # Vis SQL, ikke kjør
 */

require('dotenv').config();
const { Pool } = require('pg');

// ── CLI-flagg ──────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const tenantFlag = args.find(a => a.startsWith('--tenant='));
const ONLY_TENANT = tenantFlag ? tenantFlag.split('=')[1] : null;

// ── DB-konfig (samme logikk som src/config/database.js) ───────────
function getBaseConfig() {
  if (process.env.CLOUD_SQL_CONNECTION_NAME) {
    return {
      host: `/cloudsql/${process.env.CLOUD_SQL_CONNECTION_NAME}`,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
    };
  }
  return {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  };
}

// ── STEG 1: Legg til kolonner på orders ───────────────────────────
const ADD_COLUMNS_SQL = `
-- pdf_path: relativ sti til den genererte PDF-filen i GCS
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'orders' AND column_name = 'pdf_path'
    ) THEN
        ALTER TABLE orders ADD COLUMN pdf_path TEXT;
    END IF;
END$$;

-- pdf_generated: om PDF er generert for ordren
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'orders' AND column_name = 'pdf_generated'
    ) THEN
        ALTER TABLE orders ADD COLUMN pdf_generated BOOLEAN DEFAULT false;
    END IF;
END$$;

-- sent_til_fakturering: om rapporten er sendt til kunde/fakturering
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'orders' AND column_name = 'sent_til_fakturering'
    ) THEN
        ALTER TABLE orders ADD COLUMN sent_til_fakturering BOOLEAN DEFAULT false;
    END IF;
END$$;

-- pdf_sent_timestamp: når PDF ble sendt
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'orders' AND column_name = 'pdf_sent_timestamp'
    ) THEN
        ALTER TABLE orders ADD COLUMN pdf_sent_timestamp TIMESTAMP;
    END IF;
END$$;

-- is_invoiced: om ordren er fakturert
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'orders' AND column_name = 'is_invoiced'
    ) THEN
        ALTER TABLE orders ADD COLUMN is_invoiced BOOLEAN DEFAULT false;
    END IF;
END$$;

-- invoice_number: fakturanummer
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'orders' AND column_name = 'invoice_number'
    ) THEN
        ALTER TABLE orders ADD COLUMN invoice_number VARCHAR(100);
    END IF;
END$$;

-- invoice_date: fakturadato
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'orders' AND column_name = 'invoice_date'
    ) THEN
        ALTER TABLE orders ADD COLUMN invoice_date DATE;
    END IF;
END$$;

-- invoice_comment: fakturakommentar
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'orders' AND column_name = 'invoice_comment'
    ) THEN
        ALTER TABLE orders ADD COLUMN invoice_comment TEXT;
    END IF;
END$$;
`;

// ── STEG 2: Migrer eksisterende data ──────────────────────────────
// Henter "beste" data per ordre fra service_reports:
//   - pdf_path: fra rapporten med pdf_generated=true (sorter på created_at ASC, ta første)
//   - pdf_generated: true hvis minst én rapport har pdf_generated=true
//   - sent_til_fakturering: true hvis alle rapporter er sendt (BOOL_AND)
//   - pdf_sent_timestamp: MAX av alle pdf_sent_timestamp
//   - is_invoiced: true hvis alle rapporter er fakturert (BOOL_AND)
//   - invoice_number/date/comment: MAX (vil typisk være lik for alle i samme ordre)
const MIGRATE_DATA_SQL = `
UPDATE orders o
SET
    pdf_path           = sub.pdf_path,
    pdf_generated      = sub.pdf_generated,
    sent_til_fakturering = sub.sent_til_fakturering,
    pdf_sent_timestamp = sub.pdf_sent_timestamp,
    is_invoiced        = sub.is_invoiced,
    invoice_number     = sub.invoice_number,
    invoice_date       = sub.invoice_date,
    invoice_comment    = sub.invoice_comment
FROM (
    SELECT
        sr.order_id,
        -- pdf_path fra første rapport med en generert PDF
        (
            SELECT sr2.pdf_path
            FROM service_reports sr2
            WHERE sr2.order_id = sr.order_id
              AND sr2.pdf_path IS NOT NULL
              AND sr2.pdf_generated = true
            ORDER BY sr2.created_at ASC
            LIMIT 1
        ) AS pdf_path,
        BOOL_OR(sr.pdf_generated)        AS pdf_generated,
        BOOL_AND(sr.sent_til_fakturering) AS sent_til_fakturering,
        MAX(sr.pdf_sent_timestamp)        AS pdf_sent_timestamp,
        BOOL_AND(sr.is_invoiced)          AS is_invoiced,
        MAX(sr.invoice_number)            AS invoice_number,
        MAX(sr.invoice_date)              AS invoice_date,
        MAX(sr.invoice_comment)           AS invoice_comment
    FROM service_reports sr
    WHERE sr.order_id IS NOT NULL
    GROUP BY sr.order_id
) sub
WHERE o.id = sub.order_id;
`;

// ── Verifiserings-SQL ─────────────────────────────────────────────
const VERIFY_SQL = `
SELECT
    (SELECT count(*) FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'pdf_path')            as pdf_path_ok,
    (SELECT count(*) FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'pdf_generated')       as pdf_generated_ok,
    (SELECT count(*) FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'sent_til_fakturering') as sent_ok,
    (SELECT count(*) FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'pdf_sent_timestamp')  as sent_ts_ok,
    (SELECT count(*) FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'is_invoiced')         as invoiced_ok,
    (SELECT count(*) FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'invoice_number')      as inv_number_ok,
    (SELECT count(*) FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'invoice_date')        as inv_date_ok,
    (SELECT count(*) FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'invoice_comment')     as inv_comment_ok,
    -- Datamigrering: sjekk at orders med ferdigstilte rapporter har fått pdf_path
    (SELECT count(*) FROM orders o WHERE o.pdf_generated = true AND o.pdf_path IS NOT NULL) as orders_with_pdf
`;

// ── Antall migrerte rader ─────────────────────────────────────────
const COUNT_MIGRATED_SQL = `
SELECT
    COUNT(*) FILTER (WHERE pdf_generated = true) as orders_pdf_generated,
    COUNT(*) FILTER (WHERE sent_til_fakturering = true) as orders_sent,
    COUNT(*) FILTER (WHERE is_invoiced = true) as orders_invoiced
FROM orders;
`;

// ── Hovedlogikk ───────────────────────────────────────────────────
async function main() {
  console.log('========================================');
  console.log('  ServFix — Database-migrering');
  console.log('  002-move-pdf-invoice-to-orders');
  console.log('========================================');
  console.log('  MERK: Kolonner i service_reports beholdes (ikke droppet)');
  if (DRY_RUN) console.log('  MODE: DRY RUN (ingen endringer)');
  if (ONLY_TENANT) console.log(`  TENANT: kun "${ONLY_TENANT}"`);
  console.log('');

  const baseConfig = getBaseConfig();

  const adminPool = new Pool({ ...baseConfig, database: 'servfix_admin' });

  let tenants;
  try {
    let query = 'SELECT id, database_name FROM tenants WHERE is_active = true';
    const params = [];
    if (ONLY_TENANT) {
      query += ' AND id = $1';
      params.push(ONLY_TENANT);
    }
    query += ' ORDER BY id';
    const result = await adminPool.query(query, params);
    tenants = result.rows;
  } catch (err) {
    console.error('❌ Kunne ikke koble til servfix_admin:', err.message);
    await adminPool.end();
    process.exit(1);
  }

  await adminPool.end();

  if (tenants.length === 0) {
    console.error('❌ Ingen aktive tenants funnet' + (ONLY_TENANT ? ` med id="${ONLY_TENANT}"` : ''));
    process.exit(1);
  }

  console.log(`Fant ${tenants.length} tenant(s):\n`);
  const results = [];

  for (const tenant of tenants) {
    console.log(`── Tenant: ${tenant.id} (${tenant.database_name}) ──`);

    if (DRY_RUN) {
      console.log('  [DRY RUN] SQL som ville blitt kjørt:');
      console.log('  STEG 1: ADD COLUMNS');
      console.log(ADD_COLUMNS_SQL);
      console.log('  STEG 2: MIGRATE DATA');
      console.log(MIGRATE_DATA_SQL);
      results.push({ tenant: tenant.id, status: 'dry-run' });
      continue;
    }

    const pool = new Pool({ ...baseConfig, database: tenant.database_name });
    try {
      // STEG 1: Legg til kolonner
      console.log('  📦 Steg 1: Legger til kolonner på orders...');
      await pool.query(ADD_COLUMNS_SQL);
      console.log('  ✅ Kolonner lagt til');

      // STEG 2: Migrer eksisterende data
      console.log('  📋 Steg 2: Migrerer data fra service_reports → orders...');
      const migrateResult = await pool.query(MIGRATE_DATA_SQL);
      console.log(`  ✅ Datamigrering fullført (${migrateResult.rowCount} ordre oppdatert)`);

      // Verifiser
      const verify = await pool.query(VERIFY_SQL);
      const v = verify.rows[0];
      const columnsOk = [
        'pdf_path_ok', 'pdf_generated_ok', 'sent_ok', 'sent_ts_ok',
        'invoiced_ok', 'inv_number_ok', 'inv_date_ok', 'inv_comment_ok'
      ].every(key => parseInt(v[key]) === 1);

      if (columnsOk) {
        console.log('  ✅ Verifisering OK — alle kolonner opprettet');
      } else {
        console.log('  ⚠️  Verifisering — noen kolonner mangler:');
        console.log(`      orders.pdf_path:             ${v.pdf_path_ok === '1' ? '✅' : '❌'}`);
        console.log(`      orders.pdf_generated:        ${v.pdf_generated_ok === '1' ? '✅' : '❌'}`);
        console.log(`      orders.sent_til_fakturering: ${v.sent_ok === '1' ? '✅' : '❌'}`);
        console.log(`      orders.pdf_sent_timestamp:   ${v.sent_ts_ok === '1' ? '✅' : '❌'}`);
        console.log(`      orders.is_invoiced:          ${v.invoiced_ok === '1' ? '✅' : '❌'}`);
        console.log(`      orders.invoice_number:       ${v.inv_number_ok === '1' ? '✅' : '❌'}`);
        console.log(`      orders.invoice_date:         ${v.inv_date_ok === '1' ? '✅' : '❌'}`);
        console.log(`      orders.invoice_comment:      ${v.inv_comment_ok === '1' ? '✅' : '❌'}`);
      }

      // Tellestatistikk for migrert data
      const counts = await pool.query(COUNT_MIGRATED_SQL);
      const c = counts.rows[0];
      console.log(`  📊 Migrert data:`);
      console.log(`      Ordre med PDF generert:   ${c.orders_pdf_generated}`);
      console.log(`      Ordre sendt til kunde:    ${c.orders_sent}`);
      console.log(`      Ordre fakturert:          ${c.orders_invoiced}`);

      results.push({ tenant: tenant.id, status: columnsOk ? 'ok' : 'partial', details: v });
    } catch (err) {
      console.error(`  ❌ Feil: ${err.message}`);
      results.push({ tenant: tenant.id, status: 'error', error: err.message });
    } finally {
      await pool.end();
    }
    console.log('');
  }

  // Oppsummering
  console.log('========================================');
  console.log('  OPPSUMMERING');
  console.log('========================================');
  for (const r of results) {
    const icon = r.status === 'ok' ? '✅' : r.status === 'dry-run' ? '🔍' : r.status === 'partial' ? '⚠️' : '❌';
    console.log(`  ${icon} ${r.tenant}: ${r.status}${r.error ? ' — ' + r.error : ''}`);
  }
  console.log('');

  const hasErrors = results.some(r => r.status === 'error');
  process.exit(hasErrors ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal feil:', err);
  process.exit(1);
});
