const express = require('express');
const session = require('express-session');
const request = require('supertest');

const mockPool = {
  query: jest.fn()
};

const mockGenerateOrderReport = jest.fn();

jest.mock('../src/config/database', () => ({
  getTenantConnection: jest.fn(async () => mockPool)
}));

jest.mock('../src/services/customerService', () => ({
  getCustomer: jest.fn(),
  getCustomerByExternalId: jest.fn(),
  getContacts: jest.fn()
}));

jest.mock('../src/services/unifiedPdfGenerator', () => {
  return jest.fn().mockImplementation(() => ({
    generateOrderReport: mockGenerateOrderReport
  }));
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

  app.use((req, res, next) => {
    req.session.technicianId = 'TECH-1';
    req.session.tenantId = 'test-tenant';
    req.tenantId = 'test-tenant';
    next();
  });

  app.use('/api/orders', require('../src/routes/orders'));
  return app;
}

describe('Order completion', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = createTestApp();
  });

  test('marks order completed and starts async order PDF generation', async () => {
    mockPool.query.mockImplementation(async (sql, params) => {
      if (sql === 'BEGIN') return { rows: [] };
      if (sql === 'COMMIT') return { rows: [] };
      if (sql === 'ROLLBACK') return { rows: [] };

      if (sql.includes('SELECT id FROM orders WHERE id = $1')) {
        return { rows: [{ id: params[0] }] };
      }

      if (sql.includes('UPDATE orders SET status = $1 WHERE id = $2 RETURNING id, status')) {
        return { rows: [{ id: params[1], status: 'completed' }] };
      }

      if (sql.includes('SELECT id, status FROM orders WHERE id = $1')) {
        return { rows: [{ id: params[0], status: 'completed' }] };
      }

      throw new Error(`Unexpected SQL in test: ${sql}`);
    });

    mockGenerateOrderReport.mockResolvedValueOnce('tenants/test-tenant/service-reports/2026/03/PROJ-2026-1710934200000.pdf');

    const res = await request(app)
      .post('/api/orders/PROJ-2026-1710934200000/complete')
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.orderId).toBe('PROJ-2026-1710934200000');
    expect(res.body.pdfGenerated).toBe(false);
    expect(res.body.message).toMatch(/genereres/i);

    expect(mockGenerateOrderReport).toHaveBeenCalledTimes(1);
    expect(mockGenerateOrderReport).toHaveBeenCalledWith(
      'PROJ-2026-1710934200000',
      'test-tenant',
      expect.any(Function)
    );

    expect(mockPool.query).toHaveBeenCalledWith(
      'UPDATE orders SET status = $1 WHERE id = $2 RETURNING id, status',
      ['completed', 'PROJ-2026-1710934200000']
    );
    expect(mockPool.query).toHaveBeenCalledWith('COMMIT');
    expect(mockPool.query).not.toHaveBeenCalledWith('ROLLBACK');
  });
});
