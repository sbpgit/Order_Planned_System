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
 * prepTicker — tracks the real server-side prep progress for a single
 * POST /optimize request (loading orders/restrictions/components, allocating
 * them from the SAP BOM, validating capacity & availability, persisting the
 * BOM-derived allocations) that spans BOTH the POST /optimize request itself
 * AND the start of the background _runOptimizationAsync task that follows it
 * — the response comes back with a runId well before the GA actually starts,
 * so the client keeps polling this until the real optimization engine begins.
 *
 * Keyed by a client-supplied token (sent as `prep_token` in the request body)
 * so the client can poll GET /optimize/prep-status/:token for the actual
 * stage text instead of faking one with a client-only setInterval.
 */
const PREP_STAGES = [
  'Loading orders, restrictions & components...',
  'Allocating restrictions...',
  'Allocating components...',
  'Validating capacity & availability...',
  'Persisting order allocations...'
];

const PREP_DONE = Symbol('prep-done');
// How long a finished token's DONE marker sticks around before being swept —
// long enough for the client's ~10s poll to observe it at least once even
// under a slow connection, short enough not to accumulate across many runs.
const PREP_DONE_TTL_MS = 60000;

const prepTicker = {
  _stage: new Map(), // token -> stage index | PREP_DONE

  start(token) {
    if (token) this._stage.set(token, 0);
  },
  advance(token) {
    if (!token || !this._stage.has(token)) return;
    const cur = this._stage.get(token);
    if (cur === PREP_DONE) return;
    this._stage.set(token, Math.min(cur + 1, PREP_STAGES.length - 1));
  },
  // Returns { stage, done }. `done: true` tells the client prep has genuinely
  // finished (the GA is starting) — as opposed to `stage: null` for an unknown
  // or not-yet-registered token, which the client should keep waiting on.
  get(token) {
    if (!this._stage.has(token)) return { stage: null, done: false };
    const v = this._stage.get(token);
    return v === PREP_DONE ? { stage: null, done: true } : { stage: PREP_STAGES[v], done: false };
  },
  done(token) {
    if (!token) return;
    this._stage.set(token, PREP_DONE);
    setTimeout(() => {
      if (this._stage.get(token) === PREP_DONE) this._stage.delete(token);
    }, PREP_DONE_TTL_MS).unref?.();
  }
};

class OrderPlanningOptimizer {
  constructor(config = {}) {
    this.populationSize = config.populationSize || 50;
    this.timeLimitMs = config.timeLimitHrs ? config.timeLimitHrs * 60 * 60 * 1000 : null;
    this.generations = this.timeLimitMs ? null : (config.generations || 100);
    this.mutationRate = config.mutationRate || 0.1;
    this.crossoverRate = config.crossoverRate || 0.8;
    this.elitismRate = config.elitismRate || 0.1;
    this.maxWeeksDelay = config.maxWeeksDelay || 8;
    // Early scheduling is opt-in: only when enabled can the greedy pull-forward
    // step (see _greedyPullForward) place an order before its promise date.
    // The dropdown offers 1-3 weeks; anything out of range is clamped.
    this.earlyScheduling = config.earlyScheduling === true;
    this.maxWeeksEarly = this.earlyScheduling
      ? Math.min(3, Math.max(1, parseInt(config.earlyWeeks, 10) || 1))
      : 0;
  }

