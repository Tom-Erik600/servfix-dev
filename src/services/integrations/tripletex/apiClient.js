'use strict';

/**
 * Tripletex API client — pure HTTP client, no singleton state.
 *
 * Accepts config (from tenant_integrations.config) and a sessionToken.
 * The caller (provider.js) is responsible for session lifecycle.
 */

const axios = require('axios');

const DEFAULT_BASE_URL = 'https://tripletex.no/v2';

/**
 * Create a session token with Tripletex.
 * Expiration is set to one year from now (Tripletex max allowed).
 *
 * @param {{ consumer_token: string, employee_token: string, base_url?: string }} config
 * @returns {Promise<{ token: string, expiresAt: number }>}
 */
async function createSession(config) {
  const baseUrl = config.base_url || DEFAULT_BASE_URL;

  // Tripletex requires an expirationDate in YYYY-MM-DD format.
  // We use one year from today as the maximum allowed window.
  const expiry = new Date();
  expiry.setFullYear(expiry.getFullYear() + 1);
  const expirationDate = expiry.toISOString().slice(0, 10);

  const response = await axios({
    method: 'put',
    url: `${baseUrl}/token/session/:create`,
    params: {
      consumerToken: config.consumer_token,
      employeeToken: config.employee_token,
      expirationDate,
    },
  });

  const token = response.data.value.token;
  // Cache the session until 5 minutes before the Tripletex expiry date
  const expiresAt = new Date(expirationDate).getTime() - 5 * 60 * 1000;

  return { token, expiresAt };
}

/**
 * Build an authenticated axios instance for the given session token.
 *
 * @param {{ base_url?: string }} config
 * @param {string} sessionToken
 * @returns {import('axios').AxiosInstance}
 */
function buildClient(config, sessionToken) {
  const baseUrl = config.base_url || DEFAULT_BASE_URL;
  const basicAuth = Buffer.from(`0:${sessionToken}`).toString('base64');

  return axios.create({
    baseURL: baseUrl,
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/json',
    },
  });
}

module.exports = { createSession, buildClient };
