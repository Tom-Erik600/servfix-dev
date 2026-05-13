/**
 * Unit-tester for src/services/deviationsService.js
 *
 * Alle DB-kall er mocket via jest.fn() — ingen live DB-tilkobling.
 * Tester: status-mapping, severity-normalisering, flag-gate,
 *         idempotens-logikk (ON CONFLICT-sti) og race condition-håndtering.
 *
 * Kjør: npx jest tests/deviations-service.test.js
 */

'use strict';

// --- Mocks ---

// moduleFlags: full kontroll over returverdi i hvert test
jest.mock('../src/services/moduleFlags', () => ({
  loadModuleFlags: jest.fn()
}));

// loadTenantSettings brukes indirekte via moduleFlags — mockes via moduleFlags direkte.
// Storage-mock for å unngå gRPC-kanaler ved import av images.js-avhengigheter
jest.mock('@google-cloud/storage', () => ({
  Storage: jest.fn().mockImplementation(() => ({
    bucket: jest.fn().mockReturnValue({
      file: jest.fn().mockReturnValue({
        download: jest.fn().mockResolvedValue(['{}'])
      })
    })
  }))
}));

const { loadModuleFlags } = require('../src/services/moduleFlags');
const {
  processReportDeviations,
  normalizeSeverity,
  createOrUpdateDeviation,
  closeOpenDeviationIfAny,
  linkImagesToObservations
} = require('../src/services/deviationsService');

// ---------------------------------------------------------------------------
// Hjelpere
// ---------------------------------------------------------------------------

/** Lag en minimal mock-pool med query som returnerer tom result */
function makePool(queryMap = {}) {
  return {
    query: jest.fn(async (sql, params) => {
      // Finn første match der sql inneholder en av nøklene i queryMap
      for (const [key, result] of Object.entries(queryMap)) {
        if (sql.includes(key)) {
          return typeof result === 'function' ? result(sql, params) : result;
        }
      }
      return { rows: [] };
    })
  };
}

const FLAGS_ON  = { enable_deviations_management: true };
const FLAGS_OFF = { enable_deviations_management: false };

const BASE_CONTEXT = {
  reportId:      'rpt-001',
  equipmentId:   '42',       // VARCHAR i service_reports — caster til Number internt
  checklistData: { checklist: {} },
  technicianId:  'tech-99'
};

// ---------------------------------------------------------------------------
// normalizeSeverity
// ---------------------------------------------------------------------------

