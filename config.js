
require('dotenv').config();
const path = require('path');

const config = {
    server: {
        port: process.env.PORT || 3000,
    },
    database: {
        path: path.join(__dirname, 'database', 'database.json'),
    },
    uploads: {
        path: path.join(__dirname, 'uploads'),
    },
    static: {
        admin: path.join(__dirname, 'air-tech-adminweb'),
        app: path.join(__dirname, 'air-tech-app'),
    },
};

module.exports = config;
