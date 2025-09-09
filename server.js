const express = require('express');
const session = require('express-session');
const path = require('path');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8080;

// Logging for debugging
console.log('=== SERVER STARTUP ===');
console.log('Environment:', process.env.NODE_ENV);
console.log('Port:', PORT);
console.log('DB_NAME:', process.env.DB_NAME);
console.log('Cloud SQL:', process.env.CLOUD_SQL_CONNECTION_NAME);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS konfigurasjon
app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? true : 'http://localhost:3000',
  credentials: true
}));

// Trust proxy for Cloud Run
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', true);
}

// Session konfigurasjon - Forenklet for å unngå problemer
async function setupSession() {
  try {
    if (process.env.NODE_ENV === 'production') {
      // Produksjon - Prøv PostgreSQL først, fallback til memory
      try {
        const pgSession = require('connect-pg-simple')(session);
        const { Pool } = require('pg');
        
        const pool = new Pool({
          user: process.env.DB_USER || 'postgres',
          password: process.env.DB_PASSWORD,
          database: 'servfix_admin',
          host: `/cloudsql/${process.env.CLOUD_SQL_CONNECTION_NAME}`,
          max: 2
        });

        // Test connection
        await pool.query('SELECT 1');
        console.log('✅ Database connected for sessions');

        app.use(session({
          store: new pgSession({
            pool: pool,
            tableName: 'session',
            createTableIfMissing: false
          }),
          secret: process.env.SESSION_SECRET || 'prod-secret-key',
          resave: false,
          saveUninitialized: false,
          cookie: {
            secure: true,
            httpOnly: true,
            maxAge: 30 * 24 * 60 * 60 * 1000,
            sameSite: 'lax'
          }
        }));
      } catch (dbError) {
        console.error('⚠️ Could not setup PostgreSQL sessions, using memory store:', dbError.message);
        // Fallback til memory store
        app.use(session({
          secret: process.env.SESSION_SECRET || 'prod-secret-key',
          resave: false,
          saveUninitialized: false,
          cookie: {
            secure: true,
            httpOnly: true,
            maxAge: 24 * 60 * 60 * 1000,
            sameSite: 'lax'
          }
        }));
      }
    } else {
      // Development - Bruk PostgreSQL
      const pgSession = require('connect-pg-simple')(session);
      const { Pool } = require('pg');
      
      const pool = new Pool({
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || 5432,
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME || 'servfix_admin'
      });

      app.use(session({
        store: new pgSession({
          pool: pool,
          tableName: 'session',
          createTableIfMissing: false,
          pruneSessionInterval: false
        }),
        secret: process.env.SESSION_SECRET || 'dev-secret-key',
        resave: false,
        saveUninitialized: false,
        cookie: {
          secure: false,
          httpOnly: true,
          maxAge: 30 * 24 * 60 * 60 * 1000
        }
      }));
    }
  } catch (error) {
    console.error('❌ Session setup failed:', error);
    // Ultimate fallback - memory store
    app.use(session({
      secret: process.env.SESSION_SECRET || 'fallback-secret',
      resave: false,
      saveUninitialized: false
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
    console.error('Server error:', err);
    console.error('Stack:', err.stack);
    
    // Ikke eksponer sensitive detaljer i produksjon
    const message = process.env.NODE_ENV === 'production' 
      ? 'Internal server error' 
      : err.message;
    
    res.status(err.status || 500).json({ 
      error: message,
      ...(process.env.NODE_ENV !== 'production' && { 
        details: err.message,
        stack: err.stack 
      })
    });
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