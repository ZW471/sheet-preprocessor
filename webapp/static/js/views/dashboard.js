/**
 * Dashboard view
 */
window.renderDashboard = function(app) {
  const m = app.manifest;
  if (!m) return '<div class="empty-state"><div class="icon">&#128203;</div><p>Loading manifest...</p></div>';

  const totalRows = m.sheets.reduce((s, sh) => s + (sh.n_rows || 0), 0);
  const totalCols = m.sheets.reduce((s, sh) => s + (sh.n_cols || 0), 0);

  let html = `
    <h2 class="page-title">Dashboard</h2>
    <p class="page-subtitle">${m.source_file || 'Workbook'} &mdash; ${m.sheets.length} sheets
      <button class="btn btn-primary btn-sm" style="margin-left:16px" onclick="exportPlan()">Export Plan</button>
    </p>

    <div class="kpi-row">
      <div class="kpi-card">
        <div class="kpi-value">${m.sheets.length}</div>
        <div class="kpi-label">Sheets</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-value">${totalRows.toLocaleString()}</div>
        <div class="kpi-label">Total Rows</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-value">${totalCols}</div>
        <div class="kpi-label">Total Columns</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-value" style="color: ${m.outlier_groups_pending > 0 ? 'var(--yellow)' : 'var(--green)'}">
          ${m.outlier_groups_pending || 0}
        </div>
        <div class="kpi-label">Outlier Groups Pending</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-value" style="color: ${(m.issues_pending || 0) > 0 ? 'var(--orange)' : 'var(--green)'}">
          ${m.issues_pending || 0}
        </div>
        <div class="kpi-label">Issues Pending</div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Sheet Inventory</div>
      <table class="data-table">
        <thead>
          <tr>
            <th>Sheet</th>
            <th>Kind</th>
            <th class="num">Rows</th>
            <th class="num">Entities</th>
            <th class="num">Columns</th>
            <th>Entity Key</th>
            <th>Time Key</th>
            <th class="num">Pending</th>
          </tr>
        </thead>
        <tbody>`;

  for (const s of m.sheets) {
    const pending = (s.outlier_groups_pending || 0) + (s.escalations_pending || 0) + (s.issues_pending || 0);
    const pendingBadge = pending > 0
      ? `<span class="badge warn">${pending}</span>`
      : `<span class="badge success">0</span>`;

    html += `
          <tr style="cursor:pointer" onclick="location.hash='/sheet/${encodeURIComponent(s.name)}'">
            <td><strong>${s.name}</strong></td>
            <td><span class="sheet-kind-badge ${s.kind || ''}">${(s.kind || '—').replace(/_/g, ' ')}</span></td>
            <td class="num">${(s.n_rows || 0).toLocaleString()}</td>
            <td class="num">${(s.n_unique || 0).toLocaleString()}</td>
            <td class="num">${s.n_cols || '—'}</td>
            <td class="mono">${s.entity_key || '—'}</td>
            <td class="mono">${s.time_key || '—'}</td>
            <td class="num">${pendingBadge}</td>
          </tr>`;
  }

  html += `
        </tbody>
      </table>
    </div>`;

  // Join keys summary
  if (m.join_keys && m.join_keys.length > 0) {
    html += `
    <div class="card">
      <div class="card-title">Join Keys</div>
      <table class="data-table">
        <thead>
          <tr><th>Key</th><th class="num">Sheets</th><th class="num">Min Coverage</th></tr>
        </thead>
        <tbody>`;
    for (const jk of m.join_keys) {
      html += `
          <tr>
            <td class="mono">${jk.key}</td>
            <td class="num">${jk.sheets?.length || jk.sheet_count || '—'}</td>
            <td class="num">${app.pct(jk.coverage_min)}</td>
          </tr>`;
    }
    html += `</tbody></table></div>`;
  }

  return html;
};


// Export Plan modal
window.exportPlan = async function() {
  try {
    const res = await fetch('/api/export-plan');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();

    // Create modal overlay
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
    overlay.innerHTML = `
      <div class="modal-box">
        <h3 style="margin-bottom:12px">Export Plan</h3>
        <pre>${data.plan.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
        <div style="font-size:12px;color:var(--text-muted);margin-top:8px">Saved to: ${data.path}</div>
        <div class="modal-actions">
          <button class="btn btn-sm" style="background:#f1f5f9;color:var(--text)" onclick="this.closest('.modal-overlay').remove()">Close</button>
          <button class="btn btn-primary btn-sm" onclick="copyPlanText(this)">Copy to Clipboard</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    window.showToast('Plan exported and saved', 'success');
  } catch (e) {
    window.showToast('Failed to export plan: ' + e.message, 'error');
  }
};

window.copyPlanText = function(btn) {
  const pre = btn.closest('.modal-box').querySelector('pre');
  if (pre) {
    navigator.clipboard.writeText(pre.textContent).then(function() {
      window.showToast('Plan copied to clipboard', 'success');
    });
  }
};
