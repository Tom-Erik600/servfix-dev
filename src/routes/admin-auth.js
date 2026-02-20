const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../config/database');

const router = express.Router();

// Admin login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    console.log('🔐 Admin login attempt:', username);
    
    // Admin bruker alltid servfix_admin database
    const pool = await db.getPool('servfix_admin');
    
    // Username kan være email
    const result = await pool.query(
      'SELECT * FROM admin_users WHERE email = $1',
      [username]
    );

    if (result.rows.length === 0) {
      console.log('❌ Admin not found:', username);
      return res.status(401).json({ error: 'Ugyldig brukernavn eller passord' });
    }
    
    const admin = result.rows[0];
    console.log('👤 Admin found:', { email: admin.email, tenant_id: admin.tenant_id });
    
    const validPassword = await bcrypt.compare(password, admin.password_hash);

    if (!validPassword) {
      console.log('❌ Invalid password for:', username);
      return res.status(401).json({ error: 'Ugyldig brukernavn eller passord' });
    }

    // S5: Valider at admin sin tenant matcher subdomainet de logger inn fra
    if (admin.tenant_id) {
      const host = req.get('host') || '';
      const subdomain = host.split('.')[0];
      // Kun valider for produksjons-domener (ikke localhost/IP)
      const isProductionHost = !host.startsWith('localhost') && !host.match(/^\d{1,3}\.\d{1,3}/);
      if (isProductionHost && subdomain && subdomain !== admin.tenant_id) {
        console.warn(`🔒 Admin login DENIED: ${admin.email} (tenant: ${admin.tenant_id}) tried to login from subdomain '${subdomain}'`);
        return res.status(403).json({ error: 'Ikke tilgang fra dette domenet' });
      }
    }

    // S4: Regenerer session-ID for å forhindre session fixation
    req.session.regenerate((regenErr) => {
      if (regenErr) {
        console.error('❌ Session regenerate error:', regenErr);
        return res.status(500).json({ error: 'Server error' });
      }

      // Lagre admin session med tenant fra database
      req.session.isAdmin = true;
      req.session.adminId = admin.id;
      req.session.adminEmail = admin.email;

      // Sett tenant fra database hvis kolonnen eksisterer
      if (admin.tenant_id) {
        req.session.selectedTenantId = admin.tenant_id;
        req.session.tenantId = admin.tenant_id;
        console.log('🏢 Setting tenant in session:', {
          tenant_id: admin.tenant_id,
          sessionId: req.sessionID?.substring(0, 10)
        });
      } else {
        console.warn('⚠️ NO tenant_id in database for admin:', admin.email);
      }

      // KRITISK: Lagre session eksplisitt før response
      req.session.save((err) => {
        if (err) {
          console.error('❌ Session save error:', err);
          return res.status(500).json({ error: 'Session save failed' });
        }

        console.log('✅ Admin session saved successfully:', {
          tenant_id: admin.tenant_id,
          selectedTenantId: req.session.selectedTenantId,
          sessionTenantId: req.session.tenantId
        });

        res.json({
          success: true,
          admin: {
            id: admin.id,
            email: admin.email,
            name: admin.name,
            tenantId: admin.tenant_id
          }
        });
      });
    });

  } catch (error) {
    console.error('❌ Admin login error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get current admin
router.get('/me', (req, res) => {
  console.log('🔍 GET /me - Session check:', {
    isAdmin: req.session.isAdmin,
    tenantId: req.session.tenantId,
    selectedTenantId: req.session.selectedTenantId
  });
  
  if (!req.session.isAdmin) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  res.json({
    admin: {
      id: req.session.adminId,
      email: req.session.adminEmail,
      tenantId: req.session.selectedTenantId || req.session.tenantId
    }
  });
});

// Logout
router.post('/logout', (req, res) => {
  const adminEmail = req.session.adminEmail;
  console.log('👋 Admin logout:', {
    email: adminEmail,
    hostname: req.hostname,      // ✅ Hva er denne?
    cookieDomain: req.session.cookie?.domain  // Hva ble satt ved login?
  });
  
  req.session.destroy((err) => {
    if (err) {
      console.error('❌ Logout error:', err);
      return res.status(500).json({ error: 'Logout failed' });
    }
    
    res.clearCookie('admin.sid', {
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      domain: req.hostname
    });
    
    console.log('✅ Cookie cleared for domain:', req.hostname);
    res.json({ success: true });
  });
});

module.exports = router;
