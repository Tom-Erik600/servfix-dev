// src/utils/safePuppeteer.js
const puppeteer = require('puppeteer');
const { diagnoseChromium } = require('./pdfDiagnostics');

async function launchBrowserSafely(options = {}) {
  const diagnostics = diagnoseChromium();
  
  // Basis-opsjoner som alltid skal være med
  const baseOptions = {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu'
    ]
  };

  // Forsøk ulike konfigurasjoner i rekkefølge
  const configurations = [
    {
      name: 'Environment variable',
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH
    },
    ...diagnostics.chromiumLocations.map(path => ({
      name: `Found at ${path}`,
      executablePath: path
    })),
    {
      name: 'Puppeteer default',
      executablePath: undefined
    }
  ];

  let lastError;
  
  for (const config of configurations) {
    if (!config.executablePath && config.name !== 'Puppeteer default') {
      continue;
    }
    
    console.log(`🚀 Trying browser launch with: ${config.name}`);
    
    try {
      const browser = await puppeteer.launch({
        ...baseOptions,
        ...options,
        executablePath: config.executablePath
      });
      
      console.log(`✅ Browser launched successfully with ${config.name}`);
      return browser;
      
    } catch (error) {
      console.log(`❌ Failed with ${config.name}: ${error.message}`);
      lastError = error;
    }
  }
  
  // Hvis alt feiler, kast siste feil
  throw new Error(`Failed to launch browser. Last error: ${lastError?.message}`);
}

module.exports = { launchBrowserSafely };