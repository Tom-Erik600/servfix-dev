/**
 * Test: Admin tenant-isolasjon middleware
 *
 * Verifiserer at admin-tenant.js middleware håndhever:
 * - Krever admin-session (401 uten)
 * - Admin bundet til tenant kan ikke bytte til annen tenant (403)
 * - Super-admin (uten tenant) kan bytte fritt
 * - Krever at tenant er valgt (400 uten)
 * - req.adminTenantId settes korrekt
 *
 * Kjør: npx jest tests/admin-tenant-isolation.test.js
 */

const express = require('express');
const session = require('express-session');
const request = require('supertest');
const adminTenant = require('../src/middleware/admin-tenant');

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

  // Hjelperoute for å sette opp session (simulerer login)
  app.post('/test/setup-session', (req, res) => {
    const { isAdmin, adminId, tenantId, selectedTenantId } = req.body;
    if (isAdmin) req.session.isAdmin = true;
    if (adminId) req.session.adminId = adminId;
    if (tenantId) req.session.tenantId = tenantId;
    if (selectedTenantId) req.session.selectedTenantId = selectedTenantId;
    req.session.save(() => res.json({ ok: true }));
  });

  // Rute beskyttet av admin-tenant middleware
  app.get('/test/protected', adminTenant, (req, res) => {
    res.json({ adminTenantId: req.adminTenantId });
  });

  return app;
}

function extractCookies(res) {
  const raw = res.headers['set-cookie'] || [];
  return raw.map(c => c.split(';')[0]).join('; ');
}

describe('Admin tenant-isolasjon middleware', () => {
  let app;

  beforeAll(() => {
    app = createTestApp();
  });

  test('avviser request uten admin-session (401)', async () => {
    const res = await request(app).get('/test/protected');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Admin authentication required/);
  });

  test('avviser admin uten valgt tenant (400)', async () => {
    const agent = request.agent(app);

    // Login som admin uten tenant
    await agent.post('/test/setup-session').send({
      isAdmin: true,
      adminId: 'admin-1'
      // Ingen tenantId eller selectedTenantId
    });

    const res = await agent.get('/test/protected');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Ingen tenant valgt/);
  });

  test('admin bundet til tenant A kan IKKE aksessere tenant B (403)', async () => {
    const agent = request.agent(app);

    // Login som admin bundet til 'airtech'
    await agent.post('/test/setup-session').send({
      isAdmin: true,
      adminId: 'admin-1',
      tenantId: 'airtech',
      selectedTenantId: 'airtech'
    });

    // Forsok a aksessere 'other-tenant' via header
    const res = await agent
      .get('/test/protected')
      .set('x-tenant-id', 'other-tenant');

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Ikke tilgang/);
  });

  test('admin bundet til tenant A kan aksessere tenant A', async () => {
    const agent = request.agent(app);

    await agent.post('/test/setup-session').send({
      isAdmin: true,
      adminId: 'admin-1',
      tenantId: 'airtech',
      selectedTenantId: 'airtech'
    });

    // Aksesser med matchende tenant header
    const res = await agent
      .get('/test/protected')
      .set('x-tenant-id', 'airtech');

    expect(res.status).toBe(200);
    expect(res.body.adminTenantId).toBe('airtech');
  });

  test('admin bundet til tenant kan aksessere uten x-tenant-id header', async () => {
    const agent = request.agent(app);

    await agent.post('/test/setup-session').send({
      isAdmin: true,
      adminId: 'admin-1',
      tenantId: 'airtech',
      selectedTenantId: 'airtech'
    });

    // Ingen x-tenant-id header — bruker selectedTenantId fra session
    const res = await agent.get('/test/protected');
    expect(res.status).toBe(200);
    expect(res.body.adminTenantId).toBe('airtech');
  });

  test('super-admin (uten tenant) kan bytte til hvilken som helst tenant', async () => {
    const agent = request.agent(app);

    // Login som super-admin (ingen tenantId, men med selectedTenantId)
    await agent.post('/test/setup-session').send({
      isAdmin: true,
      adminId: 'super-1',
      selectedTenantId: 'airtech'
      // Ingen tenantId = super-admin
    });

    // Bytt til tenant-b via header
    const res = await agent
      .get('/test/protected')
      .set('x-tenant-id', 'tenant-b');

    expect(res.status).toBe(200);
    expect(res.body.adminTenantId).toBe('tenant-b');
  });

  test('super-admin kan bytte mellom flere tenants', async () => {
    const agent = request.agent(app);

    await agent.post('/test/setup-session').send({
      isAdmin: true,
      adminId: 'super-1',
      selectedTenantId: 'airtech'
    });

    // Bytt til tenant-a
    const res1 = await agent
      .get('/test/protected')
      .set('x-tenant-id', 'tenant-a');
    expect(res1.status).toBe(200);
    expect(res1.body.adminTenantId).toBe('tenant-a');

    // Bytt til tenant-b
    const res2 = await agent
      .get('/test/protected')
      .set('x-tenant-id', 'tenant-b');
    expect(res2.status).toBe(200);
    expect(res2.body.adminTenantId).toBe('tenant-b');
  });
});
