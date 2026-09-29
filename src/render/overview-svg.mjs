import { escapeHtml, truncate } from './escape.mjs';
import { wrap } from './flowchart-svg.mjs';
import { findCollisions, layoutUntilClean } from './layout-check.mjs';

// 전체 흐름도 배치. 서비스 틀을 왼쪽에서 오른쪽으로, 그 안에 앱 틀을 위에서 아래로, 앱 안의 화면은 진입점에서의 거리로 열을 정한다.
// 한 서비스 안의 앱들은 열 위치를 함께 쓰므로 열 사이 틈이 위아래로 곧게 이어진다. 선은 이 틈과 위쪽 통로로만 다닌다.
//   선 경로: 출발 화면 오른쪽 → 출발 열 오른쪽 틈 → 위쪽 통로 → 도착 열 왼쪽 틈 → 도착 화면 왼쪽 (위로 → 옆으로 → 아래로)
//   같은 서비스 안의 이동은 그 서비스 틀 위쪽 통로, 서비스를 넘나드는 영향과 API 호출은 모든 틀 위의 통로를 쓴다.
const NODE_W = 200;
const WRAP_AT = 14;
const LINE = 16;
const LABEL_MAX = 10;
const LABEL_CHAR = 11;
const LABEL_H = 14;
const MARGIN = 24;

function ranksWithin(app, edges) {
  const inApp = new Set(app.screens);
  const incoming = new Set(edges.filter((edge) => inApp.has(edge.from) && inApp.has(edge.to)).map((edge) => edge.to));
  const roots = app.screens.filter((id) => !incoming.has(id));
  const rank = new Map((roots.length > 0 ? roots : app.screens.slice(0, 1)).map((id) => [id, 0]));
  const queue = [...rank.keys()];
  while (queue.length > 0) {
    const from = queue.shift();
    for (const edge of edges) {
      if (edge.from === from && inApp.has(edge.to) && !rank.has(edge.to)) { rank.set(edge.to, rank.get(from) + 1); queue.push(edge.to); }
    }
  }
  for (const id of app.screens) if (!rank.has(id)) rank.set(id, 0);
  return rank;
}

