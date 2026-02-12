/**
 * Tester for driftsrobusthet-fikser D1–D8, D11, D15
 * Kjør: npx jest tests/robustness-fixes.test.js
 */
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// Mock GCS for å unngå at Storage-konstruktøren åpner gRPC-kanaler
jest.mock('@google-cloud/storage', () => ({
  Storage: jest.fn().mockImplementation(() => ({
    bucket: jest.fn().mockReturnValue({})
  }))
}));

// ============================================================
// D2: Global error handlers registreres
// ============================================================
describe('D2: Global error handlers', () => {
  test('unhandledRejection handler er registrert i server.js', () => {
    const serverCode = fs.readFileSync(
      path.resolve(__dirname, '..', 'server.js'), 'utf8'
    );
    expect(serverCode).toContain("process.on('unhandledRejection'");
  });

  test('uncaughtException handler er registrert i server.js', () => {
    const serverCode = fs.readFileSync(
      path.resolve(__dirname, '..', 'server.js'), 'utf8'
    );
    expect(serverCode).toContain("process.on('uncaughtException'");
  });
});

// ============================================================
// D1+D3: Graceful shutdown + DB drain
// ============================================================
describe('D1+D3: Graceful shutdown', () => {
  test('SIGTERM og SIGINT handlers er registrert', () => {
    const serverCode = fs.readFileSync(
      path.resolve(__dirname, '..', 'server.js'), 'utf8'
    );
    expect(serverCode).toContain("process.on('SIGTERM'");
    expect(serverCode).toContain("process.on('SIGINT'");
  });

  test('database.closeAll() finnes og lukker pools', async () => {
    const mockEnd = jest.fn().mockResolvedValue();
    const db = require('../src/config/database');

    // Inject mock pools
    db.pools = {
      test_db_1: { end: mockEnd },
      test_db_2: { end: mockEnd }
    };

    await db.closeAll();

    expect(mockEnd).toHaveBeenCalledTimes(2);
    expect(Object.keys(db.pools)).toHaveLength(0);
  });
});

// ============================================================
// D4: Puppeteer cleanup med timeout
// ============================================================
describe('D4: Puppeteer close() med timeout', () => {
  test('close() håndterer browser som henger', async () => {
    const PdfGenerator = require('../src/services/unifiedPdfGenerator');
    const pdfGen = new PdfGenerator();

    // Mock en browser som aldri resolves close()
    pdfGen.browser = {
      close: () => new Promise(() => {}), // henger evig
      process: () => ({ kill: jest.fn() })
    };

    // Skal ikke henge — timeout etter 10s, men vi tester at det returnerer
    const closePromise = pdfGen.close();

    // close() skal returnere innen timeout (bruker kort timeout i test)
    let testTimer;
    await expect(
      Promise.race([
        closePromise,
        new Promise((_, rej) => {
          testTimer = setTimeout(() => rej(new Error('Test timeout')), 15000);
        })
      ])
    ).resolves.toBeUndefined();
    clearTimeout(testTimer);

    expect(pdfGen.browser).toBeNull();
  }, 20000);

  test('close() med null browser gjør ingenting', async () => {
    const PdfGenerator = require('../src/services/unifiedPdfGenerator');
    const pdfGen = new PdfGenerator();
    pdfGen.browser = null;
    await expect(pdfGen.close()).resolves.toBeUndefined();
  });
});

// ============================================================
// D5: Health check verifiserer avhengigheter
// ============================================================
describe('D5: Health check format', () => {
  test('health endpoint finnes i server.js med DB-sjekk', () => {
    const serverCode = fs.readFileSync(
      path.resolve(__dirname, '..', 'server.js'), 'utf8'
    );
    expect(serverCode).toContain("'/health'");
    expect(serverCode).toContain("SELECT 1");
    expect(serverCode).toContain("checks");
    expect(serverCode).toContain("503");
  });
});

// ============================================================
// D6: Retry utility
// ============================================================
describe('D6: Retry utility', () => {
  const { retry } = require('../src/utils/retry');

  test('returnerer verdi ved suksess på første forsøk', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const result = await retry(fn, { retries: 3, delayMs: 10 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('prøver på nytt ved feil, lykkes til slutt', async () => {
    const fn = jest.fn()
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockResolvedValue('ok');

    const result = await retry(fn, { retries: 3, delayMs: 10, label: 'test-op' });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  test('kaster siste feil etter alle forsøk er brukt', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('permanent fail'));

    await expect(
      retry(fn, { retries: 2, delayMs: 10 })
    ).rejects.toThrow('permanent fail');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

// ============================================================
// D7: Request timeout
// ============================================================
describe('D7: Request timeout middleware', () => {
  test('timeout-middleware er registrert i server.js', () => {
    const serverCode = fs.readFileSync(
      path.resolve(__dirname, '..', 'server.js'), 'utf8'
    );
    expect(serverCode).toContain('REQUEST_TIMEOUT_MS');
    expect(serverCode).toContain('req.setTimeout');
    // PDF/upload er unntatt
    expect(serverCode).toContain('/pdf');
    expect(serverCode).toContain('/upload');
  });
});

// ============================================================
// D8: Fallback session store advarsel
// ============================================================
describe('D8: Fallback session store', () => {
  test('fallback-blokken logger advarsel om memory store', () => {
    const serverCode = fs.readFileSync(
      path.resolve(__dirname, '..', 'server.js'), 'utf8'
    );
    expect(serverCode).toContain('in-memory session store');
  });
});

// ============================================================
// D11: Email service lazy init
// ============================================================
describe('D11: Email service ensureInit()', () => {
  test('ensureInit() finnes som metode', () => {
    const emailService = require('../src/services/emailService');
    expect(typeof emailService.ensureInit).toBe('function');
  });

  test('ensureInit() kaller init() hvis transporter er null', async () => {
    const emailService = require('../src/services/emailService');
    emailService.transporter = null;

    // Mock init() for å unngå ekte SMTP-tilkobling
    const mockInit = jest.fn().mockResolvedValue();
    emailService.init = mockInit;

    await emailService.ensureInit();
    expect(mockInit).toHaveBeenCalledTimes(1);
  });

  test('ensureInit() skipper init() hvis transporter allerede finnes', async () => {
    const emailService = require('../src/services/emailService');
    emailService.transporter = { sendMail: jest.fn() }; // Allerede initialisert

    const mockInit = jest.fn();
    emailService.init = mockInit;

    await emailService.ensureInit();
    expect(mockInit).not.toHaveBeenCalled();
  });
});

// ============================================================
// D15: Dockerfile
// ============================================================
describe('D15: Dockerfile sikkerhet', () => {
  const dockerfile = fs.readFileSync(
    path.resolve(__dirname, '..', 'dockerfile'), 'utf8'
  );

  test('kjører som non-root bruker', () => {
    expect(dockerfile).toContain('USER node');
  });

  test('har HEALTHCHECK', () => {
    expect(dockerfile).toContain('HEALTHCHECK');
    expect(dockerfile).toContain('/health');
  });

  test('installerer curl for health check', () => {
    expect(dockerfile).toContain('curl');
  });
});
