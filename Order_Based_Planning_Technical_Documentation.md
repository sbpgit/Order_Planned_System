# Order Based Planning Application
## Technical Documentation

### Document Version

| Version | Modified by | Release | Modified date |
|---------|-------------|---------|---------------|
| 1.0.0   | VCP Dev Team | 2025 G2 | June 2026 |

**Application Name:** Order Based Planning (Order Planning System)
**Application Group:** Planning Functions
**Application ID:** `obp.orderbasedplanning`
**MTA / Deployment ID:** `OrderBasedPlanning`
**Application Title:** Order Planning System — Supply Chain & Production
**Technology:** SAP CAP (Node.js / `@sap/cds` 9) + custom Express REST API; self-contained HTML/JS single-page front end (served as a UI5 / HTML5 app)
**Backend Service:** Custom Express router mounted at `/api` (CAP `cds.server` bootstrap)
**Database:** SAP HANA Cloud (HDI containers) — primary `OrderBasedPlanning-db` (alias `db1`), reference `config_products-db` (alias `db`)
**Platform:** SAP Business Technology Platform (BTP) — Cloud Foundry
**Minimum UI5 Version:** 1.145.0 (UI5 shell); core UI is framework-independent HTML/JS

---

## 1. Functionality

The Order Based Planning (OBP) application is a supply-chain / production planning tool that schedules **Sales Orders** against finite **weekly capacity** (Restrictions) and **weekly component availability**, using a **Genetic Algorithm** to minimise total business penalty (late-delivery, early-delivery, capacity-overrun and component-shortage costs). It allows planners and administrators to:

- **Maintain Master Data** — Create, edit, delete and bulk-upload **Products**, **Customers**, **Restrictions** (capacity-constrained resources), **Components** and **Penalty Rules**.
- **Maintain Weekly Capacity** — Per-restriction weekly capacity buckets (year + ISO week + capacity). Single-cell edit, bulk-generate over a week range, and Excel upload. Weeks with `0` capacity are highlighted red.
- **Maintain Component Availability** — Per-component weekly availability buckets (available + reserved quantity). Single-cell edit, bulk-generate and Excel upload. Weeks with `0` availability are highlighted red.
- **Manage Sales Orders** — Create and edit orders (customer, product, quantity, unit price, requested/promise date, priority, status). Each order can be linked to one or more Restrictions (capacity usage per unit) and Components (required qty per unit). Revenue is auto-computed from quantity × unit price.
- **Configure Penalty Rules** — Define late-delivery / no-fulfillment penalties by customer priority and (optionally) product, with a per-day rate and a flat penalty.
- **Run Optimization** — Launch a GA planning run with tunable parameters (population size, generations, mutation/crossover rate, optional early scheduling / pull-forward window, max-weeks delay). The run produces a confirmed delivery week per order and capacity/component utilisation analyses.
- **Review Results** — A Results History view lists past runs and a detail view shows per-order placement (On Time / Early / Delayed / Infeasible), KPI summary, capacity analysis and component analysis. Results are downloadable.
- **Import / Export** — Download per-entity Excel templates (with sample rows and exact headers), upload data from Excel, and export database snapshots per entity or all at once.
- **Seed & Clear Data** — One-click "Load Sample Data" (seeds from the reference `config_products-db`) and "Clear Data".

### Key Concepts

| Concept | Description |
|---------|-------------|
| **Restriction** | A capacity-constrained resource (e.g. an assembly / finishing / testing line). Each restriction has weekly capacity buckets and a `penalty_cost_per_unit` charged when capacity is exceeded. |
| **Component** | A material consumed by orders. Each component has weekly availability buckets and a `unit_cost` used to cost shortages. |
| **Weekly Bucket** | A `(year, week)` time bucket. Capacity, availability and resource usage are all aggregated per ISO week. |
| **Order Restriction / Order Component** | Link rows defining how much capacity (`capacity_usage_per_unit`) or component (`required_qty_per_unit`) each unit of an order consumes. |
| **Optimization Run** | A single GA execution with a parameter set, status (`Running` / `Completed` / `Failed`) and summary KPIs. |
| **Week Offset** | The GA decision variable: whole-week shift from an order's promise week (negative = early, 0 = on-time, positive = late). |
| **Penalty (Fitness)** | The value the GA minimises: late + early per-day penalties plus capacity-overrun and component-shortage costs. |
| **Early Scheduling (Pull-Forward)** | Opt-in post-step that greedily moves orders 1–3 weeks earlier into still-feasible weeks. |
| **Snapshot Columns** | Denormalised copies of master-data fields stored on result rows so historical runs survive a Clear Data. |

---

## 2. Selections (Navigation, Filter Controls and Output Columns)