export function layoutOverview(overview, index, spacing = 1) {
  const S = spacing;
  const COL_GAP = 48 * S;
  const ROW_GAP = 18 * S;
  const CH = 8 * S;
  const LANE = 22 * S;
  const APP_HEAD = 30;
  const APP_PAD = 12 * S;
  const SVC_HEAD = 36;
  const SVC_PAD = 12 * S;
  const SVC_GAP = 72 * S;

  const screenName = (id) => {
    const screen = overview.names?.[id];
    return screen ?? id;
  };
  const nodeH = (name) => wrap(name, WRAP_AT).length * LINE + 16;

  // 서비스마다 열 번호. 앱들이 열을 함께 쓴다.
  const placeOf = new Map();
  const services = overview.services.map((service) => {
    let columns = 1;
    const apps = service.apps.map((app) => {
      const rank = ranksWithin(app, overview.edges);
      columns = Math.max(columns, ...[...rank.values()].map((r) => r + 1));
      for (const id of app.screens) placeOf.set(id, { service: service.id, app: app.id, column: rank.get(id) });
      return { ...app, rank };
    });
    return { ...service, apps, columns };
  });
  for (const system of overview.systems) placeOf.set(system.id, { service: null, app: null, column: 0, system: true });

  // 선마다 출발 틈·도착 틈의 자리와 통로 번호를 정한다.
  const gapUse = new Map();
  const take = (key, side) => {
    const entry = gapUse.get(key) ?? { out: 0, in: 0 };
    const slot = entry[side];
    entry[side] += 1;
    gapUse.set(key, entry);
    return slot;
  };
  const serviceLanes = new Map();
  let globalLanes = 0;
  const plans = overview.edges.filter((edge) => placeOf.has(edge.from) && placeOf.has(edge.to)).map((edge) => {
    const from = placeOf.get(edge.from);
    const to = placeOf.get(edge.to);
    const outGap = `${from.service}:${from.column + 1}`;
    const inGap = to.system ? 'systems' : `${to.service}:${to.column}`;
    const local = !to.system && from.service === to.service;
    const lane = local ? (serviceLanes.set(from.service, (serviceLanes.get(from.service) ?? 0) + 1), serviceLanes.get(from.service) - 1) : globalLanes++;
    return { edge, from, to, outGap, inGap, local, lane, outSlot: take(outGap, 'out'), inSlot: take(inGap, 'in') };
  });
  const gapWidth = (key) => {
    const use = gapUse.get(key) ?? { out: 0, in: 0 };
    return Math.max(COL_GAP, (use.out + use.in) * CH + 32 * S);
  };

  // 가로 배치
  const globalTop = MARGIN;
  const servicesTop = globalTop + globalLanes * LANE + (globalLanes > 0 ? 16 * S : 0);
  let x = MARGIN;
  const columnX = new Map();
  const containers = [];
  const labels = [];
  for (const service of services) {
    const xs = [];
    let cx = x + SVC_PAD + gapWidth(`${service.id}:0`);
    for (let c = 0; c < service.columns; c += 1) {
      xs.push(cx);
      cx += NODE_W + gapWidth(`${service.id}:${c + 1}`);
    }
    columnX.set(service.id, xs);
    service.x = x;
    service.w = cx - x + SVC_PAD;
    x = service.x + service.w + SVC_GAP;
  }
  const systemsGap = gapWidth('systems');
  const systemsX = x - SVC_GAP + systemsGap;

  // 세로 배치
  const nodes = [];
  let bottom = servicesTop;
  for (const service of services) {
    const lanes = serviceLanes.get(service.id) ?? 0;
    service.y = servicesTop;
    service.laneTop = service.y + SVC_HEAD;
    let y = service.laneTop + lanes * LANE + (lanes > 0 ? 12 * S : 0);
    const xs = columnX.get(service.id);
    for (const app of service.apps) {
      const appBox = { id: app.id, service: service.id, kind: 'app', x: service.x + 6, y, w: service.w - 12, h: 0 };
      const heights = new Array(service.columns).fill(0);
      const rowsTop = y + APP_HEAD;
      for (const id of app.screens) {
        const column = app.rank.get(id);
        const name = screenName(id);
        const h = nodeH(name);
        nodes.push({ id, name, app: app.id, type: overview.types?.[id] ?? 'screen', x: xs[column], y: rowsTop + heights[column], w: NODE_W, h });
        heights[column] += h + ROW_GAP;
      }
      appBox.h = APP_HEAD + Math.max(40, ...heights) + APP_PAD - (app.screens.length > 0 ? ROW_GAP : 0);
      containers.push(appBox);
      labels.push({ x: xs[0], y: y + 8, w: Math.min(NODE_W, [...app.name].length * 13 + 4), h: 16, text: app.name });
      y = appBox.y + appBox.h + 10 * S;
    }
    service.h = y - service.y + SVC_PAD - 10 * S;
    containers.unshift({ id: service.id, kind: 'service', x: service.x, y: service.y, w: service.w, h: service.h });
    labels.push({ x: xs[0], y: service.y + 10, w: Math.min(NODE_W, [...service.name].length * 15 + 4), h: 18, text: service.name });
    bottom = Math.max(bottom, service.y + service.h);
  }
  let sy = servicesTop + SVC_HEAD;
  for (const system of overview.systems) {
    const h = nodeH(system.name) + 8;
    nodes.push({ id: system.id, name: system.name, type: system.kind, x: systemsX, y: sy, w: NODE_W, h });
    sy += h + 24 * S;
    bottom = Math.max(bottom, sy);
  }

  // 선 경로. 한 상자의 같은 면에 붙는 선은 높이를 나눠 쓴다.
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const sideCount = new Map();
  for (const plan of plans) {
    for (const key of [`${plan.edge.from}:R`, `${plan.edge.to}:L`]) sideCount.set(key, (sideCount.get(key) ?? 0) + 1);
  }
  const sideUsed = new Map();
  const attach = (node, side) => {
    const key = `${node.id}:${side}`;
    const n = sideCount.get(key);
    const i = sideUsed.get(key) ?? 0;
    sideUsed.set(key, i + 1);
    return node.y + ((i + 1) * node.h) / (n + 1);
  };
  const serviceById = new Map(services.map((service) => [service.id, service]));
  const routes = plans.map((plan) => {
    const source = byId.get(plan.edge.from);
    const target = byId.get(plan.edge.to);
    const outStart = source.x + source.w;
    const exitX = outStart + 14 * S + plan.outSlot * CH;
    const inEnd = target.x;
    const entryX = inEnd - 14 * S - plan.inSlot * CH;
    const laneY = plan.local
      ? serviceById.get(plan.from.service).laneTop + 18 * S + plan.lane * LANE
      : globalTop + 18 * S + plan.lane * LANE;
    const y1 = attach(source, 'R');
    const y2 = attach(target, 'L');
    return {
      from: plan.edge.from, to: plan.edge.to, kind: plan.edge.kind, label: truncate(plan.edge.label ?? '', LABEL_MAX),
      points: [[outStart, y1], [exitX, y1], [exitX, laneY], [entryX, laneY], [entryX, y2], [inEnd, y2]], labelBox: null,
    };
  });

  // 이름표: 통로 선 바로 위. 그 높이를 지나는 세로선을 뺀 빈 구간 중 선의 가운데에 가장 가까운 곳에 둔다.
  const verticals = routes.flatMap((route) => route.points.slice(1).map((end, i) => [route, route.points[i], end]).filter(([, a, b]) => a[0] === b[0]));
  const placed = [...labels];
  for (const route of routes) {
    if (!route.label) continue;
    const [, , [x1, lane], [x2]] = route.points;
    const w = [...route.label].length * LABEL_CHAR + 8;
    const y = lane - LABEL_H - 2;
    const lo = Math.min(x1, x2) - NODE_W;
    const hi = Math.max(x1, x2) + NODE_W;
    const middle = (x1 + x2) / 2;
    // 이 높이를 지나는 세로선과 이미 놓은 글자가 막는 구간
    const blocked = [
      ...verticals.filter(([other, a, b]) => other !== route && Math.max(a[1], b[1]) > y - 1 && Math.min(a[1], b[1]) < y + LABEL_H + 1).map(([, a]) => [a[0] - 3, a[0] + 3]),
      ...placed.filter((box) => box.y < y + LABEL_H + 1 && y - 1 < box.y + box.h).map((box) => [box.x - 4, box.x + box.w + 4]),
      ...nodes.filter((node) => node.y < y + LABEL_H && y < node.y + node.h).map((node) => [node.x - 4, node.x + node.w + 4]),
    ].sort((a, b) => a[0] - b[0]);
    const free = [];
    let cursor = lo;
    for (const [start, end] of blocked) {
      if (start > cursor) free.push([cursor, Math.min(start, hi)]);
      cursor = Math.max(cursor, end);
      if (cursor >= hi) break;
    }
    if (cursor < hi) free.push([cursor, hi]);
    const fits = free.filter(([a, b]) => b - a >= w).map(([a, b]) => {
      const x = Math.min(Math.max(middle - w / 2, a), b - w);
      return { x, distance: Math.abs(x + w / 2 - middle) };
    }).sort((a, b) => a.distance - b.distance);
    route.labelBox = { x: fits.length > 0 ? fits[0].x : middle - w / 2, y, w, h: LABEL_H };
    placed.push(route.labelBox);
  }

  const width = Math.max(systemsX + (overview.systems.length > 0 ? NODE_W : 0), ...services.map((service) => service.x + service.w)) + MARGIN;
  const height = bottom + MARGIN;
  return { nodes, routes, containers, labels, width, height };
}

