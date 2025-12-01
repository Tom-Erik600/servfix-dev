const express = require('express');
const router = express.Router();

module.exports = (db) => {
  // Admin credentials
  const adminUser = {
    username: 'admin',
    password: 'admin',
    name: 'Administrator',
    role: 'admin'
  };

  // Admin login
  router.post('/login', async (req, res) => {
    console.log('Admin login attempt:', req.body.username);
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).send({ error: 'Brukernavn og passord er påkrevd' });
    }

    // Check admin credentials
    if (username === adminUser.username && password === adminUser.password) {
      // Set admin session
      req.session.isAdmin = true;
      req.session.adminUser = {
        username: adminUser.username,
        name: adminUser.name,
        role: adminUser.role
      };
      
      console.log('Admin login successful');
      res.send({ message: 'Innlogget som administrator' });
    } else {
      console.log('Admin login failed - invalid credentials');
      res.status(401).send({ error: 'Ugyldig brukernavn eller passord' });
    }
  });

  // Get current admin user
  router.get('/me', (req, res) => {
    if (req.session.isAdmin) {
      res.send(req.session.adminUser);
    } else {
      res.status(401).send({ error: 'Ikke pålogget som administrator' });
    }
  });

  // Admin logout
  router.post('/logout', (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).send({ error: 'Kunne ikke logge ut' });
      }
      res.clearCookie('connect.sid');
      res.send({ message: 'Logget ut' });
    });
  });

  return router;
};