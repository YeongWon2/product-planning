import { escapeHtml } from './escape.mjs';

// 도화지: 여러 그림을 프레임으로 한 판에 올리고, 확대·축소·이동해서 본다.
// 스크립트가 없는 곳(문서 도구에 붙여 넣은 경우 등)에서는 그림을 원래 크기로 두고 스크롤로 본다.
const FRAME_PADDING = 24;
const TITLE_HEIGHT = 52;
const FRAME_GAP = 80;
const BOARD_MARGIN = 80;

const FRAME_STYLE = [
  '.frame-bg{fill:#ffffff;stroke:#d5dae3;stroke-width:1}',
  '.frame-title{font:700 17px sans-serif;fill:#1f2430}.frame-sub{font:13px sans-serif;fill:#5b6372}',
  '.fc-text{font:13px sans-serif;fill:#1f2430;text-anchor:middle}',
  '.fc-start,.fc-end{fill:#1f2430}.fc-start+.fc-text,.fc-end+.fc-text{fill:#ffffff;font-weight:600}',
  '.fc-process{fill:#ffffff;stroke:#3d4452;stroke-width:1.4}',
  '.fc-decision{fill:#fff7e6;stroke:#b54708;stroke-width:1.4}',
  '.fc-message{fill:#f6f7f9;stroke:#8a93a3;stroke-width:1;stroke-dasharray:4 3}',
  '.fc-state{fill:#eef4ff;stroke:#2f5fd0;stroke-width:1.2}',
  '.fc-edge path{fill:none;stroke:#6b7385;stroke-width:1.4}.fc-edge-no path{stroke:#b54708}.fc-edge-loop path{stroke-dasharray:5 4}',
  '.fc-label{font:12px sans-serif;fill:#5b6372;text-anchor:middle;paint-order:stroke;stroke:#ffffff;stroke-width:3px;stroke-linejoin:round}',
].join('');

function layoutFrames(rows) {
  const placed = [];
  let y = BOARD_MARGIN;
  let width = 0;
  for (const row of rows) {
    let x = BOARD_MARGIN;
    let rowHeight = 0;
    for (const frame of row) {
      const w = frame.width + FRAME_PADDING * 2;
      const h = frame.height + TITLE_HEIGHT + FRAME_PADDING;
      placed.push({ frame, x, y, w, h });
      x += w + FRAME_GAP;
      rowHeight = Math.max(rowHeight, h);
    }
    width = Math.max(width, x - FRAME_GAP + BOARD_MARGIN);
    if (row.length > 0) y += rowHeight + FRAME_GAP;
  }
  return { placed, width: Math.max(width, BOARD_MARGIN * 2), height: y - FRAME_GAP + BOARD_MARGIN };
}

// 화면에 맞춰 보기 좋은 판 비율(가로:세로 약 16:10)에 가장 가까워지도록 프레임을 줄로 나눈다.
// 줄 폭 후보를 차례로 시험해 보고 고르므로 같은 입력이면 늘 같은 배치가 나온다. 순서는 바꾸지 않는다.
const TARGET_RATIO = 1.6;
export function packRows(frames, pinned = []) {
  const wrapAt = (limit) => {
    const rows = [];
    let row = [];
    let width = 0;
    for (const frame of frames) {
      const w = frame.width + FRAME_PADDING * 2;
      if (row.length > 0 && width + FRAME_GAP + w > limit) {
        rows.push(row);
        row = [];
        width = 0;
      }
      width += (row.length > 0 ? FRAME_GAP : 0) + w;
      row.push(frame);
    }
    if (row.length > 0) rows.push(row);
    return rows;
  };
  const base = pinned.length > 0 ? [pinned] : [];
  if (frames.length === 0) return base;
  const widest = Math.max(...frames.map((frame) => frame.width + FRAME_PADDING * 2));
  const total = frames.reduce((sum, frame) => sum + frame.width + FRAME_PADDING * 2 + FRAME_GAP, 0);
  let best = null;
  for (let limit = widest; limit <= total + widest; limit += 200) {
    const rows = [...base, ...wrapAt(limit)];
    const { width, height } = layoutFrames(rows);
    const distance = Math.abs(Math.log(width / height / TARGET_RATIO));
    if (best === null || distance < best.distance - 1e-9) best = { rows, distance };
  }
  return best.rows;
}

