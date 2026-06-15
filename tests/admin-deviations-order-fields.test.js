'use strict';

// Task 2 (T2): DEVIATION_SELECT extended with 4 new fields from orders/technicians
// chain (customerName, orderDescription, tripletexOrderId, performedByName).
//
// Verifies:
//  1. SQL contains the new JOINs (service_reports sr, orders o, technicians perf_t).
//  2. SQL contains the new SELECT aliases.
//  3. Route returns the new fields under .items[N] (NOT .data).
//  4. NULL permutations propagate correctly (route does NOT coerce).
//  5. Regression: existing fields (equipmentId, status, severity) still present.

// --- Mocks (mirror admin-deviations.test.js pattern exactly) ---
jest.mock('@google-cloud/storage', () => ({
  Storage: jest.fn().mockImplementation(() => ({
    bucket: jest.fn().mockReturnValue({
      file: jest.fn().mockReturnValue({ download: jest.fn().mockResolvedValue(['{}']) })
    })
  }))
}));

const mockPool = { query: jest.fn() };
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

const express = require('express');
const request = require('supertest');
const deviationsRouter = require('../src/routes/admin/deviations');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/deviations', deviationsRouter);
  return app;
}

function setQueryResponses(responses) {
  mockPool.query.mockReset();
  responses.forEach(r => mockPool.query.mockResolvedValueOnce(r));
}

// 5 deviations covering NULL permutations from the spec.
// Shape mirrors what Postgres would return after the new JOINs resolve.
const SEEDED_ROWS = [
  // A: Full chain - everything populated
  {
    id: 101,
    equipmentId: 5,
    equipmentName: 'Pumpe A',
    status: 'open',
    severity: 'høy',
    customerName: 'Acme AS',
    orderDescription: 'Årlig service',
    tripletexOrderId: 'TT-9001',
    performedByName: 'Ola Nordmann'
  },
  // B: opened_in_report_id IS NULL → all 4 new fields NULL
  {
    id: 102,
    equipmentId: 6,
    equipmentName: 'Pumpe B',
    status: 'assigned',
    severity: 'medium',
    customerName: null,
    orderDescription: null,
    tripletexOrderId: null,
    performedByName: null
  },
  // C: Report exists but order.technician_id IS NULL → performedByName null, customer populated
  {
    id: 103,
    equipmentId: 7,
    equipmentName: 'Pumpe C',
    status: 'open',
    severity: 'lav',
    customerName: 'Beta Bygg',
    orderDescription: 'Reparasjon',
    tripletexOrderId: 'TT-9002',
    performedByName: null
  },
  // D: Order has no description but has tripletexOrderId
  {
    id: 104,
    equipmentId: 8,
    equipmentName: 'Pumpe D',
    status: 'in_progress',
    severity: 'medium',
    customerName: 'Gamma Drift',
    orderDescription: null,
    tripletexOrderId: 'TT-9003',
    performedByName: 'Kari Hansen'
  },
  // E: Order has neither description nor tripletexOrderId
  {
    id: 105,
    equipmentId: 9,
    equipmentName: 'Pumpe E',
    status: 'open',
    severity: 'lav',
    customerName: 'Delta Marin',
    orderDescription: null,
    tripletexOrderId: null,
    performedByName: 'Per Persen'
  }
];