  /**
   * Main optimization entry point
   */
  async optimize(orders, restrictions, components, penaltyRules, signal = null, onGenerationComplete = null) {
    const startTime = Date.now();

    if (!orders || orders.length === 0) {
      return { bestSolution: {}, bestFitness: 0, details: {}, executionTime: 0 };
    }

    // All orders participate in the GA — no structural infeasibility exclusion
    const orderIds = orders.map(o => o.id);
    const maxOffsets = this.maxWeeksDelay + 1;

    const todayWeekStart = moment().isoWeekday() === 1
      ? moment().startOf('isoWeek')
      : moment().add(1, 'week').startOf('isoWeek');
    const floorOffsets = {};
    for (const order of orders) {
      const { year, week } = getWeekInfo(order.promise_date);
      const promiseWeekStart = weekToDate(year, week);
      floorOffsets[order.id] = Math.max(-this.maxWeeksEarly, todayWeekStart.diff(promiseWeekStart, 'weeks'));
    }

    // Initialize population
    let population = this._initializePopulation(orderIds, maxOffsets, floorOffsets);

    let bestSolution = null;
    let bestFitness = Infinity;
    let bestDetails = null;
    let generationsRun = 0;

    const useTimeBased = this.timeLimitMs != null;
    const shouldContinue = () => {
      if (signal && signal.aborted) return false;
      return useTimeBased
        ? Date.now() - startTime < this.timeLimitMs
        : generationsRun < this.generations;
    };

    while (shouldContinue()) {
      await new Promise(r => setImmediate(r)); // yield between generations
      if (!shouldContinue()) break;

      // Evaluate fitness in chunks, yielding every 10 chromosomes so the event loop
      // can process stop signals and poll requests mid-generation
      const evaluated = [];
      for (let i = 0; i < population.length; i++) {
        await new Promise(r => setImmediate(r));
        if (!shouldContinue()) break;
        const { fitness, details } = this._evaluateFitness(
          population[i], orders, restrictions, components, penaltyRules, floorOffsets
        );
        evaluated.push({ chromosome: population[i], fitness, details });
      }
      if (evaluated.length === 0) break;

      evaluated.sort((a, b) => a.fitness - b.fitness);

      if (evaluated[0].fitness < bestFitness) {
        bestFitness = evaluated[0].fitness;
        bestSolution = { ...evaluated[0].chromosome };
        bestDetails = evaluated[0].details;
      }

      generationsRun++;

      if (onGenerationComplete) {
        const avgFitness = evaluated.reduce((s, e) => s + e.fitness, 0) / evaluated.length;
        await onGenerationComplete(generationsRun, bestFitness, avgFitness);
      }

      if (bestFitness === 0) break;

      const eliteCount = Math.max(1, Math.floor(this.populationSize * this.elitismRate));
      const nextGen = evaluated.slice(0, eliteCount).map(e => ({ ...e.chromosome }));

      while (nextGen.length < this.populationSize) {
        const parent1 = this._tournamentSelect(evaluated);
        const parent2 = this._tournamentSelect(evaluated);

        let child = Math.random() < this.crossoverRate
          ? this._crossover(parent1, parent2, orderIds)
          : { ...parent1 };

        child = this._mutate(child, orderIds, maxOffsets, floorOffsets);
        nextGen.push(child);
      }

      population = nextGen;
    }

    const executionTime = Date.now() - startTime;

    // Post-process: greedily pull orders forward to the earliest week with spare
    // capacity/components. With early scheduling off, floorOffsets never go below
    // 0 (the promise week), so this only closes delay gaps; with it on, orders may
    // also move up to `maxWeeksEarly` weeks before their promise date.
    if (bestSolution) {
      const pulled = this._greedyPullForward(bestSolution, orders, restrictions, components, floorOffsets);
      const { fitness: pf, details: pd } = this._evaluateFitness(
        pulled, orders, restrictions, components, penaltyRules, floorOffsets
      );
      // Only adopt the pulled-forward placement if it's at least as good — guards
      // against the greedy heuristic ever regressing the GA's best-found solution.
      if (pf <= bestFitness) {
        bestSolution = pulled;
        bestDetails  = pd;
        bestFitness  = pf;
      }
    }

    // Build final result structure
    const result = {
      bestSolution: {},
      bestFitness,
      executionTime,
      generationsRun,
      aborted: !!(signal && signal.aborted),
      details: bestDetails || {}
    };

    // Every order gets a scheduled date
    for (const order of orders) {
      const offset = bestSolution[order.id] || 0;
      const effectiveOffset = Math.max(offset, floorOffsets[order.id] || 0);
      const promiseWeek = getWeekInfo(order.promise_date);
      const confirmedDate = weekToDate(promiseWeek.year, promiseWeek.week)
        .add(effectiveOffset, 'weeks')
        .format('YYYY-MM-DD');
      result.bestSolution[order.id] = confirmedDate;
    }

    return result;
  }

