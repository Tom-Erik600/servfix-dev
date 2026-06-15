'use strict';

// --- Mocks ---
jest.mock('@google-cloud/storage', () => ({
  Storage: jest.fn().mockImplementation(() => ({
    bucket: jest.fn().mockReturnValue({
      file: jest.fn().mockReturnValue({ download: jest.fn().mockResolvedValue(['{}']) })
    })
  }))
}));

const mockClient = { query: jest.fn(), release: jest.fn() };
const mockPool = { query: jest.fn(), connect: jest.fn(async () => mockClient) };
jest.mock('../src/config/database', () => ({
  getTenantConnection: jest.fn(async () => mockPool),
  getPool: jest.fn(async () => mockPool),
  closeAll: jest.fn()
}));

jest.mock('../src/middleware/admin-tenant', () => (req, res, next) => {
  req.session = req.session || {};
  req.session.isAdmin = true;
  req.session.tenantId = 'airtechdev';
  req.adminTenantId = 'airtechdev';
  next();
});

jest.mock('../src/services/moduleFlags', () => ({
  loadModuleFlags: jest.fn(async () => ({ enable_deviations_management: true }))
}));

const express = require('express');
const request = require('supertest');
const deviationsRouter = require('../src/routes/admin/deviations');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/deviations', deviationsRouter);
  return app;
}

// Row factories — mimic columns the worklist SQL returns
function makeRow(overrides = {}) {
  return {
    id: 1,
    equipmentId: 10,
    equipmentName: 'Pool X',
    label: 'Check filter',
    summary: 'Needs replacement',
    outcome: 'wants_quote',
    severity: 'medium',
    status: 'open',
    orderId: 100,
    reportId: 200,
    customerName: 'Acme AS',
    orderDescription: 'Annual service',
    visitAddress: 'Storgata 1',
    contactName: 'Jane Doe',
    contactPhone: '99999999',
    contactEmail: 'jane@example.com',
    quoteId: null,
    imageCount: 0,
    orderHasProducts: false,
    ...overrides
  };
}

// The worklist handler issues a single pool.query call (no count query).
function setWorklistResponse(rows) {
  mockPool.query.mockReset();
  mockPool.query.mockResolvedValueOnce({ rows });
}

// ---------------------------------------------------------------------------
// Tests for sent_to_customer filter on GET /api/admin/deviations/worklist
// ---------------------------------------------------------------------------

describe('GET /api/admin/deviations/worklist — sent_to_customer filter', () => {

  // 1. Default (no param): row with sent_to_customer=true should NOT appear
  test('default (no includeSent param): deviation linked to a sent quote does not appear', async () => {
    // The SQL filter `AND (q.sent_to_customer IS NOT TRUE)` is applied at DB level.
    // We simulate the DB already honouring that filter — the row is absent from results.
    setWorklistResponse([]);

    const res = await request(makeApp()).get('/api/admin/deviations/worklist');

    expect(res.status).toBe(200);
    // No item with a sent quote should be present
    const sentItems = (res.body.orders || [])
      .flatMap(o => o.deviations || [])
      .filter(d => d.quoteId !== null);
    expect(sentItems).toHaveLength(0);

    // Confirm the SQL passed to pool.query does NOT contain the includeSent bypass
    const sqlUsed = mockPool.query.mock.calls[0][0];
    expect(sqlUsed).toMatch(/q\.sent_to_customer IS NOT TRUE/);
  });

  // 2. Default (no param): deviation with quote_id=null DOES appear
  test('default (no includeSent param): deviation with null quote_id appears in response', async () => {
    const row = makeRow({ id: 2, quoteId: null, outcome: 'wants_quote' });
    setWorklistResponse([row]);

    const res = await request(makeApp()).get('/api/admin/deviations/worklist');

    expect(res.status).toBe(200);
    const allDeviations = (res.body.orders || []).flatMap(o => o.deviations || []);
    expect(allDeviations.some(d => d.id === 2)).toBe(true);
  });

  // 3. Default (no param): deviation with sent_to_customer=false DOES appear
  test('default (no includeSent param): deviation linked to unsent quote appears in response', async () => {
    // DB returns this row because sent_to_customer IS NOT TRUE passes for false/null
    const row = makeRow({ id: 3, quoteId: 77, outcome: 'wants_quote' });
    setWorklistResponse([row]);

    const res = await request(makeApp()).get('/api/admin/deviations/worklist');

    expect(res.status).toBe(200);
    const allDeviations = (res.body.orders || []).flatMap(o => o.deviations || []);
    expect(allDeviations.some(d => d.id === 3)).toBe(true);
  });

  // 4. includeSent=true: deviation linked to sent quote DOES appear
  test('includeSent=true: deviation linked to sent quote appears in response', async () => {
    const row = makeRow({ id: 4, quoteId: 88, outcome: 'wants_quote' });
    setWorklistResponse([row]);

    const res = await request(makeApp()).get('/api/admin/deviations/worklist?includeSent=true');

    expect(res.status).toBe(200);
    const allDeviations = (res.body.orders || []).flatMap(o => o.deviations || []);
    expect(allDeviations.some(d => d.id === 4)).toBe(true);

    // Confirm the SQL does NOT contain the sent_to_customer filter
    const sqlUsed = mockPool.query.mock.calls[0][0];
    expect(sqlUsed).not.toMatch(/q\.sent_to_customer IS NOT TRUE/);
  });

  // 5. includeSent=other (not 'true'): filter is active — same as default
  test('includeSent=other: filter is active (sent_to_customer IS NOT TRUE applied)', async () => {
    setWorklistResponse([]);

    const res = await request(makeApp()).get('/api/admin/deviations/worklist?includeSent=other');

    expect(res.status).toBe(200);
    const sqlUsed = mockPool.query.mock.calls[0][0];
    expect(sqlUsed).toMatch(/q\.sent_to_customer IS NOT TRUE/);
  });

});
