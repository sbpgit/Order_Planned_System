// srv/optimizer.js
// Genetic Algorithm for Order-Based Planning Optimization

const moment = require('moment');

/**
 * Get ISO week number for a date
 */
function getWeekInfo(dateStr) {
  const m = moment(dateStr);
  return { year: m.isoWeekYear(), week: m.isoWeek() };
}

/**
 * Get the Monday (start) of a given ISO week
 */
function weekToDate(year, week) {
  return moment().isoWeekYear(year).isoWeek(week).startOf('isoWeek');
}

/**
 * Add N weeks to a date string, return YYYY-MM-DD
 */
function addWeeks(dateStr, n) {
  return moment(dateStr).add(n, 'weeks').format('YYYY-MM-DD');
}

class OrderPlanningOptimizer {
  constructor(config = {}) {
    this.populationSize = config.populationSize || 50;
    this.generations = config.generations || 100;
    this.mutationRate = config.mutationRate || 0.1;
    this.crossoverRate = config.crossoverRate || 0.8;
    this.elitismRate = config.elitismRate || 0.1;
    this.maxWeeksDelay = config.maxWeeksDelay || 8; // max weeks we can push an order out (late)
    // Early scheduling is opt-in. When enabled, after the GA run we greedily pull orders
    // forward by up to `earlyWeeks` weeks (the user-chosen 1/2/3-week window).
    this.earlyScheduling = config.earlyScheduling === true;
    this.earlyWeeks = this.earlyScheduling ? (config.earlyWeeks || 1) : 0;
  }

  /**
   * Build the allowed week-offset range for each order.
   * Offset is relative to the order's promise week:
   *   negative = earlier than promised, 0 = on time, positive = late.
   * Lower bound: cannot schedule before the current week, and not more than
   *              `maxEarly` weeks before the promise week.
   * Upper bound: maxWeeksDelay weeks after the promise week (never below the lower bound).
   *
   * The genetic algorithm runs with maxEarly = 0 (it only decides on-time vs. late
   * placements); pulling orders earlier than the promise date is handled deterministically
   * by the greedy pull-forward post-step, which builds its own range with maxEarly = earlyWeeks.
   */
  _buildOrderRanges(orders, maxEarly = 0) {
    const today = moment().startOf('isoWeek');
    const ranges = {};
    for (const order of orders) {
      const pw = getWeekInfo(order.promise_date);
      const promiseStart = weekToDate(pw.year, pw.week);
      // Offset (in whole weeks) that lands the order on the current week.
      const earliestByToday = Math.round(today.diff(promiseStart, 'days') / 7);
      const min = Math.max(earliestByToday, -maxEarly);
      const max = Math.max(min, this.maxWeeksDelay);
      ranges[order.id] = { min, max };
    }
    return ranges;
  }

