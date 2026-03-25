const express = require('express');
const session = require('express-session');
const request = require('supertest');

jest.mock('../src/config/database', () => ({
  getTenantConnection: jest.fn().mockResolvedValue({
    query: jest.fn().mockResolvedValue({ rows: [] })
  })
}));

jest.mock('../src/config/gcs', () => ({
  storage: {},
  bucketName: 'test-bucket',
  bucket: {
    file: jest.fn().mockReturnValue({
      exists: jest.fn().mockResolvedValue([false]),
      download: jest.fn().mockResolvedValue([Buffer.from('{}')]),
      save: jest.fn().mockResolvedValue(),
      delete: jest.fn().mockResolvedValue(),
      createWriteStream: jest.fn()
    })
  }
}));

function createTestApp(sessionOverrides = {}, requestOverrides = {}) {
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
    Object.assign(req, requestOverrides);
    next();
  });
  app.use('/api/images', require('../src/routes/images'));
  return app;
}

describe('Images admin auth', () => {
  test('technician cannot read settings', async () => {
    const app = createTestApp({ technicianId: 'tech-1', tenantId: 'tenant-a' });

    const res = await request(app).get('/api/images/settings');

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/kun admin/i);
  });

  test('technician cannot save settings', async () => {
    const app = createTestApp({ technicianId: 'tech-1', tenantId: 'tenant-a' });

    const res = await request(app)
      .post('/api/images/save-settings')
      .send({ companyInfo: { name: 'Test' } });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/kun admin/i);
  });

  test('technician cannot read logo settings', async () => {
    const app = createTestApp({ technicianId: 'tech-1', tenantId: 'tenant-a' });

    const res = await request(app).get('/api/images/logo');

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/kun admin/i);
  });

  test('admin can read settings', async () => {
    const app = createTestApp({ isAdmin: true, tenantId: 'tenant-a' }, { adminTenantId: 'tenant-a' });

    const res = await request(app).get('/api/images/settings');

    expect(res.status).toBe(200);
  });

  test('admin can read logo settings', async () => {
    const app = createTestApp({ isAdmin: true, tenantId: 'tenant-a' }, { adminTenantId: 'tenant-a' });

    const res = await request(app).get('/api/images/logo');

    expect(res.status).toBe(200);
  });
});
