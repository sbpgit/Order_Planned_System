// ===== Orders =====
let _orders = [];
let _ordersSortCol = 'promise_date';
let _ordersSortDir = 'asc';
let _ordersPage = 1;

const ORDER_SORT_COLS = ['order_number','customer_name','promise_date','quantity','revenue','priority'];

function sortOrdersCol(col) {
  if (_ordersSortCol === col) {
    _ordersSortDir = _ordersSortDir === 'asc' ? 'desc' : 'asc';
  } else {
    _ordersSortCol = col;
    _ordersSortDir = 'asc';
  }
  _ordersPage = 1;
  renderOrdersList(document.getElementById('orders-search')?.value || '');
}

function goOrdersPage(p) {
  _ordersPage = p;
  renderOrdersList(document.getElementById('orders-search')?.value || '');
}

function renderOrdersList(filter) {
  const q = (filter || '').trim().toLowerCase();
  const tbody = document.getElementById('tbody-orders');
  const countEl = document.getElementById('orders-count');
  if (!_orders.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="text-muted" style="text-align:center;padding:40px">No orders yet</td></tr>';
    document.getElementById('pagination-orders').style.display = 'none';
    return;
  }
  let rows = q ? _orders.filter(o =>
    (o.order_number||'').toLowerCase().includes(q) ||
    (o.customer_name||'').toLowerCase().includes(q) ||
    (o.product_name||'').toLowerCase().includes(q) ||
    (o.status||'').toLowerCase().includes(q)
  ) : _orders;
  if (countEl) countEl.textContent = q ? `${rows.length}/${_orders.length}` : _orders.length;

  rows = applySort(rows, _ordersSortCol, _ordersSortDir);
  updateSortIcons('orders', _ordersSortCol, _ordersSortDir, ORDER_SORT_COLS);

  const total = rows.length;
  const sliced = rows.slice((_ordersPage - 1) * PAGE_SIZE, _ordersPage * PAGE_SIZE);
  renderPagination('pagination-orders', total, _ordersPage, PAGE_SIZE, 'goOrdersPage');

  if (!sliced.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="text-muted" style="text-align:center;padding:40px">No matching orders</td></tr>';
    return;
  }
  const today = new Date().toISOString().split('T')[0];
  tbody.innerHTML = sliced.map(o => {
    const overdue = o.promise_date < today && (o.status === 'Open' || o.status === 'Confirmed');
    return `<tr ${overdue ? 'style="background:rgba(239,68,68,0.05)"' : ''}>
      <td class="mono primary">${o.order_number}</td>
      <td>${o.customer_name || '—'}<br><span class="text-xs text-muted">${fmt.priorityBadge(o.priority)}</span></td>
      <td class="text-sm">${o.product_name || '—'}</td>
      <td class="${overdue ? 'text-red' : ''}">${fmt.date(o.promise_date)}</td>
      <td class="mono">${o.quantity}</td>
      <td>${fmt.currency(o.revenue)}</td>
      <td>${fmt.priorityBadge(o.priority)}</td>
      <td>${fmt.statusBadge(o.status)}</td>
      <td style="display:none"></td>
    </tr>`;
  }).join('');
}
function filterOrders(val) { _ordersPage = 1; renderOrdersList(val); }

Pages.orders = async () => {
  try {
    _orders = await api('GET', locPath('/sales-orders'));
    const searchEl = document.getElementById('orders-search');
    renderOrdersList(searchEl ? searchEl.value : '');
  } catch(e) { toast(e.message, 'error'); }
};

async function openOrderModal() {
  document.getElementById('ord-id').value = '';
  document.getElementById('ord-num').value = '';
  document.getElementById('ord-notes').value = '';
  const prods = await api('GET', '/products');
  const custs = await api('GET', '/customers');
  const pSel = document.getElementById('ord-product');
  pSel.innerHTML = prods.map(p => `<option value="${p.id}" data-price="${p.unit_price}" data-cost="${p.standard_cost}">${p.name} (${p.product_code})</option>`).join('');
  document.getElementById('ord-customer').innerHTML = custs.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  updateOrderCost();
  openModal('modal-order');
}
function updateOrderCost() {
  const pSel = document.getElementById('ord-product');
  const opt = pSel.options[pSel.selectedIndex];
  if (opt) {
    const qty = parseInt(document.getElementById('ord-qty').value)||1;
    const price = parseFloat(opt.dataset.price)||0;
    const cost = parseFloat(opt.dataset.cost)||0;
    document.getElementById('ord-price').value = price;
    document.getElementById('ord-cost').value = cost;
  }
}
async function saveOrder() {
  try {
    const id = document.getElementById('ord-id').value;
    const data = {
      order_number: document.getElementById('ord-num').value || undefined,
      customer_id: document.getElementById('ord-customer').value,
      product_id: document.getElementById('ord-product').value,
      quantity: parseInt(document.getElementById('ord-qty').value)||1,
      requested_date: document.getElementById('ord-req').value,
      promise_date: document.getElementById('ord-promise').value,
      unit_price: parseFloat(document.getElementById('ord-price').value)||0,
      cost: parseFloat(document.getElementById('ord-cost').value)||0,
      priority: document.getElementById('ord-priority').value,
      status: document.getElementById('ord-status').value,
      notes: document.getElementById('ord-notes').value
    };
    if (id) { await api('PUT', `/sales-orders/${id}`, data); toast('Order updated','success'); }
    else { await api('POST', '/sales-orders', data); toast('Order created','success'); }
    closeModal('modal-order');
    Pages.orders();
  } catch(e) { toast(e.message,'error'); }
}
async function editOrder(id) {
  try {
    const prods = await api('GET', '/products');
    const custs = await api('GET', '/customers');
    const ord = await api('GET', `/sales-orders/${id}`);
    document.getElementById('ord-product').innerHTML = prods.map(p => `<option value="${p.id}" data-price="${p.unit_price}" data-cost="${p.standard_cost}">${p.name} (${p.product_code})</option>`).join('');
    document.getElementById('ord-customer').innerHTML = custs.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    document.getElementById('ord-id').value = ord.id;
    document.getElementById('ord-num').value = ord.order_number;
    document.getElementById('ord-customer').value = ord.customer_id;
    document.getElementById('ord-product').value = ord.product_id;
    document.getElementById('ord-qty').value = ord.quantity;
    document.getElementById('ord-req').value = ord.requested_date||'';
    document.getElementById('ord-promise').value = ord.promise_date;
    document.getElementById('ord-price').value = ord.unit_price;
    document.getElementById('ord-cost').value = ord.cost;
    document.getElementById('ord-priority').value = ord.priority;
    document.getElementById('ord-status').value = ord.status;
    document.getElementById('ord-notes').value = ord.notes||'';
    openModal('modal-order');
  } catch(e) { toast(e.message,'error'); }
}
async function deleteOrder(id) {
  if (!confirm('Delete this order?')) return;
  try { await api('DELETE', `/sales-orders/${id}`); toast('Deleted','success'); Pages.orders(); }
  catch(e) { toast(e.message,'error'); }
}
