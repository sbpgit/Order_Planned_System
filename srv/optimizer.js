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
    this.maxWeeksDelay = config.maxWeeksDelay || 8; // max weeks we can push an order out
  }

  /**
   * Main optimization entry point
   */
  async optimize(orders, restrictions, components, penaltyRules) {
    const startTime = Date.now();

    if (!orders || orders.length === 0) {
      return { bestSolution: {}, bestFitness: 0, details: {}, executionTime: 0 };
    }

    // Build week offset candidates for each order (0 = on time, 1..N = weeks delayed)
    // -N means early (not used here since promise date is the target)
    const orderIds = orders.map(o => o.id);
    const maxOffsets = this.maxWeeksDelay + 1; // 0..maxWeeksDelay

    // Initialize population
    let population = this._initializePopulation(orderIds, maxOffsets);

    let bestSolution = null;
    let bestFitness = Infinity;
    let bestDetails = null;

    for (let gen = 0; gen < this.generations; gen++) {
      // Evaluate fitness for each chromosome
      const evaluated = population.map(chromosome => {
        const { fitness, details } = this._evaluateFitness(
          chromosome, orders, restrictions, components, penaltyRules
        );
        return { chromosome, fitness, details };
      });

      // Sort by fitness ascending (lower = better)
      evaluated.sort((a, b) => a.fitness - b.fitness);

      // Track best
      if (evaluated[0].fitness < bestFitness) {
        bestFitness = evaluated[0].fitness;
        bestSolution = { ...evaluated[0].chromosome };
        bestDetails = evaluated[0].details;
      }

      // Early exit if perfect solution (zero penalty)
      if (bestFitness === 0) break;

      // Build next generation
      const eliteCount = Math.max(1, Math.floor(this.populationSize * this.elitismRate));
      const nextGen = evaluated.slice(0, eliteCount).map(e => ({ ...e.chromosome }));

      while (nextGen.length < this.populationSize) {
        const parent1 = this._tournamentSelect(evaluated);
        const parent2 = this._tournamentSelect(evaluated);

        let child = Math.random() < this.crossoverRate
          ? this._crossover(parent1, parent2, orderIds)
          : { ...parent1 };

        child = this._mutate(child, orderIds, maxOffsets);
        nextGen.push(child);
      }

      population = nextGen;
    }

    const executionTime = Date.now() - startTime;

    // Build final result structure
    const result = {
      bestSolution: {},
      bestFitness,
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

  /**
   * Initialize random population
   * Each chromosome is a map: { orderId: weekOffset (0..maxWeeksDelay) }
   */
  _initializePopulation(orderIds, maxOffsets) {
    const pop = [];
    // First chromosome: all orders on time (offset=0)
    const onTime = {};
    orderIds.forEach(id => { onTime[id] = 0; });
    pop.push(onTime);

    for (let i = 1; i < this.populationSize; i++) {
      const chromosome = {};
      orderIds.forEach(id => {
        // Bias toward 0 (on-time) - 50% chance
        chromosome[id] = Math.random() < 0.5 ? 0 : Math.floor(Math.random() * maxOffsets);
      });
      pop.push(chromosome);
    }
    return pop;
  }

  /**
   * Evaluate fitness (total penalty cost) for a chromosome
   */
  _evaluateFitness(chromosome, orders, restrictions, components, penaltyRules) {
    let totalPenalty = 0;
    const orderPenalties = {};
    const weeklyCapacityUsage = {}; // restrictionId -> { "year-week": usage }
    const weeklyComponentUsage = {}; // componentId -> { "year-week": usage }

    // Build penalty lookup
    const penaltyMap = this._buildPenaltyMap(penaltyRules || []);

    // For each order, calculate penalty based on offset
    for (const order of orders) {
      const offset = chromosome[order.id] || 0;
      const promiseWeekInfo = getWeekInfo(order.promise_date);

      let orderPenalty = 0;

      if (offset === 0) {
        // On time - no delay penalty, but could still have capacity violations tracked below
      } else {
        // Late delivery penalty
        const delayDays = offset * 7;
        const latePenalty = this._calcLatePenalty(order, delayDays, penaltyMap);
        orderPenalty += latePenalty;
      }

      // Track capacity usage
      const targetYear = promiseWeekInfo.year;
      const targetWeek = promiseWeekInfo.week + offset;
      // Normalize week overflow
      const targetDate = weekToDate(targetYear, promiseWeekInfo.week).add(offset, 'weeks');
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
    for (const restriction of (restrictions || [])) {
      const restId = restriction.id;
      const usageByWeek = weeklyCapacityUsage[restId] || {};

      for (const [weekKey, usage] of Object.entries(usageByWeek)) {
        const [year, week] = weekKey.split('-').map(Number);
        const capEntry = (restriction.weekly_capacities || []).find(
          c => c.year === year && c.week === week
        );
        const capacity = capEntry ? capEntry.capacity : 0;
        const overCapacity = Math.max(0, usage - capacity);

        if (overCapacity > 0) {
          totalPenalty += overCapacity * (restriction.penalty_cost_per_unit || 100);
        }
      }
    }

    // Calculate component shortage penalties
    for (const component of (components || [])) {
      const compId = component.id;
      const usageByWeek = weeklyComponentUsage[compId] || {};

      // Build cumulative availability map
      const availMap = {};
      for (const avail of (component.availability || [])) {
        availMap[`${avail.year}-${avail.week}`] = avail.available_qty;
      }

      for (const [weekKey, required] of Object.entries(usageByWeek)) {
        const available = availMap[weekKey] || 0;
        const shortage = Math.max(0, required - available);
        if (shortage > 0) {
          // No fulfillment penalty: 3x component cost per unit short
          totalPenalty += shortage * (component.unit_cost || 10) * 3;
        }
      }
    }

    return {
      fitness: totalPenalty,
      details: {
        orderPenalties,
        weeklyCapacityUsage,
        weeklyComponentUsage,
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
      return (rule.penalty_per_day * delayDays) + rule.penalty_flat;
    }

    // Default fallback by priority
    const multiplier = priority === 'High' ? 3 : priority === 'Medium' ? 2 : 1;
    return delayDays * 500 * multiplier;
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
  _mutate(chromosome, orderIds, maxOffsets) {
    const mutated = { ...chromosome };
    for (const id of orderIds) {
      if (Math.random() < this.mutationRate) {
        // Bias toward 0 on mutation
        mutated[id] = Math.random() < 0.4 ? 0 : Math.floor(Math.random() * maxOffsets);
      }
    }
    return mutated;
  }
}

module.exports = { OrderPlanningOptimizer, getWeekInfo, weekToDate };
