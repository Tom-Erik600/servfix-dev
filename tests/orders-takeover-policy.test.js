const express = require('express');
const session = require('express-session');
const request = require('supertest');

const mockQuery = jest.fn();

jest.mock('../src/config/database', () => ({
  getTenantConnection: jest.fn().mockImplementation(async () => ({
    query: (...args) => mockQuery(...args)
  }))
}));

jest.mock('../src/services/customerService', () => ({
  getCustomer: jest.fn(),
  getCustomerByExternalId: jest.fn(),
  getContacts: jest.fn()
}));

function createTestApp(sessionOverrides = {}) {
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
  app.use('/api/orders', require('../src/routes/orders'));
  return app;
}

describe('Orders takeover policy A', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('technician can take over order to self when not completed', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'order-1', technician_id: 'tech-1', scheduled_date: '2026-03-24', customer_name: 'Kunde', status: 'scheduled' }]
    });

    const app = createTestApp({ technicianId: 'tech-1', tenantId: 'tenant-a' });
    const res = await request(app)
      .put('/api/orders/order-1')
      .send({ technicianId: 'tech-1' });

    expect(res.status).toBe(200);
    expect(res.body.order.technician_id).toBe('tech-1');
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("AND status != 'completed'"),
      ['tech-1', 'order-1']
    );
  });

  test('technician cannot take over order to another technician', async () => {
    const app = createTestApp({ technicianId: 'tech-1', tenantId: 'tenant-a' });
    const res = await request(app)
      .put('/api/orders/order-1')
      .send({ technicianId: 'tech-2' });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/kun overta ordre til seg selv/i);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('completed order cannot be taken over', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'order-1', status: 'completed' }] });

    const app = createTestApp({ technicianId: 'tech-1', tenantId: 'tenant-a' });
    const res = await request(app)
      .put('/api/orders/order-1')
      .send({ technicianId: 'tech-1' });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/fullførte ordre kan ikke overtas/i);
  });
});
