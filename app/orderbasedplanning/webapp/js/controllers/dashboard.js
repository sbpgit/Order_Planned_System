// ===== Dashboard =====
let _dashCapacity = [];
let _dashComponents = [];

function renderDashCapacity(filter) {
  const q = filter.trim().toLowerCase();
  const all = [..._dashCapacity].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const rows = q ? all.filter(c => (c.name||'').toLowerCase().includes(q) || (c.restriction_code||'').toLowerCase().includes(q)) : all;
  document.getElementById('dash-capacity-count').textContent = q ? `${rows.length}/${_dashCapacity.length}` : _dashCapacity.length;
  if (!rows.length) {
    document.getElementById('dash-capacity').innerHTML = '<div class="text-muted text-sm">No matching restrictions</div>';
    return;
  }
  document.getElementById('dash-capacity').innerHTML = rows.map((c, i) => `
    <div style="padding:10px 0;${i < rows.length - 1 ? 'border-bottom:1px solid var(--border);' : ''}">
      <div class="flex justify-between" style="margin-bottom:4px">
        <span style="font-size:13px">${c.name}</span>
        <span class="mono text-xs text-muted">${c.restriction_code}</span>
      </div>
      <div style="font-size:12px;color:var(--text3)">Avg capacity: ${Math.round(c.avg_capacity||0)} units/week · ${c.week_count} weeks planned</div>
    </div>
  `).join('');
}
function filterDashCapacity(val) { renderDashCapacity(val); }

function renderDashComponents(filter) {
  const q = filter.trim().toLowerCase();
  const riskOrder = { High: 0, Medium: 1, Low: 2 };
  const all = [..._dashComponents].sort((a, b) => (riskOrder[a.shortage_risk] ?? 3) - (riskOrder[b.shortage_risk] ?? 3));
  const rows = q ? all.filter(c => (c.name||'').toLowerCase().includes(q) || (c.component_code||'').toLowerCase().includes(q)) : all;
  document.getElementById('dash-components-count').textContent = q ? `${rows.length}/${_dashComponents.length}` : _dashComponents.length;

  if (!rows.length) {
    document.getElementById('dash-components').innerHTML = '<div class="text-muted text-sm" style="padding:16px 0">No matching components</div>';
    return;
  }

  document.getElementById('dash-components').innerHTML = rows.map(c => {
    const risk = c.shortage_risk || 'Low';
    const cls = risk === 'High' ? 'critical' : risk === 'Medium' ? 'warning' : 'ok';
    const dotColor = risk === 'High' ? 'var(--red)' : risk === 'Medium' ? 'var(--yellow)' : 'var(--green)';
    const avail = fmt.num(c.total_available);
    return `<div class="comp-item">
      <div style="width:8px;height:8px;border-radius:50%;background:${dotColor};flex-shrink:0;margin-top:3px"></div>
      <div class="comp-info">
        <div class="comp-name">${c.name}</div>
        <div class="comp-code">${c.component_code}</div>
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div style="font-size:12px;font-weight:600;color:var(--text);font-family:var(--mono)">${avail}</div>
        <span class="badge badge-${cls}" style="font-size:10px">${risk} risk</span>
      </div>
    </div>`;
  }).join('');
}
function filterDashComponents(val) { renderDashComponents(val); }

Pages.dashboard = async () => {
  try {
    const d = await api('GET', locPath('/dashboard'));
    document.getElementById('kpi-orders').textContent = d.total_orders;
    document.getElementById('kpi-orders-sub').textContent = `${d.confirmed_orders} confirmed`;
    document.getElementById('kpi-open').textContent = d.open_orders;
    document.getElementById('kpi-overdue').textContent = `${d.overdue_orders} overdue`;
    document.getElementById('kpi-products').textContent = d.total_products;
    document.getElementById('kpi-customers').textContent = `${d.total_customers} customers`;
    const lr = d.last_run;
    document.getElementById('kpi-lastrun').textContent = lr ? lr.run_number : 'None';
    document.getElementById('kpi-lastrun-sub').textContent = lr ? `${lr.status} · ${fmt.pct(lr.on_time_percentage)} on-time` : 'No runs yet';

    _dashCapacity = d.capacity_status || [];
    _dashComponents = d.component_status || [];
    const capSearch = document.getElementById('dash-cap-search');
    const compSearch = document.getElementById('dash-comp-search');
    if (capSearch) capSearch.value = '';
    if (compSearch) compSearch.value = '';
    renderDashCapacity('');
    renderDashComponents('');
  } catch (e) { toast(e.message, 'error'); }
};
