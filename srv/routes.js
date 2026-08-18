// srv/routes.js  — fully async for SAP HANA (all db calls are Promises)
'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const moment  = require('moment');
const db      = require('./db');
const { OrderPlanningOptimizer } = require('./optimizer');
const { seedData }               = require('./seedData');
const router = express.Router();

// ─── ACTIVE RUNS: in-memory abort signals for running optimizations ──────────
const activeRuns = new Map(); // runId -> { aborted: false }

// ─── OPTIMIZATION LOCK: block data mutations while an optimization is running ─
async function isOptimizationRunning() {
  try {
    const row = await db.queryOne(
      `SELECT COUNT(*) as cnt FROM OPS_OPTIMIZATION_RUNS WHERE status = 'Running'`
    );
    return row && Number(row.cnt) > 0;
  } catch (e) { return false; }
}

async function guardDataMutation(req, res, next) {
  // Only guard POST/PUT/DELETE, skip optimize endpoint itself and GET requests
  if (req.method === 'GET') return next();
  if (req.path === '/optimize') return next();
  if (/^\/optimize\/.+\/stop$/.test(req.path)) return next();
  // Skip read-only post endpoints (exports, etc.) — none currently exist
  try {
    if (await isOptimizationRunning()) {
      return res.status(423).json({
        error: 'An optimization is currently running. Please wait for it to complete before modifying data.'
      });
    }
  } catch (e) { /* if check fails, allow the request through */ }
  next();
}
router.use(guardDataMutation);

