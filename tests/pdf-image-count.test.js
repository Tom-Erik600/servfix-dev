/**
 * pdf-image-count.test.js
 *
 * Verifiserer at processAirTechData produserer korrekt antall bilder i
 * avvik-seksjoner og dokumentasjonsbilder — hverken mer eller færre enn
 * det som faktisk ble lastet opp for ordren.
 *
 * Tester isolert mot UnifiedPDFGenerator.processAirTechData() uten DB eller
 * Puppeteer — fetchChecklistTemplate mockes til å returnere en fast mal.
 */

const UnifiedPDFGenerator = require('../src/services/unifiedPdfGenerator');

// ── Hjelpere ──────────────────────────────────────────────────────────────────

/**
 * Bygger et minimalt checklist_data-objekt med ett component og ett sjekkpunkt
 * som har status 'avvik'.
 */
function makeChecklistData(itemId, extraItems = {}) {
  return {
    components: [
      {
        name: 'Generelt',
        checklist: {
          [itemId]: { status: 'avvik', avvikComment: 'Testkommentar', label: 'Testpunkt' },
          ...extraItems,
        },
      },
    ],
  };
}

/**
 * Bygger et avviksbilde-objekt slik databasen returnerer det.
 */
function makeAvvikImage(serviceReportId, checklistItemId, imageUrl) {
  return {
    service_report_id: serviceReportId,
    checklist_item_id: checklistItemId,
    image_url: imageUrl,
    metadata: {},
  };
}

/**
 * Minimalt order-dataobjekt klart for processAirTechData().
 */
