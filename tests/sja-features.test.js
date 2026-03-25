/**
 * Tester for SJA kategori-dropdown og bildeopplasting
 * Kjør: npx jest tests/sja-features.test.js
 */
const path = require('path');
const fs = require('fs');

// Mock GCS
jest.mock('@google-cloud/storage', () => ({
  Storage: jest.fn().mockImplementation(() => ({
    bucket: jest.fn().mockReturnValue({
      file: jest.fn().mockReturnValue({
        save: jest.fn().mockResolvedValue(),
        delete: jest.fn().mockResolvedValue(),
        makePublic: jest.fn().mockResolvedValue()
      })
    })
  }))
}));

// Mock database
const mockQuery = jest.fn();
jest.mock('../src/config/database', () => ({
  getTenantConnection: jest.fn().mockResolvedValue({
    query: (...args) => mockQuery(...args)
  }),
  getPool: jest.fn().mockResolvedValue({
    query: jest.fn().mockResolvedValue({ rows: [] })
  })
}));

// Mock GCS config — must mock createWriteStream used by uploadToGCS
jest.mock('../src/config/gcs', () => {
  const { PassThrough } = require('stream');
  return {
    storage: {},
    bucket: {
      file: jest.fn().mockReturnValue({
        createWriteStream: jest.fn().mockImplementation(() => {
          const stream = new PassThrough();
          process.nextTick(() => stream.emit('finish'));
          return stream;
        }),
        save: jest.fn().mockResolvedValue(),
        delete: jest.fn().mockResolvedValue(),
        makePublic: jest.fn().mockResolvedValue()
      })
    },
    bucketName: 'test-bucket'
  };
});

const express = require('express');
const session = require('express-session');
const request = require('supertest');

function createTestApp(router, mountPath, sessionOverrides = {}) {
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
    if (sessionOverrides.tenantId) {
      req.tenantId = sessionOverrides.tenantId;
    }
    next();
  });
  app.use(mountPath, router);
  return app;
}

// ============================================================
// SJA Categories — statisk fil
// ============================================================
describe('SJA Categories (sja-categories.js)', () => {
  let SJA_CATEGORIES;

  beforeAll(() => {
    const filePath = path.resolve(__dirname, '..', 'public/app/assets/js/sja-categories.js');
    const code = fs.readFileSync(filePath, 'utf8');
    // File uses `const SJA_CATEGORIES = [...]` — wrap in a function that returns it
    const vm = require('vm');
    const wrappedCode = code + '\nSJA_CATEGORIES;';
    SJA_CATEGORIES = vm.runInNewContext(wrappedCode, {});
  });

  test('har 21 kategorier', () => {
    expect(SJA_CATEGORIES).toHaveLength(21);
  });

  test('hver kategori har id, label og subcategories', () => {
    for (const cat of SJA_CATEGORIES) {
      expect(cat).toHaveProperty('id');
      expect(cat).toHaveProperty('label');
      expect(cat).toHaveProperty('subcategories');
      expect(typeof cat.id).toBe('number');
      expect(typeof cat.label).toBe('string');
      expect(Array.isArray(cat.subcategories)).toBe(true);
    }
  });

  test('id-er er unike og sekvensielle 1–21', () => {
    const ids = SJA_CATEGORIES.map(c => c.id);
    expect(ids).toEqual(Array.from({ length: 21 }, (_, i) => i + 1));
  });

  test('siste kategori er "Annet" med freeText: true', () => {
    const last = SJA_CATEGORIES[SJA_CATEGORIES.length - 1];
    expect(last.label).toBe('Annet');
    expect(last.freeText).toBe(true);
    expect(last.subcategories).toEqual([]);
  });

  test('alle andre kategorier har minst én subcategory', () => {
    const others = SJA_CATEGORIES.slice(0, -1);
    for (const cat of others) {
      expect(cat.subcategories.length).toBeGreaterThanOrEqual(1);
    }
  });

  test('ingen duplikate label-er', () => {
    const labels = SJA_CATEGORIES.map(c => c.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

// ============================================================
// HMS routes — POST /sja med category/subcategory
// ============================================================
describe('HMS routes — SJA med kategori', () => {
  let app;

  beforeAll(() => {
    const hmsRouter = require('../src/routes/hms');
    app = createTestApp(hmsRouter, '/api/hms', {
      technicianId: 1,
      tenantId: 'testcorp'
    });
  });

  beforeEach(() => {
    mockQuery.mockReset();
  });

  test('POST /api/hms/sja lagrer category og subcategory', async () => {
    // Kall 1: SELECT på hms_ros for automatisk ROS-kobling (category er satt)
    mockQuery.mockResolvedValueOnce({ rows: [] });

    // Kall 2: INSERT i hms_sja — returnerer den lagrede raden
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 42,
        category: 'Arbeid i høyden',
        subcategory: 'Risiko for fall',
        job_description: 'Test',
        location: 'Tak',
        identified_risks: 'Fall',
        safety_measures: 'Sele',
        status: 'draft'
      }]
    });

    const res = await request(app)
      .post('/api/hms/sja')
      .send({
        job_description: 'Test',
        location: 'Tak',
        identified_risks: 'Fall',
        safety_measures: 'Sele',
        category: 'Arbeid i høyden',
        subcategory: 'Risiko for fall'
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.sja.category).toBe('Arbeid i høyden');
    expect(res.body.sja.subcategory).toBe('Risiko for fall');

    // Kall [0] er ROS-SELECT, kall [1] er SJA-INSERT
    const insertSql = mockQuery.mock.calls[1][0];
    expect(insertSql).toContain('category');
    expect(insertSql).toContain('subcategory');
    expect(insertSql).toContain('$10');
    expect(insertSql).toContain('$11');
  });

  test('POST /api/hms/sja fungerer uten category (bakoverkompatibel)', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 43,
        category: null,
        subcategory: null,
        job_description: 'Test',
        status: 'draft'
      }]
    });

    const res = await request(app)
      .post('/api/hms/sja')
      .send({
        job_description: 'Test uten kategori',
        location: 'Kontor'
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // category og subcategory params skal være null
    const params = mockQuery.mock.calls[0][1];
    expect(params[params.length - 2]).toBeNull(); // category
    expect(params[params.length - 1]).toBeNull(); // subcategory
  });

  test('GET /api/hms/sja returnerer liste (inkl. nye kolonner)', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 1, category: 'Elektrisk arbeid', subcategory: 'Arbeid på eller nær elektriske installasjoner', photos: [] },
        { id: 2, category: null, subcategory: null, photos: null }
      ]
    });

    const res = await request(app).get('/api/hms/sja');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].category).toBe('Elektrisk arbeid');
  });

  test('GET /api/hms/sja/:id returnerer enkelt SJA', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 42,
        category: 'Brann- og eksplosjonsfare',
        subcategory: 'Varme arbeider',
        photos: ['https://storage.googleapis.com/test/photo1.jpg']
      }]
    });

    const res = await request(app).get('/api/hms/sja/42');
    expect(res.status).toBe(200);
    expect(res.body.category).toBe('Brann- og eksplosjonsfare');
    expect(res.body.photos).toHaveLength(1);
  });

  test('POST /api/hms/sja krever autentisering', async () => {
    const unauthApp = createTestApp(
      require('../src/routes/hms'),
      '/api/hms',
      {} // ingen session-verdier
    );

    const res = await request(unauthApp)
      .post('/api/hms/sja')
      .send({ job_description: 'Test' });

    expect(res.status).toBe(401);
  });
});

