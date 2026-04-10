/**
 * Per-sheet detail view
 */
window.renderSheetDetail = function(app, _expandedTrigger) {
  const name = app.currentSheet;
  if (!name) return '';
  const stats = app.sheetStats[name];
  const config = app.sheetConfigs[name];
  if (!stats && !config) return '<div class="empty-state"><div class="icon">&#128196;</div><p>Loading sheet data...</p></div>';

  const sheetConfig = config?.[name] || config?.sheets?.[name] || config || {};
  const kind = stats?.kind || sheetConfig?.kind || '—';
  const manifestSheet = app.manifest?.sheets?.find(s => s.name === name);
  const nRows = stats?.rows || stats?.n_rows || (stats?.shape && stats.shape[0]) || sheetConfig?.n_rows || manifestSheet?.n_rows || 0;
  const entityKey = stats?.entity_key || sheetConfig?.entity_key || '—';

  let html = `
    <div class="sheet-header">
      <h2 class="page-title">${name}</h2>
      <span class="sheet-kind-badge ${kind}">${kind.replace(/_/g, ' ')}</span>
    </div>
    <p class="page-subtitle">
      ${nRows.toLocaleString()} rows &bull; Entity key: <code>${entityKey}</code>
      ${sheetConfig?.time_key ? ` &bull; Time key: <code>${sheetConfig.time_key}</code>` : ''}
    </p>`;

  // Column inventory table
  html += renderColumnTable(app, name, stats, sheetConfig);

  // Issues (includes what were previously "escalations" — all merged into issues)
  const issues = sheetConfig?.issues || [];
  if (issues.length > 0) {
    html += renderSheetIssues(name, issues);
  }

  // Proposals
  const proposals = sheetConfig?.proposals || [];
  if (proposals.length > 0) {
    html += renderProposals(proposals);
  }

  // Fragments
  const fragments = sheetConfig?.fragments;
  if (fragments && Object.keys(fragments).length > 0) {
    html += `<div class="card"><div class="card-title">Fragments</div>`;
    for (const [fragName, fragData] of Object.entries(fragments)) {
      html += `<div style="margin-bottom:8px"><strong>${fragName}</strong>: `;
      if (fragData.source) html += `source=<code>${fragData.source}</code> `;
      if (fragData.columns) html += `columns=[${fragData.columns.join(', ')}] `;
      if (fragData.exported_to) html += `exported to ${fragData.exported_to.length} sheets`;
      html += `</div>`;
    }
    html += `</div>`;
  }

  // Timeseries (adherence buckets)
  if (sheetConfig?.timeseries?.adherence_buckets_observed) {
    html += renderAdherenceBuckets(sheetConfig.timeseries);
  }

  return html;
};


