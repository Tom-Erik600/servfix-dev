/**
 * Tenant Security Tests
 *
 * Verifiserer at routes IKKE returnerer data uten gyldig tenant/session.
 * Kjør med: npx jest tests/tenant-security.test.js
 */

const request = require('supertest');

const BASE_URL = process.env.TEST_URL || 'http://localhost:8080';

describe('Tenant Security - Routes skal kreve autentisering', () => {

  const protectedRoutes = [
    { method: 'get', path: '/api/checklist-templates', name: 'Checklist Templates' },
    { method: 'get', path: '/api/checklist-instructions/test-template/test-item', name: 'Checklist Instructions' },
    { method: 'get', path: '/api/quotes', name: 'Quotes liste' },
    { method: 'get', path: '/api/reports', name: 'Reports' },
    { method: 'get', path: '/api/images/settings', name: 'Image Settings' },
  ];

  protectedRoutes.forEach(route => {
    test(`${route.name}: ${route.method.toUpperCase()} ${route.path} skal returnere 401 uten session`, async () => {
      const response = await request(BASE_URL)[route.method](route.path);

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toMatch(/not authenticated|missing tenant|ikke autentisert|mangler tenant/i);
    });
  });

});

describe('Tenant Security - Skal IKKE falle tilbake til airtech', () => {

  test('Checklist templates skal IKKE returnere data uten session', async () => {
    const response = await request(BASE_URL)
      .get('/api/checklist-templates');

    expect(response.status).toBe(401);
    expect(response.body.facilityTypes).toBeUndefined();
  });

  test('Quotes skal IKKE returnere data uten session', async () => {
    const response = await request(BASE_URL)
      .get('/api/quotes');

    expect(response.status).toBe(401);
    expect(Array.isArray(response.body)).toBe(false);
  });

  test('Images settings skal IKKE returnere airtech logo uten session', async () => {
    const response = await request(BASE_URL)
      .get('/api/images/settings');

    expect(response.status).toBe(401);
    expect(response.body.logo).toBeUndefined();
  });

});

describe('Tenant Security - Admin routes', () => {

  const adminRoutes = [
    { method: 'get', path: '/api/admin/checklist-templates', name: 'Admin Templates' },
    { method: 'get', path: '/api/admin/orders', name: 'Admin Orders' },
    { method: 'get', path: '/api/admin/customers', name: 'Admin Customers' },
    { method: 'get', path: '/api/admin/reports', name: 'Admin Reports' },
  ];

  adminRoutes.forEach(route => {
    test(`${route.name}: skal kreve admin-autentisering`, async () => {
      const response = await request(BASE_URL)[route.method](route.path);

      expect([401, 403]).toContain(response.status);
    });
  });

});
