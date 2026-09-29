import { escapeHtml, truncate } from './escape.mjs';

// 한글 13px 기준 한 글자 약 13px. '항목 상세 · 관리자 웹'처럼 앱 이름이 붙은 이름이 들어가는 폭이다.
const NODE_WIDTH = 216;
const NODE_HEIGHT = 44;
// 열 사이 간격은 가장 긴 이동 이름표(LABEL_MAX 글자)가 상자를 덮지 않고 들어가는 폭이다.
const COLUMN_GAP = 144;
const ROW_GAP = 24;
const LANE_PADDING = 24;
const LANE_LABEL_WIDTH = 120;
const NAME_MAX = 15;
const LABEL_MAX = 10;
const LABEL_CHAR = 11;
const LABEL_HEIGHT = 14;
// 되돌아가는 이동이 지나는 통로. 세로 통로는 열 사이 빈칸에, 가로 통로는 레인 맨 아래에 둔다.
const CHANNEL_STEP = 6;
const CHANNEL_SLOTS = 8;
// 되돌아가는 이동은 상자 아래쪽 절반에 붙여 가운데를 지나는 앞으로 가는 선과 포개지지 않게 한다.
// 한 면에 여러 선이 붙으면 그 절반을 나눠 쓴다.
const BACK_TOP = 5;
const BACK_BOTTOM_MARGIN = 4;
const GUTTER_TOP = 26;
const GUTTER_STEP = 18;

// 진입점에서 몇 번 이동해야 닿는지로 열을 정한다. 닿지 않는 화면은 첫 열에 둔다.
function ranks(screens, edges, entries) {
  const rank = new Map(entries.map((id) => [id, 0]));
  const queue = [...entries];
  while (queue.length > 0) {
    const from = queue.shift();
    for (const edge of edges) {
      if (edge.from === from && !rank.has(edge.to)) {
        rank.set(edge.to, rank.get(from) + 1);
        queue.push(edge.to);
      }
    }
  }
  return new Map(screens.map((screen) => [screen.id, rank.get(screen.id) ?? 0]));
}

// 같은 열 안에서는 앞 열에서 들어오는 화면들의 평균 위치 순서로 놓아 선이 덜 교차하게 한다.
function orderColumns(members, edges, rankOf) {
  const byRank = new Map();
  for (const screen of members) {
    const rank = rankOf.get(screen.id);
    byRank.set(rank, [...(byRank.get(rank) ?? []), screen]);
  }
  const rowOf = new Map();
  for (const rank of [...byRank.keys()].sort((a, b) => a - b)) {
    const column = byRank.get(rank);
    const keyOf = (screen) => {
      const rows = edges.filter((edge) => edge.to === screen.id && rowOf.has(edge.from) && rankOf.get(edge.from) === rank - 1).map((edge) => rowOf.get(edge.from));
      return rows.length === 0 ? Number.POSITIVE_INFINITY : rows.reduce((sum, row) => sum + row, 0) / rows.length;
    };
    const keys = new Map(column.map((screen) => [screen.id, keyOf(screen)]));
    [...column].sort((a, b) => keys.get(a.id) - keys.get(b.id)).forEach((screen, row) => rowOf.set(screen.id, row));
  }
  return rowOf;
}

const columnX = (rank) => LANE_LABEL_WIDTH + COLUMN_GAP / 2 + rank * (NODE_WIDTH + COLUMN_GAP);
const labelWidth = (text) => Math.min([...text].length, LABEL_MAX) * LABEL_CHAR + 8;

