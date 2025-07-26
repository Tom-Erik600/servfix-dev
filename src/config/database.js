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
    // Hent tenant info fra admin database
    const adminPool = await this.getPool('servfix_admin');
    const result = await adminPool.query(
      'SELECT database_name FROM tenants WHERE id = $1 AND is_active = true',
      [tenantId]
    );

    if (result.rows.length === 0) {
      throw new Error('Invalid tenant');
    }

    const dbName = result.rows[0].database_name;
    return this.getPool(dbName);
  }
}

module.exports = new Database();