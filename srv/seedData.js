// scripts/seedData.js
const { v4: uuidv4 } = require('uuid');
const moment = require('moment');
const db = require('./db');

async function seedData() {
  
  await db.clearAllData();
  console.log('Seeding sample data (Forklift manufacturer)...');

  // ---- Customers ----
  const customers = [
    { id: uuidv4(), customer_code: 'CUST001', name: 'Atlas Manufacturing Ltd', priority: 'High', contact_person: 'James Thornton', email: 'j.thornton@atlas.com', phone: '+1-555-0101' },
    { id: uuidv4(), customer_code: 'CUST002', name: 'Pinnacle Logistics Corp', priority: 'Medium', contact_person: 'Sarah Chen', email: 's.chen@pinnacle.com', phone: '+1-555-0102' },
    { id: uuidv4(), customer_code: 'CUST003', name: 'Global Warehouse Solutions', priority: 'High', contact_person: 'Michael Okonkwo', email: 'm.okonkwo@gws.com', phone: '+1-555-0103' },
    { id: uuidv4(), customer_code: 'CUST004', name: 'Regional Transport LLC', priority: 'Low', contact_person: 'Emma Vasquez', email: 'e.vasquez@rt.com', phone: '+1-555-0104' },
    { id: uuidv4(), customer_code: 'CUST005', name: 'Express Freight Partners', priority: 'Medium', contact_person: 'David Kim', email: 'd.kim@efp.com', phone: '+1-555-0105' },
    { id: uuidv4(), customer_code: 'CUST006', name: 'Harbour Port Authority', priority: 'High', contact_person: 'Linda Mbeki', email: 'l.mbeki@harbour.com', phone: '+1-555-0106' },
  ];
  customers.forEach(async c => await db.insert('customers', { ...c, is_active: true }));
  console.log(`  ✓ ${customers.length} customers`);

  // ---- Products (Forklifts) ----
  const products = [
    { id: uuidv4(), product_code: 'FL-E2T', name: 'Electric Forklift 2T', description: '2-tonne electric counterbalance forklift, lithium-ion battery, 8hr runtime', category: 'Electric Counterbalance', unit_price: 45000, standard_cost: 32000, lead_time_days: 14 },
    { id: uuidv4(), product_code: 'FL-D3T', name: 'Diesel Forklift 3T', description: '3-tonne diesel counterbalance forklift, Tier 4 Final engine, ROPS cab', category: 'Diesel Counterbalance', unit_price: 38000, standard_cost: 27500, lead_time_days: 12 },
    { id: uuidv4(), product_code: 'FL-RT15', name: 'Reach Truck 1.5T', description: '1.5-tonne narrow-aisle electric reach truck, max lift height 10m', category: 'Electric Reach Trucks', unit_price: 52000, standard_cost: 38500, lead_time_days: 18 },
    { id: uuidv4(), product_code: 'FL-EPJ', name: 'Electric Pallet Jack 2.5T', description: 'Electric walkbehind pallet jack, 2.5-tonne, 6hr runtime', category: 'Pallet Equipment', unit_price: 8500, standard_cost: 5800, lead_time_days: 7 },
    { id: uuidv4(), product_code: 'FL-RT4T', name: 'Rough Terrain Forklift 4T', description: '4-tonne rough terrain forklift, diesel, pneumatic tyres, outdoor use', category: 'Specialty Forklifts', unit_price: 58000, standard_cost: 43500, lead_time_days: 21 },
    { id: uuidv4(), product_code: 'FL-VNA', name: 'VNA Turret Truck 1.2T', description: 'Very Narrow Aisle turret truck, laser guided, 1.2T, 12m lift', category: 'Electric Reach Trucks', unit_price: 78000, standard_cost: 56000, lead_time_days: 25 },
  ];
  products.forEach(async p => await db.insert('products', { ...p, is_active: true }));
  console.log(`  ✓ ${products.length} products`);

  // ---- Restrictions ----
  const today = moment();
  const validFrom = today.clone().startOf('isoWeek').format('YYYY-MM-DD');
  const validTo = today.clone().add(6, 'months').format('YYYY-MM-DD');

  const restrictions = [
    { id: uuidv4(), restriction_code: 'RES-ASSY-A', name: 'Assembly Line A (Electric)', description: 'Main assembly line for electric forklifts and reach trucks', resource_type: 'Assembly', penalty_cost_per_unit: 150, valid_from: validFrom, valid_to: validTo },
    { id: uuidv4(), restriction_code: 'RES-ASSY-B', name: 'Assembly Line B (Diesel)', description: 'Diesel and rough-terrain forklift assembly', resource_type: 'Assembly', penalty_cost_per_unit: 175, valid_from: validFrom, valid_to: validTo },
    { id: uuidv4(), restriction_code: 'RES-PAINT', name: 'Paint Shop', description: 'Electrostatic paint booth, handles all models', resource_type: 'Finishing', penalty_cost_per_unit: 200, valid_from: validFrom, valid_to: validTo },
    { id: uuidv4(), restriction_code: 'RES-TEST', name: 'Final Testing Bay', description: 'Load testing, safety certification, final QC', resource_type: 'Testing', penalty_cost_per_unit: 180, valid_from: validFrom, valid_to: validTo },
    { id: uuidv4(), restriction_code: 'RES-MAST', name: 'Mast & Lift System', description: 'Mast assembly and hydraulic system installation', resource_type: 'Assembly', penalty_cost_per_unit: 220, valid_from: validFrom, valid_to: validTo },
  ];
  restrictions.forEach(async r => await db.insert('restrictions', { ...r, is_active: true }));
  console.log(`  ✓ ${restrictions.length} restrictions`);

  // ---- Weekly Capacities (14 weeks) ----
  const capacityConfig = {
    'RES-ASSY-A': 20, 'RES-ASSY-B': 18, 'RES-PAINT': 35, 'RES-TEST': 25, 'RES-MAST': 22
  };
  let capCount = 0;
  for (const restriction of restrictions) {
    const baseCapacity = capacityConfig[restriction.restriction_code] || 20;
    for (let w = 0; w < 14; w++) {
      const weekDate = today.clone().add(w, 'weeks');
      const year = weekDate.isoWeekYear();
      const week = weekDate.isoWeek();
      // Slight variation +/- 20%
      const variation = Math.floor((Math.random() - 0.5) * baseCapacity * 0.4);
      const capacity = Math.max(5, baseCapacity + variation);
      await db.insert('weekly_capacities', {
        id: uuidv4(), restriction_id: restriction.id, year, week, capacity
      });
      capCount++;
    }
  }
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
  penaltyRules.forEach(async r => await db.insert('penalty_rules', r));
  console.log(`  ✓ ${penaltyRules.length} penalty rules`);

  // ---- Components ----
  const components = [
    { id: uuidv4(), component_code: 'CMP-MOT-2KW', name: 'AC Drive Motor 2kW', description: '2kW 3-phase AC drive motor for electric forklifts', supplier: 'MotorTech GmbH', unit_cost: 1400, lead_time_days: 10, min_stock: 20 },
    { id: uuidv4(), component_code: 'CMP-BAT-48V', name: 'Li-Ion Battery 48V/450Ah', description: '48V lithium-ion traction battery pack', supplier: 'PowerCell Systems', unit_cost: 4200, lead_time_days: 14, min_stock: 12 },
    { id: uuidv4(), component_code: 'CMP-HYD-SYS', name: 'Hydraulic Lift System', description: 'Complete hydraulic pump, cylinder & valve assembly', supplier: 'HydroTec Industries', unit_cost: 3100, lead_time_days: 12, min_stock: 15 },
    { id: uuidv4(), component_code: 'CMP-TYR-IND', name: 'Industrial Tyre Set (4)', description: 'Pneumatic industrial tyres, 200/50-10, set of 4', supplier: 'TyreCorp International', unit_cost: 950, lead_time_days: 5, min_stock: 60 },
    { id: uuidv4(), component_code: 'CMP-ECU-CTRL', name: 'Vehicle Control Unit (VCU)', description: 'Programmable VCU for drive and lift control', supplier: 'ElectroControl Ltd', unit_cost: 1800, lead_time_days: 8, min_stock: 25 },
    { id: uuidv4(), component_code: 'CMP-MAST-STD', name: 'Standard Triple Mast', description: 'Triple-stage mast, 4.5m lift height, 2T rated', supplier: 'SteelFab Co', unit_cost: 5500, lead_time_days: 20, min_stock: 10 },
    { id: uuidv4(), component_code: 'CMP-ENG-D3T', name: 'Diesel Engine 3T', description: 'Kubota D1105 diesel engine, Tier 4 Final', supplier: 'Kubota Corp', unit_cost: 6800, lead_time_days: 18, min_stock: 8 },
    { id: uuidv4(), component_code: 'CMP-CAB-ROPS', name: 'ROPS Cab Assembly', description: 'Roll-Over Protective Structure cab, vinyl glazed', supplier: 'SafetyCab Mfg', unit_cost: 3400, lead_time_days: 15, min_stock: 6 },
  ];
  components.forEach(async c => await db.insert('components', { ...c, is_active: true }));
  console.log(`  ✓ ${components.length} components`);

  // ---- Component Availability (14 weeks) ----
  const availConfig = {
    'CMP-MOT-2KW': { base: 40, variance: 15 },
    'CMP-BAT-48V': { base: 25, variance: 8 },
    'CMP-HYD-SYS': { base: 30, variance: 10 },
    'CMP-TYR-IND': { base: 120, variance: 30 },
    'CMP-ECU-CTRL': { base: 50, variance: 12 },
    'CMP-MAST-STD': { base: 18, variance: 5 },
    'CMP-ENG-D3T':  { base: 15, variance: 4 },
    'CMP-CAB-ROPS': { base: 12, variance: 3 },
  };
  let availCount = 0;
  for (const comp of components) {
    const cfg = availConfig[comp.component_code] || { base: 20, variance: 5 };
    for (let w = 0; w < 14; w++) {
      const weekDate = today.clone().add(w, 'weeks');
      const year = weekDate.isoWeekYear();
      const week = weekDate.isoWeek();
      const variation = Math.floor(Math.random() * cfg.variance);
      const available_qty = Math.max(2, cfg.base + variation);
      await db.insert('component_availability', {
        id: uuidv4(), component_id: comp.id, year, week,
        available_qty, reserved_qty: Math.floor(available_qty * 0.05)
      });
      availCount++;
    }
  }
  console.log(`  ✓ ${availCount} component availability records`);

  // ---- Product → Restriction mapping (which assembly lines each product uses) ----
  const productRestrictionMap = {
    'FL-E2T':  ['RES-ASSY-A', 'RES-PAINT', 'RES-TEST', 'RES-MAST'],
    'FL-D3T':  ['RES-ASSY-B', 'RES-PAINT', 'RES-TEST', 'RES-MAST'],
    'FL-RT15': ['RES-ASSY-A', 'RES-PAINT', 'RES-TEST', 'RES-MAST'],
    'FL-EPJ':  ['RES-ASSY-A', 'RES-TEST'],
    'FL-RT4T': ['RES-ASSY-B', 'RES-PAINT', 'RES-TEST', 'RES-MAST'],
    'FL-VNA':  ['RES-ASSY-A', 'RES-PAINT', 'RES-TEST', 'RES-MAST'],
  };
  const productComponentMap = {
    'FL-E2T':  [['CMP-MOT-2KW',1],['CMP-BAT-48V',1],['CMP-HYD-SYS',1],['CMP-TYR-IND',1],['CMP-ECU-CTRL',1],['CMP-MAST-STD',1]],
    'FL-D3T':  [['CMP-ENG-D3T',1],['CMP-HYD-SYS',1],['CMP-TYR-IND',1],['CMP-CAB-ROPS',1],['CMP-MAST-STD',1]],
    'FL-RT15': [['CMP-MOT-2KW',1],['CMP-BAT-48V',1],['CMP-HYD-SYS',1],['CMP-TYR-IND',1],['CMP-ECU-CTRL',1],['CMP-MAST-STD',1]],
    'FL-EPJ':  [['CMP-MOT-2KW',1],['CMP-BAT-48V',1],['CMP-TYR-IND',1],['CMP-ECU-CTRL',1]],
    'FL-RT4T': [['CMP-ENG-D3T',1],['CMP-HYD-SYS',1],['CMP-TYR-IND',1],['CMP-CAB-ROPS',1],['CMP-MAST-STD',1]],
    'FL-VNA':  [['CMP-MOT-2KW',2],['CMP-BAT-48V',1],['CMP-HYD-SYS',1],['CMP-ECU-CTRL',2],['CMP-MAST-STD',1]],
  };

  // Build lookup maps
  const restrictionByCode = {};
  restrictions.forEach(r => { restrictionByCode[r.restriction_code] = r; });
  const componentByCode = {};
  components.forEach(c => { componentByCode[c.component_code] = c; });
  const productByCode = {};
  products.forEach(p => { productByCode[p.product_code] = p; });

  // ---- Sales Orders (25 orders) ----
  const priorities = ['High', 'High', 'Medium', 'Medium', 'Low']; // bias toward higher
  const productCodes = Object.keys(productByCode);
  const ordersData = [];

  for (let i = 1; i <= 25; i++) {
    const customer = customers[Math.floor(Math.random() * customers.length)];
    const productCode = productCodes[Math.floor(Math.random() * productCodes.length)];
    const product = productByCode[productCode];
    const priority = priorities[Math.floor(Math.random() * priorities.length)];
    const weeksOut = Math.floor(Math.random() * 8) + 2; // 2-9 weeks out
    const promiseDate = today.clone().add(weeksOut, 'weeks').format('YYYY-MM-DD');
    const requestedDate = today.clone().add(weeksOut - 1, 'weeks').format('YYYY-MM-DD');
    const quantity = Math.floor(Math.random() * 4) + 1;

    ordersData.push({
      id: uuidv4(),
      order_number: `SO-${String(i).padStart(4, '0')}`,
      customer_id: customer.id,
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
  ordersData.forEach(async o => await db.insert('sales_orders', o));
  console.log(`  ✓ ${ordersData.length} sales orders`);

  // ---- Order-Restriction links ----
  let orCount = 0;
  for (const order of ordersData) {
    const product = products.find(p => p.id === order.product_id);
    const resCodes = productRestrictionMap[product.product_code] || [];
    for (const code of resCodes) {
      const restriction = restrictionByCode[code];
      if (restriction) {
        await db.insert('order_restrictions', {
          id: uuidv4(), sales_order_id: order.id,
          restriction_id: restriction.id, capacity_usage_per_unit: 1
        });
        orCount++;
      }
    }
  }
  console.log(`  ✓ ${orCount} order-restriction links`);

  // ---- Order-Component links ----
  let ocCount = 0;
  for (const order of ordersData) {
    const product = products.find(p => p.id === order.product_id);
    const compList = productComponentMap[product.product_code] || [];
    for (const [code, qtyPerUnit] of compList) {
      const comp = componentByCode[code];
      if (comp) {
        await db.insert('order_components', {
          id: uuidv4(), sales_order_id: order.id,
          component_id: comp.id, required_qty_per_unit: qtyPerUnit
        });
        ocCount++;
      }
    }
  }
  console.log(`  ✓ ${ocCount} order-component links`);

  console.log('\n✅ Sample data seeded successfully!');
  return {
    customers: customers.length, products: products.length,
    restrictions: restrictions.length, components: components.length,
    orders: ordersData.length
  };
}

if (require.main === module) {
  const result = seedData();
  console.log('\nSummary:', result);
  process.exit(0);
}

module.exports = { seedData };
