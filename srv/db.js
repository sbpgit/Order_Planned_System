// // srv/db.js — SAP HANA Cloud database layer
// // Uses @sap/hana-client for connection pooling and parameterised queries.
// // Credentials: VCAP_SERVICES (SAP BTP) or HANA_HOST / HANA_USER / HANA_PASSWORD env vars.

// 'use strict';

// const hana  = require('@sap/hana-client');
// const cds = require('@sap/cds');
// const { v4: uuidv4 } = require('uuid');
// const sqlite3 = require('sqlite3').verbose();
// let sqliteDb = null;
// // ─── Connection pool ──────────────────────────────────────────────────────────
// let _pool        = null;
// let _initialized = false;
// let db;
// // const stmts = [
// //     `CREATE TABLE IF NOT EXISTS OPS_PRODUCTS (
// //       id NVARCHAR(36) PRIMARY KEY,
// //       product_code NVARCHAR(50) NOT NULL UNIQUE,
// //       name NVARCHAR(200) NOT NULL,
// //       description NVARCHAR(1000),
// //       category NVARCHAR(100),
// //       unit_price DECIMAL(15,2) DEFAULT 0,
// //       standard_cost DECIMAL(15,2) DEFAULT 0,
// //       lead_time_days INTEGER DEFAULT 0,
// //       is_active TINYINT DEFAULT 1,
// //       created_at TIMESTAMP,
// //       updated_at TIMESTAMP)`,

// //     `CREATE TABLE IF NOT EXISTS OPS_CUSTOMERS (
// //       id NVARCHAR(36) PRIMARY KEY,
// //       customer_code NVARCHAR(50) NOT NULL UNIQUE,
// //       name NVARCHAR(200) NOT NULL,
// //       priority NVARCHAR(20) DEFAULT 'Medium',
// //       contact_person NVARCHAR(100),
// //       email NVARCHAR(200),
// //       phone NVARCHAR(50),
// //       is_active TINYINT DEFAULT 1,
// //       created_at TIMESTAMP,
// //       updated_at TIMESTAMP)`,

// //     `CREATE TABLE IF NOT EXISTS OPS_RESTRICTIONS (
// //       id NVARCHAR(36) PRIMARY KEY,
// //       restriction_code NVARCHAR(50) NOT NULL UNIQUE,
// //       name NVARCHAR(200) NOT NULL,
// //       description NVARCHAR(1000),
// //       resource_type NVARCHAR(100),
// //       valid_from DATE,
// //       valid_to DATE,
// //       penalty_cost_per_unit DECIMAL(15,2) DEFAULT 100,
// //       is_active TINYINT DEFAULT 1,
// //       created_at TIMESTAMP,
// //       updated_at TIMESTAMP)`,

// //     `CREATE TABLE IF NOT EXISTS OPS_WEEKLY_CAPACITIES (
// //       id NVARCHAR(36) PRIMARY KEY,
// //       restriction_id NVARCHAR(36) NOT NULL,
// //       year INTEGER NOT NULL,
// //       week INTEGER NOT NULL,
// //       capacity DECIMAL(15,2) DEFAULT 0,
// //       UNIQUE (restriction_id, year, week))`,

// //     `CREATE TABLE IF NOT EXISTS OPS_PENALTY_RULES (
// //       id NVARCHAR(36) PRIMARY KEY,
// //       rule_type NVARCHAR(50) NOT NULL,
// //       customer_priority NVARCHAR(20) DEFAULT 'All',
// //       product_id NVARCHAR(36),
// //       penalty_per_day DECIMAL(15,2) DEFAULT 0,
// //       penalty_flat DECIMAL(15,2) DEFAULT 0,
// //       created_at TIMESTAMP)`,

// //     `CREATE TABLE IF NOT EXISTS OPS_COMPONENTS (
// //       id NVARCHAR(36) PRIMARY KEY,
// //       component_code NVARCHAR(50) NOT NULL UNIQUE,
// //       name NVARCHAR(200) NOT NULL,
// //       description NVARCHAR(1000),
// //       supplier NVARCHAR(200),
// //       unit_cost DECIMAL(15,2) DEFAULT 0,
// //       lead_time_days INTEGER DEFAULT 0,
// //       min_stock INTEGER DEFAULT 0,
// //       is_active TINYINT DEFAULT 1,
// //       created_at TIMESTAMP,
// //       updated_at TIMESTAMP)`,

