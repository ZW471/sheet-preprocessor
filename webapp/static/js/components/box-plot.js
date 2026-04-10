/**
 * Lightweight canvas box-plot renderer.
 * Draws directly on <canvas> elements with data- attributes.
 */
function drawBoxPlots() {
  document.querySelectorAll('canvas.box-plot-canvas').forEach(canvas => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const min = parseFloat(canvas.dataset.min);
    const q1 = parseFloat(canvas.dataset.q1);
    const median = parseFloat(canvas.dataset.median);
    const q3 = parseFloat(canvas.dataset.q3);
    const max = parseFloat(canvas.dataset.max);
    const lower = parseFloat(canvas.dataset.lower);
    const upper = parseFloat(canvas.dataset.upper);

    if ([min, q1, median, q3, max].some(isNaN)) return;

    const w = canvas.width;
    const h = canvas.height;
    const pad = 20;
    const drawW = w - 2 * pad;
    const cy = h / 2;

    // Scale: map [min, max] to [pad, pad+drawW]
    const dataMin = Math.min(min, isNaN(lower) ? min : lower);
    const dataMax = Math.max(max, isNaN(upper) ? max : upper);
    const range = dataMax - dataMin || 1;
    const x = v => pad + ((v - dataMin) / range) * drawW;

    ctx.clearRect(0, 0, w, h);

    // Whiskers
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x(min), cy); ctx.lineTo(x(q1), cy);
    ctx.moveTo(x(q3), cy); ctx.lineTo(x(max), cy);
    // Whisker caps
    ctx.moveTo(x(min), cy - 6); ctx.lineTo(x(min), cy + 6);
    ctx.moveTo(x(max), cy - 6); ctx.lineTo(x(max), cy + 6);
    ctx.stroke();

    // Box
    const boxLeft = x(q1);
    const boxRight = x(q3);
    ctx.fillStyle = '#dbeafe';
    ctx.fillRect(boxLeft, cy - 10, boxRight - boxLeft, 20);
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(boxLeft, cy - 10, boxRight - boxLeft, 20);

    // Median line
    ctx.strokeStyle = '#1d4ed8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x(median), cy - 10);
    ctx.lineTo(x(median), cy + 10);
    ctx.stroke();

    // Fence markers (dashed)
    if (!isNaN(lower)) {
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(x(lower), cy - 14);
      ctx.lineTo(x(lower), cy + 14);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (!isNaN(upper)) {
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(x(upper), cy - 14);
      ctx.lineTo(x(upper), cy + 14);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  });
}

// Draw box plots whenever the DOM updates
const boxPlotObserver = new MutationObserver(() => {
  requestAnimationFrame(drawBoxPlots);
});
boxPlotObserver.observe(document.body, { childList: true, subtree: true });
// Initial draw
document.addEventListener('DOMContentLoaded', drawBoxPlots);