  /**
   * Main optimization entry point
   */
  async optimize(orders, restrictions, components, penaltyRules) {
    const startTime = Date.now();

    if (!orders || orders.length === 0) {
      return { bestSolution: {}, bestFitness: 0, details: {}, executionTime: 0 };
    }

    // Per-order allowed offset ranges. The GA only chooses on-time vs. late placements
    // (maxEarly = 0); any pull-forward earlier than the promise date is applied afterwards.
    const orderIds = orders.map(o => o.id);
    const ranges = this._buildOrderRanges(orders, 0);

    // Initialize population
    let population = this._initializePopulation(orderIds, ranges);

    let bestSolution = null;
    let bestFitness = Infinity;   // GA fitness (== business penalty: late + violation costs)
    let bestBusinessPenalty = 0;  // real business penalty reported to the user
    let bestDetails = null;

    for (let gen = 0; gen < this.generations; gen++) {
      // Evaluate fitness for each chromosome
      const evaluated = population.map(chromosome => {
        const { fitness, businessPenalty, details } = this._evaluateFitness(
          chromosome, orders, restrictions, components, penaltyRules, ranges
        );
        return { chromosome, fitness, businessPenalty, details };
      });

      // Sort by fitness ascending (lower = better)
      evaluated.sort((a, b) => a.fitness - b.fitness);

      // Track best
      if (evaluated[0].fitness < bestFitness) {
        bestFitness = evaluated[0].fitness;
        bestBusinessPenalty = evaluated[0].businessPenalty;
        bestSolution = { ...evaluated[0].chromosome };
        bestDetails = evaluated[0].details;
      }

      // Build next generation
      const eliteCount = Math.max(1, Math.floor(this.populationSize * this.elitismRate));
      const nextGen = evaluated.slice(0, eliteCount).map(e => ({ ...e.chromosome }));

      while (nextGen.length < this.populationSize) {
        const parent1 = this._tournamentSelect(evaluated);
        const parent2 = this._tournamentSelect(evaluated);

        let child = Math.random() < this.crossoverRate
          ? this._crossover(parent1, parent2, orderIds)
          : { ...parent1 };

        child = this._mutate(child, orderIds, ranges);
        nextGen.push(child);
      }

      population = nextGen;
    }

    // ── Greedy pull-forward (opt-in early scheduling) ──
    // Only when the user enabled early scheduling: take the GA's best (on-time/late) schedule
    // and greedily move each order earlier by up to `earlyWeeks` weeks, but only into weeks that
    // remain feasible (capacity not exceeded, components available). The schedule is then
    // re-evaluated so the reported penalties/usage reflect the pulled-forward placement.
    if (this.earlyScheduling && this.earlyWeeks > 0 && bestSolution) {
      const earlyRanges = this._buildOrderRanges(orders, this.earlyWeeks);
      bestSolution = this._greedyPullForward(bestSolution, orders, restrictions, components, earlyRanges);
      const reEval = this._evaluateFitness(
        bestSolution, orders, restrictions, components, penaltyRules, earlyRanges
      );
      bestBusinessPenalty = reEval.businessPenalty;
      bestDetails = reEval.details;
    }

    const executionTime = Date.now() - startTime;

    // Build final result structure. bestFitness reports the real business penalty
    // (late + early + capacity/component violation costs).
    const result = {
      bestSolution: {},
      bestFitness: bestBusinessPenalty,
      executionTime,
      details: bestDetails || {}
    };

    // Map order offsets back to actual dates
    for (const order of orders) {
      const offset = bestSolution[order.id] || 0;
      const promiseWeek = getWeekInfo(order.promise_date);
      const confirmedDate = weekToDate(promiseWeek.year, promiseWeek.week)
        .add(offset, 'weeks')
        .format('YYYY-MM-DD');
      result.bestSolution[order.id] = confirmedDate;
    }

    return result;
  }

  /** Week key ("year-week") for an order placed at a given week-offset from its promise week. */
  _weekKeyForOffset(order, offset) {
    const pw = getWeekInfo(order.promise_date);
    const d = weekToDate(pw.year, pw.week).add(offset, 'weeks');
    const w = getWeekInfo(d.format('YYYY-MM-DD'));
    return `${w.year}-${w.week}`;
  }