The application is a sidebar-driven single page; each sidebar item routes to a "page" section (`navigate(page)`).

### Sidebar Navigation

| Group | Item | Page id | Purpose |
|-------|------|---------|---------|
| Overview | Dashboard | `page-dashboard` | KPIs, capacity & component status |
| Master Data | Products | `page-products` | Product master CRUD |
| Master Data | Customers | `page-customers` | Customer master CRUD |
| Master Data | Restrictions | `page-restrictions` | Restriction master CRUD + capacity drill-in |
| Master Data | Components | `page-components` | Component master CRUD + availability drill-in |
| Master Data | Penalty Rules | `page-penalties` | Penalty rule CRUD |
| Orders | Sales Orders | `page-orders` | Sales order CRUD + restriction/component links |
| Planning | Run Optimization | `page-optimize` | GA run launcher |
| Planning | Results History | `page-results` | List/detail of past runs |
| Data Tools | Import / Export | `page-importexport` | Templates, upload, export |

Drill-in sub-pages: `page-restriction-capacity` (weekly capacity buckets for one restriction) and `page-component-availability` (weekly availability buckets for one component).

### Sales Orders Output Columns

| Column | Bound field | Notes |
|--------|-------------|-------|
| Order # | `order_number` | Auto-generated `SO-0000` if blank |
| Customer | `customer_name` / `customer_code` | Joined from Customers |
| Product | `product_name` / `product_code` | Joined from Products |
| Promise Date | `promise_date` | Drives the optimization horizon |
| Quantity | `quantity` | |
| Priority | `priority` | High / Medium / Low |
| Status | `status` | Open / Confirmed / Delivered / Cancelled |
| Revenue | `revenue` | Auto = `quantity × unit_price` |
| Actions | — | Edit / View / Delete |

### Optimization Run Form Fields

| Field | Control id | Default | Notes |
|-------|-----------|---------|-------|
| Description | `opt-desc` | "Planning Run" | Free text |
| Population Size | `opt-pop` | 50 | GA population |
| Generations | `opt-gen` | 100 | GA iterations |
| Mutation Rate | `opt-mut` | 0.1 | |
| Crossover Rate | `opt-cross` | 0.8 | |
| Early Scheduling | `opt-early` | off | Toggle; reveals pull-forward weeks |
| Pull-Forward Weeks | `opt-early-weeks` | 2 | 1 / 2 / 3 weeks (only used when early scheduling on) |

> `max_weeks_delay` defaults to 8 in the backend (how far past the promise week an order may be pushed).

### Capacity / Component Bucket View

Both bucket views display **the current ISO week plus the following 9 weeks** with pagination (window shift). Weeks where the value is `0` are rendered red to flag a hard constraint.

---

## 3. Pre-requisites

### Backend / Infrastructure

