/**
 * Issues view — interactive cards for questions/uncertainties from the analysis agent.
 * Each issue clearly explains what the agent found, what it proposes to do, and lets
 * the user accept, reject, or comment.
 */
window.renderIssues = function(app) {
  if (!app.manifest) return '<div class="empty-state"><div class="icon">&#128270;</div><p>Loading...</p></div>';

  // Collect all issues across all sheets
  const allIssues = [];
  for (const sheetInfo of app.manifest.sheets) {
    const config = app.sheetConfigs[sheetInfo.name];
    if (!config) continue;
    const sheetConfig = config[sheetInfo.name] || config?.sheets?.[sheetInfo.name] || config;
    const issues = sheetConfig?.issues || [];
    for (const issue of issues) {
      if (!issue || typeof issue !== 'object') continue;
      allIssues.push({ sheet: sheetInfo.name, ...issue, resolved: !!issue.resolved });
    }
  }

  let filtered = allIssues;
  if (app.issuesSheetFilter !== 'all') {
    filtered = filtered.filter(g => g.sheet === app.issuesSheetFilter);
  }

  const pendingCount = allIssues.filter(g => !g.resolved).length;
  const resolvedCount = allIssues.filter(g => g.resolved).length;
  const sheetNames = [...new Set(allIssues.map(g => g.sheet))];

  let html = `
    <h2 class="page-title">Issues &amp; Questions</h2>
    <p class="page-subtitle">${allIssues.length} items across ${sheetNames.length} sheet${sheetNames.length !== 1 ? 's' : ''} &bull;
      <span style="color:var(--orange)">${pendingCount} pending</span> &bull;
      <span style="color:var(--green)">${resolvedCount} resolved</span>
    </p>`;

  if (pendingCount > 0) {
    html += `
    <div class="card" style="background:#fffbeb;border-color:#fbbf24;margin-bottom:20px">
      <div style="font-weight:600;margin-bottom:4px">Review Required</div>
      <div style="font-size:13px;color:#92400e">
        The analysis agent flagged these items because it needs your input or wants to confirm its understanding.
        For each item, read the description, then <strong>Accept</strong> the proposed action, <strong>Reject</strong> it (the agent will skip this action), or add a <strong>Comment</strong> with your instructions.
      </div>
    </div>`;
  }

  html += `
    <div class="filter-bar">
      <select onchange="updateIssuesSheetFilter(this.value)">
        <option value="all" ${app.issuesSheetFilter === 'all' ? 'selected' : ''}>All sheets</option>
        ${sheetNames.map(n => `<option value="${n}" ${app.issuesSheetFilter === n ? 'selected' : ''}>${n}</option>`).join('')}
      </select>
    </div>`;

  if (filtered.length === 0) {
    html += '<div class="empty-state"><div class="icon">&#10004;</div><p>No issues found.</p></div>';
    return html;
  }

  for (const issue of filtered) {
    html += renderIssueCard(issue);
  }

  return html;
};


// Human-readable descriptions for known action types
const ACTION_DESCRIPTIONS = {
  drop: 'Drop (remove) these columns entirely from the dataset. They will not appear in the final output.',
  drop_all_null: 'Drop these columns because every value is null/empty. No data would be lost.',
  drop_from_tensor: 'Exclude these columns from the final tensor output, but keep them in intermediate data for reference.',
  rename: 'Rename these columns to fix naming inconsistencies (e.g., removing duplicate prefixes or standardizing delimiters).',
  parse_range_to_numeric: 'Parse text ranges like "100-200" into numeric values (using the midpoint or lower bound). Currently these are stored as text strings.',
  null_text_tail: 'Replace rare text values that appear only once or twice with null. These are likely typos or free-text entries in what should be a categorical column.',
  flag_only: 'Flag these values for review but do not modify them. An _is_flagged column will be added.',
  keep: 'Keep these values as-is. No modification.',
  clip_to_domain: 'Clip values to the specified domain limits. Values outside the domain will be capped to the min/max boundary.',
  remap_to_continuous: 'Convert ordinal/coded values to a continuous numeric scale using a mapping table.',
  remap_to_categorical: 'Convert numeric codes to named categories using a mapping table.',
  split_column: 'Split this column into multiple columns (e.g., splitting a combined field into its components).',
  merge_columns: 'Merge multiple related columns into a single column.',
  aggregate: 'Aggregate the values in these columns (e.g., sum, mean) into fewer summary columns.',
};

function describeAction(action, cols) {
  if (!action) return '';
  const desc = ACTION_DESCRIPTIONS[action];
  if (desc) return desc;
  // Fallback: humanize the action name
  return action.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) + '.';
}


