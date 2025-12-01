const bcrypt = require('bcryptjs');

const requireAuth = (req, res, next) => {
  // Allow access for both technicians AND admins
  if (!req.session.technicianId && !req.session.isAdmin) {
    return res.status(401).send({ error: 'Not authenticated' });
  }
  next();
};

const getCurrentUser = (req, res, next) => {
  if (req.session.technicianId) {
    req.user = { id: req.session.technicianId, role: 'technician' }; 
  } else if (req.session.isAdmin) {
    req.user = { id: 'admin', role: 'admin' };
  }
  next();
};

const hashPassword = async (password) => {
  const salt = await bcrypt.genSalt(10);
  return await bcrypt.hash(password, salt);
};

const verifyPassword = async (password, hashedPassword) => {
  return await bcrypt.compare(password, hashedPassword);
};

const validateLoginInput = (req, res, next) => {
  const { technicianId, password } = req.body;
  if (!technicianId || !password) {
    return res.status(400).send({ error: 'Technician ID and password are required' });
  }
  next();
};

module.exports = {
  requireAuth,
  getCurrentUser,
  hashPassword,
  verifyPassword,
  validateLoginInput,
};