| Requirement | Detail |
|-------------|--------|
| CAP Service | `OrderBasedPlanning-srv` (Node.js buildpack) deployed on CF; custom Express API mounted at `/api` via the `cds.on('bootstrap')` hook in [srv/server.js](srv/server.js). |
| Primary HANA HDI Container | `OrderBasedPlanning-db`, bound as CAP requires-alias **`db1`**. Holds all `OPS_*` tables (the application's own schema, [db/schema.cds](db/schema.cds)). |
| Reference HANA HDI Container | `config_products-db`, bound as CAP requires-alias **`db`**. Read by the seed routine for `CP_CUSTOMERGROUP`, `CP_PARTIALPROD_INTRO`, etc. |
| XSUAA | `OrderBasedPlanning-xsuaa-service` from [xs-security.json](xs-security.json). Role template `VCPUserRole` grants `$XSAPPNAME.User`. |
| HTML5 Apps Repository | `OrderBasedPlanning-html5-srv` (app-host plan); UI bundle `orderbasedplanning.zip`. |
| Destination Service | `OrderBasedPlanning-destination-service` (lite, `HTML5Runtime_enabled: true`); `ui5` destination → `https://ui5.sap.com`. Backend destination `Order_Based_Planning_New` consumed by the approuter. |
| OAuth Destination | `configprodoauth` (xsuaa, application plan) for `OAuth2UserTokenExchange` token propagation. |

### Master Data Required Before Use

| Data | Source | Required before |
|------|--------|-----------------|
| Products / Customers | Created in-app or via Load Sample Data | Creating sales orders |
| Restrictions + Weekly Capacity | Created in-app / Excel | Optimization (all-zero capacity is rejected) |
| Components + Availability | Created in-app / Excel | Optimization (all-zero availability is rejected) |
| Penalty Rules | Created in-app | Penalty costing (falls back to priority-based default if none) |
| Open / Confirmed Sales Orders | Created in-app / Excel | Optimization (run fails if none) |

### User Setup

- Users must hold the XSUAA scope `$XSAPPNAME.User` (via the `VCPUserRole` role template) to reach the app through the approuter.
- The `/api/*` and `/odata/*` routes are declared `authenticationType: "none"` at the HTML5 app router (see [app/orderbasedplanning/xs-app.json](app/orderbasedplanning/xs-app.json)); access control is enforced at the approuter / destination layer.

---

## 4. User Interactions in the Application

### Dashboard
On load, `Pages.dashboard()` calls `GET /api/dashboard` and renders KPI cards (total products / customers / restrictions / components / orders, open, confirmed, overdue), the last optimization run, a per-restriction capacity status list and a per-component shortage-risk list (`High` / `Medium` / `Low` based on total available vs. `min_stock`). Top bar offers **Load Sample Data**, **Clear Data** and **Run Optimization**.

### Master Data (Products / Customers / Restrictions / Components / Penalty Rules)
Each page lists rows in a table with **Edit** / **Delete** actions and an **Add** button opening a modal. Save issues `POST` (create) or `PUT` (update); Delete issues `DELETE`. All mutations are blocked with HTTP `423` while an optimization is running (see §10).

### Restriction Capacity / Component Availability
From a Restriction (or Component) row, **drill in** opens the weekly bucket page. Users can:
- Edit a single week's value (`saveCapacityWeek` / `saveAvailabilityWeek` → upsert endpoint).
- Bulk-generate buckets over a start year/week for N weeks (`bulkGenerateCapacity` / `bulkGenerateAvailability`).
- Upload buckets from Excel (`uploadCapacityFromExcel` / `uploadAvailabilityFromExcel` → `*_bulk` MERGE/UPSERT endpoints).
- Shift the visible 10-week window (`shiftCapWindow` / `shiftAvailWindow`).

### Sales Orders
**Add / Edit** opens a modal (`openOrderModal` / `editOrder`) capturing header fields plus restriction and component link rows. `updateOrderCost` recalculates revenue live. On save (`saveOrder`), the order header is written and its restriction/component links are fully replaced (delete-then-insert) on the `PUT` endpoint.

### Run Optimization
`runOptimization` posts the form parameters to `POST /api/optimize`. A progress indicator is shown; on completion the response summary and analyses render in `opt-results-section` and the user can open the full Results detail. `toggleEarlyWeeks` shows/hides the pull-forward selector.

### Results History
`Pages.results()` lists runs from `GET /api/optimization-runs`. `viewRunDetail` loads `GET /api/optimization-runs/:id` and `renderOptimizationResults` displays the KPI grid, per-order result table (status badges), capacity analysis and component analysis. `downloadOptimizationResults` exports the run.

### Import / Export
`downloadTemplate(entity)` / `downloadAllTemplates()` build Excel templates with exact headers and sample rows. Drag-drop or file-select (`handleDrop` / `handleFileSelect` / `parseFile`) parses the workbook, `_showSheetPreview` previews sheets, and `uploadAll` posts parsed rows to the matching `*_bulk` endpoint. `exportEntity` / `exportAll` download current data.

---

## 5. Jobs Responsible for Data in this App

| Data Area | Source / Owner | Notes |
|-----------|----------------|-------|
| Products, Customers, Restrictions, Components, Penalty Rules | Users (in-app CRUD + Excel bulk) | Write owners; no background job |
| Weekly Capacity / Component Availability | Users (single, bulk-generate, Excel MERGE) | Stored in `OPS_WEEKLY_CAPACITIES` / `OPS_COMPONENT_AVAILABILITY` |
| Sales Orders + links | Users | Order header + `OPS_ORDER_RESTRICTIONS` / `OPS_ORDER_COMPONENTS` |
| Optimization Runs / Results / Analyses | `POST /api/optimize` (synchronous GA) | Written by the optimizer; preserved across Clear Data via snapshot columns |
| Seed (sample) data | `POST /api/seed` → `seedData()` | Reads reference container `config_products-db` (`CP_*` tables) and populates `OPS_*` |
| Clear Data | `DELETE /api/clear-data` → `clearAllData()` | Deletes master/transaction tables; optimization output tables are intentionally retained |

---

## 6. Project Structure

The project follows the standard CAP layout — `db/` (domain model), `srv/` (services & business logic) and `app/` (UI) — deployed as a multi-target application (MTA).

#### Root & Configuration

| File | Purpose |
|------|---------|
| `mta.yaml` | MTA deployment descriptor — modules, HANA/XSUAA/HTML5 services, destinations |
| `package.json` | CAP project metadata; `cds.requires` aliases `db1` + `db`; build/deploy scripts |
| `xs-security.json` | XSUAA scopes and role templates |
| `default-env.json` | Local service-binding environment for `cds` |
| `planning.db` | Local SQLite artefact (legacy local-dev fallback) |

#### `db/` — Domain Model

| File | Purpose |
|------|---------|
| `schema.cds` | CDS domain model — 14 `OPS_*` entities (namespace `OPS`) |
| `undeploy.json` | HDI undeploy allow-list |

#### `srv/` — Services & Business Logic

| File | Purpose |
|------|---------|
| `server.js` | `cds.server` bootstrap: Express middleware, static UI, `/api` mount, `/health` |
| `routes.js` | All REST endpoints — CRUD, bulk upload, optimize, dashboard, seed/clear |
| `optimizer.js` | `OrderPlanningOptimizer` — the Genetic Algorithm |
| `db.js` | CAP-backed DB layer — table map, SQL helpers, composite reads |
| `seedData.js` | Sample-data seeding from the `config_products-db` reference container |
| `initDb.js` | Database initialisation helper |
| `orderbasedplanning-service.cds` | CDS service stub (currently empty) |
| `request.http` | Sample HTTP requests for manual testing |

#### `app/` — UI & Routing

| Path | Purpose |
|------|---------|
| `router/` | Approuter configuration (`xs-app.json`) |
| `orderbasedplanning/manifest.json` | UI5 app descriptor (OData v4 `mainService`) |
| `orderbasedplanning/xs-app.json` | App-level routes (`/api`, `/odata`, `/resources`) |
| `orderbasedplanning/webapp/index.html` | ★ Self-contained SPA — **the actual user interface** |
| `orderbasedplanning/webapp/Component.js`, `view/`, `controller/`, `model/` | UI5 shell stub (`View1` placeholder) |
| `orderbasedplanning/webapp/i18n/i18n.properties` | Resource bundle (UI5 shell) |
| `orderbasedplanning/webapp/css/style.css` | Styling |
| `gen/` | `cds build` output (`gen/srv`, `gen/db`) consumed by the MTA build |

**Directory tree (abridged):**

```
Order_Planned_System/
├── mta.yaml                 # MTA deployment descriptor
├── package.json             # CAP project (cds.requires db1 + db)
├── xs-security.json         # XSUAA scopes & roles
├── db/
│   ├── schema.cds           # 14 OPS_* entities
│   └── undeploy.json
├── srv/
│   ├── server.js            # cds.server bootstrap + /api mount
│   ├── routes.js            # REST endpoints
│   ├── optimizer.js         # Genetic Algorithm
│   ├── db.js                # CAP DB layer
│   └── seedData.js          # sample-data seeding
├── app/
│   ├── router/              # approuter
│   └── orderbasedplanning/  # HTML5 / UI5 app
│       └── webapp/
│           └── index.html   # ★ self-contained SPA (the actual UI)
└── gen/                     # cds build output
```

> **Note on the UI:** The deployed UI5 shell (`View1`) is a generated placeholder. The complete working interface is the self-contained `webapp/index.html` — a vanilla HTML/CSS/JS single-page app served statically by the CAP server and talking to the `/api` REST endpoints.

---

## 7. Navigation & Layout

- **Shell:** A fixed left **sidebar** (grouped nav: Overview / Master Data / Orders / Planning / Data Tools) + a **topbar** with global actions, and a **main** content area that shows one page section at a time.
- **Routing:** Client-side `navigate(page)` toggles `.active` on the nav item and shows the matching `#page-*` section; the topbar title updates accordingly. There is no server round-trip for navigation.
- **Drill-in:** Restriction → Capacity and Component → Availability sub-pages have a **← Back** button returning to the parent list.
- **Modals:** `openModal` / `closeModal` drive create/edit dialogs for every entity; a generic overlay hosts the form.
- **Toasts:** `toast(message)` provides transient success/error feedback.
- **UI5 manifest routing (shell only):** single route `RouteView1` (pattern `:?query:`) → `TargetView1`; rootView `obp.orderbasedplanning.view.App`. Cross-navigation inbound: semantic object `orderbasedplanning`, action `display`.

---

## 8. Data Models

### CDS Domain Model (`db/schema.cds`, namespace `OPS`)

| Entity | Physical table | Key columns / purpose |
|--------|----------------|------------------------|
| `Products` | `OPS_PRODUCTS` | product_code, name, category, unit_price, standard_cost, lead_time_days |
| `Customers` | `OPS_CUSTOMERS` | customer_code, name, priority, contact, email, phone |
| `Restrictions` | `OPS_RESTRICTIONS` | restriction_code, name, resource_type, valid_from/to, penalty_cost_per_unit |
| `Weekly_Capacities` | `OPS_WEEKLY_CAPACITIES` | restriction (assoc), year, week, capacity |
| `PENALTY_RULES` | `OPS_PENALTY_RULES` | rule_type, customer_priority, product_id, penalty_per_day, penalty_flat |
| `Components` | `OPS_COMPONENTS` | component_code, name, supplier, unit_cost, lead_time_days, min_stock |
| `Component_Availability` | `OPS_COMPONENT_AVAILABILITY` | component (assoc), year, week, available_qty, reserved_qty |
| `Sales_Orders` | `OPS_SALES_ORDERS` | order_number, customer/product (assoc), requested/promise_date, quantity, unit_price, revenue, cost, priority, status |
| `Order_Restrictions` | `OPS_ORDER_RESTRICTIONS` | sales_order + restriction (assoc), capacity_usage_per_unit |
| `Order_Components` | `OPS_ORDER_COMPONENTS` | sales_order + component (assoc), required_qty_per_unit |
| `Optimization_Runs` | `OPS_OPTIMIZATION_RUNS` | run_number, status, parameters (JSON), KPIs, execution_time_ms |
| `Optimization_Results` | `OPS_OPTIMIZATION_RESULTS` | run + sales_order (assoc), original/optimized_date, delay_days, penalty_cost, feasible, status + **snapshot columns** |
| `Capacity_Analysis` | `OPS_CAPACITY_ANALYSIS` | run + restriction, year/week, capacity, required, utilization_pct, over_capacity, violation_cost, is_critical + snapshot |
| `Component_Analysis` | `OPS_COMPONENT_ANALYSIS` | run + component, year/week, available, required, shortage, shortage_cost, is_critical + snapshot |

### Database Abstraction (`srv/db.js`)

- Connects via CAP: primary store `cds.connect.to('db1')`; reference store `cds.connect.to('db')`.
- `TABLE_MAP` maps logical names (e.g. `products`) → physical (`OPS_PRODUCTS`); `_remapSql` rewrites raw SQL; `normalizeRow` lower-cases HANA column names.
- Generic helpers: `queryAll`, `queryOne`, `runStmt`, `findAll`, `findOne`, `insert`, `update`, `remove`, `removeWhere`, `count`.
- Composite reads: `getOrdersWithDetails` (orders + restriction/component links + joined names), `getRestrictionsWithCapacity`, `getComponentsWithAvailability`.
- Value coercion on write: booleans → `1/0`, `Date` → ISO string, `undefined` → `null`.

### Front-End Models
The SPA holds in-memory JS arrays per loaded page (products, customers, orders, current run detail, parsed Excel sheets). `const API = 'api'` is the REST base; the `api(method, path, body)` helper wraps `fetch`.

---

## 9. Backend API Reference (REST, base `/api`)

All endpoints are JSON over the Express router in [srv/routes.js](srv/routes.js). Non-GET mutations pass through `guardDataMutation` (returns `423` while a run is in progress).

### Master Data — CRUD + Bulk

| Method | Path | Description |
|--------|------|-------------|
| GET / POST / PUT / DELETE | `/products`, `/products/:id` | Product CRUD |
| POST | `/products_bulk` | Bulk insert (validates `product_code` + `name`) |
| GET / POST / PUT / DELETE | `/customers`, `/customers/:id` | Customer CRUD |
| POST | `/customers_bulk` | Bulk insert |
| GET / POST / PUT / DELETE | `/restrictions`, `/restrictions/:id` | Restriction CRUD (GET embeds `weekly_capacities`) |
| POST | `/restrictions_bulk` | Bulk insert |
| GET / POST | `/restrictions/:id/capacities` | List / upsert one weekly capacity |
| POST | `/restrictions/:id/bulk-capacities` | Generate N consecutive weekly capacities |
| POST | `/weekly_capacities_bulk` | HANA `MERGE` upsert from Excel |
| GET / POST / PUT / DELETE | `/components`, `/components/:id` | Component CRUD (GET embeds `availability`) |
| POST | `/components_bulk` | Bulk insert |
| GET / POST | `/components/:id/availability` | List / upsert one weekly availability |
| POST | `/component_availability_bulk` | HANA `MERGE` upsert from Excel |
| GET / POST / PUT / DELETE | `/penalty-rules`, `/penalty-rules/:id` | Penalty rule CRUD |
| POST | `/penalty_rules_bulk` | Bulk insert |

### Sales Orders

| Method | Path | Description |
|--------|------|-------------|
| GET | `/sales-orders` | List with joined customer/product names |
| GET | `/sales-orders/:id` | Single order + restriction & component links |
| POST | `/sales-orders` | Create (auto `SO-0000` numbering, auto revenue) |
| PUT | `/sales-orders/:id` | Update header + replace restriction/component links |
| DELETE | `/sales-orders/:id` | Delete |
| POST | `/sales_orders_bulk` | Bulk insert (validates order #/customer/product, computes revenue) |
| POST / DELETE | `/sales-orders/:id/restrictions[/:rid]` | Add / remove a restriction link |
| POST / DELETE | `/sales-orders/:id/components[/:cid]` | Add / update / remove a component link |
| POST | `/order_restrictions_bulk` | Excel: resolve product_code+restriction_code → IDs, fan out to all matching orders |
| POST | `/order_components_bulk` | Excel: resolve product_code+component_code → IDs, fan out to all matching orders |

### Planning & Operations

| Method | Path | Description |
|--------|------|-------------|
| POST | `/optimize` | Run the GA (see §10). Returns run, order_results, capacity_analysis, component_analysis, summary |
| GET | `/optimization-runs` | List runs (newest first) |
| GET | `/optimization-runs/:id` | Run detail with `COALESCE(snapshot, live-join)` for results/analyses |
| POST | `/backfill-optimization-snapshots` | One-time: copy current master data into result snapshot columns |
| GET | `/dashboard` | Aggregated KPIs, last run, capacity & component status |
| POST | `/seed` | Seed sample data from `config_products-db` |
| DELETE | `/clear-data` | Clear master/transaction data (runs retained) |
| GET | `/health` | `{ status, db, timestamp }` (served from server.js) |

> The UI5 `manifest.json` also declares an OData v4 `mainService` at `/odata/v4/orderbasedplanning/`, routed by the approuter; the active UI uses the `/api` REST layer.

---

## 10. Complex Business Logic

### Optimization Lock (`guardDataMutation`)
Before any non-GET `/api` request, `isOptimizationRunning()` checks for any `OPS_OPTIMIZATION_RUNS` row with `status = 'Running'`. If one exists, the mutation is rejected with **HTTP 423** and a message asking the user to wait. GET requests and `/optimize` itself are exempt.

### Pre-run Hard Constraints (`/optimize`)
Before the GA starts, the run is **rejected (HTTP 400)** and marked `Failed` if:
- Any active restriction has **all weekly capacities ≤ 0** (or no capacity rows), or
- Any active component has **all weekly availability ≤ 0** (or no rows).

### Genetic Algorithm (`OrderPlanningOptimizer`, `srv/optimizer.js`)
- **Chromosome:** `{ orderId → weekOffset }`, where offset is whole weeks from the promise week. Each order has an allowed `[min, max]` range; `min = max(earliestByToday, -maxEarly)` (cannot schedule before the current week), `max = maxWeeksDelay` (default 8). The GA itself runs with `maxEarly = 0` (on-time vs. late only).
- **Population seeding:** seed 1 = all orders as early as feasible; seed 2 = all on-time; remainder biased toward on-time with some exploration.
- **Loop:** for each generation — evaluate fitness, sort ascending (lower = better), keep elites (`elitismRate` ≈ 10%), then fill via tournament selection (size 3), single-point crossover (`crossoverRate`) and per-gene mutation (`mutationRate`, biased back toward on-time).
- **Fitness (`_evaluateFitness`):** sum of
  - **Late penalty** (offset > 0): per-day rate × days late + flat, from the matching penalty rule (priority+product → priority+ALL → All+product → All+ALL), else priority-based default (`days × 500 × {High:3,Medium:2,Low:1}`).
  - **Early penalty** (offset < 0): same per-day rate × days early (no flat) — holding/carrying cost.
  - **Capacity violations:** per restriction/week, over-capacity × `penalty_cost_per_unit`. If capacity ≤ 0 → **hard** penalty `over × 1e9` and affected orders flagged **infeasible**.
  - **Component shortages:** per component/week, shortage × `unit_cost × 3`. If availability ≤ 0 → **hard** penalty `shortage × 1e9` and affected orders flagged infeasible.
  - `NaN` guard clamps to `Number.MAX_SAFE_INTEGER`.
- **Greedy Pull-Forward (opt-in early scheduling):** after the GA, if enabled, orders are processed High→Medium→Low (ties by earliest promise date) and each is moved to the earliest week within `earlyWeeks` that keeps **every** restriction under capacity and **every** component available. Usage is relocated week-to-week; the schedule is then re-evaluated so reported penalties reflect the pulled-forward placement.
- **Output:** offsets are converted to confirmed dates (Monday of the confirmed ISO week).

### Result Status & Same-Week Tolerance (`/optimize`)
Planning is week-based, so a placement in the **same ISO week** as the promise date is treated as **0 delay (On Time)**. Per order: `Infeasible` if flagged; else `Early Nd` (offset < 0), `On Time` (0), or `Delayed Nd` (> 0). `feasible` flag = `0` if infeasible, else `1` when delay ≤ 28 days. KPIs computed: on-time count/%, avg & max delay, total penalty cost, execution time, critical restriction/component counts.

### Snapshot / Wipe-Safe History
On write, each `Optimization_Results` / `Capacity_Analysis` / `Component_Analysis` row stores denormalised master-data fields (order #, names, dates, codes). Run-detail reads use `COALESCE(snapshot, live-join)` with LEFT JOINs so cleared master data never drops historical rows. `clearAllData()` deliberately omits the optimization output tables. `/backfill-optimization-snapshots` populates snapshots on legacy rows (run once before the first Clear Data).

### Excel Bulk Upsert (Capacity / Availability)
`/weekly_capacities_bulk` and `/component_availability_bulk` build HANA `MERGE ... USING (SELECT ... FROM DUMMY)` statements keyed on `(restriction_id|component_id, year, week)` and run them in sequence — update on match, insert otherwise.

### Order-Link Bulk Resolution
`/order_restrictions_bulk` and `/order_components_bulk` accept Excel rows keyed by **codes** (`product_code` + `restriction_code` / `component_code`), build code→ID lookup maps, and **fan out** a link row to every sales order whose product matches — reporting per-row errors for unknown codes.

---

## 11. Modals & Dialogs Reference

| Modal / Action | Trigger | Purpose | Endpoint on Save |
|----------------|---------|---------|------------------|
| Product modal | Add / Edit (Products) | Product master form | `POST/PUT /products` |
| Customer modal | Add / Edit (Customers) | Customer form | `POST/PUT /customers` |
| Restriction modal | Add / Edit (Restrictions) | Restriction form | `POST/PUT /restrictions` |
| Add-Capacity modal | `openModal_addCapacity` | Single weekly capacity | `POST /restrictions/:id/capacities` |
| Bulk-capacity / generate | Capacity page | N-week generation | `POST /restrictions/:id/bulk-capacities` |
| Component modal | Add / Edit (Components) | Component form | `POST/PUT /components` |
| Availability edit | `editAvailRow` | Single weekly availability | `POST /components/:id/availability` |
| Penalty Rule modal | Add / Edit (Penalties) | Rule form | `POST/PUT /penalty-rules` |
| Order modal | `openOrderModal` / `editOrder` | Order header + restriction/component links | `POST/PUT /sales-orders` |
| Run-detail view | `viewRunDetail` | KPI + results + analyses | `GET /optimization-runs/:id` |
| Excel preview | `_showSheetPreview` | Sheet preview before upload | (client only) |
| Import upload | `uploadAll` | Push parsed rows | matching `*_bulk` endpoint |

---

## 12. Key Data Objects

### Sales Order (a `/sales-orders` list row)

```
{
  "id"                : "uuid",         // primary key
  "order_number"      : "SO-0001",      // unique; auto-generated if blank
  "customer_id"       : "uuid",         // FK -> Customers
  "customer_name"     : "...",          // joined from Customers
  "customer_code"     : "CUST001",      // joined from Customers
  "customer_priority" : "High",         // joined customer priority
  "product_id"        : "uuid",         // FK -> Products
  "product_name"      : "...",          // joined from Products
  "product_code"      : "PROD001",      // joined from Products
  "requested_date"    : "YYYY-MM-DD",   // requested delivery date
  "promise_date"      : "YYYY-MM-DD",   // promised date; drives the horizon
  "quantity"          : 10,
  "unit_price"        : 100,
  "revenue"           : 1000,           // auto = quantity x unit_price
  "cost"              : 0,
  "priority"          : "High|Medium|Low",
  "status"            : "Open|Confirmed|Delivered|Cancelled",
  "notes"             : "..."
}
```

### Optimize Request (`POST /api/optimize`)

```
{
  "description"      : "Planning Run",  // run label
  "population_size"  : 50,              // GA population
  "generations"      : 100,             // GA iterations
  "mutation_rate"    : 0.1,
  "crossover_rate"   : 0.8,
  "early_scheduling" : false,           // opt-in pull-forward
  "early_weeks"      : 0,               // 1-3 when early_scheduling = true
  "max_weeks_delay"  : 8                // max weeks an order may be pushed late
}
```

### Optimize Response (`POST /api/optimize`)

The response is a single object with five top-level keys:

| Key | Type | Contents |
|-----|------|----------|
| `run` | object | The `Optimization_Runs` row (`run_number`, `status`, KPIs) |
| `order_results` | array | One element per order — see example below |
| `capacity_analysis` | array | Per restriction/week: `capacity`, `required_capacity`, `utilization_pct`, `over_capacity`, `violation_cost`, `is_critical` |
| `component_analysis` | array | Per component/week: `available`, `required`, `shortage`, `shortage_cost`, `is_critical` |
| `summary` | object | `total_orders`, `on_time_orders`, `delayed_orders`, `on_time_percentage`, `total_penalty_cost`, `avg_delay_days`, `max_delay_days`, `execution_time_ms`, `critical_restrictions`, `critical_components` |

**One `order_results[]` element:**

```
{
  "order_number"   : "SO-0001",
  "optimized_date" : "2026-06-22",   // Monday of the confirmed week
  "delay_days"     : 0,              // negative = early, 0 = on time
  "penalty_cost"   : 0,
  "feasible"       : 1,              // 0 when infeasible / delay > 28d
  "status"         : "On Time"       // On Time | Early Nd | Delayed Nd | Infeasible
}
```

### Excel Template Columns (per entity)
| Entity | Columns |
|--------|---------|
| products | product_code, name, description, category, unit_price, standard_cost, lead_time_days |
| customers | customer_code, name, priority, contact_person, email, phone |
| restrictions | restriction_code, name, description, resource_type, valid_from, valid_to, penalty_cost_per_unit |
| weekly_capacities | year, week, capacity |
| components | component_code, name, description, supplier, unit_cost, lead_time_days, min_stock |
| component_availability | year, week, available_qty, reserved_qty |
| penalty_rules | rule_type (`late_delivery`/`no_fulfillment`), customer_priority, penalty_per_day, penalty_flat |
| orders | order_number (blank = auto), customer_code, product_code, promise_date, quantity, status, notes |

---

## 13. Security & Authorization

### XSUAA Configuration ([xs-security.json](xs-security.json))

| Property | Value |
|----------|-------|
| xsappname | `orderbasedplanning` |
| tenant-mode | `dedicated` |
| Token validity | 3600 seconds (1 hour) |

**Scopes:** `uaa.user`, `$XSAPPNAME.User`, `$XSAPPNAME.read`, `$XSAPPNAME.admin`.
**Role template:** `VCPUserRole` → references `$XSAPPNAME.User`.
**OAuth redirect URIs:** `https://*.hana.ondemand.com/**`, `https://*.applicationstudio.cloud.sap/**`.

### Route Guards
- **Approuter** ([app/router/xs-app.json](app/router/xs-app.json)): all routes proxied to `srv-api` with CSRF protection; welcome file `/obporderbasedplanning`.
- **HTML5 app router** ([app/orderbasedplanning/xs-app.json](app/orderbasedplanning/xs-app.json)): `/api/*` and `/odata/*` → destination `Order_Based_Planning_New` (`authenticationType: none`, CSRF off); `/resources` & `/test-resources` → `ui5` destination; catch-all → `html5-apps-repo-rt`.
- Backend destinations use `OAuth2UserTokenExchange` for user-token propagation (`configprodoauth`).

### Application-Level Guard
The **Optimization Lock** (`guardDataMutation`, §10) is the app's own runtime guard, returning HTTP `423` on data mutations while a run is `Running`. There is no per-button visibility service in this app.

---

## 14. Internationalisation (i18n)

- **File:** [app/orderbasedplanning/webapp/i18n/i18n.properties](app/orderbasedplanning/webapp/i18n/i18n.properties)
- **Bundle name:** `obp.orderbasedplanning.i18n.i18n`
- Used by the UI5 shell `manifest.json` for `appTitle` / `appDescription` / the FLP inbound `flpTitle`.
- The working SPA (`index.html`) uses literal English strings rather than the resource bundle; labels there are hard-coded.

---

## 15. Usage of App Data in Other Jobs / Apps

| Data Created/Maintained Here | Consumer | How it is used |
|------------------------------|----------|----------------|
| Optimization Runs / Results | Results History view; downstream planning review | Confirmed delivery weeks per order and run KPIs feed production scheduling decisions |
| Capacity Analysis | Planners (this app) | Identifies over-capacity weeks (`is_critical`) and violation cost for capacity re-planning |
| Component Analysis | Planners (this app) | Identifies shortage weeks and shortage cost for procurement / expediting |
| Master Data (`config_products-db`) | Seed routine (`/seed`) | `CP_CUSTOMERGROUP`, `CP_PARTIALPROD_INTRO` etc. from the reference container are read to populate sample Customers/Products |
| Snapshot history | This app (wipe-safe) | Preserves historical runs after master/transaction data is cleared |

---

*Document generated from source-code analysis of `obp.orderbasedplanning` / MTA `OrderBasedPlanning` v1.0.0.*
*Date: June 2026.*
