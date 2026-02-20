/**
 * Test: Autentiseringsflyt for tekniker og admin
 *
 * Tester login, logout og /me for begge roller med mocka DB-lag.
 * Verifiserer passordvalidering, session-verdier, og feilhanding.
 *
 * Kjør: npx jest tests/auth-flow.test.js
 */

const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const request = require('supertest');

// --- Mock database ---
const TECH_PASSWORD = 'test123';
let techPasswordHash;

const ADMIN_PASSWORD = 'admin456';
let adminPasswordHash;

const mockTechPool = {
  query: jest.fn()
};

const mockAdminPool = {
  query: jest.fn()
};

// Mock database module
jest.mock('../src/config/database', () => ({
  getTenantConnection: jest.fn(async () => mockTechPool),
  getPool: jest.fn(async () => mockAdminPool)
}));

beforeAll(async () => {
  techPasswordHash = await bcrypt.hash(TECH_PASSWORD, 10);
  adminPasswordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
});

function createTestApp() {
  const app = express();
  app.use(express.json());

  app.use(session({
    name: 'test.sid',
    secret: 'test-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
  }));

  // Tenant middleware (forenklet for test)
  app.use((req, res, next) => {
    if (req.path.startsWith('/api') && !req.path.startsWith('/api/admin')) {
      req.tenantId = req.session?.tenantId || 'test-tenant';
    }
    next();
  });

  app.use('/api/auth', require('../src/routes/auth'));
  app.use('/api/admin/auth', require('../src/routes/admin-auth'));

  return app;
}

// --- Tekniker auth tester ---
describe('Tekniker auth-flyt', () => {
  let app;

  beforeEach(() => {
    app = createTestApp();
    jest.clearAllMocks();
  });

  test('login med riktig passord returnerer tekniker-data', async () => {
    mockTechPool.query.mockResolvedValueOnce({
      rows: [{
        id: 'T001',
        name: 'Ola Nordmann',
        initials: 'ON',
        password_hash: techPasswordHash,
        is_active: true
      }]
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ technicianId: 'T001', password: TECH_PASSWORD, tenantId: 'test-tenant' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.technician).toEqual({
      id: 'T001',
      name: 'Ola Nordmann',
      initials: 'ON'
    });
  });

  test('login med feil passord returnerer 401', async () => {
    mockTechPool.query.mockResolvedValueOnce({
      rows: [{
        id: 'T001',
        name: 'Ola Nordmann',
        password_hash: techPasswordHash,
        is_active: true
      }]
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ technicianId: 'T001', password: 'feilpassord', tenantId: 'test-tenant' });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Ugyldig/);
  });

  test('login med ukjent bruker returnerer 401', async () => {
    mockTechPool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ technicianId: 'FINNES-IKKE', password: 'noe', tenantId: 'test-tenant' });

    expect(res.status).toBe(401);
  });

  test('/me uten session returnerer 401', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  test('/me etter login returnerer tekniker-info', async () => {
    const agent = request.agent(app);

    // Login
    mockTechPool.query.mockResolvedValueOnce({
      rows: [{
        id: 'T001',
        name: 'Ola Nordmann',
        initials: 'ON',
        password_hash: techPasswordHash,
        is_active: true
      }]
    });

    await agent
      .post('/api/auth/login')
      .send({ technicianId: 'T001', password: TECH_PASSWORD, tenantId: 'test-tenant' });

    // /me — mock DB for henting av tekniker
    mockTechPool.query.mockResolvedValueOnce({
      rows: [{ id: 'T001', name: 'Ola Nordmann', initials: 'ON' }]
    });

    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.technician.id).toBe('T001');
    expect(me.body.tenant).toBe('test-tenant');
  });

  test('logout ødelegger session', async () => {
    const agent = request.agent(app);

    // Login
    mockTechPool.query.mockResolvedValueOnce({
      rows: [{
        id: 'T001',
        name: 'Ola',
        initials: 'O',
        password_hash: techPasswordHash,
        is_active: true
      }]
    });

    await agent
      .post('/api/auth/login')
      .send({ technicianId: 'T001', password: TECH_PASSWORD, tenantId: 'test-tenant' });

    // Logout
    const logout = await agent.post('/api/auth/logout');
    expect(logout.status).toBe(200);
    expect(logout.body.success).toBe(true);

    // /me skal naa feile
    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(401);
  });
});

// --- Admin auth tester ---
describe('Admin auth-flyt', () => {
  let app;

  beforeEach(() => {
    app = createTestApp();
    jest.clearAllMocks();
  });

  test('admin login med riktig passord returnerer admin-data', async () => {
    mockAdminPool.query.mockResolvedValueOnce({
      rows: [{
        id: 1,
        email: 'admin@test.no',
        name: 'Admin User',
        password_hash: adminPasswordHash,
        tenant_id: 'test-tenant'
      }]
    });

    const res = await request(app)
      .post('/api/admin/auth/login')
      .send({ username: 'admin@test.no', password: ADMIN_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.admin.email).toBe('admin@test.no');
    expect(res.body.admin.tenantId).toBe('test-tenant');
  });

  test('admin login med feil passord returnerer 401', async () => {
    mockAdminPool.query.mockResolvedValueOnce({
      rows: [{
        id: 1,
        email: 'admin@test.no',
        password_hash: adminPasswordHash,
        tenant_id: 'test-tenant'
      }]
    });

    const res = await request(app)
      .post('/api/admin/auth/login')
      .send({ username: 'admin@test.no', password: 'feilpassord' });

    expect(res.status).toBe(401);
  });

  test('admin login med ukjent bruker returnerer 401', async () => {
    mockAdminPool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/admin/auth/login')
      .send({ username: 'finnes@ikke.no', password: 'noe' });

    expect(res.status).toBe(401);
  });

  test('admin /me uten session returnerer 401', async () => {
    const res = await request(app).get('/api/admin/auth/me');
    expect(res.status).toBe(401);
  });

  test('admin /me etter login returnerer admin-info', async () => {
    const agent = request.agent(app);

    mockAdminPool.query.mockResolvedValueOnce({
      rows: [{
        id: 1,
        email: 'admin@test.no',
        name: 'Admin',
        password_hash: adminPasswordHash,
        tenant_id: 'test-tenant'
      }]
    });

    await agent
      .post('/api/admin/auth/login')
      .send({ username: 'admin@test.no', password: ADMIN_PASSWORD });

    const me = await agent.get('/api/admin/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.admin.email).toBe('admin@test.no');
    expect(me.body.admin.tenantId).toBe('test-tenant');
  });

  test('admin logout ødelegger session', async () => {
    const agent = request.agent(app);

    mockAdminPool.query.mockResolvedValueOnce({
      rows: [{
        id: 1,
        email: 'admin@test.no',
        name: 'Admin',
        password_hash: adminPasswordHash,
        tenant_id: 'test-tenant'
      }]
    });

    await agent
      .post('/api/admin/auth/login')
      .send({ username: 'admin@test.no', password: ADMIN_PASSWORD });

    const logout = await agent.post('/api/admin/auth/logout');
    expect(logout.status).toBe(200);
    expect(logout.body.success).toBe(true);

    const me = await agent.get('/api/admin/auth/me');
    expect(me.status).toBe(401);
  });
});
