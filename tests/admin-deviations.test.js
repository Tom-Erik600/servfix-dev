'use strict';

// --- Mocks ---
jest.mock('@google-cloud/storage', () => ({
  Storage: jest.fn().mockImplementation(() => ({
    bucket: jest.fn().mockReturnValue({
      file: jest.fn().mockReturnValue({ download: jest.fn().mockResolvedValue(['{}']) })
    })
  }))
}));

// Mock database.getTenantConnection per test
const mockPool = { query: jest.fn() };
jest.mock('../src/config/database', () => ({
  getTenantConnection: jest.fn(async () => mockPool),
  getPool: jest.fn(async () => mockPool),
  closeAll: jest.fn()
}));

// Mock admin-tenant middleware - sett req.adminTenantId direkte
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
  // responses: array av { rows: [...] } i samme rekkefølge som pool.query kalles
  mockPool.query.mockReset();
  responses.forEach(r => mockPool.query.mockResolvedValueOnce(r));
}

// ---------------------------------------------------------------------------
// Test-grupper
// ---------------------------------------------------------------------------

describe('GET /api/admin/deviations', () => {
  test('returnerer liste med default-filtre', async () => {
    setQueryResponses([
      { rows: [{ total: 2 }] },
      { rows: [
        { id: 1, equipmentId: 5, equipmentName: 'Pool A', status: 'open' },
        { id: 2, equipmentId: 6, equipmentName: 'Pool B', status: 'assigned' }
      ]}
    ]);

    const res = await request(makeApp()).get('/api/admin/deviations');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 2, limit: 50, offset: 0 });
    expect(res.body.items).toHaveLength(2);
  });

  test('filtrerer på status (komma-separert)', async () => {
    setQueryResponses([{ rows: [{ total: 0 }] }, { rows: [] }]);
    const res = await request(makeApp()).get('/api/admin/deviations?status=open,assigned');
    expect(res.status).toBe(200);
    expect(mockPool.query).toHaveBeenCalledTimes(2);
    const [, countParams] = mockPool.query.mock.calls[0];
    expect(countParams).toEqual(['open', 'assigned']);
  });

  test('avviser ugyldig status (400)', async () => {
    const res = await request(makeApp()).get('/api/admin/deviations?status=invalid');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Ugyldig status/);
  });

  test('filtrerer på severity', async () => {
    setQueryResponses([{ rows: [{ total: 0 }] }, { rows: [] }]);
    const res = await request(makeApp()).get('/api/admin/deviations?severity=høy,medium');
    expect(res.status).toBe(200);
  });

  test('avviser ugyldig severity (400)', async () => {
    const res = await request(makeApp()).get('/api/admin/deviations?severity=critical');
    expect(res.status).toBe(400);
  });

  test('filtrerer på equipmentId', async () => {
    setQueryResponses([{ rows: [{ total: 0 }] }, { rows: [] }]);
    const res = await request(makeApp()).get('/api/admin/deviations?equipmentId=42');
    expect(res.status).toBe(200);
  });

  test('avviser ikke-numerisk equipmentId (400)', async () => {
    const res = await request(makeApp()).get('/api/admin/deviations?equipmentId=abc');
    expect(res.status).toBe(400);
  });

  test('respekterer limit og offset', async () => {
    setQueryResponses([{ rows: [{ total: 100 }] }, { rows: [] }]);
    const res = await request(makeApp()).get('/api/admin/deviations?limit=20&offset=40');
    expect(res.body).toMatchObject({ total: 100, limit: 20, offset: 40 });
  });

  test('clamper limit til max 200', async () => {
    setQueryResponses([{ rows: [{ total: 0 }] }, { rows: [] }]);
    const res = await request(makeApp()).get('/api/admin/deviations?limit=500');
    expect(res.body.limit).toBe(200);
  });

  test('sorterer etter severity DESC, opened_at ASC som default', async () => {
    setQueryResponses([{ rows: [{ total: 0 }] }, { rows: [] }]);
    await request(makeApp()).get('/api/admin/deviations');
    const [listSql] = mockPool.query.mock.calls[1];
    expect(listSql).toContain('CASE d.current_severity');
    expect(listSql).toContain("WHEN 'høy' THEN 1");
  });
});

