/**
 * Relationships view — focused on overall dataset structure
 * Shows hub-and-spoke around the primary key (e.g., 患者id)
 */
window.renderRelationships = function(app) {
  const rel = app.relationships;
  if (!rel) return '<div class="empty-state"><div class="icon">&#128279;</div><p>Loading relationships...</p></div>';

  const sheets = rel.sheets || {};
  const edges = rel.edges || [];
  const joinKeys = rel.join_keys || [];
  const primaryKey = joinKeys[0]?.key || '患者id';

  // Identify primary sheets (1 row per entity) and secondary sheets
  const primarySheets = [];
  const secondarySheets = [];
  for (const [name, info] of Object.entries(sheets)) {
    const rowsPerEntity = info.n_unique > 0 ? info.n_rows / info.n_unique : 0;
    const entry = { name, ...info, rowsPerEntity: rowsPerEntity };
    if (info.role === 'primary' || (info.n_unique && rowsPerEntity <= 1.05)) {
      primarySheets.push(entry);
    } else {
      secondarySheets.push(entry);
    }
  }

  let html = `
    <h2 class="page-title">Dataset Structure</h2>
    <p class="page-subtitle">${Object.keys(sheets).length} sheets linked by <code>${primaryKey}</code></p>`;

  // Primary key info card
  html += `
    <div class="card" style="background:#eff6ff;border-color:#bfdbfe">
      <div style="font-weight:600;font-size:16px;margin-bottom:8px">Primary Key: <code style="font-size:16px">${primaryKey}</code></div>
      <div style="display:flex;gap:24px;flex-wrap:wrap;font-size:14px">
        <div><strong>${primarySheets.length}</strong> reference sheet${primarySheets.length > 1 ? 's' : ''} (1 row per entity)</div>
        <div><strong>${secondarySheets.length}</strong> data sheet${secondarySheets.length > 1 ? 's' : ''} (multiple rows per entity)</div>
        <div><strong>${primarySheets[0]?.n_unique?.toLocaleString() || '?'}</strong> unique entities</div>
      </div>
    </div>`;

  // Reference sheets (1:1 with entities)
  if (primarySheets.length > 0) {
    html += `
    <div class="card">
      <div class="card-title">Reference Sheets <span style="font-size:13px;font-weight:400;color:var(--text-muted)">&mdash; one row per ${primaryKey}</span></div>
      <table class="data-table">
        <thead><tr>
          <th>Sheet</th><th>Kind</th>
          <th class="num">Rows</th><th class="num">Unique Entities</th>
          <th class="num">Columns</th>
          <th>Relationship</th>
        </tr></thead><tbody>`;

    for (const s of primarySheets) {
      const mSheet = app.manifest?.sheets?.find(ms => ms.name === s.name);
      html += `
        <tr onclick="location.hash='/sheet/${encodeURIComponent(s.name)}'" style="cursor:pointer">
          <td><strong>${s.name}</strong></td>
          <td><span class="sheet-kind-badge ${s.kind || ''}">${(s.kind || '—').replace(/_/g, ' ')}</span></td>
          <td class="num">${(s.n_rows || 0).toLocaleString()}</td>
          <td class="num">${(s.n_unique || 0).toLocaleString()}</td>
          <td class="num">${mSheet?.n_cols || '—'}</td>
          <td><span class="rel-type one-one">1:1</span> with ${primaryKey}</td>
        </tr>`;
    }
    html += `</tbody></table></div>`;
  }

  // Data sheets (1:N or N:M with entities)
  if (secondarySheets.length > 0) {
    // Sort by rows/entity desc
    secondarySheets.sort((a, b) => (b.rowsPerEntity || 0) - (a.rowsPerEntity || 0));

    html += `
    <div class="card">
      <div class="card-title">Data Sheets <span style="font-size:13px;font-weight:400;color:var(--text-muted)">&mdash; multiple rows per ${primaryKey}</span></div>
      <table class="data-table">
        <thead><tr>
          <th>Sheet</th><th>Kind</th>
          <th class="num">Rows</th><th class="num">Unique Entities</th>
          <th class="num">Rows / Entity</th>
          <th class="num">Coverage</th>
          <th>Relationship</th>
        </tr></thead><tbody>`;

    for (const s of secondarySheets) {
      // Find coverage relative to primary sheet
      const edge = edges.find(e =>
        (primarySheets.some(p => p.name === e.a) && e.b === s.name) ||
        (primarySheets.some(p => p.name === e.b) && e.a === s.name)
      );
      const coverage = edge?.coverage || 0;
      const covColor = coverage >= 0.95 ? 'var(--green)' : coverage >= 0.5 ? 'var(--orange)' : 'var(--red)';
      const mSheet = app.manifest?.sheets?.find(ms => ms.name === s.name);

      html += `
        <tr onclick="location.hash='/sheet/${encodeURIComponent(s.name)}'" style="cursor:pointer">
          <td><strong>${s.name}</strong></td>
          <td><span class="sheet-kind-badge ${s.kind || ''}">${(s.kind || '—').replace(/_/g, ' ')}</span></td>
          <td class="num">${(s.n_rows || 0).toLocaleString()}</td>
          <td class="num">${(s.n_unique || 0).toLocaleString()}</td>
          <td class="num"><strong>${s.rowsPerEntity.toFixed(1)}</strong></td>
          <td class="num">
            <span style="font-weight:600;color:${covColor}">${(coverage * 100).toFixed(1)}%</span>
            <div class="coverage-bar" style="width:80px;display:inline-block;vertical-align:middle;margin-left:6px">
              <div class="fill" style="width:${coverage * 100}%;background:${covColor}"></div>
            </div>
          </td>
          <td><span class="rel-type one-n">1:N</span> <span style="font-size:12px;color:var(--text-muted)">avg ${s.rowsPerEntity.toFixed(1)} rows/entity</span></td>
        </tr>`;
    }
    html += `</tbody></table></div>`;
  }

  // D3 hub-and-spoke graph
  html += `
    <div class="card">
      <div class="card-title">Structure Graph</div>
      <div id="rel-graph"></div>
    </div>`;

  // Schedule graph render after DOM update
  setTimeout(() => renderHubGraph(primaryKey, primarySheets, secondarySheets, edges, sheets), 50);

  return html;
};