// //     `CREATE TABLE IF NOT EXISTS OPS_COMPONENT_AVAILABILITY (
// //       id NVARCHAR(36) PRIMARY KEY,
// //       component_id NVARCHAR(36) NOT NULL,
// //       year INTEGER NOT NULL,
// //       week INTEGER NOT NULL,
// //       available_qty DECIMAL(15,2) DEFAULT 0,
// //       reserved_qty DECIMAL(15,2) DEFAULT 0,
// //       UNIQUE (component_id, year, week))`,

// //     `CREATE TABLE IF NOT EXISTS OPS_SALES_ORDERS (
// //       id NVARCHAR(36) PRIMARY KEY,
// //       order_number NVARCHAR(50) NOT NULL UNIQUE,
// //       customer_id NVARCHAR(36) NOT NULL,
// //       product_id NVARCHAR(36) NOT NULL,
// //       requested_date DATE,
// //       promise_date DATE NOT NULL,
// //       quantity DECIMAL(15,2) NOT NULL DEFAULT 1,
// //       unit_price DECIMAL(15,2) DEFAULT 0,
// //       revenue DECIMAL(15,2) DEFAULT 0,
// //       cost DECIMAL(15,2) DEFAULT 0,
// //       priority NVARCHAR(20) DEFAULT 'Medium',
// //       status NVARCHAR(20) DEFAULT 'Open',
// //       notes NVARCHAR(2000),
// //       created_at TIMESTAMP,
// //       updated_at TIMESTAMP)`,

// //     `CREATE TABLE IF NOT EXISTS OPS_ORDER_RESTRICTIONS (
// //       id NVARCHAR(36) PRIMARY KEY,
// //       sales_order_id NVARCHAR(36) NOT NULL,
// //       restriction_id NVARCHAR(36) NOT NULL,
// //       capacity_usage_per_unit DECIMAL(15,2) DEFAULT 1,
// //       UNIQUE (sales_order_id, restriction_id))`,

// //     `CREATE TABLE IF NOT EXISTS OPS_ORDER_COMPONENTS (
// //       id NVARCHAR(36) PRIMARY KEY,
// //       sales_order_id NVARCHAR(36) NOT NULL,
// //       component_id NVARCHAR(36) NOT NULL,
// //       required_qty_per_unit DECIMAL(15,2) DEFAULT 1,
// //       UNIQUE (sales_order_id, component_id))`,

// //     `CREATE TABLE IF NOT EXISTS OPS_OPTIMIZATION_RUNS (
// //       id NVARCHAR(36) PRIMARY KEY,
// //       run_number NVARCHAR(50) NOT NULL UNIQUE,
// //       description NVARCHAR(500),
// //       run_date TIMESTAMP,
// //       status NVARCHAR(20) DEFAULT 'Running',
// //       parameters NVARCHAR(2000),
// //       total_orders INTEGER DEFAULT 0,
// //       on_time_orders INTEGER DEFAULT 0,
// //       delayed_orders INTEGER DEFAULT 0,
// //       total_penalty_cost DECIMAL(15,2) DEFAULT 0,
// //       on_time_percentage DECIMAL(7,2) DEFAULT 0,
// //       avg_delay_days DECIMAL(7,2) DEFAULT 0,
// //       max_delay_days INTEGER DEFAULT 0,
// //       execution_time_ms INTEGER DEFAULT 0,
// //       created_at TIMESTAMP,
// //       updated_at TIMESTAMP)`,

// //     `CREATE TABLE IF NOT EXISTS OPS_OPTIMIZATION_RESULTS (
// //       id NVARCHAR(36) PRIMARY KEY,
// //       run_id NVARCHAR(36) NOT NULL,
// //       sales_order_id NVARCHAR(36) NOT NULL,
// //       original_date DATE,
// //       optimized_date DATE,
// //       delay_days INTEGER DEFAULT 0,
// //       penalty_cost DECIMAL(15,2) DEFAULT 0,
// //       feasible TINYINT DEFAULT 1,
// //       status NVARCHAR(100))`,