function renderIssueCard(issue) {
  const cardId = `issue-${issue.sheet}-${issue.id}`.replace(/[^a-zA-Z0-9_-]/g, '_');
  const stateClass = issue.resolved ? 'issue-resolved' : 'issue-pending';

  const userAction = issue.user_action || (issue.resolved ? 'resolved' : null);
  const badgeMap = {
    accepted: '<span class="badge success">Accepted</span>',
    commented: '<span class="badge" style="background:var(--accent);color:#fff">Commented</span>',
    resolved: '<span class="badge success">Resolved</span>',
  };
  const badge = badgeMap[userAction] || '<span class="badge warn">Needs Your Input</span>';

  const hasOptions = Array.isArray(issue.options) && issue.options.length > 0;
  const issueType = issue.type || (hasOptions ? 'multichoice' : 'info');

  // Build a clear title
  const title = issue.title
    || (issue.id ? issue.id.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : 'Issue');

  let html = `
    <div class="issue-card ${stateClass}" id="${cardId}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div class="issue-title">${title}</div>
        ${badge}
      </div>
      <div class="issue-meta">
        Sheet: <strong>${issue.sheet}</strong>
        ${issue.confidence ? ' &bull; Confidence: <strong>' + issue.confidence + '</strong>' : ''}
      </div>`;

  // Show affected columns
  if (issue.cols && issue.cols.length > 0) {
    const showCols = issue.cols.slice(0, 6);
    const moreCols = issue.cols.length > 6 ? ` +${issue.cols.length - 6} more` : '';
    html += `<div class="issue-cols">Affects ${issue.cols.length} column${issue.cols.length !== 1 ? 's' : ''}: <code>${showCols.join('</code>, <code>')}</code>${moreCols}</div>`;
  }

  // Description — the agent's explanation of what it found
  if (issue.description || issue.notes) {
    html += `<div class="issue-desc">${issue.description || issue.notes}</div>`;
  }

  // Proposed action — clearly describe WHAT the agent will do
  if (issue.action) {
    const actionDesc = describeAction(issue.action, issue.cols);
    html += `
      <div style="margin-top:10px;padding:10px 14px;background:#f0fdf4;border-radius:6px;border:1px solid #bbf7d0">
        <div style="font-weight:600;font-size:13px;color:#166534;margin-bottom:4px">Proposed Action</div>
        <div style="font-size:13px;color:#15803d">${actionDesc}</div>
      </div>`;
  }

  if (!issue.resolved) {
    // Multichoice options
    if (issueType === 'multichoice' && hasOptions) {
      html += `<div style="margin-top:12px;font-weight:600;font-size:13px">Choose one:</div>`;
      html += `<div class="decision-options" id="opts-${cardId}">`;
      for (const opt of issue.options) {
        const optVal = typeof opt === 'string' ? opt : opt.value || opt.label || String(opt);
        const optLabel = typeof opt === 'string' ? opt : opt.label || opt.value || String(opt);
        const optDesc = typeof opt === 'object' && opt.description ? `<div style="font-size:12px;color:var(--text-muted);margin-top:2px">${opt.description}</div>` : '';
        html += `
          <label onclick="selectIssueOption('${cardId}', '${optVal.replace(/'/g, "\\'")}')">
            <input type="radio" name="issue-${cardId}" value="${optVal}">
            <div><strong>${optLabel}</strong>${optDesc}</div>
          </label>`;
      }
      html += `</div>`;
    }

    // Question text input
    if (issueType === 'question') {
      html += `
        <div style="margin-top:12px">
          <div style="font-weight:600;font-size:13px;margin-bottom:4px">Your answer:</div>
          <textarea class="custom-input" id="input-${cardId}" rows="2"
                    placeholder="Type your response..." style="width:100%;resize:vertical"></textarea>
        </div>`;
    }

    // Comment input (always available)
    html += `
      <div style="margin-top:8px">
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:4px">Add a comment (optional):</div>
        <input type="text" class="custom-input" id="comment-${cardId}"
               placeholder="Any additional notes or instructions..." style="width:100%">
      </div>`;

    // Action buttons: Accept / Comment
    html += `
      <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
        <button class="btn btn-primary btn-sm"
                onclick="saveIssueAction('${issue.sheet}', '${issue.id}', '${cardId}', '${issueType}', 'accepted')">
          Accept
        </button>
        <button class="btn btn-sm" style="background:#f1f5f9;color:var(--text)"
                onclick="saveIssueAction('${issue.sheet}', '${issue.id}', '${cardId}', '${issueType}', 'commented')">
          Comment
        </button>
      </div>`;
  } else {
    // Show saved response
    if (issue.user_action) {
      const actionLabel = { accepted: 'Accepted', rejected: 'Rejected', commented: 'Commented' }[issue.user_action] || issue.user_action;
      html += `<div style="margin-top:8px;font-size:13px"><strong>Decision:</strong> ${actionLabel}</div>`;
    }
    if (issue.user_response) {
      html += `<div style="margin-top:4px;font-size:13px;color:var(--text-muted)">Response: <strong>${issue.user_response}</strong></div>`;
    }
    if (issue.user_comment) {
      html += `<div style="margin-top:4px;font-size:13px;color:var(--text-muted)">Comment: ${issue.user_comment}</div>`;
    }
    if (issue.decided_at) {
      html += `<div style="font-size:11px;color:var(--text-muted);margin-top:4px">Resolved: ${issue.decided_at}</div>`;
    }
  }

  html += `</div>`;
  return html;
}


