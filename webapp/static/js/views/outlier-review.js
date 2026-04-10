/**
 * Outlier Review view — interactive decision cards
 */
window.renderOutlierReview = function(app) {
  if (!app.manifest) return '<div class="empty-state"><div class="icon">&#128270;</div><p>Loading...</p></div>';

  // Collect all continuous columns across all sheets
  const groups = [];
  for (const sheetInfo of app.manifest.sheets) {
    const stats = app.sheetStats[sheetInfo.name];
    const config = app.sheetConfigs[sheetInfo.name];
    if (!stats || !config) continue;

    const sheetConfig = config[sheetInfo.name] || config?.sheets?.[sheetInfo.name] || config;
    const continuous = stats.continuous || {};

    for (const [colName, colStats] of Object.entries(continuous)) {
      if (colStats.outlier_count == null || colStats.outlier_count === 0) continue;
      if (colStats.tukey_suppressed) continue; // Suppressed — not actionable

      const colConfig = sheetConfig?.columns?.[colName] || {};
      const decision = colConfig.outlier_decisions;

      groups.push({
        sheet: sheetInfo.name,
        column: colName,
        stats: colStats,
        config: colConfig,
        decision: decision,
        decided: !!decision
      });
    }
  }

  // Filters
  let filtered = groups;
  if (app.outlierFilter === 'pending') filtered = groups.filter(g => !g.decided);
  if (app.outlierFilter === 'decided') filtered = groups.filter(g => g.decided);
  if (app.outlierSheetFilter !== 'all') filtered = filtered.filter(g => g.sheet === app.outlierSheetFilter);

  const pendingCount = groups.filter(g => !g.decided).length;
  const decidedCount = groups.filter(g => g.decided).length;

  // Get unique sheet names for filter
  const sheetNames = [...new Set(groups.map(g => g.sheet))];

  let html = `
    <h2 class="page-title">Outlier Review</h2>
    <p class="page-subtitle">${groups.length} outlier groups across ${sheetNames.length} sheets &bull;
      <span style="color:var(--yellow)">${pendingCount} pending</span> &bull;
      <span style="color:var(--green)">${decidedCount} decided</span>
    </p>

    <div class="card" style="background:#fffbeb;border-color:#fde68a">
      <div style="font-weight:600;margin-bottom:4px">Important</div>
      <div style="font-size:13px;color:#92400e">
        Being outside the 1.5&times;IQR Tukey fence does <strong>NOT</strong> mean a value is invalid.
        These are statistical outliers, not necessarily errors. Review each group and decide what action to take.
        The default is <strong>Keep as-is</strong> &mdash; only change this if you have evidence the values are erroneous.
      </div>
    </div>

    <div class="filter-bar">
      <select onchange="updateOutlierFilter(this.value)">
        <option value="all" ${app.outlierFilter === 'all' ? 'selected' : ''}>All (${groups.length})</option>
        <option value="pending" ${app.outlierFilter === 'pending' ? 'selected' : ''}>Pending (${pendingCount})</option>
        <option value="decided" ${app.outlierFilter === 'decided' ? 'selected' : ''}>Decided (${decidedCount})</option>
      </select>
      <select onchange="updateOutlierSheetFilter(this.value)">
        <option value="all" ${app.outlierSheetFilter === 'all' ? 'selected' : ''}>All sheets</option>
        ${sheetNames.map(n => `<option value="${n}" ${app.outlierSheetFilter === n ? 'selected' : ''}>${n}</option>`).join('')}
      </select>
    </div>`;

  if (filtered.length === 0) {
    html += `<div class="empty-state"><div class="icon">&#10004;</div><p>No outlier groups match your filter.</p></div>`;
    return html;
  }

  for (const g of filtered) {
    html += renderDecisionCard(g);
  }

  return html;
};


