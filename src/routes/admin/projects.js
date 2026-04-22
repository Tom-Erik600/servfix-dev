const express = require('express');
const router = express.Router();
const adminTenant = require('../../middleware/admin-tenant');
const tripletexService = require('../../services/tripletexService');

// 🔒 Admin auth + tenant-isolasjon
router.use(adminTenant);

// GET søk etter prosjekter i Tripletex (på navn eller nummer)
// Query: ?q={søkestreng}
router.get('/search', async (req, res) => {
  const { q } = req.query;

  if (!q || !q.trim()) {
    return res.json([]);
  }

  const searchTerm = q.trim();
  console.log(`🔍 [PROJECTS] Søker etter prosjekt: "${searchTerm}"`);

  try {
    const client = await tripletexService.getApiClient();

    const fields = 'id,name,number,displayName,startDate,endDate,isClosed,customer';

    // Søk parallelt på navn og nummer
    const [nameResponse, numberResponse] = await Promise.allSettled([
      client.get('/project', {
        params: {
          name: searchTerm,
          from: 0,
          count: 20,
          fields
        }
      }),
      client.get('/project', {
        params: {
          number: searchTerm,
          from: 0,
          count: 10,
          fields
        }
      })
    ]);

    // Slå sammen resultater og deduper på id
    const seen = new Set();
    const combined = [];

    for (const response of [nameResponse, numberResponse]) {
      if (response.status === 'fulfilled') {
        const values = response.value.data?.values || [];
        for (const project of values) {
          if (!seen.has(project.id)) {
            seen.add(project.id);
            combined.push(project);
          }
        }
      }
    }

    console.log(`✅ [PROJECTS] Fant ${combined.length} prosjekter for søk "${searchTerm}"`);
    if (combined.length > 0) {
      console.log(`🔍 [PROJECTS] Eksempel rådata (første):`, JSON.stringify(combined[0]));
    }

    const projects = combined
      .map(p => ({
        id: p.id,
        name: p.name || '',
        number: p.number || '',
        displayName: p.displayName || p.name || '',
        startDate: p.startDate || null,
        endDate: p.endDate || null,
        isClosed: p.isClosed || false,
        customer: p.customer ? {
          id: p.customer.id,
          name: p.customer.name || p.customer.displayName || ''
        } : null
      }));

    console.log(`✅ [PROJECTS] ${projects.length} prosjekter returnert for søk "${searchTerm}"`);

    res.json(projects);  } catch (error) {
    console.error('❌ [PROJECTS] Feil ved prosjektsøk:', error.message);
    res.status(502).json({
      error: 'Kunne ikke hente prosjekter fra Tripletex',
      details: error.message
    });
  }
});

module.exports = router;
