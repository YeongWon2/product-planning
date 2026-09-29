import { escapeHtml, truncate } from './escape.mjs';

// 개체 하나의 상태 변화 그림. 상태를 한 줄에 놓고, 앞으로 가는 전이는 위 통로, 되돌아가는 전이는 아래 통로로 그린다.
// 이웃한 상태 사이의 전이만 직선이다.
const NODE_HEIGHT = 36;
const NODE_PAD = 24;
const CHAR = 13;
const GAP = 64;
const MARGIN = 16;
const CHANNEL_STEP = 22;
const LABEL_MAX = 12;
const LABEL_CHAR = 11;
const LABEL_HEIGHT = 14;

// 진행 상태는 시작 상태에서 닿는 순서, 끝 상태는 적은 순서대로 뒤에 둔다. 어디에도 닿지 않는 상태는 맨 뒤다.
function orderStates(entity) {
  const initial = entity.states.filter((state) => state.initial === true).map((state) => state.id);
  const seen = new Set(initial);
  const reached = [...initial];
  for (let i = 0; i < reached.length; i += 1) {
    for (const transition of entity.transitions) {
      if (transition.from === reached[i] && !seen.has(transition.to) && entity.states.some((state) => state.id === transition.to)) {
        seen.add(transition.to);
        reached.push(transition.to);
      }
    }
  }
  const byId = new Map(entity.states.map((state) => [state.id, state]));
  const ongoing = reached.map((id) => byId.get(id)).filter((state) => state.terminal !== true);
  const terminal = entity.states.filter((state) => state.terminal === true && seen.has(state.id));
  const unreached = entity.states.filter((state) => !seen.has(state.id));
  return [...ongoing, ...terminal, ...unreached];
}

const labelWidth = (text) => [...truncate(text, LABEL_MAX)].length * LABEL_CHAR + 8;

export function layoutStates(entity, index) {
  const ordered = orderStates(entity);
  const labelOf = (transition) => (index.has(transition.action) ? index.name(transition.action) : String(transition.action));
  // 이웃한 상태 사이의 틈은 그 사이를 잇는 이름표가 들어갈 만큼 넓힌다.
  const gapAfter = (i) => {
    const next = ordered[i + 1];
    if (!next) return 0;
    const widths = entity.transitions.filter((t) => t.from === ordered[i].id && t.to === next.id).map((t) => labelWidth(labelOf(t)) + 16);
    return Math.max(GAP, ...widths);
  };
  const nodes = [];
  let x = MARGIN;
  const y0 = MARGIN;
  ordered.forEach((state, i) => {
    const name = index.name(state.id);
    const w = Math.max(72, [...name].length * CHAR + NODE_PAD * 2);
    nodes.push({ id: state.id, name, x, y: 0, w, h: NODE_HEIGHT, initial: state.initial === true, terminal: state.terminal === true });
    x += w + gapAfter(i);
  });
  const position = new Map(nodes.map((node, i) => [node.id, i]));
  const byId = new Map(nodes.map((node) => [node.id, node]));

  // 같은 방향으로 멀리 뛰는 전이일수록 바깥 통로를 쓴다.
  const transitions = entity.transitions.filter((transition) => byId.has(transition.from) && byId.has(transition.to));
  const above = transitions.filter((t) => position.get(t.to) > position.get(t.from) + 1 || t.from === t.to);
  const below = transitions.filter((t) => position.get(t.to) < position.get(t.from));
  const rank = (list) => {
    const sorted = [...list].sort((a, b) => Math.abs(position.get(a.to) - position.get(a.from)) - Math.abs(position.get(b.to) - position.get(b.from)));
    return new Map(sorted.map((t, i) => [t, i]));
  };
  const aboveRank = rank(above);
  const belowRank = rank(below);
  const top = y0 + above.length * CHANNEL_STEP + (above.length > 0 ? 8 : 0);
  for (const node of nodes) node.y = top;
  const bottom = top + NODE_HEIGHT;

  // 한 상태의 같은 면(위·아래)에 여러 선이 붙으면 나가는 선은 오른쪽 절반, 들어오는 선은 왼쪽 절반을 나눠 쓴다.
  const sideCount = new Map();
  const sideKey = (id, side, dir) => `${id}:${side}:${dir}`;
  const count = (key) => sideCount.set(key, (sideCount.get(key) ?? 0) + 1);
  for (const t of above) { count(sideKey(t.from, 'top', 'out')); count(sideKey(t.to, 'top', 'in')); }
  for (const t of below) { count(sideKey(t.from, 'bottom', 'out')); count(sideKey(t.to, 'bottom', 'in')); }
  const used = new Map();
  const slotX = (node, side, dir) => {
    const key = sideKey(node.id, side, dir);
    const n = sideCount.get(key) ?? 1;
    const i = used.get(key) ?? 0;
    used.set(key, i + 1);
    const [from, to] = dir === 'out' ? [0.55, 0.9] : [0.1, 0.45];
    return node.x + node.w * (from + ((to - from) * (i + 1)) / (n + 1));
  };
  const placed = [];
  const routes = transitions.map((transition) => {
    const source = byId.get(transition.from);
    const target = byId.get(transition.to);
    const label = labelOf(transition);
    const w = labelWidth(label);
    let points;
    let labelBox;
    if (above.includes(transition)) {
      const y = top - 8 - aboveRank.get(transition) * CHANNEL_STEP;
      const x1 = slotX(source, 'top', 'out');
      const x2 = slotX(target, 'top', 'in');
      points = [[x1, top], [x1, y], [x2, y], [x2, top]];
      labelBox = { x: (x1 + x2) / 2 - w / 2, y: y - LABEL_HEIGHT - 1, w, h: LABEL_HEIGHT };
    } else if (below.includes(transition)) {
      const y = bottom + 8 + belowRank.get(transition) * CHANNEL_STEP;
      const x1 = slotX(source, 'bottom', 'out');
      const x2 = slotX(target, 'bottom', 'in');
      points = [[x1, bottom], [x1, y], [x2, y], [x2, bottom]];
      labelBox = { x: (x1 + x2) / 2 - w / 2, y: y + 2, w, h: LABEL_HEIGHT };
    } else {
      const y = top + NODE_HEIGHT / 2;
      points = [[source.x + source.w, y], [target.x, y]];
      labelBox = { x: (source.x + source.w + target.x) / 2 - w / 2, y: y - LABEL_HEIGHT - 2, w, h: LABEL_HEIGHT };
    }
    // 이웃 직선 이름표가 위 통로 이름표와 겹치면 선 아래로 내린다.
    if (placed.some((other) => overlap(other, labelBox))) labelBox = { ...labelBox, y: top + NODE_HEIGHT / 2 + 3 };
    placed.push(labelBox);
    return { from: transition.from, to: transition.to, label, points, labelBox };
  });

  const width = x + MARGIN;
  const height = bottom + (below.length > 0 ? 8 + below.length * CHANNEL_STEP + LABEL_HEIGHT : 0) + MARGIN;
  return { nodes, routes, width, height };
}

