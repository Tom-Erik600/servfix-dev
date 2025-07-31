const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const cors = require('cors');
const db = require('./config/database');
const path = require('path'); // Added path module

module.exports = async () => {
  const app = express();

  // Middleware
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(cors());

  // Sessions - now correctly awaited and applied
  const adminPool = await db.getPool('servfix_admin');
  app.use(session({
    store: new pgSession({
      pool: adminPool,
      tableName: 'session'
    }),
    secret: process.env.SESSION_SECRET,
    resave: true,
    saveUninitialized: true,
    cookie: {
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 dager
      secure: process.env.NODE_ENV === 'production' ? true : false,
      httpOnly: true,
      sameSite: 'Lax'
    }
  }));

  // Tenant middleware
  app.use(async (req, res, next) => {
    const host = req.get('host');
    let tenantId = 'airtech'; // Default tenant

    // If running on localhost or an IP, default to 'airtech' unless x-tenant-id is provided
    if (host.startsWith('localhost') || host.match(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/)) {
      tenantId = req.headers['x-tenant-id'] || 'airtech';
    } else {
      // For production, derive from subdomain
      const subdomain = host.split('.')[0];
      if (subdomain && subdomain !== 'www') {
        tenantId = subdomain;
      } else {
        // Fallback for cases like www.example.com without subdomain
        tenantId = req.headers['x-tenant-id'] || 'airtech';
      }
    }
    req.tenantId = tenantId;
    next();
  });

  // Routes
  console.log('Registering routes...');
  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/orders', require('./routes/orders'));
  app.use('/api/equipment', (req, res, next) => {
    console.log('Equipment route hit:', req.method, req.url);
    next();
  }, require('./routes/equipment'));
  app.use('/api/customers', require('./routes/customers'));
  app.use('/api/reports', require('./routes/reports'));
  app.use('/api/servicereports', require('./routes/reports')); // Alias for frontend kompatibilitet
  app.use('/api/technicians', require('./routes/technicians'));
  app.use('/api/checklist-templates', require('./routes/checklist-templates'));
  app.use('/api/images', require('./routes/images'));

  // Error handling
  app.use((error, req, res, next) => {
    console.error(error);
    res.status(500).json({ error: error.message });
  });

  // Static files
  app.use(express.static('public/app'));

  // Serve admin static files
  app.use('/admin', express.static('public/admin'));

  // Håndter rot-URL
  app.get('/', (req, res) => {
    res.redirect('/login.html');
  });

  // Admin authentication routes (login/logout)
  app.use('/api/admin/auth', require('./routes/admin-auth'));

  // Other admin API routes, now protected by their own middleware
  app.use('/api/admin/customers', require('./routes/admin/customers'));
  app.use('/api/admin/technicians', require('./routes/admin/technicians'));
  app.use('/api/admin/orders', require('./routes/admin/orders'));
  app.use('/api/admin/reports', require('./routes/admin/reports'));

  // Middleware to protect admin static files
  app.use('/admin', (req, res, next) => {
    if (req.path.includes('login') || req.path.includes('assets')) {
      return next();
    }
    if (!req.session.isAdmin) {
      return res.redirect('/admin/login.html');
    }
    next();
  });

  return app;
};