function renderHubGraph(primaryKey, primarySheets, secondarySheets, edges, allSheets) {
  const container = document.getElementById('rel-graph');
  if (!container) return;
  container.innerHTML = '';

  const width = container.clientWidth || 800;
  const height = 450;

  const svg = d3.select(container)
    .append('svg')
    .attr('width', width)
    .attr('height', height);

  // Central hub node
  const nodes = [{ id: primaryKey, type: 'key', radius: 30 }];

  // Sheet nodes
  const allEntries = [...primarySheets.map(s => ({ ...s, group: 'primary' })),
                      ...secondarySheets.map(s => ({ ...s, group: 'secondary' }))];
  for (const s of allEntries) {
    nodes.push({
      id: s.name,
      type: 'sheet',
      group: s.group,
      kind: s.kind,
      nRows: s.n_rows,
      rowsPerEntity: s.rowsPerEntity || 1,
      radius: Math.max(20, Math.log10(s.n_rows || 1) * 10)
    });
  }

  // Links from key to sheets
  const links = allEntries.map(s => {
    const edge = edges.find(e =>
      (primarySheets.some(p => p.name === e.a) && e.b === s.name) ||
      (primarySheets.some(p => p.name === e.b) && e.a === s.name) ||
      e.a === s.name || e.b === s.name
    );
    return {
      source: primaryKey,
      target: s.name,
      coverage: edge?.coverage || 1,
      group: s.group
    };
  });

  const kindColor = {
    wide_snapshot: '#3b82f6',
    wide_snapshot_repeated: '#f97316',
    long_timeseries: '#22c55e',
    long_timeseries_borderline: '#22c55e',
    id_list: '#a78bfa',
    lookup_table: '#94a3b8'
  };

  const simulation = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(links).id(d => d.id).distance(d => d.group === 'primary' ? 100 : 150))
    .force('charge', d3.forceManyBody().strength(-400))
    .force('center', d3.forceCenter(width / 2, height / 2))
    .force('collision', d3.forceCollide().radius(d => d.radius + 15));

  const link = svg.append('g')
    .selectAll('line')
    .data(links)
    .join('line')
    .attr('stroke', d => {
      if (d.coverage >= 0.95) return '#22c55e';
      if (d.coverage >= 0.5) return '#f97316';
      return '#ef4444';
    })
    .attr('stroke-width', d => Math.max(1.5, d.coverage * 4))
    .attr('stroke-opacity', 0.6)
    .attr('stroke-dasharray', d => d.group === 'primary' ? 'none' : '6,3');

  const nodeG = svg.append('g')
    .selectAll('g')
    .data(nodes)
    .join('g')
    .call(d3.drag()
      .on('start', (e, d) => { if (!e.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
      .on('drag', (e, d) => { d.fx = e.x; d.fy = e.y; })
      .on('end', (e, d) => { if (!e.active) simulation.alphaTarget(0); d.fx = null; d.fy = null; })
    );

  // Hub node (primary key)
  nodeG.filter(d => d.type === 'key')
    .append('circle')
    .attr('r', 30)
    .attr('fill', '#1e40af')
    .attr('fill-opacity', 0.9)
    .attr('stroke', '#fff')
    .attr('stroke-width', 3);

  nodeG.filter(d => d.type === 'key')
    .append('text')
    .text(d => d.id)
    .attr('text-anchor', 'middle')
    .attr('dy', '0.35em')
    .attr('fill', '#fff')
    .attr('font-size', '11px')
    .attr('font-weight', '700');

  // Sheet nodes
  nodeG.filter(d => d.type === 'sheet')
    .append('circle')
    .attr('r', d => d.radius)
    .attr('fill', d => kindColor[d.kind] || '#94a3b8')
    .attr('fill-opacity', 0.15)
    .attr('stroke', d => kindColor[d.kind] || '#94a3b8')
    .attr('stroke-width', 2);

  nodeG.filter(d => d.type === 'sheet')
    .append('text')
    .text(d => d.id)
    .attr('text-anchor', 'middle')
    .attr('dy', '0.35em')
    .attr('font-size', '11px')
    .attr('font-weight', '600');

  // Link labels showing rows/entity
  const linkLabel = svg.append('g')
    .selectAll('text')
    .data(links)
    .join('text')
    .text(d => {
      const sheet = allEntries.find(s => s.name === d.target);
      if (!sheet) return '';
      return sheet.group === 'primary' ? '1:1' : `1:${Math.round(sheet.rowsPerEntity || 1)}`;
    })
    .attr('font-size', '10px')
    .attr('fill', '#64748b')
    .attr('text-anchor', 'middle');

  simulation.on('tick', () => {
    link
      .attr('x1', d => d.source.x)
      .attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x)
      .attr('y2', d => d.target.y);

    nodeG.attr('transform', d => `translate(${d.x},${d.y})`);

    linkLabel
      .attr('x', d => (d.source.x + d.target.x) / 2)
      .attr('y', d => (d.source.y + d.target.y) / 2 - 6);
  });

  // Tooltip on hover
  nodeG.filter(d => d.type === 'sheet')
    .append('title')
    .text(d => `${d.id}\n${(d.nRows || 0).toLocaleString()} rows\n${d.rowsPerEntity?.toFixed(1) || '?'} rows/entity\nKind: ${(d.kind || '—').replace(/_/g, ' ')}`);
}
