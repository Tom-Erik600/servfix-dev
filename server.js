const express = require('express');
const session = require('express-session');
const path = require('path');
const cors = require('cors');
require('dotenv').config();

// D2: Global feilhåndtering — fang ubehandlede feil før de krasjer prosessen
process.on('unhandledRejection', (reason, promise) => {
  console.error('⚠️ Unhandled Promise Rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('🚨 Uncaught Exception:', err);
  // Gi tid til å logge, deretter avslutt
  setTimeout(() => process.exit(1), 1000);
});

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 8080;

// Logging for debugging
console.log('=== SERVER STARTUP ===');
console.log('Environment:', process.env.NODE_ENV);
console.log('Port:', PORT);
console.log('DB_NAME:', process.env.DB_NAME);
console.log('Cloud SQL:', process.env.CLOUD_SQL_CONNECTION_NAME);

// 🔒 Security: Require SESSION_SECRET in all environments
if (!process.env.SESSION_SECRET) {
  console.error('🚨 FATAL: SESSION_SECRET environment variable is required.');
  console.error('   Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  process.exit(1);
}

// 🔒 Security configuration check
console.log('=== SECURITY STATUS ===');
console.log('Environment:', process.env.NODE_ENV || 'development');
console.log('Debug endpoints:', process.env.NODE_ENV !== 'production' ? '⚠️  ENABLED' : '✅ DISABLED');
console.log('Session secret: ✅ SET');
console.log('Trust proxy:', process.env.NODE_ENV === 'production' ? '✅ ENABLED' : '⚠️  DISABLED');

if (process.env.NODE_ENV === 'production') {
  if (!process.env.CLOUD_SQL_CONNECTION_NAME) {
    console.warn('⚠️  WARNING: CLOUD_SQL_CONNECTION_NAME not set in production');
  }
}
console.log('=====================');

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static files — FØR session-middleware slik at JS/CSS/bilder
// aldri trenger DB-tilkobling (beskytter mot 500 ved DB-problemer)
app.use(express.static(path.join(__dirname, 'public')));

// D7: Request timeout — avbryt forespørsler som henger for lenge
const REQUEST_TIMEOUT_MS = parseInt(process.env.REQUEST_TIMEOUT_MS) || 30000;
app.use((req, res, next) => {
  // Ikke timeout på PDF-generering, filopplasting og kundeimport (kan ta lang tid)
  if (req.path.includes('/pdf') || req.path.includes('/upload') || req.path.includes('/import') || req.path.includes('/complete')) {
    return next();
  }
  req.setTimeout(REQUEST_TIMEOUT_MS, () => {
    if (!res.headersSent) {
      res.status(408).json({ error: 'Request timed out' });
    }
  });
  next();
});

// CORS konfigurasjon - multitenant
app.use(cors({
  origin: (origin, callback) => {
    // Tillat requests uten origin (same-origin, Postman, curl, etc)
    if (!origin) return callback(null, true);
    // Tillat localhost for utvikling
    if (origin.startsWith('http://localhost')) return callback(null, true);
    // Tillat alle *.servfix.no subdomener (alle tenants)
    if (origin.endsWith('.servfix.no') || origin === 'https://servfix.no') {
      return callback(null, true);
    }
    // Tillat Cloud Run URLs
    if (origin.endsWith('.run.app')) {
      return callback(null, true);
    }
    // Tillat custom domener fra ALLOWED_ORIGINS env (kommaseparert liste)
    const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map(o => o.trim()).filter(Boolean);
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    console.warn(`⚠️ CORS blocked origin: ${origin}`);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));

// Trust proxy for Cloud Run
if (process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging') {
  app.set('trust proxy', true);
}

// Session konfigurasjon - Forenklet for å unngå problemer
async function setupSession() {
  try {
    const pgSession = require('connect-pg-simple')(session);
    const db = require('./src/config/database');
    
    // Hent pool fra database.js (som allerede har riktig Cloud SQL config!)
    const pool = await db.getPool('servfix_admin');
    
    // Test connection
    await pool.query('SELECT 1');
    console.log('✅ Database connected for sessions via database.js');

    // Separate sessions for admin og tekniker slik at begge kan være
    // innlogget samtidig i samme nettleser (ulike cookie-navn).
    const makeSessionOpts = (cookieName) => ({
      store: new pgSession({
        pool: pool,
        tableName: 'session',
        createTableIfMissing: true
      }),
      name: cookieName,
      secret: process.env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      proxy: true,
      cookie: {
        secure: !!process.env.CLOUD_SQL_CONNECTION_NAME, // Secure i cloud
        httpOnly: true,
        maxAge: 30 * 24 * 60 * 60 * 1000,
        sameSite: 'lax'
      }
    });

    const adminSession = session(makeSessionOpts('admin.sid'));
    const techSession = session(makeSessionOpts('tech.sid'));

    function isAdminRequestContext(req) {
      if (req.get('x-servfix-app') === 'admin') {
        return true;
      }

      if (req.path.startsWith('/api/admin/') || req.path === '/api/admin') {
        return true;
      }

      const referer = req.get('referer');
      if (!referer) {
        return false;
      }

      try {
        const refererPath = new URL(referer).pathname || '';
        return refererPath.startsWith('/admin');
      } catch (_) {
        return false;
      }
    }

    // Én middleware som velger riktig session basert på request-kontekst.
    // Viktig: admin.sid-cookie alene skal IKKE gjøre vanlige /api-kall til admin-kall,
    // ellers kan tekniker bli "utlogget" når admin logger inn i samme nettleser.
    app.use((req, res, next) => {
      const mw = isAdminRequestContext(req) ? adminSession : techSession;
      mw(req, res, next);
    });

    console.log('✅ Session store configured (admin.sid + tech.sid)');
    
  } catch (error) {
    console.error('❌ Session setup failed:', error);
    // D8: Fallback til memory store med tydelig advarsel
    console.warn('⚠️  ADVARSEL: Bruker in-memory session store! Sessions overlever IKKE restart.');
    const makeFallbackOpts = (cookieName) => ({
      name: cookieName,
      secret: process.env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: !!process.env.CLOUD_SQL_CONNECTION_NAME,
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000,
        sameSite: 'lax'
      }
    });

    const adminSessionFallback = session(makeFallbackOpts('admin.sid'));
    const techSessionFallback = session(makeFallbackOpts('tech.sid'));

    function isAdminRequestContext(req) {
      if (req.get('x-servfix-app') === 'admin') {
        return true;
      }

      if (req.path.startsWith('/api/admin/') || req.path === '/api/admin') {
        return true;
      }

      const referer = req.get('referer');
      if (!referer) {
        return false;
      }

      try {
        const refererPath = new URL(referer).pathname || '';
        return refererPath.startsWith('/admin');
      } catch (_) {
        return false;
      }
    }

    app.use((req, res, next) => {
      const mw = isAdminRequestContext(req) ? adminSessionFallback : techSessionFallback;
      mw(req, res, next);
    });
  }
}

// Setup session
setupSession().then(() => {
  // Tenant middleware
  app.use((req, res, next) => {
    // Skip for static files og health check
    if (req.path.startsWith('/assets') ||
        req.path.startsWith('/app/assets') ||
        req.path.startsWith('/admin/assets') ||
        req.path === '/health' ||
        req.path === '/') {
      return next();
    }

    // Skip for ALL static files (js, css, html, images)
    const staticExtensions = ['.js', '.css', '.html', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.woff', '.woff2', '.ttf', '.eot'];
    if (staticExtensions.some(ext => req.path.toLowerCase().endsWith(ext))) {
      return next();
    }

    // For API routes (ikke admin), resolve tenant
    if (req.path.startsWith('/api') && !req.path.startsWith('/api/admin')) {
      // 1. Prioriter session hvis den finnes (autentisert bruker)
      if (req.session?.tenantId) {
        req.tenantId = req.session.tenantId;
      } else {
        // 2. Resolve fra subdomain eller header — ingen hardkodet fallback
        const host = req.get('host');
        let tenantId = null;

        if (host.startsWith('localhost') || host.match(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/)) {
          // Localhost/dev: bruk x-tenant-id header eller DEFAULT_TENANT_ID fra env
          tenantId = req.headers['x-tenant-id'] || process.env.DEFAULT_TENANT_ID || null;
        } else {
          // Production: bruk subdomain
          const subdomain = host.split('.')[0];
          if (subdomain && subdomain !== 'www') {
            tenantId = subdomain;
          } else {
            tenantId = req.headers['x-tenant-id'] || null;
          }
        }

        // Sett req.tenantId (for pre-auth routes som /api/auth/login)
        // Kan være null for uautentiserte requests — routes som trenger tenant
        // vil feile trygt når getTenantConnection() kalles uten gyldig tenantId.
        req.tenantId = tenantId;

        // VIKTIG: Ikke auto-populer req.session.tenantId!
        // Session skal kun settes ved eksplisitt login i /api/auth/login
      }
    }

    next();
  });

  // D5: Health check som faktisk verifiserer avhengigheter
  app.get('/health', async (req, res) => {
    const checks = { db: 'unknown' };
    let healthy = true;

    // Sjekk DB
    try {
      const db = require('./src/config/database');
      const pool = await db.getPool('servfix_admin');
      await pool.query('SELECT 1');
      checks.db = 'ok';
    } catch (err) {
      checks.db = 'error';
      healthy = false;
    }

    const status = healthy ? 'healthy' : 'degraded';
    res.status(healthy ? 200 : 503).json({
      status,
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV,
      checks
    });
  });

  // Test endpoint
  app.get('/api/test', (req, res) => {
    res.json({
      message: 'API fungerer!',
      session: {
        id: req.sessionID,
        tenantId: req.session?.tenantId,
        technicianId: req.session?.technicianId
      }
    });
  });

  // API Routes med error handling
  console.log('Loading admin routes...');
  const loadRoutes = () => {
    try {
      // Tekniker app routes
      app.use('/api/auth', require('./src/routes/auth'));
      app.use('/api/dashboard-v2', require('./src/routes/dashboard-v2'));
      app.use('/api/orders', require('./src/routes/orders'));
      app.use('/api/equipment', require('./src/routes/equipment'));
      app.use('/api/reports', require('./src/routes/reports'));
      app.use('/api/images', require('./src/routes/images'));
      app.use('/api/customers', require('./src/routes/customers'));
      app.use('/api/technicians', require('./src/routes/technicians'));
      app.use('/api/checklist-templates', require('./src/routes/checklist-templates'));
      app.use('/api/checklist-instructions', require('./src/routes/checklist-instructions'));
      app.use('/api/quotes', require('./src/routes/quotes'));
      app.use('/api/hms', require('./src/routes/hms'));
      app.use('/api/tenant', require('./src/routes/tenant'));
      //app.use('/api/products', require('./src/routes/products'));
      //app.use('/api/print', require('./src/routes/print'));
      
      // Admin routes
      app.use('/api/admin/auth', require('./src/routes/admin-auth'));
      app.use('/api/admin/orders', require('./src/routes/admin/orders'));
      app.use('/api/admin/customers', require('./src/routes/admin/customers'));
      app.use('/api/admin/technicians', require('./src/routes/admin/technicians'));
      //app.use('/api/admin/products', require('./src/routes/admin/products'));
      app.use('/api/admin/checklist-templates', require('./src/routes/checklist-templates'));
      app.use('/api/admin/reports', require('./src/routes/admin/reports'));
      app.use('/api/admin/equipment', require('./src/routes/admin/equipment'));
      app.use('/api/admin/clusters', require('./src/routes/admin/clusters'));
      app.use('/api/admin/projects', require('./src/routes/admin/projects'));
      // Tripletex routes hvis tilgjengelig
      try {
        app.use('/api/tripletex', require('./src/routes/tripletex'));
        console.log('✅ Tripletex routes loaded');
      } catch (e) {
        console.log('⚠️ Tripletex routes not available');
      }
      
      console.log('✅ All API routes loaded successfully');
    } catch (error) {
      console.error('❌ Error loading routes:', error);
      
      // Fallback routes hvis loading feiler
      app.use('/api/*', (req, res) => {
        res.status(500).json({ 
          error: 'Route loading failed',
          message: 'Please check server logs'
        });
      });
    }
  };
  
  loadRoutes();

  // Serve app for specific routes
  app.get('/app/*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'app', 'index.html'));
  });

  // Serve admin for admin routes
  app.get('/admin/*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html'));
  });

  // Default route - redirect til app
  app.get('/', (req, res) => {
    res.redirect('/app/');
  });

  // 404 handler
  app.use((req, res) => {
    console.log(`404 - Not found: ${req.method} ${req.path}`);
    res.status(404).json({ 
      error: 'Not found',
      path: req.path,
      method: req.method
    });
  });

  // Global error handler
  app.use((err, req, res, next) => {
    // 🔒 SECURITY: Log error server-side, but sanitize client response
    console.error('Server error:', err);
    
    // Log stack trace only in non-production
    if (process.env.NODE_ENV !== 'production') {
      console.error('Stack:', err.stack);
    }
    
    // Determine what to send to client
    const isProd = process.env.NODE_ENV === 'production';
    const statusCode = err.status || 500;
    
    // Generic message in production
    const clientMessage = isProd ? 'Internal server error' : err.message;
    
    // Response object
    const response = { 
      error: clientMessage,
      statusCode: statusCode
    };
    
    // Add details only in non-production
    if (!isProd) {
      response.details = err.message;
      response.stack = err.stack;
      response.timestamp = new Date().toISOString();
    }
    
    res.status(statusCode).json(response);
  });

  // Start server — lagre referanse for graceful shutdown
  const server = app.listen(PORT, () => {
    console.log('=== SERVER RUNNING ===');
    console.log(`✅ Port: ${PORT}`);
    console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🏢 Tenant: ${process.env.DEFAULT_TENANT_ID || 'airtech'}`);
    if (process.env.CLOUD_SQL_CONNECTION_NAME) {
      console.log(`☁️ Cloud SQL: Connected`);
    }
    console.log('===================');
  });

  // D1+D3: Graceful shutdown ved SIGTERM/SIGINT
  let isShuttingDown = false;
  async function gracefulShutdown(signal) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`\n🛑 ${signal} mottatt — starter graceful shutdown...`);

    // 1. Slutt å ta imot nye forespørsler
    server.close(() => {
      console.log('  ✅ HTTP-server lukket');
    });

    // 2. Drain DB-tilkoblinger
    try {
      const db = require('./src/config/database');
      await db.closeAll();
    } catch (_) {}

    console.log('👋 Shutdown fullført');
    process.exit(0);
  }

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

}).catch(error => {
  console.error('❌ Failed to start server:', error);
  process.exit(1);
});

// 🔒 SECURITY: Test endpoints only available in non-production environments
if (process.env.NODE_ENV !== 'production') {
  app.get('/api/test-admin', async (req, res) => {
    try {
      const db = require('./src/config/database');
      const pool = await db.getPool('servfix_admin');
      const result = await pool.query('SELECT COUNT(*) as count FROM admin_users');
      res.json({ 
        success: true, 
        adminUserCount: result.rows[0].count,
        dbConnection: 'OK',
        environment: process.env.NODE_ENV || 'development'
      });
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        error: error.message,
        dbConnection: 'FAILED'
      });
    }
  });
  
  console.log('⚠️  DEBUG ENDPOINTS ENABLED (non-production environment)');
} else {
  // In production, return 404 for test endpoints
  app.get('/api/test-*', (req, res) => {
    console.warn(`🚨 Attempted access to test endpoint in production: ${req.path}`);
    res.status(404).json({ error: 'Not found' });
  });
}
