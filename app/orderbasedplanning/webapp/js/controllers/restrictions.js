// ===== Restrictions =====
const _capWindow = {};
const WEEK_WINDOW = 10;

function initialWeekOffset(sortedRows) {
  if (!sortedRows.length) return 0;
  const { week, year } = isoWeekYear(new Date());
  const curKey = year * 100 + week;
  const idx = sortedRows.findIndex(x => (x.year * 100 + x.week) >= curKey);
  return idx >= 0 ? idx : Math.max(0, sortedRows.length - WEEK_WINDOW);
}

function renderCapBucketHtml(r) {
  const caps = (r.weekly_capacities || []).slice().sort((a,b) => (a.year*100+a.week) - (b.year*100+b.week));
  if (!caps.length) {
    return `<div class="text-xs text-muted" style="margin-bottom:8px">CAPACITY BUCKETS</div>
            <span class="text-muted text-sm">No capacity records</span>`;
  }
  if (_capWindow[r.id] === undefined) _capWindow[r.id] = initialWeekOffset(caps);
  const maxOffset = Math.max(0, caps.length - WEEK_WINDOW);
  let offset = Math.max(0, Math.min(_capWindow[r.id], maxOffset));
  _capWindow[r.id] = offset;
  const slice = caps.slice(offset, offset + WEEK_WINDOW);
  const cur = isoWeekYear(new Date());
  const chips = slice.map(c => {
    const isZero = Number(c.capacity) <= 0;
    const isCurrent = c.week === cur.week && c.year === cur.year;
    const ring = isCurrent ? 'box-shadow:0 0 0 2px var(--accent);' : '';
    return `<span style="background:${isZero ? 'rgba(255,59,48,0.15)' : 'var(--bg4)'};padding:3px 8px;border-radius:4px;font-size:11px;font-family:var(--mono);${isZero ? 'color:var(--red);font-weight:600;border:1px solid var(--red)' : ''}${ring}">
      W${c.week}/${c.year}: ${c.capacity}
    </span>`;
  }).join('');
  const first = slice[0], last = slice[slice.length-1];
  const rangeTxt = `W${first.week}/${first.year} – W${last.week}/${last.year}`;
  const countTxt = `${offset+1}-${offset+slice.length} of ${caps.length}`;
  const prevDis = offset <= 0 ? 'disabled' : '';
  const nextDis = offset + WEEK_WINDOW >= caps.length ? 'disabled' : '';
  return `
    <div class="flex items-center gap-3" style="margin-bottom:8px">
      <div class="text-xs text-muted">CAPACITY BUCKETS — ${rangeTxt} <span style="opacity:0.7">(${countTxt})</span></div>
      <div style="margin-left:auto" class="flex gap-1">
        <button class="btn btn-secondary btn-sm" ${prevDis} onclick="shiftCapWindow('${r.id}', -1)">‹</button>
        <button class="btn btn-secondary btn-sm" ${nextDis} onclick="shiftCapWindow('${r.id}', 1)">›</button>
      </div>
    </div>
    <div class="flex gap-2" style="flex-wrap:wrap">${chips}</div>`;
}

function shiftCapWindow(restrictionId, dir) {
  const r = (_restrictions || []).find(x => x.id === restrictionId);
  if (!r) return;
  _capWindow[restrictionId] = (_capWindow[restrictionId] || 0) + dir * WEEK_WINDOW;
  const el = document.getElementById(`cap-bucket-${restrictionId}`);
  if (el) el.innerHTML = renderCapBucketHtml(r);
}

function renderRestrictionsList(filter) {
  const q = (filter || '').trim().toLowerCase();
  const container = document.getElementById('restrictions-list');
  const countEl = document.getElementById('restrictions-count');
  if (!_restrictions.length) { container.innerHTML = '<div class="empty-state"><div>No restrictions yet</div></div>'; return; }
  const rows = q ? _restrictions.filter(r => (r.name||'').toLowerCase().includes(q) || (r.restriction_code||'').toLowerCase().includes(q) || (r.resource_type||'').toLowerCase().includes(q)) : _restrictions;
  if (countEl) countEl.textContent = q ? `${rows.length}/${_restrictions.length}` : _restrictions.length;
  if (!rows.length) { container.innerHTML = '<div class="empty-state"><div>No matching restrictions</div></div>'; return; }
  container.innerHTML = rows.map(r => {
    const caps = r.weekly_capacities || [];
    return `
    <div class="card mb-4">
      <div class="card-header">
        <div class="flex items-center gap-3">
          <span class="mono text-accent">${r.restriction_code}</span>
          <span class="primary" style="font-weight:600">${r.name}</span>
          <span class="text-muted text-sm">${r.resource_type || ''}</span>
        </div>
        <div class="flex gap-2">
          <span class="badge badge-ok" style="font-size:12px;padding:4px 10px">Capacities (${caps.length})</span>
          <button class="btn btn-secondary btn-sm" onclick="editRestriction('${r.id}')" style="display:none">Edit</button>
          <button class="btn btn-danger btn-sm" onclick="deleteRestriction('${r.id}')" style="display:none">Delete</button>
        </div>
      </div>
      <div class="card-body">
        <div class="flex gap-4 mb-4" style="flex-wrap:wrap">
          <div><div class="text-xs text-muted">Penalty / Unit</div><div style="color:var(--red);font-weight:600">${fmt.num(r.penalty_cost_per_unit)}</div></div>
          <div><div class="text-xs text-muted">Valid From</div><div class="text-sm">${r.valid_from || '—'}</div></div>
          <div><div class="text-xs text-muted">Valid To</div><div class="text-sm">${r.valid_to || '—'}</div></div>
          <div><div class="text-xs text-muted">Weekly Buckets</div><div class="text-sm">${caps.length}</div></div>
        </div>
        <div id="cap-bucket-${r.id}">${renderCapBucketHtml(r)}</div>
      </div>
    </div>`;
  }).join('');
}
function filterRestrictions(val) { renderRestrictionsList(val); }

