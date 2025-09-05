const { Pool } = require('pg');
require('dotenv').config();

class Database {
  constructor() {
    this.pools = {};
    this.config = {
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    };

    // For Cloud Run
    if (process.env.NODE_ENV === 'production') {
      this.config.host = `/cloudsql/${process.env.CLOUD_SQL_CONNECTION_NAME}`;
    }
  }

  async getPool(database) {
    if (!this.pools[database]) {
      this.pools[database] = new Pool({
        ...this.config,
        database
      });
    }
    return this.pools[database];
  }

  async getTenantConnection(tenantId) {
    console.log(`🔍 Getting tenant connection for: ${tenantId}`);
    
    try {
        // Hent tenant info fra admin database
        const adminPool = await this.getPool('servfix_admin');
        const result = await adminPool.query(
            'SELECT database_name FROM tenants WHERE id = $1 AND is_active = true',
            [tenantId]
        );

        let dbName;
        if (result.rows.length === 0) {
            console.warn(`⚠️ Tenant ${tenantId} not found, using default airtech_db`);
            dbName = 'airtech_db'; // Fallback til airtech_db
        } else {
            dbName = result.rows[0].database_name;
        }
        
        console.log(`✅ Using database: ${dbName} for tenant: ${tenantId}`);
        return this.getPool(dbName);
        
    } catch (error) {
        console.error(`❌ Database connection error for tenant ${tenantId}:`, error);
        console.log(`🔄 Falling back to airtech_db`);
        return this.getPool('airtech_db'); // Ultimate fallback
    }
}
}

module.exports = new Database();