function renderDecisionCard(g) {
  const s = g.stats;
  const d = g.decision;
  const currentAction = d?.action || 'keep';
  const cardId = `${g.sheet}__${g.column}`.replace(/[^a-zA-Z0-9_\u4e00-\u9fff]/g, '_');

  let html = `
    <div class="decision-card ${g.decided ? 'decided' : 'pending'}" id="card-${cardId}">
      <div class="col-header">
        <span style="color:var(--text-muted);font-weight:400">${g.sheet}</span> &rsaquo; ${g.column}
        ${g.decided ? '<span class="badge success" style="margin-left:8px">Decided</span>' : '<span class="badge warn" style="margin-left:8px">Pending</span>'}
      </div>
      <div class="col-meta">
        ${s.outlier_count?.toLocaleString()} values outside fence
        &bull; ${s.outlier_rate != null ? (s.outlier_rate * 100).toFixed(1) + '% of data' : ''}
        ${s.units ? ' &bull; ' + s.units : ''}
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
        <div>
          <div class="stat-mini"><span class="label">Tukey fence</span><span class="value">[${s.outlier_lower?.toFixed(2)}, ${s.outlier_upper?.toFixed(2)}]</span></div>
          <div class="stat-mini"><span class="label">IQR</span><span class="value">${s.IQR?.toFixed(2)}</span></div>
          <div class="stat-mini"><span class="label">Skew</span><span class="value">${s.skew?.toFixed(3)}</span></div>
        </div>
        <div>
          <div class="stat-mini"><span class="label">Range</span><span class="value">[${s.min}, ${s.max}]</span></div>
          <div class="stat-mini"><span class="label">Q1 / Q3</span><span class="value">${s.Q1} / ${s.Q3}</span></div>
          ${s.domain_limits ? `<div class="stat-mini"><span class="label">Domain</span><span class="value">[${s.domain_limits.min}, ${s.domain_limits.max}]</span></div>` : ''}
        </div>
      </div>`;

  // Typical outlier values
  if (s.typical_outliers && s.typical_outliers.length > 0) {
    html += `<div style="margin-bottom:12px"><span style="font-size:12px;color:var(--text-muted)">Typical outlier values:</span>
      <div class="typical-values">${s.typical_outliers.map(v => `<span class="val">${v}</span>`).join('')}</div></div>`;
  }

  // Entity IDs (collapsible)
  if (s.outlier_entity_ids && s.outlier_entity_ids.length > 0) {
    const showCount = Math.min(10, s.outlier_entity_ids.length);
    html += `<details style="margin-bottom:12px;font-size:12px">
      <summary style="cursor:pointer;color:var(--text-muted)">${s.outlier_entity_ids.length} affected entities (show first ${showCount})</summary>
      <div class="typical-values" style="margin-top:6px">
        ${s.outlier_entity_ids.slice(0, showCount).map(id => `<span class="val">${id.substring(0, 12)}...</span>`).join('')}
        ${s.outlier_entity_ids.length > showCount ? `<span style="color:var(--text-muted)">+${s.outlier_entity_ids.length - showCount} more</span>` : ''}
      </div>
    </details>`;
  }

  // Decision options
  html += `
    <div style="font-weight:600;font-size:13px;margin-bottom:6px">Your decision:</div>
    <div class="decision-options" id="opts-${cardId}">
      <label class="${currentAction === 'keep' ? 'selected' : ''}" onclick="selectAction('${cardId}', 'keep')">
        <input type="radio" name="action-${cardId}" value="keep" ${currentAction === 'keep' ? 'checked' : ''}>
        <div><strong>Keep as-is</strong> &mdash; these values are legitimate, no action needed</div>
      </label>
      <label class="${currentAction === 'flag_only' ? 'selected' : ''}" onclick="selectAction('${cardId}', 'flag_only')">
        <input type="radio" name="action-${cardId}" value="flag_only" ${currentAction === 'flag_only' ? 'checked' : ''}>
        <div><strong>Flag only</strong> &mdash; add <code>_is_outlier</code> column, keep original values</div>
      </label>`;

  if (s.domain_limits) {
    html += `
      <label class="${currentAction === 'clip_to_domain' ? 'selected' : ''}" onclick="selectAction('${cardId}', 'clip_to_domain')">
        <input type="radio" name="action-${cardId}" value="clip_to_domain" ${currentAction === 'clip_to_domain' ? 'checked' : ''}>
        <div><strong>Clip to domain</strong> [${s.domain_limits.min}, ${s.domain_limits.max}] + add <code>_was_clipped</code> flag</div>
      </label>`;
  }

  html += `
      <label class="${currentAction === 'clip_to_custom' ? 'selected' : ''}" onclick="selectAction('${cardId}', 'clip_to_custom')">
        <input type="radio" name="action-${cardId}" value="clip_to_custom" ${currentAction === 'clip_to_custom' ? 'checked' : ''}>
        <div>
          <strong>Clip to custom bounds</strong> + flag
          <div class="clip-inputs">
            <span>Min:</span>
            <input type="number" id="clip-min-${cardId}" value="${d?.clip_bounds?.min ?? s.domain_limits?.min ?? s.min ?? ''}" step="any">
            <span>Max:</span>
            <input type="number" id="clip-max-${cardId}" value="${d?.clip_bounds?.max ?? s.domain_limits?.max ?? s.max ?? ''}" step="any">
          </div>
        </div>
      </label>
      <label class="${currentAction === 'remove' ? 'selected' : ''}" onclick="selectAction('${cardId}', 'remove')">
        <input type="radio" name="action-${cardId}" value="remove" ${currentAction === 'remove' ? 'checked' : ''}>
        <div><strong>Remove</strong> &mdash; null out outlier values + add mask column</div>
      </label>
      <label class="${currentAction === 'custom' ? 'selected' : ''}" onclick="selectAction('${cardId}', 'custom')">
        <input type="radio" name="action-${cardId}" value="custom" ${currentAction === 'custom' ? 'checked' : ''}>
        <div>
          <strong>Custom</strong> &mdash; describe your approach:
          <input type="text" class="custom-input" id="custom-${cardId}"
                 placeholder="e.g., divide by 10 if > 300, else clip to domain"
                 value="${d?.custom_note || ''}">
        </div>
      </label>
    </div>

    <div style="display:flex;gap:8px;margin-top:12px">
      <button class="btn btn-primary" onclick="saveOutlierDecision('${g.sheet}', '${g.column}', '${cardId}')">
        Save Decision
      </button>
      ${g.decided ? `<span style="font-size:12px;color:var(--text-muted);align-self:center">Last saved: ${d?.decided_at || '—'}</span>` : ''}
    </div>
  </div>`;

  return html;
}


