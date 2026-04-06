/**
 * pdf-heading-colors.test.js
 *
 * Verifiserer at getAirTechCSSWithOptions() bruker riktige heading-farger
 * (bakgrunn + tekst) — både default-verdier og egendefinerte fra tenant settings.
 */

const UnifiedPDFGenerator = require('../src/services/unifiedPdfGenerator');

describe('getAirTechCSSWithOptions – heading colors', () => {
  let generator;

  beforeEach(() => {
    generator = new UnifiedPDFGenerator('test_tenant');
  });

  test('bruker default heading-farger når ingen er satt', () => {
    const css = generator.getAirTechCSSWithOptions({});

    // Default bakgrunnsfarge #1d4ed8 på header-container
    expect(css).toContain('background-color: #1d4ed8');
    // Default tekstfarge #ffffff på main-title
    expect(css).toMatch(/\.main-title\s*\{[^}]*color:\s*#ffffff/);
    // Section-header bruker heading-farge som tekstfarge (ikke bakgrunn)
    expect(css).toMatch(/\.section-header\s*\{[^}]*color:\s*#1d4ed8/);
  });

  test('bruker custom bakgrunnsfarge fra settings', () => {
    const css = generator.getAirTechCSSWithOptions({
      reportHeadingColor: '#ff0000',
    });

    expect(css).toContain('background-color: #ff0000');
    // Section-header arver custom farge
    expect(css).toMatch(/\.section-header\s*\{[^}]*color:\s*#ff0000/);
  });

  test('bruker custom tekstfarge fra settings', () => {
    const css = generator.getAirTechCSSWithOptions({
      reportHeadingColor: '#003366',
      reportHeadingTextColor: '#ffcc00',
    });

    // Bakgrunnsfarge
    expect(css).toContain('background-color: #003366');
    // Tekstfarge på tittel
    expect(css).toMatch(/\.main-title\s*\{[^}]*color:\s*#ffcc00/);
    // Report-id bruker også tekstfargen
    expect(css).toMatch(/\.report-id\s*\{[^}]*color:\s*#ffcc00/);
  });

  test('section-header har IKKE bakgrunnsfarge', () => {
    const css = generator.getAirTechCSSWithOptions({
      reportHeadingColor: '#1d4ed8',
    });

    // Section-header skal ikke ha background-color
    const sectionHeaderMatch = css.match(/\.section-header\s*\{[^}]*\}/);
    expect(sectionHeaderMatch).toBeTruthy();
    expect(sectionHeaderMatch[0]).not.toContain('background-color');
  });

  test('header-container har border-radius og padding', () => {
    const css = generator.getAirTechCSSWithOptions({});

    const headerMatch = css.match(/\.header-container\s*\{[^}]*\}/);
    expect(headerMatch).toBeTruthy();
    expect(headerMatch[0]).toContain('border-radius');
    expect(headerMatch[0]).toContain('padding');
  });
});
