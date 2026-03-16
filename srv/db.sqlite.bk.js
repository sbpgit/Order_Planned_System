// srv/db.js - SQLite via sql.js with file persistence
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = path.join(__dirname, '..', 'planning.db');
let _db = null;
let _SQL = null;
let _dirty = false;
let _initialized = false;

function persist() {
  if (!_db || !_dirty) return;
  try {
    const data = _db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
    _dirty = false;
  } catch (e) { console.error('Persist error:', e.message); }
}

setInterval(persist, 5000);
process.on('exit', persist);
process.on('SIGINT', () => { persist(); process.exit(0); });

async function getDb() {
  if (_db) return _db;
  if (!_SQL) {
    const initSqlJs = require('sql.js');
    _SQL = await initSqlJs();
  }
  if (fs.existsSync(DB_PATH)) {
    const data = fs.readFileSync(DB_PATH);
    _db = new _SQL.Database(data);
  } else {
    _db = new _SQL.Database();
    _createSchema();
    persist();
  }
  _initialized = true;
  return _db;
}

function _createSchema() {
  _db.run(`
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY, product_code TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
      description TEXT, category TEXT, unit_price REAL DEFAULT 0, standard_cost REAL DEFAULT 0,
      lead_time_days INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1,
      created_at TEXT, updated_at TEXT);
    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY, customer_code TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
      priority TEXT DEFAULT 'Medium', contact_person TEXT, email TEXT, phone TEXT,
      is_active INTEGER DEFAULT 1, created_at TEXT, updated_at TEXT);
    CREATE TABLE IF NOT EXISTS restrictions (
      id TEXT PRIMARY KEY, restriction_code TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
      description TEXT, resource_type TEXT, valid_from TEXT, valid_to TEXT,
      penalty_cost_per_unit REAL DEFAULT 100, is_active INTEGER DEFAULT 1,
      created_at TEXT, updated_at TEXT);
    CREATE TABLE IF NOT EXISTS weekly_capacities (
      id TEXT PRIMARY KEY, restriction_id TEXT NOT NULL, year INTEGER NOT NULL,
      week INTEGER NOT NULL, capacity REAL DEFAULT 0,
      UNIQUE(restriction_id, year, week));
    CREATE TABLE IF NOT EXISTS penalty_rules (
      id TEXT PRIMARY KEY, rule_type TEXT NOT NULL, customer_priority TEXT DEFAULT 'All',
      product_id TEXT, penalty_per_day REAL DEFAULT 0, penalty_flat REAL DEFAULT 0, created_at TEXT);
    CREATE TABLE IF NOT EXISTS components (
      id TEXT PRIMARY KEY, component_code TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
      description TEXT, supplier TEXT, unit_cost REAL DEFAULT 0, lead_time_days INTEGER DEFAULT 0,
      min_stock INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1, created_at TEXT, updated_at TEXT);
    CREATE TABLE IF NOT EXISTS component_availability (
      id TEXT PRIMARY KEY, component_id TEXT NOT NULL, year INTEGER NOT NULL,
      week INTEGER NOT NULL, available_qty REAL DEFAULT 0, reserved_qty REAL DEFAULT 0,
      UNIQUE(component_id, year, week));
    CREATE TABLE IF NOT EXISTS sales_orders (
      id TEXT PRIMARY KEY, order_number TEXT UNIQUE NOT NULL, customer_id TEXT NOT NULL,
      product_id TEXT NOT NULL, requested_date TEXT, promise_date TEXT NOT NULL,
      quantity REAL NOT NULL DEFAULT 1, unit_price REAL DEFAULT 0, revenue REAL DEFAULT 0,
      cost REAL DEFAULT 0, priority TEXT DEFAULT 'Medium', status TEXT DEFAULT 'Open',
      notes TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE IF NOT EXISTS order_restrictions (
      id TEXT PRIMARY KEY, sales_order_id TEXT NOT NULL, restriction_id TEXT NOT NULL,
      capacity_usage_per_unit REAL DEFAULT 1, UNIQUE(sales_order_id, restriction_id));
    CREATE TABLE IF NOT EXISTS order_components (
      id TEXT PRIMARY KEY, sales_order_id TEXT NOT NULL, component_id TEXT NOT NULL,
      required_qty_per_unit REAL DEFAULT 1, UNIQUE(sales_order_id, component_id));
    CREATE TABLE IF NOT EXISTS optimization_runs (
      id TEXT PRIMARY KEY, run_number TEXT UNIQUE NOT NULL, description TEXT,
      run_date TEXT, status TEXT DEFAULT 'Running', parameters TEXT,
      total_orders INTEGER DEFAULT 0, on_time_orders INTEGER DEFAULT 0,
      delayed_orders INTEGER DEFAULT 0, total_penalty_cost REAL DEFAULT 0,
      on_time_percentage REAL DEFAULT 0, avg_delay_days REAL DEFAULT 0,
      max_delay_days INTEGER DEFAULT 0, execution_time_ms INTEGER DEFAULT 0, created_at TEXT);
    CREATE TABLE IF NOT EXISTS optimization_results (
      id TEXT PRIMARY KEY, run_id TEXT NOT NULL, sales_order_id TEXT NOT NULL,
      original_date TEXT, optimized_date TEXT, delay_days INTEGER DEFAULT 0,
      penalty_cost REAL DEFAULT 0, feasible INTEGER DEFAULT 1, status TEXT);
    CREATE TABLE IF NOT EXISTS capacity_analysis (
      id TEXT PRIMARY KEY, run_id TEXT NOT NULL, restriction_id TEXT NOT NULL,
      year INTEGER, week INTEGER, capacity REAL DEFAULT 0, required_capacity REAL DEFAULT 0,
      utilization_pct REAL DEFAULT 0, over_capacity REAL DEFAULT 0,
      violation_cost REAL DEFAULT 0, is_critical INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS component_analysis (
      id TEXT PRIMARY KEY, run_id TEXT NOT NULL, component_id TEXT NOT NULL,
      year INTEGER, week INTEGER, available REAL DEFAULT 0, required REAL DEFAULT 0,
      shortage REAL DEFAULT 0, shortage_cost REAL DEFAULT 0, is_critical INTEGER DEFAULT 0);
  `);
  _dirty = true;
}

