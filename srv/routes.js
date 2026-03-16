// srv/routes.js  — fully async for SAP HANA (all db calls are Promises)
'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const moment  = require('moment');
const db      = require('./db');
const { OrderPlanningOptimizer } = require('./optimizer');
const { seedData }               = require('./seedData');

const router = express.Router();

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
    const restrictions = await db.findAll('restrictions', {}, 'name ASC');
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

// ─── COMPONENTS ───────────────────────────────────────────────────────────────
router.get('/components', async (req, res) => {
  try {
    const components = await db.findAll('components', {}, 'name ASC');
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
    res.json(await db.queryAll(`
      SELECT so.*, c.name AS customer_name, c.priority AS customer_priority,
             c.customer_code, p.name AS product_name, p.product_code
      FROM   sales_orders so
      LEFT JOIN customers c ON so.customer_id = c.id
      LEFT JOIN products  p ON so.product_id  = p.id
      ORDER BY so.promise_date ASC`));
  } catch (e) { res.status(500).json({ error: e.message }); }
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

// ─── OPTIMIZATION ─────────────────────────────────────────────────────────────
router.post('/optimize', async (req, res) => {
  const startTime = Date.now();
  const {
    description    = 'Planning Run',
    population_size = 50,
    generations     = 100,
    mutation_rate   = 0.1,
    crossover_rate  = 0.8
  } = req.body;

  const runId     = uuidv4();
  const runNumber = `RUN-${moment().format('YYYYMMDD-HHmmss')}`;

  try {
    await db.insert('optimization_runs', {
      id: runId, run_number: runNumber, description,
      status: 'Running', run_date: new Date(),
      parameters: JSON.stringify({ population_size, generations, mutation_rate, crossover_rate })
    });

    const orders       = await db.getOrdersWithDetails();
    const restrictions = await db.getRestrictionsWithCapacity();
    const components   = await db.getComponentsWithAvailability();
    const penaltyRules = await db.findAll('penalty_rules');

    if (orders.length === 0) {
      await db.update('optimization_runs', runId, { status: 'Failed' });
      return res.status(400).json({ error: 'No open orders found' });
    }

    await db.runStmt('UPDATE OPS_OPTIMIZATION_RUNS SET total_orders=? WHERE id=?', [orders.length, runId]);

    const optimizer = new OrderPlanningOptimizer({
      populationSize: population_size, generations,
      mutationRate: mutation_rate, crossoverRate: crossover_rate
    });
    const result = await optimizer.optimize(orders, restrictions, components, penaltyRules);

    let onTimeCount = 0, totalDelay = 0, maxDelay = 0;

    for (const order of orders) {
      const optimizedDate = result.bestSolution[order.id];
      const originalDate  = order.promise_date;
      const delayDays     = moment(optimizedDate).diff(moment(originalDate), 'days');
      const penaltyCost   = result.details.orderPenalties?.[order.id] || 0;

      if (delayDays <= 0) onTimeCount++;
      else { totalDelay += delayDays; maxDelay = Math.max(maxDelay, delayDays); }

      await db.insert('optimization_results', {
        id: uuidv4(), run_id: runId, sales_order_id: order.id,
        original_date: originalDate, optimized_date: optimizedDate,
        delay_days: delayDays, penalty_cost: penaltyCost,
        feasible: delayDays <= 28 ? 1 : 0,
        status: delayDays <= 0 ? 'On Time' : `Delayed ${delayDays}d`
      });
    }

    for (const [restId, weeklyUsage] of Object.entries(result.details.weeklyCapacityUsage || {})) {
      const restriction = restrictions.find(r => r.id === restId);
      for (const [weekKey, usage] of Object.entries(weeklyUsage)) {
        const [yr, wk]  = weekKey.split('-').map(Number);
        const capEntry  = restriction?.weekly_capacities?.find(c => c.year === yr && c.week === wk);
        const capacity  = capEntry?.capacity || 0;
        const overCap   = Math.max(0, usage - capacity);
        await db.insert('capacity_analysis', {
          id: uuidv4(), run_id: runId, restriction_id: restId,
          year: yr, week: wk, capacity, required_capacity: usage,
          utilization_pct: capacity > 0 ? (usage / capacity) * 100 : 100,
          over_capacity: overCap,
          violation_cost: overCap * (restriction?.penalty_cost_per_unit || 100),
          is_critical: overCap > 0 ? 1 : 0
        });
      }
    }

    for (const [compId, weeklyUsage] of Object.entries(result.details.weeklyComponentUsage || {})) {
      const component = components.find(c => c.id === compId);
      for (const [weekKey, required] of Object.entries(weeklyUsage)) {
        const [yr, wk]   = weekKey.split('-').map(Number);
        const availEntry = component?.availability?.find(a => a.year === yr && a.week === wk);
        const available  = availEntry?.available_qty || 0;
        const shortage   = Math.max(0, required - available);
        await db.insert('component_analysis', {
          id: uuidv4(), run_id: runId, component_id: compId,
          year: yr, week: wk, available, required,
          shortage, shortage_cost: shortage * (component?.unit_cost || 10) * 3,
          is_critical: shortage > 0 ? 1 : 0
        });
      }
    }

    const avgDelay  = orders.length > 0 ? totalDelay / orders.length : 0;
    const onTimePct = orders.length > 0 ? (onTimeCount / orders.length) * 100 : 0;
    const execTime  = Date.now() - startTime;

    await db.update('optimization_runs', runId, {
      status: 'Completed', on_time_orders: onTimeCount,
      delayed_orders: orders.length - onTimeCount,
      total_penalty_cost: result.bestFitness, on_time_percentage: onTimePct,
      avg_delay_days: avgDelay, max_delay_days: maxDelay, execution_time_ms: execTime
    });

    const runData = await db.findOne('optimization_runs', { id: runId });

    const resultRows = await db.queryAll(`
      SELECT or2.*, so.order_number, so.promise_date, so.quantity, so.priority,
             c.name AS customer_name, p.name AS product_name
      FROM   optimization_results or2
      JOIN   sales_orders so ON or2.sales_order_id = so.id
      LEFT JOIN customers c  ON so.customer_id = c.id
      LEFT JOIN products  p  ON so.product_id  = p.id
      WHERE  or2.run_id = ?
      ORDER BY or2.delay_days DESC`, [runId]);

    const capAnalysis = await db.queryAll(`
      SELECT ca.*, r.name AS restriction_name, r.restriction_code
      FROM   capacity_analysis ca
      JOIN   restrictions r ON ca.restriction_id = r.id
      WHERE  ca.run_id = ?
      ORDER BY ca.is_critical DESC, ca.utilization_pct DESC`, [runId]);

    const compAnalysis = await db.queryAll(`
      SELECT ca.*, comp.name AS component_name, comp.component_code
      FROM   component_analysis ca
      JOIN   components comp ON ca.component_id = comp.id
      WHERE  ca.run_id = ?
      ORDER BY ca.is_critical DESC, ca.shortage DESC`, [runId]);

    res.json({
      run: runData, order_results: resultRows,
      capacity_analysis: capAnalysis, component_analysis: compAnalysis,
      summary: {
        total_orders: orders.length, on_time_orders: onTimeCount,
        delayed_orders: orders.length - onTimeCount,
        on_time_percentage: onTimePct.toFixed(1),
        total_penalty_cost: result.bestFitness.toFixed(2),
        avg_delay_days: avgDelay.toFixed(1), max_delay_days: maxDelay,
        execution_time_ms: execTime,
        critical_restrictions: capAnalysis.filter(c => c.is_critical).length,
        critical_components:   compAnalysis.filter(c => c.is_critical).length
      }
    });
  } catch (e) {
    console.error('Optimization error:', e);
    await db.runStmt('UPDATE OPS_OPTIMIZATION_RUNS SET status=? WHERE id=?', ['Failed', runId]);
    res.status(500).json({ error: e.message });
  }
});

// ─── OPTIMIZATION RUNS ────────────────────────────────────────────────────────
router.get('/optimization-runs', async (req, res) => {
  try { res.json(await db.findAll('optimization_runs', {}, 'created_at DESC')); }
  catch (e) { res.status(500).json({ error: e.message }); }
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

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
router.get('/dashboard', async (req, res) => {
  try {
    const today = moment().format('YYYY-MM-DD');
    const [
      totalProducts, totalCustomers, totalRestrictions, totalComponents,
      totalOrders, openOrders, confirmedOrders, overdueRow, lastRun,
      capacityStatus, compStatus
    ] = await Promise.all([
      db.count('products'),
      db.count('customers'),
      db.count('restrictions'),
      db.count('components'),
      db.count('sales_orders'),
      db.count('sales_orders', { STATUS: 'Open' }),
      db.count('sales_orders', { STATUS: 'Confirmed' }),
      db.queryOne(
        `SELECT COUNT(*) AS cnt FROM OPS_SALES_ORDERS
         WHERE promise_date < ? AND status IN ('Open','Confirmed')`, [today]),
      db.queryOne(
        // `SELECT * FROM OPS_OPTIMIZATION_RUNS ORDER BY created_at DESC FETCH FIRST 1 ROWS ONLY`
      `SELECT * FROM OPS_OPTIMIZATION_RUNS ORDER BY created_at DESC LIMIT 1`
      ),
      db.queryAll(`
        SELECT r.name, r.restriction_code,
               AVG(wc.capacity) AS avg_capacity, COUNT(wc.id) AS week_count
        FROM   restrictions r
        LEFT JOIN weekly_capacities wc ON r.id = wc.restriction_id
        WHERE  r.is_active = true
        GROUP BY r.id, r.name, r.restriction_code`),
      db.queryAll(`
        SELECT comp.name, comp.component_code, comp.min_stock,
               COALESCE(SUM(ca.available_qty), 0) AS total_available
        FROM   components comp
        LEFT JOIN component_availability ca ON comp.id = ca.component_id
        WHERE  comp.is_active = true
        GROUP BY comp.id, comp.name, comp.component_code, comp.min_stock`)
    ]);

    res.json({
      total_products: totalProducts, total_customers: totalCustomers,
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

// ─── SEED / CLEAR ─────────────────────────────────────────────────────────────
router.post('/seed', async (req, res) => {
  try { res.json({ success: true, ...(await seedData()) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/clear-data', async (req, res) => {
  try { await db.clearAllData(); res.json({ success: true, message: 'All data cleared' }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
