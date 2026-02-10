const { Pool } = require('pg');

// Kun last dotenv lokalt, IKKE i Cloud Run
if (!process.env.K_SERVICE) {
  require('dotenv').config();
}

class Database {
  constructor() {
    console.log('🔧 DATABASE CONSTRUCTOR START');
    console.log('🔧 CLOUD_SQL_CONNECTION_NAME:', process.env.CLOUD_SQL_CONNECTION_NAME);
    
    this.pools = {};

    // Pool-størrelse: bruk env-variabel eller fornuftig default per miljø
    const poolMax = parseInt(process.env.DB_POOL_MAX) || (process.env.K_SERVICE ? 10 : 5);

    // Sjekk FØRST om vi skal bruke Cloud SQL
    if (process.env.CLOUD_SQL_CONNECTION_NAME) {
      console.log('✅ BRUKER CLOUD SQL SOCKET');
      this.config = {
        host: `/cloudsql/${process.env.CLOUD_SQL_CONNECTION_NAME}`,
        // VIKTIG: Ingen port er satt for Unix socket!
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        max: poolMax,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
      };
    } else {
      console.log('❌ BRUKER LOKAL DATABASE (localhost)');
      this.config = {
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || 5432,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        max: poolMax,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
      };
    }
    console.log(`🔧 Pool max: ${poolMax} per database`);

    console.log('🔧 ENDELIG KONFIG:', JSON.stringify(this.config));
  }

  async getPool(database) {
    if (!this.pools[database]) {
      const poolConfig = {
        ...this.config,
        database
      };
      console.log(`📦 Oppretter pool for [${database}]`);
      this.pools[database] = new Pool(poolConfig);
    }
    return this.pools[database];
  }

  async getTenantConnection(tenantId) {
    console.log(`🔍 Henter tenant: ${tenantId}`);
    try {
      const adminPool = await this.getPool('servfix_admin');
      const result = await adminPool.query(
        'SELECT database_name FROM tenants WHERE id = $1 AND is_active = true',
        [tenantId]
      );
      let dbName;
      if (result.rows.length === 0) {
        console.warn(`⚠️ Tenant ${tenantId} ikke funnet, bruker airtech_db`);
        dbName = 'airtech_db';
      } else {
        dbName = result.rows[0].database_name;
      }
      console.log(`✅ Bruker database: ${dbName}`);
      return this.getPool(dbName);
    } catch (error) {
      console.error(`❌ DB-feil for tenant ${tenantId}:`, error);
      console.log(`🔄 Fallback til airtech_db`);
      return this.getPool('airtech_db');
    }
  }
}

module.exports = new Database();