// //     `CREATE TABLE IF NOT EXISTS OPS_CAPACITY_ANALYSIS (
// //       id NVARCHAR(36) PRIMARY KEY,
// //       run_id NVARCHAR(36) NOT NULL,
// //       restriction_id NVARCHAR(36) NOT NULL,
// //       year INTEGER,
// //       week INTEGER,
// //       capacity DECIMAL(15,2) DEFAULT 0,
// //       required_capacity DECIMAL(15,2) DEFAULT 0,
// //       utilization_pct DECIMAL(7,2) DEFAULT 0,
// //       over_capacity DECIMAL(15,2) DEFAULT 0,
// //       violation_cost DECIMAL(15,2) DEFAULT 0,
// //       is_critical TINYINT DEFAULT 0)`,

// //     `CREATE TABLE IF NOT EXISTS OPS_COMPONENT_ANALYSIS (
// //       id NVARCHAR(36) PRIMARY KEY,
// //       run_id NVARCHAR(36) NOT NULL,
// //       component_id NVARCHAR(36) NOT NULL,
// //       year INTEGER,
// //       week INTEGER,
// //       available DECIMAL(15,2) DEFAULT 0,
// //       required DECIMAL(15,2) DEFAULT 0,
// //       shortage DECIMAL(15,2) DEFAULT 0,
// //       shortage_cost DECIMAL(15,2) DEFAULT 0,
// //       is_critical TINYINT DEFAULT 0)`
// //   ];


// function _buildConnParams() {
//   // 1) SAP BTP: credentials injected via VCAP_SERVICES (hana service binding)
//   if (process.env.VCAP_SERVICES) {
//     try {
//       const vcap = JSON.parse(process.env.VCAP_SERVICES);
//       const svc  = (vcap['hana'] || vcap['hanatrial'] || [])[0];
//       if (svc) {
//         const c = svc.credentials;
//         return {
//           serverNode            : `${c.host}:${c.port}`,
//           uid                   : c.user,
//           pwd                   : c.password,
//           currentSchema          : c.schema || c.database || undefined,
//           encrypt               : 'true',
//           sslValidateCertificate: 'false'
//         };
//       }
//     } catch (_) { /* fall through */ }
//   }

//   // 2) Individual env vars (local dev / Docker)
//   if (process.env.HANA_HOST) {
//     return {
//       serverNode            : `${process.env.HANA_HOST}:${process.env.HANA_PORT || 443}`,
//       uid                   : process.env.HANA_USER,
//       pwd                   : process.env.HANA_PASSWORD,
//       databaseName          : process.env.HANA_SCHEMA || undefined,
//       encrypt               : process.env.HANA_ENCRYPT !== 'false' ? 'true' : 'false',
//       sslValidateCertificate: 'false'
//     };
//   }

//   // 3) Local fallback → SQLite
// if (process.env.NODE_ENV !== 'production') {
//   console.log('No HANA credentials found. Running with SQLite locally.');
//   return null;
// }


//   throw new Error(
//     'No HANA connection found.\n' +
//     'Set HANA_HOST, HANA_PORT, HANA_USER, HANA_PASSWORD (and optionally HANA_SCHEMA)\n' +
//     'or bind a HANA service instance on SAP BTP.'
//   );
// }

// // async function getDb() {
// //   if (_pool) return _pool;
// // if (sqliteDb) return sqliteDb;
// //   const params = _buildConnParams();
// //    // Local SQLite
// //   if (!params) {
// //     sqliteDb = new sqlite3.Database('./planning.db');
// //     console.log("SQLite DB initialized");
// //     // Create schema for SQLite
// // await new Promise((resolve, reject) => {
// //   sqliteDb.serialize(async () => {
// //     try {
// //       const conn = {
// //         exec: (sql, params, cb) => {
// //           sqliteDb.run(sql, params || [], function(err) {
// //             cb(err, []);
// //           });
// //         }
// //       };

// //       await _createSchema(conn);

// //       console.log("SQLite tables created");
// //       resolve();
// //     } catch (err) {
// //       reject(err);
// //     }
// //   });
// // });
// //     return sqliteDb;
// //   }

// //   // HANA
// //   _pool = hana.createPool(params, {
// //     min: 2,
// //     max: 10
// //   });

// //   if (!_initialized) {
// //     await _runWithConn(conn => _createSchema(conn));
// //     _initialized = true;
// //   }

// //   return _pool;
// // }

// async function getDb() {
//   if (!db) {
//     db = await cds.connect.to('db');
//   }
//   return db;
// }

// // ─── Internal helpers ─────────────────────────────────────────────────────────

