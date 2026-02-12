/**
 * D6: Enkel retry-wrapper for transiente feil.
 * @param {Function} fn        Async funksjon som skal kjøres
 * @param {Object}   opts
 * @param {number}   opts.retries   Antall forsøk (default 3)
 * @param {number}   opts.delayMs   Ventetid mellom forsøk i ms (default 1000)
 * @param {string}   opts.label     Navn for logging
 */
async function retry(fn, { retries = 3, delayMs = 1000, label = 'operation' } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        console.warn(`[RETRY] ${label} failed (attempt ${attempt}/${retries}): ${err.message}. Retrying in ${delayMs}ms...`);
        await new Promise(r => setTimeout(r, delayMs));
      }
    }
  }
  throw lastError;
}

module.exports = { retry };
