// // server.js
// 'use strict';

// const express     = require('express');
// const cors        = require('cors');
// const bodyParser  = require('body-parser');
// const compression = require('compression');
// const path        = require('path');

// const app  = express();
// const PORT = process.env.PORT || 4004;

// app.use(compression());
// app.use(cors());
// app.use(bodyParser.json({ limit: '10mb' }));
// app.use(bodyParser.urlencoded({ extended: true }));
// app.use(express.static(path.join(__dirname, '../app/orderbasedplanning/webapp')));

// // Ensure HANA pool is ready before any request is handled
// let dbReady = false;
// app.use(async (req, res, next) => {
//   if (!dbReady) {
//     try {
//       await require('./db').getDb();
//       dbReady = true;
//     } catch (e) {
//       return res.status(503).json({ error: 'Database not ready', detail: e.message });
//     }
//   }
//   next();
// });

// app.use('/api', require('./routes'));

// app.get('/health', (req, res) =>
//   res.json({ status: 'ok', db: dbReady ? 'hana' : 'initializing', timestamp: new Date().toISOString() })
// );

// app.get('*', (req, res) =>
//   res.sendFile(path.join(__dirname, '../app/orderbasedplanning/webapp'))
// );

// app.listen(PORT, async () => {
//   try {
//     await require('./db').getDb();
//     dbReady = true;
//     console.log(`\n  Order Planning System  →  http://localhost:${PORT}`);
//     console.log(`  API dashboard          →  http://localhost:${PORT}/api/dashboard`);
//     console.log(`  Database               →  SAP HANA\n`);
//   } catch (e) {
//     console.error('\nFailed to connect to SAP HANA:', e.message);
//     console.error('Set HANA_HOST / HANA_USER / HANA_PASSWORD or bind a HANA service on BTP.\n');
//     process.exit(1);
//   }
// });

// module.exports = app;

'use strict';

const cds         = require('@sap/cds');
const cors        = require('cors');
const compression = require('compression');
const path        = require('path');

let dbReady = false;

cds.on('bootstrap', async (app) => {

  // Middleware
  app.use(compression());
  app.use(cors());
  app.use(require('express').json({ limit: '10mb' }));
  app.use(require('express').urlencoded({ extended: true }));

  // Static UI
  app.use(require('express').static(
    path.join(__dirname, '../app/orderbasedplanning/webapp')
  ));

  // Ensure DB pool is ready before handling requests
  app.use(async (req, res, next) => {
    if (!dbReady) {
      try {
        await require('./db').getDb();
        dbReady = true;
      } catch (e) {
        return res.status(503).json({
          error: 'Database not ready',
          detail: e.message
        });
      }
    }
    next();
  });

  // API routes
  app.use('/api', require('./routes'));

  // Health endpoint
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      db: dbReady ? 'hana' : 'initializing',
      timestamp: new Date().toISOString()
    });
  });

  // Fiori fallback route
  app.get('*', (req, res) => {
    res.sendFile(
      path.join(__dirname, '../app/orderbasedplanning/webapp/index.html')
    );
  });

  console.log('Custom Express middleware loaded');
});

// Start CAP server
module.exports = cds.server;