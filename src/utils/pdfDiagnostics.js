// src/utils/pdfDiagnostics.js
const fs = require('fs');
const { execSync } = require('child_process');

function diagnoseChromium() {
  const info = {
    environment: process.env.NODE_ENV,
    platform: process.platform,
    isCloudRun: !!process.env.K_SERVICE,
    puppeteerPath: process.env.PUPPETEER_EXECUTABLE_PATH,
    chromiumLocations: []
  };

  // Sjekk mulige chromium-lokasjoner
  const possiblePaths = [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/lib/chromium/chromium',
    '/snap/bin/chromium'
  ];

  possiblePaths.forEach(path => {
    if (fs.existsSync(path)) {
      info.chromiumLocations.push(path);
    }
  });

  // Prøv which command
  try {
    const whichResult = execSync('which chromium', { encoding: 'utf8' }).trim();
    if (whichResult && !info.chromiumLocations.includes(whichResult)) {
      info.chromiumLocations.push(whichResult);
    }
  } catch (e) {
    // Ignore
  }

  console.log('🔍 Chromium diagnostics:', info);
  return info;
}

module.exports = { diagnoseChromium };