function renderColumnTable(app, sheetName, stats, config) {
  // Build a unified column list from stats
  const columns = [];
  const typeGroups = ['continuous', 'ordered_categorical', 'unordered_categorical', 'multi_label', 'datetime', 'id', 'text'];

  for (const tg of typeGroups) {
    const group = stats?.[tg];
    if (!group) continue;
    for (const [colName, colStats] of Object.entries(group)) {
      columns.push({ name: colName, type: tg, stats: colStats });
    }
  }

  if (columns.length === 0) {
    return '<div class="card"><div class="card-title">Columns</div><p>No column data available.</p></div>';
  }

  let html = `
    <div class="card">
      <div class="card-title">Columns (${columns.length})</div>
      <table class="data-table">
        <thead>
          <tr>
            <th></th>
            <th>Column</th>
            <th>Type</th>
            <th class="num">N</th>
            <th class="num">Missing</th>
            <th class="num">Key Stat</th>
          </tr>
        </thead>
        <tbody>`;

  for (const col of columns) {
    const key = `${sheetName}::${col.name}`;
    const expanded = app.isExpanded(key);
    const s = col.stats;
    const missPct = s.missing_rate != null ? app.pct(s.missing_rate) :
                    (s.missing_count != null && s.n ? app.pct(s.missing_count / s.n) : '—');
    let keyStat = '—';
    if (col.type === 'continuous') {
      keyStat = s.outlier_count != null ? `${s.outlier_count} outliers` : '—';
    } else if (col.type.includes('categorical')) {
      keyStat = `${s.cardinality || s.n_unique || '—'} levels`;
    } else if (col.type === 'multi_label') {
      keyStat = `${s.token_set_size || '—'} tokens`;
    } else if (col.type === 'id') {
      keyStat = `${s.unique || s.n_unique || '—'} unique`;
    }

    const typeBadge = col.type.replace('unordered_categorical', 'categorical')
                              .replace('ordered_categorical', 'categorical');

    html += `
          <tr onclick="window._alpineToggle('${key}')"
              style="cursor:pointer">
            <td><span class="arrow" style="font-size:10px;display:inline-block;transform:rotate(${expanded ? 90 : 0}deg);transition:transform 0.2s">&#9654;</span></td>
            <td><strong>${col.name}</strong></td>
            <td><span class="type-badge ${typeBadge}">${col.type.replace(/_/g, ' ')}</span></td>
            <td class="num">${(s.n || 0).toLocaleString()}</td>
            <td class="num">${missPct}</td>
            <td class="num">${keyStat}</td>
          </tr>`;

    if (expanded) {
      html += `<tr><td colspan="6" style="padding:0 12px 16px 40px;background:#f8fafc">`;
      html += renderColumnDetail(col, config);
      html += `</td></tr>`;
    }
  }

  html += `</tbody></table></div>`;
  return html;
}


