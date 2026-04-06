'use strict';
const { Pool } = require('pg');
require('dotenv').config();

const port = process.env.CHECK_PORT || 5432;

async function checkDb(dbName) {
    const pool = new Pool({
        host: 'localhost',
        port: Number(port),
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: dbName,
    });
    try {
        const orders = await pool.query(`
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'orders'
              AND column_name IN ('scheduled_date','service_address_street','service_address_postal_code','service_address_city')
            ORDER BY column_name`);

        const equipment = await pool.query(`
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'equipment'
              AND column_name IN ('has_filters','filter_supply','filter_exhaust','filter_drive_supply','filter_drive_exhaust')
            ORDER BY column_name`);

        const tableExists = await pool.query(`
            SELECT COUNT(*) AS cnt FROM information_schema.tables
            WHERE table_name = 'customer_contacts'`);

        const constraintExists = await pool.query(`
            SELECT COUNT(*) AS cnt FROM pg_constraint
            WHERE conname = 'customer_contacts_customer_id_email_key'`);

        console.log(`\n=== ${dbName} (port ${port}) ===`);
        console.log('orders columns    :', orders.rows.map(r => r.column_name).join(', ') || '(ingen)');
        console.log('equipment columns :', equipment.rows.map(r => r.column_name).join(', ') || '(ingen)');
        console.log('customer_contacts :', tableExists.rows[0].cnt === '1' ? 'OK' : 'MANGLER');
        console.log('unique constraint :', constraintExists.rows[0].cnt === '1' ? 'OK' : 'MANGLER');
    } catch (err) {
        console.error(`[${dbName}] FEIL:`, err.message);
    } finally {
        await pool.end();
    }
}

async function main() {
    await checkDb('airtech_db');
    await checkDb('demo_db');
}

main().catch(err => { console.error(err); process.exit(1); });
