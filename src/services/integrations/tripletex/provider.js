'use strict';

/**
 * Tripletex provider — per-tenant session management + withClient API.
 *
 * Session cache: Map<tenantId, { token, expiresAt, configVersion }>
 * Sessions are reused until 5 min before Tripletex expiry OR until config
 * changes (detected via config_version from registry).
 *
 * Fallback (Steg 9, Alt A):
 * If no tenant_integrations row exists yet for a tenant (INTEGRATION_NOT_CONFIGURED),
 * we fall back to process.env CONSUMER_TOKEN / EMPLOYEE_TOKEN / BASE_URL.
 * This fallback exists solely to allow a zero-downtime prod deploy before
 * seeding the DB row via admin UI. It is removed in Steg 9.7 (see below).
 *
 * STEG 9.7 REMOVAL CHECKLIST:
 *   1. Confirm tenant_integrations row for prod airtech is seeded and stable (≥24h).
 *   2. Delete the _buildFallbackConfig() function and its call in _getOrCreateSession().
 *   3. Delete process.env.CONSUMER_TOKEN / EMPLOYEE_TOKEN from Cloud Run env + Secret Manager.
 *   4. Redeploy. Verify no INTEGRATION_NOT_CONFIGURED errors in logs.
 */

const registry = require('../registry');
const { IntegrationNotConfiguredError } = require('../registry');
const { createSession, buildClient } = require('./apiClient');

// Per-tenant session cache
const sessions = new Map(); // tenantId → { token, expiresAt, configVersion }

/**
 * Build a config object from legacy env vars (fallback only — see above).
 * Returns null if env vars are not set.
 *
 * @returns {{ consumer_token: string, employee_token: string, base_url: string }|null}
 */
function _buildFallbackConfig() {
  const consumerToken = process.env.CONSUMER_TOKEN;
  const employeeToken = process.env.EMPLOYEE_TOKEN;
  if (!consumerToken || !employeeToken) return null;
  console.warn(
    '[tripletex/provider] WARNING: Using env-var fallback for Tripletex credentials. ' +
    'Seed tenant_integrations row via admin UI and remove fallback per Steg 9.7.'
  );
  return {
    consumer_token: consumerToken,
    employee_token: employeeToken,
    base_url: process.env.BASE_URL || 'https://tripletex.no/v2',
  };
}

/**
 * Resolve config for tenantId: try registry first, fall back to env vars.
 * version is set to -1 for fallback configs so they never match a real config_version.
 *
 * @param {string} tenantId
 * @returns {Promise<{ config: object, version: number }>}
 */
async function _resolveConfig(tenantId) {
  try {
    return await registry.getIntegration(tenantId, 'tripletex');
  } catch (err) {
    if (err instanceof IntegrationNotConfiguredError) {
      const fallback = _buildFallbackConfig();
      if (fallback) return { config: fallback, version: -1 };
    }
    throw err;
  }
}

/**
 * Ensure we have a valid session for tenantId.
 * Creates a new session if none exists, if the TTL is close to expiry,
 * or if the config has changed (config_version mismatch).
 *
 * @param {string} tenantId
 * @returns {Promise<{ token: string, config: object }>}
 */
async function _getOrCreateSession(tenantId) {
  const { config, version } = await _resolveConfig(tenantId);

  const now = Date.now();
  const cached = sessions.get(tenantId);
  const SESSION_GRACE_MS = 5 * 60 * 1000; // refresh 5 min before expiry

  if (
    cached &&
    cached.configVersion === version &&
    cached.expiresAt > now + SESSION_GRACE_MS
  ) {
    return { token: cached.token, config };
  }

  // Create a new session
  const session = await createSession(config);
  sessions.set(tenantId, {
    token: session.token,
    expiresAt: session.expiresAt,
    configVersion: version,
  });
  return { token: session.token, config };
}

/**
 * Primary API: execute fn with an authenticated Tripletex axios client
 * scoped to tenantId. Retries once on HTTP 401 (expired session).
 *
 * @param {string} tenantId
 * @param {(client: import('axios').AxiosInstance) => Promise<T>} fn
 * @returns {Promise<T>}
 * @template T
 */
async function withClient(tenantId, fn) {
  const { token, config } = await _getOrCreateSession(tenantId);
  const client = buildClient(config, token);

  try {
    return await fn(client);
  } catch (err) {
    const status = err.response?.status;
    if (status === 401) {
      // Session expired — evict cache and retry once
      sessions.delete(tenantId);
      const { token: t2, config: c2 } = await _getOrCreateSession(tenantId);
      return await fn(buildClient(c2, t2));
    }
    throw err;
  }
}

module.exports = { withClient };