  /**
   * Greedy pull-forward (early scheduling).
   *
   * Starting from the GA's best schedule, move each order as early as feasible — up to
   * `earlyWeeks` weeks before its promise date (and never before the current week, which is
   * already encoded in each range's `min`). Orders are processed high-priority first (then
   * earliest promise date) so the most important orders claim the scarce early capacity first.
   *
   * An earlier week is only accepted when EVERY one of the order's restrictions still has spare
   * capacity and EVERY one of its components is still available in that week — so the pull-forward
   * can never create a capacity over-run or a component shortage.
   *
   * Returns a new offset map (the GA chromosome with some offsets reduced toward / below 0).
   */
  _greedyPullForward(solution, orders, restrictions, components, ranges) {
    const offsets = { ...solution };

    // Hard limits per week
    const capLimit = {};   // restrictionId -> weekKey -> capacity
    for (const r of (restrictions || [])) {
      capLimit[r.id] = {};
      for (const c of (r.weekly_capacities || [])) capLimit[r.id][`${c.year}-${c.week}`] = Number(c.capacity);
    }
    const availLimit = {}; // componentId -> weekKey -> available qty
    for (const comp of (components || [])) {
      availLimit[comp.id] = {};
      for (const a of (comp.availability || [])) availLimit[comp.id][`${a.year}-${a.week}`] = Number(a.available_qty);
    }

    // Running usage from the current placement
    const capUse = {};     // restrictionId -> weekKey -> usage
    const compUse = {};    // componentId -> weekKey -> usage
    const placement = {};  // orderId -> weekKey
    for (const order of orders) {
      const wk = this._weekKeyForOffset(order, offsets[order.id] || 0);
      placement[order.id] = wk;
      for (const or of (order.restrictions || [])) {
        const id = or.restriction_id, u = (or.capacity_usage_per_unit || 1) * order.quantity;
        (capUse[id] || (capUse[id] = {}))[wk] = (capUse[id][wk] || 0) + u;
      }
      for (const oc of (order.components || [])) {
        const id = oc.component_id, u = (oc.required_qty_per_unit || 1) * order.quantity;
        (compUse[id] || (compUse[id] = {}))[wk] = (compUse[id][wk] || 0) + u;
      }
    }

    // Priority order: High → Medium → Low, ties broken by earliest promise date
    const rank = { High: 0, Medium: 1, Low: 2 };
    const sorted = [...orders].sort((a, b) =>
      ((rank[a.priority] != null ? rank[a.priority] : 1) - (rank[b.priority] != null ? rank[b.priority] : 1))
      || (moment(a.promise_date) - moment(b.promise_date))
    );

    for (const order of sorted) {
      const curOff = offsets[order.id] || 0;
      const lowBound = ranges[order.id].min; // = max(earliestByToday, -earlyWeeks)

      // Find the earliest feasible offset strictly earlier than the current placement.
      let chosen = curOff;
      for (let target = lowBound; target < curOff; target++) {
        const wk = this._weekKeyForOffset(order, target);
        let ok = true;
        for (const or of (order.restrictions || [])) {
          const id = or.restriction_id, u = (or.capacity_usage_per_unit || 1) * order.quantity;
          const cap = (capLimit[id] || {})[wk];
          const used = (capUse[id] || {})[wk] || 0;
          if (cap == null || cap <= 0 || used + u > cap) { ok = false; break; }
        }
        if (ok) for (const oc of (order.components || [])) {
          const id = oc.component_id, u = (oc.required_qty_per_unit || 1) * order.quantity;
          const av = (availLimit[id] || {})[wk];
          const used = (compUse[id] || {})[wk] || 0;
          if (av == null || av <= 0 || used + u > av) { ok = false; break; }
        }
        if (ok) { chosen = target; break; }
      }

      if (chosen !== curOff) {
        // Relocate the order's resource usage from its old week to the new (earlier) week.
        const oldWk = placement[order.id];
        const newWk = this._weekKeyForOffset(order, chosen);
        for (const or of (order.restrictions || [])) {
          const id = or.restriction_id, u = (or.capacity_usage_per_unit || 1) * order.quantity;
          capUse[id][oldWk] -= u;
          capUse[id][newWk] = (capUse[id][newWk] || 0) + u;
        }
        for (const oc of (order.components || [])) {
          const id = oc.component_id, u = (oc.required_qty_per_unit || 1) * order.quantity;
          compUse[id][oldWk] -= u;
          compUse[id][newWk] = (compUse[id][newWk] || 0) + u;
        }
        placement[order.id] = newWk;
        offsets[order.id] = chosen;
      }
    }

    return offsets;
  }

  /** Clamp an offset into an order's [min,max] range. */
  _clampToRange(value, range) {
    return Math.min(range.max, Math.max(range.min, value));
  }

  /** Pick a random offset within an order's [min,max] range. */
  _randInRange(range) {
    return range.min + Math.floor(Math.random() * (range.max - range.min + 1));
  }

  /**
   * Initialize population.
   * Each chromosome is a map: { orderId: weekOffset } where the offset lies within
   * the order's allowed range (negative = early, 0 = on-time, positive = late).
   */
  _initializePopulation(orderIds, ranges) {
    const pop = [];

    // Seed 1: every order as EARLY as feasible (offset = min)
    const earliest = {};
    orderIds.forEach(id => { earliest[id] = ranges[id].min; });
    pop.push(earliest);

    // Seed 2: every order on-time (offset = 0, clamped into range)
    const onTime = {};
    orderIds.forEach(id => { onTime[id] = this._clampToRange(0, ranges[id]); });
    pop.push(onTime);

    for (let i = pop.length; i < this.populationSize; i++) {
      const chromosome = {};
      orderIds.forEach(id => {
        const r = ranges[id];
        const roll = Math.random();
        if (roll < 0.5) chromosome[id] = this._clampToRange(0, r); // bias toward on-time (promise date)
        else if (roll < 0.7) chromosome[id] = r.min;               // some early candidates
        else chromosome[id] = this._randInRange(r);                // explore
      });
      pop.push(chromosome);
    }
    return pop;
  }