Pages.restrictions = async () => {
  try {
    _restrictions = await api('GET', locPath('/restrictions'));
    const searchEl = document.getElementById('restrictions-search');
    renderRestrictionsList(searchEl ? searchEl.value : '');
  } catch(e) { toast(e.message,'error'); }
};

async function saveRestriction() {
  try {
    const id = document.getElementById('rest-id').value;
    const data = {
      restriction_code: document.getElementById('rest-code').value,
      name: document.getElementById('rest-name').value,
      description: document.getElementById('rest-desc').value,
      resource_type: document.getElementById('rest-type').value,
      penalty_cost_per_unit: parseFloat(document.getElementById('rest-penalty').value)||100,
      valid_from: document.getElementById('rest-from').value,
      valid_to: document.getElementById('rest-to').value,
      is_active: 1
    };
    let restId = id;
    if (id) { await api('PUT', `/restrictions/${id}`, data); toast('Updated','success'); }
    else { const r = await api('POST', '/restrictions', data); restId = r.id; toast('Created','success'); }

    const capYear = parseInt(document.getElementById('cap-year').value);
    const capWeek = parseInt(document.getElementById('cap-week').value);
    const capNum = parseInt(document.getElementById('cap-num').value);
    const capQty = parseFloat(document.getElementById('cap-qty').value);
    if (capYear && capWeek && capNum && capQty && restId) {
      await api('POST', `/restrictions/${restId}/bulk-capacities`, {
        start_year: capYear, start_week: capWeek, num_weeks: capNum, capacity: capQty
      });
    }
    closeModal('modal-restriction');
    Pages.restrictions();
  } catch(e) { toast(e.message,'error'); }
}
function editRestriction(id) {
  const r = _restrictions.find(x => x.id === id);
  if (!r) return;
  document.getElementById('rest-id').value = r.id;
  document.getElementById('rest-code').value = r.restriction_code;
  document.getElementById('rest-name').value = r.name;
  document.getElementById('rest-desc').value = r.description||'';
  document.getElementById('rest-type').value = r.resource_type||'';
  document.getElementById('rest-penalty').value = r.penalty_cost_per_unit||'';
  document.getElementById('rest-from').value = r.valid_from||'';
  document.getElementById('rest-to').value = r.valid_to||'';
  openModal('modal-restriction');
}
async function deleteRestriction(id) {
  if (!confirm('Delete this restriction?')) return;
  try { await api('DELETE', `/restrictions/${id}`); toast('Deleted','success'); Pages.restrictions(); }
  catch(e) { toast(e.message,'error'); }
}

// ===== Restriction Weekly Capacity Management =====
let _currentRestrictionId = null;
let _currentRestrictionName = '';
let _capacityExcelData = [];

function openRestrictionCapacity(id, name) {
  _currentRestrictionId = id;
  _currentRestrictionName = name;
  document.getElementById('rc-title').textContent = name + ' — Weekly Capacities';
  document.getElementById('rc-sub').textContent = 'Manage capacity buckets for this restriction';
  const now = new Date();
  document.getElementById('rcb-year').value = now.getFullYear();
  document.getElementById('rcb-week').value = isoWeek(now);
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-restriction-capacity').classList.add('active');
  document.getElementById('topbar-title').textContent = name + ' — Capacities';
  loadCapacityTable();
}

