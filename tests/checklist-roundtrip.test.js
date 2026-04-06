/**
 * checklist-roundtrip.test.js
 *
 * Verifiserer at sjekklistavkrysninger som lagres i databasen (checklist_data)
 * reflekteres nøyaktig i rapporten som genereres av processAirTechData().
 *
 * To tester:
 *   1. Delvise avkrysninger — noen sjekkpunkter har data, andre ikke.
 *      Kun de med data skal vises i rapporten. Status og kommentar
 *      skal stemme eksakt for hvert punkt.
 *
 *   2. Alle sjekkpunkter fylt ut — alle sjekkpunkter i malen skal
 *      vises i rapporten med korrekte statuser, etiketter og kommentarer.
 *      Ingen ekstra eller manglende punkter.
 *
 * Tester isolert mot processAirTechData() — ingen DB, ingen Puppeteer.
 * fetchChecklistTemplate mockes til å returnere en kontrollert mal.
 */

'use strict';

const UnifiedPDFGenerator = require('../src/services/unifiedPdfGenerator');

// ─── Testmal ────────────────────────────────────────────────────────────────
// Fem realistiske sjekkpunkter med forskjellige inputtyper
const TEMPLATE = {
  checklistItems: [
    { id: 'filter_kontroll',     label: 'Filterkontroll',        inputType: 'ok_avvik' },
    { id: 'vifter_kontroll',     label: 'Viftekontroll',         inputType: 'ok_avvik' },
    { id: 'temp_maaling',        label: 'Temperaturmåling',      inputType: 'numeric' },
    { id: 'rengjoring_kanaler',  label: 'Rengjøring av kanaler', inputType: 'ok_avvik' },
    { id: 'innstilling_spjeld',  label: 'Innstilling spjeld',    inputType: 'ok_avvik_comment' },
  ],
  systemFields: [],
};

// ─── Hjelpere ────────────────────────────────────────────────────────────────

/** Bygger ett anlegg (rapport) med valgfrie sjekklistavkrysninger. */
function makeReport(reportId, equipmentId, checklistEntries = {}) {
  return {
    report_id: reportId,
    equipment_id: equipmentId,
    equipment_name: `Anlegg ${reportId}`,
    equipment_type: 'ventilasjon',
    system_nummer: `SYS-${equipmentId}`,
    checklist_data: {
      components: [
        {
          name: 'Generelt',
          checklist: checklistEntries,
        },
      ],
    },
    photos: [],
  };
}

/** Bygger et minimalt order-dataobjekt klart for processAirTechData(). */
function makeOrderData(reports, avvikImages = []) {
  const primary = reports[0];
  return {
    order_id: 'TEST-ORDER-1',
    order_number: 'TEST-ORDER-1',
    customer_name: 'Test Kunde AS',
    customer_data: {},
    service_date: new Date().toISOString(),
    technician_name: 'Test Tekniker',
    tenant_id: 'test-tenant',
    id: primary.report_id,
    equipment_id: primary.equipment_id,
    equipment_name: primary.equipment_name,
    equipment_type: primary.equipment_type,
    equipment_location: '',
    equipment_serial: '',
    equipment_betjener: '',
    checklist_data: primary.checklist_data,
    photos: primary.photos || [],
    products_used: [],
    additional_work: [],
    status: 'completed',
    all_reports: reports,
    avvik_images: avvikImages,
  };
}

// ─── Setup ───────────────────────────────────────────────────────────────────

let generator;

beforeEach(() => {
  generator = new UnifiedPDFGenerator();
  generator.fetchChecklistTemplate = jest.fn().mockResolvedValue(TEMPLATE);
  generator.loadCompanySettings = jest.fn().mockResolvedValue({});
});

// ─── Tester ──────────────────────────────────────────────────────────────────