// async function _runWithConn(fn) {
//   const pool = await getDb();
//    // SQLite mode
//   if (pool instanceof require('sqlite3').Database) {
//     return fn({
//       exec: (sql, params, cb) => {
//         pool.all(sql, params, (err, rows) => {
//           if (err) return cb(err);
//           cb(null, rows);
//         });
//       },
//       disconnect: () => {}
//     });
//   }
//   return new Promise((resolve, reject) => {
//     pool.getConnection((err, conn) => {
//       if (err) return reject(err);
//       Promise.resolve(fn(conn))
//         .then(result => { conn.disconnect(); resolve(result); })
//         .catch(e     => { conn.disconnect(); reject(e); });
//     });
//   });
// }

// function _exec(conn, sql, params = []) {
//   return new Promise((resolve, reject) => {
//     conn.exec(sql, params, (err, rows) => {
//       if (err) return reject(Object.assign(err, { sql }));
//       resolve(rows);
//     });
//   });
// }

// function _query(conn, sql, params = []) {
//   return new Promise((resolve, reject) => {
//     conn.exec(sql, params, (err, rows) => {
//       if (err) return reject(Object.assign(err, { sql }));
//       // Normalise HANA upper-case column names to lower-case
//       resolve((rows || []).map(row => {
//         const out = {};
//         for (const k of Object.keys(row)) out[k.toLowerCase()] = row[k];
//         return out;
//       }));
//     });
//   });
// }

// // ─── Schema creation (idempotent) ────────────────────────────────────────────
// // async function _createSchema(conn) {
  
// //   for (const stmt of stmts) {
// //     try {
// //       await _exec(conn, stmt);
// //     } catch (e) {
// //       // HANA error 288 = table already exists — safe to ignore
// //       if (!e.message.includes('288') && !e.message.toLowerCase().includes('already exists')) throw e;
// //     }
// //   }
// // }

// // ─── Table name mapping ───────────────────────────────────────────────────────
// const TABLE_MAP = {
//   products               : 'OPS_PRODUCTS',
//   customers              : 'OPS_CUSTOMERS',
//   restrictions           : 'OPS_RESTRICTIONS',
//   weekly_capacities      : 'OPS_WEEKLY_CAPACITIES',
//   penalty_rules          : 'OPS_PENALTY_RULES',
//   components             : 'OPS_COMPONENTS',
//   component_availability : 'OPS_COMPONENT_AVAILABILITY',
//   sales_orders           : 'OPS_SALES_ORDERS',
//   order_restrictions     : 'OPS_ORDER_RESTRICTIONS',
//   order_components       : 'OPS_ORDER_COMPONENTS',
//   optimization_runs      : 'OPS_OPTIMIZATION_RUNS',
//   optimization_results   : 'OPS_OPTIMIZATION_RESULTS',
//   capacity_analysis      : 'OPS_CAPACITY_ANALYSIS',
//   component_analysis     : 'OPS_COMPONENT_ANALYSIS'
// };

// function _tbl(name) { return TABLE_MAP[name] || name.toUpperCase(); }

// const NO_TIMESTAMP = new Set([
//   'weekly_capacities','component_availability',
//   'order_restrictions','order_components',
//   'capacity_analysis','component_analysis','optimization_results'
// ]);

// // Rewrite logical table names in raw SQL strings
// function _remapSql(sql) {
//   let out = sql;
//   for (const [logical, physical] of Object.entries(TABLE_MAP)) {
//     out = out.replace(new RegExp(`\\b${logical}\\b`, 'gi'), physical);
//   }
//   return out;
// }

// // ─── Public API ───────────────────────────────────────────────────────────────

// async function queryAll(sql, params = []) {
//   return _runWithConn(conn => _query(conn, _remapSql(sql), params));
// }

// async function queryOne(sql, params = []) {
//   const rows = await queryAll(sql, params);
//   return rows[0] || null;
// }

// async function runStmt(sql, params = []) {
//   return _runWithConn(conn => _exec(conn, _remapSql(sql), params));
// }

// async function findAll(table, where = {}, orderBy = '') {
//   const tbl  = _tbl(table);
//   const keys = Object.keys(where);
//   const vals = Object.values(where);
//   let sql = `SELECT * FROM "${tbl}"`;
//   if (keys.length) sql += ' WHERE ' + keys.map(k => `"${k}" = ?`).join(' AND ');
//   if (orderBy)     sql += ` ORDER BY ${orderBy}`;
//   return _runWithConn(conn => _query(conn, sql, vals));
// }

