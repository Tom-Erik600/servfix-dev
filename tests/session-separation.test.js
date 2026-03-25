/**
 * Test: Session-separasjon mellom admin og tekniker
 *
 * Verifiserer at admin og tech bruker separate session-cookies
 * slik at innlogging på én side ikke ødelegger den andres session.
 *
 * Kjør: npx jest tests/session-separation.test.js
 *
 * Trenger IKKE database — bygger en minimal Express-app med
 * samme dual-session-oppsett som server.js (memory store).
 */

const express = require('express');
const session = require('express-session');
const request = require('supertest');

function createTestApp() {
  const app = express();
  app.use(express.json());

  // Samme dual-session-oppsett som server.js (memory store)
  const makeSessionOpts = (cookieName) => ({
    name: cookieName,
    secret: 'test-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, httpOnly: true, sameSite: 'lax' }
  });

  const adminSession = session(makeSessionOpts('admin.sid'));
  const techSession = session(makeSessionOpts('tech.sid'));

  app.use((req, res, next) => {
    const isAdminRoute = req.path.startsWith('/api/admin') || req.path === '/api/admin';
    const referer = req.get('referer');
    const explicitAdminContext = req.get('x-servfix-app') === 'admin';

    let isAdminContext = explicitAdminContext || isAdminRoute;
    if (!isAdminContext && referer) {
      try {
        isAdminContext = new URL(referer, 'http://localhost').pathname.startsWith('/admin');
      } catch (_) {
        isAdminContext = false;
      }
    }

    const mw = isAdminContext ? adminSession : techSession;
    mw(req, res, next);
  });

  // Simulert tech-login
  app.post('/api/auth/login', (req, res) => {
    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ error: 'regenerate failed' });
      req.session.technicianId = 'tech-1';
      req.session.tenantId = 'test-tenant';
      req.session.save((saveErr) => {
        if (saveErr) return res.status(500).json({ error: 'save failed' });
        res.json({ success: true, role: 'technician' });
      });
    });
  });

  // Simulert tech /me
  app.get('/api/auth/me', (req, res) => {
    if (!req.session.technicianId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    res.json({ technicianId: req.session.technicianId, tenantId: req.session.tenantId });
  });

  // Simulert admin-login
  app.post('/api/admin/auth/login', (req, res) => {
    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ error: 'regenerate failed' });
      req.session.isAdmin = true;
      req.session.adminId = 'admin-1';
      req.session.tenantId = 'test-tenant';
      req.session.save((saveErr) => {
        if (saveErr) return res.status(500).json({ error: 'save failed' });
        res.json({ success: true, role: 'admin' });
      });
    });
  });

  // Simulert admin /me
  app.get('/api/admin/auth/me', (req, res) => {
    if (!req.session.isAdmin) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    res.json({ adminId: req.session.adminId, tenantId: req.session.tenantId });
  });

  return app;
}

// Hjelpefunksjon: hent cookies fra Set-Cookie header
function extractCookies(res) {
  const raw = res.headers['set-cookie'] || [];
  const cookies = {};
  for (const c of raw) {
    const [nameVal] = c.split(';');
    const [name, ...rest] = nameVal.split('=');
    cookies[name.trim()] = rest.join('=');
  }
  return cookies;
}

// Hjelpefunksjon: bygg Cookie-header fra lagrede cookies
function cookieHeader(cookies) {
  return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
}