function renderColumnDetail(col, config) {
  const s = col.stats;
  let html = '<div style="padding-top:12px">';

  if (col.type === 'continuous') {
    html += `<div class="stat-cards"><div class="card" style="margin-bottom:0">`;
    const pairs = [
      ['Mean', s.mean?.toFixed(3)],
      ['Median', s.median?.toFixed(3)],
      ['Std', s.std?.toFixed(3)],
      ['Min', s.min],
      ['Q1', s.Q1],
      ['Q3', s.Q3],
      ['Max', s.max],
      ['IQR', s.IQR?.toFixed(3)],
      ['Skew', s.skew?.toFixed(3)],
      ['Unique', s.n_unique],
    ];
    for (const [label, val] of pairs) {
      html += `<div class="stat-mini"><span class="label">${label}</span><span class="value">${val ?? '—'}</span></div>`;
    }

    if (s.outlier_count != null) {
      html += `<div style="margin-top:12px;padding-top:8px;border-top:1px solid var(--border)">`;
      html += `<div class="stat-mini"><span class="label">Outlier Fence</span><span class="value">[${s.outlier_lower?.toFixed(2)}, ${s.outlier_upper?.toFixed(2)}]</span></div>`;
      html += `<div class="stat-mini"><span class="label">Outlier Count</span><span class="value">${s.outlier_count} (${(s.outlier_rate * 100).toFixed(1)}%)</span></div>`;
      if (s.tukey_suppressed) {
        html += `<div class="note-box" style="margin-top:8px">Tukey fence suppressed: ${s.tukey_note || 'discrete or highly skewed'}</div>`;
      }
      html += `</div>`;
    }

    // Domain limits from config
    const sheetKey = Object.keys(config || {})[0];
    const colConfig = config?.[sheetKey]?.columns?.[col.name];
    if (colConfig?.domain_limits || s.domain_limits) {
      const dl = colConfig?.domain_limits || s.domain_limits;
      html += `<div class="stat-mini"><span class="label">Domain Limits</span><span class="value">[${dl.min}, ${dl.max}]${dl.units ? ' ' + dl.units : ''}</span></div>`;
    }

    // Units
    if (s.units || colConfig?.units) {
      html += `<div class="stat-mini"><span class="label">Units</span><span class="value">${s.units || colConfig?.units}</span></div>`;
    }

    // Typical outliers
    if (s.typical_outliers && s.typical_outliers.length > 0) {
      html += `<div style="margin-top:8px"><span style="font-size:12px;color:var(--text-muted)">Typical outlier values:</span>`;
      html += `<div class="typical-values">`;
      for (const v of s.typical_outliers) {
        html += `<span class="val">${v}</span>`;
      }
      html += `</div></div>`;
    }

    // Box plot (Plotly)
    const boxId = `plotly-box-${col.name.replace(/[^a-zA-Z0-9]/g, '_')}`;
    const domainLimits = colConfig?.domain_limits || s.domain_limits;
    let boxAttrs = `data-plotly-type="box" data-min="${s.min}" data-q1="${s.Q1}" data-median="${s.median}" data-q3="${s.Q3}" data-max="${s.max}" data-lower="${s.outlier_lower}" data-upper="${s.outlier_upper}"`;
    if (domainLimits) {
      boxAttrs += ` data-domain-min="${domainLimits.min}" data-domain-max="${domainLimits.max}"`;
    }
    html += `<div style="margin-top:12px"><div id="${boxId}" class="plotly-chart-box" ${boxAttrs}></div></div>`;

    html += `</div></div>`;

  } else if (col.type.includes('categorical')) {
    html += `<div class="card" style="margin-bottom:0">`;
    html += `<div class="stat-mini"><span class="label">Cardinality</span><span class="value">${s.cardinality || s.n_unique || '—'}</span></div>`;
    if (s.top_values || s.top_5_values) {
      const top = s.top_values || s.top_5_values;
      const topEntries = Object.entries(top).slice(0, 10);
      const pieId = `plotly-pie-${col.name.replace(/[^a-zA-Z0-9]/g, '_')}`;
      const pieData = JSON.stringify(Object.entries(top));

      html += `<div style="margin-top:8px;display:flex;gap:20px;flex-wrap:wrap;align-items:flex-start">`;

      // Top values table
      html += `<div style="flex:1;min-width:200px"><span style="font-size:12px;color:var(--text-muted)">Top values:</span>`;
      html += `<table class="data-table" style="margin-top:4px">`;
      for (const [val, count] of topEntries) {
        const pct = s.n ? ((count / s.n) * 100).toFixed(1) + '%' : '';
        html += `<tr><td class="mono">${val}</td><td class="num">${count.toLocaleString()}</td><td class="num">${pct}</td></tr>`;
      }
      html += `</table></div>`;

      // Pie chart
      html += `<div style="flex:0 0 auto"><div id="${pieId}" class="plotly-chart-pie" data-plotly-type="pie" data-values='${pieData.replace(/'/g, "&#39;")}'></div></div>`;

      html += `</div>`;
    }

    // Ordered bar chart for ordered_categorical
    if (col.type === 'ordered_categorical') {
      const barId = `plotly-bar-${col.name.replace(/[^a-zA-Z0-9]/g, '_')}`;
      // Use level_order if available, otherwise use top_values order
      let barEntries;
      if (s.level_order && (s.top_values || s.top_5_values)) {
        const vals = s.top_values || s.top_5_values;
        barEntries = s.level_order.map(lv => [lv, vals[lv] || 0]);
      } else if (s.levels && (s.top_values || s.top_5_values)) {
        const vals = s.top_values || s.top_5_values;
        barEntries = s.levels.map(lv => [lv, vals[lv] || 0]);
      } else if (s.top_values || s.top_5_values) {
        barEntries = Object.entries(s.top_values || s.top_5_values);
      }
      if (barEntries && barEntries.length > 0) {
        const barData = JSON.stringify(barEntries);
        html += `<div style="margin-top:12px"><span style="font-size:12px;color:var(--text-muted)">Level distribution (ordered):</span>`;
        html += `<div id="${barId}" class="plotly-chart-bar" data-plotly-type="bar-ordered" data-values='${barData.replace(/'/g, "&#39;")}'></div></div>`;
      }
    }

    if (s.levels) {
      html += `<div style="margin-top:8px"><span style="font-size:12px;color:var(--text-muted)">Levels:</span> <span class="mono">${s.levels.join(', ')}</span></div>`;
    }
    html += `</div>`;

  } else if (col.type === 'multi_label') {
    html += `<div class="card" style="margin-bottom:0">`;
    html += `<div class="stat-mini"><span class="label">Token set size</span><span class="value">${s.token_set_size || '—'}</span></div>`;
    html += `<div class="stat-mini"><span class="label">Avg tokens/row</span><span class="value">${s.avg_tokens_per_row?.toFixed(2) || '—'}</span></div>`;
    html += `<div class="stat-mini"><span class="label">Separator</span><span class="value mono">${s.separator || '—'}</span></div>`;
    if (s.top_tokens) {
      const tokenEntries = Object.entries(s.top_tokens).slice(0, 15);

      html += `<div style="margin-top:8px;display:flex;gap:20px;flex-wrap:wrap;align-items:flex-start">`;

      // Token table
      html += `<div style="flex:1;min-width:200px"><span style="font-size:12px;color:var(--text-muted)">Top tokens:</span>`;
      html += `<table class="data-table" style="margin-top:4px">`;
      for (const [tok, count] of tokenEntries.slice(0, 10)) {
        html += `<tr><td class="mono">${tok}</td><td class="num">${count.toLocaleString()}</td></tr>`;
      }
      html += `</table></div>`;

      // Token bar chart
      const barTokenId = `plotly-tokens-${col.name.replace(/[^a-zA-Z0-9]/g, '_')}`;
      const barTokenData = JSON.stringify(tokenEntries);
      html += `<div style="flex:1;min-width:280px"><span style="font-size:12px;color:var(--text-muted)">Token frequency:</span>`;
      html += `<div id="${barTokenId}" class="plotly-chart-bar" data-plotly-type="bar-tokens" data-values='${barTokenData.replace(/'/g, "&#39;")}'></div></div>`;

      html += `</div>`;
    }
    html += `</div>`;

  } else if (col.type === 'datetime') {
    html += `<div class="card" style="margin-bottom:0">`;
    html += `<div class="stat-mini"><span class="label">Range</span><span class="value mono">${s.min || '—'} .. ${s.max || '—'}</span></div>`;
    if (s.sentinel_count) {
      html += `<div class="stat-mini"><span class="label">Sentinel dates</span><span class="value">${s.sentinel_count}</span></div>`;
    }
    html += `</div>`;

  } else if (col.type === 'id') {
    html += `<div class="card" style="margin-bottom:0">`;
    html += `<div class="stat-mini"><span class="label">Unique</span><span class="value">${s.unique || s.n_unique || '—'}</span></div>`;
    html += `<div class="stat-mini"><span class="label">Duplicates</span><span class="value">${s.duplicates || 0}</span></div>`;
    html += `</div>`;

  } else if (col.type === 'text') {
    html += `<div class="card" style="margin-bottom:0">`;
    html += `<div class="stat-mini"><span class="label">Unique</span><span class="value">${s.n_unique || s.unique || '—'}</span></div>`;
    if (s.avg_length != null) {
      html += `<div class="stat-mini"><span class="label">Avg length</span><span class="value">${s.avg_length?.toFixed?.(1) || s.avg_length}</span></div>`;
    }
    // Show sample values
    const samples = s.sample_values || s.typical_values || (s.top_values ? Object.keys(s.top_values).slice(0, 5) : null);
    if (samples && samples.length > 0) {
      html += `<div style="margin-top:8px"><span style="font-size:12px;color:var(--text-muted)">Sample values:</span>`;
      html += `<div class="typical-values">`;
      for (const v of samples.slice(0, 5)) {
        const display = String(v).length > 40 ? String(v).slice(0, 40) + '...' : v;
        html += `<span class="val">${display}</span>`;
      }
      html += `</div></div>`;
    }
    html += `</div>`;
  }

  html += '</div>';
  return html;
}


