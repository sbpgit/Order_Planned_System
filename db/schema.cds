namespace OPS;

entity Products {
  key id            : String(36);
  product_code      : String(50);
  name              : String(200);
  description       : String(1000);
  category          : String(100);
  unit_price        : Decimal(15,2);
  standard_cost     : Decimal(15,2);
  lead_time_days    : Integer;
  is_active         : Boolean;
  created_at        : Timestamp;
  updated_at        : Timestamp;
}

entity Customers {
  key id            : String(36);
  customer_code     : String(50);
  name              : String(200);
  priority          : String(20);
  contact_person    : String(100);
  email             : String(200);
  phone             : String(50);
  is_active         : Boolean;
  created_at        : Timestamp;
  updated_at        : Timestamp;
}

entity Restrictions {
  key id                : String(36);
  restriction_code      : String(50);
  name                  : String(200);
  description           : String(1000);
  resource_type         : String(100);
  valid_from            : Date;
  valid_to              : Date;
  penalty_cost_per_unit : Decimal(15,2);
  is_active             : Boolean;
  created_at            : Timestamp;
  updated_at            : Timestamp;
}

entity Weekly_Capacities {
  key id            : String(36);
  restriction       : Association to Restrictions;
  year              : Integer;
  week              : Integer;
  capacity          : Decimal(15,2);
}

entity PENALTY_RULES {
  key id            : String(36);
  rule_type         : String(50);
  customer_priority : String(50);
  product_id        : String(50);
  penalty_per_day   : Decimal(15,2);
  penalty_flat      : Decimal(15,2);
  created_at        : Timestamp;
}

entity Components {
  key id            : String(36);
  component_code    : String(50);
  name              : String(200);
  description       : String(1000);
  supplier          : String(200);
  unit_cost         : Decimal(15,2);
  lead_time_days    : Integer;
  min_stock         : Integer;
  is_active         : Boolean;
  created_at        : Timestamp;
  updated_at        : Timestamp;
}

entity Component_Availability {
  key id            : String(36);
  component         : Association to Components;
  year              : Integer;
  week              : Integer;
  available_qty     : Decimal(15,2);
  reserved_qty      : Decimal(15,2);
}
entity Sales_Orders {
  key id            : String(36);
  order_number      : String(50);
  customer          : Association to Customers;
  product           : Association to Products;
  requested_date    : Date;
  promise_date      : Date;
  quantity          : Decimal(15,2);
  unit_price        : Decimal(15,2);
  revenue           : Decimal(15,2);
  cost              : Decimal(15,2);
  priority          : String(20);
  status            : String(20);
  notes             : String(2000);
  created_at        : Timestamp;
  updated_at        : Timestamp;
}

entity Order_Restrictions {
  key id                    : String(36);
  sales_order               : Association to Sales_Orders;
  restriction               : Association to Restrictions;
  capacity_usage_per_unit   : Decimal(15,2);
}

entity Order_Components {
  key id                    : String(36);
  sales_order               : Association to Sales_Orders;
  component                 : Association to Components;
  required_qty_per_unit     : Decimal(15,2);
}

entity Optimization_Runs {
  key id               : String(36);
  run_number           : String(50);
  description          : String(500);
  run_date             : Timestamp;
  status               : String(20);
  parameters           : String(2000);
  total_orders         : Integer;
  on_time_orders       : Integer;
  delayed_orders       : Integer;
  total_penalty_cost   : Decimal(15,2);
  on_time_percentage   : Decimal(7,2);
  avg_delay_days       : Decimal(7,2);
  max_delay_days       : Integer;
  execution_time_ms    : Integer;
  created_at           : Timestamp;
  updated_at           : Timestamp;
}

entity Optimization_Results {
  key id          : String(36);
  run             : Association to Optimization_Runs;
  sales_order     : Association to Sales_Orders;
  original_date   : Date;
  optimized_date  : Date;
  delay_days      : Integer;
  penalty_cost    : Decimal(15,2);
  feasible        : Boolean;
  status          : String(100);
}

entity Capacity_Analysis {
  key id              : String(36);
  run                 : Association to Optimization_Runs;
  restriction         : Association to Restrictions;
  year                : Integer;
  week                : Integer;
  capacity            : Decimal(15,2);
  required_capacity   : Decimal(15,2);
  utilization_pct     : Decimal(7,2);
  over_capacity       : Decimal(15,2);
  violation_cost      : Decimal(15,2);
  is_critical         : Boolean;
}

entity Component_Analysis {
  key id           : String(36);
  run              : Association to Optimization_Runs;
  component        : Association to Components;
  year             : Integer;
  week             : Integer;
  available        : Decimal(15,2);
  required         : Decimal(15,2);
  shortage         : Decimal(15,2);
  shortage_cost    : Decimal(15,2);
  is_critical      : Boolean;
}