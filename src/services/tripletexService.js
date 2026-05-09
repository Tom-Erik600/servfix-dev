'use strict';

/**
 * @deprecated This file is a compatibility shim.
 * It re-exports from src/services/integrations/shims/tripletexService.js.
 * Will be deleted in Phase 2 (after Fase 1b stabilises).
 *
 * IMPORTANT: getApiClient() is NOT available here. All call sites use
 * withClient(tenantId, async (client) => { ... }) directly.
 */

module.exports = require('./integrations/shims/tripletexService');