  /**
   * Evaluate fitness for a chromosome.
   * Returns { fitness, businessPenalty, details }. businessPenalty (the reported cost) =
   * late penalties + early penalties + capacity/component violation penalties.
   * Both early and late placements are charged a per-day cost; only an exactly on-time
   * placement (offset 0) is free.
   */
  _evaluateFitness(chromosome, orders, restrictions, components, penaltyRules, ranges = {}) {
    let totalPenalty = 0;
    const orderPenalties = {};
    const weeklyCapacityUsage = {}; // restrictionId -> { "year-week": usage }
    const weeklyComponentUsage = {}; // componentId -> { "year-week": usage }
    const placement = {};           // orderId -> { offset, weekKey }

    // Build penalty lookup
    const penaltyMap = this._buildPenaltyMap(penaltyRules || []);

    // ── Pass 1: place each order and accumulate weekly resource usage ──
    for (const order of orders) {
      const offset = chromosome[order.id] || 0;
      const promiseWeekInfo = getWeekInfo(order.promise_date);

      // Confirmed week for this order (negative offset = earlier than promised)
      const targetDate = weekToDate(promiseWeekInfo.year, promiseWeekInfo.week).add(offset, 'weeks');
      const { year: confYear, week: confWeek } = getWeekInfo(targetDate.format('YYYY-MM-DD'));
      const weekKey = `${confYear}-${confWeek}`;
      placement[order.id] = { offset, weekKey };

      // Capacity usage for order's restrictions
      for (const or of (order.restrictions || [])) {
        const restId = or.restriction_id;
        const totalUsage = (or.capacity_usage_per_unit || 1) * order.quantity;
        if (!weeklyCapacityUsage[restId]) weeklyCapacityUsage[restId] = {};
        weeklyCapacityUsage[restId][weekKey] = (weeklyCapacityUsage[restId][weekKey] || 0) + totalUsage;
      }

      // Component usage
      for (const oc of (order.components || [])) {
        const compId = oc.component_id;
        const totalReq = (oc.required_qty_per_unit || 1) * order.quantity;
        if (!weeklyComponentUsage[compId]) weeklyComponentUsage[compId] = {};
        weeklyComponentUsage[compId][weekKey] = (weeklyComponentUsage[compId][weekKey] || 0) + totalReq;
      }
    }

    // ── Capacity violation penalties (also record which weeks are over capacity) ──
    const infeasibleOrderIds = new Set();
    const overCapWeeks = {}; // restrictionId -> Set(weekKey)
    for (const restriction of (restrictions || [])) {
      const restId = restriction.id;
      const usageByWeek = weeklyCapacityUsage[restId] || {};

      for (const [weekKey, usage] of Object.entries(usageByWeek)) {
        const [year, week] = weekKey.split('-').map(Number);
        const capEntry = (restriction.weekly_capacities || []).find(
          c => c.year === year && c.week === week
        );
        const capacity = Number(capEntry ? capEntry.capacity : 0);
        const overCapacity = Math.max(0, usage - capacity);

        if (overCapacity > 0) {
          (overCapWeeks[restId] || (overCapWeeks[restId] = new Set())).add(weekKey);
          if (capacity <= 0) {
            // Hard constraint: capacity is 0 → massive penalty, mark orders as infeasible
            totalPenalty += Number(overCapacity) * 1e9;
            for (const order of orders) {
              if (placement[order.id].weekKey !== weekKey) continue;
              if ((order.restrictions || []).some(or => or.restriction_id === restId)) {
                infeasibleOrderIds.add(order.id);
              }
            }
          } else {
            // Soft constraint: linear penalty per over-unit
            totalPenalty += Number(overCapacity) * Number(restriction.penalty_cost_per_unit || 100);
          }
        }
      }
    }

    // ── Component shortage penalties (also record which weeks are short) ──
    const shortWeeks = {}; // componentId -> Set(weekKey)
    for (const component of (components || [])) {
      const compId = component.id;
      const usageByWeek = weeklyComponentUsage[compId] || {};

      // Build availability map
      const availMap = {};
      for (const avail of (component.availability || [])) {
        availMap[`${avail.year}-${avail.week}`] = Number(avail.available_qty);
      }

      for (const [weekKey, required] of Object.entries(usageByWeek)) {
        const available = Number(availMap[weekKey] || 0);
        const shortage = Math.max(0, Number(required) - available);
        if (shortage > 0) {
          (shortWeeks[compId] || (shortWeeks[compId] = new Set())).add(weekKey);
          if (available <= 0) {
            // Hard constraint: no availability → massive penalty, mark orders as infeasible
            totalPenalty += Number(shortage) * 1e9;
            for (const order of orders) {
              if (placement[order.id].weekKey !== weekKey) continue;
              if ((order.components || []).some(oc => oc.component_id === compId)) {
                infeasibleOrderIds.add(order.id);
              }
            }
          } else {
            // Soft constraint: 3x component cost per unit short
            totalPenalty += Number(shortage) * Number(component.unit_cost || 10) * 3;
          }
        }
      }
    }

    // ── Pass 2: per-order late penalty / early penalty ──
    for (const order of orders) {
      const { offset } = placement[order.id];
      let orderPenalty = 0;

      if (offset > 0) {
        // Late delivery penalty (scheduled after the promise date)
        orderPenalty += this._calcLatePenalty(order, offset * 7, penaltyMap);
      } else if (offset < 0) {
        // Early-delivery penalty — scheduling ahead of the promise date is a cost
        // (holding / carrying inventory), charged at the same per-day rate as late delivery.
        orderPenalty += this._calcEarlyPenalty(order, (-offset) * 7, penaltyMap);
      }

      orderPenalties[order.id] = orderPenalty;
      totalPenalty += orderPenalty;
    }

    if (isNaN(totalPenalty)) {
      console.error('❌ NaN detected in fitness!', {
        chromosome,
        totalPenalty
      });
      totalPenalty = Number.MAX_SAFE_INTEGER;
    }

    return {
      fitness: totalPenalty,
      businessPenalty: totalPenalty,
      details: {
        orderPenalties,
        weeklyCapacityUsage,
        weeklyComponentUsage,
        infeasibleOrderIds: Array.from(infeasibleOrderIds),
        totalPenalty
      }
    };
  }

