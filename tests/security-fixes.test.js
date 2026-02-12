/**
 * Tester for sikkerhetsfiks S1, S2 og S3
 * Kjør: npx jest tests/security-fixes.test.js
 */
const { execSync } = require('child_process');
const path = require('path');

// Mock database FØR noe annet lastes
jest.mock('../src/config/database', () => ({
  getTenantConnection: jest.fn().mockResolvedValue({
    query: jest.fn().mockResolvedValue({
      rows: [{ id: 1, name: 'Test', initials: 'TT', stilling: 'Tech', is_active: true }]
    })
  }),
  getPool: jest.fn().mockResolvedValue({
    query: jest.fn().mockResolvedValue({ rows: [] })
  })
}));

const express = require('express');
const session = require('express-session');
const request = require('supertest');
const db = require('../src/config/database');

/** Hjelpefunksjon: lag minimal Express-app med session for å teste ruter isolert */
function createTestApp(router, mountPath, sessionOverrides = {}) {
  const app = express();
  app.use(express.json());
  app.use(session({
    secret: 'test-secret',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }
  }));
  app.use((req, res, next) => {
    Object.assign(req.session, sessionOverrides);
    // Sett req.tenantId for tekniker-ruter (som server.js middleware gjør)
    if (sessionOverrides.tenantId) {
      req.tenantId = sessionOverrides.tenantId;
    }
    next();
  });
  app.use(mountPath, router);
  return app;
}

// ============================================================
// S1: SESSION_SECRET kreves ved oppstart
// ============================================================
describe('S1: SESSION_SECRET kreves ved oppstart', () => {
  const serverPath = path.resolve(__dirname, '..', 'server.js');

  test('server avbryter med exit code 1 hvis SESSION_SECRET mangler', () => {
    // Kjør server.js i en egen prosess der dotenv patches bort og SESSION_SECRET fjernes.
    // Må patche dotenv FØR server.js lastes, ellers leser den .env-filen.
    const script = [
      "const dotenv = require('dotenv');",
      "dotenv.config = () => ({});",  // Patch: ikke les .env
      "delete process.env.SESSION_SECRET;",
      "require('./server.js');"
    ].join(' ');

    try {
      execSync(`node -e "${script}"`, {
        timeout: 5000,
        cwd: path.resolve(__dirname, '..'),
        stdio: 'pipe'
      });
      throw new Error('Serveren skulle ha avbrutt');
    } catch (err) {
      expect(err.status).not.toBe(0);
      const output = err.stderr.toString() + err.stdout.toString();
      expect(output).toContain('SESSION_SECRET');
    }
  });

  test('server passerer secret-sjekken når SESSION_SECRET er satt', () => {
    // Kjør bare valideringsbiten — ikke hele serveren (unngå portbinding)
    const result = execSync(
      `node -e "process.env.SESSION_SECRET='test123'; const fs = require('fs'); const code = fs.readFileSync('${serverPath.replace(/\\/g, '\\\\')}','utf8'); const lines = code.split('\\n'); const checkEnd = lines.findIndex(l => l.includes('Security configuration check')); const snippet = lines.slice(0, checkEnd).join('\\n'); eval(snippet); console.log('PASS');"`,
      {
        timeout: 5000,
        env: { ...process.env, SESSION_SECRET: 'test-secret-ok' },
        stdio: 'pipe',
        cwd: path.resolve(__dirname, '..')
      }
    );
    expect(result.toString()).toContain('PASS');
  });
});

// ============================================================
// S2: Technicians-endepunktet krever auth
// ============================================================
describe('S2: /api/technicians krever autentisering', () => {
  const techRouter = require('../src/routes/technicians');

  test('GET uten session gir 401', async () => {
    const app = createTestApp(techRouter, '/api/technicians', {
      // Ingen technicianId eller isAdmin
    });

    const res = await request(app).get('/api/technicians');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/authentication required/i);
  });

  test('GET med technicianId gir 200', async () => {
    const app = createTestApp(techRouter, '/api/technicians', {
      technicianId: 'TECH-TT',
      tenantId: 'test-tenant'
    });

    const res = await request(app).get('/api/technicians');
    expect(res.status).toBe(200);
  });

  test('GET med isAdmin gir 200', async () => {
    const app = createTestApp(techRouter, '/api/technicians', {
      isAdmin: true,
      tenantId: 'test-tenant'
    });

    const res = await request(app).get('/api/technicians');
    expect(res.status).toBe(200);
  });
});

// ============================================================
// S3: Admin tenant-isolasjon (delt middleware)
// ============================================================
describe('S3: Admin-ruter — tenant-isolasjon', () => {
  const adminTechRouter = require('../src/routes/admin/technicians');

  beforeEach(() => {
    db.getTenantConnection.mockClear();
  });

  test('?tenantId= i URL ignoreres — session-tenant brukes', async () => {
    const app = createTestApp(adminTechRouter, '/api/admin/technicians', {
      isAdmin: true,
      tenantId: 'riktig-tenant',
      selectedTenantId: 'riktig-tenant'
    });

    await request(app)
      .get('/api/admin/technicians?tenantId=ondsinnet-tenant');

    expect(db.getTenantConnection).toHaveBeenCalledWith('riktig-tenant');
    expect(db.getTenantConnection).not.toHaveBeenCalledWith('ondsinnet-tenant');
  });

  test('uten selectedTenantId i session gir 400', async () => {
    const app = createTestApp(adminTechRouter, '/api/admin/technicians', {
      isAdmin: true
      // INGEN selectedTenantId
    });

    const res = await request(app).get('/api/admin/technicians');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/tenant/i);
  });

  test('uten admin-session gir 401', async () => {
    const app = createTestApp(adminTechRouter, '/api/admin/technicians', {
      // Ingen isAdmin
    });

    const res = await request(app).get('/api/admin/technicians');
    expect(res.status).toBe(401);
  });

  test('header med matchende tenant godtas', async () => {
    const app = createTestApp(adminTechRouter, '/api/admin/technicians', {
      isAdmin: true,
      tenantId: 'airtech',          // login-tenant
      selectedTenantId: 'airtech'
    });

    const res = await request(app)
      .get('/api/admin/technicians')
      .set('x-tenant-id', 'airtech');  // Matcher login-tenant

    expect(res.status).toBe(200);
    expect(db.getTenantConnection).toHaveBeenCalledWith('airtech');
  });

  test('header med ANNEN tenant gir 403 for bundet admin', async () => {
    const app = createTestApp(adminTechRouter, '/api/admin/technicians', {
      isAdmin: true,
      tenantId: 'airtech',             // Bundet til 'airtech'
      selectedTenantId: 'airtech'
    });

    const res = await request(app)
      .get('/api/admin/technicians')
      .set('x-tenant-id', 'ondsinnet-firma');  // Prøver å bytte

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/tilgang/i);
    expect(db.getTenantConnection).not.toHaveBeenCalled();
  });

  test('super-admin (uten tenantId) kan bytte fritt via header', async () => {
    const app = createTestApp(adminTechRouter, '/api/admin/technicians', {
      isAdmin: true,
      // tenantId: undefined — super-admin
      selectedTenantId: 'tenant-a'
    });

    await request(app)
      .get('/api/admin/technicians')
      .set('x-tenant-id', 'tenant-b');

    expect(db.getTenantConnection).toHaveBeenCalledWith('tenant-b');
  });
});
