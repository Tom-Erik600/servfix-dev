/**
 * Regression tests for tenant guards on technician-facing routes.
 *
 * These tests verify that routes return 401 when the session is present
 * but tenantId is missing, and that no DB call is attempted.
 */

const express = require('express');
const session = require('express-session');
const request = require('supertest');

const mockPool = {
  query: jest.fn()
};

const mockGetTenantConnection = jest.fn(async () => mockPool);

jest.mock('../src/config/database', () => ({
  getTenantConnection: (...args) => mockGetTenantConnection(...args)
}));

jest.mock('../src/config/gcs', () => ({
  storage: {},
  bucketName: 'test-bucket',
  bucket: {
    file: jest.fn().mockReturnValue({
      createWriteStream: jest.fn(),
      exists: jest.fn().mockResolvedValue([false]),
      download: jest.fn().mockResolvedValue([Buffer.from('{}')]),
      save: jest.fn().mockResolvedValue(),
      delete: jest.fn().mockResolvedValue(),
      makePublic: jest.fn().mockResolvedValue()
    })
  }
}));

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
    next();
  });
  app.use(mountPath, router);
  return app;
}

describe('Tenant route guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('orders returns 401 when technician session exists but tenant is missing', async () => {
    const router = require('../src/routes/orders');
    const app = createTestApp(router, '/api/orders', { technicianId: 'tech-1' });

    const res = await request(app).get('/api/orders');

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/mangler tenant/i);
    expect(mockGetTenantConnection).not.toHaveBeenCalled();
  });

  test('equipment returns 401 when technician session exists but tenant is missing', async () => {
    const router = require('../src/routes/equipment');
    const app = createTestApp(router, '/api/equipment', { technicianId: 'tech-1' });

    const res = await request(app).get('/api/equipment/123');

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/mangler tenant/i);
    expect(mockGetTenantConnection).not.toHaveBeenCalled();
  });

  test('dashboard-v2 returns 401 when technician session exists but tenant is missing', async () => {
    const router = require('../src/routes/dashboard-v2');
    const app = createTestApp(router, '/api/dashboard-v2', { technicianId: 'tech-1' });

    const res = await request(app).get('/api/dashboard-v2');

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/mangler tenant/i);
    expect(mockGetTenantConnection).not.toHaveBeenCalled();
  });

  test('hms returns 401 when technician session exists but tenant is missing', async () => {
    const router = require('../src/routes/hms');
    const app = createTestApp(router, '/api/hms', { technicianId: 'tech-1' });

    const res = await request(app).get('/api/hms/sja');

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/mangler tenant/i);
    expect(mockGetTenantConnection).not.toHaveBeenCalled();
  });

  test('images general endpoint returns 401 when technician session exists but tenant is missing', async () => {
    const router = require('../src/routes/images');
    const app = createTestApp(router, '/api/images', { technicianId: 'tech-1' });

    const res = await request(app).get('/api/images/general/report-1');

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/mangler tenant/i);
    expect(mockGetTenantConnection).not.toHaveBeenCalled();
  });

  test('clusters returns 401 when technician session exists but tenant is missing', async () => {
    const router = require('../src/routes/clusters');
    const app = createTestApp(router, '/api/clusters', { technicianId: 'tech-1' });

    const res = await request(app).get('/api/clusters?customerId=123');

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/mangler tenant/i);
    expect(mockGetTenantConnection).not.toHaveBeenCalled();
  });
});