/**
 * Render issues inline in the sheet detail view.
 * Reuses renderIssueCard() from issues.js — the same cards, same interactions.
 * Issues in the sheet view and the Issues nav view are the SAME linked data.
 */
function renderSheetIssues(sheetName, issues) {
  const pendingCount = issues.filter(i => !i.resolved).length;

  let html = `<div class="card"><div class="card-title">Issues (${issues.length})</div>`;
  if (pendingCount > 0) {
    html += `<p style="font-size:13px;color:var(--text-muted);margin-bottom:16px">${pendingCount} item${pendingCount !== 1 ? 's' : ''} need${pendingCount === 1 ? 's' : ''} your input. You can also review all issues across sheets in the <a href="#/issues" style="color:var(--accent)">Issues</a> tab.</p>`;
  }

  for (const issue of issues) {
    if (!issue || typeof issue !== 'object') continue;
    // renderIssueCard is defined in issues.js and is globally available
    if (typeof window.renderIssueCardFn === 'function') {
      html += window.renderIssueCardFn({ sheet: sheetName, ...issue, resolved: !!issue.resolved });
    } else {
      // Fallback: simple display
      const resolved = !!issue.resolved;
      const title = issue.title || (issue.id ? issue.id.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : 'Issue');
      const badge = resolved ? '<span class="badge success">Accepted</span>' : '<span class="badge warn">Pending</span>';
      html += `
        <div class="issue-card ${resolved ? 'issue-resolved' : 'issue-pending'}" style="margin-bottom:12px">
          <div style="display:flex;justify-content:space-between"><div class="issue-title">${title}</div>${badge}</div>
          ${issue.description ? `<div class="issue-desc">${issue.description}</div>` : ''}
          ${issue.user_comment ? `<div style="margin-top:6px;font-size:13px;color:var(--text-muted)">Comment: ${issue.user_comment}</div>` : ''}
        </div>`;
    }
  }

  html += `</div>`;
  return html;
}