describe('Sjekkliste roundtrip — delvise avkrysninger', () => {
  /**
   * Scenario: Tekniker fyller ut 3 av 5 sjekkpunkter.
   *
   * Forventning:
   *   - Rapporten inneholder nøyaktig de 3 punktene som ble fylt ut.
   *   - Hvert punkt har korrekt status og kommentar.
   *   - De 2 tomme punktene er IKKE med.
   */
  test('kun utfylte sjekkpunkter vises i rapporten med korrekt status og kommentar', async () => {
    const checklistEntries = {
      // Punkt 1: ok
      filter_kontroll: {
        label: 'Filterkontroll',
        status: 'ok',
      },
      // Punkt 2: avvik med kommentar
      vifter_kontroll: {
        label: 'Viftekontroll',
        status: 'avvik',
        avvikComment: 'Vifteblad skadet',
      },
      // Punkt 3: numerisk verdi
      temp_maaling: {
        label: 'Temperaturmåling',
        value: '18.5',
      },
      // Punkt 4 (rengjoring_kanaler): ikke utfylt → skal ikke vises
      // Punkt 5 (innstilling_spjeld): ikke utfylt → skal ikke vises
    };

    const report = makeReport('SR-1', 1, checklistEntries);
    const data = makeOrderData([report]);
    const result = await generator.processAirTechData(data);

    // Én seksjon for ett anlegg
    expect(result.equipmentSections).toHaveLength(1);
    const section = result.equipmentSections[0];

    // Kun 3 utfylte sjekkpunkter, ikke 5
    expect(section.checkpoints).toHaveLength(3);

    // ── Verifiser filter_kontroll ──
    const filterPunkt = section.checkpoints.find(cp => cp.item_id === 'filter_kontroll');
    expect(filterPunkt).toBeDefined();
    expect(filterPunkt.name).toBe('Filterkontroll');
    expect(filterPunkt.status).toBe('OK');

    // ── Verifiser vifter_kontroll ──
    const vifterPunkt = section.checkpoints.find(cp => cp.item_id === 'vifter_kontroll');
    expect(vifterPunkt).toBeDefined();
    expect(vifterPunkt.name).toBe('Viftekontroll');
    expect(vifterPunkt.status).toBe('AVVIK');
    expect(vifterPunkt.comment).toContain('Vifteblad skadet');

    // ── Verifiser temp_maaling ──
    const tempPunkt = section.checkpoints.find(cp => cp.item_id === 'temp_maaling');
    expect(tempPunkt).toBeDefined();
    expect(tempPunkt.name).toBe('Temperaturmåling');
    expect(tempPunkt.comment).toContain('18.5');

    // ── Tomme punkter skal IKKE finnes ──
    const rengjoring = section.checkpoints.find(cp => cp.item_id === 'rengjoring_kanaler');
    const spjeld    = section.checkpoints.find(cp => cp.item_id === 'innstilling_spjeld');
    expect(rengjoring).toBeUndefined();
    expect(spjeld).toBeUndefined();

    // ── Avvik: kun vifter_kontroll ──
    expect(result.avvik).toHaveLength(1);
    expect(result.avvik[0].item_id).toBe('vifter_kontroll');
    expect(result.avvik[0].kommentar).toBe('Vifteblad skadet');
  });
});