function overlap(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function renderStates(entity, index) {
  const { nodes, routes, width, height } = layoutStates(entity, index);
  const markerId = `st-arrow-${String(entity.id).replace(/[^A-Za-z0-9_-]/g, '_')}`;
  const edges = routes.map((route) => {
    const d = route.points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x} ${y}`).join(' ');
    return `<g class="st-edge"><path d="${d}" marker-end="url(#${markerId})"/><text class="st-label" x="${route.labelBox.x + route.labelBox.w / 2}" y="${route.labelBox.y + route.labelBox.h - 3}">${escapeHtml(truncate(route.label, LABEL_MAX))}</text></g>`;
  }).join('');
  const boxes = nodes.map((node) => `<g data-state="${escapeHtml(node.id)}"${node.initial ? ' data-initial="true"' : ''}${node.terminal ? ' data-terminal="true"' : ''}>`
    + `<rect class="st-node${node.terminal ? ' st-terminal' : ''}" x="${node.x}" y="${node.y}" width="${node.w}" height="${node.h}" rx="${node.h / 2}"/>`
    + (node.initial ? `<circle class="st-initial" cx="${node.x - 8}" cy="${node.y + node.h / 2}" r="4"/>` : '')
    + `<text class="st-name" x="${node.x + node.w / 2}" y="${node.y + node.h / 2 + 5}">${escapeHtml(node.name)}</text></g>`).join('');
  return `<svg class="state-diagram" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${escapeHtml(`'${index.name(entity.id)}' 상태 변화`)}">`
    + `<defs><marker id="${markerId}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#6b7385"/></marker></defs>`
    + '<style>.st-node{fill:#eef4ff;stroke:#2f5fd0;stroke-width:1.4}.st-terminal{fill:#f6f7f9;stroke:#3d4452}.st-initial{fill:#2f5fd0}.st-name{font:600 13px sans-serif;fill:#1f2430;text-anchor:middle}.st-edge path{fill:none;stroke:#6b7385;stroke-width:1.4}.st-label{font:11px sans-serif;fill:#5b6372;text-anchor:middle;paint-order:stroke;stroke:#ffffff;stroke-width:3px;stroke-linejoin:round}</style>'
    + edges + boxes + '</svg>';
}
