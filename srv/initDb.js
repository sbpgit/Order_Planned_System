// scripts/initDb.js - stub for sql.js (schema created in db.js on first run)
const DB_PATH = require('path').join(__dirname, '..', 'planning.db');
function initializeDatabase() { console.log('Database will be initialized on first request at:', DB_PATH); }
if (require.main === module) { initializeDatabase(); }
module.exports = { initializeDatabase, DB_PATH };