  /**
   * Initialize random population
   * Each chromosome is a map: { orderId: weekOffset (0..maxWeeksDelay) }
   */
  _initializePopulation(orderIds, maxOffsets, floorOffsets = {}) {
    const pop = [];
    // First chromosome: all orders on-time (offset 0 = promise date, zero penalty baseline)
    const onTime = {};
    orderIds.forEach(id => { onTime[id] = 0; });
    pop.push(onTime);

    for (let i = 1; i < this.populationSize; i++) {
      const chromosome = {};
      orderIds.forEach(id => {
        // GA only explores on-time to delayed (0..maxOffsets); early scheduling is left to pull-forward
        chromosome[id] = Math.random() < 0.5 ? 0 : Math.floor(Math.random() * maxOffsets);
      });
      pop.push(chromosome);
    }
    return pop;
  }

  /**
   * Evaluate fitness (total penalty cost) for a chromosome
   */
  _evaluateFitness(chromosome, orders, restrictions, components, penaltyRules, floorOffsets = {}) {
    let totalPenalty = 0;
    // Early-delivery reward is still netted into `totalPenalty` below so the GA's
    // fitness search keeps its incentive to pull orders forward. It's tracked
    // separately here so the *reported* Total Penalty Cost (see `reportedTotalPenalty`
    // below) reflects only real costs (late + capacity/component violations),
    // with early delivery shown as its own figure instead of silently offsetting it.
    let totalEarlyDeliveryReward = 0;
    const orderPenalties = {};
    const orderEarlyRewards = {};
    const weeklyCapacityUsage = {}; // restrictionId -> { "year-week": usage }
    const weeklyComponentUsage = {}; // componentId -> { "year-week": usage }

    // Build penalty lookup
    const penaltyMap = this._buildPenaltyMap(penaltyRules || []);

    // For each order, calculate penalty based on offset
    for (const order of orders) {
      const offset = chromosome[order.id] || 0;
      // Clamp to floor: overdue orders can never be placed in a past week
      const effectiveOffset = Math.max(offset, floorOffsets[order.id] || 0);
      const promiseWeekInfo = getWeekInfo(order.promise_date);

      let orderPenalty = 0;

      if (effectiveOffset < 0) {
        // Early delivery — subtract reward from total fitness so the GA still
        // favors pulling orders forward, but track the reward amount separately
        // so it isn't netted into the reported Total Penalty Cost.
        const earlyDays = Math.abs(effectiveOffset) * 7;
        const earlyReward = this._calcEarlyReward(order, earlyDays, penaltyMap);
        orderPenalty -= earlyReward;
        orderEarlyRewards[order.id] = earlyReward;
        totalEarlyDeliveryReward += earlyReward;
      } else if (effectiveOffset > 0) {
        // Late delivery penalty
        const delayDays = effectiveOffset * 7;
        orderPenalty += this._calcLatePenalty(order, delayDays, penaltyMap);
      }

      // Track capacity usage at the effective (floored) week
      const targetDate = weekToDate(promiseWeekInfo.year, promiseWeekInfo.week).add(effectiveOffset, 'weeks');
      const { year: confYear, week: confWeek } = getWeekInfo(targetDate.format('YYYY-MM-DD'));
      const weekKey = `${confYear}-${confWeek}`;

      // Capacity usage for order's restrictions
      for (const or of (order.restrictions || [])) {
        const restId = or.restriction_id;
        const usagePerUnit = or.capacity_usage_per_unit || 1;
        const totalUsage = usagePerUnit * order.quantity;

        if (!weeklyCapacityUsage[restId]) weeklyCapacityUsage[restId] = {};
        weeklyCapacityUsage[restId][weekKey] = (weeklyCapacityUsage[restId][weekKey] || 0) + totalUsage;
      }

      // Component usage
      for (const oc of (order.components || [])) {
        const compId = oc.component_id;
        const reqPerUnit = oc.required_qty_per_unit || 1;
        const totalReq = reqPerUnit * order.quantity;

        if (!weeklyComponentUsage[compId]) weeklyComponentUsage[compId] = {};
        weeklyComponentUsage[compId][weekKey] = (weeklyComponentUsage[compId][weekKey] || 0) + totalReq;
      }

      orderPenalties[order.id] = orderPenalty;
      totalPenalty += orderPenalty;
    }

    // Calculate capacity violation penalties
    const infeasibleOrderIds = new Set();
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
          if (capacity <= 0) {
            // Hard constraint: capacity is 0 → massive penalty, mark orders as infeasible
            totalPenalty += Number(overCapacity) * 1e9;
            for (const order of orders) {
              const placedWeek = this._getPlacedWeekKey(order, chromosome, floorOffsets);
              if (placedWeek !== weekKey) continue;
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

    // Calculate component shortage penalties
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
          if (available <= 0) {
            // Hard constraint: no availability → massive penalty, mark orders as infeasible
            totalPenalty += Number(shortage) * 1e9;
            for (const order of orders) {
              const placedWeek = this._getPlacedWeekKey(order, chromosome, floorOffsets);
              if (placedWeek !== weekKey) continue;
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
    if (isNaN(totalPenalty)) {
      console.error('❌ NaN detected in fitness!', {
        chromosome,
        totalPenalty
      });
      totalPenalty = Number.MAX_SAFE_INTEGER;
    }
    // Reported total excludes the early-delivery reward's negative contribution —
    // it's the sum of only late-delivery + capacity/component violation costs.
    // (totalPenalty already has -totalEarlyDeliveryReward baked in for GA fitness,
    // so adding it back here cancels that out.)
    const reportedTotalPenalty = totalPenalty + totalEarlyDeliveryReward;

    return {
      fitness: totalPenalty,
      details: {
        orderPenalties,
        orderEarlyRewards,
        weeklyCapacityUsage,
        weeklyComponentUsage,
        infeasibleOrderIds: Array.from(infeasibleOrderIds),
        totalPenalty,
        totalEarlyDeliveryReward,
        reportedTotalPenalty
      }
    };
  }
  
  _getPlacedWeekKey(order, chromosome, floorOffsets = {}) {
    const offset = chromosome[order.id] || 0;
    const effectiveOffset = Math.max(offset, floorOffsets[order.id] || 0);
    const promiseWeekInfo = getWeekInfo(order.promise_date);
    const targetDate = weekToDate(promiseWeekInfo.year, promiseWeekInfo.week).add(effectiveOffset, 'weeks');
    const { year, week } = getWeekInfo(targetDate.format('YYYY-MM-DD'));
    return `${year}-${week}`;
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

  _calcEarlyReward(order, earlyDays, penaltyMap) {
    const priority  = order.priority || 'Medium';
    const productId = order.product_id;

    const key1 = `early_delivery:${priority}:${productId}`;
    const key2 = `early_delivery:${priority}:ALL`;
    const key3 = `early_delivery:All:${productId}`;
    const key4 = `early_delivery:All:ALL`;

    const rule = penaltyMap[key1] || penaltyMap[key2] || penaltyMap[key3] || penaltyMap[key4];
    if (rule) {
      return (Number(rule.penalty_per_day) * Number(earlyDays)) + Number(rule.penalty_flat);
    }

    // Default: Medium 250/day + 50 flat, High 500/day + 100 flat, Low 100/day + 20 flat
    const perDay = priority === 'High' ? 500 : priority === 'Medium' ? 250 : 100;
    const flat   = priority === 'High' ? 100 : priority === 'Medium' ?  50 :  20;
    return perDay * earlyDays + flat;
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
   * Mutation: randomly change some order offsets
   */
  _mutate(chromosome, orderIds, maxOffsets, floorOffsets = {}) {
    const mutated = { ...chromosome };
    for (const id of orderIds) {
      if (Math.random() < this.mutationRate) {
        // GA only mutates into on-time to delayed range; early scheduling is left to pull-forward
        mutated[id] = Math.random() < 0.4 ? 0 : Math.floor(Math.random() * maxOffsets);
      }
    }
    return mutated;
  }

  /**
   * After the GA converges, greedily pull every order to the earliest week that
   * has sufficient capacity AND components available.  Processes most-delayed
   * orders first so they get first pick of earlier slack weeks.
   */
  _greedyPullForward(solution, orders, restrictions, components, floorOffsets) {
    const getWeekKey = (order, offset) => {
      const { year, week } = getWeekInfo(order.promise_date);
      const d = weekToDate(year, week).add(offset, 'weeks');
      const { year: y, week: w } = getWeekInfo(d.format('YYYY-MM-DD'));
      return `${y}-${w}`;
    };

    // Work with effective offsets
    const current = {};
    for (const order of orders) {
      current[order.id] = Math.max(solution[order.id] || 0, floorOffsets[order.id] || 0);
    }

    // Build cumulative usage maps from current placements
    const capUsage  = {}; // restId  -> { weekKey: totalUsage }
    const compUsage = {}; // compId  -> { weekKey: totalUsage }
    for (const order of orders) {
      const wk = getWeekKey(order, current[order.id]);
      for (const or of (order.restrictions || [])) {
        if (!capUsage[or.restriction_id]) capUsage[or.restriction_id] = {};
        capUsage[or.restriction_id][wk] = (capUsage[or.restriction_id][wk] || 0) +
          (or.capacity_usage_per_unit || 1) * order.quantity;
      }
      for (const oc of (order.components || [])) {
        if (!compUsage[oc.component_id]) compUsage[oc.component_id] = {};
        compUsage[oc.component_id][wk] = (compUsage[oc.component_id][wk] || 0) +
          (oc.required_qty_per_unit || 1) * order.quantity;
      }
    }

    // Most-delayed first; break ties by priority (High → Medium → Low)
    const priorityRank = { High: 0, Medium: 1, Low: 2 };
    const sorted = [...orders].sort((a, b) => {
      const d = (current[b.id] || 0) - (current[a.id] || 0);
      return d !== 0 ? d : (priorityRank[a.priority] || 1) - (priorityRank[b.priority] || 1);
    });

    for (const order of sorted) {
      const curOffset  = current[order.id];
      const floor      = floorOffsets[order.id] || 0;
      if (curOffset <= floor) continue; // already at earliest allowed week

      const curWk = getWeekKey(order, curOffset);

      // Try from earliest allowed week (floor, may be negative = early) up to current position
      for (let tryOffset = floor; tryOffset < curOffset; tryOffset++) {
        const tryWk = getWeekKey(order, tryOffset);
        const [tryYear, tryWeek] = tryWk.split('-').map(Number);
        let ok = true;

        // Check capacity for every restriction this order uses
        for (const or of (order.restrictions || [])) {
          const rest = restrictions.find(r => r.id === or.restriction_id);
          if (!rest) continue;
          const orderUsage = (or.capacity_usage_per_unit || 1) * order.quantity;
          const alreadyUsed = (capUsage[or.restriction_id] || {})[tryWk] || 0;
          const capEntry = (rest.weekly_capacities || []).find(c => c.year === tryYear && c.week === tryWeek);
          const capacity = Number(capEntry ? capEntry.capacity : 0);
          if (capacity <= 0 || alreadyUsed + orderUsage > capacity) { ok = false; break; }
        }
        if (!ok) continue;

        // Check component availability
        for (const oc of (order.components || [])) {
          const comp = components.find(c => c.id === oc.component_id);
          if (!comp) continue;
          const orderReq = (oc.required_qty_per_unit || 1) * order.quantity;
          const alreadyReq = (compUsage[oc.component_id] || {})[tryWk] || 0;
          const availEntry = (comp.availability || []).find(a => a.year === tryYear && a.week === tryWeek);
          const available = Number(availEntry ? availEntry.available_qty : 0);
          if (available <= 0 || alreadyReq + orderReq > available) { ok = false; break; }
        }
        if (!ok) continue;

        // Move this order to the earlier week — update usage maps
        for (const or of (order.restrictions || [])) {
          const u = (or.capacity_usage_per_unit || 1) * order.quantity;
          if (!capUsage[or.restriction_id]) capUsage[or.restriction_id] = {};
          capUsage[or.restriction_id][curWk]  = (capUsage[or.restriction_id][curWk]  || 0) - u;
          capUsage[or.restriction_id][tryWk]  = (capUsage[or.restriction_id][tryWk]  || 0) + u;
        }
        for (const oc of (order.components || [])) {
          const r = (oc.required_qty_per_unit || 1) * order.quantity;
          if (!compUsage[oc.component_id]) compUsage[oc.component_id] = {};
          compUsage[oc.component_id][curWk] = (compUsage[oc.component_id][curWk] || 0) - r;
          compUsage[oc.component_id][tryWk] = (compUsage[oc.component_id][tryWk] || 0) + r;
        }
        current[order.id] = tryOffset;
        break;
      }
    }

    return current;
  }
}

module.exports = { OrderPlanningOptimizer, getWeekInfo, weekToDate, prepTicker, PREP_STAGES };
