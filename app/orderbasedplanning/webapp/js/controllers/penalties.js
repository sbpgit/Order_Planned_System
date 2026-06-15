// ===== Penalties =====
let _penaltyRules = [];
let _penaltyProdMap = {};

function renderPenaltiesList(filter) {
  const q = (filter || '').trim().toLowerCase();
  const tbody = document.getElementById('tbody-penalties');
  const countEl = document.getElementById('penalties-count');
  if (!_penaltyRules.length) { tbody.innerHTML = '<tr><td colspan="6" class="text-muted" style="text-align:center;padding:40px">No rules yet</td></tr>'; return; }
  const rows = q ? _penaltyRules.filter(r => {
    const prodName = r.product_id ? (_penaltyProdMap[r.product_id] || '') : 'All Products';
    return (r.rule_type||'').toLowerCase().includes(q) || (r.customer_priority||'').toLowerCase().includes(q) || prodName.toLowerCase().includes(q);
  }) : _penaltyRules;
  if (countEl) countEl.textContent = q ? `${rows.length}/${_penaltyRules.length}` : _penaltyRules.length;
  if (!rows.length) { tbody.innerHTML = '<tr><td colspan="6" class="text-muted" style="text-align:center;padding:40px">No matching rules</td></tr>'; return; }
  tbody.innerHTML = rows.map(r => `
    <tr>
      <td><span class="badge ${r.rule_type === 'late_delivery' ? 'badge-delayed' : 'badge-critical'}">${r.rule_type.replace('_',' ')}</span></td>
      <td>${fmt.priorityBadge(r.customer_priority)}</td>
      <td class="text-muted">${r.product_id ? _penaltyProdMap[r.product_id] || r.product_id : 'All Products'}</td>
      <td class="text-yellow">${fmt.penalty(r.penalty_per_day)}/day</td>
      <td class="text-red">${fmt.penalty(r.penalty_flat)}</td>
      <td style="display:none"></td>
    </tr>
  `).join('');
}
function filterPenalties(val) { renderPenaltiesList(val); }

Pages.penalties = async () => {
  try {
    const [rules, prods] = await Promise.all([api('GET', '/penalty-rules'), api('GET', '/products')]);
    _penaltyRules = rules;
    _penaltyProdMap = Object.fromEntries(prods.map(p => [p.id, p.name]));
    const searchEl = document.getElementById('penalties-search');
    renderPenaltiesList(searchEl ? searchEl.value : '');
  } catch(e) { toast(e.message,'error'); }
};

async function savePenalty() {
  try {
    const data = {
      rule_type: document.getElementById('pen-type').value,
      customer_priority: document.getElementById('pen-priority').value,
      product_id: document.getElementById('pen-product').value || null,
      penalty_per_day: parseFloat(document.getElementById('pen-perday').value)||0,
      penalty_flat: parseFloat(document.getElementById('pen-flat').value)||0
    };
    await api('POST', '/penalty-rules', data);
    toast('Rule created','success');
    closeModal('modal-penalty');
    Pages.penalties();
  } catch(e) { toast(e.message,'error'); }
}
async function deletePenalty(id) {
  if (!confirm('Delete this rule?')) return;
  try { await api('DELETE', `/penalty-rules/${id}`); toast('Deleted','success'); Pages.penalties(); }
  catch(e) { toast(e.message,'error'); }
}
