// Webview script. CONFIG ({ chunks, hasGitActions, isMd }) and, in preview, diff.js's `exports` are
// defined by the script tags before this one in diff-view.html.

// ===== Setup =====

const vscode = acquireVsCodeApi();
const { chunks, hasGitActions: HAS_GIT_ACTIONS, isMd: IS_MD } = CONFIG;
const IS_PREVIEW_MODE = document.documentElement.dataset.mode === 'preview';
const leftPane = document.getElementById('leftPane');
const rightPane = document.getElementById('rightPane');
const leftRuler = document.getElementById('leftRuler');
const rightRuler = document.getElementById('rightRuler');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
// LINE_HEIGHT and PANE_PAD must match .line and .pane in diff-view.css
const LINE_HEIGHT = 20;
const PANE_PAD = 10;
const STAGED_FILL = 0.25, STAGED_OUTLINE = 0.5;  // must match .staged in diff-view.css
const rootStyle = getComputedStyle(document.documentElement);
const themeColors = prefix => Object.fromEntries(['insert', 'delete', 'replace'].map(t => [t, rootStyle.getPropertyValue(`${prefix}-${t}`).trim()]));
const OUTLINE_COLORS = themeColors('--outline');
const CHUNK_COLORS = themeColors('--chunk');

// ===== Messages to the extension =====

// The extension re-renders the whole page after an action, tab switch or mode toggle; webview state survives that reload.
// Saved as a source line, since pixel offsets differ between raw and preview.
const saveScroll = () => vscode.setState({ line: midLine(rightPane), left: rightPane.scrollLeft });
function send(msg) {
  saveScroll();
  vscode.postMessage(msg);
}

// ===== Chunk actions: revert, stage/unstage (Git mode) =====

// Same symbols as VS Code's Source Control view: discard arrow, plus, minus
const ICONS = {
  revert: '<svg viewBox="0 0 16 16"><path d="M4 6h6a3 3 0 0 1 0 6H7M6.5 3.5 4 6l2.5 2.5"/></svg>',
  stage: '<svg viewBox="0 0 16 16"><path d="M8 3v10M3 8h10"/></svg>',
  unstage: '<svg viewBox="0 0 16 16"><path d="M3 8h10"/></svg>',
};
const actionEls = [];
if (HAS_GIT_ACTIONS) {
  const container = document.createElement('div');
  container.className = 'chunk-actions-container';
  rightPane.firstElementChild.prepend(container);
  for (const c of chunks) {
    const el = document.createElement('div');
    el.className = 'chunk-actions';
    const stageType = c.staged ? 'unstage' : 'stage';
    el.innerHTML = `<button class="revert" title="Revert chunk">${ICONS.revert}</button>`
      + `<button class="${stageType}" title="${c.staged ? 'Unstage' : 'Stage'} chunk">${ICONS[stageType]}</button>`;
    const [revertBtn, stageBtn] = el.children;
    revertBtn.disabled = !!c.hasStaged; // reverting the buffer would leave the staged part invisible in the index
    revertBtn.onclick = () => send({ type: 'revert', chunk: c });
    stageBtn.onclick = () => send({ type: stageType, chunk: c });
    container.appendChild(el);
    actionEls.push(el);
  }
  // Ctrl/Cmd+Z undoes the last revert button click; the extension owns that history
  window.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      send({ type: 'undo' });
    }
  });
}

// ===== Raw/Preview toggle, only for markdown pairs; the extension re-renders in the other mode =====

const modeToggle = document.getElementById('modeToggle');
modeToggle.hidden = !IS_MD;
modeToggle.textContent = IS_PREVIEW_MODE ? 'Raw' : 'Preview';
modeToggle.title = `Switch to ${modeToggle.textContent.toLowerCase()} view`;
modeToggle.onclick = () => send({ type: 'toggleMode' });

// ===== Line <-> pixel mapping =====