export function layoutFlow({ apps, screens, edges, entries }) {
  const rankOf = ranks(screens, edges, entries);
  const laneOrder = [
    ...apps.map((app) => ({ id: app.id, name: app.name })),
    ...[...new Set(screens.map((screen) => screen.app))]
      .filter((id) => !apps.some((app) => app.id === id))
      .map((id) => ({ id, name: '(알 수 없는 앱)' })),
  ].filter((lane) => screens.some((screen) => screen.app === lane.id));
  const screenById = new Map(screens.map((screen) => [screen.id, screen]));
  const known = edges.filter((edge) => screenById.has(edge.from) && screenById.has(edge.to));
  const isForward = (edge) => rankOf.get(edge.to) > rankOf.get(edge.from);
  // 열이 다른 되돌아가는 이동은 도착 레인 아래 가로 통로를 하나씩 쓴다.
  const viaGutter = (edge) => !isForward(edge) && rankOf.get(edge.to) !== rankOf.get(edge.from);
  const gutterCount = new Map();
  const gutterIndex = new Map();
  for (const edge of known.filter(viaGutter)) {
    const lane = screenById.get(edge.to).app;
    gutterIndex.set(edge, gutterCount.get(lane) ?? 0);
    gutterCount.set(lane, (gutterCount.get(lane) ?? 0) + 1);
  }

  const nodes = [];
  const lanes = [];
  let laneTop = 0;
  for (const lane of laneOrder) {
    const members = screens.filter((screen) => screen.app === lane.id);
    const rowOf = orderColumns(members, known, rankOf);
    for (const screen of members) {
      nodes.push({
        id: screen.id,
        lane: lane.id,
        x: columnX(rankOf.get(screen.id)),
        y: laneTop + LANE_PADDING + rowOf.get(screen.id) * (NODE_HEIGHT + ROW_GAP),
        w: NODE_WIDTH,
        h: NODE_HEIGHT,
      });
    }
    const rows = Math.max(...rowOf.values()) + 1;
    const nodesBottom = laneTop + LANE_PADDING + rows * NODE_HEIGHT + (rows - 1) * ROW_GAP;
    const gutters = gutterCount.get(lane.id) ?? 0;
    const height = nodesBottom - laneTop + LANE_PADDING + (gutters > 0 ? GUTTER_TOP + (gutters - 1) * GUTTER_STEP : 0);
    lanes.push({ id: lane.id, name: lane.name, y: laneTop, height, gutterY: nodesBottom + GUTTER_TOP });
    laneTop += height;
  }

  const maxRank = Math.max(0, ...rankOf.values());
  const width = columnX(maxRank) + NODE_WIDTH + COLUMN_GAP / 2;
  const routes = routeEdges({ nodes, lanes, edges: known, isForward, viaGutter, gutterIndex });
  return { nodes, lanes, routes, width, height: Math.max(laneTop, NODE_HEIGHT) };
}

function routeEdges({ nodes, lanes, edges, isForward, viaGutter, gutterIndex }) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const laneById = new Map(lanes.map((lane) => [lane.id, lane]));
  // 같은 틈을 여러 선이 지나면 조금씩 비껴 세운다. 틈의 가운데는 앞으로 가는 이동의 이름표 자리로 남긴다.
  const slots = new Map();
  const slot = (key) => {
    const used = slots.get(key) ?? 0;
    slots.set(key, used + 1);
    return (used % CHANNEL_SLOTS) * CHANNEL_STEP;
  };
  const leftChannel = (node) => node.x - 10 - slot(`L${node.x}`);
  const rightChannel = (node) => node.x + node.w + 10 + slot(`R${node.x}`);
  const mid = (node) => node.y + node.h / 2;
  // 면마다 붙는 되돌아가는 선의 수를 먼저 세어 높이를 고르게 나눈다.
  const sideCount = new Map();
  const sideOf = (edge) => (viaGutter(edge) ? [[edge.from, 'L'], [edge.to, 'R']] : [[edge.from, 'L'], [edge.to, 'L']]);
  for (const edge of edges.filter((item) => !isForward(item))) {
    for (const [id, side] of sideOf(edge)) sideCount.set(`${id}:${side}`, (sideCount.get(`${id}:${side}`) ?? 0) + 1);
  }
  const sideUsed = new Map();
  const low = (node, side) => {
    const key = `${node.id}:${side}`;
    const count = sideCount.get(key) ?? 1;
    const index = sideUsed.get(key) ?? 0;
    sideUsed.set(key, index + 1);
    const room = node.h / 2 - BACK_TOP - BACK_BOTTOM_MARGIN;
    return mid(node) + BACK_TOP + (count === 1 ? room / 2 : (index * room) / (count - 1));
  };

  const placed = [];
  const free = (box) => !nodes.some((node) => overlap(box, node)) && !placed.some((other) => overlap(box, other));
  // 후보 자리를 차례로 보고 처음으로 비어 있는 곳에 둔다. 모두 막혀 있으면 첫 후보에 둔다.
  function placeLabel(text, candidates) {
    const w = labelWidth(text);
    const boxes = candidates.map(([cx, cy]) => ({ x: cx - w / 2, y: cy - LABEL_HEIGHT / 2, w, h: LABEL_HEIGHT }));
    const box = boxes.find(free) ?? boxes[0];
    placed.push(box);
    return box;
  }
  const along = ([x1, y1], [x2, y2], dy = 0) => [0.5, 0.3, 0.7, 0.15, 0.85].flatMap((t) => [0, -16, 16].map((shift) => [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t + dy + shift]));

  return edges.map((edge) => {
    const source = nodeById.get(edge.from);
    const target = nodeById.get(edge.to);
    let points;
    let candidates;
    if (isForward(edge)) {
      points = [[source.x + source.w, mid(source)], [target.x, mid(target)]];
      candidates = along(points[0], points[1], -8);
    } else if (viaGutter(edge)) {
      const x1 = leftChannel(source);
      const x2 = rightChannel(target);
      const y = laneById.get(target.lane).gutterY + gutterIndex.get(edge) * GUTTER_STEP;
      const y1 = low(source, 'L');
      const y2 = low(target, 'R');
      points = [[source.x, y1], [x1, y1], [x1, y], [x2, y], [x2, y2], [target.x + target.w, y2]];
      candidates = along([x1, y], [x2, y], -8);
    } else {
      // 같은 열 안에서 돌아가는 이동은 왼쪽 틈으로 내려가 옆으로 들어간다.
      const x = leftChannel(source);
      const y1 = low(source, 'L');
      const y2 = low(target, 'L');
      points = [[source.x, y1], [x, y1], [x, y2], [target.x, y2]];
      const w = labelWidth(edge.label);
      candidates = along([x, y1], [x, y2]).map(([, cy]) => [x - 4 - w / 2, cy]);
    }
    const labelBox = placeLabel(edge.label, candidates);
    return { from: edge.from, to: edge.to, label: edge.label, points, labelBox };
  });
}

