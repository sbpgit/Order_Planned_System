// ===== Optimize =====
Pages.optimize = () => {
  const fromEl = document.getElementById('opt-date-from');
  const toEl   = document.getElementById('opt-date-to');
  if (!fromEl.value && !toEl.value) {
    const today = new Date();
    const fmtD = d => d.toISOString().slice(0, 10);
    const from = new Date(today); from.setDate(today.getDate() - 28);
    const to   = new Date(today); to.setDate(today.getDate() + 28);
    fromEl.value = fmtD(from);
    toEl.value   = fmtD(to);
  }
  document.getElementById('opt-fitness-card').style.display = 'none';
  document.getElementById('opt-fitness-chart').innerHTML = '';
  document.getElementById('opt-fitness-gen-label').textContent = '';
};

// ===== Fitness Chart =====
function renderFitnessChart(containerId, data) {
  const el = document.getElementById(containerId);
  if (!el || data.length === 0) return;

  const maxPts = 300;
  const step = data.length > maxPts ? Math.ceil(data.length / maxPts) : 1;
  const pts = data.filter((_, i) => i % step === 0 || i === data.length - 1);

  const W = el.clientWidth || 560, H = 180;
  const pad = { top: 16, right: 16, bottom: 32, left: 60 };
  const iW = W - pad.left - pad.right;
  const iH = H - pad.top - pad.bottom;

  const gens   = pts.map(p => Number(p.generation || p.gen));
  const bests  = pts.map(p => Number(p.best_fitness || p.best));
  const avgs   = pts.map(p => Number(p.avg_fitness  || p.avg));
  const allVals = [...bests, ...avgs].filter(v => isFinite(v) && v >= 0);
  if (allVals.length === 0) return;

  const logVals = allVals.map(v => Math.log10(v + 1));
  const minLog = 0, maxLog = Math.max(...logVals) || 1;

  const xScale = g => pad.left + ((g - gens[0]) / (gens[gens.length - 1] - gens[0] || 1)) * iW;
  const yScale = v => pad.top + iH - (Math.log10(v + 1) - minLog) / (maxLog - minLog) * iH;

  const polyline = arr => arr.map((v, i) => `${xScale(gens[i]).toFixed(1)},${yScale(v).toFixed(1)}`).join(' ');

  const yTicks = [];
  for (let e = 0; e <= Math.ceil(maxLog); e++) {
    const v = Math.pow(10, e);
    const y = yScale(v);
    if (y >= pad.top && y <= pad.top + iH) {
      const label = v >= 1e9 ? (v/1e9).toFixed(0)+'B' : v >= 1e6 ? (v/1e6).toFixed(0)+'M' : v >= 1e3 ? (v/1e3).toFixed(0)+'K' : v.toFixed(0);
      yTicks.push(`<line x1="${pad.left}" x2="${pad.left + iW}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="var(--border)" stroke-dasharray="3,3"/>
        <text x="${(pad.left-4).toFixed(1)}" y="${y.toFixed(1)}" text-anchor="end" dominant-baseline="middle" font-size="9" fill="var(--text3)">${label}</text>`);
    }
  }

  const xTickCount = Math.min(6, gens.length);
  const xTicks = Array.from({ length: xTickCount }, (_, i) => {
    const idx = Math.floor(i * (gens.length - 1) / (xTickCount - 1 || 1));
    const x = xScale(gens[idx]);
    return `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${pad.top + iH}" y2="${pad.top + iH + 4}" stroke="var(--border)"/>
      <text x="${x.toFixed(1)}" y="${(pad.top + iH + 14).toFixed(1)}" text-anchor="middle" font-size="9" fill="var(--text3)">${gens[idx]}</text>`;
  });

  el.innerHTML = `
    <svg width="100%" viewBox="0 0 ${W} ${H}" style="overflow:visible">
      ${yTicks.join('')}
      ${xTicks.join('')}
      <polyline points="${polyline(avgs)}" fill="none" stroke="var(--text3)" stroke-width="1.5" opacity="0.6"/>
      <polyline points="${polyline(bests)}" fill="none" stroke="var(--accent)" stroke-width="2"/>
      <text x="${pad.left}" y="${H - 4}" font-size="9" fill="var(--text3)">Generation</text>
    </svg>`;
}

async function fetchAndRenderFitnessChart(runId) {
  try {
    const data = await _pollGet(`/optimization-runs/${runId}/gen-log`);
    if (!data || data.length === 0) return;
    document.getElementById('opt-fitness-card').style.display = '';
    const last = data[data.length - 1];
    document.getElementById('opt-fitness-gen-label').textContent =
      `Gen ${last.generation || last.gen} · Best: ${Number(last.best_fitness || last.best).toLocaleString('en-US', {maximumFractionDigits: 0})}`;
    renderFitnessChart('opt-fitness-chart', data);
  } catch(_) { /* chart fetch failure is non-critical */ }
}

// ===== Optimization =====
function switchOptTab(tab) {
  document.getElementById('opt-tab-gen').classList.toggle('active', tab === 'gen');
  document.getElementById('opt-tab-time').classList.toggle('active', tab === 'time');
  document.getElementById('opt-panel-gen').style.display  = tab === 'gen'  ? '' : 'none';
  document.getElementById('opt-panel-time').style.display = tab === 'time' ? '' : 'none';
}

async function runOptimization() {
  const btn = document.getElementById('btn-run-opt');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Running...';

  document.getElementById('opt-progress').innerHTML = `
    <div style="text-align:center;padding:40px 20px">
      <div class="spinner" style="width:40px;height:40px;margin:0 auto 16px;border-width:3px"></div>
      <div style="font-size:15px;font-weight:600;margin-bottom:8px">Optimization in progress...</div>
      <div class="text-muted text-sm">Genetic algorithm is evaluating order schedules</div>
    </div>`;
  document.getElementById('opt-results-section').style.display = 'none';
  document.getElementById('opt-fitness-card').style.display = 'none';

  try {
    const _locId    = document.getElementById('opt-location-id').value || _currentLocationId || undefined;
    const _dateFrom = document.getElementById('opt-date-from').value || undefined;
    const _dateTo   = document.getElementById('opt-date-to').value || undefined;
    const _useTime  = document.getElementById('opt-tab-time').classList.contains('active');

    const payload = {
      description:    document.getElementById('opt-desc').value,
      population_size: parseInt(document.getElementById('opt-pop').value) || 50,
      mutation_rate:  parseFloat(document.getElementById('opt-mut').value) || 0.1,
      crossover_rate: parseFloat(document.getElementById('opt-cross').value) || 0.8,
      locationId:         _locId,
      promise_date_from:  _dateFrom,
      promise_date_to:    _dateTo
    };

    if (_useTime) {
      payload.time_limit_hrs = parseFloat(document.getElementById('opt-time-hrs').value) || 0.5;
    } else {
      payload.generations = parseInt(document.getElementById('opt-gen').value) || 100;
    }

    const { runId, runNumber } = await api('POST', '/optimize', payload);

    await pollOptimizationStatus(runId, runNumber, btn);

  } catch(e) {
    document.getElementById('opt-progress').innerHTML = `
      <div style="background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.3);border-radius:8px;padding:16px;text-align:center">
        <div style="color:var(--red);font-weight:700">Optimization Failed</div>
        <div class="text-sm text-muted">${e.message}</div>
      </div>`;
    toast(e.message,'error');
    btn.disabled = false;
    btn.innerHTML = 'Run Optimization';
  }
}

async function stopOptimization(runId, btn) {
  btn.disabled = true;
  btn.textContent = 'Stopping...';
  try {
    await api('POST', `/optimize/${runId}/stop`);
  } catch(e) {
    btn.disabled = false;
    btn.textContent = '⏹ Stop Optimization';
    toast('Could not send stop signal: ' + e.message, 'error');
  }
}

async function _pollGet(path, timeoutMs = 30000) {
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(API + path, { signal: ctrl.signal });
    clearTimeout(tid);
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Request failed');
    return data;
  } catch(e) {
    clearTimeout(tid);
    throw e;
  }
}