// Preview blocks have different heights, so each pane gets a table of [line, offsetY] rows, sorted by line
const rows = new Map();
function buildRows(pane) {
  const lines = pane.querySelector('.lines');
  const top0 = lines.getBoundingClientRect().top;
  const byLine = new Map();
  for (const el of lines.querySelectorAll('[data-line]')) {
    const k = +el.dataset.line, y = el.getBoundingClientRect().top - top0;
    byLine.set(k, Math.min(byLine.get(k) ?? Infinity, y)); // <ul> and its first <li> share a line, keep the higher one
  }
  rows.set(pane, [...byLine].sort((p, q) => p[0] - q[0]));
}
// Last row whose col value is <= v (0 if none); both columns are sorted, so binary search
function rowIndex(r, v, col) {
  let lo = 0, hi = r.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (r[mid][col] <= v) lo = mid; else hi = mid - 1;
  }
  return lo;
}
// Interpolate between rows in either direction (col 0 = line, col 1 = offset); clamps past the last row.
function interp(r, v, from) {
  const to = 1 - from, i = rowIndex(r, v, from), p = r[i], q = r[i + 1];
  if (!q || q[from] === p[from]) return p[to];
  return p[to] + (v - p[from]) / (q[from] - p[from]) * (q[to] - p[to]);
}
// Line k <-> pixel offset inside .lines (PANE_PAD excluded)
const lineOffset = (pane, k) => IS_PREVIEW_MODE ? interp(rows.get(pane), k, 0) : k * LINE_HEIGHT;
const offsetLine = (pane, y) => IS_PREVIEW_MODE ? interp(rows.get(pane), y, 1) : y / LINE_HEIGHT;
const lineCount = pane => IS_PREVIEW_MODE ? rows.get(pane).at(-1)[0] : pane.querySelectorAll('.line').length;
// Line boundary k (top of line k) in viewport pixels
const yOf = (pane, k) => PANE_PAD + lineOffset(pane, k) - pane.scrollTop;
// The line at the vertical middle of the viewport
const midLine = pane => offsetLine(pane, pane.scrollTop + pane.clientHeight / 2 - PANE_PAD);

// ===== Chunks as drawn =====

// Snap line k to a block start: down to its own block, or up to the next one
function snapLine(pane, k, up) {
  const r = rows.get(pane), i = rowIndex(r, k, 0);
  return up && r[i][0] < k && r[i + 1] ? r[i + 1][0] : r[i][0];
}
// Display range of one chunk side ('a' or 'b'): blank-trimmed and snapped to whole blocks in preview
function span(pane, c, side) {
  if (!IS_PREVIEW_MODE) return [c[side + '0'], c[side + '1']];
  const s = c['v' + side + '0'], e = c['v' + side + '1'];
  if (s === e) { const g = snapLine(pane, s, true); return [g, g]; }
  return [snapLine(pane, s, false), snapLine(pane, e, true)];
}
// Chunk ranges as drawn: { tag, staged, a0, a1, b0, b1 }. In preview, chunks whose snapped ranges overlap
// on either side, or touch on both (e.g. a deleted blank line merging two paragraphs), become one,
// so a block never gets two bands or a doubled edge.
let drawn = [];
function buildDrawn() {
  drawn = [];
  for (const c of chunks) {
    const [a0, a1] = span(leftPane, c, 'a'), [b0, b1] = span(rightPane, c, 'b');
    const p = drawn.at(-1);
    if (IS_PREVIEW_MODE && p && (a0 < p.a1 || b0 < p.b1 || (a0 === p.a1 && b0 === p.b1))) {
      p.tag = p.tag === c.tag ? p.tag : 'replace';
      p.staged = p.staged && c.staged;
      p.a1 = Math.max(p.a1, a1);
      p.b1 = Math.max(p.b1, b1);
    } else {
      drawn.push({ tag: c.tag, staged: c.staged, a0, a1, b0, b1 });
    }
  }
}

// ===== Preview: chunk bands and word marks =====

