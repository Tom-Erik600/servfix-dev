'use strict';

/**
 * Integration registry — loads per-tenant provider configs from servfix_admin.
 *
 * Single-flight: NOT implemented. Rationale: the servfix_admin DB query is
 * ~1–2 ms on the same Cloud SQL instance, traffic is low (single-tenant prod),
 * and TTL=60 s means stampedes of >1 concurrent cache-miss per provider per
 * minute are vanishingly rare. Adding single-flight (Promise deduplication)
 * would introduce meaningful complexity for negligible gain. Revisit if
 * traffic grows to multi-tenant with >50 req/s per tenant.
 */

const db = require('../../config/database');

const CACHE_TTL_MS = 60_000; // 60 seconds — see rationale above
const cache = new Map(); // key = `${tenantId}:${provider}` → { config, version, expiresAt }

/**
 * Load the active integration config for (tenantId, provider).
 * Returns cached value if TTL has not expired.
 *
 * @param {string} tenantId
 * @param {string} provider  e.g. 'tripletex' | 'email'
 * @returns {Promise<{ config: object, version: number }>}
 * @throws {IntegrationNotConfiguredError} if no active row found
 */
async function getIntegration(tenantId, provider) {
  const key = `${tenantId}:${provider}`;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) {
    return { config: hit.config, version: hit.version };
  }

  const pool = await db.getPool('servfix_admin');
  const { rows } = await pool.query(
    `SELECT config, config_version
     FROM tenant_integrations
     WHERE tenant_id = $1 AND provider = $2 AND is_active = true
     LIMIT 1`,
    [tenantId, provider]
  );

  if (rows.length === 0) {
    throw new IntegrationNotConfiguredError(tenantId, provider);
  }

  const entry = {
    config: rows[0].config,
    version: rows[0].config_version,
    expiresAt: now + CACHE_TTL_MS,
  };
  cache.set(key, entry);
  return { config: entry.config, version: entry.version };
}

/**
 * Invalidate cached config for a tenant+provider (or all providers for a tenant).
 * Call this after saving new config via admin UI.
 *
 * @param {string} tenantId
 * @param {string|null} provider  if null, invalidates all providers for tenantId
 */
function invalidate(tenantId, provider = null) {
  if (provider) {
    cache.delete(`${tenantId}:${provider}`);
  } else {
    for (const key of cache.keys()) {
      if (key.startsWith(`${tenantId}:`)) cache.delete(key);
    }
  }
}

class IntegrationNotConfiguredError extends Error {
  constructor(tenantId, provider) {
    super(`No active ${provider} integration configured for tenant "${tenantId}"`);
    this.name = 'IntegrationNotConfiguredError';
    this.code = 'INTEGRATION_NOT_CONFIGURED';
    this.tenantId = tenantId;
    this.provider = provider;
  }
}

module.exports = { getIntegration, invalidate, IntegrationNotConfiguredError };
