const express = require('express');
const session = require('express-session');
const request = require('supertest');

const mockQuery = jest.fn();

jest.mock('../src/config/database', () => ({
  getTenantConnection: jest.fn().mockImplementation(async () => ({
    query: (...args) => mockQuery(...args)
  }))
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

describe('Images ownership', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('technician cannot read general images for another technicians report', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'report-1', order_id: 'order-1', equipment_id: 'eq-1', technician_id: 'tech-2' }]
    });

    const app = createTestApp({ technicianId: 'tech-1', tenantId: 'tenant-a' });
    const res = await request(app).get('/api/images/general/report-1');

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/ingen tilgang/i);
  });

  test('admin can read general images regardless of technician ownership', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: 'report-1', order_id: 'order-1', equipment_id: 'eq-1', technician_id: 'tech-2' }]
      })
      .mockResolvedValueOnce({
        rows: [{ photos: ['https://storage.googleapis.com/test-bucket/tenants/tenant-a/foo.jpg'] }]
      });

    const app = createTestApp({ isAdmin: true, tenantId: 'tenant-a' }, { adminTenantId: 'tenant-a' });
    const res = await request(app).get('/api/images/general/report-1');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  test('technician cannot upload general image to another technicians report', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'report-1', order_id: 'order-1', equipment_id: 'eq-1', technician_id: 'tech-2' }]
    });

    const app = createTestApp({ technicianId: 'tech-1', tenantId: 'tenant-a' });
    const res = await request(app)
      .post('/api/images/general')
      .field('reportId', 'report-1')
      .field('orderId', 'order-1')
      .field('equipmentId', 'eq-1')
      .attach('image', Buffer.from('fake-image'), 'test.jpg');

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/ingen tilgang/i);
  });
});