// Preview chunk backgrounds; reuses the raw view's chunk/staged classes for colors and outlines
function drawBands(pane, side) {
  const lines = pane.querySelector('.lines');
  lines.querySelectorAll(':scope > .band').forEach(b => b.remove());
  for (const c of drawn) {
    const [s, e] = [c[side + '0'], c[side + '1']];
    const b = document.createElement('div');
    b.className = `band chunk-${c.tag} chunk-start chunk-end${c.staged ? ' staged' : ''}${s === e ? ' gap' : ''}`;
    // An end-of-file gap line sits above the boundary, matching edgesOf
    b.style.top = lineOffset(pane, s) - (s === e && s >= lineCount(pane) ? 1 : 0) + 'px';
    b.style.height = lineOffset(pane, e) - lineOffset(pane, s) + 'px';
    lines.prepend(b);
  }
}
// Text nodes of block el, minus those inside nested blocks: a list item's own text without its sub-list
function ownTextNodes(el) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: n => n.nodeType === Node.TEXT_NODE ? NodeFilter.FILTER_ACCEPT
      : n.hasAttribute('data-line') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP,
  });
  const nodes = [];
  for (let n; (n = walker.nextNode());) nodes.push(n);
  return nodes;
}
const ownText = el => ownTextNodes(el).map(n => n.data).join('');
// Diff the own text of the blocks (p, li, tr, pre, ...) in each replaced range with the raw view's
// diffBlock, one block per "line", then wrap the marks in place.
function markWords() {
  const blocks = (pane, s, e) => [...pane.querySelectorAll('.lines [data-line]')]
    .filter(el => +el.dataset.line >= s && +el.dataset.line < e && /\S/.test(ownText(el)));
  for (const d of drawn) {
    if (d.tag !== 'replace') continue;
    const A = blocks(leftPane, d.a0, d.a1), B = blocks(rightPane, d.b0, d.b1);
    const w = exports.diffBlock(A.map(ownText), B.map(ownText));
    A.forEach((el, i) => wrapMarks(el, w.a[i]));
    B.forEach((el, j) => wrapMarks(el, w.b[j]));
  }
}
// Wrap own-text ranges [s, e) of el in spans; an empty range gets a zero-width gap span.
// Ranges may cross inline tags (<strong>, <code>), so each text node segment is wrapped on its own.
const STRUCTURAL = new Set(['TR', 'THEAD', 'TBODY', 'TABLE', 'UL', 'OL']);  // a span directly inside these breaks layout
function wrapMarks(el, marks) {
  for (const [s, e, cls] of marks) {
    const hits = [];
    for (let nodes = ownTextNodes(el), k = 0, n, off = 0; (n = nodes[k]); off += n.length, k++) {
      if (STRUCTURAL.has(n.parentElement.tagName)) continue;
      if (s === e) {
        if (s >= off && s <= off + n.length) { hits.push([n, s - off, s - off]); break; }
      } else {
        const a = Math.max(s, off) - off, b = Math.min(e, off + n.length) - off;
        if (a < b && /\S/.test(n.data.slice(a, b))) hits.push([n, a, b]);
      }
    }
    for (const [n, a, b] of hits) {
      const span = document.createElement('span');
      span.className = cls;
      const mid = n.splitText(a);
      if (a === b) { mid.before(span); continue; }
      mid.splitText(b - a);
      mid.replaceWith(span);
      span.append(mid);
    }
  }
}

// ===== Rulers: chunk marks and the viewport box beside each pane =====

const rulers = [[leftRuler, leftPane, 'a'], [rightRuler, rightPane, 'b']];
function drawRulerMarks() {
  for (const [ruler, pane, side] of rulers) {
    ruler.querySelectorAll('.ruler-mark').forEach(m => m.remove());
    const n = lineCount(pane);
    // Raw: line fraction. Preview: pixel fraction, since blocks have different heights.
    const frac = k => IS_PREVIEW_MODE ? (PANE_PAD + lineOffset(pane, k)) / pane.scrollHeight : k / n;
    for (const c of drawn) {
      const [s, e] = [c[side + '0'], c[side + '1']];
      if (s === e) continue;  // only draw marks for non-empty chunks
      const m = document.createElement('div');
      m.className = `ruler-mark ruler-mark-${c.tag}`;
      m.style.top = frac(s) * 100 + '%';
      m.style.height = (frac(e) - frac(s)) * 100 + '%';
      ruler.appendChild(m);
    }
  }
}
function drawRulerViewports() {
  for (const [ruler, pane] of rulers) {
    const viewport = ruler.querySelector('.ruler-viewport');
    viewport.style.top = pane.scrollTop / pane.scrollHeight * 100 + '%';
    viewport.style.height = pane.clientHeight / pane.scrollHeight * 100 + '%';
  }
}
// Click or drag on a ruler centers the pane on that point
for (const [ruler, pane] of rulers) {
  const jump = e => {
    const r = ruler.getBoundingClientRect();
    pane.scrollTop = (e.clientY - r.top) / r.height * pane.scrollHeight - pane.clientHeight / 2;
  };
  ruler.addEventListener('pointerdown', e => {
    ruler.setPointerCapture(e.pointerId);
    jump(e);
  });
  ruler.addEventListener('pointermove', e => {
    if (ruler.hasPointerCapture(e.pointerId)) jump(e);
  });
}

