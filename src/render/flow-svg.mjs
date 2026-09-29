import { escapeHtml, truncate } from './escape.mjs';

const NODE_WIDTH = 176;
const NODE_HEIGHT = 44;
const COLUMN_GAP = 72;
const ROW_GAP = 20;
const LANE_PADDING = 24;
const LANE_LABEL_WIDTH = 120;
const BACK_EDGE_DEPTH = 36;
const NAME_MAX = 12;
const LABEL_MAX = 10;

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

export function layoutFlow({ apps, screens, edges, entries }) {
  const rankOf = ranks(screens, edges, entries);
  const laneOrder = [
    ...apps.map((app) => ({ id: app.id, name: app.name })),
    ...[...new Set(screens.map((screen) => screen.app))]
      .filter((id) => !apps.some((app) => app.id === id))
      .map((id) => ({ id, name: '(알 수 없는 앱)' })),
  ].filter((lane) => screens.some((screen) => screen.app === lane.id));

  const nodes = [];
  const lanes = [];
  let laneTop = 0;
  for (const lane of laneOrder) {
    const stackAt = new Map();
    const members = screens.filter((screen) => screen.app === lane.id);
    for (const screen of members) {
      const rank = rankOf.get(screen.id);
      const stack = stackAt.get(rank) ?? 0;
      stackAt.set(rank, stack + 1);
      nodes.push({
        id: screen.id,
        lane: lane.id,
        x: LANE_LABEL_WIDTH + LANE_PADDING + rank * (NODE_WIDTH + COLUMN_GAP),
        y: laneTop + LANE_PADDING + stack * (NODE_HEIGHT + ROW_GAP),
        w: NODE_WIDTH,
        h: NODE_HEIGHT,
      });
    }
    const rows = Math.max(...stackAt.values());
    const height = LANE_PADDING * 2 + rows * NODE_HEIGHT + (rows - 1) * ROW_GAP + BACK_EDGE_DEPTH;
    lanes.push({ id: lane.id, name: lane.name, y: laneTop, height });
    laneTop += height;
  }

  const maxRank = Math.max(0, ...rankOf.values());
  const width = LANE_LABEL_WIDTH + LANE_PADDING * 2 + (maxRank + 1) * NODE_WIDTH + maxRank * COLUMN_GAP;
  return { nodes, lanes, width, height: Math.max(laneTop, NODE_HEIGHT) };
}

function edgePath(source, target) {
  if (target.x > source.x) {
    const x1 = source.x + source.w;
    const y1 = source.y + source.h / 2;
    const x2 = target.x;
    const y2 = target.y + target.h / 2;
    return { d: `M${x1} ${y1} L${x2} ${y2}`, labelX: (x1 + x2) / 2, labelY: (y1 + y2) / 2 - 6 };
  }
  // 같은 열이거나 뒤로 가는 이동은 아래로 휘게 그려 앞으로 가는 선과 겹치지 않게 한다.
  const x1 = source.x + source.w / 2;
  const y1 = source.y + source.h;
  const x2 = target.x + target.w / 2 + (target.x === source.x ? 24 : 0);
  const y2 = target.y + target.h;
  const bottom = Math.max(y1, y2) + BACK_EDGE_DEPTH;
  return { d: `M${x1} ${y1} C${x1} ${bottom} ${x2} ${bottom} ${x2} ${y2}`, labelX: (x1 + x2) / 2, labelY: bottom - 4 };
}

const SHAPE = {
  screen: { rx: 6, className: 'node-screen' },
  modal: { rx: 6, className: 'node-modal' },
  confirm: { rx: 6, className: 'node-confirm' },
  notification: { rx: 22, className: 'node-notification' },
};

export function renderFlowSvg(input) {
  const { nodes, lanes, width, height } = layoutFlow(input);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const screenById = new Map(input.screens.map((screen) => [screen.id, screen]));

  const laneMarkup = lanes.map((lane, position) => [
    `<rect class="${position % 2 === 0 ? 'lane-even' : 'lane-odd'}" x="0" y="${lane.y}" width="${width}" height="${lane.height}"/>`,
    `<text class="lane-name" x="12" y="${lane.y + LANE_PADDING + NODE_HEIGHT / 2 + 4}">${escapeHtml(truncate(lane.name, 8))}</text>`,
  ].join('')).join('');

  const edgeMarkup = input.edges.map((edge) => {
    const source = nodeById.get(edge.from);
    const target = nodeById.get(edge.to);
    if (!source || !target) return '';
    const { d, labelX, labelY } = edgePath(source, target);
    return `<g class="edge"><path d="${d}" marker-end="url(#arrow)"/><text x="${labelX}" y="${labelY}">${escapeHtml(truncate(edge.label, LABEL_MAX))}</text></g>`;
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
    + '.edge path{fill:none;stroke:#8a93a3;stroke-width:1.4}.edge text{font:11px sans-serif;fill:#5b6372;text-anchor:middle}'
    + '.node-screen,.node-modal,.node-confirm,.node-notification{fill:#ffffff;stroke:#3d4452;stroke-width:1.4}'
    + '.node-modal{stroke-dasharray:5 4}.node-confirm{stroke:#c2410c;stroke-width:1.8}.node-notification{fill:#eef4ff;stroke:#2f5fd0}'
    + '.node-name{font:600 13px sans-serif;fill:#1f2430;text-anchor:middle}'
    + '</style>'
    + '<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#8a93a3"/></marker></defs>'
    + laneMarkup + edgeMarkup + nodeMarkup
    + '</svg>';
}