function makeOrderData({ reports, avvikImages = [] }) {
  const primary = reports[0];
  return {
    order_id: 'TEST-ORDER-1',
    order_number: 'TEST-ORDER-1',
    customer_name: 'Test Kunde AS',
    customer_data: {},
    service_date: new Date().toISOString(),
    technician_name: 'Test Tekniker',
    tenant_id: 'test-tenant',
    // Felter processAirTechData leser fra primærrapport
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

// ── Mal som mockes ─────────────────────────────────────────────────────────────

const TEMPLATE = {
  checklistItems: [
    { id: 'item-001', label: 'Testpunkt 1', inputType: 'ok_avvik' },
    { id: 'item-002', label: 'Testpunkt 2', inputType: 'ok_avvik' },
  ],
  systemFields: [],
};

// ── Setup ─────────────────────────────────────────────────────────────────────

let generator;

beforeEach(() => {
  generator = new UnifiedPDFGenerator();
  // Mock fetchChecklistTemplate slik at vi slipper DB-kall
  generator.fetchChecklistTemplate = jest.fn().mockResolvedValue(TEMPLATE);
  // Mock loadCompanySettings (brukes ikke i processAirTechData, men trygg å mocke)
  generator.loadCompanySettings = jest.fn().mockResolvedValue({});
});

// ── Tester ────────────────────────────────────────────────────────────────────

describe('PDF bildetelling — avvik', () => {
  test('ett avviksbilde på ett sjekkpunkt gir nøyaktig 1 bilde i avvik-seksjonen', async () => {
    const reports = [
      {
        report_id: 'SR-1',
        equipment_id: 1,
        equipment_name: 'Anlegg A',
        equipment_type: 'ventilasjon',
        system_nummer: 'SYS-001',
        checklist_data: makeChecklistData('item-001'),
        photos: [],
      },
    ];

    const avvikImages = [
      makeAvvikImage('SR-1', 'item-001', 'https://storage.example.com/img1.jpg'),
    ];

    const data = makeOrderData({ reports, avvikImages });
    const result = await generator.processAirTechData(data);

    expect(result.avvik).toHaveLength(1);
    expect(result.avvik[0].images).toHaveLength(1);
    expect(result.avvik[0].images[0].url).toBe('https://storage.example.com/img1.jpg');
  });

  test('to avviksbilder på samme sjekkpunkt gir nøyaktig 2 bilder', async () => {
    const reports = [
      {
        report_id: 'SR-1',
        equipment_id: 1,
        equipment_name: 'Anlegg A',
        equipment_type: 'ventilasjon',
        system_nummer: 'SYS-001',
        checklist_data: makeChecklistData('item-001'),
        photos: [],
      },
    ];

    const avvikImages = [
      makeAvvikImage('SR-1', 'item-001', 'https://storage.example.com/img1.jpg'),
      makeAvvikImage('SR-1', 'item-001', 'https://storage.example.com/img2.jpg'),
    ];

    const data = makeOrderData({ reports, avvikImages });
    const result = await generator.processAirTechData(data);

    expect(result.avvik).toHaveLength(1);
    expect(result.avvik[0].images).toHaveLength(2);
  });

  test('to rapporter med avviksbilde på samme item-ID blandes ikke på tvers', async () => {
    // Begge rapporter har sjekkpunkt 'item-001' med avvik, men hvert sitt bilde.
    // Bilder skal IKKE krysse rapport-grenser.
    const reports = [
      {
        report_id: 'SR-1',
        equipment_id: 1,
        equipment_name: 'Anlegg A',
        equipment_type: 'ventilasjon',
        system_nummer: 'SYS-001',
        checklist_data: makeChecklistData('item-001'),
        photos: [],
      },
      {
        report_id: 'SR-2',
        equipment_id: 2,
        equipment_name: 'Anlegg B',
        equipment_type: 'ventilasjon',
        system_nummer: 'SYS-002',
        checklist_data: makeChecklistData('item-001'),
        photos: [],
      },
    ];

    const avvikImages = [
      makeAvvikImage('SR-1', 'item-001', 'https://storage.example.com/sr1-img.jpg'),
      makeAvvikImage('SR-2', 'item-001', 'https://storage.example.com/sr2-img.jpg'),
    ];

    const data = makeOrderData({ reports, avvikImages });
    const result = await generator.processAirTechData(data);

    // To separate avvik (ett per rapport/anlegg)
    expect(result.avvik).toHaveLength(2);

    // Hvert avvik har nøyaktig 1 bilde — ikke 2
    expect(result.avvik[0].images).toHaveLength(1);
    expect(result.avvik[1].images).toHaveLength(1);

    // Riktig bilde til riktig rapport
    const urls = result.avvik.map(a => a.images[0].url);
    expect(urls).toContain('https://storage.example.com/sr1-img.jpg');
    expect(urls).toContain('https://storage.example.com/sr2-img.jpg');
  });

  test('avviksbilde med feil rapport-ID vises ikke i resultat', async () => {
    const reports = [
      {
        report_id: 'SR-1',
        equipment_id: 1,
        equipment_name: 'Anlegg A',
        equipment_type: 'ventilasjon',
        system_nummer: 'SYS-001',
        checklist_data: makeChecklistData('item-001'),
        photos: [],
      },
    ];

    // Bildet tilhører SR-99 som ikke er i all_reports
    const avvikImages = [
      makeAvvikImage('SR-99', 'item-001', 'https://storage.example.com/orphan.jpg'),
    ];

    const data = makeOrderData({ reports, avvikImages });
    const result = await generator.processAirTechData(data);

    expect(result.avvik).toHaveLength(1);
    expect(result.avvik[0].images).toHaveLength(0); // Bildet skal ikke dukke opp
  });
});

describe('PDF bildetelling — dokumentasjonsbilder', () => {
  test('photos fra alle rapporter summeres korrekt uten duplikater', async () => {
    const reports = [
      {
        report_id: 'SR-1',
        equipment_id: 1,
        equipment_name: 'Anlegg A',
        equipment_type: 'ventilasjon',
        system_nummer: 'SYS-001',
        checklist_data: makeChecklistData('item-001'),
        photos: [
          'https://storage.example.com/dok1.jpg',
          'https://storage.example.com/dok2.jpg',
        ],
      },
      {
        report_id: 'SR-2',
        equipment_id: 2,
        equipment_name: 'Anlegg B',
        equipment_type: 'ventilasjon',
        system_nummer: 'SYS-002',
        checklist_data: makeChecklistData('item-001'),
        photos: ['https://storage.example.com/dok3.jpg'],
      },
    ];

    const data = makeOrderData({ reports });
    const result = await generator.processAirTechData(data);

    expect(result.documentation_photos).toHaveLength(3);
    const urls = result.documentation_photos.map(p => p.url);
    expect(urls).toContain('https://storage.example.com/dok1.jpg');
    expect(urls).toContain('https://storage.example.com/dok2.jpg');
    expect(urls).toContain('https://storage.example.com/dok3.jpg');
  });

  test('ingen photos gir tom documentation_photos-liste', async () => {
    const reports = [
      {
        report_id: 'SR-1',
        equipment_id: 1,
        equipment_name: 'Anlegg A',
        equipment_type: 'ventilasjon',
        system_nummer: 'SYS-001',
        checklist_data: makeChecklistData('item-001'),
        photos: [],
      },
    ];

    const data = makeOrderData({ reports });
    const result = await generator.processAirTechData(data);

    expect(result.documentation_photos).toHaveLength(0);
  });
});