function renderProposals(proposals) {
  let html = `<div class="card"><div class="card-title">Fix Proposals (${proposals.length})</div>`;
  html += `<table class="data-table"><thead><tr><th>Column</th><th>Issue</th><th>Default</th><th>Confidence</th></tr></thead><tbody>`;
  for (const p of proposals) {
    const confBadge = p.confidence === 'high' ? '<span class="badge danger">high</span>'
                    : p.confidence === 'medium' ? '<span class="badge warn">medium</span>'
                    : '<span class="badge">low</span>';
    html += `<tr>
      <td class="mono">${p.column || '—'}</td>
      <td>${p.issue || p.diagnosis || '—'}</td>
      <td>${p.default_action || '—'}</td>
      <td>${confBadge}</td>
    </tr>`;
  }
  html += `</tbody></table></div>`;
  return html;
}


function renderAdherenceBuckets(ts) {
  const buckets = ts.adherence_buckets_observed;
  if (!buckets) return '';
  let html = `<div class="card"><div class="card-title">Adherence Buckets</div>`;
  html += `<table class="data-table"><thead><tr><th>Bucket</th><th class="num">Count</th></tr></thead><tbody>`;
  for (const [bucket, count] of Object.entries(buckets)) {
    html += `<tr><td>${bucket}</td><td class="num">${count.toLocaleString()}</td></tr>`;
  }
  html += `</tbody></table>`;
  if (ts.adherence_formula) {
    html += `<div style="margin-top:8px;font-size:12px;color:var(--text-muted)">Formula: <code>${ts.adherence_formula}</code></div>`;
  }
  html += `</div>`;
  return html;
}