async function loadCapacityTable() {
  const tbody = document.getElementById('rc-tbody');
  try {
    const rows = await api('GET', `/restrictions/${_currentRestrictionId}/capacities`);
    document.getElementById('rc-count').textContent = rows.length + ' weeks';
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text3);padding:16px">No capacity records yet</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(r => {
      const isZero = Number(r.capacity) <= 0;
      const rowStyle = isZero ? 'background:rgba(255,59,48,0.1);' : '';
      const cellStyle = isZero ? 'color:var(--red);font-weight:600' : '';
      return `<tr style="${rowStyle}">
        <td class="mono">${r.year}</td>
        <td class="mono">W${String(r.week).padStart(2,'0')}</td>
        <td class="mono" style="${cellStyle}">${r.capacity}</td>
        <td>
          <button class="btn btn-danger btn-sm" onclick="deleteCapacityRow('${r.id}')">Del</button>
        </td>
      </tr>`;
    }).join('');
  } catch(e) { toast(e.message, 'error'); }
}

async function bulkGenerateCapacity() {
  const y = parseInt(document.getElementById('rcb-year').value);
  const w = parseInt(document.getElementById('rcb-week').value);
  const n = parseInt(document.getElementById('rcb-num').value);
  const c = parseFloat(document.getElementById('rcb-cap').value);
  if (!y || !w || !n || isNaN(c)) { toast('Fill in all bulk fields','error'); return; }
  try {
    const r = await api('POST', `/restrictions/${_currentRestrictionId}/bulk-capacities`,
      { start_year: y, start_week: w, num_weeks: n, capacity: c });
    toast(`Created ${r.created} weeks`, 'success');
    loadCapacityTable();
  } catch(e) { toast(e.message, 'error'); }
}

async function deleteCapacityRow(id) {
  if (!confirm('Delete this capacity week?')) return;
  try {
    await api('DELETE', `/restrictions/${_currentRestrictionId}/capacities/${id}`);
    toast('Deleted', 'success');
    loadCapacityTable();
  } catch(e) { toast(e.message, 'error'); }
}

function openModal_addCapacity() {
  const now = new Date();
  document.getElementById('acw-year').value = now.getFullYear();
  document.getElementById('acw-week').value = isoWeek(now);
  openModal('modal-add-capacity');
}

async function saveCapacityWeek() {
  const year = parseInt(document.getElementById('acw-year').value);
  const week = parseInt(document.getElementById('acw-week').value);
  const capacity = parseFloat(document.getElementById('acw-cap').value);
  if (!year || !week || isNaN(capacity)) { toast('Fill in all fields', 'error'); return; }
  try {
    await api('POST', `/restrictions/${_currentRestrictionId}/capacities`, { year, week, capacity });
    closeModal('modal-add-capacity');
    toast('Capacity week saved', 'success');
    loadCapacityTable();
  } catch(e) { toast(e.message, 'error'); }
}

function handleCapacityDrop(event) {
  event.preventDefault();
  document.getElementById('rc-dropzone').classList.remove('drag-over');
  const file = event.dataTransfer.files[0];
  if (file) parseCapacityExcel(file);
}
function handleCapacityFileSelect(event) {
  const file = event.target.files[0];
  if (file) parseCapacityExcel(file);
}
function parseCapacityExcel(file) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const wb = XLSX.read(e.target.result, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
      _capacityExcelData = rows.map(r => ({
        year: parseInt(r.year || r.Year || r.YEAR),
        week: parseInt(r.week || r.Week || r.WEEK),
        capacity: parseFloat(r.capacity || r.Capacity || r.CAPACITY)
      })).filter(r => r.year && r.week && !isNaN(r.capacity));
      document.getElementById('rc-preview-info').textContent =
        `${_capacityExcelData.length} valid rows found in "${wb.SheetNames[0]}"`;
      document.getElementById('rc-preview-tbody').innerHTML =
        _capacityExcelData.slice(0, 10).map(r =>
          `<tr><td>${r.year}</td><td>W${String(r.week).padStart(2,'0')}</td><td>${r.capacity}</td></tr>`
        ).join('') + (_capacityExcelData.length > 10 ? `<tr><td colspan="3" style="color:var(--text3)">… and ${_capacityExcelData.length - 10} more</td></tr>` : '');
      document.getElementById('rc-preview').style.display = 'block';
    } catch(ex) { toast('Failed to parse Excel: ' + ex.message, 'error'); }
  };
  reader.readAsArrayBuffer(file);
}
async function uploadCapacityFromExcel() {
  if (!_capacityExcelData.length) { toast('No data to upload','error'); return; }
  let ok = 0, fail = 0;
  for (const row of _capacityExcelData) {
    try {
      await api('POST', `/restrictions/${_currentRestrictionId}/capacities`, row);
      ok++;
    } catch(e) { fail++; }
  }
  toast(`Uploaded: ${ok} rows${fail ? ', ' + fail + ' failed' : ''}`, ok ? 'success' : 'error');
  document.getElementById('rc-preview').style.display = 'none';
  _capacityExcelData = [];
  document.getElementById('rc-file-input').value = '';
  loadCapacityTable();
}
