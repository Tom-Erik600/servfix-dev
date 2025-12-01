const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');

module.exports = (db) => {
  const checklistTemplatesPath = path.join(__dirname, '..', 'database', 'checklist-templates.json');

  // GET all checklist templates
  router.get('/', async (req, res) => {
    try {
      const data = await fs.readFile(checklistTemplatesPath, 'utf8');
      res.json(JSON.parse(data));
    } catch (error) {
      console.error('Error reading checklist templates:', error);
      res.status(500).json({ message: 'Failed to load checklist templates.' });
    }
  });

  // POST (save) checklist templates
  router.post('/', async (req, res) => {
    try {
      await fs.writeFile(checklistTemplatesPath, JSON.stringify(req.body, null, 2), 'utf8');
      res.json({ message: 'Checklist templates saved successfully.' });
    } catch (error) {
      console.error('Error writing checklist templates:', error);
      res.status(500).json({ message: 'Failed to save checklist templates.' });
    }
  });

  return router;
};