// ─── PRODUCTS ────────────────────────────────────────────────────────────────
router.get('/products', async (req, res) => {
  try { res.json(await db.findAll('products', {}, 'name ASC')); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/products', async (req, res) => {
  try {
    const data = { ...req.body, id: uuidv4() };
    if (!data.product_code || !data.name)
      return res.status(400).json({ error: 'product_code and name required' });
    res.status(201).json(await db.insert('products', data));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/products_bulk', async (req, res) => {
  try {
    const rows = req.body;

    // ✅ Validate array
    if (!Array.isArray(rows)) {
      return res.status(400).json({ error: 'Expected array of products' });
    }

    const validData = [];
    const errors = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];

      if (!row.product_code || !row.name) {
        errors.push({ index: i, error: 'Missing product_code or name' });
        continue;
      }

      validData.push({
        id: uuidv4(),
        product_code: row.product_code,
        name: row.name,
        description: row.description || '',
        category: row.category || '',
        unit_price: parseFloat(row.unit_price) || 0,
        standard_cost: parseFloat(row.standard_cost) || 0,
        lead_time_days: parseInt(row.lead_time_days) || 0,
        is_active: row.is_active ?? true
      });
    }

    // 🚀 BULK INSERT (IMPORTANT)
    const dbOBP = await cds.connect.to('db1');
    const result = await dbOBP.run(INSERT.into('ops_products').entries(validData));

    res.status(201).json({
      inserted: validData.length,
      failed: errors.length,
      errors
    });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/products/:id', async (req, res) => {
  try { res.json(await db.update('products', req.params.id, req.body)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/products/:id', async (req, res) => {
  try { await db.remove('products', req.params.id); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── CUSTOMERS ───────────────────────────────────────────────────────────────
router.get('/customers', async (req, res) => {
  try { res.json(await db.findAll('customers', {}, 'name ASC')); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/customers', async (req, res) => {
  try { res.status(201).json(await db.insert('customers', { ...req.body, id: uuidv4() })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/customers_bulk', async (req, res) => {
  try {
    const rows = req.body;

    // ✅ Validate array
    if (!Array.isArray(rows)) {
      return res.status(400).json({ error: 'Expected array of customers' });
    }

    const validData = [];
    const errors = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];

      if (!row.customer_code || !row.name) {
        errors.push({ index: i, error: 'Missing customer_code or name' });
        continue;
      }

      validData.push({
        id: uuidv4(),
        customer_code: row.customer_code,
        name: row.name,
        priority: row.priority || '',
        contact_person: row.contact_person || '',
        email: row.email,
        phone: row.phone,
        is_active: row.is_active ?? true
      });
    }

    // 🚀 BULK INSERT (IMPORTANT)
    const dbOBP = await cds.connect.to('db1');
    const result = await dbOBP.run(INSERT.into('ops_customers').entries(validData));

    res.status(201).json({
      inserted: validData.length,
      failed: errors.length,
      errors
    });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/customers/:id', async (req, res) => {
  try { res.json(await db.update('customers', req.params.id, req.body)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/customers/:id', async (req, res) => {
  try { await db.remove('customers', req.params.id); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── RESTRICTIONS ─────────────────────────────────────────────────────────────
router.get('/restrictions', async (req, res) => {
  try {
    const { locationId } = req.query;
    const where = locationId ? { location_id: locationId } : {};
    const restrictions = await db.findAll('restrictions', where, 'name ASC');
    for (const r of restrictions)
      r.weekly_capacities = await db.findAll('weekly_capacities',
        { restriction_id: r.id }, 'year ASC, week ASC');
    res.json(restrictions);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/restrictions', async (req, res) => {
  try { res.status(201).json(await db.insert('restrictions', { ...req.body, id: uuidv4() })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/restrictions_bulk', async (req, res) => {
  try {
    const rows = req.body;

    // ✅ Validate array
    if (!Array.isArray(rows)) {
      return res.status(400).json({ error: 'Expected array of restrictions' });
    }

    const validData = [];
    const errors = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];

      if (!row.restriction_code || !row.name) {
        errors.push({ index: i, error: 'Missing restrictions_code or name' });
        continue;
      }

      validData.push({
        id: uuidv4(),
        restriction_code: row.restriction_code,
        name: row.name,
        description: row.description || '',
        resource_type: row.resource_type || '',
        valid_from: row.valid_from,
        valid_to : row.valid_to,
        penalty_cost_per_unit : row.penalty_cost_per_unit,
        is_active: row.is_active ?? true
      });
    }

    // 🚀 BULK INSERT (IMPORTANT)
    const dbOBP = await cds.connect.to('db1');
    const result = await dbOBP.run(INSERT.into('ops_restrictions').entries(validData));

    res.status(201).json({
      inserted: validData.length,
      failed: errors.length,
      errors
    });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/restrictions/:id', async (req, res) => {
  try { res.json(await db.update('restrictions', req.params.id, req.body)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/restrictions/:id', async (req, res) => {
  try { await db.remove('restrictions', req.params.id); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/restrictions/:id/capacities', async (req, res) => {
  try {
    res.json(await db.findAll('weekly_capacities',
      { restriction_id: req.params.id }, 'year ASC, week ASC'));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/restrictions/:id/capacities', async (req, res) => {
  try {
    const { year, week, capacity } = req.body;
    const existing = await db.queryOne(
      'SELECT id FROM weekly_capacities WHERE restriction_id=? AND year=? AND week=?',
      [req.params.id, year, week]);
    if (existing) {
      await db.runStmt('UPDATE OPS_WEEKLY_CAPACITIES SET capacity=? WHERE id=?', [capacity, existing.id]);
      res.json({ id: existing.id, restriction_id: req.params.id, year, week, capacity });
    } else {
      res.status(201).json(await db.insert('weekly_capacities',
        { id: uuidv4(), restriction_id: req.params.id, year, week, capacity }));
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/restrictions/:id/bulk-capacities', async (req, res) => {
  try {
    const { start_year, start_week, num_weeks, capacity } = req.body;
    let y = parseInt(start_year), w = parseInt(start_week);
    let created = 0;
    for (let i = 0; i < num_weeks; i++) {
      await db.insert('weekly_capacities',
        { id: uuidv4(), restriction_id: req.params.id, year: y, week: w, capacity });
      created++;
      w++; if (w > 52) { w = 1; y++; }
    }
    res.json({ created });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/weekly_capacities_bulk', async (req, res) => {
  try {
    const rows = req.body;

    if (!Array.isArray(rows)) {
      return res.status(400).json({ error: 'Expected array' });
    }

    // 🔹 Prepare data
    const data = rows.map(r => ({
      id: uuidv4(),
      restriction_id: r.restriction_id,
      year: parseInt(r.year),
      week: parseInt(r.week),
      capacity: parseFloat(r.capacity) || 0
    }));

    // 🚀 MERGE queries (UPSERT)
    const queries = data.map(d => `
      MERGE INTO OPS_WEEKLY_CAPACITIES AS target
      USING (
        SELECT '${d.restriction_id}' AS restriction_id,
               ${d.year} AS year,
               ${d.week} AS week
        FROM DUMMY
      ) AS src
      ON target.restriction_id = src.restriction_id
         AND target.year = src.year
         AND target.week = src.week

      WHEN MATCHED THEN
        UPDATE SET capacity = ${d.capacity}

      WHEN NOT MATCHED THEN
        INSERT (id, restriction_id, year, week, capacity)
        VALUES ('${d.id}', '${d.restriction_id}', ${d.year}, ${d.week}, ${d.capacity});
    `);

    // 🔥 Execute in sequence (same as your pattern)
    for (const q of queries) {
      await db.runStmt(q);
    }

    res.json({ processed: data.length });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── COMPONENTS ───────────────────────────────────────────────────────────────
router.get('/components', async (req, res) => {
  try {
    const { locationId } = req.query;
    const where = locationId ? { location_id: locationId } : {};
    const components = await db.findAll('components', where, 'name ASC');
    for (const c of components)
      c.availability = await db.findAll('component_availability',
        { component_id: c.id }, 'year ASC, week ASC');
    res.json(components);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/components', async (req, res) => {
  try { res.status(201).json(await db.insert('components', { ...req.body, id: uuidv4() })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/components_bulk', async (req, res) => {
  try {
    const rows = req.body;

    // ✅ Validate array
    if (!Array.isArray(rows)) {
      return res.status(400).json({ error: 'Expected array of components' });
    }

    const validData = [];
    const errors = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];

      if (!row.component_code || !row.name) {
        errors.push({ index: i, error: 'Missing components_code or name' });
        continue;
      }

      validData.push({
        id: uuidv4(),
        component_code: row.component_code,
        name: row.name,
        description: row.description || '',
        supplier: row.supplier || '',
        unit_cost : row.unit_cost,
        lead_time_days : row.lead_time_days,
        min_stock : row.min_stock,
        is_active: row.is_active ?? true
      });
    }

    // 🚀 BULK INSERT (IMPORTANT)
    const dbOBP = await cds.connect.to('db1');
    const result = await dbOBP.run(INSERT.into('ops_components').entries(validData));

    res.status(201).json({
      inserted: validData.length,
      failed: errors.length,
      errors
    });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/components/:id', async (req, res) => {
  try { res.json(await db.update('components', req.params.id, req.body)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/components/:id', async (req, res) => {
  try { await db.remove('components', req.params.id); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/components/:id/availability', async (req, res) => {
  try {
    res.json(await db.findAll('component_availability',
      { component_id: req.params.id }, 'year ASC, week ASC'));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/components/:id/availability', async (req, res) => {
  try {
    const { year, week, available_qty, reserved_qty = 0 } = req.body;
    const existing = await db.queryOne(
      'SELECT id FROM component_availability WHERE component_id=? AND year=? AND week=?',
      [req.params.id, year, week]);
    if (existing) {
      await db.runStmt(
        'UPDATE OPS_COMPONENT_AVAILABILITY SET available_qty=?, reserved_qty=? WHERE id=?',
        [available_qty, reserved_qty, existing.id]);
      res.json({ id: existing.id, component_id: req.params.id, year, week, available_qty, reserved_qty });
    } else {
      res.status(201).json(await db.insert('component_availability',
        { id: uuidv4(), component_id: req.params.id, year, week, available_qty, reserved_qty }));
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/component_availability_bulk', async (req, res) => {
  try {
    const rows = req.body;

    if (!Array.isArray(rows)) {
      return res.status(400).json({ error: 'Expected array' });
    }

    // Add IDs
    const data = rows.map(r => ({
      id: uuidv4(),
      component_id: r.component_id,
      year: r.year,
      week: r.week,
      available_qty: r.available_qty || 0,
      reserved_qty: r.reserved_qty || 0
    }));

    // 🚀 HANA MERGE (UPSERT)
    const queries = data.map(d => `
      MERGE INTO OPS_COMPONENT_AVAILABILITY AS target
      USING (SELECT '${d.component_id}' AS component_id, ${d.year} AS year, ${d.week} AS week FROM DUMMY) AS src
      ON target.component_id = src.component_id AND target.year = src.year AND target.week = src.week
      WHEN MATCHED THEN
        UPDATE SET available_qty = ${d.available_qty}, reserved_qty = ${d.reserved_qty}
      WHEN NOT MATCHED THEN
        INSERT (id, component_id, year, week, available_qty, reserved_qty)
        VALUES ('${d.id}', '${d.component_id}', ${d.year}, ${d.week}, ${d.available_qty}, ${d.reserved_qty});
    `);

    // ⚠️ Run in transaction
    for (const q of queries) {
      await db.runStmt(q);
    }

    res.json({ processed: data.length });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── PENALTY RULES ────────────────────────────────────────────────────────────
router.get('/penalty-rules', async (req, res) => {
  try {
    res.json(await db.findAll('penalty_rules', {}, 'rule_type ASC, customer_priority ASC'));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/penalty-rules', async (req, res) => {
  try { res.status(201).json(await db.insert('penalty_rules', { ...req.body, id: uuidv4() })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/penalty_rules_bulk', async (req, res) => {
  try {
    const rows = req.body;

    // ✅ Validate array
    if (!Array.isArray(rows)) {
      return res.status(400).json({ error: 'Expected array of penalty rules' });
    }

    const validData = [];
    const errors = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];

      if (!row.rule_type || !row.customer_priority) {
        errors.push({ index: i, error: 'Missing penalty rule or cusomter priority' });
        continue;
      }

      validData.push({
        id: uuidv4(),
        rule_type: row.rule_type,
        customer_priority: row.customer_priority,
        // product_id: row.product_id || '',
        penalty_per_day: row.penalty_per_day,
        penalty_flat: row.penalty_flat,
      });
    }

    // 🚀 BULK INSERT (IMPORTANT)
    const dbOBP = await cds.connect.to('db1');
    const result = await dbOBP.run(INSERT.into('ops_penalty_rules').entries(validData));

    res.status(201).json({
      inserted: validData.length,
      failed: errors.length,
      errors
    });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/penalty-rules/:id', async (req, res) => {
  try {
    const { id: _id, ...data } = req.body;
    await db.runStmt(
      `UPDATE OPS_PENALTY_RULES SET rule_type=?, customer_priority=?, product_id=?,
       penalty_per_day=?, penalty_flat=? WHERE id=?`,
      [data.rule_type, data.customer_priority, data.product_id || null,
       data.penalty_per_day, data.penalty_flat, req.params.id]);
    res.json(await db.findOne('penalty_rules', { id: req.params.id }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/penalty-rules/:id', async (req, res) => {
  try { await db.remove('penalty_rules', req.params.id); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── SALES ORDERS ─────────────────────────────────────────────────────────────
router.get('/sales-orders', async (req, res) => {
  try {
    const { locationId } = req.query;
    const whereClause = locationId ? `WHERE so.location_id = ?` : '';
    const params = locationId ? [locationId] : [];
    res.json(await db.queryAll(`
      SELECT so.*, c.name AS customer_name, c.priority AS customer_priority,
             c.customer_code, p.name AS product_name, p.product_code
      FROM   sales_orders so
      LEFT JOIN customers c ON so.customer_id = c.id
      LEFT JOIN products  p ON so.product_id  = p.id
      ${whereClause}
      ORDER BY so.promise_date ASC`, params));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/sales_orders_bulk', async (req, res) => {
  try {
    const rows = req.body;

    // ✅ Validate array
    if (!Array.isArray(rows)) {
      return res.status(400).json({ error: 'Expected array of sales orders' });
    }

    const validData = [];
    const errors = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];

      if (!row.order_number || !row.customer_id || !row.product_id) {
        errors.push({ index: i, error: 'Missing order number/customer/product code' });
        continue;
      }
      const revenue= row.unit_price * row.quantity;
      // const cost= rows.standard_cost * rows.quantity;

      validData.push({
        id: uuidv4(),
        order_number: row.order_number,
        customer_id: row.customer_id,
        product_id: row.product_id || '',
        requested_date: row.requested_date,
        promise_date: row.promise_date,
        quantity: (row.quantity) || 1,
        unit_price: (row.unit_price) || 0,
        revenue: revenue || 0,
        cost: (row.cost) || 0,
        priority: row.priority || 'Medium',
        status: row.status || 'Open',
        notes: row.notes || ''
      });
    }

    // 🚀 BULK INSERT (IMPORTANT)
    const dbOBP = await cds.connect.to('db1');
    const result = await dbOBP.run(INSERT.into('ops_sales_orders').entries(validData));

    res.status(201).json({
      inserted: validData.length,
      failed: errors.length,
      errors
    });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/sales-orders/:id', async (req, res) => {
  try {
    const order = await db.queryOne(`
      SELECT so.*, c.name AS customer_name, c.priority AS customer_priority,
             c.customer_code, p.name AS product_name, p.product_code
      FROM   sales_orders so
      LEFT JOIN customers c ON so.customer_id = c.id
      LEFT JOIN products  p ON so.product_id  = p.id
      WHERE  so.id = ?`, [req.params.id]);
    if (!order) return res.status(404).json({ error: 'Not found' });

    order.restrictions = await db.queryAll(`
      SELECT or2.*, r.name AS restriction_name, r.restriction_code
      FROM   order_restrictions or2
      JOIN   restrictions r ON or2.restriction_id = r.id
      WHERE  or2.sales_order_id = ?`, [req.params.id]);

    order.components = await db.queryAll(`
      SELECT oc.*, comp.name AS component_name, comp.component_code, comp.unit_cost
      FROM   order_components oc
      JOIN   components comp ON oc.component_id = comp.id
      WHERE  oc.sales_order_id = ?`, [req.params.id]);

    res.json(order);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/sales-orders', async (req, res) => {
  try {
    const data = { ...req.body, id: uuidv4() };
    if (!data.order_number) {
      const last = await db.queryOne(
        // `SELECT order_number FROM OPS_SALES_ORDERS ORDER BY created_at DESC FETCH FIRST 1 ROWS ONLY`
      `SELECT order_number FROM OPS_SALES_ORDERS ORDER BY created_at DESC LIMIT 1`
      );
      const n = last ? parseInt(last.order_number.replace('SO-', '')) + 1 : 1;
      data.order_number = `SO-${String(n).padStart(4, '0')}`;
    }
    if (data.quantity && data.unit_price) data.revenue = data.quantity * data.unit_price;
    res.status(201).json(await db.insert('sales_orders', data));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/sales-orders/:id', async (req, res) => {
  try {
    const { restrictions, components, ...orderData } = req.body;
    if (orderData.quantity && orderData.unit_price)
      orderData.revenue = orderData.quantity * orderData.unit_price;
    const updated = await db.update('sales_orders', req.params.id, orderData);

    if (restrictions !== undefined) {
      await db.removeWhere('order_restrictions', { sales_order_id: req.params.id });
      for (const r of restrictions)
        await db.insert('order_restrictions', {
          id: uuidv4(), sales_order_id: req.params.id,
          restriction_id: r.restriction_id,
          capacity_usage_per_unit: r.capacity_usage_per_unit || 1
        });
    }
    if (components !== undefined) {
      await db.removeWhere('order_components', { sales_order_id: req.params.id });
      for (const c of components)
        await db.insert('order_components', {
          id: uuidv4(), sales_order_id: req.params.id,
          component_id: c.component_id,
          required_qty_per_unit: c.required_qty_per_unit || 1
        });
    }
    res.json(updated);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/sales-orders/:id', async (req, res) => {
  try { await db.remove('sales_orders', req.params.id); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/sales-orders/:id/restrictions', async (req, res) => {
  try {
    const { restriction_id, capacity_usage_per_unit = 1 } = req.body;
    const existing = await db.queryOne(
      'SELECT id FROM order_restrictions WHERE sales_order_id=? AND restriction_id=?',
      [req.params.id, restriction_id]);
    if (existing) return res.json({ message: 'Already linked' });
    res.status(201).json(await db.insert('order_restrictions', {
      id: uuidv4(), sales_order_id: req.params.id, restriction_id, capacity_usage_per_unit
    }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/sales-orders/:id/restrictions/:rid', async (req, res) => {
  try {
    await db.runStmt(
      'DELETE FROM OPS_ORDER_RESTRICTIONS WHERE sales_order_id=? AND restriction_id=?',
      [req.params.id, req.params.rid]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/sales-orders/:id/components', async (req, res) => {
  try {
    const { component_id, required_qty_per_unit = 1 } = req.body;
    const existing = await db.queryOne(
      'SELECT id FROM order_components WHERE sales_order_id=? AND component_id=?',
      [req.params.id, component_id]);
    if (existing) {
      await db.runStmt(
        'UPDATE OPS_ORDER_COMPONENTS SET required_qty_per_unit=? WHERE id=?',
        [required_qty_per_unit, existing.id]);
      return res.json({ ...existing, required_qty_per_unit });
    }
    res.status(201).json(await db.insert('order_components', {
      id: uuidv4(), sales_order_id: req.params.id, component_id, required_qty_per_unit
    }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/sales-orders/:id/components/:cid', async (req, res) => {
  try {
    await db.runStmt(
      'DELETE FROM OPS_ORDER_COMPONENTS WHERE sales_order_id=? AND component_id=?',
      [req.params.id, req.params.cid]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── ORDER RESTRICTIONS BULK ─────────────────────────────────────────────────
// Accepts rows with product_code + restriction_code from Excel.
// Resolves codes to IDs and creates order_restriction entries for all
// sales orders matching each product_code.
router.post('/order_restrictions_bulk', async (req, res) => {
  try {
    const rows = req.body;

    if (!Array.isArray(rows)) {
      return res.status(400).json({ error: 'Expected array of order restrictions' });
    }

    // Build lookup maps: code → id
    const allProducts = await db.queryAll(`SELECT id, product_code FROM OPS_PRODUCTS`);
    const productByCode = {};
    allProducts.forEach(p => { productByCode[p.product_code || p.PRODUCT_CODE] = p.id || p.ID; });

    const allRestrictions = await db.queryAll(`SELECT id, restriction_code FROM OPS_RESTRICTIONS`);
    const restrictionByCode = {};
    allRestrictions.forEach(r => { restrictionByCode[r.restriction_code || r.RESTRICTION_CODE] = r.id || r.ID; });

    // Get all sales orders grouped by product_id
    const allOrders = await db.queryAll(`SELECT id, product_id FROM OPS_SALES_ORDERS`);
    const ordersByProductId = {};
    allOrders.forEach(o => {
      const pid = o.product_id || o.PRODUCT_ID;
      if (!ordersByProductId[pid]) ordersByProductId[pid] = [];
      ordersByProductId[pid].push(o.id || o.ID);
    });

    const validData = [];
    const errors = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];

      if (!row.product_code || !row.restriction_code) {
        errors.push({ index: i, error: 'Missing product_code or restriction_code' });
        continue;
      }

      const productId = productByCode[row.product_code];
      const restrictionId = restrictionByCode[row.restriction_code];

      if (!productId) { errors.push({ index: i, error: `Unknown product_code: ${row.product_code}` }); continue; }
      if (!restrictionId) { errors.push({ index: i, error: `Unknown restriction_code: ${row.restriction_code}` }); continue; }

      const orderIds = ordersByProductId[productId] || [];
      for (const salesOrderId of orderIds) {
        validData.push({
          id: uuidv4(),
          sales_order_id: salesOrderId,
          restriction_id: restrictionId,
          capacity_usage_per_unit: row.capacity_usage_per_unit || 1
        });
      }
    }

    if (validData.length > 0) {
      const dbOBP = await cds.connect.to('db1');
      await dbOBP.run(INSERT.into('ops_order_restrictions').entries(validData));
    }

    res.status(201).json({
      inserted: validData.length,
      failed: errors.length,
      errors
    });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── ORDER COMPONENTS BULK ──────────────────────────────────────────────────
// Accepts rows with product_code + component_code from Excel.
// Resolves codes to IDs and creates order_component entries for all
// sales orders matching each product_code.
router.post('/order_components_bulk', async (req, res) => {
  try {
    const rows = req.body;

    if (!Array.isArray(rows)) {
      return res.status(400).json({ error: 'Expected array of order components' });
    }

    // Build lookup maps: code → id
    const allProducts = await db.queryAll(`SELECT id, product_code FROM OPS_PRODUCTS`);
    const productByCode = {};
    allProducts.forEach(p => { productByCode[p.product_code || p.PRODUCT_CODE] = p.id || p.ID; });

    const allComponents = await db.queryAll(`SELECT id, component_code FROM OPS_COMPONENTS`);
    const componentByCode = {};
    allComponents.forEach(c => { componentByCode[c.component_code || c.COMPONENT_CODE] = c.id || c.ID; });

    // Get all sales orders grouped by product_id
    const allOrders = await db.queryAll(`SELECT id, product_id FROM OPS_SALES_ORDERS`);
    const ordersByProductId = {};
    allOrders.forEach(o => {
      const pid = o.product_id || o.PRODUCT_ID;
      if (!ordersByProductId[pid]) ordersByProductId[pid] = [];
      ordersByProductId[pid].push(o.id || o.ID);
    });

    const validData = [];
    const errors = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];

      if (!row.product_code || !row.component_code) {
        errors.push({ index: i, error: 'Missing product_code or component_code' });
        continue;
      }

      const productId = productByCode[row.product_code];
      const componentId = componentByCode[row.component_code];

      if (!productId) { errors.push({ index: i, error: `Unknown product_code: ${row.product_code}` }); continue; }
      if (!componentId) { errors.push({ index: i, error: `Unknown component_code: ${row.component_code}` }); continue; }

      const orderIds = ordersByProductId[productId] || [];
      for (const salesOrderId of orderIds) {
        validData.push({
          id: uuidv4(),
          sales_order_id: salesOrderId,
          component_id: componentId,
          required_qty_per_unit: row.required_qty_per_unit || row.required_usage_per_unit || 1
        });
      }
    }

    if (validData.length > 0) {
      const dbOBP = await cds.connect.to('db1');
      await dbOBP.run(INSERT.into('ops_order_components').entries(validData));
    }

    res.status(201).json({
      inserted: validData.length,
      failed: errors.length,
      errors
    });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── OPTIMIZATION ─────────────────────────────────────────────────────────────
router.post('/optimize', async (req, res) => {
  const startTime = Date.now();
  const {
    description     = 'Planning Run',
    population_size = 50,
    generations,
    time_limit_hrs,
    mutation_rate   = 0.1,
    crossover_rate  = 0.8,
    locationId,
    promise_date_from,
    promise_date_to,
    early_scheduling = false,
    early_weeks      = 0
  } = req.body;

  // Clamp pull-forward window to 1-3 weeks; force to 0 when the toggle is off
  const earlyScheduling = early_scheduling === true;
  const earlyWeeks      = earlyScheduling ? Math.min(3, Math.max(1, parseInt(early_weeks, 10) || 1)) : 0;

  const runId     = uuidv4();
  const runNumber = `RUN-${moment().utcOffset('+05:30').format('YYYYMMDD-HHmmss')}`;

  try {
    await db.insert('optimization_runs', {
      id: runId, run_number: runNumber, description, location_id: locationId || null,
      status: 'Running', run_date: new Date(),
      parameters: JSON.stringify({ population_size, generations, time_limit_hrs: time_limit_hrs || null, mutation_rate, crossover_rate, promise_date_from: promise_date_from || null, promise_date_to: promise_date_to || null, early_scheduling: earlyScheduling, early_weeks: earlyWeeks })
    });

    const orders       = await db.getOrdersWithDetails(locationId, promise_date_from, promise_date_to);
    const restrictions = await db.getRestrictionsWithCapacity(locationId);
    const components   = await db.getComponentsWithAvailability(locationId);
    const penaltyRules = await db.findAll('penalty_rules');
    console.log(penaltyRules);

    // ── Build order restrictions & components dynamically from SAP BOM (only for selected orders) ──
    const cf = await cds.connect.to('db');
    const BOMUID = await cf.run(SELECT.from('CP_BOM_UID').columns(r => {
      r.PRODUCT_ID, r.UNIQUE_ID, r.ASSEMBLY, r.RULE_TYPE, r.ASMB_QTY
    }).where({ LOCATION_ID: locationId }));

    const productRestrictionMap = {};
    const productComponentMap   = {};
    BOMUID.filter(b => b.RULE_TYPE === 'RT').forEach(b => {
      const key = b.PRODUCT_ID + '_' + b.UNIQUE_ID;
      (productRestrictionMap[key] = productRestrictionMap[key] || []).push(b.ASSEMBLY);
    });
    BOMUID.filter(b => b.RULE_TYPE === 'PI').forEach(b => {
      const key = b.PRODUCT_ID + '_' + b.UNIQUE_ID;
      (productComponentMap[key] = productComponentMap[key] || []).push([b.ASSEMBLY, Number(b.ASMB_QTY)]);
    });

    const restrictionByCode = Object.fromEntries(restrictions.map(r => [r.restriction_code, r]));
    const componentByCode   = Object.fromEntries(components.map(c => [c.component_code, c]));

    for (const order of orders) {
      const key = order.product_code + '_' + order.unique_id;
      order.restrictions = (productRestrictionMap[key] || [])
        .map(code => restrictionByCode[code]).filter(Boolean)
        .map(r => ({ restriction_id: r.id, restriction_name: r.name, capacity_usage_per_unit: 1 }));
      order.components = (productComponentMap[key] || [])
        .map(([code, qty]) => [componentByCode[code], qty]).filter(([c]) => c)
        .map(([c, qty]) => ({ component_id: c.id, component_name: c.name, required_qty_per_unit: qty }));
    }

    if (orders.length === 0) {
      await db.update('optimization_runs', runId, { status: 'Failed' });
      return res.status(400).json({ error: 'No open orders found' });
    }

    if (restrictions.length === 0) {
      await db.update('optimization_runs', runId, { status: 'Failed' });
      return res.status(400).json({ error: 'No restrictions found' });
    }

    if (components.length === 0) {
      await db.update('optimization_runs', runId, { status: 'Failed' });
      return res.status(400).json({ error: 'No components found' });
    }

    // ── Pre-validation: reject if ALL weekly capacities are 0 for any restriction ──
    for (const restriction of restrictions) {
      const caps = restriction.weekly_capacities || [];
      if (caps.length === 0 || caps.every(c => Number(c.capacity) <= 0)) {
        await db.update('optimization_runs', runId, { status: 'Failed' });
        return res.status(400).json({
          error: `Optimization rejected: Weekly capacity is 0 for all weeks for restriction "${restriction.restriction_name || restriction.restriction_code || restriction.id}". Please set valid capacity values before optimizing.`
        });
      }
    }

    // ── Pre-validation: reject if ALL component availability is 0 for any component ──
    for (const component of components) {
      const avails = component.availability || [];
      if (avails.length === 0 || avails.every(a => Number(a.available_qty) <= 0)) {
        await db.update('optimization_runs', runId, { status: 'Failed' });
        return res.status(400).json({
          error: `Optimization rejected: Component availability is 0 for all weeks for component "${component.component_name || component.component_code || component.id}". Please set valid availability values before optimizing.`
        });
      }
    }

    await db.runStmt('UPDATE OPS_OPTIMIZATION_RUNS SET total_orders=? WHERE id=?', [orders.length, runId]);

    const optimizer = new OrderPlanningOptimizer({
      populationSize: population_size,
      generations,
      timeLimitHrs: time_limit_hrs || null,
      mutationRate: mutation_rate,
      crossoverRate: crossover_rate,
      earlyScheduling,
      earlyWeeks
    });

    // Respond immediately — optimization runs in background so proxy timeouts don't kill it
    const signal = { aborted: false };
    activeRuns.set(runId, signal);
    res.json({ runId, runNumber, status: 'Running' });

    _runOptimizationAsync(runId, orders, restrictions, components, penaltyRules, optimizer, startTime, signal)
      .catch(async (e) => {
        console.error('Optimization background error:', e);
        await db.runStmt('UPDATE OPS_OPTIMIZATION_RUNS SET status=? WHERE id=?', ['Failed', runId]).catch(() => {});
      })
      .finally(() => activeRuns.delete(runId));

  } catch (e) {
    console.error('Optimization error:', e);
    await db.runStmt('UPDATE OPS_OPTIMIZATION_RUNS SET status=? WHERE id=?', ['Failed', runId]).catch(() => {});
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
});

async function _runOptimizationAsync(runId, orders, restrictions, components, penaltyRules, optimizer, startTime, signal) {
  // Persist BOM-derived restrictions/components so the order detail modal can display them
  for (const order of orders) {
    if (order.restrictions && order.restrictions.length > 0) {
      await db.removeWhere('order_restrictions', { sales_order_id: order.id });
      for (const r of order.restrictions) {
        await db.insert('order_restrictions', {
          id: uuidv4(), sales_order_id: order.id,
          restriction_id: r.restriction_id,
          capacity_usage_per_unit: r.capacity_usage_per_unit || 1
        });
      }
    }
    if (order.components && order.components.length > 0) {
      await db.removeWhere('order_components', { sales_order_id: order.id });
      for (const c of order.components) {
        await db.insert('order_components', {
          id: uuidv4(), sales_order_id: order.id,
          component_id: c.component_id,
          required_qty_per_unit: c.required_qty_per_unit || 1
        });
      }
    }
  }

  const genLogBuffer = [];
  let lastGenFitness = null;
  const onGenerationComplete = async (generation, bestFitness, avgFitness) => {
    lastGenFitness = bestFitness;
    genLogBuffer.push({
      id: uuidv4(), run_id: runId, generation,
      best_fitness: bestFitness, avg_fitness: avgFitness,
      logged_at: new Date().toISOString()
    });
    if (genLogBuffer.length >= 10) {
      await db.bulkInsert('optimization_gen_log', [...genLogBuffer]);
      genLogBuffer.length = 0;
    }
  };

  const result = await optimizer.optimize(orders, restrictions, components, penaltyRules, signal, onGenerationComplete);

  // Flush any remaining buffered generations
  if (genLogBuffer.length > 0) await db.bulkInsert('optimization_gen_log', [...genLogBuffer]);

  // If post-processing (pull-forward) improved fitness, append a final entry so
  // the convergence chart's last point matches the Total Penalty KPI
  if (lastGenFitness !== null && result.bestFitness < lastGenFitness) {
    await db.bulkInsert('optimization_gen_log', [{
      id: uuidv4(), run_id: runId,
      generation: result.generationsRun + 1,
      best_fitness: result.bestFitness,
      avg_fitness: result.bestFitness,
      logged_at: new Date().toISOString()
    }]);
  }

  let onTimeCount = 0, totalDelay = 0, maxDelay = 0;

  const resultRows = [];
  for (const order of orders) {
    const optimizedDate = result.bestSolution[order.id];
    const originalDate  = order.promise_date;
    const delayDays     = moment(optimizedDate).diff(moment(originalDate), 'days');
    const weekDiff      = moment(optimizedDate).startOf('isoWeek').diff(moment(originalDate).startOf('isoWeek'), 'weeks');
    const penaltyCost   = result.details.orderPenalties?.[order.id] || 0;

    if (weekDiff <= 0) onTimeCount++;
    else { totalDelay += delayDays; maxDelay = Math.max(maxDelay, delayDays); }

    resultRows.push({
      id: uuidv4(), run_id: runId, sales_order_id: order.id,
      original_date: originalDate, optimized_date: optimizedDate,
      delay_days: delayDays, penalty_cost: penaltyCost,
      feasible: weekDiff <= 0 ? 1 : 0,
      status: weekDiff < 0 ? `Early ${Math.abs(delayDays)}d` : weekDiff === 0 ? 'On Time' : `Delayed ${delayDays}d`
    });
  }
  if (resultRows.length) await db.bulkInsert('optimization_results', resultRows);

  const capRows = [];
  for (const [restId, weeklyUsage] of Object.entries(result.details.weeklyCapacityUsage || {})) {
    const restriction = restrictions.find(r => r.id === restId);
    for (const [weekKey, usage] of Object.entries(weeklyUsage)) {
      const [yr, wk]  = weekKey.split('-').map(Number);
      const capEntry  = restriction?.weekly_capacities?.find(c => c.year === yr && c.week === wk);
      const capacity  = capEntry?.capacity || 0;
      const overCap   = Math.max(0, usage - capacity);
      capRows.push({
        id: uuidv4(), run_id: runId, restriction_id: restId,
        year: yr, week: wk, capacity, required_capacity: usage,
        utilization_pct: capacity > 0 ? (usage / capacity) * 100 : 100,
        over_capacity: overCap,
        violation_cost: overCap * (restriction?.penalty_cost_per_unit || 100),
        is_critical: overCap > 0 ? 1 : 0
      });
    }
  }
  if (capRows.length) await db.bulkInsert('capacity_analysis', capRows);

  const compRows = [];
  for (const [compId, weeklyUsage] of Object.entries(result.details.weeklyComponentUsage || {})) {
    const component = components.find(c => c.id === compId);
    for (const [weekKey, required] of Object.entries(weeklyUsage)) {
      const [yr, wk]   = weekKey.split('-').map(Number);
      const availEntry = component?.availability?.find(a => a.year === yr && a.week === wk);
      const available  = availEntry?.available_qty || 0;
      const shortage   = Math.max(0, required - available);
      compRows.push({
        id: uuidv4(), run_id: runId, component_id: compId,
        year: yr, week: wk, available, required,
        shortage, shortage_cost: shortage * (component?.unit_cost || 10) * 3,
        is_critical: shortage > 0 ? 1 : 0
      });
    }
  }
  if (compRows.length) await db.bulkInsert('component_analysis', compRows);

  const avgDelay  = orders.length > 0 ? totalDelay / orders.length : 0;
  const onTimePct = orders.length > 0 ? (onTimeCount / orders.length) * 100 : 0;
  const execTime  = Date.now() - startTime;

  await db.update('optimization_runs', runId, {
    status: result.aborted ? 'Aborted' : 'Completed',
    on_time_orders: onTimeCount,
    delayed_orders: orders.length - onTimeCount,
    total_penalty_cost: result.bestFitness, on_time_percentage: onTimePct,
    avg_delay_days: avgDelay, max_delay_days: maxDelay, execution_time_ms: execTime
  });
}

// ─── STOP OPTIMIZATION ────────────────────────────────────────────────────────
router.post('/optimize/:id/stop', async (req, res) => {
  const signal = activeRuns.get(req.params.id);
  if (!signal) return res.status(404).json({ error: 'No active optimization with that ID' });
  signal.aborted = true;
  res.json({ success: true });
});

// ─── GEN LOG ──────────────────────────────────────────────────────────────────
router.get('/optimization-runs/:id/gen-log', async (req, res) => {
  try {
    const rows = await db.queryAll(
      `SELECT generation, best_fitness, avg_fitness, logged_at
       FROM OPS_OPTIMIZATION_GEN_LOG WHERE run_id = ?
       ORDER BY generation ASC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── OPTIMIZATION RUNS ────────────────────────────────────────────────────────
router.get('/optimization-runs', async (req, res) => {
  try {
    const { locationId } = req.query;
    const where = locationId ? { location_id: locationId } : {};
    res.json(await db.findAll('optimization_runs', where, 'run_date DESC'));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/optimization-runs/:id', async (req, res) => {
  try {
    const run = await db.findOne('optimization_runs', { id: req.params.id });
    if (!run) return res.status(404).json({ error: 'Not found' });

    run.order_results = await db.queryAll(`
      SELECT or2.*, so.order_number, so.promise_date, so.quantity, so.priority,
             c.name AS customer_name, p.name AS product_name
      FROM   optimization_results or2
      JOIN   sales_orders so ON or2.sales_order_id = so.id
      LEFT JOIN customers c  ON so.customer_id = c.id
      LEFT JOIN products  p  ON so.product_id  = p.id
      WHERE  or2.run_id = ?
      ORDER BY or2.delay_days DESC`, [req.params.id]);

    run.capacity_analysis = await db.queryAll(`
      SELECT ca.*, r.name AS restriction_name, r.restriction_code
      FROM   capacity_analysis ca
      JOIN   restrictions r ON ca.restriction_id = r.id
      WHERE  ca.run_id = ?
      ORDER BY ca.is_critical DESC, ca.utilization_pct DESC`, [req.params.id]);

    run.component_analysis = await db.queryAll(`
      SELECT ca.*, comp.name AS component_name, comp.component_code
      FROM   component_analysis ca
      JOIN   components comp ON ca.component_id = comp.id
      WHERE  ca.run_id = ?
      ORDER BY ca.is_critical DESC, ca.shortage DESC`, [req.params.id]);

    res.json(run);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Returns blocking components for an order that cannot be fulfilled in any week
router.get('/optimization-runs/:runId/structural-infeasibility/:orderId', async (req, res) => {
  try {
    const orderComponents = await db.queryAll(`
      SELECT oc.component_id, oc.required_qty_per_unit, so.quantity,
             c.name AS component_name, c.component_code
      FROM   order_components oc
      JOIN   sales_orders so ON oc.sales_order_id = so.id
      JOIN   components   c  ON oc.component_id   = c.id
      WHERE  so.id = ?`, [req.params.orderId]);

    const blocking = [];
    for (const oc of orderComponents) {
      const maxRow = await db.queryOne(
        `SELECT MAX(available_qty) AS max_avail FROM component_availability WHERE component_id = ?`,
        [oc.component_id]
      );
      const needed   = (Number(oc.required_qty_per_unit) || 1) * Number(oc.quantity);
      const maxAvail = Number(maxRow?.max_avail || 0);
      if (needed > maxAvail) {
        blocking.push({
          component_name: oc.component_name,
          component_code: oc.component_code,
          required:       needed,
          max_available:  maxAvail,
          shortage:       needed - maxAvail
        });
      }
    }
    res.json({ blocking });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
router.get('/dashboard', async (req, res) => {
  try {
    const today = moment().utcOffset('+05:30').format('YYYY-MM-DD');
    const { locationId } = req.query;

    const [
      totalProducts, totalCustomers, totalRestrictions, totalComponents,
      totalOrders, openOrders, confirmedOrders, overdueRow, lastRun,
      capacityStatus, compStatus
    ] = await Promise.all([
      db.queryOne(`SELECT COUNT(DISTINCT "PRODUCT_CODE") AS cnt FROM "OPS_PRODUCTS"`),
      db.count('customers'),
      db.count('restrictions', locationId ? { location_id: locationId } : {}),
      db.count('components',   locationId ? { location_id: locationId } : {}),
      db.count('sales_orders', locationId ? { location_id: locationId } : {}),
      db.count('sales_orders', locationId ? { location_id: locationId, status: 'Open' }      : { STATUS: 'Open' }),
      db.count('sales_orders', locationId ? { location_id: locationId, status: 'Confirmed' } : { STATUS: 'Confirmed' }),
      db.queryOne(
        `SELECT COUNT(*) AS cnt FROM OPS_SALES_ORDERS
         WHERE promise_date < ? AND status IN ('Open','Confirmed')${locationId ? ` AND location_id = ?` : ''}`,
        locationId ? [today, locationId] : [today]),
      db.queryOne(
        `SELECT * FROM OPS_OPTIMIZATION_RUNS${locationId ? ` WHERE location_id = ?` : ''} ORDER BY run_date DESC LIMIT 1`,
        locationId ? [locationId] : []),
      db.queryAll(`
        SELECT r.name, r.restriction_code,
               AVG(wc.capacity) AS avg_capacity, COUNT(wc.id) AS week_count
        FROM   restrictions r
        LEFT JOIN weekly_capacities wc ON r.id = wc.restriction_id
        WHERE  r.is_active = true${locationId ? ` AND r.location_id = ?` : ''}
        GROUP BY r.id, r.name, r.restriction_code`,
        locationId ? [locationId] : []),
      db.queryAll(`
        SELECT comp.name, comp.component_code, comp.min_stock,
               COALESCE(SUM(ca.available_qty), 0) AS total_available
        FROM   components comp
        LEFT JOIN component_availability ca ON comp.id = ca.component_id
        WHERE  comp.is_active = true${locationId ? ` AND comp.location_id = ?` : ''}
        GROUP BY comp.id, comp.name, comp.component_code, comp.min_stock`,
        locationId ? [locationId] : [])
    ]);

    res.json({
      total_products: totalProducts ? Number(totalProducts.cnt) : 0, total_customers: totalCustomers,
      total_restrictions: totalRestrictions, total_components: totalComponents,
      total_orders: totalOrders, open_orders: openOrders,
      confirmed_orders: confirmedOrders,
      overdue_orders: overdueRow ? Number(overdueRow.cnt) : 0,
      last_run: lastRun,
      capacity_status: capacityStatus,
      component_status: compStatus.map(c => ({
        ...c,
        shortage_risk: c.total_available < c.min_stock * 4 ? 'High' :
                       c.total_available < c.min_stock * 8 ? 'Medium' : 'Low'
      }))
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── LOCATIONS ────────────────────────────────────────────────────────────────
router.get('/locations', async (_req, res) => {
  try {
    const cf = await cds.connect.to('db');
    const rows = await cf.run(SELECT.from('CP_LOCATION'));
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── SEED / CLEAR ─────────────────────────────────────────────────────────────
router.post('/seed', async (req, res) => {
  const { locationId } = req.body || {};
  if (!locationId) return res.status(400).json({ error: 'locationId is required' });
  try { res.json({ success: true, ...(await seedData(locationId)) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/clear-data', async (req, res) => {
  const locationId = req.query.locationId || (req.body && req.body.locationId);
  if (!locationId) return res.status(400).json({ error: 'locationId is required' });
  try {
    await db.clearAllData(locationId);
    res.json({ success: true, message: `Data cleared for location: ${locationId}` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
