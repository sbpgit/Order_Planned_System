// ===== Shared State =====
const Pages = {};
let _products = [], _customers = [], _restrictions = [], _components = [];
let _currentLocationId = '';

function locPath(path) {
  return _currentLocationId ? `${path}?locationId=${_currentLocationId}` : path;
}

// ===== Location =====
async function openLocationModal() {
  document.getElementById('modal-location-close').style.display = 'none';
  document.getElementById('modal-location-cancel').style.display = 'none';
  document.getElementById('modal-location-desc').textContent = 'Please select a location to continue.';
  const confirmBtn = document.getElementById('modal-location-confirm');
  confirmBtn.disabled = false;
  confirmBtn.textContent = 'Continue';

  const sel = document.getElementById('location-select');
  sel.innerHTML = '<option value="">Loading…</option>';
  try {
    const locations = await api('GET', '/locations');
    if (!locations.length) { toast('No locations found in SAP backend', 'error'); return; }
    const optionsHtml = locations.map(l =>
      `<option value="${l.LOCATION_ID}">${l.LOCATION_ID}${l.LOCATION_DESC ? ' — ' + l.LOCATION_DESC : ''}</option>`
    ).join('');
    sel.innerHTML = optionsHtml;
    const topbarSel = document.getElementById('topbar-location-select');
    topbarSel.innerHTML = '<option value="">Select location…</option>' + optionsHtml;
  } catch(e) { toast('Failed to load locations: ' + e.message, 'error'); return; }
  openModal('modal-location');
}

function setTopbarLocation(locationId) {
  const sel = document.getElementById('topbar-location-select');
  if (sel) sel.value = locationId;
  const optLocField = document.getElementById('opt-location-id');
  if (optLocField) optLocField.value = locationId;
}

function onTopbarLocationChange(locationId) {
  _currentLocationId = locationId;
  setTopbarLocation(locationId);
  const resultsSection = document.getElementById('opt-results-section');
  if (resultsSection) resultsSection.style.display = 'none';
  const resultsContent = document.getElementById('opt-results-content');
  if (resultsContent) resultsContent.innerHTML = '';
  const optProgress = document.getElementById('opt-progress');
  if (optProgress) {
    optProgress.innerHTML = '<div class="empty-state"><div>Configure parameters and click<br><strong>Run Optimization</strong> to start</div></div>';
  }
  navigate('dashboard');
}

Pages.seed = async () => {
  if (!_currentLocationId) { toast('Please select a location from the topbar first.', 'error'); return; }
  const topbarSel = document.getElementById('topbar-location-select');
  const locationLabel = topbarSel?.options[topbarSel.selectedIndex]?.text || _currentLocationId;
  if (!confirm(`This will clear ALL existing data and load data for:\n\n${locationLabel}\n\nContinue?`)) return;
  const btn = document.getElementById('btn-seed');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Loading...';
  showLoading(`Loading data for ${locationLabel}…`);
  try {
    const r = await api('POST', '/seed', { locationId: _currentLocationId });
    const optLocField = document.getElementById('opt-location-id');
    if (optLocField) { optLocField.value = _currentLocationId; optLocField.title = locationLabel; }
    const resultsSection = document.getElementById('opt-results-section');
    if (resultsSection) resultsSection.style.display = 'none';
    const resultsContent = document.getElementById('opt-results-content');
    if (resultsContent) resultsContent.innerHTML = '';
    const optProgress = document.getElementById('opt-progress');
    if (optProgress) {
      optProgress.innerHTML = '<div class="empty-state"><div>Configure parameters and click<br><strong>Run Optimization</strong> to start</div></div>';
    }
    toast(`Data loaded for ${locationLabel}: ${r.orders} orders, ${r.products} products, ${r.customers} customers`, 'success');
    navigate('dashboard');
  } catch(e) { toast(e.message, 'error'); }
  finally {
    hideLoading();
    btn.disabled = false;
    btn.innerHTML = 'Load Data';
  }
};

async function confirmLocationAndSeed() {
  const sel = document.getElementById('location-select');
  const locationId = sel.value;
  if (!locationId) { toast('Please select a location', 'error'); return; }
  const locationLabel = sel.options[sel.selectedIndex].text;
  closeModal('modal-location');
  _currentLocationId = locationId;
  setTopbarLocation(locationId);
  const optLocField = document.getElementById('opt-location-id');
  if (optLocField) { optLocField.value = locationId; optLocField.title = locationLabel; }
  navigate('dashboard');
}

Pages.clearData = async () => {
  if (!_currentLocationId) { toast('No location selected. Load data for a location first.', 'error'); return; }
  const topbarSel = document.getElementById('topbar-location-select');
  const locationLabel = topbarSel?.options[topbarSel.selectedIndex]?.text || _currentLocationId;
  if (!confirm(`This will permanently delete ALL data for location: ${locationLabel}\n\nThis action cannot be undone. Continue?`)) return;
  try {
    await api('DELETE', locPath('/clear-data'));
    const resultsSection = document.getElementById('opt-results-section');
    if (resultsSection) { resultsSection.style.display = 'none'; }
    const resultsContent = document.getElementById('opt-results-content');
    if (resultsContent) { resultsContent.innerHTML = ''; }
    const optProgress = document.getElementById('opt-progress');
    if (optProgress) {
      optProgress.innerHTML = '<div class="empty-state"><div>Configure parameters and click<br><strong>Run Optimization</strong> to start</div></div>';
    }
    toast(`All data for location ${locationLabel} has been cleared successfully`, 'success');
    navigate('dashboard');
  } catch(e) { toast(e.message,'error'); }
};