// ============================================================
// Images routes — SJA foto-opplasting og sletting
// ============================================================
describe('Images routes — SJA bilder', () => {
  let app;

  beforeAll(() => {
    const imagesRouter = require('../src/routes/images');
    app = createTestApp(imagesRouter, '/api/images', {
      technicianId: 1,
      tenantId: 'testcorp'
    });
  });

  beforeEach(() => {
    mockQuery.mockReset();
  });

  test('POST /api/images/sja krever sjaId', async () => {
    const res = await request(app)
      .post('/api/images/sja')
      .field('notSjaId', '42')
      .attach('image', Buffer.from('fake-image'), 'test.jpg');

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('sjaId');
  });

  test('POST /api/images/sja krever fil', async () => {
    const res = await request(app)
      .post('/api/images/sja')
      .field('sjaId', '42');

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('fil');
  });

  test('POST /api/images/sja krever autentisering', async () => {
    const unauthApp = createTestApp(
      require('../src/routes/images'),
      '/api/images',
      {} // ingen tenantId
    );

    const res = await request(unauthApp)
      .post('/api/images/sja')
      .field('sjaId', '42')
      .attach('image', Buffer.from('fake-image'), 'test.jpg');

    expect(res.status).toBe(401);
  });

  test('POST /api/images/sja laster opp og oppdaterer photos-array', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ photos: ['https://storage.googleapis.com/test-bucket/photo1.jpg'] }]
    });

    const res = await request(app)
      .post('/api/images/sja')
      .field('sjaId', '42')
      .attach('image', Buffer.from('fake-image-data'), 'test.jpg');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.totalPhotos).toBe(1);

    // Verify SQL uses array_append
    const sql = mockQuery.mock.calls[0][0];
    expect(sql).toContain('array_append');
    expect(sql).toContain('hms_sja');
  });

  test('POST /api/images/sja returnerer 404 for ukjent SJA', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/images/sja')
      .field('sjaId', '999')
      .attach('image', Buffer.from('fake-image-data'), 'test.jpg');

    expect(res.status).toBe(404);
  });

  test('DELETE /api/images/sja/:sjaId krever imageUrl', async () => {
    const res = await request(app)
      .delete('/api/images/sja/42')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('imageUrl');
  });

  test('DELETE /api/images/sja/:sjaId fjerner bilde fra array', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ photos: [] }]
    });

    const res = await request(app)
      .delete('/api/images/sja/42')
      .send({ imageUrl: 'https://storage.googleapis.com/test-bucket/tenants/testcorp/hms/sja/2026/03/sja-42/test.jpg' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.totalPhotos).toBe(0);

    // Verify SQL uses array_remove
    const sql = mockQuery.mock.calls[0][0];
    expect(sql).toContain('array_remove');
  });

  test('DELETE /api/images/sja/:sjaId krever autentisering', async () => {
    const unauthApp = createTestApp(
      require('../src/routes/images'),
      '/api/images',
      {}
    );

    const res = await request(unauthApp)
      .delete('/api/images/sja/42')
      .send({ imageUrl: 'https://example.com/photo.jpg' });

    expect(res.status).toBe(401);
  });
});

