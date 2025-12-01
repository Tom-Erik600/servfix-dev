const express = require('express');
const session = require('express-session');
const path = require('path');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 8080;

// Logging for debugging
console.log('=== SERVER STARTUP ===');
console.log('Environment:', process.env.NODE_ENV);
console.log('Port:', PORT);
console.log('DB_NAME:', process.env.DB_NAME);
console.log('Cloud SQL:', process.env.CLOUD_SQL_CONNECTION_NAME);

// 🔒 Security configuration check
console.log('=== SECURITY STATUS ===');
console.log('Environment:', process.env.NODE_ENV || 'development');
console.log('Debug endpoints:', process.env.NODE_ENV !== 'production' ? '⚠️  ENABLED' : '✅ DISABLED');
console.log('Session secret:', process.env.SESSION_SECRET ? '✅ SET' : '❌ MISSING');
console.log('Trust proxy:', process.env.NODE_ENV === 'production' ? '✅ ENABLED' : '⚠️  DISABLED');

// Warn if running in production without proper security
if (process.env.NODE_ENV === 'production') {
  if (!process.env.SESSION_SECRET) {
    console.error('🚨 CRITICAL: SESSION_SECRET not set in production!');
  }
  if (!process.env.CLOUD_SQL_CONNECTION_NAME) {
    console.warn('⚠️  WARNING: CLOUD_SQL_CONNECTION_NAME not set in production');
  }
}
console.log('=====================');

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

    app.use(session({
      store: new pgSession({
        pool: pool,
        tableName: 'session',
        createTableIfMissing: true
      }),
      secret: process.env.SESSION_SECRET || 'secret-key',
      resave: false,
      saveUninitialized: false,
      proxy: true,
      cookie: {
        secure: !!process.env.CLOUD_SQL_CONNECTION_NAME, // Secure i cloud
        httpOnly: true,
        maxAge: 30 * 24 * 60 * 60 * 1000,
        sameSite: 'lax'
      }
    }));
    
    console.log('✅ Session store configured');
    
  } catch (error) {
    console.error('❌ Session setup failed:', error);
    // Fallback til memory store
    app.use(session({
      secret: process.env.SESSION_SECRET || 'fallback-secret',
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: false,
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000
      }
    }));
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
    
    // For API routes (ikke admin), sett default tenantId
    if (req.path.startsWith('/api') && !req.path.startsWith('/api/admin')) {
      if (!req.session.tenantId) {
        req.session.tenantId = process.env.DEFAULT_TENANT_ID || 'airtech';
      }
      req.tenantId = req.session.tenantId;
    }
    
    next();
  });

  // Static files
  app.use(express.static(path.join(__dirname, 'public')));

  // Health check - VIKTIG for Cloud Run
  app.get('/health', (req, res) => {
    res.status(200).json({ 
      status: 'healthy',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV,
      hasDbPassword: !!process.env.DB_PASSWORD,
      hasSessionSecret: !!process.env.SESSION_SECRET,
      tenant: process.env.DEFAULT_TENANT_ID
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
      app.use('/api/orders', require('./src/routes/orders'));
      app.use('/api/equipment', require('./src/routes/equipment'));
      app.use('/api/reports', require('./src/routes/reports'));
      app.use('/api/images', require('./src/routes/images'));
      app.use('/api/customers', require('./src/routes/customers'));
      app.use('/api/technicians', require('./src/routes/technicians'));
      app.use('/api/checklist-templates', require('./src/routes/checklist-templates'));
      app.use('/api/checklist-instructions', require('./src/routes/checklist-instructions'));
      app.use('/api/quotes', require('./src/routes/quotes'));
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

  // Start server
  app.listen(PORT, () => {
    console.log('=== SERVER RUNNING ===');
    console.log(`✅ Port: ${PORT}`);
    console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🏢 Tenant: ${process.env.DEFAULT_TENANT_ID || 'airtech'}`);
    if (process.env.CLOUD_SQL_CONNECTION_NAME) {
      console.log(`☁️ Cloud SQL: Connected`);
    }
    console.log('===================');
  });

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
