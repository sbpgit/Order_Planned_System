// ===== Components =====
const _availWindow = {};

function renderAvailBucketHtml(c) {
  const avails = (c.availability || []).slice().sort((a,b) => (a.year*100+a.week) - (b.year*100+b.week));
  if (!avails.length) {
    return `<div class="text-xs text-muted" style="margin-bottom:8px">AVAILABILITY BUCKETS</div>
            <span class="text-muted text-sm">No availability records</span>`;
  }
  if (_availWindow[c.id] === undefined) _availWindow[c.id] = initialWeekOffset(avails);
  const maxOffset = Math.max(0, avails.length - WEEK_WINDOW);
  let offset = Math.max(0, Math.min(_availWindow[c.id], maxOffset));
  _availWindow[c.id] = offset;
  const slice = avails.slice(offset, offset + WEEK_WINDOW);
  const cur = isoWeekYear(new Date());
  const chips = slice.map(a => {
    const isZero = Number(a.available_qty) <= 0;
    const isCurrent = a.week === cur.week && a.year === cur.year;
    const ring = isCurrent ? 'box-shadow:0 0 0 2px var(--accent);' : '';
    return `<span style="background:${isZero ? 'rgba(255,59,48,0.15)' : 'var(--bg4)'};padding:3px 8px;border-radius:4px;font-size:11px;font-family:var(--mono);${isZero ? 'color:var(--red);font-weight:600;border:1px solid var(--red)' : ''}${ring}">
      W${a.week}/${a.year}: ${a.available_qty}
    </span>`;
  }).join('');
  const first = slice[0], last = slice[slice.length-1];
  const rangeTxt = `W${first.week}/${first.year} – W${last.week}/${last.year}`;
  const countTxt = `${offset+1}-${offset+slice.length} of ${avails.length}`;
  const prevDis = offset <= 0 ? 'disabled' : '';
  const nextDis = offset + WEEK_WINDOW >= avails.length ? 'disabled' : '';
  return `
    <div class="flex items-center gap-3" style="margin-bottom:8px">
      <div class="text-xs text-muted">AVAILABILITY BUCKETS — ${rangeTxt} <span style="opacity:0.7">(${countTxt})</span></div>
      <div style="margin-left:auto" class="flex gap-1">
        <button class="btn btn-secondary btn-sm" ${prevDis} onclick="shiftAvailWindow('${c.id}', -1)">‹</button>
        <button class="btn btn-secondary btn-sm" ${nextDis} onclick="shiftAvailWindow('${c.id}', 1)">›</button>
      </div>
    </div>
    <div class="flex gap-2" style="flex-wrap:wrap">${chips}</div>`;
}

function shiftAvailWindow(componentId, dir) {
  const c = (_components || []).find(x => x.id === componentId);
  if (!c) return;
  _availWindow[componentId] = (_availWindow[componentId] || 0) + dir * WEEK_WINDOW;
  const el = document.getElementById(`avail-bucket-${componentId}`);
  if (el) el.innerHTML = renderAvailBucketHtml(c);
}

function renderComponentsList(filter) {
  const q = (filter || '').trim().toLowerCase();
  const container = document.getElementById('components-list');
  const countEl = document.getElementById('components-count');
  if (!_components.length) { container.innerHTML = '<div class="empty-state"><div>No components yet</div></div>'; return; }
  const rows = q ? _components.filter(c => (c.name||'').toLowerCase().includes(q) || (c.component_code||'').toLowerCase().includes(q) || (c.supplier||'').toLowerCase().includes(q)) : _components;
  if (countEl) countEl.textContent = q ? `${rows.length}/${_components.length}` : _components.length;
  if (!rows.length) { container.innerHTML = '<div class="empty-state"><div>No matching components</div></div>'; return; }
  container.innerHTML = rows.map(c => {
    const avails = c.availability || [];
    const totalAvail = avails.reduce((s,a) => s+Number(a.available_qty), 0);
    const risk = totalAvail < c.min_stock * 4 ? 'High' : totalAvail < c.min_stock * 8 ? 'Medium' : 'Low';
    const riskCls = risk === 'High' ? 'critical' : risk === 'Medium' ? 'warning' : 'ok';
    return `
    <div class="card mb-4">
      <div class="card-header">
        <div class="flex items-center gap-3">
          <span class="mono text-accent">${c.component_code}</span>
          <span class="primary" style="font-weight:600">${c.name}</span>
          <span class="badge badge-${riskCls}">${risk} Risk</span>
        </div>
        <div class="flex gap-2">
          <span class="badge badge-ok" style="font-size:12px;padding:4px 10px">Availability (${avails.length})</span>
          <button class="btn btn-secondary btn-sm" onclick="editComponent('${c.id}')" style="display:none">Edit</button>
          <button class="btn btn-danger btn-sm" onclick="deleteComponent('${c.id}')" style="display:none">Delete</button>
        </div>
      </div>
      <div class="card-body">
        <div class="flex gap-4 mb-4" style="flex-wrap:wrap">
          <div><div class="text-xs text-muted">Supplier</div><div class="text-sm">${c.supplier || '—'}</div></div>
          <div><div class="text-xs text-muted">Unit Cost</div><div style="font-weight:600">${fmt.currency(c.unit_cost)}</div></div>
          <div><div class="text-xs text-muted">Lead Time</div><div class="text-sm">${c.lead_time_days || 0}d</div></div>
          <div><div class="text-xs text-muted">Min Stock</div><div class="text-sm">${c.min_stock || 0}</div></div>
          <div><div class="text-xs text-muted">Total Available</div><div style="color:${totalAvail <= 0 ? 'var(--red)' : 'var(--green)'};font-weight:600">${fmt.num(totalAvail)}</div></div>
        </div>
        <div id="avail-bucket-${c.id}">${renderAvailBucketHtml(c)}</div>
      </div>
    </div>`;
  }).join('');
}
function filterComponents(val) { renderComponentsList(val); }

