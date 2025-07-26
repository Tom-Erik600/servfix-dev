require('dotenv').config();
const appFactory = require('./src/app');

const PORT = process.env.PORT || 3000;

(async () => {
  const app = await appFactory();
  app.listen(PORT, () => {
    console.log(`🚀 ServiFix server running on port ${PORT}`);
    console.log(`📊 Environment: ${process.env.NODE_ENV}`);
  });
})();