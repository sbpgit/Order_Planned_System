// ===== Date setup =====
const today = new Date();
const day = today.getDay() || 7;
const startOfWeek = new Date(today);
if (day !== 1) startOfWeek.setDate(today.getDate() - day + 1);
const validFrom = startOfWeek.toISOString().split('T')[0];
const validToDate = new Date(today);
validToDate.setMonth(validToDate.getMonth() + 6);
const validTo = validToDate.toISOString().split('T')[0];

// ===== API Helper =====
const API = 'api';
async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(API + path, opts);
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ===== Toast =====
function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const icons = { success: '', error: '', info: '' };
  el.innerHTML = `<span>${icons[type] || ''}</span><span>${msg}</span>`;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 4000);
}
