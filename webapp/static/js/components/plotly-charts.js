/**
 * Plotly chart renderer for column statistics.
 * Scans for [data-plotly-type] divs and renders the appropriate chart.
 * Called via setTimeout after x-html DOM updates.
 */
window.renderPlotlyCharts = function() {
  document.querySelectorAll('[data-plotly-type]').forEach(div => {
    if (div.dataset.plotlyRendered === 'true') return;
    div.dataset.plotlyRendered = 'true';

    const type = div.dataset.plotlyType;
    try {
      if (type === 'box') renderPlotlyBox(div);
      else if (type === 'pie') renderPlotlyPie(div);
      else if (type === 'bar-ordered') renderPlotlyBarOrdered(div);
      else if (type === 'bar-tokens') renderPlotlyBarTokens(div);
    } catch (e) {
      console.warn('Plotly render error for', div.id, e);
    }
  });
};

const PLOTLY_CONFIG = { responsive: true, displayModeBar: false };

const PLOTLY_COLORS = {
  blue: '#3b82f6',
  blueFill: 'rgba(59,130,246,0.15)',
  red: '#ef4444',
  green: '#22c55e',
  indigo: '#6366f1',
  orange: '#f97316',
  teal: '#14b8a6',
  slate: '#64748b',
  // Pie chart palette
  pie: ['#3b82f6', '#6366f1', '#14b8a6', '#f97316', '#ef4444',
        '#eab308', '#22c55e', '#a855f7', '#94a3b8'],
  // Bar chart palette
  bar: ['#3b82f6', '#6366f1', '#14b8a6', '#f97316', '#ef4444',
        '#eab308', '#22c55e', '#a855f7', '#64748b', '#ec4899'],
};


/**
 * Horizontal box plot for continuous columns.
 */
function renderPlotlyBox(div) {
  const d = div.dataset;
  const min = parseFloat(d.min);
  const q1 = parseFloat(d.q1);
  const median = parseFloat(d.median);
  const q3 = parseFloat(d.q3);
  const max = parseFloat(d.max);
  const lower = parseFloat(d.lower);
  const upper = parseFloat(d.upper);
  const domainMin = d.domainMin !== undefined ? parseFloat(d.domainMin) : NaN;
  const domainMax = d.domainMax !== undefined ? parseFloat(d.domainMax) : NaN;

  if ([min, q1, median, q3, max].some(isNaN)) return;

  // Use shapes to draw a proper box plot manually — more reliable than synthetic data
  const shapes = [];
  const yMid = 0;  // center line

  // Whisker: min to Q1
  shapes.push({ type: 'line', x0: min, x1: q1, y0: yMid, y1: yMid, line: { color: PLOTLY_COLORS.blue, width: 1.5 } });
  // Whisker end caps
  shapes.push({ type: 'line', x0: min, x1: min, y0: -0.2, y1: 0.2, line: { color: PLOTLY_COLORS.blue, width: 1.5 } });
  // Box: Q1 to Q3
  shapes.push({ type: 'rect', x0: q1, x1: q3, y0: -0.4, y1: 0.4, fillcolor: PLOTLY_COLORS.blueFill, line: { color: PLOTLY_COLORS.blue, width: 2 } });
  // Median line
  shapes.push({ type: 'line', x0: median, x1: median, y0: -0.4, y1: 0.4, line: { color: '#1d4ed8', width: 2.5 } });
  // Whisker: Q3 to max
  shapes.push({ type: 'line', x0: q3, x1: max, y0: yMid, y1: yMid, line: { color: PLOTLY_COLORS.blue, width: 1.5 } });
  // Whisker end cap
  shapes.push({ type: 'line', x0: max, x1: max, y0: -0.2, y1: 0.2, line: { color: PLOTLY_COLORS.blue, width: 1.5 } });

  // Empty scatter trace just to set up the x-axis range
  const trace = {
    type: 'scatter',
    x: [min, max],
    y: [0, 0],
    mode: 'markers',
    marker: { size: 0.1, color: 'transparent' },
    hoverinfo: 'none',
    showlegend: false,
  };

  // Add fence lines and domain limits to the shapes array
  if (!isNaN(lower)) {
    shapes.push({
      type: 'line', xref: 'x', yref: 'paper',
      x0: lower, x1: lower, y0: 0, y1: 1,
      line: { color: PLOTLY_COLORS.red, width: 1.5, dash: 'dash' },
    });
  }
  if (!isNaN(upper)) {
    shapes.push({
      type: 'line', xref: 'x', yref: 'paper',
      x0: upper, x1: upper, y0: 0, y1: 1,
      line: { color: PLOTLY_COLORS.red, width: 1.5, dash: 'dash' },
    });
  }
  if (!isNaN(domainMin)) {
    shapes.push({
      type: 'line', xref: 'x', yref: 'paper',
      x0: domainMin, x1: domainMin, y0: 0, y1: 1,
      line: { color: PLOTLY_COLORS.green, width: 1.5, dash: 'dot' },
    });
  }
  if (!isNaN(domainMax)) {
    shapes.push({
      type: 'line', xref: 'x', yref: 'paper',
      x0: domainMax, x1: domainMax, y0: 0, y1: 1,
      line: { color: PLOTLY_COLORS.green, width: 1.5, dash: 'dot' },
    });
  }

  // Annotations for fence/domain labels
  const annotations = [];
  if (!isNaN(lower)) {
    annotations.push({
      x: lower, y: 1, yref: 'paper', xref: 'x',
      text: 'fence', showarrow: false,
      font: { size: 9, color: PLOTLY_COLORS.red },
      yanchor: 'bottom',
    });
  }
  if (!isNaN(upper)) {
    annotations.push({
      x: upper, y: 1, yref: 'paper', xref: 'x',
      text: 'fence', showarrow: false,
      font: { size: 9, color: PLOTLY_COLORS.red },
      yanchor: 'bottom',
    });
  }

  const layout = {
    height: 80,
    margin: { l: 10, r: 10, t: 16, b: 24 },
    xaxis: { zeroline: false, showgrid: true, gridcolor: '#f1f5f9' },
    yaxis: { visible: false, range: [-0.6, 0.6], fixedrange: true },
    shapes,
    annotations,
    paper_bgcolor: 'transparent',
    plot_bgcolor: 'transparent',
  };

  Plotly.newPlot(div, [trace], layout, PLOTLY_CONFIG);
}