// Global helpers
window.selectAction = function(cardId, action) {
  const opts = document.getElementById(`opts-${cardId}`);
  if (!opts) return;
  opts.querySelectorAll('label').forEach(l => l.classList.remove('selected'));
  const radio = opts.querySelector(`input[value="${action}"]`);
  if (radio) {
    radio.checked = true;
    radio.closest('label').classList.add('selected');
  }
};

window.updateOutlierFilter = function(val) {
  const data = window._alpine();
  if (data) data.outlierFilter = val;
};

window.updateOutlierSheetFilter = function(val) {
  const data = window._alpine();
  if (data) data.outlierSheetFilter = val;
};

window.saveOutlierDecision = async function(sheet, column, cardId) {
  const opts = document.getElementById(`opts-${cardId}`);
  if (!opts) return;
  const selected = opts.querySelector('input[type="radio"]:checked');
  if (!selected) {
    window.showToast('Please select an action first', 'error');
    return;
  }

  const action = selected.value;
  let customNote = null;
  let clipBounds = null;

  if (action === 'custom') {
    customNote = document.getElementById(`custom-${cardId}`)?.value || null;
    if (!customNote) {
      window.showToast('Please enter a description for your custom approach', 'error');
      return;
    }
  }

  if (action === 'clip_to_custom') {
    const min = parseFloat(document.getElementById(`clip-min-${cardId}`)?.value);
    const max = parseFloat(document.getElementById(`clip-max-${cardId}`)?.value);
    if (isNaN(min) || isNaN(max)) {
      window.showToast('Please enter valid min and max bounds', 'error');
      return;
    }
    clipBounds = { min, max };
  }

  try {
    const res = await fetch(`/api/sheet/${encodeURIComponent(sheet)}/outlier-decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ column, action, custom_note: customNote, clip_bounds: clipBounds })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    // Animate the card right away
    const card = document.getElementById(`card-${cardId}`);
    if (card) {
      card.classList.remove('pending');
      card.classList.add('decided', 'just-decided');
      const badge = card.querySelector('.badge');
      if (badge) { badge.className = 'badge success'; badge.textContent = 'Decided'; }
      // After the pulse, fade the card to muted
      setTimeout(function() {
        card.classList.remove('just-decided');
        card.classList.add('fade-decided');
      }, 500);
    }

    const actionLabels = {
      keep: 'Keep as-is',
      flag_only: 'Flag only',
      clip_to_domain: 'Clip to domain',
      clip_to_custom: 'Clip to custom bounds',
      remove: 'Remove',
      custom: 'Custom'
    };
    window.showToast(
      'Decision saved: ' + (actionLabels[action] || action) + ' for ' + column,
      'success'
    );

    // Update local state
    const data = window._alpine();
    if (data) {
      const [config, manifest] = await Promise.all([
        fetch(`/api/sheet/${encodeURIComponent(sheet)}/config`).then(r => r.json()),
        fetch('/api/manifest').then(r => r.json())
      ]);
      data.sheetConfigs[sheet] = config;
      // Normalize manifest
      if (manifest.sheets) {
        manifest.sheets = manifest.sheets.map(s => ({ ...s, name: s.name || s.sheet }));
      }
      manifest.outlier_groups_pending = manifest.outlier_groups_pending ?? manifest.total_outlier_groups_pending ?? 0;
      manifest.escalation_count = manifest.escalation_count ?? manifest.total_escalations_pending ?? 0;
      data.manifest = manifest;
    }
  } catch (e) {
    window.showToast('Failed to save: ' + e.message, 'error');
  }
};