Pages.components = async () => {
  try {
    _components = await api('GET', locPath('/components'));
    const searchEl = document.getElementById('components-search');
    renderComponentsList(searchEl ? searchEl.value : '');
  } catch(e) { toast(e.message,'error'); }
};

async function saveComponent() {
  try {
    const id = document.getElementById('comp-id').value;
    const data = {
      component_code: document.getElementById('comp-code').value,
      name: document.getElementById('comp-name').value,
      description: document.getElementById('comp-desc').value,
      supplier: document.getElementById('comp-supplier').value,
      unit_cost: parseFloat(document.getElementById('comp-cost').value)||0,
      lead_time_days: parseInt(document.getElementById('comp-lead').value)||0,
      min_stock: parseInt(document.getElementById('comp-min').value)||0,
      is_active: 1
    };
    if (id) { await api('PUT', `/components/${id}`, data); toast('Updated','success'); }
    else { await api('POST', '/components', data); toast('Created','success'); }
    closeModal('modal-component');
    Pages.components();
  } catch(e) { toast(e.message,'error'); }
}
function editComponent(id) {
  const c = _components.find(x => x.id === id);
  if (!c) return;
  document.getElementById('comp-id').value = c.id;
  document.getElementById('comp-code').value = c.component_code;
  document.getElementById('comp-name').value = c.name;
  document.getElementById('comp-desc').value = c.description||'';
  document.getElementById('comp-supplier').value = c.supplier||'';
  document.getElementById('comp-cost').value = c.unit_cost||'';
  document.getElementById('comp-lead').value = c.lead_time_days||'';
  document.getElementById('comp-min').value = c.min_stock||'';
  openModal('modal-component');
}
async function deleteComponent(id) {
  if (!confirm('Delete this component?')) return;
  try { await api('DELETE', `/components/${id}`); toast('Deleted','success'); Pages.components(); }
  catch(e) { toast(e.message,'error'); }
}

// ===== Component Weekly Availability Management =====
let _currentComponentId = null;
let _currentComponentName = '';
let _availabilityExcelData = [];

function openComponentAvailability(id, name) {
  _currentComponentId = id;
  _currentComponentName = name;
  document.getElementById('ca-title').textContent = name + ' — Weekly Availability';
  document.getElementById('ca-sub').textContent = 'Manage availability buckets for this component';
  const now = new Date();
  document.getElementById('cab-year').value = now.getFullYear();
  document.getElementById('cab-week').value = isoWeek(now);
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-component-availability').classList.add('active');
  document.getElementById('topbar-title').textContent = name + ' — Availability';
  loadAvailabilityTable();
}

async function loadAvailabilityTable() {
  const tbody = document.getElementById('ca-tbody');
  try {
    const rows = await api('GET', `/components/${_currentComponentId}/availability`);
    document.getElementById('ca-count').textContent = rows.length + ' weeks';
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text3);padding:16px">No availability records yet</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(r => {
      const net = (parseFloat(r.available_qty) || 0) - (parseFloat(r.reserved_qty) || 0);
      const netCls = net < 0 ? 'color:var(--red)' : net < 10 ? 'color:var(--yellow)' : 'color:var(--green)';
      const isZeroAvail = Number(r.available_qty) <= 0;
      const rowStyle = isZeroAvail ? 'background:rgba(255,59,48,0.1);' : '';
      const availStyle = isZeroAvail ? 'color:var(--red);font-weight:600' : '';
      return `<tr style="${rowStyle}">
        <td class="mono">${r.year}</td>
        <td class="mono">W${String(r.week).padStart(2,'0')}</td>
        <td class="mono" style="${availStyle}">${r.available_qty}</td>
        <td class="mono">${r.reserved_qty || 0}</td>
        <td class="mono" style="${netCls}">${net}</td>
        <td>
          <button class="btn btn-secondary btn-sm" onclick="editAvailRow('${r.id}',${r.year},${r.week},${r.available_qty},${r.reserved_qty||0})">Edit</button>
        </td>
      </tr>`;
    }).join('');
  } catch(e) { toast(e.message, 'error'); }
}