// async function findOne(table, where = {}) {
//   const rows = await findAll(table, where);
//   return rows[0] || null;
// }

// async function insert(table, data) {
//   if (!data.id) data.id = uuidv4();
//   if (!NO_TIMESTAMP.has(table) && !data.created_at) data.created_at = new Date();

//   const tbl  = _tbl(table);
//   const keys = Object.keys(data);
//   const vals = Object.values(data);
//   const sql  = `INSERT INTO "${tbl}" (${keys.map(k=>`"${k}"`).join(',')}) VALUES (${keys.map(()=>'?').join(',')})`;

//   try {
//     await _runWithConn(conn => _exec(conn, sql, vals));
//   } catch (e) {
//     // 301 = unique constraint; treat as already-inserted (idempotent seed)
//     if (!e.message.includes('301') && !e.message.toLowerCase().includes('unique constraint')) throw e;
//   }
//   return data;
// }

// async function update(table, id, data) {
//   if (!NO_TIMESTAMP.has(table)) data.updated_at = new Date();
//   const tbl  = _tbl(table);
//   const keys = Object.keys(data);
//   const vals = [...Object.values(data), id];
//   const sql  = `UPDATE "${tbl}" SET ${keys.map(k=>`"${k}" = ?`).join(', ')} WHERE "id" = ?`;
//   await _runWithConn(conn => _exec(conn, sql, vals));
//   return findOne(table, { id });
// }

// async function remove(table, id) {
//   await runStmt(`DELETE FROM "${_tbl(table)}" WHERE "id" = ?`, [id]);
// }

// async function removeWhere(table, where) {
//   const tbl  = _tbl(table);
//   const keys = Object.keys(where);
//   const vals = Object.values(where);
//   const sql  = `DELETE FROM "${tbl}" WHERE ` + keys.map(k=>`"${k}" = ?`).join(' AND ');
//   await _runWithConn(conn => _exec(conn, sql, vals));
// }

// async function count(table, where = {}) {
//   const tbl  = _tbl(table);
//   const keys = Object.keys(where);
//   const vals = Object.values(where);
//   let sql = `SELECT COUNT(*) AS cnt FROM "${tbl}"`;
//   if (keys.length) sql += ' WHERE ' + keys.map(k=>`"${k}" = ?`).join(' AND ');
//   const row = await _runWithConn(conn =>
//     _query(conn, sql, vals).then(rows => rows[0])
//   );
//   return row ? Number(row.cnt) : 0;
// }

// // ─── Composite queries ────────────────────────────────────────────────────────

// async function getOrdersWithDetails() {
//   const orders = await queryAll(`
//     SELECT so.*,
//            c.name            AS customer_name,
//            c.priority        AS customer_priority,
//            c.customer_code,
//            p.name            AS product_name,
//            p.product_code
//     FROM   sales_orders so
//     LEFT JOIN customers c ON so.customer_id = c.id
//     LEFT JOIN products  p ON so.product_id  = p.id
//     WHERE  so.status IN ('Open','Confirmed')
//     ORDER BY so.promise_date ASC
//   `);
//   for (const order of orders) {
//     order.restrictions = await queryAll(`
//       SELECT or2.*, r.name AS restriction_name,
//              r.restriction_code, r.penalty_cost_per_unit
//       FROM   order_restrictions or2
//       JOIN   restrictions r ON or2.restriction_id = r.id
//       WHERE  or2.sales_order_id = ?
//     `, [order.id]);

//     order.components = await queryAll(`
//       SELECT oc.*, comp.name AS component_name,
//              comp.component_code, comp.unit_cost
//       FROM   order_components oc
//       JOIN   components comp ON oc.component_id = comp.id
//       WHERE  oc.sales_order_id = ?
//     `, [order.id]);
//   }
//   return orders;
// }

// async function getRestrictionsWithCapacity() {
//   const restrictions = await findAll('restrictions', { is_active: 1 });
//   for (const r of restrictions) {
//     r.weekly_capacities = await queryAll(
//       `SELECT * FROM weekly_capacities WHERE restriction_id = ? ORDER BY year, week`, [r.id]
//     );
//   }
//   return restrictions;
// }

