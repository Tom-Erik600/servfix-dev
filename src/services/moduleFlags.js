// src/services/moduleFlags.js
//
// Laster module_flags for en tenant.
//
// Delegerer til loadTenantSettings() fra src/routes/images.js, som er den
// autoritative GCS-leseren for settings.json. Begge endepunkter
// (/api/tenant/flags og /api/admin/module-flags) og requireModule-middleware
// leser dermed fra samme kilde med samme cache.
//
// getDefaultModuleFlags() er kilden for alle defaults — images.js bruker den
// direkte i getDefaultSettings(). Det er bare én plass å vedlikeholde defaults.

const { loadTenantSettings } = require('../routes/images');

function getDefaultModuleFlags() {
  return {
    // Eksisterende flagg (bakoverkompatible)
    show_pool_technician: false,
    show_periode_tab: false,
    show_avvik_module: false,
    show_enkel_tab: false,
    show_avansert_tab: true,
    default_tab: 'avansert',
    // Nye flagg for avvikshåndteringsmodulen (Fase 1+)
    enable_pdf_generation: true,
    enable_avvik_in_service: true,
    enable_deviations_management: false,
    enable_incidents: false,
    enable_hms_sja: true,
    enable_hms_ros: true,
    enable_notifications: false,
    // Avvik til omsetning v1: false skjuler manuell tilbudsknapp i tekniker-ordrevisning
    show_manual_quote_button: true,
  };
}

async function loadModuleFlags(tenantId) {
  if (!tenantId) {
    throw new Error('tenantId er påkrevd');
  }

  try {
    const settings = await loadTenantSettings(tenantId);
    // Merge defaults slik at nye flagg alltid er tilstede selv om settings.json
    // er gammel og ikke har dem ennå.
    return { ...getDefaultModuleFlags(), ...(settings.module_flags || {}) };
  } catch (err) {
    console.error(`❌ Feil ved lasting av module flags for ${tenantId}:`, err.message);
    // Fail safe: returner defaults slik at eksisterende funksjonalitet ikke brytes
    return getDefaultModuleFlags();
  }
}

function clearCache(tenantId) {
  // Cache-invalidering håndteres av loadTenantSettings/_settingsCache i images.js.
  // Denne funksjonen er beholdt for bakoverkompatibilitet med eventuelle kall,
  // men har ingen effekt her. Bruk saveTenantSettings() for å invalidere cachen.
}

module.exports = {
  loadModuleFlags,
  getDefaultModuleFlags,
  clearCache,
};
