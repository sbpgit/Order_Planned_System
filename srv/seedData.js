// scripts/seedData.js
const { v4: uuidv4 } = require('uuid');
const moment = require('moment');
const db = require('./db');
// const cds = require('@sap/cds');
async function seedData(locationId) {

  await db.clearAllData(locationId);
  await db.deleteAll('penalty_rules');
  console.log(`Seeding sample data for location: ${locationId}...`);
  const cf = await cds.connect.to('db');

  // ---- Customers ----
  // Products and customers are global/shared tables. Preserve existing records and their IDs
  // to avoid orphaned references in sales_orders. Only insert truly new customer_codes.
  const customerGroup = await cf.run(SELECT.from('CP_CUSTOMERGROUP'));
  const existingCusts = await db.findAll('customers', {});
  const existingCustByCode = {};
  existingCusts.forEach(c => { existingCustByCode[c.customer_code] = c; });

  let customersTotal = [];
  for (let i = 0; i < customerGroup.length; i++) {
    const customerCode = customerGroup[i].CUSTOMER_GROUP;
    if (existingCustByCode[customerCode]) {
      customersTotal.push(existingCustByCode[customerCode]);
    } else {
      const newCust = {
        id: uuidv4(),
        customer_code: customerCode,
        name: customerGroup[i].CUSTOMER_DESC,
        priority: 'High',
        contact_person: 'James' + i + '23',
        email: 'abc@abc.com',
        phone: 'phone',
        is_active: true
      };
      await db.insert('customers', newCust);
      customersTotal.push(newCust);
    }
  }
  console.log(`  ✓ ${customersTotal.length} customers`);

  // ---- Products ----
  // Same pattern: reuse existing product IDs so sales_order foreign keys stay valid.
  const productGroups = await cf.run(SELECT.from('CP_PARTIALPROD_INTRO'));
  const existingProds = await db.findAll('products', {});
  const existingProdByCode = {};
  existingProds.forEach(p => { existingProdByCode[p.product_code] = p; });

  let productsTotal = [];
  for (let i = 0; i < productGroups.length; i++) {
    const productCode = productGroups[i].PRODUCT_ID;
    if (existingProdByCode[productCode]) {
      productsTotal.push(existingProdByCode[productCode]);
    } else {
      const newProd = {
        id: uuidv4(),
        product_code: productCode,
        name: productGroups[i].PROD_DESC,
        description: 'High',
        category: 'James' + i + '23',
        unit_price: '200.00',
        standard_cost: '100.00',
        lead_time_days: i,
        is_active: true
      };
      await db.insert('products', newProd);
      productsTotal.push(newProd);
    }
  }
  console.log(`  ✓ ${productsTotal.length} products`);

  // ---- Restrictions ----
  const today = moment();
  const validFrom = today.clone().startOf('isoWeek').format('YYYY-MM-DD');
  const validTo = today.clone().add(6, 'months').format('YYYY-MM-DD');
  const restGroups = await cf.run(SELECT.from('V_RSTRREQ_PRODCONSD').columns(r => {
    r.RESTRICTION, r.RTR_DESC, r.WEEK_DATE, r.RESTRICTIONAVAIL_QTY, r.VALID_FROM, r.VALID_TO
  }).where({ LOCATION_ID: locationId }));

  // Deduplicate by restriction_code using a Map (avoids JSON stringify/parse)
  const uniqueMap = new Map();
  for (const r of restGroups) {
    if (!uniqueMap.has(r.RESTRICTION)) {
      uniqueMap.set(r.RESTRICTION, {
        restriction_code: r.RESTRICTION,
        name: r.RTR_DESC,
        description: r.RTR_DESC,
        resource_type: r.RTR_DESC,
        valid_from: r.VALID_FROM,
        valid_to: r.VALID_TO,
        penalty_cost_per_unit: Math.floor(Math.random() * 9951) + 50,
      });
    }
  }

  const restrictionsTotal = [...uniqueMap.values()].map(g => ({ id: uuidv4(), ...g, location_id: locationId, is_active: true }));

  await Promise.all(restrictionsTotal.map(r => db.insert('restrictions', r)));
  console.log(`  ✓ ${restrictionsTotal.length} restrictions`);

  // ---- Weekly Capacities ----
  // Pre-group restGroups by restriction_code for O(1) lookup instead of O(n²) scan
  const capacitiesByCode = new Map();
  for (const r of restGroups) {
    if (!capacitiesByCode.has(r.RESTRICTION)) capacitiesByCode.set(r.RESTRICTION, []);
    capacitiesByCode.get(r.RESTRICTION).push(r);
  }

  const capacityInserts = [];
  for (const res of restrictionsTotal) {
    for (const row of (capacitiesByCode.get(res.restriction_code) || [])) {
      const m = moment(row.WEEK_DATE);
      capacityInserts.push({
        id: uuidv4(), restriction_id: res.id,
        year: m.isoWeekYear(), week: m.isoWeek(),
        capacity: Number(row.RESTRICTIONAVAIL_QTY).toFixed(2)
      });
    }
  }
  await Promise.all(capacityInserts.map(c => db.insert('weekly_capacities', c)));
  let capCount = capacityInserts.length;
  console.log(`  ✓ ${capCount} weekly capacity records`);

  // ---- Penalty Rules ----
  const penaltyRules = [];
  // Late delivery: by priority
  for (const priority of ['High', 'Medium', 'Low']) {
    const perDay = priority === 'High' ? 800 : priority === 'Medium' ? 400 : 150;
    const flat = priority === 'High' ? 2000 : priority === 'Medium' ? 800 : 300;
    penaltyRules.push({
      id: uuidv4(), rule_type: 'late_delivery', customer_priority: priority,
      product_id: null, penalty_per_day: perDay, penalty_flat: flat
    });
  }
  // No fulfillment: by priority
  for (const priority of ['High', 'Medium', 'Low']) {
    const flat = priority === 'High' ? 25000 : priority === 'Medium' ? 12000 : 4000;
    penaltyRules.push({
      id: uuidv4(), rule_type: 'no_fulfillment', customer_priority: priority,
      product_id: null, penalty_per_day: 0, penalty_flat: flat
    });
  }
  // Early delivery: benefit subtracted from total fitness (reward for scheduling early)
  for (const priority of ['High', 'Medium', 'Low']) {
    const perDay = priority === 'High' ? 500 : priority === 'Medium' ? 250 : 100;
    const flat   = priority === 'High' ? 100 : priority === 'Medium' ? 50  : 20;
    penaltyRules.push({
      id: uuidv4(), rule_type: 'early_delivery', customer_priority: priority,
      product_id: null, penalty_per_day: perDay, penalty_flat: flat
    });
  }
  for (const r of penaltyRules) await db.insert('penalty_rules', { ...r });
  console.log(`  ✓ ${penaltyRules.length} penalty rules`);

  // ---- Components ----
  // const components = [
  //   { id: uuidv4(), component_code: 'CMP-MOT-2KW', name: 'AC Drive Motor 2kW', description: '2kW 3-phase AC drive motor for electric forklifts', supplier: 'MotorTech GmbH', unit_cost: 1400, lead_time_days: 10, min_stock: 20 },
  //   { id: uuidv4(), component_code: 'CMP-BAT-48V', name: 'Li-Ion Battery 48V/450Ah', description: '48V lithium-ion traction battery pack', supplier: 'PowerCell Systems', unit_cost: 4200, lead_time_days: 14, min_stock: 12 },
  //   { id: uuidv4(), component_code: 'CMP-HYD-SYS', name: 'Hydraulic Lift System', description: 'Complete hydraulic pump, cylinder & valve assembly', supplier: 'HydroTec Industries', unit_cost: 3100, lead_time_days: 12, min_stock: 15 },
  //   { id: uuidv4(), component_code: 'CMP-TYR-IND', name: 'Industrial Tyre Set (4)', description: 'Pneumatic industrial tyres, 200/50-10, set of 4', supplier: 'TyreCorp International', unit_cost: 950, lead_time_days: 5, min_stock: 60 },
  //   { id: uuidv4(), component_code: 'CMP-ECU-CTRL', name: 'Vehicle Control Unit (VCU)', description: 'Programmable VCU for drive and lift control', supplier: 'ElectroControl Ltd', unit_cost: 1800, lead_time_days: 8, min_stock: 25 },
  //   { id: uuidv4(), component_code: 'CMP-MAST-STD', name: 'Standard Triple Mast', description: 'Triple-stage mast, 4.5m lift height, 2T rated', supplier: 'SteelFab Co', unit_cost: 5500, lead_time_days: 20, min_stock: 10 },
  //   { id: uuidv4(), component_code: 'CMP-ENG-D3T', name: 'Diesel Engine 3T', description: 'Kubota D1105 diesel engine, Tier 4 Final', supplier: 'Kubota Corp', unit_cost: 6800, lead_time_days: 18, min_stock: 8 },
  //   { id: uuidv4(), component_code: 'CMP-CAB-ROPS', name: 'ROPS Cab Assembly', description: 'Roll-Over Protective Structure cab, vinyl glazed', supplier: 'SafetyCab Mfg', unit_cost: 3400, lead_time_days: 15, min_stock: 6 },
  // ];
  let comp = {}, components = [];
  const componentGroups = await cf.run(
    SELECT.distinct.from('V_ASSEMBLY_COMPONENT')
      .columns(r => {
        r.ASSEMBLY,
          r.ASM_DESC
      })
      .where({ TYPE: 'PI', LOCATION_ID: locationId })
  );
  for (let i = 0; i < componentGroups.length; i++) {
    comp.id = uuidv4();
    comp.component_code = componentGroups[i].ASSEMBLY;
    comp.name = componentGroups[i].ASM_DESC;
    comp.description = componentGroups[i].ASM_DESC;
    comp.supplier = "SBP" + i + '000';
    comp.unit_cost = Math.floor(Math.random() * 9951) + 50;
    comp.lead_time_days = i;
    comp.min_stock = i;
    components.push(comp);
    comp = {};
  }
  for (const c of components) await db.insert('components', { ...c, location_id: locationId, is_active: true });
  console.log(`  ✓ ${components.length} components`);

  // ---- Component Availability (14 weeks) ----
  const availConfig = {
    'CMP-MOT-2KW': { base: 1200, variance: 150 },
    'CMP-BAT-48V': { base: 1100, variance: 80 },
    'CMP-HYD-SYS': { base: 1150, variance: 100 },
    'CMP-TYR-IND': { base: 1500, variance: 300 },
    'CMP-ECU-CTRL': { base: 1300, variance: 120 },
    'CMP-MAST-STD': { base: 1050, variance: 50 },
    'CMP-ENG-D3T': { base: 1050, variance: 40 },
    'CMP-CAB-ROPS': { base: 1020, variance: 30 },
  };
  let availCount = 0;
  for (const comp of components) {
    const cfg = availConfig[comp.component_code] || { base: 1000, variance: 10 };
    for (let w = 0; w < 14; w++) {
      const weekDate = today.clone().add(w, 'weeks');
      const year = weekDate.isoWeekYear();
      const week = weekDate.isoWeek();
      const variation = Math.floor(Math.random() * cfg.variance);
      const available_qty = Math.max(5, cfg.base + variation);
      await db.insert('component_availability', {
        id: uuidv4(), component_id: comp.id, year, week,
        available_qty, reserved_qty: Math.floor(available_qty * 0.05)
      });
      availCount++;
    }
  }
  console.log(`  ✓ ${availCount} component availability records`);

  const productByCode = {};
  productsTotal.forEach(p => { productByCode[p.product_code] = p; });

  // ---- Sales Orders (25 orders) ----
  const priorities = ['High', 'High', 'Medium', 'Medium', 'Low']; // bias toward higher
  const productCodes = Object.keys(productByCode);
  const ordersData = [];
  let salesData = await cf.run(
    SELECT.distinct.from('V_SALES_H')
      .columns(r => {
        r.SALES_DOC,
          r.PRODUCT_ID,
          r.UNIQUE_ID,
          r.MAT_AVAILDATE,
          r.NET_VALUE,
          r.CUSTOMER_GROUP,
          r.ORD_QTY,
          r.CUSTOMER_DESC,
          r.CUSTOMER_GROUP
      })
      .where
      `     
      MAT_AVAILDATE > '2026-03-01' 
      and LOCATION_ID = ${locationId}`
  );

  for (let i = 0; i < salesData.length; i++) {
    const customer = customersTotal.filter(id=>id.customer_code === salesData[i].CUSTOMER_GROUP);
    // const customer = customersTotal[Math.floor(Math.random() * customersTotal.length)];
    // const productCode = productCodes[Math.floor(Math.random() * productCodes.length)];
    // const product = productByCode[productCode];
    const product = productByCode[salesData[i].PRODUCT_ID];
    const priority = priorities[Math.floor(Math.random() * priorities.length)];
    const weeksOut = Math.floor(Math.random() * 8) + 2; // 2-9 weeks out
    const promiseDate = today.clone().add(weeksOut, 'weeks').format('YYYY-MM-DD');
    const requestedDate = today.clone().add(weeksOut - 1, 'weeks').format('YYYY-MM-DD');
    // const quantity = Math.floor(Math.random() * 4) + 1;
    const quantity = Number(salesData[i].ORD_QTY);
    const uniqueId = salesData[i].UNIQUE_ID;
    const salesDoc = salesData[i].SALES_DOC;
    // console.log(i);
    ordersData.push({
      id: uuidv4(),
      location_id: locationId,
      unique_id: uniqueId,
      order_number: salesDoc,
      customer_id: customer[0].id,
      product_id: product.id,
      requested_date: requestedDate,
      promise_date: promiseDate,
      quantity,
      unit_price: product.unit_price,
      revenue: product.unit_price * quantity,
      cost: product.standard_cost * quantity,
      priority,
      status: 'Open',
      notes: `${quantity}x ${product.name} for ${customer.name}`
    });
  }
  for (const o of ordersData) await db.insert('sales_orders', o);
  console.log(`  ✓ ${ordersData.length} sales orders`);

  console.log('\n✅ Sample data seeded successfully!');
  return {
    customers: customersTotal.length, products: productsTotal.length,
    restrictions: restrictionsTotal.length, components: components.length,
    orders: ordersData.length
  };
}

if (require.main === module) {
  const result = seedData();
  console.log('\nSummary:', result);
  process.exit(0);
}

module.exports = { seedData };
