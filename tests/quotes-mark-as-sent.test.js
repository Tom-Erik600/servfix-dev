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

describe('POST /api/quotes/:quoteId/mark-as-sent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns 200 with success response for existing quote', async () => {
    const sentDate = new Date('2026-06-14T10:00:00.000Z');
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) // SELECT 1 existence check
      .mockResolvedValueOnce({ rows: [{ sent_date: sentDate }] }); // UPDATE RETURNING

    const app = createTestApp({ isAdmin: true, tenantId: 'test-tenant' });

    const res = await request(app).post('/api/quotes/42/mark-as-sent');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.quoteId).toBe('42');
    expect(res.body.status).toBe('sent');
    expect(res.body.sent_to_customer).toBe(true);
    expect(res.body.sent_date).toBeDefined();
  });

  test('returns 404 when quoteId does not exist', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] }); // SELECT 1 returns no rows

    const app = createTestApp({ isAdmin: true, tenantId: 'test-tenant' });

    const res = await request(app).post('/api/quotes/999/mark-as-sent');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Tilbud ikke funnet');
  });

  test('returns 401 without auth session', async () => {
    const app = createTestApp({ tenantId: 'test-tenant' }); // no isAdmin, no technicianId

    const res = await request(app).post('/api/quotes/42/mark-as-sent');

    expect(res.status).toBe(401);
    expect(mockGetTenantConnection).not.toHaveBeenCalled();
  });

  test('is idempotent — repeated calls both return 200 with updated sent_date', async () => {
    const firstDate = new Date('2026-06-14T10:00:00.000Z');
    const secondDate = new Date('2026-06-14T11:00:00.000Z');

    mockPool.query
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })   // 1st call: existence check
      .mockResolvedValueOnce({ rows: [{ sent_date: firstDate }] }) // 1st call: UPDATE
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })   // 2nd call: existence check
      .mockResolvedValueOnce({ rows: [{ sent_date: secondDate }] }); // 2nd call: UPDATE

    const app = createTestApp({ isAdmin: true, tenantId: 'test-tenant' });

    const res1 = await request(app).post('/api/quotes/42/mark-as-sent');
    const res2 = await request(app).post('/api/quotes/42/mark-as-sent');

    expect(res1.status).toBe(200);
    expect(res1.body.success).toBe(true);

    expect(res2.status).toBe(200);
    expect(res2.body.success).toBe(true);

    expect(res1.body.sent_date).not.toBe(res2.body.sent_date);
  });
});