  _calcLatePenalty(order, delayDays, penaltyMap) {
    const priority = order.priority || 'Medium';
    const productId = order.product_id;

    // Look for specific rule: priority + product
    const key1 = `late_delivery:${priority}:${productId}`;
    const key2 = `late_delivery:${priority}:ALL`;
    const key3 = `late_delivery:All:${productId}`;
    const key4 = `late_delivery:All:ALL`;

    const rule = penaltyMap[key1] || penaltyMap[key2] || penaltyMap[key3] || penaltyMap[key4];

    if (rule) {
      return (Number(rule.penalty_per_day) * Number(delayDays)) + Number(rule.penalty_flat);
    }

    // Default fallback by priority
    const multiplier = priority === 'High' ? 3 : priority === 'Medium' ? 2 : 1;
    return Number(delayDays) * 500 * multiplier;
  }

  /**
   * Early-delivery penalty (a cost) for scheduling an order ahead of its promise date.
   * Uses the same penalty-rule per-day rate as late delivery: the cost is the per-day rate × days early.
   * The flat component is NOT applied (that represents a fixed cost of being late, not of being early).
   * Returned as a positive amount; the caller adds it to the cost.
   */
  _calcEarlyPenalty(order, earlyDays, penaltyMap) {
    const priority = order.priority || 'Medium';
    const productId = order.product_id;

    const rule = penaltyMap[`late_delivery:${priority}:${productId}`]
      || penaltyMap[`late_delivery:${priority}:ALL`]
      || penaltyMap[`late_delivery:All:${productId}`]
      || penaltyMap[`late_delivery:All:ALL`];

    if (rule) {
      return Number(rule.penalty_per_day) * Number(earlyDays);
    }

    // Default fallback by priority (mirrors _calcLatePenalty's per-day rate)
    const multiplier = priority === 'High' ? 3 : priority === 'Medium' ? 2 : 1;
    return Number(earlyDays) * 500 * multiplier;
  }

  _buildPenaltyMap(penaltyRules) {
    const map = {};
    for (const rule of penaltyRules) {
      const prodKey = rule.product_id || 'ALL';
      const key = `${rule.rule_type}:${rule.customer_priority}:${prodKey}`;
      map[key] = rule;
    }
    return map;
  }

  /**
   * Tournament selection
   */
  _tournamentSelect(evaluated, tournamentSize = 3) {
    const candidates = [];
    for (let i = 0; i < tournamentSize; i++) {
      const idx = Math.floor(Math.random() * evaluated.length);
      candidates.push(evaluated[idx]);
    }
    candidates.sort((a, b) => a.fitness - b.fitness);
    return candidates[0].chromosome;
  }

  /**
   * Single-point crossover
   */
  _crossover(parent1, parent2, orderIds) {
    const point = Math.floor(Math.random() * orderIds.length);
    const child = {};
    orderIds.forEach((id, idx) => {
      child[id] = idx < point ? parent1[id] : parent2[id];
    });
    return child;
  }

  /**
   * Mutation: randomly change some order offsets within each order's allowed range.
   */
  _mutate(chromosome, orderIds, ranges) {
    const mutated = { ...chromosome };
    for (const id of orderIds) {
      if (Math.random() < this.mutationRate) {
        const r = ranges[id];
        // Bias toward the promise date (on-time) on mutation
        mutated[id] = Math.random() < 0.4 ? this._clampToRange(0, r) : this._randInRange(r);
      }
    }
    return mutated;
  }
}

module.exports = { OrderPlanningOptimizer, getWeekInfo, weekToDate };
