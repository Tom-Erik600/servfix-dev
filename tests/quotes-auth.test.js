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

jest.mock('../src/services/quotePDFGenerator', () => {
  return jest.fn().mockImplementation(() => ({
    init: jest.fn(),
    close: jest.fn(),
    generate: jest.fn(),
    fetchQuoteData: jest.fn(),
    loadCompanySettings: jest.fn(),
    generateHTML: jest.fn()
  }));
});

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

  app.use('/api/quotes', require('../src/routes/quotes'));
  return app;
}

describe('Quotes auth', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPool.query.mockResolvedValue({ rows: [] });
  });

  test('returns 401 without technician or admin session', async () => {
    const app = createTestApp({ tenantId: 'test-tenant' });

    const res = await request(app).get('/api/quotes');

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/ikke autentisert/i);
    expect(mockGetTenantConnection).not.toHaveBeenCalled();
  });

  test('returns 401 for technician session without tenant', async () => {
    const app = createTestApp({ technicianId: 'tech-1' });

    const res = await request(app).get('/api/quotes');

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/mangler tenant/i);
    expect(mockGetTenantConnection).not.toHaveBeenCalled();
  });

  test('allows technician session with tenant', async () => {
    const app = createTestApp({ technicianId: 'tech-1', tenantId: 'test-tenant' });

    const res = await request(app).get('/api/quotes');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(mockGetTenantConnection).toHaveBeenCalledWith('test-tenant');
  });

  test('allows admin session with tenant', async () => {
    const app = createTestApp({ isAdmin: true, tenantId: 'test-tenant' });

    const res = await request(app).get('/api/quotes');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(mockGetTenantConnection).toHaveBeenCalledWith('test-tenant');
  });

  test('prefers adminTenantId when provided', async () => {
    const app = createTestApp(
      { isAdmin: true, tenantId: 'wrong-tenant' },
      { adminTenantId: 'admin-tenant' }
    );

    const res = await request(app).get('/api/quotes');

    expect(res.status).toBe(200);
    expect(mockGetTenantConnection).toHaveBeenCalledWith('admin-tenant');
  });
});