describe('GET /api/admin/deviations/:id', () => {
  test('returnerer enkelt-deviation med observasjoner og bilder', async () => {
    setQueryResponses([
      { rows: [{ id: 1, status: 'open', equipmentName: 'Pool A' }] },
      { rows: [{ id: 10, comment: 'Lekkasje' }] },
      { rows: [{ id: 'img1', url: 'https://...' }] }
    ]);
    const res = await request(makeApp()).get('/api/admin/deviations/1');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('observations');
    expect(res.body).toHaveProperty('images');
    expect(res.body.observations).toHaveLength(1);
    expect(res.body.images).toHaveLength(1);
  });

  test('returnerer 404 hvis ID ikke finnes', async () => {
    setQueryResponses([{ rows: [] }]);
    const res = await request(makeApp()).get('/api/admin/deviations/9999');
    expect(res.status).toBe(404);
  });

  test('avviser ikke-numerisk ID (400)', async () => {
    const res = await request(makeApp()).get('/api/admin/deviations/abc');
    expect(res.status).toBe(400);
  });
});

describe('PUT /api/admin/deviations/:id', () => {
  test('oppdaterer assignedToUserId', async () => {
    setQueryResponses([
      { rows: [{ id: 1 }] },          // exists check
      { rows: [{ id: 1 }] },          // UPDATE
      { rows: [{ id: 1, assignedToUserId: 'tech-1', assignedToName: 'Kari' }] }  // reload
    ]);
    const res = await request(makeApp())
      .put('/api/admin/deviations/1')
      .send({ assignedToUserId: 'tech-1' });
    expect(res.status).toBe(200);
    expect(res.body.assignedToUserId).toBe('tech-1');
  });

  test('oppdaterer deadline', async () => {
    setQueryResponses([
      { rows: [{ id: 1 }] },
      { rows: [{ id: 1 }] },
      { rows: [{ id: 1, deadline: '2026-06-15' }] }
    ]);
    const res = await request(makeApp())
      .put('/api/admin/deviations/1')
      .send({ deadline: '2026-06-15' });
    expect(res.status).toBe(200);
  });

  test('lukker avvik med closure_mode og setter closed_at automatisk', async () => {
    setQueryResponses([
      { rows: [{ id: 1 }] },
      { rows: [{ id: 1 }] },
      { rows: [{ id: 1, status: 'closed', closureMode: 'manual_close' }] }
    ]);
    const res = await request(makeApp())
      .put('/api/admin/deviations/1')
      .send({ status: 'closed', closureMode: 'manual_close', closureComment: 'Fikset' });
    expect(res.status).toBe(200);
    const [updateSql] = mockPool.query.mock.calls[1];
    expect(updateSql).toContain('closed_at = COALESCE(closed_at, NOW())');
  });

  test('avviser status=closed uten closureMode (400)', async () => {
    const res = await request(makeApp())
      .put('/api/admin/deviations/1')
      .send({ status: 'closed' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/closureMode/);
  });

  test('normaliserer severity (case-insensitive: HIGH → høy)', async () => {
    setQueryResponses([
      { rows: [{ id: 1 }] },
      { rows: [{ id: 1 }] },
      { rows: [{ id: 1, severity: 'høy' }] }
    ]);
    const res = await request(makeApp())
      .put('/api/admin/deviations/1')
      .send({ currentSeverity: 'HIGH' });
    expect(res.status).toBe(200);
    // Params til UPDATE skal inneholde 'høy' (normalisert)
    const [, updateParams] = mockPool.query.mock.calls[1];
    expect(updateParams).toContain('høy');
  });

  test('avviser ugyldig severity (400)', async () => {
    const res = await request(makeApp())
      .put('/api/admin/deviations/1')
      .send({ currentSeverity: 'kritisk' });
    expect(res.status).toBe(400);
  });

  test('avviser ugyldig status (400)', async () => {
    const res = await request(makeApp())
      .put('/api/admin/deviations/1')
      .send({ status: 'frozen' });
    expect(res.status).toBe(400);
  });

  test('avviser ugyldig closure_mode (400)', async () => {
    const res = await request(makeApp())
      .put('/api/admin/deviations/1')
      .send({ status: 'closed', closureMode: 'invalid_mode' });
    expect(res.status).toBe(400);
  });

  test('returnerer 404 hvis ID ikke finnes', async () => {
    setQueryResponses([{ rows: [] }]);
    const res = await request(makeApp())
      .put('/api/admin/deviations/9999')
      .send({ status: 'assigned' });
    expect(res.status).toBe(404);
  });

  test('avviser tom body (400)', async () => {
    setQueryResponses([{ rows: [{ id: 1 }] }]);
    const res = await request(makeApp())
      .put('/api/admin/deviations/1')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Ingen felter/);
  });
});