describe('Session-separasjon: admin og tekniker', () => {
  let app;

  beforeAll(() => {
    app = createTestApp();
  });

  test('tech-login setter tech.sid cookie (ikke admin.sid)', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({});

    expect(res.status).toBe(200);
    const cookies = extractCookies(res);
    expect(cookies['tech.sid']).toBeDefined();
    expect(cookies['admin.sid']).toBeUndefined();
  });

  test('admin-login setter admin.sid cookie (ikke tech.sid)', async () => {
    const res = await request(app)
      .post('/api/admin/auth/login')
      .send({});

    expect(res.status).toBe(200);
    const cookies = extractCookies(res);
    expect(cookies['admin.sid']).toBeDefined();
    expect(cookies['tech.sid']).toBeUndefined();
  });

  test('admin-login ødelegger IKKE tech-session', async () => {
    const allCookies = {};

    // 1. Tech logger inn
    const techLogin = await request(app)
      .post('/api/auth/login')
      .send({});
    expect(techLogin.status).toBe(200);
    Object.assign(allCookies, extractCookies(techLogin));

    // 2. Verifiser tech er innlogget
    const techMe1 = await request(app)
      .get('/api/auth/me')
      .set('Cookie', cookieHeader(allCookies));
    expect(techMe1.status).toBe(200);
    expect(techMe1.body.technicianId).toBe('tech-1');

    // 3. Admin logger inn (med samme cookie-jar)
    const adminLogin = await request(app)
      .post('/api/admin/auth/login')
      .set('Cookie', cookieHeader(allCookies))
      .send({});
    expect(adminLogin.status).toBe(200);
    Object.assign(allCookies, extractCookies(adminLogin));

    // 4. Tech er FORTSATT innlogget
    const techMe2 = await request(app)
      .get('/api/auth/me')
      .set('Cookie', cookieHeader(allCookies));
    expect(techMe2.status).toBe(200);
    expect(techMe2.body.technicianId).toBe('tech-1');

    // 5. Admin er også innlogget
    const adminMe = await request(app)
      .get('/api/admin/auth/me')
      .set('Cookie', cookieHeader(allCookies));
    expect(adminMe.status).toBe(200);
    expect(adminMe.body.adminId).toBe('admin-1');
  });

  test('tech-login ødelegger IKKE admin-session', async () => {
    const allCookies = {};

    // 1. Admin logger inn først
    const adminLogin = await request(app)
      .post('/api/admin/auth/login')
      .send({});
    Object.assign(allCookies, extractCookies(adminLogin));

    // 2. Tech logger inn
    const techLogin = await request(app)
      .post('/api/auth/login')
      .set('Cookie', cookieHeader(allCookies))
      .send({});
    Object.assign(allCookies, extractCookies(techLogin));

    // 3. Admin er FORTSATT innlogget
    const adminMe = await request(app)
      .get('/api/admin/auth/me')
      .set('Cookie', cookieHeader(allCookies));
    expect(adminMe.status).toBe(200);
    expect(adminMe.body.adminId).toBe('admin-1');

    // 4. Tech er også innlogget
    const techMe = await request(app)
      .get('/api/auth/me')
      .set('Cookie', cookieHeader(allCookies));
    expect(techMe.status).toBe(200);
    expect(techMe.body.technicianId).toBe('tech-1');
  });

  test('admin-cookie kaprer IKKE tekniker-kall i samme nettleser', async () => {
    const allCookies = {};

    const techLogin = await request(app)
      .post('/api/auth/login')
      .send({});
    Object.assign(allCookies, extractCookies(techLogin));

    const adminLogin = await request(app)
      .post('/api/admin/auth/login')
      .set('Cookie', cookieHeader(allCookies))
      .set('Referer', 'http://localhost/admin/index.html')
      .send({});
    Object.assign(allCookies, extractCookies(adminLogin));

    const techMe = await request(app)
      .get('/api/auth/me')
      .set('Cookie', cookieHeader(allCookies))
      .set('Referer', 'http://localhost/app/orders.html');

    expect(techMe.status).toBe(200);
    expect(techMe.body.technicianId).toBe('tech-1');

    const adminMe = await request(app)
      .get('/api/admin/auth/me')
      .set('Cookie', cookieHeader(allCookies))
      .set('Referer', 'http://localhost/admin/index.html');

    expect(adminMe.status).toBe(200);
    expect(adminMe.body.adminId).toBe('admin-1');
  });

  test('admin-side kan bruke delt API med admin-session uten å påvirke tekniker-session', async () => {
    const allCookies = {};

    const techLogin = await request(app)
      .post('/api/auth/login')
      .send({});
    Object.assign(allCookies, extractCookies(techLogin));

    const adminLogin = await request(app)
      .post('/api/admin/auth/login')
      .set('Cookie', cookieHeader(allCookies))
      .set('Referer', 'http://localhost/admin/index.html')
      .send({});
    Object.assign(allCookies, extractCookies(adminLogin));

    app.get('/api/shared/me', (req, res) => {
      res.json({
        isAdmin: !!req.session.isAdmin,
        adminId: req.session.adminId || null,
        technicianId: req.session.technicianId || null
      });
    });

    const sharedFromAdmin = await request(app)
      .get('/api/shared/me')
      .set('Cookie', cookieHeader(allCookies))
      .set('Referer', 'http://localhost/admin/dashboard.html');

    expect(sharedFromAdmin.status).toBe(200);
    expect(sharedFromAdmin.body.isAdmin).toBe(true);
    expect(sharedFromAdmin.body.adminId).toBe('admin-1');
    expect(sharedFromAdmin.body.technicianId).toBeNull();

    const techMe = await request(app)
      .get('/api/auth/me')
      .set('Cookie', cookieHeader(allCookies))
      .set('Referer', 'http://localhost/app/orders.html');

    expect(techMe.status).toBe(200);
    expect(techMe.body.technicianId).toBe('tech-1');
  });

  test('eksplisitt admin-header velger admin-session for delt API', async () => {
    const allCookies = {};

    const techLogin = await request(app)
      .post('/api/auth/login')
      .send({});
    Object.assign(allCookies, extractCookies(techLogin));

    const adminLogin = await request(app)
      .post('/api/admin/auth/login')
      .set('Cookie', cookieHeader(allCookies))
      .send({});
    Object.assign(allCookies, extractCookies(adminLogin));

    app.get('/api/shared/me', (req, res) => {
      res.json({
        isAdmin: !!req.session.isAdmin,
        adminId: req.session.adminId || null,
        technicianId: req.session.technicianId || null
      });
    });

    const sharedFromAdmin = await request(app)
      .get('/api/shared/me')
      .set('Cookie', cookieHeader(allCookies))
      .set('x-servfix-app', 'admin');

    expect(sharedFromAdmin.status).toBe(200);
    expect(sharedFromAdmin.body.isAdmin).toBe(true);
    expect(sharedFromAdmin.body.adminId).toBe('admin-1');
    expect(sharedFromAdmin.body.technicianId).toBeNull();
  });

  test('uten cookie gir 401 på begge /me-endepunkt', async () => {
    const techMe = await request(app).get('/api/auth/me');
    expect(techMe.status).toBe(401);

    const adminMe = await request(app).get('/api/admin/auth/me');
    expect(adminMe.status).toBe(401);
  });
});