// ============================================================
// SJA PDF Generator — kategori og bilder i HTML
// ============================================================
describe('SJA PDF Generator — kategori og bilder', () => {
  test('sjaPdfGenerator.js inneholder kategori-seksjon i HTML', () => {
    const code = fs.readFileSync(
      path.resolve(__dirname, '..', 'src/services/sjaPdfGenerator.js'), 'utf8'
    );
    expect(code).toContain('category');
    expect(code).toContain('subcategory');
  });

  test('sjaPdfGenerator.js inneholder foto-seksjon i HTML', () => {
    const code = fs.readFileSync(
      path.resolve(__dirname, '..', 'src/services/sjaPdfGenerator.js'), 'utf8'
    );
    expect(code).toContain('photos');
    expect(code).toContain('inlinePhotos');
    expect(code).toContain('Dokumentasjonsbilder');
  });

  test('generateHtml er async (for inlinePhotos)', () => {
    const code = fs.readFileSync(
      path.resolve(__dirname, '..', 'src/services/sjaPdfGenerator.js'), 'utf8'
    );
    expect(code).toMatch(/async\s+generateHtml/);
  });
});

// ============================================================
// Frontend — sja.html inneholder kategori og foto-UI
// ============================================================
describe('Frontend — sja.html', () => {
  let html;

  beforeAll(() => {
    html = fs.readFileSync(
      path.resolve(__dirname, '..', 'public/app/sja.html'), 'utf8'
    );
  });

  test('laster sja-categories.js', () => {
    expect(html).toContain('sja-categories.js');
  });

  test('har kategori-dropdown', () => {
    expect(html).toContain('sja-category');
    expect(html).toContain('sja-subcategory');
  });

  test('har foto-opplasting UI', () => {
    expect(html).toContain('sja-photos-gallery');
    expect(html).toContain('initFormPhotoUpload');
  });

  test('har navigateBack-funksjon', () => {
    expect(html).toContain('navigateBack');
  });

  test('har category-felter i POST-payload', () => {
    expect(html).toMatch(/category\s*:/);
    expect(html).toMatch(/subcategory\s*:/);
  });
});

// ============================================================
// Admin — hms.html inneholder kategori-visning
// ============================================================
describe('Admin — hms.html kategori og bilder', () => {
  let html;

  beforeAll(() => {
    html = fs.readFileSync(
      path.resolve(__dirname, '..', 'public/admin/hms.html'), 'utf8'
    );
  });

  test('viser kategori i SJA-tabellen', () => {
    expect(html).toContain('Kategori');
    expect(html).toContain('category');
  });

  test('har foto-seksjon i detaljmodal', () => {
    expect(html).toContain('photos');
  });
});

// ============================================================
// Migrasjons-scripts — struktur og innhold
// ============================================================
describe('Migrasjons-scripts', () => {
  test('migrate-sja-category.js bruker idempotent SQL', () => {
    const code = fs.readFileSync(
      path.resolve(__dirname, '..', 'scripts/migrate-sja-category.js'), 'utf8'
    );
    expect(code).toContain('ADD COLUMN IF NOT EXISTS category TEXT');
    expect(code).toContain('ADD COLUMN IF NOT EXISTS subcategory TEXT');
  });

  test('migrate-sja-photos.js bruker idempotent SQL', () => {
    const code = fs.readFileSync(
      path.resolve(__dirname, '..', 'scripts/migrate-sja-photos.js'), 'utf8'
    );
    expect(code).toContain('ADD COLUMN IF NOT EXISTS photos TEXT[]');
  });

  test('begge scripts håndterer Cloud SQL Proxy lokalt', () => {
    for (const script of ['migrate-sja-category.js', 'migrate-sja-photos.js']) {
      const code = fs.readFileSync(
        path.resolve(__dirname, '..', 'scripts', script), 'utf8'
      );
      expect(code).toContain("CLOUD_SQL_CONNECTION_NAME");
      expect(code).toContain("process.env.CLOUD_SQL_CONNECTION_NAME = ''");
    }
  });

  test('begge scripts støtter --dry-run', () => {
    for (const script of ['migrate-sja-category.js', 'migrate-sja-photos.js']) {
      const code = fs.readFileSync(
        path.resolve(__dirname, '..', 'scripts', script), 'utf8'
      );
      expect(code).toContain('--dry-run');
    }
  });

  test('begge scripts sjekker om hms_sja-tabellen eksisterer', () => {
    for (const script of ['migrate-sja-category.js', 'migrate-sja-photos.js']) {
      const code = fs.readFileSync(
        path.resolve(__dirname, '..', 'scripts', script), 'utf8'
      );
      expect(code).toContain("table_name = 'hms_sja'");
    }
  });
});