// Expose renderIssueCard globally so sheet-detail.js can reuse the same cards
window.renderIssueCardFn = renderIssueCard;

// Global helpers
window.selectIssueOption = function(cardId, value) {
  const opts = document.getElementById('opts-' + cardId);
  if (!opts) return;
  opts.querySelectorAll('label').forEach(l => l.classList.remove('selected'));
  const radio = opts.querySelector('input[value="' + value + '"]');
  if (radio) {
    radio.checked = true;
    radio.closest('label').classList.add('selected');
  }
};

window.updateIssuesSheetFilter = function(val) {
  const data = window._alpine();
  if (data) data.issuesSheetFilter = val;
};

window.saveIssueAction = async function(sheet, issueId, cardId, issueType, action) {
  let response = null;
  let comment = document.getElementById('comment-' + cardId)?.value?.trim() || null;

  // Get the response value based on issue type
  if (issueType === 'multichoice') {
    const opts = document.getElementById('opts-' + cardId);
    const selected = opts?.querySelector('input[type="radio"]:checked');
    if (selected) response = selected.value;
    // For accept, require a selection; for reject/comment, optional
    if (action === 'accepted' && !response) {
      window.showToast('Please select an option before accepting', 'error');
      return;
    }
  } else if (issueType === 'question') {
    response = document.getElementById('input-' + cardId)?.value?.trim() || null;
    if (action === 'accepted' && !response) {
      window.showToast('Please type a response before accepting', 'error');
      return;
    }
  }

  // For "comment only", require a comment
  if (action === 'commented' && !comment) {
    window.showToast('Please add a comment', 'error');
    return;
  }

  // Build the full response string
  let fullResponse = response || '';
  if (comment) {
    fullResponse = fullResponse ? `${fullResponse} [Comment: ${comment}]` : comment;
  }

  try {
    const res = await fetch(`/api/sheet/${encodeURIComponent(sheet)}/issue-response`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        issue_id: issueId,
        response: fullResponse || action,
        resolved: action !== 'commented',  // "comment only" doesn't resolve
        user_action: action,
        user_comment: comment,
      })
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);

    // Animate the card
    const card = document.getElementById(cardId);
    if (card) {
      if (action !== 'commented') {
        card.classList.remove('issue-pending');
        card.classList.add('issue-resolved', 'just-decided');
      } else {
        card.classList.add('just-decided');
      }
      const badge = card.querySelector('.badge');
      if (badge) {
        const cfg = {
          accepted: { cls: 'badge success', text: 'Accepted' },
          commented: { cls: 'badge', text: 'Commented', bg: 'var(--accent)', color: '#fff' },
        }[action] || { cls: 'badge success', text: 'Resolved' };
        badge.className = cfg.cls;
        badge.textContent = cfg.text;
        if (cfg.bg) { badge.style.background = cfg.bg; badge.style.color = cfg.color; }
      }
      setTimeout(() => card.classList.remove('just-decided'), 500);
    }

    const labels = { accepted: 'Accepted', commented: 'Comment saved' };
    window.showToast(labels[action] || 'Saved', 'success');

    // Reload config and manifest
    const data = window._alpine();
    if (data) {
      const [config, manifest] = await Promise.all([
        fetch(`/api/sheet/${encodeURIComponent(sheet)}/config`).then(r => r.json()),
        fetch('/api/manifest').then(r => r.json())
      ]);
      data.sheetConfigs[sheet] = config;
      if (manifest.sheets) manifest.sheets = manifest.sheets.map(s => ({ ...s, name: s.name || s.sheet }));
      manifest.outlier_groups_pending = manifest.outlier_groups_pending ?? 0;
      manifest.escalation_count = manifest.escalation_count ?? 0;
      manifest.issues_pending = manifest.issues_pending ?? 0;
      data.manifest = manifest;
      data.issuesSheetFilter = data.issuesSheetFilter; // trigger re-render
    }
  } catch (e) {
    window.showToast('Failed to save: ' + e.message, 'error');
  }
};