// ===== Gutter: curved bands connecting each chunk's left and right line ranges =====

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = canvas.parentElement.clientWidth * dpr;
  canvas.height = canvas.parentElement.clientHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw();
}
// Everything that moves on scroll
function draw() {
  drawConnections();
  drawRulerViewports();
}

// Top/bottom curve y for a chunk side, centered on the 1px inset outline drawn in the pane:
// chunk-start/gap-before sit just below the boundary, chunk-end/gap-after just above it.
function edgesOf(pane, s, e) {
  if (s < e) return [yOf(pane, s) + 0.5, yOf(pane, e) - 0.5];
  const y = yOf(pane, s) + (s < lineCount(pane) ? 0.5 : -0.5);
  return [y, y];
}

// Each chunk is a filled band whose top and bottom edges are Bezier curves.
function drawConnections() {
  const w = canvas.parentElement.clientWidth;
  const h = canvas.parentElement.clientHeight;
  const curve = (ly, ry) => ctx.bezierCurveTo(w / 2, ly, w / 2, ry, w, ry);  // from (0, ly) to (w, ry)
  ctx.clearRect(0, 0, w, h);
  for (const c of drawn) {
    const [ly0, ly1] = edgesOf(leftPane, c.a0, c.a1);
    const [ry0, ry1] = edgesOf(rightPane, c.b0, c.b1);
    if (Math.max(ly1, ry1) < 0 || Math.min(ly0, ry0) > h) continue;  // off-screen
    ctx.beginPath();
    ctx.moveTo(0, ly0);
    curve(ly0, ry0);
    ctx.lineTo(w, ry1);
    ctx.bezierCurveTo(w / 2, ry1, w / 2, ly1, 0, ly1);
    ctx.closePath();
    ctx.fillStyle = CHUNK_COLORS[c.tag];
    // Staged chunks are faded with dashed edges; set for every chunk since ctx keeps them
    ctx.globalAlpha = c.staged ? STAGED_FILL : 1;
    ctx.setLineDash(c.staged ? [3, 3] : []);
    ctx.fill();
    // Stroke only the top and bottom curves. The left and right edges stay unstroked.
    ctx.globalAlpha = c.staged ? STAGED_OUTLINE : 1;
    ctx.beginPath();
    ctx.moveTo(0, ly0);
    curve(ly0, ry0);
    ctx.moveTo(0, ly1);
    curve(ly1, ry1);
    ctx.strokeStyle = `rgb(${OUTLINE_COLORS[c.tag]})`;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

// ===== Scroll sync =====

// Matching line boundaries on both sides; between them, lines map linearly.
// Unchanged stretches map 1:1, so inside a chunk the side with fewer lines moves slower.
const anchors = [[0, 0], ...chunks.flatMap(c => [[c.a0, c.b0], [c.a1, c.b1]])];

// Map a fractional line position from one side (0 = left, 1 = right) to the other; 1:1 past the last anchor.
function mapLine(line, from) {
  const to = 1 - from, i = rowIndex(anchors, line, from), p = anchors[i], q = anchors[i + 1];
  if (!q) return p[to] + (line - p[from]);
  return p[to] + (line - p[from]) / (q[from] - p[from]) * (q[to] - p[to]);
}

// Scroll positions we assigned ourselves, so their scroll events don't sync back
const expected = new Map();
function syncFrom(src, dst, from) {
  const e = expected.get(src);
  if (e && Math.abs(src.scrollTop - e[0]) < 1 && Math.abs(src.scrollLeft - e[1]) < 1) {
    expected.delete(src);
  } else {
    syncTo(src, dst, from);
  }
  scheduleDraw();
}
// Scroll dst so the line at src's middle sits at dst's middle
function syncTo(src, dst, from) {
  const [top, left] = [dst.scrollTop, dst.scrollLeft];
  dst.scrollTop = PANE_PAD + lineOffset(dst, mapLine(midLine(src), from)) - dst.clientHeight / 2;
  dst.scrollLeft = src.scrollLeft;
  if (dst.scrollTop !== top || dst.scrollLeft !== left) expected.set(dst, [dst.scrollTop, dst.scrollLeft]);
}

// One listener for the whole view. The pointer's half picks the driver pane; the other
// pane follows through the line map. Native wheel is blocked so both panes and the canvas
// update in the same frame, instead of the compositor painting the panes a frame ahead.
let wheel = null;
window.addEventListener('wheel', e => {
  e.preventDefault();
  const fromLeft = e.clientX < window.innerWidth / 2;
  const src = fromLeft ? leftPane : rightPane;
  const k = e.deltaMode === 1 ? LINE_HEIGHT : e.deltaMode === 2 ? src.clientHeight : 1;
  if (!wheel) {
    wheel = { dx: 0, dy: 0 };
    requestAnimationFrame(applyWheel);
  }
  wheel.src = src;
  wheel.dst = fromLeft ? rightPane : leftPane;
  wheel.from = fromLeft ? 0 : 1;
  wheel.dx += e.deltaX * k;
  wheel.dy += e.deltaY * k;
}, { capture: true, passive: false });
function applyWheel() {
  const { src, dst, from, dx, dy } = wheel;
  wheel = null;
  const [top, left] = [src.scrollTop, src.scrollLeft];
  src.scrollTop += dy;
  src.scrollLeft += dx;
  if (src.scrollTop !== top || src.scrollLeft !== left) expected.set(src, [src.scrollTop, src.scrollLeft]);
  syncTo(src, dst, from);
  draw();
}

// Both panes fire scroll events per user scroll; draw once per frame.
let drawPending = false;
function scheduleDraw() {
  if (drawPending) return;
  drawPending = true;
  requestAnimationFrame(() => {
    drawPending = false;
    draw();
    saveScroll();
  });
}
leftPane.addEventListener('scroll', () => syncFrom(leftPane, rightPane, 0));
rightPane.addEventListener('scroll', () => syncFrom(rightPane, leftPane, 1));

// ===== Layout and startup =====

// Re-measure and redraw everything positioned from line offsets
function layout() {
  if (IS_PREVIEW_MODE) {
    buildRows(leftPane);
    buildRows(rightPane);
  }
  buildDrawn();
  if (IS_PREVIEW_MODE) {
    drawBands(leftPane, 'a');
    drawBands(rightPane, 'b');
  }
  actionEls.forEach((el, i) => {
    el.style.top = Math.max(-PANE_PAD, lineOffset(rightPane, span(rightPane, chunks[i], 'b')[0]) - 18 - 1) + 'px';
  });
  drawRulerMarks();
  resizeCanvas();
}

window.addEventListener('resize', resizeCanvas);
// Rows must exist before the first scroll sync or draw reads them
layout();
// Once: wrapping words adds no text, so later re-layouts keep them
if (IS_PREVIEW_MODE) markWords();
// Images loading and width changes move preview blocks; re-measure when either side resizes
const resizeObserver = new ResizeObserver(layout);
resizeObserver.observe(leftPane.querySelector('.lines'));
resizeObserver.observe(rightPane.querySelector('.lines'));
// Restore the line saved by send() to the middle of the viewport; the scroll listener above syncs the left pane.
const saved = vscode.getState();
if (saved) {
  rightPane.scrollTop = PANE_PAD + lineOffset(rightPane, saved.line ?? 0) - rightPane.clientHeight / 2;
  rightPane.scrollLeft = saved.left;
}
setTimeout(resizeCanvas, 100);