async function pollOptimizationStatus(runId, runNumber, btn) {
  const startedAt = Date.now();

  const updateElapsed = () => {
    const sec = Math.floor((Date.now() - startedAt) / 1000);
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    const elapsed = h > 0
      ? `${h}h ${m}m ${s}s`
      : m > 0 ? `${m}m ${s}s` : `${s}s`;
    const el = document.getElementById('opt-elapsed');
    if (el) el.textContent = elapsed;
  };

  document.getElementById('opt-progress').innerHTML = `
    <div style="text-align:center;padding:40px 20px">
      <div class="spinner" style="width:40px;height:40px;margin:0 auto 16px;border-width:3px"></div>
      <div style="font-size:15px;font-weight:600;margin-bottom:8px">Optimization running in background...</div>
      <div class="text-muted text-sm">${runNumber}</div>
      <div class="text-muted text-sm" style="margin-top:8px">Elapsed: <span id="opt-elapsed">0s</span></div>
      <button class="btn btn-secondary" style="margin-top:16px;border-color:var(--red);color:var(--red)"
        onclick="stopOptimization('${runId}', this)">⏹ Stop Optimization</button>
    </div>`;

  const ticker = setInterval(updateElapsed, 1000);

  try {
    let pollCount = 0;
    while (true) {
      await new Promise(r => setTimeout(r, 5000));
      pollCount++;
      if (pollCount % 3 === 0) fetchAndRenderFitnessChart(runId);
      let run;
      try {
        run = await _pollGet(`/optimization-runs/${runId}`);
      } catch(e) {
        continue;
      }
      if (!run) continue;

      if (run.status === 'Completed' || run.status === 'Aborted') {
        clearInterval(ticker);
        const s = {
          total_orders:         run.total_orders,
          on_time_orders:       run.on_time_orders,
          delayed_orders:       run.delayed_orders,
          on_time_percentage:   Number(run.on_time_percentage).toFixed(1),
          total_penalty_cost:   Number(run.total_penalty_cost).toFixed(2),
          avg_delay_days:       Number(run.avg_delay_days).toFixed(1),
          max_delay_days:       run.max_delay_days,
          execution_time_ms:    run.execution_time_ms,
          critical_restrictions: (run.capacity_analysis || []).filter(c => c.is_critical).length,
          critical_components:   (run.component_analysis || []).filter(c => c.is_critical).length
        };
        const result = {
          run,
          summary: s,
          order_results:      run.order_results      || [],
          capacity_analysis:  run.capacity_analysis  || [],
          component_analysis: run.component_analysis || []
        };

        if (run.status === 'Aborted') {
          document.getElementById('opt-progress').innerHTML = `
            <div style="background:rgba(251,191,36,0.08);border:1px solid rgba(251,191,36,0.4);border-radius:8px;padding:16px;text-align:center">
              <div style="font-size:28px;margin-bottom:8px">⏹</div>
              <div style="font-size:15px;font-weight:700;color:var(--yellow, #f59e0b)">Optimization Aborted</div>
              <div class="text-sm text-muted" style="margin-top:4px">${run.run_number} · showing best result found before stop</div>
            </div>`;
          toast('Optimization stopped — partial results shown', 'info');
        } else {
          document.getElementById('opt-progress').innerHTML = `
            <div style="background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.3);border-radius:8px;padding:16px;text-align:center">
              <div style="font-size:15px;font-weight:700;color:var(--green)">Optimization Complete</div>
              <div class="text-sm text-muted" style="margin-top:4px">${run.run_number} · ${s.execution_time_ms}ms</div>
            </div>`;
          toast(`Optimization complete: ${s.on_time_percentage}% on-time`, 'success');
        }

        await fetchAndRenderFitnessChart(runId);
        renderOptimizationResults(result);
        document.getElementById('opt-results-section').style.display = 'block';
        break;
      }

      if (run.status === 'Failed') {
        clearInterval(ticker);
        throw new Error('Optimization failed on the server. Check server logs for details.');
      }
    }
  } catch(e) {
    clearInterval(ticker);
    document.getElementById('opt-progress').innerHTML = `
      <div style="background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.3);border-radius:8px;padding:16px;text-align:center">
        <div style="color:var(--red);font-weight:700">Optimization Failed</div>
        <div class="text-sm text-muted">${e.message}</div>
      </div>`;
    toast(e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Run Optimization';
  }
}

async function toggleWhyNoFulfillment(salesOrderId, btnEl) {
  const existingRow = document.getElementById('why-nf-row-' + salesOrderId);
  if (existingRow) {
    existingRow.remove();
    btnEl.textContent = '?';
    return;
  }

  btnEl.disabled = true;
  btnEl.textContent = '…';

  const tr = btnEl.closest('tr');
  const colspan = tr.cells.length;

  const loadRow = document.createElement('tr');
  loadRow.id = 'why-nf-row-' + salesOrderId;
  loadRow.innerHTML = `<td colspan="${colspan}" style="background:var(--bg3);border-left:3px solid var(--red);padding:12px 20px">
    <div class="spinner" style="width:14px;height:14px;display:inline-block;margin-right:8px;vertical-align:middle"></div>
    <span class="text-muted text-sm">Loading order configuration…</span>
  </td>`;
  tr.insertAdjacentElement('afterend', loadRow);

  try {
    const o = await api('GET', `/sales-orders/${salesOrderId}`);
    const hasRestrictions = o.restrictions && o.restrictions.length > 0;
    const hasComponents   = o.components   && o.components.length   > 0;

    const missingItems = [];
    if (!hasRestrictions) missingItems.push({ label: 'No Restriction Allocated', detail: 'This order has no capacity restriction linked. The optimizer requires at least one restriction to schedule the order.' });
    if (!hasComponents)   missingItems.push({ label: 'No Component Allocated',   detail: 'This order has no component (raw material) linked. The optimizer requires at least one component to schedule the order.' });

    const itemsHtml = missingItems.map(item => `
      <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:10px">
        <span style="color:var(--red);font-size:15px;margin-top:1px">✕</span>
        <div>
          <div style="font-size:13px;font-weight:600;color:var(--red)">${item.label}</div>
          <div style="font-size:12px;color:var(--text2);margin-top:2px">${item.detail}</div>
        </div>
      </div>`).join('');

    loadRow.innerHTML = `<td colspan="${colspan}" style="background:rgba(239,68,68,0.04);border-left:3px solid var(--red);padding:14px 20px">
      <div style="font-size:13px;font-weight:700;color:var(--red);margin-bottom:12px">Why was this order not fulfilled?</div>
      ${itemsHtml}
    </td>`;

    btnEl.textContent = 'Hide';
    btnEl.disabled = false;
  } catch(e) {
    loadRow.remove();
    btnEl.textContent = '?';
    btnEl.disabled = false;
    toast('Could not load order details: ' + e.message, 'error');
  }
}

async function toggleWhyInfeasible(salesOrderId, btnEl) {
  const existingRow = document.getElementById('why-row-' + salesOrderId);
  if (existingRow) { existingRow.remove(); btnEl.textContent = '?'; return; }

  const tr = btnEl.closest('tr');
  const colspan = tr.cells.length;
  const runId = window._lastOptResult?.run?.id;

  const loadRow = document.createElement('tr');
  loadRow.id = 'why-row-' + salesOrderId;
  loadRow.innerHTML = `<td colspan="${colspan}" style="background:var(--bg3);border-left:3px solid var(--red);padding:12px 20px">
    <div class="spinner" style="width:14px;height:14px;display:inline-block;margin-right:8px;vertical-align:middle"></div>
    <span class="text-muted text-sm">Analysing infeasibility…</span>
  </td>`;
  tr.insertAdjacentElement('afterend', loadRow);
  btnEl.disabled = true;

  try {
    const { blocking } = await api('GET', `/optimization-runs/${runId}/structural-infeasibility/${salesOrderId}`);

    let bodyHtml;
    if (blocking && blocking.length > 0) {
      bodyHtml = `
        <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.07em;color:var(--text3);margin-bottom:8px">
          Component supply insufficient in every week of the planning horizon
        </div>
        <div class="table-wrap"><table style="width:100%">
          <thead><tr><th>Component</th><th>Required (this order)</th><th>Max Available (any week)</th><th>Permanent Shortage</th></tr></thead>
          <tbody>${blocking.map(b => `<tr>
            <td><div style="font-weight:600;font-size:13px">${b.component_name}</div><div class="mono text-xs text-muted">${b.component_code}</div></td>
            <td class="mono text-red">${Math.round(b.required)}</td>
            <td class="mono text-yellow">${Math.round(b.max_available)}</td>
            <td class="mono text-red">−${Math.round(b.shortage)}</td>
          </tr>`).join('')}</tbody>
        </table></div>
        <div style="margin-top:10px;font-size:12px;color:var(--text3)">
          Increase supply for the above component(s) to at least the required quantity in at least one week to make this order schedulable.
        </div>`;
    } else {
      bodyHtml = `<div style="color:var(--text2);font-size:13px">This order was marked infeasible due to a hard capacity or component constraint in its scheduled week. Check the <strong>Components</strong> tab for details.</div>`;
    }

    loadRow.innerHTML = `<td colspan="${colspan}" style="background:var(--bg3);border-left:3px solid var(--red);padding:14px 20px">
      <div style="font-size:13px;font-weight:700;color:var(--red);margin-bottom:12px">Why is this order Infeasible?</div>
      ${bodyHtml}
    </td>`;
    btnEl.textContent = 'Hide';
    btnEl.disabled = false;
  } catch(e) {
    loadRow.remove();
    btnEl.textContent = '?';
    btnEl.disabled = false;
    toast('Could not load infeasibility reason: ' + e.message, 'error');
  }
}

async function toggleWhyDelayed(salesOrderId, originalDate, btnEl) {
  const existingRow = document.getElementById('why-row-' + salesOrderId);
  if (existingRow) {
    existingRow.remove();
    btnEl.textContent = '?';
    return;
  }

  btnEl.disabled = true;
  btnEl.textContent = '…';

  const tr = btnEl.closest('tr');
  const colspan = tr.cells.length;

  const loadRow = document.createElement('tr');
  loadRow.id = 'why-row-' + salesOrderId;
  loadRow.innerHTML = `<td colspan="${colspan}" style="background:var(--bg3);border-left:3px solid var(--yellow);padding:12px 20px">
    <div class="spinner" style="width:14px;height:14px;display:inline-block;margin-right:8px;vertical-align:middle"></div>
    <span class="text-muted text-sm">Analyzing delay reasons…</span>
  </td>`;
  tr.insertAdjacentElement('afterend', loadRow);

  try {
    const o = await api('GET', `/sales-orders/${salesOrderId}`);
    const result = window._lastOptResult;
    const caps  = result?.capacity_analysis || [];
    const comps = result?.component_analysis || [];

    const { week: pWeek, year: pYear } = isoWeekYear(new Date(originalDate + 'T00:00:00'));

    // Detect orders that were already overdue when the run was executed
    const runDateStr = (result.run?.run_number || '').replace(/^RUN-(\d{4})(\d{2})(\d{2})-.*/, '$1-$2-$3');
    const isAlreadyOverdue = runDateStr && new Date(originalDate + 'T00:00:00') < new Date(runDateStr + 'T00:00:00');
    if (isAlreadyOverdue) {
      const orderResult = (result.order_results || []).find(r => r.sales_order_id === salesOrderId);
      const optDate = orderResult?.optimized_date || '';
      const { week: oWeek, year: oYear } = optDate ? isoWeekYear(new Date(optDate + 'T00:00:00')) : {};
      const optWeekLabel = oWeek ? `W${oWeek}/${oYear} (${fmt.date(optDate)})` : 'the earliest available week';
      loadRow.innerHTML = `<td colspan="${colspan}" style="background:var(--bg3);border-left:3px solid var(--yellow);padding:14px 20px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <div style="font-size:13px;font-weight:700;color:var(--yellow)">Why was this order delayed?</div>
          <div style="font-size:11px;color:var(--text3)">Promise date: W${pWeek}/${pYear} (${fmt.date(originalDate)})</div>
        </div>
        <div style="color:var(--text2);font-size:13px">
          This order's promise date (<strong>${fmt.date(originalDate)}</strong>) had already passed before this run was executed on <strong>${runDateStr}</strong>.
          It was scheduled at the earliest producible week: <strong>${optWeekLabel}</strong>.
        </div>
      </td>`;
      btnEl.textContent = 'Hide';
      btnEl.disabled = false;
      return;
    }

    const orderRestIds = new Set((o.restrictions || []).map(r => r.restriction_id));
    const orderCompIds = new Set((o.components  || []).map(c => c.component_id));

    // Build this order's per-restriction and per-component usage
    // (the stored capacity_analysis excludes displaced orders, so we simulate adding them back)
    const orderRestUsage = {};
    for (const r of (o.restrictions || [])) {
      orderRestUsage[r.restriction_id] = (r.capacity_usage_per_unit || 1) * (o.quantity || 1);
    }
    const orderCompUsage = {};
    for (const c of (o.components || [])) {
      orderCompUsage[c.component_id] = (c.required_qty_per_unit || 1) * (o.quantity || 1);
    }

    const capIssues = caps
      .filter(c => Number(c.year) === pYear && Number(c.week) === pWeek && orderRestIds.has(c.restriction_id))
      .map(c => {
        const extra = orderRestUsage[c.restriction_id] || 0;
        const simRequired = Number(c.required_capacity) + extra;
        const simOver = Math.max(0, simRequired - Number(c.capacity));
        return { ...c, required_capacity: simRequired, over_capacity: simOver, is_critical: simOver > 0 ? 1 : 0 };
      })
      .filter(c => Number(c.over_capacity) > 0 || Number(c.capacity) <= 0);

    const compIssues = comps
      .filter(c => Number(c.year) === pYear && Number(c.week) === pWeek && orderCompIds.has(c.component_id))
      .map(c => {
        const extra = orderCompUsage[c.component_id] || 0;
        const simRequired = Number(c.required) + extra;
        const simShortage = Math.max(0, simRequired - Number(c.available));
        return { ...c, required: simRequired, shortage: simShortage, is_critical: simShortage > 0 ? 1 : 0 };
      })
      .filter(c => Number(c.shortage) > 0 || Number(c.available) <= 0);

    let reasonsHtml = '';
    if (capIssues.length === 0 && compIssues.length === 0) {
      reasonsHtml = `<div style="color:var(--text2);font-size:13px;display:flex;align-items:flex-start;gap:10px">
        <div>W${pWeek}/${pYear} has sufficient capacity and components for this order.
        The optimizer displaced it due to competition with higher-priority orders in the scheduling sequence — re-running with more generations may resolve this.
        See the <strong>Capacity Analysis</strong> tab for the full week picture.</div>
      </div>`;
    } else {
      if (capIssues.length > 0) {
        reasonsHtml += `<div style="margin-bottom:14px">
          <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.07em;color:var(--text3);margin-bottom:8px">Capacity constraints in W${pWeek}/${pYear}</div>
          <div class="table-wrap"><table style="width:100%">
            <thead><tr><th>Restriction / Resource</th><th>Available Cap.</th><th>Required</th><th>Over by</th><th>Type</th></tr></thead>
            <tbody>${capIssues.map(c => {
              const isHard = Number(c.capacity) <= 0;
              return `<tr>
                <td><div style="font-weight:600;font-size:13px">${c.restriction_name}</div><div class="mono text-xs text-muted">${c.restriction_code}</div></td>
                <td class="mono">${Math.round(Number(c.capacity))}</td>
                <td class="mono text-red">${Math.round(Number(c.required_capacity))}</td>
                <td class="mono text-red">+${Math.round(Number(c.over_capacity))}</td>
                <td>${isHard
                  ? '<span class="badge badge-critical">⛔ Hard — Zero capacity</span>'
                  : '<span class="badge badge-delayed">⚠ Overloaded</span>'}</td>
              </tr>`;
            }).join('')}</tbody>
          </table></div>
        </div>`;
      }
      if (compIssues.length > 0) {
        reasonsHtml += `<div>
          <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.07em;color:var(--text3);margin-bottom:8px">Component shortages in W${pWeek}/${pYear}</div>
          <div class="table-wrap"><table style="width:100%">
            <thead><tr><th>Component / Material</th><th>Available</th><th>Required</th><th>Shortage</th><th>Type</th></tr></thead>
            <tbody>${compIssues.map(c => {
              const isHard = Number(c.available) <= 0;
              return `<tr>
                <td><div style="font-weight:600;font-size:13px">${c.component_name}</div><div class="mono text-xs text-muted">${c.component_code}</div></td>
                <td class="mono ${isHard ? 'text-red' : 'text-yellow'}">${Math.round(Number(c.available))}</td>
                <td class="mono">${Math.round(Number(c.required))}</td>
                <td class="mono text-red">${Math.round(Number(c.shortage))}</td>
                <td>${isHard
                  ? '<span class="badge badge-critical">Hard — No stock</span>'
                  : '<span class="badge badge-delayed">Insufficient</span>'}</td>
              </tr>`;
            }).join('')}</tbody>
          </table></div>
        </div>`;
      }
    }

    loadRow.innerHTML = `<td colspan="${colspan}" style="background:var(--bg3);border-left:3px solid var(--yellow);padding:14px 20px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div style="font-size:13px;font-weight:700;color:var(--yellow)">Why was this order delayed?</div>
        <div style="font-size:11px;color:var(--text3)">Promise date week: W${pWeek}/${pYear}</div>
      </div>
      ${reasonsHtml}
    </td>`;

    btnEl.textContent = 'Hide';
    btnEl.disabled = false;
  } catch(e) {
    loadRow.remove();
    btnEl.textContent = '?';
    btnEl.disabled = false;
    toast('Could not load delay reason: ' + e.message, 'error');
  }
}

function renderOptimizationResults(result) {
  window._lastOptResult = result;
  const s = result.summary;
  const orderRank = o => {
    if ((o.status || '').startsWith('Delayed')) return 0;
    return 1;
  };
  const orders = (result.order_results || []).slice().sort((a, b) => orderRank(a) - orderRank(b) || (b.delay_days || 0) - (a.delay_days || 0));
  const caps = result.capacity_analysis || [];
  const comps = result.component_analysis || [];
  const runId = result.run?.id;

  const critCaps = caps.filter(c => c.is_critical);
  const critComps = comps.filter(c => c.is_critical);
  const totalViolationCost = caps.reduce((a,c) => a + (parseInt(c.violation_cost)||0), 0);
  const totalShortageCost = comps.reduce((a,c) => a + (parseInt(c.shortage_cost)||0), 0);
  const onTimePct = Number(s.on_time_percentage||0);
  const ontimeColor = onTimePct >= 80 ? 'var(--green)' : onTimePct >= 60 ? 'var(--yellow)' : 'var(--red)';

  const runParams = (() => { try { return JSON.parse(result.run?.parameters || '{}'); } catch(e) { return {}; } })();
  const runInfoHtml = `
    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:14px 18px;margin-bottom:18px;display:flex;flex-wrap:wrap;gap:18px;align-items:center">
      <div style="display:flex;align-items:center;gap:8px">
        <div>
          <div style="font-size:13px;font-weight:700;color:var(--text)">${result.run?.run_number || '—'}</div>
          <div style="font-size:11px;color:var(--text3)">${result.run?.description || '—'}</div>
        </div>
      </div>
      <div style="width:1px;height:36px;background:var(--border)"></div>
      <div style="display:flex;flex-wrap:wrap;gap:14px">
        <div style="display:flex;flex-direction:column;align-items:center;min-width:60px">
          <span style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.5px">Location</span>
          <span style="font-size:13px;font-weight:600;color:var(--accent);font-family:var(--mono)">${result.run?.location_id || '—'}</span>
        </div>
        <div style="display:flex;flex-direction:column;align-items:center;min-width:60px">
          <span style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.5px">Population</span>
          <span style="font-size:13px;font-weight:600;font-family:var(--mono)">${runParams.population_size ?? '—'}</span>
        </div>
        ${runParams.time_limit_hrs != null ? `
        <div style="display:flex;flex-direction:column;align-items:center;min-width:60px">
          <span style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.5px">Time Limit</span>
          <span style="font-size:13px;font-weight:600;font-family:var(--mono)">${runParams.time_limit_hrs}h</span>
        </div>` : `
        <div style="display:flex;flex-direction:column;align-items:center;min-width:60px">
          <span style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.5px">Generations</span>
          <span style="font-size:13px;font-weight:600;font-family:var(--mono)">${runParams.generations ?? '—'}</span>
        </div>`}
        <div style="display:flex;flex-direction:column;align-items:center;min-width:60px">
          <span style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.5px">Mutation</span>
          <span style="font-size:13px;font-weight:600;font-family:var(--mono)">${runParams.mutation_rate != null ? Number(runParams.mutation_rate).toFixed(2) : '—'}</span>
        </div>
        <div style="display:flex;flex-direction:column;align-items:center;min-width:60px">
          <span style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.5px">Crossover</span>
          <span style="font-size:13px;font-weight:600;font-family:var(--mono)">${runParams.crossover_rate != null ? Number(runParams.crossover_rate).toFixed(2) : '—'}</span>
        </div>
        <div style="display:flex;flex-direction:column;align-items:center;min-width:60px">
          <span style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.5px">Exec Time</span>
          <span style="font-size:13px;font-weight:600;font-family:var(--mono)">${s.execution_time_ms}ms</span>
        </div>
        <div style="display:flex;flex-direction:column;align-items:center;min-width:80px">
          <span style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.5px">Promise From</span>
          <span style="font-size:13px;font-weight:600;font-family:var(--mono)">${runParams.promise_date_from || '—'}</span>
        </div>
        <div style="display:flex;flex-direction:column;align-items:center;min-width:80px">
          <span style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.5px">Promise To</span>
          <span style="font-size:13px;font-weight:600;font-family:var(--mono)">${runParams.promise_date_to || '—'}</span>
        </div>
      </div>
    </div>`;

  const metricsHtml = `
    <div class="result-grid-6" id="result-summary">
      <div class="metric-card mc-green"><div class="mc-val" style="color:${ontimeColor}">${onTimePct.toFixed(1)}%</div><div class="mc-lbl">On-Time Delivery</div></div>
      <div class="metric-card mc-blue"><div class="mc-val" style="color:var(--accent)">${s.on_time_orders||0}/${s.total_orders||0}</div><div class="mc-lbl">Orders On-Time</div></div>
      <div class="metric-card mc-yellow"><div class="mc-val" style="color:var(--yellow)">${Number(s.avg_delay_days||0).toFixed(1)}d</div><div class="mc-lbl">Avg Delay</div><div class="mc-sub">max ${s.max_delay_days||0}d</div></div>
      <div class="metric-card mc-red"><div class="mc-val" style="color:var(--red)">${Number(s.total_penalty_cost||0).toLocaleString()}</div><div class="mc-lbl">Total Penalty</div></div>
      <div class="metric-card mc-orange"><div class="mc-val" style="color:${critCaps.length > 0 ? 'var(--red)' : 'var(--green)'}">${critCaps.length}</div><div class="mc-lbl">Cap. Violations</div><div class="mc-sub">${critCaps.length ? Math.round(totalViolationCost).toLocaleString() : 'None'}</div></div>
      <div class="metric-card mc-purple"><div class="mc-val" style="color:${critComps.length > 0 ? 'var(--red)' : 'var(--green)'}">${critComps.length}</div><div class="mc-lbl">Comp. Shortages</div><div class="mc-sub">${critComps.length ? Math.round(totalShortageCost).toLocaleString() : 'None'}</div></div>
    </div>`;

  const downloadHtml = runId ? `
    <div class="download-strip" style="margin-bottom:20px">
      <div><div class="ds-title">Download Results — ${result.run?.run_number||''}</div><div class="ds-sub">Export results, constraint violations, and utilization analysis</div></div>
      <div class="download-btns">
        <button class="btn btn-excel btn-sm" onclick="downloadOptimizationResults('${runId}','orders')">Orders</button>
        <button class="btn btn-excel btn-sm" onclick="downloadOptimizationResults('${runId}','capacity')">Capacity</button>
        <button class="btn btn-excel btn-sm" onclick="downloadOptimizationResults('${runId}','components')">Components</button>
        <button class="btn btn-primary btn-sm" onclick="downloadOptimizationResults('${runId}','all')">Full Report</button>
      </div>
    </div>` : '';

  const tabsHtml = `
    <div class="tabs" id="result-tabs">
      <div class="tab active" onclick="switchTab('orders')">Order Results (${orders.length})</div>
      <div class="tab" onclick="switchTab('capacity')">Capacity ${critCaps.length ? '<span class="badge badge-critical" style="margin-left:4px">'+critCaps.length+'</span>' : ''}</div>
      <div class="tab" onclick="switchTab('comps')">Components ${critComps.length ? '<span class="badge badge-critical" style="margin-left:4px">'+critComps.length+'</span>' : ''}</div>
      <div class="tab" onclick="switchTab('constraints')">Constraint Summary</div>
    </div>`;

  const ordersTabHtml = `<div id="tab-orders"><div class="card"><div class="card-body" style="padding:0"><div class="table-wrap"><table>
    <thead><tr><th>Order #</th><th>Customer</th><th>Product</th><th>Priority</th><th>Original Date</th><th>Original Week</th><th>Optimized Date</th><th>Optimized Week</th><th>Penalty</th><th>Status</th><th></th></tr></thead>
    <tbody>${orders.map(o => {
      const delayed = (o.status || '').startsWith('Delayed');
      const early   = (o.status || '').startsWith('Early');
      const whyBtn  = delayed
        ? `<button class="btn" style="padding:3px 9px;font-size:11px;background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.5);color:var(--yellow)" onclick="event.stopPropagation();toggleWhyDelayed('${o.sales_order_id}','${o.original_date}',this)">?</button>`
        : '';
      const delayCellClass = delayed ? 'text-yellow' : early ? 'text-accent' : 'text-green';
      const statusBadge    = delayed ? 'badge-delayed' : early ? 'badge-early' : 'badge-ontime';
      return `<tr style="cursor:pointer" onclick="showOrderDetail('${o.sales_order_id}','${o.optimized_date || ''}')" title="Click to view components & restrictions"><td class="mono primary">${o.order_number}</td><td class="text-sm">${o.customer_name||'—'}</td><td class="text-sm">${o.product_name||'—'}</td><td>${fmt.priorityBadge(o.priority)}</td><td>${fmt.date(o.original_date)}</td><td class="mono text-xs text-muted">${fmt.week(o.original_date)}</td><td class="${delayCellClass}">${fmt.date(o.optimized_date)}</td><td class="mono text-xs ${delayCellClass}">${fmt.week(o.optimized_date)}</td><td class="${o.penalty_cost>0?'text-red':'text-green'}">${fmt.penalty(o.penalty_cost)}</td><td><span class="badge ${statusBadge}">${o.status}</span></td><td style="white-space:nowrap">${whyBtn}</td></tr>`;
    }).join('')}</tbody>
  </table></div></div></div></div>`;

  const capByR = {};
  caps.forEach(c => { const k=c.restriction_id||c.restriction_code; if(!capByR[k]) capByR[k]={name:c.restriction_name,code:c.restriction_code,weeks:[]}; capByR[k].weeks.push(c); });
  const avgUtils = Object.values(capByR).map(r => {
    const avg = r.weeks.reduce((a,w)=>a+Number(w.utilization_pct||0),0)/(r.weeks.length||1);
    return {name:r.name,code:r.code,avg,violations:r.weeks.filter(w=>w.is_critical).length};
  }).sort((a,b)=>b.avg-a.avg);

  const capBarHtml = avgUtils.length ? `<div class="card" style="margin-bottom:16px"><div class="card-header"><div class="card-title">Average Capacity Utilization by Restriction</div></div><div class="card-body"><div class="bar-chart">${
    avgUtils.map(r=>{const p=Math.min(100,r.avg);const col=p>=100?'var(--red)':p>=80?'var(--orange)':p>=60?'var(--yellow)':'var(--green)';return `<div class="bar-row"><div class="bar-label" title="${r.name}">${r.name}</div><div class="bar-track"><div class="bar-fill" style="width:${p}%;background:${col}">${p>15?`<span>${p.toFixed(0)}%</span>`:''}</div></div><div class="bar-val">${p.toFixed(1)}%${r.violations>0?' (!)':''}</div></div>`;}).join('')
  }</div><div class="flex gap-3" style="margin-top:10px;flex-wrap:wrap"><span style="font-size:11px;color:var(--green)">■ &lt;60% OK</span><span style="font-size:11px;color:var(--yellow)">■ 60–80% Moderate</span><span style="font-size:11px;color:var(--orange)">■ 80–100% High</span><span style="font-size:11px;color:var(--red)">■ &gt;100% Violation</span></div></div></div>` : '';

  const heatGrids = Object.values(capByR).map(r => {
    const cells = r.weeks.sort((a,b)=>a.year*100+a.week-(b.year*100+b.week)).map(w=>{
      const p=Number(w.utilization_pct)||0;
      const cls=p>=100?'heat-4':p>=80?'heat-3':p>=60?'heat-2':p>=30?'heat-1':'heat-0';
      return `<div class="week-cell ${cls}" title="W${w.week}/${w.year}: ${p.toFixed(0)}% utilization${w.over_capacity>0?', +'+Math.round(w.over_capacity)+' over':''}"><div class="wk-label">W${w.week}</div><div class="wk-pct">${p.toFixed(0)}%</div></div>`;
    }).join('');
    const viol = r.weeks.filter(w=>w.is_critical).length;
    return `<div class="card" style="margin-bottom:12px"><div class="card-header" style="padding:12px 16px"><div class="flex items-center gap-2"><span class="mono text-accent text-xs">${r.code}</span><span style="font-weight:600;font-size:13px">${r.name}</span>${viol>0?`<span class="badge badge-critical">⚠ ${viol} week${viol>1?'s':''} over cap</span>`:'<span class="badge badge-ok">✓ No Violations</span>'}</div></div><div class="card-body" style="padding:12px 16px"><div class="text-xs text-muted" style="margin-bottom:8px">WEEKLY UTILIZATION — hover for details</div><div class="week-heat-grid">${cells}</div></div></div>`;
  }).join('');

  const capViolTable = critCaps.length ? `<div class="card" style="margin-top:12px"><div class="card-header"><div class="card-title">Capacity Violation Details</div></div><div class="card-body" style="padding:0"><div class="table-wrap"><table><thead><tr><th>Restriction</th><th>Week</th><th>Capacity</th><th>Required</th><th>Utilization</th><th>Over-Cap</th><th>Violation Cost</th></tr></thead><tbody>${
    critCaps.map(c=>{const p=Math.min(200,c.utilization_pct||0);return `<tr><td><div style="font-weight:600;font-size:13px">${c.restriction_name}</div><div class="mono text-xs text-muted">${c.restriction_code}</div></td><td class="mono">W${c.week}/${c.year}</td><td class="mono">${c.capacity}</td><td class="mono text-red">${Math.round(c.required_capacity||0)}</td><td><div class="flex items-center gap-2"><div class="progress-bar" style="width:80px"><div class="progress-fill" style="width:${Math.min(100,p)}%;background:var(--red)"></div></div><span style="color:var(--red);font-size:12px;font-family:var(--mono)">${Math.round(p)}%</span></div></td><td class="text-red mono">+${Math.round(c.over_capacity||0)}</td><td class="text-red">${fmt.penalty(c.violation_cost)}</td></tr>`;}).join('')
  }</tbody></table></div></div></div>` : '';

  const capTabHtml = `<div id="tab-capacity" style="display:none">${caps.length===0?'<div class="card"><div class="card-body text-muted text-sm">No capacity data in this run</div></div>':''}${capBarHtml}${heatGrids}${capViolTable}</div>`;

  const compByC = {};
  comps.forEach(c=>{const k=c.component_id||c.component_code;if(!compByC[k]) compByC[k]={name:c.component_name,code:c.component_code,weeks:[]};compByC[k].weeks.push(c);});
  const compBars = Object.values(compByC).map(c=>{
    const tr=c.weeks.reduce((a,w)=>a+Number(w.required||0),0);
    const ta=c.weeks.reduce((a,w)=>a+Number(w.available||0),0);
    const p=ta>0?Math.min(200,(tr/ta)*100):0;
    return {name:c.name,code:c.code,pct:p,shortages:c.weeks.filter(w=>w.is_critical).length};
  }).sort((a,b)=>b.pct-a.pct);

  const compBarHtml = compBars.length ? `<div class="card" style="margin-bottom:16px"><div class="card-header"><div class="card-title">Component Demand vs Availability (Total Across All Weeks)</div></div><div class="card-body"><div class="bar-chart">${
    compBars.map(c=>{const p=Math.min(100,c.pct);const col=c.pct>=100?'var(--red)':c.pct>=80?'var(--orange)':c.pct>=60?'var(--yellow)':'var(--green)';return `<div class="bar-row"><div class="bar-label" title="${c.name}">${c.name}</div><div class="bar-track"><div class="bar-fill" style="width:${p}%;background:${col}">${p>15?`<span>${c.pct.toFixed(0)}%</span>`:''}</div></div><div class="bar-val">${c.pct.toFixed(0)}%${c.shortages>0?' (!)':''}</div></div>`;}).join('')
  }</div><div class="text-xs text-muted" style="margin-top:8px">% = total required / total available across all planned weeks</div></div></div>` : '';

  const compTabHtml = `<div id="tab-comps" style="display:none">${comps.length===0?'<div class="card"><div class="card-body text-muted text-sm">No component data</div></div>':''}${compBarHtml}<div class="card"><div class="card-header"><div class="card-title">Weekly Component Status</div></div><div class="card-body" style="padding:0"><div class="table-wrap"><table><thead><tr><th>Component</th><th>Week</th><th>Available</th><th>Required</th><th>Utilization</th><th>Shortage</th><th>Shortage Cost</th><th>Status</th></tr></thead><tbody>${
    comps.map(c=>{const p=c.available>0?Math.min(200,(c.required/c.available)*100):0;const col=c.is_critical?'var(--red)':p>=80?'var(--yellow)':'var(--green)';return `<tr><td><div style="font-weight:600;font-size:13px">${c.component_name}</div><div class="mono text-xs text-muted">${c.component_code}</div></td><td class="mono">W${c.week}/${c.year}</td><td class="mono text-green">${Math.round(c.available||0)}</td><td class="mono">${Math.round(c.required||0)}</td><td><div class="flex items-center gap-2"><div class="progress-bar" style="width:70px"><div class="progress-fill" style="width:${Math.min(100,p)}%;background:${col}"></div></div><span style="color:${col};font-size:11px;font-family:var(--mono)">${Math.round(p)}%</span></div></td><td class="${c.is_critical?'text-red':'text-green'}">${Math.round(c.shortage||0)}</td><td class="${c.shortage_cost>0?'text-red':''}">${fmt.penalty(c.shortage_cost)}</td><td>${c.is_critical?'<span class="badge badge-critical">Shortage</span>':'<span class="badge badge-ok">OK</span>'}</td></tr>`;}).join('')
  }</tbody></table></div></div></div></div>`;

  const allViol = [
    ...critCaps.map(c=>({title:`${c.restriction_name} — Week ${c.week}/${c.year}`,detail:`Capacity: ${c.capacity} available, ${Math.round(c.required_capacity||0)} required — ${Math.round(c.over_capacity||0)} over limit (${Math.round(c.utilization_pct||0)}% utilization)`,cost:c.violation_cost||0,tag:'cap'})),
    ...comps.filter(c=>c.is_critical).map(c=>({title:`${c.component_name} — Week ${c.week}/${c.year}`,detail:`Available: ${Math.round(c.available||0)}, Required: ${Math.round(c.required||0)}, Shortage: ${Math.round(c.shortage||0)} units`,cost:c.shortage_cost||0,tag:'comp'})),
    ...orders.filter(o=>o.delay_days>0).map(o=>({title:`Order ${o.order_number} — ${o.customer_name||''} (${o.priority})`,detail:`${o.product_name||''} · Promise: ${fmt.date(o.original_date)} → Optimized: ${fmt.date(o.optimized_date)} · Delay: +${o.delay_days} days`,cost:o.penalty_cost||0,tag:'late'}))
  ].sort((a,b)=>b.cost-a.cost);
  const totalCost = allViol.reduce((a,v)=>a+Number(v.cost||0),0);

  const constraintsTabHtml = `<div id="tab-constraints" style="display:none">${allViol.length===0
    ?`<div class="card"><div class="card-body" style="text-align:center;padding:40px"><div style="font-size:16px;font-weight:700;color:var(--green)">No Constraints Violated</div><div class="text-muted text-sm" style="margin-top:8px">All orders on-time within all capacity and component limits</div></div></div>`
    :`<div class="card"><div class="card-header"><div class="card-title">All Violations — ${allViol.length} issues · Total ${Math.round(totalCost).toLocaleString()}</div><div class="flex gap-2"><span class="import-chip warn">${critCaps.length} cap</span><span class="import-chip warn">${comps.filter(c=>c.is_critical).length} comp</span><span class="import-chip warn">${orders.filter(o=>o.delay_days>0).length} orders late</span></div></div><div class="card-body">${allViol.map(v=>`<div class="violation-item"><div><div class="vi-title">${v.title}</div><div class="vi-detail">${v.detail}</div></div><div class="vi-cost">${fmt.penalty(v.cost)}</div></div>`).join('')}</div></div>`
  }</div>`;

  document.getElementById('opt-results-content').innerHTML =
    runInfoHtml + metricsHtml + downloadHtml + tabsHtml + ordersTabHtml + capTabHtml + compTabHtml + constraintsTabHtml;
}

async function downloadOptimizationResults(runId, section) {
  try {
    toast('Preparing Excel report...', 'info');
    const run = await api('GET', `/optimization-runs/${runId}`);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Order Planning System';
    wb.created = new Date();

    const orders = run.order_results || [];
    const caps   = run.capacity_analysis || [];
    const comps  = run.component_analysis || [];

    const C = {
      headerBg : 'FF1F3864', headerFg : 'FFFFFFFF',
      rowNorm  : 'FFFFFFFF', rowAlt   : 'FFEBF3FB',
      redBg    : 'FFFFCCCC', redFg    : 'FF8B0000',
      greenBg  : 'FFD6F5E0', greenFg  : 'FF1A5C35',
      labelBg  : 'FFD6E4F0', titleBg  : 'FF2E4057',
      redHdrBg : 'FFC00000',
    };
    const thin = s => ({ style: 'thin', color: { argb: s || 'FFB0BEC5' } });
    const border = { top: thin(), left: thin(), bottom: thin(), right: thin() };

    function styleHeader(ws, numCols, redBg) {
      const row = ws.getRow(1);
      row.height = 22;
      row.eachCell({ includeEmpty: true }, cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: redBg ? C.redHdrBg : C.headerBg } };
        cell.font = { bold: true, color: { argb: C.headerFg }, size: 11, name: 'Calibri' };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        cell.border = border;
      });
      ws.views = [{ state: 'frozen', ySplit: 1 }];
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: numCols } };
    }

    function styleDataRow(row, idx, isRed, isGreen) {
      row.height = 18;
      const bg = isRed ? C.redBg : isGreen ? C.greenBg : idx % 2 === 0 ? C.rowNorm : C.rowAlt;
      row.eachCell({ includeEmpty: true }, cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
        cell.font = {
          color: { argb: isRed ? C.redFg : isGreen ? C.greenFg : 'FF000000' },
          size: 10, name: 'Calibri',
          bold: isRed
        };
        cell.border = border;
        cell.alignment = { vertical: 'middle' };
      });
    }

    if (section === 'orders' || section === 'all') {
      const rows = orders.map(o => ({
        order_number: o.order_number, customer: o.customer_name, product: o.product_name,
        priority: o.priority, original_date: o.original_date, optimized_date: o.optimized_date,
        week: fmt.week(o.optimized_date),
        delay_days: o.delay_days, penalty_cost: o.penalty_cost, status: o.status,
        feasible: o.feasible ? 'Yes' : 'No'
      }));
      if (rows.length) {
        const ws = wb.addWorksheet('OrderResults', { tabColor: { argb: 'FF1F3864' } });
        ws.columns = [
          { header: 'Order Number',   key: 'order_number',   width: 18 },
          { header: 'Customer',        key: 'customer',        width: 24 },
          { header: 'Product',         key: 'product',         width: 24 },
          { header: 'Priority',        key: 'priority',        width: 12 },
          { header: 'Original Date',   key: 'original_date',   width: 16 },
          { header: 'Optimized Date',  key: 'optimized_date',  width: 16 },
          { header: 'Week',            key: 'week',            width: 10 },
          { header: 'Delay (Days)',    key: 'delay_days',      width: 14 },
          { header: 'Penalty Cost',    key: 'penalty_cost',    width: 16 },
          { header: 'Status',          key: 'status',          width: 14 },
          { header: 'Feasible',        key: 'feasible',        width: 12 },
        ];
        styleHeader(ws, 11);
        rows.forEach((r, i) => {
          const row = ws.addRow(r);
          const isDelayed = Number(r.delay_days) > 0 || r.status === 'delayed';
          const isOnTime  = r.feasible === 'Yes' && !isDelayed;
          styleDataRow(row, i, isDelayed, isOnTime);
          row.getCell('delay_days').alignment   = { horizontal: 'right',  vertical: 'middle' };
          row.getCell('penalty_cost').alignment = { horizontal: 'right',  vertical: 'middle' };
          row.getCell('priority').alignment     = { horizontal: 'center', vertical: 'middle' };
          row.getCell('feasible').alignment     = { horizontal: 'center', vertical: 'middle' };
        });
      }
    }

    if (section === 'capacity' || section === 'all') {
      const rows = caps.map(c => ({
        restriction_name: c.restriction_name, restriction_code: c.restriction_code,
        year: c.year, week: c.week, capacity: c.capacity,
        required: Math.round(c.required_capacity || 0),
        utilization_pct: Number(c.utilization_pct || 0).toFixed(1),
        over_capacity: Math.round(c.over_capacity || 0),
        violation_cost: c.violation_cost || 0,
        is_violation: c.is_critical ? 'YES' : 'No'
      }));
      const capCols = [
        { header: 'Restriction Name',  key: 'restriction_name',  width: 26 },
        { header: 'Restriction Code',  key: 'restriction_code',  width: 18 },
        { header: 'Year',              key: 'year',              width: 10 },
        { header: 'Week',              key: 'week',              width: 10 },
        { header: 'Capacity',          key: 'capacity',          width: 14 },
        { header: 'Required',          key: 'required',          width: 14 },
        { header: 'Utilization %',     key: 'utilization_pct',   width: 16 },
        { header: 'Over Capacity',     key: 'over_capacity',     width: 16 },
        { header: 'Violation Cost',    key: 'violation_cost',    width: 16 },
        { header: 'Violation?',        key: 'is_violation',      width: 13 },
      ];
      const numAlignCap = ['year','week','capacity','required','utilization_pct','over_capacity','violation_cost'];
      if (rows.length) {
        const ws = wb.addWorksheet('CapacityAnalysis', { tabColor: { argb: 'FF0070C0' } });
        ws.columns = capCols;
        styleHeader(ws, 10);
        rows.forEach((r, i) => {
          const row = ws.addRow(r);
          styleDataRow(row, i, r.is_violation === 'YES', false);
          numAlignCap.forEach(k => { row.getCell(k).alignment = { horizontal: 'right', vertical: 'middle' }; });
          row.getCell('is_violation').alignment = { horizontal: 'center', vertical: 'middle' };
        });

        const viols = rows.filter(r => r.is_violation === 'YES');
        if (viols.length) {
          const ws2 = wb.addWorksheet('CapacityViolations', { tabColor: { argb: C.redHdrBg } });
          ws2.columns = capCols.map(c => ({ ...c }));
          styleHeader(ws2, 10, true);
          viols.forEach((r, i) => {
            const row = ws2.addRow(r);
            styleDataRow(row, i, true, false);
            numAlignCap.forEach(k => { row.getCell(k).alignment = { horizontal: 'right', vertical: 'middle' }; });
            row.getCell('is_violation').alignment = { horizontal: 'center', vertical: 'middle' };
          });
        }
      }
    }

    if (section === 'components' || section === 'all') {
      const rows = comps.map(c => ({
        component_name: c.component_name, component_code: c.component_code,
        year: c.year, week: c.week, available: Math.round(c.available || 0),
        required: Math.round(c.required || 0), shortage: Math.round(c.shortage || 0),
        shortage_cost: c.shortage_cost || 0, is_critical: c.is_critical ? 'YES' : 'No'
      }));
      const compCols = [
        { header: 'Component Name',  key: 'component_name',  width: 26 },
        { header: 'Component Code',  key: 'component_code',  width: 18 },
        { header: 'Year',            key: 'year',            width: 10 },
        { header: 'Week',            key: 'week',            width: 10 },
        { header: 'Available',       key: 'available',       width: 14 },
        { header: 'Required',        key: 'required',        width: 14 },
        { header: 'Shortage',        key: 'shortage',        width: 14 },
        { header: 'Shortage Cost',   key: 'shortage_cost',   width: 16 },
        { header: 'Critical?',       key: 'is_critical',     width: 12 },
      ];
      const numAlignComp = ['year','week','available','required','shortage','shortage_cost'];
      if (rows.length) {
        const ws = wb.addWorksheet('ComponentAnalysis', { tabColor: { argb: 'FF7030A0' } });
        ws.columns = compCols;
        styleHeader(ws, 9);
        rows.forEach((r, i) => {
          const row = ws.addRow(r);
          styleDataRow(row, i, r.is_critical === 'YES', false);
          numAlignComp.forEach(k => { row.getCell(k).alignment = { horizontal: 'right', vertical: 'middle' }; });
          row.getCell('is_critical').alignment = { horizontal: 'center', vertical: 'middle' };
        });

        const shorts = rows.filter(r => r.is_critical === 'YES');
        if (shorts.length) {
          const ws2 = wb.addWorksheet('ComponentShortages', { tabColor: { argb: C.redHdrBg } });
          ws2.columns = compCols.map(c => ({ ...c }));
          styleHeader(ws2, 9, true);
          shorts.forEach((r, i) => {
            const row = ws2.addRow(r);
            styleDataRow(row, i, true, false);
            numAlignComp.forEach(k => { row.getCell(k).alignment = { horizontal: 'right', vertical: 'middle' }; });
            row.getCell('is_critical').alignment = { horizontal: 'center', vertical: 'middle' };
          });
        }
      }
    }

    if (section === 'all') {
      const orderDetails = await Promise.all(
        orders.map(o => api('GET', `/sales-orders/${o.sales_order_id}`).catch(() => null))
      );
      const schedRows = [];
      orders.forEach((o, i) => {
        const det   = orderDetails[i] || {};
        const rests = (det.restrictions && det.restrictions.length) ? det.restrictions : [{}];
        const cdet  = (det.components  && det.components.length)  ? det.components  : [{}];
        const qty   = Number(o.quantity || det.quantity || 0);
        rests.forEach(r => {
          cdet.forEach(c => {
            schedRows.push({
              order_number:    o.order_number,
              product_name:    o.product_name || det.product_name || '',
              scheduled_date:  o.optimized_date,
              week:            fmt.week(o.optimized_date),
              restriction:     r.restriction_code ? `${r.restriction_name || ''} (${r.restriction_code})` : '',
              restriction_qty: r.capacity_usage_per_unit != null ? Number(r.capacity_usage_per_unit) * qty : '',
              component:       c.component_code ? `${c.component_name || ''} (${c.component_code})` : '',
              component_qty:   c.required_qty_per_unit != null ? Number(c.required_qty_per_unit) * qty : ''
            });
          });
        });
      });
      if (schedRows.length) {
        const ws = wb.addWorksheet('Weekly_Schedule', { tabColor: { argb: 'FF00B050' } });
        ws.columns = [
          { header: 'Order Number',    key: 'order_number',    width: 18 },
          { header: 'Product',         key: 'product_name',    width: 26 },
          { header: 'Scheduled Date',  key: 'scheduled_date',  width: 18 },
          { header: 'Week',            key: 'week',            width: 10 },
          { header: 'Restriction',     key: 'restriction',     width: 30 },
          { header: 'Restriction Qty', key: 'restriction_qty', width: 18 },
          { header: 'Component',       key: 'component',       width: 30 },
          { header: 'Component Qty',   key: 'component_qty',   width: 18 },
        ];
        styleHeader(ws, 8);
        schedRows.forEach((r, i) => {
          const row = ws.addRow(r);
          styleDataRow(row, i, false, false);
          ['restriction_qty', 'component_qty'].forEach(k => {
            row.getCell(k).alignment = { horizontal: 'right', vertical: 'middle' };
          });
        });
      }

      const wsSummary = wb.addWorksheet('Summary', { tabColor: { argb: C.headerBg } });
      wsSummary.columns = [{ key: 'label', width: 30 }, { key: 'value', width: 32 }];
      wsSummary.mergeCells('A1:B1');
      const titleCell = wsSummary.getCell('A1');
      titleCell.value = `Optimization Run #${run.run_number} — Summary`;
      titleCell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.titleBg } };
      titleCell.font  = { bold: true, size: 14, color: { argb: 'FFFFFFFF' }, name: 'Calibri' };
      titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
      wsSummary.getRow(1).height = 30;

      const summaryData = [
        ['Run Number',          run.run_number],
        ['Description',         run.description || '—'],
        ['Run Date',            run.run_date],
        ['Status',              run.status],
        ['Total Orders',        run.total_orders || 0],
        ['On-Time Orders',      run.on_time_orders || 0],
        ['Delayed Orders',      run.delayed_orders || 0],
        ['On-Time %',           Number(run.on_time_percentage || 0).toFixed(1) + '%'],
        ['Total Penalty Cost',  Number(run.total_penalty_cost || 0).toLocaleString()],
        ['Avg Delay (days)',     Number(run.avg_delay_days || 0).toFixed(1)],
        ['Max Delay (days)',     run.max_delay_days || 0],
        ['Capacity Violations', caps.filter(c => c.is_critical).length],
        ['Component Shortages', comps.filter(c => c.is_critical).length],
        ['Execution Time (ms)', run.execution_time_ms || 0],
      ];
      summaryData.forEach(([label, value], i) => {
        const row = wsSummary.addRow({ label, value });
        row.height = 20;
        const lCell = row.getCell('label');
        const vCell = row.getCell('value');
        lCell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.labelBg } };
        lCell.font      = { bold: true, size: 11, name: 'Calibri' };
        lCell.border    = border;
        lCell.alignment = { vertical: 'middle' };
        vCell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: i % 2 === 0 ? C.rowNorm : C.rowAlt } };
        vCell.font      = { size: 11, name: 'Calibri' };
        vCell.border    = border;
        vCell.alignment = { vertical: 'middle' };
      });
    }

    if (!wb.worksheets.length) { toast('No data available for this run', 'error'); return; }

    const fname  = `opt-results-${run.run_number}-${section}-${new Date().toISOString().split('T')[0]}.xlsx`;
    const buffer = await wb.xlsx.writeBuffer();
    const blob   = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url    = URL.createObjectURL(blob);
    const a      = document.createElement('a');
    a.href = url; a.download = fname;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
    toast(`Downloaded: ${fname}`, 'success');
  } catch(e) { toast('Download failed: ' + e.message, 'error'); }
}

