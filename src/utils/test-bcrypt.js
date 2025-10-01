const bcrypt = require('bcryptjs');

async function test() {
  const password = 'test123';
  const hash = await bcrypt.hash(password, 10);
  console.log('New hash for test123:', hash);
  
  // Test med den hashen vi bruker
  const testHash = '$2a$10$5kYQxKmNRNbN5YZ2bGDq6.Jryecoe1V9klt0FF.DqoH7NwelFbJVa';
  const matches = await bcrypt.compare('test123', testHash);
  console.log('Does test123 match our hash?', matches);
}

test();
