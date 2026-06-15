// ===== Products =====
let _productsSortCol = 'lead_time_days';
let _productsSortDir = 'asc';
let _productsPage = 1;

const PRODUCT_SORT_COLS = ['product_code','name','category','unit_price','standard_cost','lead_time_days'];

function sortProductsCol(col) {
  if (_productsSortCol === col) {
    _productsSortDir = _productsSortDir === 'asc' ? 'desc' : 'asc';
  } else {
    _productsSortCol = col;
    _productsSortDir = 'asc';
  }
  _productsPage = 1;
  renderProductsList(document.getElementById('products-search')?.value || '');
}

function goProductsPage(p) {
  _productsPage = p;
  renderProductsList(document.getElementById('products-search')?.value || '');
}

function renderProductsList(filter) {
  const q = (filter || '').trim().toLowerCase();
  const tbody = document.getElementById('tbody-products');
  const countEl = document.getElementById('products-count');
  if (!_products.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-muted" style="text-align:center;padding:40px">No products yet. <a href="#" onclick="openModal(\'modal-product\')" style="color:var(--accent)">Add one</a></td></tr>';
    document.getElementById('pagination-products').style.display = 'none';
    return;
  }
  let rows = q ? _products.filter(p => (p.name||'').toLowerCase().includes(q) || (p.product_code||'').toLowerCase().includes(q) || (p.category||'').toLowerCase().includes(q)) : _products;
  if (countEl) countEl.textContent = q ? `${rows.length}/${_products.length}` : _products.length;

  rows = applySort(rows, _productsSortCol, _productsSortDir);
  updateSortIcons('products', _productsSortCol, _productsSortDir, PRODUCT_SORT_COLS);

  const total = rows.length;
  const sliced = rows.slice((_productsPage - 1) * PAGE_SIZE, _productsPage * PAGE_SIZE);
  renderPagination('pagination-products', total, _productsPage, PAGE_SIZE, 'goProductsPage');

  if (!sliced.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-muted" style="text-align:center;padding:40px">No matching products</td></tr>';
    return;
  }
  tbody.innerHTML = sliced.map(p => `
    <tr>
      <td class="mono primary">${p.product_code}</td>
      <td class="primary">${p.name}</td>
      <td class="text-muted">${p.category || '—'}</td>
      <td>${fmt.currency(p.unit_price)}</td>
      <td>${fmt.currency(p.standard_cost)}</td>
      <td class="text-muted">${p.lead_time_days || 0}d</td>
      <td style="display:none"></td>
    </tr>
  `).join('');
}
function filterProducts(val) { _productsPage = 1; renderProductsList(val); }

Pages.products = async () => {
  try {
    _products = await api('GET', '/products');
    _products = [...new Map(_products.map(p => [`${p.product_code}|${p.name}`, p])).values()];
    const searchEl = document.getElementById('products-search');
    renderProductsList(searchEl ? searchEl.value : '');
  } catch(e) { toast(e.message,'error'); }
};

async function saveProduct() {
  try {
    const id = document.getElementById('prod-id').value;
    const data = {
      product_code: document.getElementById('prod-code').value,
      name: document.getElementById('prod-name').value,
      description: document.getElementById('prod-desc').value,
      category: document.getElementById('prod-cat').value,
      unit_price: parseFloat(document.getElementById('prod-price').value)||0,
      standard_cost: parseFloat(document.getElementById('prod-cost').value)||0,
      lead_time_days: parseInt(document.getElementById('prod-lead').value)||0,
      is_active: 1
    };
    if (id) { await api('PUT', `/products/${id}`, data); toast('Product updated','success'); }
    else { await api('POST', '/products', data); toast('Product created','success'); }
    closeModal('modal-product');
    Pages.products();
  } catch(e) { toast(e.message,'error'); }
}
function editProduct(id) {
  const p = _products.find(x => x.id === id);
  if (!p) return;
  document.getElementById('prod-id').value = p.id;
  document.getElementById('prod-code').value = p.product_code;
  document.getElementById('prod-name').value = p.name;
  document.getElementById('prod-desc').value = p.description||'';
  document.getElementById('prod-cat').value = p.category||'';
  document.getElementById('prod-price').value = p.unit_price||'';
  document.getElementById('prod-cost').value = p.standard_cost||'';
  document.getElementById('prod-lead').value = p.lead_time_days||'';
  openModal('modal-product');
}
async function deleteProduct(id) {
  if (!confirm('Delete this product?')) return;
  try { await api('DELETE', `/products/${id}`); toast('Deleted','success'); Pages.products(); }
  catch(e) { toast(e.message,'error'); }
}
