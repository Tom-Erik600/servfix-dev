'use strict';

/**
 * Admin route: Tripletex integration config management.
 * Fase 1a scope — tripletex only. Email provider added in Fase 1b.
 *
 * Routes:
 *   GET  /admin/integrations                   — list all tenant integrations
 *   POST /admin/integrations/:tenantId/tripletex       — save/update tripletex config
 *   POST /admin/integrations/:tenantId/tripletex/test  — test connection (no persist)
 */

const express = require('express');
const router = express.Router();
const db = require('../../config/database');
const { invalidate } = require('../../services/integrations/registry');
const { withClient } = require('../../services/integrations/tripletex/provider');
const { createSession, buildClient } = require('../../services/integrations/tripletex/apiClient');

// ── Auth: super-admin only (no tenant binding required here) ──────────────
router.use((req, res, next) => {
  if (!req.session?.isAdmin) {
    return res.status(401).json({ error: 'Admin authentication required' });
  }
  // Super-admin check: if session has a bound tenantId, restrict to that tenant only
  // (regular tenant admins can only manage their own tenant's integrations)
  next();
});

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Validate tripletex config fields.
 * Returns { valid: true } or { valid: false, errors: string[] }
 */
function validateTripletexConfig(config) {
  const errors = [];
  if (!config || typeof config !== 'object') return { valid: false, errors: ['config mangler'] };
  if (!config.consumer_token || typeof config.consumer_token !== 'string' || !config.consumer_token.trim()) {
    errors.push('consumer_token er påkrevd');
  }
  if (!config.employee_token || typeof config.employee_token !== 'string' || !config.employee_token.trim()) {
    errors.push('employee_token er påkrevd');
  }
  if (config.base_url && typeof config.base_url !== 'string') {
    errors.push('base_url må være en streng');
  }
  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

// ── GET /admin/integrations ───────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const pool = db.getPool('servfix_admin');

    // Get all tenants + their integrations in one query
    const { rows: tenants } = await pool.query(
      `SELECT id, database_name, is_active FROM tenants WHERE is_active = true ORDER BY id`
    );

    const { rows: integrations } = await pool.query(
      `SELECT tenant_id, provider, is_active, config_version, last_sync_at, sync_status, sync_error, updated_at
       FROM tenant_integrations
       ORDER BY tenant_id, provider`
    );

    // Mask sensitive fields from config before sending to client
    const intMap = new Map();
    for (const row of integrations) {
      if (!intMap.has(row.tenant_id)) intMap.set(row.tenant_id, []);
      intMap.get(row.tenant_id).push({
        provider: row.provider,
        is_active: row.is_active,
        config_version: row.config_version,
        last_sync_at: row.last_sync_at,
        sync_status: row.sync_status,
        sync_error: row.sync_error,
        updated_at: row.updated_at,
        has_credentials: true, // never expose actual tokens to UI
      });
    }

    const result = tenants.map((t) => ({
      tenant_id: t.id,
      database_name: t.database_name,
      integrations: intMap.get(t.id) || [],
    }));

    res.json(result);
  } catch (err) {
    console.error('[admin/integrations] GET / error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /admin/integrations/:tenantId/tripletex ──────────────────────────
router.post('/:tenantId/tripletex', async (req, res) => {
  const { tenantId } = req.params;
  const { consumer_token, employee_token, base_url } = req.body || {};

  // Tenant admins may only manage their own tenant
  if (req.session.tenantId && req.session.tenantId !== tenantId) {
    return res.status(403).json({ error: 'Ikke tilgang til denne tenanten' });
  }

  const config = {
    consumer_token: (consumer_token || '').trim(),
    employee_token: (employee_token || '').trim(),
    base_url: (base_url || 'https://tripletex.no/v2').trim(),
  };

  const validation = validateTripletexConfig(config);
  if (!validation.valid) {
    return res.status(400).json({ error: 'Ugyldig konfigurasjon', details: validation.errors });
  }

  try {
    const pool = db.getPool('servfix_admin');

    await pool.query(
      `INSERT INTO tenant_integrations (tenant_id, provider, is_active, config)
       VALUES ($1, 'tripletex', true, $2::jsonb)
       ON CONFLICT (tenant_id, provider) DO UPDATE SET
         config    = EXCLUDED.config,
         is_active = true`,
      [tenantId, JSON.stringify(config)]
    );

    // Invalidate registry cache so next request picks up new config immediately
    invalidate(tenantId, 'tripletex');

    console.log(`[admin/integrations] Tripletex config saved for tenant=${tenantId}`);
    res.json({ success: true });
  } catch (err) {
    console.error('[admin/integrations] POST tripletex error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /admin/integrations/:tenantId/tripletex/test ────────────────────
router.post('/:tenantId/tripletex/test', async (req, res) => {
  const { tenantId } = req.params;
  const { consumer_token, employee_token, base_url } = req.body || {};

  if (req.session.tenantId && req.session.tenantId !== tenantId) {
    return res.status(403).json({ error: 'Ikke tilgang til denne tenanten' });
  }

  const config = {
    consumer_token: (consumer_token || '').trim(),
    employee_token: (employee_token || '').trim(),
    base_url: (base_url || 'https://tripletex.no/v2').trim(),
  };

  const validation = validateTripletexConfig(config);
  if (!validation.valid) {
    return res.status(400).json({ ok: false, error: 'Ugyldig konfigurasjon', details: validation.errors });
  }

  try {
    // Create a fresh session directly (not via registry — this is a test of NEW credentials)
    const session = await createSession(config);
    const client = buildClient(config, session.token);

    // Minimal smoke-test: fetch 1 customer to confirm auth + connectivity
    await client.get('/customer', { params: { from: 0, count: 1 } });

    res.json({ ok: true, message: 'Tilkobling vellykket' });
  } catch (err) {
    const status = err.response?.status;
    const detail = err.response?.data?.message || err.message;
    console.warn(`[admin/integrations] Tripletex test failed for tenant=${tenantId}: ${detail}`);
    res.json({
      ok: false,
      error: status === 401 ? 'Ugyldig token — sjekk consumer_token og employee_token' : detail,
    });
  }
});

module.exports = router;