function runStmt(sql, params = []) {
  _db.run(sql, params);
  _dirty = true;
}

function queryAll(sql, params = []) {
  const stmt = _db.prepare(sql);
  if (params.length) stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function queryOne(sql, params = []) {
  return queryAll(sql, params)[0] || null;
}

function findAll(table, where = {}, orderBy = '') {
  let sql = `SELECT * FROM ${table}`;
  const keys = Object.keys(where), vals = Object.values(where);
  if (keys.length) sql += ' WHERE ' + keys.map(k => `${k} = ?`).join(' AND ');
  if (orderBy) sql += ` ORDER BY ${orderBy}`;
  return queryAll(sql, vals);
}

function findOne(table, where = {}) {
  return findAll(table, where)[0] || null;
}

function insert(table, data) {
  const noTimestamp = ["weekly_capacities","component_availability","order_restrictions","order_components","capacity_analysis","component_analysis","optimization_results"];
  if (!data.id) data.id = uuidv4();
  const now = new Date().toISOString();
  if (!data.created_at && !noTimestamp.includes(table)) data.created_at = now;
  const keys = Object.keys(data);
  const sql = `INSERT OR IGNORE INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`;
  runStmt(sql, Object.values(data));
  return data;
}

function update(table, id, data) {
  const noTimestamp = ["weekly_capacities","component_availability","order_restrictions","order_components","capacity_analysis","component_analysis","optimization_results","optimization_runs","penalty_rules"];
  if (!noTimestamp.includes(table)) data.updated_at = new Date().toISOString();
  const keys = Object.keys(data);
  const sql = `UPDATE ${table} SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`;
  runStmt(sql, [...Object.values(data), id]);
  return findOne(table, { id });
}

function remove(table, id) { runStmt(`DELETE FROM ${table} WHERE id = ?`, [id]); }

function removeWhere(table, where) {
  const keys = Object.keys(where);
  runStmt(`DELETE FROM ${table} WHERE ` + keys.map(k => `${k} = ?`).join(' AND '), Object.values(where));
}

function count(table, where = {}) {
  let sql = `SELECT COUNT(*) as cnt FROM ${table}`;
  const keys = Object.keys(where);
  if (keys.length) sql += ' WHERE ' + keys.map(k => `${k} = ?`).join(' AND ');
  const r = queryOne(sql, Object.values(where));
  return r ? Number(r.cnt) : 0;
}

function getOrdersWithDetails() {
  const orders = queryAll(`
    SELECT so.*, c.name as customer_name, c.priority as customer_priority,
           c.customer_code, p.name as product_name, p.product_code
    FROM sales_orders so
    LEFT JOIN customers c ON so.customer_id = c.id
    LEFT JOIN products p ON so.product_id = p.id
    WHERE so.status IN ('Open','Confirmed')
    ORDER BY so.promise_date ASC
  `);
  for (const order of orders) {
    order.restrictions = queryAll(`
      SELECT or2.*, r.name as restriction_name, r.restriction_code, r.penalty_cost_per_unit
      FROM order_restrictions or2
      JOIN restrictions r ON or2.restriction_id = r.id
      WHERE or2.sales_order_id = ?
    `, [order.id]);
    order.components = queryAll(`
      SELECT oc.*, comp.name as component_name, comp.component_code, comp.unit_cost
      FROM order_components oc
      JOIN components comp ON oc.component_id = comp.id
      WHERE oc.sales_order_id = ?
    `, [order.id]);
  }
  return orders;
}

function getRestrictionsWithCapacity() {
  const restrictions = queryAll(`SELECT * FROM restrictions WHERE is_active = 1`);
  for (const r of restrictions) {
    r.weekly_capacities = queryAll(
      `SELECT * FROM weekly_capacities WHERE restriction_id = ? ORDER BY year, week`, [r.id]);
  }
  return restrictions;
}

function getComponentsWithAvailability() {
  const components = queryAll(`SELECT * FROM components WHERE is_active = 1`);
  for (const c of components) {
    c.availability = queryAll(
      `SELECT * FROM component_availability WHERE component_id = ? ORDER BY year, week`, [c.id]);
  }
  return components;
}

function clearAllData() {
  ['component_analysis','capacity_analysis','optimization_results','optimization_runs',
   'order_components','order_restrictions','sales_orders','component_availability',
   'weekly_capacities','penalty_rules','customers','components','restrictions','products'
  ].forEach(t => runStmt(`DELETE FROM ${t}`));
}

module.exports = {
  getDb, persist, runStmt, queryAll, queryOne,
  findAll, findOne, insert, update, remove, removeWhere, count,
  getOrdersWithDetails, getRestrictionsWithCapacity, getComponentsWithAvailability, clearAllData
};