describe('Sjekkliste roundtrip — alle sjekkpunkter utfylt', () => {
  /**
   * Scenario: Tekniker fyller ut alle 5 sjekkpunkter i malen.
   *
   * Forventning:
   *   - Rapporten inneholder nøyaktig 5 sjekkpunkter — verken mer eller færre.
   *   - Hvert enkelt punkt har korrekt etikett, status og kommentar som
   *     stemmer 1:1 med det som ble registrert i sjekklisten.
   *   - Antall avvik i avvik-seksjonen er nøyaktig lik antall punkt med
   *     status 'avvik' i sjekklisten.
   */
  test('alle 5 sjekkpunkter vises med korrekte felter i rapporten', async () => {
    const checklistEntries = {
      filter_kontroll: {
        label: 'Filterkontroll',
        status: 'ok',
      },
      vifter_kontroll: {
        label: 'Viftekontroll',
        status: 'avvik',
        avvikComment: 'Lager lyd ved oppstart',
      },
      temp_maaling: {
        label: 'Temperaturmåling',
        value: '21.3',
      },
      rengjoring_kanaler: {
        label: 'Rengjøring av kanaler',
        status: 'ok',
      },
      innstilling_spjeld: {
        label: 'Innstilling spjeld',
        status: 'avvik',
        comment: 'Justert til 45 grader',
        avvikComment: 'Spjeld sitter løst',
      },
    };

    const report = makeReport('SR-1', 1, checklistEntries);
    const data = makeOrderData([report]);
    const result = await generator.processAirTechData(data);

    expect(result.equipmentSections).toHaveLength(1);
    const section = result.equipmentSections[0];

    // Alle 5 sjekkpunkter skal være med
    expect(section.checkpoints).toHaveLength(5);

    // Bygg et oppslagskart for enkel assertions
    const byId = Object.fromEntries(section.checkpoints.map(cp => [cp.item_id, cp]));

    // ── filter_kontroll ──
    expect(byId['filter_kontroll']).toBeDefined();
    expect(byId['filter_kontroll'].name).toBe('Filterkontroll');
    expect(byId['filter_kontroll'].status).toBe('OK');

    // ── vifter_kontroll ──
    expect(byId['vifter_kontroll']).toBeDefined();
    expect(byId['vifter_kontroll'].name).toBe('Viftekontroll');
    expect(byId['vifter_kontroll'].status).toBe('AVVIK');
    expect(byId['vifter_kontroll'].comment).toContain('Lager lyd ved oppstart');

    // ── temp_maaling ──
    expect(byId['temp_maaling']).toBeDefined();
    expect(byId['temp_maaling'].name).toBe('Temperaturmåling');
    expect(byId['temp_maaling'].comment).toContain('21.3');

    // ── rengjoring_kanaler ──
    expect(byId['rengjoring_kanaler']).toBeDefined();
    expect(byId['rengjoring_kanaler'].name).toBe('Rengjøring av kanaler');
    expect(byId['rengjoring_kanaler'].status).toBe('OK');

    // ── innstilling_spjeld ──
    expect(byId['innstilling_spjeld']).toBeDefined();
    expect(byId['innstilling_spjeld'].name).toBe('Innstilling spjeld');
    expect(byId['innstilling_spjeld'].status).toBe('AVVIK');
    // ok_avvik_comment → kommentar + avvikComment i én streng
    expect(byId['innstilling_spjeld'].comment).toContain('Justert til 45 grader');
    expect(byId['innstilling_spjeld'].comment).toContain('Spjeld sitter løst');

    // ── Nøyaktig 2 avvik (vifter_kontroll + innstilling_spjeld) ──
    expect(result.avvik).toHaveLength(2);
    const avvikIds = result.avvik.map(a => a.item_id);
    expect(avvikIds).toContain('vifter_kontroll');
    expect(avvikIds).toContain('innstilling_spjeld');

    // Avvik-kommentarer
    const vifterAvvik = result.avvik.find(a => a.item_id === 'vifter_kontroll');
    expect(vifterAvvik.kommentar).toBe('Lager lyd ved oppstart');

    const spjeldAvvik = result.avvik.find(a => a.item_id === 'innstilling_spjeld');
    expect(spjeldAvvik.kommentar).toBe('Spjeld sitter løst');
  });
});