export function renderBoard({ rows, withScript = true }) {
  const { placed, width, height } = layoutFrames(rows);
  const frames = placed.map(({ frame, x, y, w, h }) => `<g class="board-frame" data-frame="${escapeHtml(frame.id)}" data-box="${x} ${y} ${w} ${h}" transform="translate(${x} ${y})">`
    + `<rect class="frame-bg" width="${w}" height="${h}" rx="10"/>`
    + `<text class="frame-title" x="${FRAME_PADDING}" y="30">${escapeHtml(frame.title)}</text>`
    + (frame.subtitle ? `<text class="frame-sub" x="${FRAME_PADDING}" y="46">${escapeHtml(frame.subtitle)}</text>` : '')
    + `<g transform="translate(${FRAME_PADDING} ${TITLE_HEIGHT})">${frame.markup}</g></g>`).join('');
  const options = placed.map(({ frame }) => `<option value="${escapeHtml(frame.id)}">${escapeHtml(frame.title)}</option>`).join('');

  const svg = `<svg class="board-canvas" xmlns="http://www.w3.org/2000/svg" data-width="${width}" data-height="${height}" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="흐름도 도화지">`
    + '<defs><marker id="board-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#6b7385"/></marker>'
    + '<pattern id="board-dots" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#d5dae3"/></pattern></defs>'
    + `<style>${FRAME_STYLE}</style>`
    + `<rect width="${width}" height="${height}" fill="#f3f4f7"/><rect width="${width}" height="${height}" fill="url(#board-dots)"/>`
    + frames
    + '</svg>';

  const bar = '<div class="board-bar">'
    + '<button type="button" data-zoom="out" title="축소 (-)">−</button>'
    + '<span class="board-level" data-zoom-level>100%</span>'
    + '<button type="button" data-zoom="in" title="확대 (+)">+</button>'
    + '<button type="button" data-zoom="fit" title="전체 보기 (0)">전체 보기</button>'
    + '<button type="button" data-zoom="reset" title="실제 크기 (1)">100%</button>'
    + `<select data-goto aria-label="프레임으로 이동"><option value="">프레임으로 이동…</option>${options}</select>`
    + '<button type="button" data-zoom="full" title="전체 화면">전체 화면</button>'
    + '</div>';
  const help = '<p class="board-help">끌거나 스크롤해서 이동하고, Ctrl(⌘)+휠이나 두 손가락 벌리기로 확대·축소합니다. 두 번 누르면 그 자리를 확대합니다.</p>';
  return `<div class="board" data-board>${bar}<div class="board-view" data-view tabindex="0">${svg}</div>${help}</div>${withScript ? BOARD_SCRIPT : ''}`;
}

export const BOARD_STYLE = `
.board{border:1px solid var(--line,#dfe3ea);border-radius:10px;margin:12px 0;background:#f3f4f7;overflow:hidden}
/* 본문 폭보다 넓게, 화면 가로 폭 가까이 펼친다. 좁은 화면에서는 본문 폭 그대로 쓴다. */
.board-live{position:relative;width:max(100%,min(calc(100vw - 48px),1800px));left:50%;transform:translateX(-50%)}
.board-live:fullscreen{width:100%;left:0;transform:none}
.board-view{overflow:auto;max-height:80vh}
.board-bar{display:none;gap:6px;align-items:center;padding:8px;border-bottom:1px solid var(--line,#dfe3ea);background:#ffffff;flex-wrap:wrap}
.board-bar button,.board-bar select{font:13px sans-serif;border:1px solid #d5dae3;background:#ffffff;border-radius:6px;padding:4px 10px;cursor:pointer}
.board-level{min-width:52px;text-align:center;font:600 13px sans-serif;color:#1f2430}
.board-help{display:none;margin:0;padding:6px 10px;font-size:12px;color:#5b6372;background:#ffffff;border-top:1px solid var(--line,#dfe3ea)}
.board-live .board-bar{display:flex}.board-live .board-help{display:block}
.board-live .board-view{height:78vh;max-height:none;overflow:hidden;cursor:grab;touch-action:none;outline:none}
.board-live .board-view.dragging{cursor:grabbing}
.board-live svg{display:block;width:100%;height:100%;user-select:none}
.board:fullscreen{display:flex;flex-direction:column;border-radius:0}.board:fullscreen .board-view{flex:1;height:auto}
@media print{.board-bar,.board-help{display:none!important}.board-view{height:auto!important;overflow:visible!important}}
`;

