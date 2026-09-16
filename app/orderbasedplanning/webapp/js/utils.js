// ===== Loading Overlay =====
function showLoading(text) {
  const overlay = document.getElementById('loading-overlay');
  const label = document.getElementById('loading-overlay-text');
  if (label && text) label.textContent = text;
  overlay.classList.add('active');
}
function hideLoading() {
  document.getElementById('loading-overlay').classList.remove('active');
}

// ===== HTML Escape =====
// Required for any text that did not originate in this app (e.g. LLM output)
// before it is placed into innerHTML.
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

// ===== ISO Week Helpers =====
function isoWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}
function isoWeekYear(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return { week, year: d.getUTCFullYear() };
}

// ===== Pagination Helper =====
const PAGE_SIZE = 50;

function renderPagination(containerId, total, page, pageSize, onPageFn) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (total <= pageSize) { el.style.display = 'none'; return; }
  el.style.display = 'flex';
  const totalPages = Math.ceil(total / pageSize);
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  let pagesHtml = '';
  const delta = 2;
  const range = [];
  for (let i = Math.max(1, page - delta); i <= Math.min(totalPages, page + delta); i++) range.push(i);
  if (range[0] > 1) {
    pagesHtml += `<button class="pg-btn" onclick="${onPageFn}(1)">1</button>`;
    if (range[0] > 2) pagesHtml += `<span style="color:var(--text3);font-size:12px;padding:0 2px">…</span>`;
  }
  range.forEach(p => { pagesHtml += `<button class="pg-btn${p === page ? ' pg-active' : ''}" onclick="${onPageFn}(${p})">${p}</button>`; });
  if (range[range.length - 1] < totalPages) {
    if (range[range.length - 1] < totalPages - 1) pagesHtml += `<span style="color:var(--text3);font-size:12px;padding:0 2px">…</span>`;
    pagesHtml += `<button class="pg-btn" onclick="${onPageFn}(${totalPages})">${totalPages}</button>`;
  }

  el.innerHTML = `
    <span class="pg-info">Showing ${from}–${to} of ${total}</span>
    <button class="pg-btn" onclick="${onPageFn}(${page - 1})" ${page <= 1 ? 'disabled' : ''}>‹</button>
    ${pagesHtml}
    <button class="pg-btn" onclick="${onPageFn}(${page + 1})" ${page >= totalPages ? 'disabled' : ''}>›</button>
  `;
}

// ===== Sort Helpers =====
function getSortIcon(col, sortCol, sortDir) {
  if (col !== sortCol) return '<span style="opacity:0.3;font-size:10px">⇅</span>';
  return sortDir === 'asc' ? '↑' : '↓';
}
function updateSortIcons(prefix, sortCol, sortDir, cols) {
  cols.forEach(c => {
    const el = document.getElementById(`sort-${prefix}-${c}`);
    if (el) el.innerHTML = getSortIcon(c, sortCol, sortDir);
  });
}
function applySort(arr, col, dir) {
  if (!col) return arr;
  return [...arr].sort((a, b) => {
    let av = a[col], bv = b[col];
    if (av == null) av = '';
    if (bv == null) bv = '';
    if (typeof av === 'number' && typeof bv === 'number') return dir === 'asc' ? av - bv : bv - av;
    return dir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
  });
}

// ===== Navigation =====
const pageTitles = {
  dashboard: 'Dashboard', products: 'Products', customers: 'Customers',
  restrictions: 'Restrictions', components: 'Components', penalties: 'Penalty Rules',
  orders: 'Sales Orders', optimize: 'Run Optimization', results: 'Results History'
};

function navigate(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(`page-${page}`).classList.add('active');
  const loaders = {
    dashboard: Pages.dashboard,
    products: Pages.products,
    customers: Pages.customers,
    restrictions: Pages.restrictions,
    components: Pages.components,
    penalties: Pages.penalties,
    orders: Pages.orders,
    optimize: Pages.optimize,
    results: Pages.results
  };
  if (loaders[page]) loaders[page]();
  document.querySelectorAll('.nav-item').forEach(n => {
    if (n.getAttribute('onclick') === `navigate('${page}')`) n.classList.add('active');
  });
  document.getElementById('topbar-title').textContent = pageTitles[page] || page;
}