function overlapBox(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

const NODE_CLASS = { screen: 'ov-screen', modal: 'ov-modal', confirm: 'ov-confirm', notification: 'ov-notify', api: 'ov-api', external: 'ov-external' };

export function renderOverview(overview, index) {
  const layout = layoutUntilClean((spacing) => layoutOverview(overview, index, spacing));
  const { nodes, routes, containers, labels, width, height, collisions, spacing } = layout;
  const boxes = containers.map((box) => `<rect class="${box.kind === 'service' ? 'ov-service' : 'ov-app'}" x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="${box.kind === 'service' ? 14 : 8}"/>`).join('');
  const titles = labels.map((box) => `<text class="${box.h > 16 ? 'ov-service-name' : 'ov-app-name'}" x="${box.x}" y="${box.y + box.h - 4}">${escapeHtml(box.text)}</text>`).join('');
  const lines = routes.map((route) => {
    const d = route.points.map(([px, py], i) => `${i === 0 ? 'M' : 'L'}${px} ${py}`).join(' ');
    const label = route.labelBox ? `<text class="ov-label" x="${route.labelBox.x + route.labelBox.w / 2}" y="${route.labelBox.y + route.labelBox.h - 3}">${escapeHtml(route.label)}</text>` : '';
    return `<g class="ov-edge ov-edge-${route.kind}"><path d="${d}" marker-end="url(#board-arrow)"/>${label}</g>`;
  }).join('');
  const shapes = nodes.map((node) => {
    const lines = wrap(node.name, WRAP_AT);
    const top = node.y + node.h / 2 - ((lines.length - 1) * LINE) / 2 + 5;
    const text = lines.map((line, i) => `<tspan x="${node.x + node.w / 2}" y="${top + i * LINE}">${escapeHtml(line)}</tspan>`).join('');
    return `<g data-overview-node="${escapeHtml(node.id)}"><rect class="${NODE_CLASS[node.type] ?? 'ov-screen'}" x="${node.x}" y="${node.y}" width="${node.w}" height="${node.h}" rx="${node.type === 'api' || node.type === 'external' ? 4 : 8}"/><text class="ov-name">${text}</text></g>`;
  }).join('');
  return { markup: boxes + titles + lines + shapes, width, height, collisions, spacing };
}

export { findCollisions };
