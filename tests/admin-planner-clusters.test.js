const express = require('express');
const session = require('express-session');
const request = require('supertest');

const mockPool = {
  query: jest.fn()
};

const mockTripletexClient = {
  get: jest.fn()
};

jest.mock('../src/config/database', () => ({
  getTenantConnection: jest.fn(async () => mockPool)
}));

jest.mock('../src/services/tripletexService', () => ({
  getApiClient: jest.fn(async () => mockTripletexClient)
}));

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
    req.session.isAdmin = true;
    req.session.adminId = 1;
    req.session.tenantId = 'test-tenant';
    req.session.selectedTenantId = 'test-tenant';
    next();
  });

  app.use('/api/admin/clusters', require('../src/routes/admin/clusters'));
  app.use('/api/admin/equipment', require('../src/routes/admin/equipment'));
  app.use('/api/admin/projects', require('../src/routes/admin/projects'));
  return app;
}

describe('Admin planner cluster and project routes', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = createTestApp();
  });

  test('lists clusters with equipment counts for a customer', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{
        id: 7,
        customer_id: 12,
        name: 'Industriveien 92',
        notes: null,
        tripletex_project_id: null,
        tripletex_project_name: null,
        created_at: '2026-03-26T10:00:00.000Z',
        equipment_count: '3'
      }]
    });

    const res = await request(app).get('/api/admin/clusters?customerId=12');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ 
      id: 7,
      customerId: 12,
      name: 'Industriveien 92',
      notes: null,
      tripletexProjectId: null,
      tripletexProjectName: null,
      equipmentCount: 3,
      createdAt: '2026-03-26T10:00:00.000Z'
    }]);
  });

  test('returns 409 when creating duplicate cluster name for same customer', async () => {
    const duplicateError = new Error('duplicate');
    duplicateError.code = '23505';
    mockPool.query.mockRejectedValueOnce(duplicateError);

    const res = await request(app)
      .post('/api/admin/clusters')
      .send({ customerId: 12, name: 'Industriveien 92' });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/finnes allerede/);
  });

  test('assigns selected equipment to a cluster in batch', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        { id: 101, cluster_id: 7 },
        { id: 102, cluster_id: 7 }
      ]
    });

    const res = await request(app)
      .post('/api/admin/equipment/assign-cluster')
      .send({ equipmentIds: ['101', '102'], clusterId: 7 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      updatedCount: 2,
      clusterId: 7,
      equipmentIds: [101, 102]
    });
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE equipment'),
      [[101, 102], 7]
    );
  });

  test('removes cluster from a single equipment item when clusterId is null', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: 101, cluster_id: null }]
    });

    const res = await request(app)
      .post('/api/admin/equipment/assign-cluster')
      .send({ equipmentIds: [101], clusterId: null });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      updatedCount: 1,
      clusterId: null,
      equipmentIds: [101]
    });
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE equipment'),
      [[101], null]
    );
  });

  test('deduplicates Tripletex project search results from name and number queries', async () => {
    mockTripletexClient.get
      .mockResolvedValueOnce({
        data: {
          values: [
            {
              id: 1,
              name: 'Industriveien 92 2026',
              number: '2639',
              displayName: '2639 Industriveien 92 2026',
              isClosed: false,
              customer: { id: 88762602, name: 'Demo Kontorbygg AS' }
            }
          ]
        }
      })
      .mockResolvedValueOnce({
        data: {
          values: [
            {
              id: 1,
              name: 'Industriveien 92 2026',
              number: '2639',
              displayName: '2639 Industriveien 92 2026',
              isClosed: false,
              customer: { id: 88762602, name: 'Demo Kontorbygg AS' }
            },
            {
              id: 2,
              name: 'Skolebygget 2026',
              number: '2640',
              displayName: '2640 Skolebygget 2026',
              isClosed: true,
              customer: { id: 88762608, name: 'Demo Borettslag' }
            }
          ]
        }
      });

    const res = await request(app).get('/api/admin/projects/search?q=2639');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        id: 1,
        name: 'Industriveien 92 2026',
        number: '2639',
        displayName: '2639 Industriveien 92 2026',
        startDate: null,
        endDate: null,
        isClosed: false,
        customer: { id: 88762602, name: 'Demo Kontorbygg AS' }
      },
      {
        id: 2,
        name: 'Skolebygget 2026',
        number: '2640',
        displayName: '2640 Skolebygget 2026',
        startDate: null,
        endDate: null,
        isClosed: true,
        customer: { id: 88762608, name: 'Demo Borettslag' }
      }
    ]);
    expect(mockTripletexClient.get).toHaveBeenCalledTimes(2);
  });
});
