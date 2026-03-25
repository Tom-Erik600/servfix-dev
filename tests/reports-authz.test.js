const express = require('express');
const session = require('express-session');
const request = require('supertest');

const mockQuery = jest.fn();

jest.mock('../src/config/database', () => ({
  getTenantConnection: jest.fn().mockImplementation(async () => ({
    query: (...args) => mockQuery(...args)
  }))
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
  app.use('/api/reports', require('../src/routes/reports'));
  return app;
}

describe('Reports authz', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('technician cannot read another technicians report by report id', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'rep-1', order_id: 'ord-1', order_technician_id: 'tech-2', status: 'draft' }]
    });

    const app = createTestApp({ technicianId: 'tech-1', tenantId: 'tenant-a' });
    const res = await request(app).get('/api/reports/report/rep-1');

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/ingen tilgang/i);
  });

  test('technician cannot update another technicians report', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'rep-1', order_id: 'ord-1', order_technician_id: 'tech-2', status: 'draft', photos: [] }]
    });

    const app = createTestApp({ technicianId: 'tech-1', tenantId: 'tenant-a' });
    const res = await request(app)
      .put('/api/reports/rep-1')
      .send({ reportData: { checklist: {} }, orderId: 'ord-1', equipmentId: '1' });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/ingen tilgang/i);
  });

  test('admin can read report across technician ownership', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'rep-1',
        order_id: 'ord-1',
        equipment_id: '1',
        order_technician_id: 'tech-2',
        status: 'draft',
        checklist_data: {},
        products_used: [],
        additional_work: [],
        photos: []
      }]
    });

    const app = createTestApp({ technicianId: 'admin-tech-context', isAdmin: true, tenantId: 'tenant-a' }, { adminTenantId: 'tenant-a' });
    const res = await request(app).get('/api/reports/report/rep-1');

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('rep-1');
  });

  test('technician can still read reports for own taken-over order', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'ord-1', technician_id: 'tech-1', status: 'in_progress' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'rep-1', order_id: 'ord-1', equipment_id: '1', checklist_data: {}, products_used: [], additional_work: [], photos: [], status: 'draft' }] });

    const app = createTestApp({ technicianId: 'tech-1', tenantId: 'tenant-a' });
    const res = await request(app).get('/api/reports/ord-1');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