/**
 * Pie chart for categorical columns (top 8 + Other).
 */
function renderPlotlyPie(div) {
  const raw = div.dataset.values;
  if (!raw) return;

  let entries;
  try { entries = JSON.parse(raw); } catch { return; }

  // entries is an array of [value, count]
  const sorted = entries.sort((a, b) => b[1] - a[1]);
  const top = sorted.slice(0, 8);
  const rest = sorted.slice(8);

  const labels = top.map(e => e[0]);
  const values = top.map(e => e[1]);
  if (rest.length > 0) {
    labels.push('Other');
    values.push(rest.reduce((s, e) => s + e[1], 0));
  }

  const trace = {
    type: 'pie',
    labels,
    values,
    hole: 0.35,
    textinfo: 'percent',
    textposition: 'inside',
    textfont: { size: 11 },
    marker: { colors: PLOTLY_COLORS.pie },
    hovertemplate: '%{label}: %{value:,}<br>%{percent}<extra></extra>',
    sort: false,
    direction: 'clockwise',
  };

  const layout = {
    height: 220,
    width: 300,
    margin: { l: 10, r: 10, t: 10, b: 10 },
    showlegend: true,
    legend: {
      font: { size: 10 },
      orientation: 'v',
      x: 1.05,
      y: 0.5,
      xanchor: 'left',
    },
    paper_bgcolor: 'transparent',
    plot_bgcolor: 'transparent',
  };

  Plotly.newPlot(div, [trace], layout, PLOTLY_CONFIG);
}


/**
 * Horizontal bar chart for ordered categorical columns (respects level order).
 */
function renderPlotlyBarOrdered(div) {
  const raw = div.dataset.values;
  if (!raw) return;

  let entries;
  try { entries = JSON.parse(raw); } catch { return; }

  // entries is array of [value, count], already in desired order
  // Reverse for horizontal bar so first item appears at top
  const labels = entries.map(e => e[0]).reverse();
  const counts = entries.map(e => e[1]).reverse();

  const trace = {
    type: 'bar',
    y: labels,
    x: counts,
    orientation: 'h',
    marker: {
      color: PLOTLY_COLORS.blue,
      line: { color: PLOTLY_COLORS.blue, width: 0 },
    },
    text: counts.map(c => c.toLocaleString()),
    textposition: 'auto',
    textfont: { size: 11, color: '#fff' },
    hovertemplate: '%{y}: %{x:,}<extra></extra>',
  };

  const barH = Math.max(25, entries.length * 28);
  const layout = {
    height: Math.min(barH + 50, 400),
    margin: { l: 120, r: 20, t: 10, b: 30 },
    xaxis: { title: '', gridcolor: '#f1f5f9', zeroline: false },
    yaxis: { automargin: true, tickfont: { size: 11 } },
    paper_bgcolor: 'transparent',
    plot_bgcolor: 'transparent',
    bargap: 0.2,
  };

  Plotly.newPlot(div, [trace], layout, PLOTLY_CONFIG);
}


/**
 * Horizontal bar chart for multi_label top tokens.
 */
function renderPlotlyBarTokens(div) {
  const raw = div.dataset.values;
  if (!raw) return;

  let entries;
  try { entries = JSON.parse(raw); } catch { return; }

  // entries is array of [token, count], sorted desc
  const top = entries.slice(0, 15);
  const labels = top.map(e => e[0]).reverse();
  const counts = top.map(e => e[1]).reverse();

  const trace = {
    type: 'bar',
    y: labels,
    x: counts,
    orientation: 'h',
    marker: {
      color: labels.map((_, i) => PLOTLY_COLORS.bar[i % PLOTLY_COLORS.bar.length]).reverse(),
    },
    text: counts.map(c => c.toLocaleString()),
    textposition: 'auto',
    textfont: { size: 11, color: '#fff' },
    hovertemplate: '%{y}: %{x:,}<extra></extra>',
  };

  const barH = Math.max(25, top.length * 28);
  const layout = {
    height: Math.min(barH + 50, 450),
    margin: { l: 120, r: 20, t: 10, b: 30 },
    xaxis: { title: '', gridcolor: '#f1f5f9', zeroline: false },
    yaxis: { automargin: true, tickfont: { size: 11 } },
    paper_bgcolor: 'transparent',
    plot_bgcolor: 'transparent',
    bargap: 0.2,
  };

  Plotly.newPlot(div, [trace], layout, PLOTLY_CONFIG);
}


// Auto-render after DOM mutations (fallback for any dynamically added charts)
const plotlyObserver = new MutationObserver(() => {
  // Debounce: only fire if there are unrendered charts
  if (document.querySelector('[data-plotly-type]:not([data-plotly-rendered="true"])')) {
    requestAnimationFrame(window.renderPlotlyCharts);
  }
});
plotlyObserver.observe(document.body, { childList: true, subtree: true });
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(window.renderPlotlyCharts, 100);
});
