const express = require('express');
const session = require('express-session');
const request = require('supertest');

const mockPool = {
  query: jest.fn()
};

const mockGenerateReport = jest.fn();

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
    generateReport: mockGenerateReport
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

  test('marks order completed when one PDF generation fails and still returns other generated PDFs', async () => {
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

      if (sql.includes('FROM service_reports sr') && sql.includes('JOIN equipment e')) {
        return {
          rows: [
            {
              id: 'SR-1',
              order_id: params[0],
              equipment_id: 101,
              equipment_name: 'Ventilasjon A',
              equipment_type: 'boligventilasjon'
            },
            {
              id: 'SR-2',
              order_id: params[0],
              equipment_id: 102,
              equipment_name: 'Ventilasjon B',
              equipment_type: 'boligventilasjon'
            }
          ]
        };
      }

      if (sql.includes('SELECT id, status FROM orders WHERE id = $1')) {
        return { rows: [{ id: params[0], status: 'completed' }] };
      }

      throw new Error(`Unexpected SQL in test: ${sql}`);
    });

    mockGenerateReport
      .mockRejectedValueOnce(new Error('Puppeteer crashed'))
      .mockResolvedValueOnce('tenants/test-tenant/service-reports/2026/03/SR-2.pdf');

    const res = await request(app)
      .post('/api/orders/PROJ-2026-1710934200000/complete')
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.orderId).toBe('PROJ-2026-1710934200000');
    expect(res.body.generatedPDFs).toEqual([
      {
        reportId: 'SR-2',
        equipmentType: 'boligventilasjon',
        equipmentName: 'Ventilasjon B',
        pdfPath: 'tenants/test-tenant/service-reports/2026/03/SR-2.pdf'
      }
    ]);

    expect(mockGenerateReport).toHaveBeenCalledTimes(2);
    expect(mockGenerateReport).toHaveBeenNthCalledWith(1, 'SR-1', 'test-tenant');
    expect(mockGenerateReport).toHaveBeenNthCalledWith(2, 'SR-2', 'test-tenant');

    expect(mockPool.query).toHaveBeenCalledWith(
      'UPDATE orders SET status = $1 WHERE id = $2 RETURNING id, status',
      ['completed', 'PROJ-2026-1710934200000']
    );
    expect(mockPool.query).toHaveBeenCalledWith('COMMIT');
    expect(mockPool.query).not.toHaveBeenCalledWith('ROLLBACK');
  });
});
