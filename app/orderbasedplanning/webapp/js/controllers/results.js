// ===== Results =====
Pages.results = async () => {
  try {
    const runs = await api('GET', locPath('/optimization-runs'));
    const tbody = document.getElementById('tbody-results');
    if (!runs.length) { tbody.innerHTML = '<tr><td colspan="9" class="text-muted" style="text-align:center;padding:40px">No optimization runs yet for this location</td></tr>'; return; }
    tbody.innerHTML = runs.map(r => {
      const statusCls = r.status === 'Completed' ? 'badge-confirmed' : r.status === 'Failed' ? 'badge-critical' : 'badge-open';
      return `<tr>
        <td class="mono primary">${r.run_number}</td>
        <td class="text-muted">${r.description || '—'}</td>
        <td class="text-muted">${r.run_date ? new Date(r.run_date).toLocaleString() : '—'}</td>
        <td class="mono">${r.total_orders || 0}</td>
        <td class="${(r.on_time_percentage||0) >= 80 ? 'text-green' : 'text-yellow'}">${fmt.pct(r.on_time_percentage)}</td>
        <td class="text-red">${fmt.penalty(r.total_penalty_cost)}</td>
        <td class="text-muted mono">${r.execution_time_ms ? r.execution_time_ms + 'ms' : '—'}</td>
        <td><span class="badge ${statusCls}">${r.status}</span></td>
        <td><button class="btn btn-secondary btn-sm" onclick="viewRunDetail('${r.id}')">View</button></td>
      </tr>`;
    }).join('');
  } catch(e) { toast(e.message,'error'); }
};