// async function getComponentsWithAvailability() {
//   const components = await findAll('components', { is_active: 1 });
//   for (const c of components) {
//     c.availability = await queryAll(
//       `SELECT * FROM component_availability WHERE component_id = ? ORDER BY year, week`, [c.id]
//     );
//   }
//   return components;
// }

// async function clearAllData() {
//   const tables = [
//     'component_analysis','capacity_analysis','optimization_results','optimization_runs',
//     'order_components','order_restrictions','sales_orders','component_availability',
//     'weekly_capacities','penalty_rules','customers','components','restrictions','products'
//   ];
//   for (const t of tables) await runStmt(`DELETE FROM "${_tbl(t)}"`);
// }

// module.exports = {
//   getDb,
//   queryAll, queryOne, runStmt,
//   findAll, findOne,
//   insert, update, remove, removeWhere, count,
//   getOrdersWithDetails, getRestrictionsWithCapacity,
//   getComponentsWithAvailability, clearAllData
// };

'use strict';

const cds = require('@sap/cds');
const { v4: uuidv4 } = require('uuid');

let db;

// ─────────────────────────────────────────────────────────
// DB connection via CAP
// ─────────────────────────────────────────────────────────
async function getDb() {
  if (!db) {
    db = await cds.connect.to('db');
  }
  return db;
}

// ─────────────────────────────────────────────────────────
// Table mapping
// ─────────────────────────────────────────────────────────
const TABLE_MAP = {
  products               : 'OPS_PRODUCTS',
  customers              : 'OPS_CUSTOMERS',
  restrictions           : 'OPS_RESTRICTIONS',
  weekly_capacities      : 'OPS_WEEKLY_CAPACITIES',
  penalty_rules          : 'OPS_PENALTY_RULES',
  components             : 'OPS_COMPONENTS',
  component_availability : 'OPS_COMPONENT_AVAILABILITY',
  sales_orders           : 'OPS_SALES_ORDERS',
  order_restrictions     : 'OPS_ORDER_RESTRICTIONS',
  order_components       : 'OPS_ORDER_COMPONENTS',
  optimization_runs      : 'OPS_OPTIMIZATION_RUNS',
  optimization_results   : 'OPS_OPTIMIZATION_RESULTS',
  capacity_analysis      : 'OPS_CAPACITY_ANALYSIS',
  component_analysis     : 'OPS_COMPONENT_ANALYSIS'
};

function _tbl(name) {
  return TABLE_MAP[name] || name.toUpperCase();
}

function _remapSql(sql) {
  let out = sql;
  for (const [logical, physical] of Object.entries(TABLE_MAP)) {
    out = out.replace(new RegExp(`\\b${logical}\\b`, 'gi'), physical);
  }
  return out;
}

// ─────────────────────────────────────────────────────────
// Generic SQL helpers
// ─────────────────────────────────────────────────────────
function normalizeRow(row) {
  const out = {};
 for (const k in row) {
    out[k.toLowerCase()] = row[k];
  }
  return out;
}
async function queryAll(sql, params = []) {
  const db = await getDb();
  console.log("SQL:", _remapSql(sql));
console.log("PARAMS:", params);
  const rows = await db.run(_remapSql(sql), params);
  return rows.map(normalizeRow);
}

async function queryOne(sql, params = []) {
  const rows = await queryAll(sql, params);
  return rows[0] || null;
}

async function runStmt(sql, params = []) {
  const db = await getDb();
  return db.run(_remapSql(sql), params);
}

// ─────────────────────────────────────────────────────────
// Generic CRUD helpers
// ─────────────────────────────────────────────────────────

async function findAll(table, where = {}, orderBy = '') {
  const tbl  = _tbl(table);
  const keys = Object.keys(where);
  const vals = Object.values(where);

  let sql = `SELECT * FROM "${tbl}"`;

  if (keys.length) {
    sql += ' WHERE ' + keys.map(k => `"${k.toUpperCase()}" = ?`).join(' AND ');
  }

  if (orderBy) {
    sql += ` ORDER BY ${orderBy}`;
  }

  return queryAll(sql, vals);
}

async function findOne(table, where = {}) {
  const rows = await findAll(table, where);
  return rows[0] || null;
}

async function insert(table, data) {
  const tbl = _tbl(table);

  if (!data.id) {
    data.id = uuidv4();
  }

  const keys = Object.keys(data);
  // const vals = Object.values(data);
  const vals = Object.values(data).map(v => {
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof Date) return v.toISOString();
  if (v === undefined) return null;
  return v;
});

  const sql = `
    INSERT INTO "${tbl}"
    (${keys.map(k => k.toUpperCase()).join(',')})
    VALUES (${keys.map(() => '?').join(',')})
  `;

  await runStmt(sql, vals);

  return data;
}

