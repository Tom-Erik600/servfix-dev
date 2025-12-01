const express = require('express');
const router = express.Router();
const { validateLoginInput, verifyPassword } = require('../middleware/auth');

module.exports = (db) => {
  const tempPasswords = {
    'T-01': 'rune123',
    'T-02': 'erik123',
    'TECH-1751992625814': 'tomm123',
  };

  router.post('/login', validateLoginInput, async (req, res) => {
    console.log('Login attempt received:', req.body);
    const { technicianId, password } = req.body;
    console.log('Extracted technicianId:', technicianId, 'Password:', password);

    try {
      const technician = await db.getTechnicianById(technicianId);
      console.log('Technician found:', technician);

      if (!technician) {
        console.log('No technician found for ID:', technicianId);
        return res.status(401).send({ error: 'Invalid credentials' });
      }

      const storedPassword = tempPasswords[technicianId];
      console.log('Stored password for', technicianId, ':', storedPassword);
      if (!storedPassword || password !== storedPassword) {
          console.log('Password mismatch or no stored password.');
          return res.status(401).send({ error: 'Invalid credentials' });
      }

      req.session.technicianId = technician.id;
      console.log('Login successful for technician:', technician.id);
      res.send({ message: 'Logged in successfully' });
    } catch (error) {
      console.error('Login error:', error);
      res.status(500).send({ error: 'Internal server error' });
    }
  });

  router.get('/me', async (req, res) => {
    if (req.session.technicianId) {
      try {
        const technician = await db.getTechnicianById(req.session.technicianId);
        if (technician) {
          res.send(technician);
        } else {
          res.status(404).send({ error: 'Technician not found' });
        }
      } catch (error) {
        console.error('Error fetching technician in /me:', error);
        res.status(500).send({ error: 'Internal server error' });
      }
    } else {
      res.status(404).send({ error: 'Not logged in' });
    }
  });

  router.post('/logout', (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).send({ error: 'Could not log out' });
      }
      res.clearCookie('connect.sid');
      res.send({ message: 'Logged out successfully' });
    });
  });

  return router;
};