describe('Sjekkliste robusthet — avviksscenarier i dev', () => {
  test('ukjent item-ID i checklist_data blir ignorert og dukker ikke opp i rapporten', async () => {
    const checklistEntries = {
      filter_kontroll: {
        label: 'Filterkontroll',
        status: 'ok',
      },
      vifter_kontroll: {
        label: 'Viftekontroll',
        status: 'avvik',
        avvikComment: 'Testavvik',
      },
      // Ikke i TEMPLATE.checklistItems → skal ignoreres
      ukjent_punkt_fra_gammel_mal: {
        label: 'Ukjent punkt',
        status: 'ok',
      },
    };

    const report = makeReport('SR-UNKNOWN', 10, checklistEntries);
    const data = makeOrderData([report]);
    const result = await generator.processAirTechData(data);

    expect(result.equipmentSections).toHaveLength(1);
    const checkpoints = result.equipmentSections[0].checkpoints;

    // Kun de to kjente punktene skal med
    expect(checkpoints).toHaveLength(2);
    const itemIds = checkpoints.map(cp => cp.item_id);
    expect(itemIds).toContain('filter_kontroll');
    expect(itemIds).toContain('vifter_kontroll');
    expect(itemIds).not.toContain('ukjent_punkt_fra_gammel_mal');
  });

  test('rapporten får aldri flere checkpoints enn antall gyldige utfylte punkter i malen', async () => {
    const checklistEntries = {
      filter_kontroll: {
        label: 'Filterkontroll',
        status: 'ok',
      },
      vifter_kontroll: {
        label: 'Viftekontroll',
        status: 'avvik',
        avvikComment: 'Motor støy',
      },
      temp_maaling: {
        label: 'Temperaturmåling',
        value: '19.8',
      },
      // Ugyldige i forhold til malen
      legacy_foo: { status: 'ok' },
      legacy_bar: { status: 'avvik', avvikComment: 'Skal ignoreres' },
    };

    const report = makeReport('SR-MAX', 11, checklistEntries);
    const data = makeOrderData([report]);
    const result = await generator.processAirTechData(data);

    const checkpoints = result.equipmentSections[0].checkpoints;
    const gyldigeMalsjekkpunkter = ['filter_kontroll', 'vifter_kontroll', 'temp_maaling'];

    expect(checkpoints.length).toBeLessThanOrEqual(gyldigeMalsjekkpunkter.length);
    expect(checkpoints).toHaveLength(3);
    expect(checkpoints.map(cp => cp.item_id).sort()).toEqual(gyldigeMalsjekkpunkter.sort());
  });

  test('korrupt/tom checklist_data kræsjer ikke og gir 0 checkpoints', async () => {
    const badReport = {
      report_id: 'SR-BAD',
      equipment_id: 12,
      equipment_name: 'Anlegg SR-BAD',
      equipment_type: 'ventilasjon',
      system_nummer: 'SYS-12',
      checklist_data: null,
      photos: [],
    };

    const data = makeOrderData([badReport]);
    const result = await generator.processAirTechData(data);

    expect(result.equipmentSections).toHaveLength(0);
    expect(result.avvik).toHaveLength(0);
  });

  test('antall avvik i avvik-tabellen matcher nøyaktig antall gyldige avvik i sjekklisten', async () => {
    const checklistEntries = {
      filter_kontroll: {
        label: 'Filterkontroll',
        status: 'avvik',
        avvikComment: 'Filter tett',
      },
      vifter_kontroll: {
        label: 'Viftekontroll',
        status: 'ok',
      },
      innstilling_spjeld: {
        label: 'Innstilling spjeld',
        status: 'avvik',
        avvikComment: 'Løst beslag',
      },
      // Avvik på ukjent felt skal IKKE telles med i resultatet
      legacy_unknown_avvik: {
        status: 'avvik',
        avvikComment: 'Skal ikke med',
      },
    };

    const report = makeReport('SR-AVVIK', 13, checklistEntries);
    const data = makeOrderData([report]);
    const result = await generator.processAirTechData(data);

    const expectedAvvikIds = ['filter_kontroll', 'innstilling_spjeld'];
    expect(result.avvik).toHaveLength(expectedAvvikIds.length);
    expect(result.avvik.map(a => a.item_id).sort()).toEqual(expectedAvvikIds.sort());
  });
});

describe('Sjekkliste roundtrip — produkter, arbeid og driftstider med i rapport', () => {
  test('produkter, timer/pris og driftstider fra input gjengis i rapportmodell og HTML', async () => {
    const checklistEntries = {
      filter_kontroll: {
        label: 'Filterkontroll',
        status: 'ok',
      },
    };

    const report = makeReport('SR-DRIFT', 20, checklistEntries);
    report.checklist_data.driftSchedule = {
      mandag: { start: '07:00', stopp: '16:00' },
      tirsdag: { start: '07:30', stopp: '16:30' },
    };

    const data = makeOrderData([report]);
    data.products_used = [
      { name: 'Filterpakke', quantity: 2, price: 450, total: 900 },
    ];
    data.additional_work = [
      { description: 'Rens av kanal', hours: 2.5, price: 850, total: 2125 },
    ];

    const result = await generator.processAirTechData(data);

    // Modellnivå: feltene beholdes uendret
    expect(result.products_used).toHaveLength(1);
    expect(result.products_used[0]).toEqual({ name: 'Filterpakke', quantity: 2, price: 450, total: 900 });

    expect(result.additional_work).toHaveLength(1);
    expect(result.additional_work[0]).toEqual({ description: 'Rens av kanal', hours: 2.5, price: 850, total: 2125 });

    expect(result.equipmentSections).toHaveLength(1);
    expect(result.equipmentSections[0].driftSchedule.mandag).toEqual({ start: '07:00', stopp: '16:00' });

    // Rendernivå: feltene blir med i rapport-HTML
    const html = generator.renderChecklistResults(result);
    expect(html).toContain('Produkter brukt');
    expect(html).toContain('Filterpakke');
    expect(html).toContain('kr 450');
    expect(html).toContain('kr 900');

    expect(html).toContain('Utførte tilleggsarbeider');
    expect(html).toContain('Rens av kanal');
    expect(html).toContain('kr 850');
    expect(html).toMatch(/kr\s*2\s*125/);

    expect(html).toContain('Driftstider');
    expect(html).toContain('Mandag');
    expect(html).toContain('07:00');
    expect(html).toContain('16:00');
  });
});