// ===== Modal helpers =====
function openModal(id) {
  document.getElementById(id).classList.add('open');
}
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}

// ===== Confirm Modal (replaces native window.confirm) =====
// Renders through the app's own modal system so destructive actions get a
// styled dialog instead of the browser's native confirm() popup.
let _confirmModalCallback = null;
function showConfirm({ title = 'Confirm', message = '', confirmText = 'Continue', danger = false, onConfirm }) {
  document.getElementById('modal-confirm-title').textContent = title;
  document.getElementById('modal-confirm-message').innerHTML = message;
  const confirmBtn = document.getElementById('modal-confirm-ok');
  confirmBtn.textContent = confirmText;
  confirmBtn.className = `btn ${danger ? 'btn-danger' : 'btn-primary'}`;
  _confirmModalCallback = onConfirm;
  openModal('modal-confirm');
}
function _runConfirmModal() {
  const cb = _confirmModalCallback;
  _confirmModalCallback = null;
  closeModal('modal-confirm');
  if (cb) cb();
}

// Utilization ratio as a percentage. Zero availability with real demand is not
// 0% utilization — it is unbounded, so report it as Infinity and let the
// formatters render it rather than silently showing a healthy-looking figure.
function utilRatio(required, available) {
  const r = Number(required || 0), a = Number(available || 0);
  return a > 0 ? (r / a) * 100 : (r > 0 ? Infinity : 0);
}

// ===== Formatting =====
const fmt = {
  currency: v => v != null ? '$' + Number(v).toLocaleString('en-US', {maximumFractionDigits:0}) : '—',
  date: d => d ? new Date(d+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '—',
  // Server timestamps (run_date, etc.) are stored/transmitted as UTC ISO strings.
  // Deliberately omit `timeZone` so the browser renders each viewer's own local
  // time (a user in the US sees US time, a user in India sees IST, etc.) — do
  // not hardcode a timeZone here.
  datetime: d => d ? new Date(d).toLocaleString('en-US', { month:'short', day:'numeric', year:'numeric', hour:'numeric', minute:'2-digit', second:'2-digit', hour12:true, timeZoneName:'short' }) : '—',
  week: d => { if (!d) return '—'; const {week, year} = isoWeekYear(new Date(d+'T00:00:00')); return `W${week}/${year}`; },
  pct: v => v != null ? Number(v).toFixed(1) + '%' : '—',
  // Utilization label — uncapped, so a component needing 5x its stock reads
  // 500%, not a clamped 200%. Unbounded (zero availability) renders as ∞.
  utilPct: (v, dp = 0) => v == null ? '—' : Number.isFinite(Number(v)) ? Number(v).toFixed(dp) + '%' : '∞',
  // Bar width for the same value: tracks are fixed-width, so they still
  // saturate at 100% even though the label above keeps climbing.
  utilBar: v => Number.isFinite(Number(v)) ? Math.max(0, Math.min(100, Number(v))) : 100,
  num: v => v != null ? Number(v).toLocaleString() : '—',
  penalty: v => v != null ? Number(v).toLocaleString('en-US', {maximumFractionDigits:0}) : '—',
  priorityBadge: p => `<span class="badge badge-${(p||'').toLowerCase()}">${p||'—'}</span>`,
  statusBadge: s => {
    const cls = s === 'Open' ? 'open' : s === 'Confirmed' ? 'confirmed' : 'ok';
    return `<span class="badge badge-${cls}">${s}</span>`;
  }
};

// ===== Init =====
document.addEventListener('DOMContentLoaded', () => {
  openLocationModal();
  api('GET', '/products').then(prods => {
    document.getElementById('pen-product').innerHTML =
      '<option value="">All Products</option>' +
      prods.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
  }).catch(() => {});

  const now = new Date();
  document.getElementById('cap-year').value = now.getFullYear();
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const week = Math.ceil(((now - startOfYear) / 86400000 + startOfYear.getDay() + 1) / 7);
  document.getElementById('cap-week').value = week;
  document.getElementById('cap-num').value = 14;
});