function overlap(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

const SHAPE = {
  screen: { rx: 6, className: 'node-screen' },
  modal: { rx: 6, className: 'node-modal' },
  confirm: { rx: 6, className: 'node-confirm' },
  notification: { rx: 22, className: 'node-notification' },
};

export function renderFlowSvg(input) {
  const { nodes, lanes, routes, width, height } = layoutFlow(input);
  const screenById = new Map(input.screens.map((screen) => [screen.id, screen]));

  const laneMarkup = lanes.map((lane, position) => [
    `<rect class="${position % 2 === 0 ? 'lane-even' : 'lane-odd'}" x="0" y="${lane.y}" width="${width}" height="${lane.height}"/>`,
    `<text class="lane-name" x="12" y="${lane.y + LANE_PADDING + NODE_HEIGHT / 2 + 4}">${escapeHtml(truncate(lane.name, 8))}</text>`,
  ].join('')).join('');

  const edgeMarkup = routes.map((route) => {
    const d = route.points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x} ${y}`).join(' ');
    const { x, y, w, h } = route.labelBox;
    return `<g class="edge"><path d="${d}" marker-end="url(#arrow)"/><text x="${x + w / 2}" y="${y + h / 2 + 4}">${escapeHtml(truncate(route.label, LABEL_MAX))}</text></g>`;
  }).join('');

  const nodeMarkup = nodes.map((node) => {
    const screen = screenById.get(node.id);
    const shape = SHAPE[screen.type] ?? SHAPE.screen;
    return `<g data-spec-id="${escapeHtml(node.id)}" data-spec-kind="screen" data-screen-type="${escapeHtml(screen.type)}">`
      + `<title>${escapeHtml(screen.name)}</title>`
      + `<rect class="${shape.className}" x="${node.x}" y="${node.y}" width="${node.w}" height="${node.h}" rx="${shape.rx}"/>`
      + `<text class="node-name" x="${node.x + node.w / 2}" y="${node.y + node.h / 2 + 5}">${escapeHtml(truncate(screen.name, NAME_MAX))}</text>`
      + '</g>';
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="화면 흐름도">`
    + '<style>'
    + '.lane-even{fill:#f6f7f9}.lane-odd{fill:#ffffff}.lane-name{font:600 13px sans-serif;fill:#4a5160}'
    + '.edge path{fill:none;stroke:#8a93a3;stroke-width:1.4}.edge text{font:11px sans-serif;fill:#5b6372;text-anchor:middle;paint-order:stroke;stroke:#ffffff;stroke-width:3px;stroke-linejoin:round}'
    + '.node-screen,.node-modal,.node-confirm,.node-notification{fill:#ffffff;stroke:#3d4452;stroke-width:1.4}'
    + '.node-modal{stroke-dasharray:5 4}.node-confirm{stroke:#c2410c;stroke-width:1.8}.node-notification{fill:#eef4ff;stroke:#2f5fd0}'
    + '.node-name{font:600 13px sans-serif;fill:#1f2430;text-anchor:middle}'
    + '</style>'
    + '<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#8a93a3"/></marker></defs>'
    + laneMarkup + edgeMarkup + nodeMarkup
    + '</svg>';
}