describe('DEVIATION_SELECT — order/technician fields (Task 2)', () => {
  describe('SQL composition', () => {
    test('GET /api/admin/deviations: list SQL includes new JOINs and aliases', async () => {
      setQueryResponses([{ rows: [{ total: 0 }] }, { rows: [] }]);
      await request(makeApp()).get('/api/admin/deviations');

      const [listSql] = mockPool.query.mock.calls[1];
      // New JOINs
      expect(listSql).toContain('LEFT JOIN service_reports sr ON sr.id = d.opened_in_report_id');
      expect(listSql).toContain('LEFT JOIN orders o ON o.id = sr.order_id');
      expect(listSql).toContain('LEFT JOIN technicians perf_t ON perf_t.id = o.technician_id');
      // New SELECT aliases
      expect(listSql).toContain('"customerName"');
      expect(listSql).toContain('"orderDescription"');
      expect(listSql).toContain('"tripletexOrderId"');
      expect(listSql).toContain('"performedByName"');
      // Existing JOINs preserved
      expect(listSql).toContain('LEFT JOIN equipment e ON e.id = d.equipment_id');
      expect(listSql).toContain('LEFT JOIN technicians t ON t.id = d.assigned_to_user_id');
    });

    test('GET /api/admin/deviations/:id: detail SQL includes new JOINs and aliases', async () => {
      setQueryResponses([
        { rows: [{ id: 1, customerName: 'Acme', orderDescription: 'X', tripletexOrderId: 'TT-1', performedByName: 'Ola' }] },
        { rows: [] },
        { rows: [] }
      ]);
      await request(makeApp()).get('/api/admin/deviations/1');

      const [headSql] = mockPool.query.mock.calls[0];
      expect(headSql).toContain('LEFT JOIN service_reports sr ON sr.id = d.opened_in_report_id');
      expect(headSql).toContain('LEFT JOIN orders o ON o.id = sr.order_id');
      expect(headSql).toContain('LEFT JOIN technicians perf_t ON perf_t.id = o.technician_id');
      expect(headSql).toContain('"customerName"');
      expect(headSql).toContain('"performedByName"');
    });

    test('GET /api/admin/deviations/export: export SQL includes new JOINs', async () => {
      setQueryResponses([
        { rows: [{ total: 1 }] },
        { rows: SEEDED_ROWS.slice(0, 1) }
      ]);
      const res = await request(makeApp())
        .get('/api/admin/deviations/export?format=csv');
      expect(res.status).toBe(200);

      const [exportSql] = mockPool.query.mock.calls[1];
      expect(exportSql).toContain('LEFT JOIN service_reports sr ON sr.id = d.opened_in_report_id');
      expect(exportSql).toContain('LEFT JOIN orders o ON o.id = sr.order_id');
      expect(exportSql).toContain('LEFT JOIN technicians perf_t ON perf_t.id = o.technician_id');
    });

    test('PUT /api/admin/deviations/:id: reload SQL includes new JOINs', async () => {
      setQueryResponses([
        { rows: [{ id: 1 }] },          // exists
        { rows: [{ id: 1 }] },          // UPDATE
        { rows: [{ id: 1, customerName: 'Acme', performedByName: 'Ola' }] }  // reload
      ]);
      const res = await request(makeApp())
        .put('/api/admin/deviations/1')
        .send({ assignedToUserId: 'tech-1' });
      expect(res.status).toBe(200);

      const [reloadSql] = mockPool.query.mock.calls[2];
      expect(reloadSql).toContain('LEFT JOIN service_reports sr ON sr.id = d.opened_in_report_id');
      expect(reloadSql).toContain('LEFT JOIN orders o ON o.id = sr.order_id');
      expect(reloadSql).toContain('LEFT JOIN technicians perf_t ON perf_t.id = o.technician_id');
    });

    test('worklist endpoint untouched (no perf_t join — it has its own SELECT)', async () => {
      // Worklist returns its own SELECT shape; we only assert it does NOT use perf_t alias.
      // This is a regression guard against accidental editing of the worklist block.
      const deviationsSource = require('fs').readFileSync(
        require('path').join(__dirname, '..', 'src', 'routes', 'admin', 'deviations.js'),
        'utf8'
      );
      const worklistBlock = deviationsSource.match(/router\.get\('\/worklist'[\s\S]*?\n\}\);/);
      expect(worklistBlock).not.toBeNull();
      expect(worklistBlock[0]).not.toContain('perf_t');
    });
  });

  describe('Response shape — items[N] contains new fields', () => {
    test('row A (full chain): all 4 fields populated and match seeded values', async () => {
      setQueryResponses([
        { rows: [{ total: SEEDED_ROWS.length }] },
        { rows: SEEDED_ROWS }
      ]);
      const res = await request(makeApp()).get('/api/admin/deviations');
      expect(res.status).toBe(200);

      const items = res.body.items;
      expect(Array.isArray(items)).toBe(true);

      // Row A is index 0
      expect(items[0]).toEqual(expect.objectContaining({
        customerName: 'Acme AS',
        orderDescription: 'Årlig service',
        tripletexOrderId: 'TT-9001',
        performedByName: 'Ola Nordmann'
      }));

      // Key presence requirement from spec
      expect(items[0]).toHaveProperty('customerName');
      expect(items[0]).toHaveProperty('orderDescription');
      expect(items[0]).toHaveProperty('tripletexOrderId');
      expect(items[0]).toHaveProperty('performedByName');
    });

    test('row B (opened_in_report_id NULL): all 4 fields are null', async () => {
      setQueryResponses([
        { rows: [{ total: SEEDED_ROWS.length }] },
        { rows: SEEDED_ROWS }
      ]);
      const res = await request(makeApp()).get('/api/admin/deviations');
      const b = res.body.items[1];
      expect(b.customerName).toBeNull();
      expect(b.orderDescription).toBeNull();
      expect(b.tripletexOrderId).toBeNull();
      expect(b.performedByName).toBeNull();
    });

    test('row C (order.technician_id NULL): performedByName null, customerName populated', async () => {
      setQueryResponses([
        { rows: [{ total: SEEDED_ROWS.length }] },
        { rows: SEEDED_ROWS }
      ]);
      const res = await request(makeApp()).get('/api/admin/deviations');
      const c = res.body.items[2];
      expect(c.performedByName).toBeNull();
      expect(c.customerName).toBe('Beta Bygg');
      expect(c.orderDescription).toBe('Reparasjon');
      expect(c.tripletexOrderId).toBe('TT-9002');
    });

    test('row D (no description, has tripletexOrderId): orderDescription null, tripletexOrderId populated', async () => {
      setQueryResponses([
        { rows: [{ total: SEEDED_ROWS.length }] },
        { rows: SEEDED_ROWS }
      ]);
      const res = await request(makeApp()).get('/api/admin/deviations');
      const d = res.body.items[3];
      expect(d.orderDescription).toBeNull();
      expect(d.tripletexOrderId).toBe('TT-9003');
      expect(d.customerName).toBe('Gamma Drift');
      expect(d.performedByName).toBe('Kari Hansen');
    });

    test('row E (no description, no tripletexOrderId): both null', async () => {
      setQueryResponses([
        { rows: [{ total: SEEDED_ROWS.length }] },
        { rows: SEEDED_ROWS }
      ]);
      const res = await request(makeApp()).get('/api/admin/deviations');
      const e = res.body.items[4];
      expect(e.orderDescription).toBeNull();
      expect(e.tripletexOrderId).toBeNull();
      expect(e.customerName).toBe('Delta Marin');
      expect(e.performedByName).toBe('Per Persen');
    });
  });

  describe('Regression — existing fields still present (superset)', () => {
    test('items[0] retains equipmentId, status, severity', async () => {
      setQueryResponses([
        { rows: [{ total: SEEDED_ROWS.length }] },
        { rows: SEEDED_ROWS }
      ]);
      const res = await request(makeApp()).get('/api/admin/deviations');
      const item = res.body.items[0];
      expect(item).toHaveProperty('equipmentId', 5);
      expect(item).toHaveProperty('status', 'open');
      expect(item).toHaveProperty('severity', 'høy');
    });

    test('response envelope still has total/limit/offset/items (NOT .data)', async () => {
      setQueryResponses([
        { rows: [{ total: SEEDED_ROWS.length }] },
        { rows: SEEDED_ROWS }
      ]);
      const res = await request(makeApp()).get('/api/admin/deviations');
      expect(res.body).toHaveProperty('items');
      expect(res.body).toHaveProperty('total');
      expect(res.body).toHaveProperty('limit');
      expect(res.body).toHaveProperty('offset');
      expect(res.body).not.toHaveProperty('data');
    });
  });
});
