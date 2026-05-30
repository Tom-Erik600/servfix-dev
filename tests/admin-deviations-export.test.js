'use strict';

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

jest.mock('../src/routes/images', () => ({
  loadTenantSettings: jest.fn().mockResolvedValue({
    companyInfo: {
      name: 'TestCorp',
      address: 'Testgata 1',
      phone: '12345678',
      email: 'test@test.no',
      cvr: '123456789'
    },
    logo: { url: 'https://example.com/logo.png' }
  })
}));

jest.mock('puppeteer', () => {
  const page = {
    setContent: jest.fn().mockResolvedValue(),
    pdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 test')),
    close: jest.fn().mockResolvedValue()
  };
  const browser = {
    newPage: jest.fn().mockResolvedValue(page),
    close: jest.fn().mockResolvedValue()
  };
  return { launch: jest.fn().mockResolvedValue(browser) };
});

const express = require('express');
const request = require('supertest');
const deviationsRouter = require('../src/routes/admin/deviations');
const { generateDeviationsPdf } = require('../src/services/deviationsExport');

const MOCK_DEVIATIONS = [
  { id: 1, equipmentName: 'Pumpe A', checklistItemLabel: 'Trykk OK', status: 'open', severity: 'høy', openedAt: new Date('2026-01-15'), closedAt: null, assignedToName: 'Ola Nordmann', deadline: new Date('2026-03-01'), observationCount: 2, closureMode: null, closureComment: null },
  { id: 2, equipmentName: 'Båt, nr 2', checklistItemLabel: 'Olje "god"', status: 'closed', severity: 'lav', openedAt: new Date('2026-02-01'), closedAt: new Date('2026-02-20'), assignedToName: null, deadline: null, observationCount: 0, closureMode: 'manual_close', closureComment: 'Løst\nok' }
];

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

describe('GET /api/admin/deviations/export — CSV', () => {
  test('returnerer 200 med text/csv og BOM', async () => {
    setQueryResponses([{ rows: [{ total: 2 }] }, { rows: MOCK_DEVIATIONS }]);
    const res = await request(makeApp()).get('/api/admin/deviations/export?format=csv');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text.charCodeAt(0)).toBe(0xFEFF);
  });

  test('header-rad har eksakt 13 brief-kolonner i riktig rekkefølge', async () => {
    setQueryResponses([{ rows: [{ total: 2 }] }, { rows: MOCK_DEVIATIONS }]);
    const res = await request(makeApp()).get('/api/admin/deviations/export?format=csv');
    const firstLine = res.text.split(/\r?\n/)[0].replace(/^\uFEFF/, '');
    expect(firstLine.split(',')).toEqual(['id','equipmentName','checklistItemLabel','status','severity','openedAt','daysOpen','assignedToName','deadline','observationCount','closedAt','closureMode','closureComment']);
  });

  test('escaper intern komma med double-quote wrap', async () => {
    setQueryResponses([{ rows: [{ total: 2 }] }, { rows: MOCK_DEVIATIONS }]);
    const res = await request(makeApp()).get('/api/admin/deviations/export?format=csv');
    expect(res.text).toContain('"Båt, nr 2"');
  });

  test('escaper interne double-quotes til dobbel (RFC 4180)', async () => {
    setQueryResponses([{ rows: [{ total: 2 }] }, { rows: MOCK_DEVIATIONS }]);
    const res = await request(makeApp()).get('/api/admin/deviations/export?format=csv');
    expect(res.text).toContain('""god""');
  });

  test('null-felter blir tom string, ikke "null"', async () => {
    setQueryResponses([{ rows: [{ total: 2 }] }, { rows: MOCK_DEVIATIONS }]);
    const res = await request(makeApp()).get('/api/admin/deviations/export?format=csv');
    expect(res.text).not.toContain('null');
  });

  test('daysOpen er et heltall >= 0', async () => {
    setQueryResponses([{ rows: [{ total: 2 }] }, { rows: MOCK_DEVIATIONS }]);
    const res = await request(makeApp()).get('/api/admin/deviations/export?format=csv');
    const row = res.text.split(/\r?\n/)[1];
    const columns = row.replace(/^\uFEFF/, '').split(',');
    const daysOpen = Number(columns[6]);
    expect(Number.isInteger(daysOpen)).toBe(true);
    expect(daysOpen).toBeGreaterThanOrEqual(0);
  });
});

describe('GET /api/admin/deviations/export — PDF', () => {
  test('returnerer 200 med application/pdf', async () => {
    setQueryResponses([{ rows: [{ total: 2 }] }, { rows: MOCK_DEVIATIONS }]);
    const res = await request(makeApp()).get('/api/admin/deviations/export?format=pdf');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
  });

  test('generateDeviationsPdf returnerer Buffer-instans', async () => {
    const result = await generateDeviationsPdf([], {});
    expect(Buffer.isBuffer(result)).toBe(true);
  });

  test('Content-Disposition attachment med riktig filnavn-mønster', async () => {
    setQueryResponses([{ rows: [{ total: 2 }] }, { rows: MOCK_DEVIATIONS }]);
    const res = await request(makeApp()).get('/api/admin/deviations/export?format=pdf');
    expect(res.headers['content-disposition']).toMatch(/attachment.*filename="avvik-airtechdev-\d{4}-\d{2}-\d{2}\.pdf"/);
  });
});

describe('GET /api/admin/deviations/export — route validation', () => {
  test('400 hvis format mangler', async () => {
    const res = await request(makeApp()).get('/api/admin/deviations/export');
    expect(res.status).toBe(400);
  });

  test('400 hvis format=xlsx', async () => {
    const res = await request(makeApp()).get('/api/admin/deviations/export?format=xlsx');
    expect(res.status).toBe(400);
  });

  test('400 hvis scope=foobar', async () => {
    const res = await request(makeApp()).get('/api/admin/deviations/export?format=csv&scope=foobar');
    expect(res.status).toBe(400);
  });

  test('422 hvis count > 5000', async () => {
    setQueryResponses([{ rows: [{ total: 5001 }] }]);
    const res = await request(makeApp()).get('/api/admin/deviations/export?format=csv');
    expect(res.status).toBe(422);
    expect(String(res.body.error || '')).toContain('5001');
  });

  test('scope=all ignorerer status-filter', async () => {
    setQueryResponses([{ rows: MOCK_DEVIATIONS }]);
    const res = await request(makeApp()).get('/api/admin/deviations/export?format=csv&scope=all&status=open');
    expect(res.status).toBe(200);
    expect(mockPool.query).toHaveBeenCalledTimes(1);
    const [firstSql] = mockPool.query.mock.calls[0];
    expect(firstSql).not.toContain('IN (');
  });

  test('scope=filtered respekterer status-param', async () => {
    setQueryResponses([{ rows: [{ total: 2 }] }, { rows: MOCK_DEVIATIONS }]);
    const res = await request(makeApp()).get('/api/admin/deviations/export?format=csv&scope=filtered&status=open');
    expect(res.status).toBe(200);
    const [firstSql] = mockPool.query.mock.calls[0];
    expect(firstSql).toContain('IN (');
  });

  test.todo('429 hvis eksport allerede pågår');
});