describe('normalizeSeverity()', () => {
  test('gyldig norsk — returneres as-is', () => {
    expect(normalizeSeverity('lav')).toBe('lav');
    expect(normalizeSeverity('medium')).toBe('medium');
    expect(normalizeSeverity('høy')).toBe('høy');
  });

  test('null/undefined → medium', () => {
    expect(normalizeSeverity(null)).toBe('medium');
    expect(normalizeSeverity(undefined)).toBe('medium');
    expect(normalizeSeverity('')).toBe('medium');
  });

  test('engelsk alias high → høy', () => {
    expect(normalizeSeverity('high')).toBe('høy');
    expect(normalizeSeverity('HIGH')).toBe('høy');
  });

  test('engelsk alias low → lav', () => {
    expect(normalizeSeverity('low')).toBe('lav');
  });

  test('ukjent verdi → medium + advarsel', () => {
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(normalizeSeverity('critical')).toBe('medium');
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("ukjent severity-verdi 'critical'"));
    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// processReportDeviations — flag gate
// ---------------------------------------------------------------------------

describe('processReportDeviations() — modul-flag gate', () => {
  test('hopper over (skipped: module_disabled) når flagg er av', async () => {
    loadModuleFlags.mockResolvedValue(FLAGS_OFF);
    const pool = makePool();

    const result = await processReportDeviations(pool, 'airtechdev', BASE_CONTEXT);

    expect(result).toEqual({ skipped: true, reason: 'module_disabled' });
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('fortsetter når flagg er på', async () => {
    loadModuleFlags.mockResolvedValue(FLAGS_ON);
    const pool = makePool();

    const result = await processReportDeviations(pool, 'varingtest', BASE_CONTEXT);

    // Ingen checklist-items → summary med alle nuller
    expect(result).toMatchObject({ created: 0, updated: 0, closed: 0, errors: 0 });
  });
});

// ---------------------------------------------------------------------------
// processReportDeviations — validering
// ---------------------------------------------------------------------------

describe('processReportDeviations() — inngangsvalidering', () => {
  test('hopper over (missing_context) ved manglende reportId', async () => {
    loadModuleFlags.mockResolvedValue(FLAGS_ON);
    const pool = makePool();

    const result = await processReportDeviations(pool, 'varingtest', {
      ...BASE_CONTEXT, reportId: null
    });

    expect(result).toEqual({ skipped: true, reason: 'missing_context' });
  });

  test('hopper over (invalid_equipment_id) ved ikke-numerisk equipment_id', async () => {
    loadModuleFlags.mockResolvedValue(FLAGS_ON);
    const pool = makePool();

    const result = await processReportDeviations(pool, 'varingtest', {
      ...BASE_CONTEXT, equipmentId: 'ikke-et-tall'
    });

    expect(result).toEqual({ skipped: true, reason: 'invalid_equipment_id' });
  });
});

// ---------------------------------------------------------------------------
// processReportDeviations — status-mapping
// ---------------------------------------------------------------------------

describe('processReportDeviations() — status-mapping', () => {
  beforeEach(() => {
    loadModuleFlags.mockResolvedValue(FLAGS_ON);
  });

  test("status 'avvik' → createOrUpdateDeviation kalles (summary.created += 1)", async () => {
    const pool = makePool({
      // loadItemLabels: ingen template → tomt objekt
      'FROM equipment e': { rows: [] },
      // createOrUpdateDeviation — SELECT eksisterende: ingen åpen
      'SELECT id FROM deviations': { rows: [] },
      // INSERT ny deviation
      'INSERT INTO deviations': { rows: [{ id: 1 }] },
      // addObservation
      'INSERT INTO deviation_observations': { rows: [] },
      // UPDATE current_summary
      'UPDATE deviations': { rows: [] },
      // linkImagesToObservations
      'UPDATE avvik_images': { rows: [] }
    });

    const ctx = {
      ...BASE_CONTEXT,
      checklistData: {
        checklist: {
          'filter_item': { status: 'avvik', avvikComment: 'Skitten filter' }
        }
      }
    };

    const result = await processReportDeviations(pool, 'varingtest', ctx);
    expect(result.created).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.closed).toBe(0);
    expect(result.errors).toBe(0);
  });

  test("status 'avvik' på eksisterende åpen deviation → summary.updated += 1", async () => {
    // Simuler at det allerede finnes en åpen deviation
    let queryCount = 0;
    const pool = {
      query: jest.fn(async (sql) => {
        if (sql.includes('FROM equipment e')) return { rows: [] };
        if (sql.includes('SELECT id FROM deviations')) return { rows: [{ id: 5 }] };
        if (sql.includes('INSERT INTO deviation_observations')) return { rows: [] };
        if (sql.includes('UPDATE deviations')) return { rows: [] };
        if (sql.includes('UPDATE avvik_images')) return { rows: [] };
        return { rows: [] };
      })
    };

    const ctx = {
      ...BASE_CONTEXT,
      checklistData: {
        checklist: { 'pump_item': { status: 'avvik', avvikComment: 'Lekker' } }
      }
    };

    const result = await processReportDeviations(pool, 'varingtest', ctx);
    expect(result.updated).toBe(1);
    expect(result.created).toBe(0);
  });

  test("status 'ok' på åpen deviation → summary.closed += 1", async () => {
    const pool = {
      query: jest.fn(async (sql) => {
        if (sql.includes('FROM equipment e')) return { rows: [] };
        if (sql.includes('UPDATE deviations') && sql.includes('closed')) {
          return { rows: [{ id: 3 }] }; // Én rad lukket
        }
        if (sql.includes('UPDATE avvik_images')) return { rows: [] };
        return { rows: [] };
      })
    };

    const ctx = {
      ...BASE_CONTEXT,
      checklistData: {
        checklist: { 'filter_item': { status: 'ok' } }
      }
    };

    const result = await processReportDeviations(pool, 'varingtest', ctx);
    expect(result.closed).toBe(1);
    expect(result.created).toBe(0);
  });

  test("status 'byttet' lukker åpen deviation (som 'ok')", async () => {
    const pool = {
      query: jest.fn(async (sql) => {
        if (sql.includes('FROM equipment e')) return { rows: [] };
        if (sql.includes('UPDATE deviations') && sql.includes('closed')) {
          return { rows: [{ id: 7 }] };
        }
        if (sql.includes('UPDATE avvik_images')) return { rows: [] };
        return { rows: [] };
      })
    };

    const ctx = {
      ...BASE_CONTEXT,
      checklistData: {
        checklist: { 'belt_item': { status: 'byttet', byttetComment: 'Ny rem montert' } }
      }
    };

    const result = await processReportDeviations(pool, 'varingtest', ctx);
    expect(result.closed).toBe(1);
  });

  test("ukjente statuser ('ikke_relevant', 'na', '') gir ingen handlinger", async () => {
    const pool = makePool({
      'FROM equipment e': { rows: [] },
      'UPDATE avvik_images': { rows: [] }
    });

    const ctx = {
      ...BASE_CONTEXT,
      checklistData: {
        checklist: {
          'item_a': { status: 'ikke_relevant' },
          'item_b': { status: 'na' },
          'item_c': { status: '' },
          'item_d': {}
        }
      }
    };

    const result = await processReportDeviations(pool, 'varingtest', ctx);
    expect(result.created).toBe(0);
    expect(result.updated).toBe(0);
    expect(result.closed).toBe(0);
    expect(result.errors).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// processReportDeviations — feil-isolasjon
// ---------------------------------------------------------------------------

describe('processReportDeviations() — feil-isolasjon', () => {
  test('feil på ett item stopper ikke prosessering av neste item', async () => {
    loadModuleFlags.mockResolvedValue(FLAGS_ON);

    let callCount = 0;
    const pool = {
      query: jest.fn(async (sql) => {
        if (sql.includes('FROM equipment e')) return { rows: [] };
        if (sql.includes('SELECT id FROM deviations')) {
          callCount++;
          if (callCount === 1) throw new Error('Simulert DB-feil på første item');
          return { rows: [] }; // Andre item: ingen eksisterende
        }
        if (sql.includes('INSERT INTO deviations')) return { rows: [{ id: 10 }] };
        if (sql.includes('INSERT INTO deviation_observations')) return { rows: [] };
        if (sql.includes('UPDATE deviations')) return { rows: [] };
        if (sql.includes('UPDATE avvik_images')) return { rows: [] };
        return { rows: [] };
      })
    };

    const ctx = {
      ...BASE_CONTEXT,
      checklistData: {
        checklist: {
          'item_feil':  { status: 'avvik', avvikComment: 'Feiler' },
          'item_ok':    { status: 'avvik', avvikComment: 'Fungerer' }
        }
      }
    };

    const result = await processReportDeviations(pool, 'varingtest', ctx);
    expect(result.errors).toBe(1);
    expect(result.created).toBe(1); // Andre item prosessert OK
  });
});

// ---------------------------------------------------------------------------
// closeOpenDeviationIfAny
// ---------------------------------------------------------------------------

describe('closeOpenDeviationIfAny()', () => {
  test('returnerer true når en rad ble lukket', async () => {
    const pool = makePool({
      'UPDATE deviations': { rows: [{ id: 1 }] }
    });

    const result = await closeOpenDeviationIfAny(pool, {
      equipmentId: 42, checklistItemId: 'item_1',
      reportId: 'rpt-1', closedByUserId: 'tech-1'
    });
    expect(result).toBe(true);
  });

  test('returnerer false når ingen åpen deviation fantes', async () => {
    const pool = makePool({
      'UPDATE deviations': { rows: [] }
    });

    const result = await closeOpenDeviationIfAny(pool, {
      equipmentId: 42, checklistItemId: 'item_1',
      reportId: 'rpt-1', closedByUserId: 'tech-1'
    });
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// createOrUpdateDeviation — race condition (23P01)
// ---------------------------------------------------------------------------

describe('createOrUpdateDeviation() — race condition', () => {
  test('håndterer 23P01 EXCLUDE-conflict ved å oppdatere eksisterende', async () => {
    let phase = 0;
    const pool = {
      query: jest.fn(async (sql) => {
        if (sql.includes('SELECT id FROM deviations')) {
          if (phase === 0) {
            phase = 1;
            return { rows: [] }; // Første SELECT: ingen åpen
          }
          return { rows: [{ id: 99 }] }; // Retry-SELECT: funnet
        }
        if (sql.includes('INSERT INTO deviations')) {
          const err = new Error('exclusion constraint violation');
          err.code = '23P01';
          throw err;
        }
        if (sql.includes('INSERT INTO deviation_observations')) return { rows: [] };
        if (sql.includes('UPDATE deviations')) return { rows: [] };
        return { rows: [] };
      })
    };

    const result = await createOrUpdateDeviation(pool, {
      equipmentId: 42, checklistItemId: 'item_x',
      checklistItemLabel: 'Test item', severity: 'medium',
      comment: 'Avvik', reportId: 'rpt-1', technicianId: 'tech-1'
    });

    expect(result.action).toBe('updated');
    expect(result.deviationId).toBe(99);
  });
});

// ---------------------------------------------------------------------------
// linkImagesToObservations
// ---------------------------------------------------------------------------

describe('linkImagesToObservations()', () => {
  test('returnerer antall oppdaterte bilder', async () => {
    const pool = makePool({
      'UPDATE avvik_images': { rows: [{ id: 1 }, { id: 2 }] }
    });

    const count = await linkImagesToObservations(pool, 'rpt-1');
    expect(count).toBe(2);
  });

  test('returnerer 0 når ingen bilder å linke', async () => {
    const pool = makePool({
      'UPDATE avvik_images': { rows: [] }
    });

    const count = await linkImagesToObservations(pool, 'rpt-1');
    expect(count).toBe(0);
  });
});
