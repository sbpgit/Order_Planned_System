// ===== Customers =====
let _customersSortCol = 'name';
let _customersSortDir = 'asc';
let _customersPage = 1;

const CUSTOMER_SORT_COLS = ['customer_code','name','priority'];

function sortCustomersCol(col) {
  if (_customersSortCol === col) {
    _customersSortDir = _customersSortDir === 'asc' ? 'desc' : 'asc';
  } else {
    _customersSortCol = col;
    _customersSortDir = 'asc';
  }
  _customersPage = 1;
  renderCustomersList(document.getElementById('customers-search')?.value || '');
}

function goCustomersPage(p) {
  _customersPage = p;
  renderCustomersList(document.getElementById('customers-search')?.value || '');
}

function renderCustomersList(filter) {
  const q = (filter || '').trim().toLowerCase();
  const tbody = document.getElementById('tbody-customers');
  const countEl = document.getElementById('customers-count');
  if (!_customers.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-muted" style="text-align:center;padding:40px">No customers yet</td></tr>';
    document.getElementById('pagination-customers').style.display = 'none';
    return;
  }
  let rows = q ? _customers.filter(c => (c.name||'').toLowerCase().includes(q) || (c.customer_code||'').toLowerCase().includes(q) || (c.contact_person||'').toLowerCase().includes(q) || (c.email||'').toLowerCase().includes(q)) : _customers;
  if (countEl) countEl.textContent = q ? `${rows.length}/${_customers.length}` : _customers.length;

  const priorityOrder = { High: 0, Medium: 1, Low: 2 };
  if (_customersSortCol === 'priority') {
    rows = [...rows].sort((a, b) => {
      const diff = (priorityOrder[a.priority] ?? 3) - (priorityOrder[b.priority] ?? 3);
      return _customersSortDir === 'asc' ? diff : -diff;
    });
  } else {
    rows = applySort(rows, _customersSortCol, _customersSortDir);
  }
  updateSortIcons('customers', _customersSortCol, _customersSortDir, CUSTOMER_SORT_COLS);

  const total = rows.length;
  const sliced = rows.slice((_customersPage - 1) * PAGE_SIZE, _customersPage * PAGE_SIZE);
  renderPagination('pagination-customers', total, _customersPage, PAGE_SIZE, 'goCustomersPage');

  if (!sliced.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-muted" style="text-align:center;padding:40px">No matching customers</td></tr>';
    return;
  }
  tbody.innerHTML = sliced.map(c => `
    <tr>
      <td class="mono primary">${c.customer_code}</td>
      <td class="primary">${c.name}</td>
      <td>${fmt.priorityBadge(c.priority)}</td>
      <td class="text-muted">${c.contact_person || '—'}</td>
      <td class="text-muted">${c.email || '—'}</td>
      <td style="display:none"></td>
    </tr>
  `).join('');
}
function filterCustomers(val) { _customersPage = 1; renderCustomersList(val); }

Pages.customers = async () => {
  try {
    _customers = await api('GET', '/customers');
    const searchEl = document.getElementById('customers-search');
    renderCustomersList(searchEl ? searchEl.value : '');
  } catch(e) { toast(e.message,'error'); }
};

async function saveCustomer() {
  try {
    const id = document.getElementById('cust-id').value;
    const data = {
      customer_code: document.getElementById('cust-code').value,
      name: document.getElementById('cust-name').value,
      priority: document.getElementById('cust-priority').value,
      contact_person: document.getElementById('cust-contact').value,
      email: document.getElementById('cust-email').value,
      phone: document.getElementById('cust-phone').value,
      is_active: 1
    };
    if (id) { await api('PUT', `/customers/${id}`, data); toast('Customer updated','success'); }
    else { await api('POST', '/customers', data); toast('Customer created','success'); }
    closeModal('modal-customer');
    Pages.customers();
  } catch(e) { toast(e.message,'error'); }
}
function editCustomer(id) {
  const c = _customers.find(x => x.id === id);
  if (!c) return;
  document.getElementById('cust-id').value = c.id;
  document.getElementById('cust-code').value = c.customer_code;
  document.getElementById('cust-name').value = c.name;
  document.getElementById('cust-priority').value = c.priority;
  document.getElementById('cust-contact').value = c.contact_person||'';
  document.getElementById('cust-email').value = c.email||'';
  document.getElementById('cust-phone').value = c.phone||'';
  openModal('modal-customer');
}
async function deleteCustomer(id) {
  if (!confirm('Delete this customer?')) return;
  try { await api('DELETE', `/customers/${id}`); toast('Deleted','success'); Pages.customers(); }
  catch(e) { toast(e.message,'error'); }
}