// 확대·이동은 viewBox를 바꿔 한다. 그림 좌표는 그대로라 인쇄·복사한 SVG도 원래 좌표를 유지한다.
export const BOARD_SCRIPT = `<script>
(function () {
  var MIN = 0.1, MAX = 4;
  Array.prototype.forEach.call(document.querySelectorAll('[data-board]'), function (board) {
    var view = board.querySelector('[data-view]');
    var svg = view.querySelector('svg');
    var W = Number(svg.getAttribute('data-width')), H = Number(svg.getAttribute('data-height'));
    var level = board.querySelector('[data-zoom-level]');
    board.classList.add('board-live');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    var box = { x: 0, y: 0, w: W, h: H };
    var size = function () { var r = view.getBoundingClientRect(); return { w: r.width || 1, h: r.height || 1, left: r.left, top: r.top }; };
    var scale = function () { return size().w / box.w; };
    function apply() {
      svg.setAttribute('viewBox', box.x + ' ' + box.y + ' ' + box.w + ' ' + box.h);
      level.textContent = Math.round(scale() * 100) + '%';
    }
    function show(x, y, w, h) {
      var s = size();
      var k = Math.max(w / s.w, h / s.h, 1 / MAX);
      box = { w: s.w * k, h: s.h * k, x: 0, y: 0 };
      box.x = x - (box.w - w) / 2;
      box.y = y - (box.h - h) / 2;
      apply();
    }
    function zoomAt(factor, clientX, clientY) {
      var s = size();
      var next = Math.min(Math.max(scale() * factor, MIN), MAX);
      var px = box.x + (clientX - s.left) / s.w * box.w, py = box.y + (clientY - s.top) / s.h * box.h;
      var w = s.w / next, h = s.h / next;
      box = { x: px - (px - box.x) * (w / box.w), y: py - (py - box.y) * (h / box.h), w: w, h: h };
      apply();
    }
    function zoomCenter(factor) { var s = size(); zoomAt(factor, s.left + s.w / 2, s.top + s.h / 2); }
    function pan(dx, dy) { var k = box.w / size().w; box.x -= dx * k; box.y -= dy * k; apply(); }

    view.addEventListener('wheel', function (event) {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) zoomAt(Math.exp(-event.deltaY * 0.005), event.clientX, event.clientY);
      else pan(-event.deltaX, -event.deltaY);
    }, { passive: false });

    var pointers = {}, pinch = null;
    view.addEventListener('pointerdown', function (event) {
      view.setPointerCapture(event.pointerId);
      pointers[event.pointerId] = { x: event.clientX, y: event.clientY };
      view.classList.add('dragging');
    });
    view.addEventListener('pointermove', function (event) {
      var last = pointers[event.pointerId];
      if (!last) return;
      var ids = Object.keys(pointers);
      if (ids.length === 2) {
        var a = pointers[ids[0]], b = pointers[ids[1]];
        pointers[event.pointerId] = { x: event.clientX, y: event.clientY };
        a = pointers[ids[0]]; b = pointers[ids[1]];
        var distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch) zoomAt(distance / pinch, (a.x + b.x) / 2, (a.y + b.y) / 2);
        pinch = distance;
        return;
      }
      pan(event.clientX - last.x, event.clientY - last.y);
      pointers[event.pointerId] = { x: event.clientX, y: event.clientY };
    });
    function release(event) {
      delete pointers[event.pointerId];
      pinch = null;
      if (Object.keys(pointers).length === 0) view.classList.remove('dragging');
    }
    view.addEventListener('pointerup', release);
    view.addEventListener('pointercancel', release);
    view.addEventListener('dblclick', function (event) { zoomAt(2, event.clientX, event.clientY); });
    view.addEventListener('keydown', function (event) {
      if (event.key === '+' || event.key === '=') zoomCenter(1.25);
      else if (event.key === '-') zoomCenter(0.8);
      else if (event.key === '0') show(0, 0, W, H);
      else if (event.key === '1') zoomCenter(1 / scale());
      else return;
      event.preventDefault();
    });

    board.querySelector('[data-zoom="in"]').addEventListener('click', function () { zoomCenter(1.25); });
    board.querySelector('[data-zoom="out"]').addEventListener('click', function () { zoomCenter(0.8); });
    board.querySelector('[data-zoom="fit"]').addEventListener('click', function () { show(0, 0, W, H); });
    board.querySelector('[data-zoom="reset"]').addEventListener('click', function () { zoomCenter(1 / scale()); });
    board.querySelector('[data-zoom="full"]').addEventListener('click', function () {
      if (document.fullscreenElement) document.exitFullscreen();
      else if (board.requestFullscreen) board.requestFullscreen();
    });
    board.querySelector('[data-goto]').addEventListener('change', function (event) {
      var id = event.target.value;
      var frame = id && svg.querySelector('[data-frame="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]');
      if (frame) {
        var b = frame.getAttribute('data-box').split(' ').map(Number);
        show(b[0] - 40, b[1] - 40, b[2] + 80, b[3] + 80);
      }
      event.target.value = '';
    });
    var fitted = false;
    function first() { if (!fitted && size().w > 1) { fitted = true; show(0, 0, W, H); } }
    window.addEventListener('resize', function () { apply(); first(); });
    document.addEventListener('fullscreenchange', function () { setTimeout(apply, 50); });
    first();
    if (!fitted) apply();
  });
})();
</script>`;