function switchTab(tab) {
  ['orders','capacity','comps','constraints'].forEach(t => {
    const el = document.getElementById(`tab-${t}`);
    if (el) el.style.display = t === tab ? 'block' : 'none';
  });
  document.querySelectorAll('#result-tabs .tab').forEach((t,i) => {
    t.classList.toggle('active', ['orders','capacity','comps','constraints'][i] === tab);
  });
}

async function showOrderDetail(salesOrderId, optimizedDate) {
  document.getElementById('order-detail-title').textContent = 'Loading…';
  document.getElementById('order-detail-body').innerHTML =
    '<div style="text-align:center;padding:40px"><div class="spinner" style="width:28px;height:28px;margin:auto"></div></div>';
  openModal('modal-order-detail');
  try {
    const o = await api('GET', `/sales-orders/${salesOrderId}`);
    document.getElementById('order-detail-title').textContent = `Execution Plan — Order ${o.order_number}`;

    const qty = Number(o.quantity) || 0;
    const isNoFulfillment = !optimizedDate;
    const dateLabel = isNoFulfillment ? '—' : fmt.date(optimizedDate);
    const promiseLabel = fmt.date(o.promise_date);
    const isDelayed = !isNoFulfillment && optimizedDate && o.promise_date && optimizedDate > o.promise_date;

    const summaryHtml = `
      <div style="display:flex;flex-wrap:wrap;gap:10px;padding:14px 16px;background:var(--bg3);border-radius:8px;margin-bottom:18px;border:1px solid var(--border)">
        <div style="flex:1;min-width:130px"><div class="text-xs text-muted" style="margin-bottom:3px">CUSTOMER</div><div style="font-weight:600;font-size:13px">${o.customer_name||'—'}</div></div>
        <div style="flex:1;min-width:130px"><div class="text-xs text-muted" style="margin-bottom:3px">PRODUCT</div><div style="font-weight:600;font-size:13px">${o.product_name||'—'}</div></div>
        <div style="flex:1;min-width:80px"><div class="text-xs text-muted" style="margin-bottom:3px">PRIORITY</div><div>${fmt.priorityBadge(o.priority)}</div></div>
        <div style="flex:1;min-width:80px"><div class="text-xs text-muted" style="margin-bottom:3px">QUANTITY</div><div class="mono" style="font-size:13px">${qty}</div></div>
        <div style="flex:1;min-width:140px"><div class="text-xs text-muted" style="margin-bottom:3px">PROMISE DATE</div><div class="mono" style="font-size:13px">${promiseLabel}</div></div>
      </div>`;

    const dateBannerHtml = isNoFulfillment
      ? `<div style="display:flex;align-items:center;gap:12px;padding:12px 16px;
                  background:rgba(239,68,68,0.08);border:1px solid var(--red);
                  border-radius:8px;margin-bottom:18px">
          <div>
            <div class="text-xs text-muted" style="margin-bottom:2px">SCHEDULED PROCESSING DATE</div>
            <div style="font-size:18px;font-weight:700;font-family:var(--mono);color:var(--red)">
              Not Scheduled
              <span style="font-size:11px;font-weight:400;margin-left:8px">No restriction or component allocated — order cannot be fulfilled</span>
            </div>
          </div>
        </div>`
      : `<div style="display:flex;align-items:center;gap:12px;padding:12px 16px;
                  background:${isDelayed ? 'rgba(255,200,0,0.08)' : 'rgba(30,200,126,0.08)'};
                  border:1px solid ${isDelayed ? 'var(--yellow)' : 'var(--green)'};
                  border-radius:8px;margin-bottom:18px">
          <div>
            <div class="text-xs text-muted" style="margin-bottom:2px">SCHEDULED PROCESSING DATE</div>
            <div style="font-size:18px;font-weight:700;font-family:var(--mono);color:${isDelayed ? 'var(--yellow)' : 'var(--green)'}">
              ${dateLabel}
              ${isDelayed ? '<span style="font-size:11px;font-weight:400;margin-left:8px;color:var(--yellow)">Delayed from promise date</span>' : '<span style="font-size:11px;font-weight:400;margin-left:8px;color:var(--green)">On time</span>'}
            </div>
          </div>
        </div>`;

    const restrictionsHtml = (o.restrictions && o.restrictions.length)
      ? `<div class="table-wrap"><table style="width:100%">
          <thead><tr>
            <th>Restriction (Machine / Resource)</th>
            <th>Code</th>
            <th style="text-align:right">Cap. / Unit</th>
            <th style="text-align:right">Total Capacity Used</th>
            <th>Processing Date</th>
          </tr></thead>
          <tbody>${o.restrictions.map(r => {
            const perUnit = Number(r.capacity_usage_per_unit) || 0;
            const total   = perUnit * qty;
            return `<tr>
              <td style="font-weight:600">${r.restriction_name}</td>
              <td class="mono text-xs text-muted">${r.restriction_code}</td>
              <td class="mono" style="text-align:right">${perUnit}</td>
              <td class="mono text-accent" style="text-align:right;font-weight:600">${total.toLocaleString()}</td>
              <td class="mono" style="color:${isNoFulfillment?'var(--red)':isDelayed?'var(--yellow)':'var(--green)'}">${dateLabel}</td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>`
      : '<p class="text-muted text-sm" style="margin:0">No restrictions linked to this order.</p>';

    const componentsHtml = (o.components && o.components.length)
      ? `<div class="table-wrap"><table style="width:100%">
          <thead><tr>
            <th>Component (Raw Material)</th>
            <th>Code</th>
            <th style="text-align:right">Qty / Unit</th>
            <th style="text-align:right">Total Qty Consumed</th>
            <th style="text-align:right">Material Cost</th>
            <th>Consumption Date</th>
          </tr></thead>
          <tbody>${o.components.map(c => {
            const perUnit   = Number(c.required_qty_per_unit) || 0;
            const totalQty  = perUnit * qty;
            const unitCost  = Number(c.unit_cost) || 0;
            const totalCost = unitCost * totalQty;
            return `<tr>
              <td style="font-weight:600">${c.component_name}</td>
              <td class="mono text-xs text-muted">${c.component_code}</td>
              <td class="mono" style="text-align:right">${perUnit}</td>
              <td class="mono text-accent" style="text-align:right;font-weight:600">${totalQty.toLocaleString()}</td>
              <td class="mono" style="text-align:right">${unitCost > 0 ? fmt.currency(totalCost) : '—'}</td>
              <td class="mono" style="color:${isNoFulfillment?'var(--red)':isDelayed?'var(--yellow)':'var(--green)'}">${dateLabel}</td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>`
      : '<p class="text-muted text-sm" style="margin:0">No components linked to this order.</p>';

    document.getElementById('order-detail-body').innerHTML = `
      ${summaryHtml}
      ${dateBannerHtml}
      <div style="margin-bottom:18px">
        <div style="font-weight:700;font-size:12px;letter-spacing:.06em;color:var(--text3);margin-bottom:10px">RESTRICTIONS EXECUTED ON THIS DATE</div>
        ${restrictionsHtml}
      </div>
      <div>
        <div style="font-weight:700;font-size:12px;letter-spacing:.06em;color:var(--text3);margin-bottom:10px">COMPONENTS CONSUMED ON THIS DATE</div>
        ${componentsHtml}
      </div>`;
  } catch(e) {
    document.getElementById('order-detail-body').innerHTML =
      `<div class="text-red text-sm">Failed to load order details: ${e.message}</div>`;
  }
}

async function viewRunDetail(id) {
  navigate('optimize');
  document.getElementById('opt-results-section').style.display = 'none';
  document.getElementById('opt-progress').innerHTML = `<div style="text-align:center;padding:40px"><div class="spinner" style="width:32px;height:32px;margin:auto;margin-bottom:16px"></div><div class="text-sm text-muted">Loading run details...</div></div>`;
  try {
    const run = await api('GET', `/optimization-runs/${id}`);
    const result = {
      summary: {
        total_orders: run.total_orders, on_time_orders: run.on_time_orders,
        delayed_orders: run.delayed_orders, total_penalty_cost: run.total_penalty_cost,
        on_time_percentage: run.on_time_percentage,
        avg_delay_days: run.avg_delay_days ? Number(run.avg_delay_days).toFixed(1) : '0',
        max_delay_days: run.max_delay_days || 0, execution_time_ms: run.execution_time_ms
      },
      run,
      order_results: run.order_results || [],
      capacity_analysis: run.capacity_analysis || [],
      component_analysis: run.component_analysis || []
    };
    document.getElementById('opt-progress').innerHTML = `
      <div style="background:#EBF4FE;border:1px solid #B3D4FC;border-radius:8px;padding:14px;text-align:center">
        <div style="font-size:14px;font-weight:700;color:var(--accent)">Viewing: ${run.run_number}</div>
        <div class="text-sm text-muted" style="margin-top:4px">${run.description||''} · ${new Date(run.run_date).toLocaleString()}</div>
      </div>`;
    document.getElementById('opt-fitness-card').style.display = 'none';
    document.getElementById('opt-fitness-chart').innerHTML = '';
    document.getElementById('opt-fitness-gen-label').textContent = '';
    await fetchAndRenderFitnessChart(run.id);
    renderOptimizationResults(result);
    document.getElementById('opt-results-section').style.display = 'block';
    toast(`Loaded run ${run.run_number}`, 'info');
  } catch(e) {
    document.getElementById('opt-progress').innerHTML = `<div class="text-red" style="padding:20px">${e.message}</div>`;
    toast(e.message, 'error');
  }
}
