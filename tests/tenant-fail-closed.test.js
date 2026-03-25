/**
 * Tenant Fail-Closed Tests
 *
 * Verifiserer at getTenantConnection() feiler trygt i stedet for å
 * falle tilbake til airtech_db ved ukjent tenant, inaktiv tenant,
 * manglende tenantId, eller DB-feil.
 *
 * Disse testene bruker mocks og trenger IKKE en ekte database.
 * Kjør med: npx jest tests/tenant-fail-closed.test.js
 */

const db = require('../src/config/database');

// Hjelper: erstatt adminPool.query med en mock for én test
function mockAdminQuery(mockFn) {
  const original = db.getPool.bind(db);
  db.getPool = async (database) => {
    if (database === 'servfix_admin') {
      return { query: mockFn };
    }
    return original(database);
  };
  return () => { db.getPool = original; };
}

describe('getTenantConnection — fail-closed oppførsel', () => {

  test('kaster feil med statusCode 400 når tenantId er null', async () => {
    await expect(db.getTenantConnection(null)).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringMatching(/mangler/i)
    });
  });

  test('kaster feil med statusCode 400 når tenantId er undefined', async () => {
    await expect(db.getTenantConnection(undefined)).rejects.toMatchObject({
      statusCode: 400
    });
  });

  test('kaster feil med statusCode 400 når tenantId er tom streng', async () => {
    await expect(db.getTenantConnection('')).rejects.toMatchObject({
      statusCode: 400
    });
  });

  test('kaster feil med statusCode 403 når tenant ikke finnes i databasen', async () => {
    const restore = mockAdminQuery(async () => ({ rows: [] }));
    try {
      await expect(db.getTenantConnection('ukjent-tenant')).rejects.toMatchObject({
        statusCode: 403,
        message: expect.stringMatching(/ukjent|inaktiv/i)
      });
    } finally {
      restore();
    }
  });

  test('kaster feil med statusCode 403 — returnerer IKKE airtech_db for ukjent tenant', async () => {
    const restore = mockAdminQuery(async () => ({ rows: [] }));
    try {
      await expect(db.getTenantConnection('annen-bedrift')).rejects.toThrow();
      // Viktig: verifiser at ingen pool for airtech_db ble opprettet i denne testen
      // ved å sjekke at feilen har riktig statusCode (ikke en pool-instans)
      const error = await db.getTenantConnection('annen-bedrift').catch(e => e);
      expect(error).toBeInstanceOf(Error);
      expect(error.statusCode).toBe(403);
    } finally {
      restore();
    }
  });

  test('kaster feil med statusCode 503 når admin-databasen er utilgjengelig', async () => {
    const restore = mockAdminQuery(async () => {
      throw new Error('Connection refused');
    });
    try {
      await expect(db.getTenantConnection('airtech')).rejects.toMatchObject({
        statusCode: 503
      });
    } finally {
      restore();
    }
  });

  test('returnerer pool når tenant eksisterer og er aktiv', async () => {
    const restore = mockAdminQuery(async () => ({
      rows: [{ database_name: 'airtech_db' }]
    }));
    try {
      const pool = await db.getTenantConnection('airtech');
      expect(pool).toBeDefined();
      expect(typeof pool.query).toBe('function');
    } finally {
      restore();
    }
  });

});