async function update(table, id, data) {
  const tbl = _tbl(table);

  const keys = Object.keys(data);
  // const vals = [...Object.values(data), id];
  const vals = [
  ...Object.values(data).map(v => {
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (v instanceof Date) return v.toISOString();
    if (v === undefined) return null;
    return v;
  }),
  id
];

  const sql = `
    UPDATE "${tbl}"
    SET ${keys.map(k => `"${k.toUpperCase()}" = ?`).join(', ')}
    WHERE "ID" = ?
  `;

  await runStmt(sql, vals);

  return findOne(table, { id });
}

async function remove(table, id) {
  const tbl = _tbl(table);

  await runStmt(`DELETE FROM "${tbl}" WHERE "ID" = ?`, [id]);
}

async function removeWhere(table, where) {
  const tbl  = _tbl(table);
  const keys = Object.keys(where);
  const vals = Object.values(where);

  const sql = `
    DELETE FROM "${tbl}"
    WHERE ${keys.map(k => `"${k.toUpperCase()}" = ?`).join(' AND ')}
  `;

  await runStmt(sql, vals);
}

async function count(table, where = {}) {
  const tbl  = _tbl(table);
  const keys = Object.keys(where);
  const vals = Object.values(where);

  let sql = `SELECT COUNT(*) as CNT FROM "${tbl}"`;

  if (keys.length) {
    sql += ' WHERE ' + keys.map(k => `"${k.toUpperCase()}" = ?`).join(' AND ');
  }

  const row = await queryOne(sql, vals);

  return row ? Number(row.CNT || row.cnt) : 0;
}

// ─────────────────────────────────────────────────────────
// Composite queries
// ─────────────────────────────────────────────────────────

async function getOrdersWithDetails() {

  const orders = await queryAll(`
    SELECT so.*,
           c.name  AS customer_name,
           c.priority AS customer_priority,
           p.name  AS product_name
    FROM sales_orders so
    LEFT JOIN customers c ON so.customer_id = c.id
    LEFT JOIN products  p ON so.product_id = p.id
    ORDER BY so.promise_date ASC, so.priority ASC, c.priority ASC
  `);

  for (const order of orders) {

    order.restrictions = await queryAll(`
      SELECT or2.*, r.name AS restriction_name
      FROM order_restrictions or2
      JOIN restrictions r ON or2.restriction_id = r.id
      WHERE or2.sales_order_id = ?
    `, [order.id]);

    order.components = await queryAll(`
      SELECT oc.*, comp.name AS component_name
      FROM order_components oc
      JOIN components comp ON oc.component_id = comp.id
      WHERE oc.sales_order_id = ?
    `, [order.id]);
  }

  return orders;
}
async function getRestrictionsWithCapacity() {
  const restrictions = await findAll('restrictions', { is_active: true });
  for (const r of restrictions) {
    r.weekly_capacities = await queryAll(
      `SELECT * FROM weekly_capacities WHERE restriction_id = ? ORDER BY year, week`, [r.id]
    );
  }
  return restrictions;
}

async function getComponentsWithAvailability() {
  const components = await findAll('components', { is_active: true });
  for (const c of components) {
    c.availability = await queryAll(
      `SELECT * FROM component_availability WHERE component_id = ? ORDER BY year, week`, [c.id]
    );
  }
  return components;
}

async function clearAllData() {

  const tables = [
    'component_analysis',
    'capacity_analysis',
    'optimization_results',
    'optimization_runs',
    'order_components',
    'order_restrictions',
    'sales_orders',
    'component_availability',
    'weekly_capacities',
    'penalty_rules',
    'customers',
    'components',
    'restrictions',
    'products'
  ];

  for (const t of tables) {
    await runStmt(`DELETE FROM "${_tbl(t)}"`);
  }
}

// ─────────────────────────────────────────────────────────

module.exports = {
  getDb,
  queryAll,
  queryOne,
  runStmt,
  findAll,
  findOne,
  insert,
  update,
  remove,
  removeWhere,
  count,
  getOrdersWithDetails,getRestrictionsWithCapacity,getComponentsWithAvailability,
  clearAllData
};