async function bulkGenerateAvailability() {
  const y = parseInt(document.getElementById('cab-year').value);
  const w = parseInt(document.getElementById('cab-week').value);
  const n = parseInt(document.getElementById('cab-num').value);
  const a = parseFloat(document.getElementById('cab-avail').value);
  const rv = parseFloat(document.getElementById('cab-reserved').value) || 0;
  if (!y || !w || !n || isNaN(a)) { toast('Fill in all bulk fields','error'); return; }
  let ok = 0;
  let cy = y, cw = w;
  for (let i = 0; i < n; i++) {
    try {
      await api('POST', `/components/${_currentComponentId}/availability`,
        { year: cy, week: cw, available_qty: a, reserved_qty: rv });
      ok++;
    } catch(e) {}
    cw++;
    if (cw > 52) { cw = 1; cy++; }
  }
  toast(`Generated ${ok} weeks`, 'success');
  loadAvailabilityTable();
}

async function editAvailRow(id, year, week, available_qty, reserved_qty) {
  document.getElementById('aaw-year').value = year;
  document.getElementById('aaw-week').value = week;
  document.getElementById('aaw-avail').value = available_qty;
  document.getElementById('aaw-reserved').value = reserved_qty;
  document.getElementById('modal-add-availability').dataset.editId = id;
  openModal('modal-add-availability');
}

async function saveAvailabilityWeek() {
  const year = parseInt(document.getElementById('aaw-year').value);
  const week = parseInt(document.getElementById('aaw-week').value);
  const available_qty = parseFloat(document.getElementById('aaw-avail').value);
  const reserved_qty = parseFloat(document.getElementById('aaw-reserved').value) || 0;
  if (!year || !week || isNaN(available_qty)) { toast('Fill in all fields','error'); return; }
  try {
    await api('POST', `/components/${_currentComponentId}/availability`,
      { year, week, available_qty, reserved_qty });
    closeModal('modal-add-availability');
    document.getElementById('modal-add-availability').dataset.editId = '';
    toast('Availability week saved', 'success');
    loadAvailabilityTable();
  } catch(e) { toast(e.message, 'error'); }
}

function handleAvailabilityDrop(event) {
  event.preventDefault();
  document.getElementById('ca-dropzone').classList.remove('drag-over');
  const file = event.dataTransfer.files[0];
  if (file) parseAvailabilityExcel(file);
}
function handleAvailabilityFileSelect(event) {
  const file = event.target.files[0];
  if (file) parseAvailabilityExcel(file);
}
function parseAvailabilityExcel(file) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const wb = XLSX.read(e.target.result, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
      _availabilityExcelData = rows.map(r => ({
        year: parseInt(r.year || r.Year || r.YEAR),
        week: parseInt(r.week || r.Week || r.WEEK),
        available_qty: parseFloat(r.available_qty || r['Available Qty'] || r.AVAILABLE_QTY || 0),
        reserved_qty:  parseFloat(r.reserved_qty  || r['Reserved Qty']  || r.RESERVED_QTY  || 0)
      })).filter(r => r.year && r.week && !isNaN(r.available_qty));
      document.getElementById('ca-preview-info').textContent =
        `${_availabilityExcelData.length} valid rows found in "${wb.SheetNames[0]}"`;
      document.getElementById('ca-preview-tbody').innerHTML =
        _availabilityExcelData.slice(0, 10).map(r =>
          `<tr><td>${r.year}</td><td>W${String(r.week).padStart(2,'0')}</td><td>${r.available_qty}</td><td>${r.reserved_qty}</td></tr>`
        ).join('') + (_availabilityExcelData.length > 10 ? `<tr><td colspan="4" style="color:var(--text3)">… and ${_availabilityExcelData.length - 10} more</td></tr>` : '');
      document.getElementById('ca-preview').style.display = 'block';
    } catch(ex) { toast('Failed to parse Excel: ' + ex.message, 'error'); }
  };
  reader.readAsArrayBuffer(file);
}
async function uploadAvailabilityFromExcel() {
  if (!_availabilityExcelData.length) { toast('No data to upload','error'); return; }
  let ok = 0, fail = 0;
  for (const row of _availabilityExcelData) {
    try {
      await api('POST', `/components/${_currentComponentId}/availability`, row);
      ok++;
    } catch(e) { fail++; }
  }
  toast(`Uploaded: ${ok} rows${fail ? ', ' + fail + ' failed' : ''}`, ok ? 'success' : 'error');
  document.getElementById('ca-preview').style.display = 'none';
  _availabilityExcelData = [];
  document.getElementById('ca-file-input').value = '';
  loadAvailabilityTable();
}
