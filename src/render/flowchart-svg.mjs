import { escapeHtml, truncate } from './escape.mjs';
import { layoutUntilClean } from './layout-check.mjs';

// 플로우차트 한 장의 배치. 본 줄기는 왼쪽 한 열로 위에서 아래로, 판단의 갈래는 그 줄 오른쪽으로 뻗는다.
// 갈래가 여러 개면 아래로 쌓고, 그만큼 그 줄의 높이를 늘려 다음 줄과 겹치지 않게 한다.
const MARGIN = 24;
const NODE_WIDTH = 220;
const LINE_HEIGHT = 18;
const ROW_GAP = 44;
const BRANCH_GAP = 170;
const CHAIN_GAP = 56;
const CHAIN_VGAP = 40;
const TRUNK_OFFSET = 28;
const LABEL_CHAR = 11;
const LABEL_HEIGHT = 14;
const LABEL_MAX = 12;
// 한 줄에 들어가는 글자 수. 마름모는 안쪽이 좁아 더 짧게 끊는다.
const WRAP = { decision: 10, default: 14 };

// 줄 바꿈(\n)은 그대로 두고, 한 줄이 max를 넘으면 낱말 사이에서 끊는다.
export function wrap(text, max) {
  return String(text).split('\n').flatMap((paragraph) => wrapLine(paragraph, max));
}

function wrapLine(text, max) {
  const lines = [];
  let line = '';
  for (const word of String(text).split(' ')) {
    let rest = word;
    while ([...rest].length > max) {
      if (line) { lines.push(line); line = ''; }
      lines.push([...rest].slice(0, max).join(''));
      rest = [...rest].slice(max).join('');
    }
    const next = line ? `${line} ${rest}` : rest;
    if ([...next].length > max && line) {
      lines.push(line);
      line = rest;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.length === 0 ? [''] : lines;
}

function sizeOf(node) {
  const lines = wrap(node.text, WRAP[node.type] ?? WRAP.default);
  if (node.type === 'decision') return { lines, h: Math.max(84, lines.length * LINE_HEIGHT + 48) };
  if (node.type === 'start' || node.type === 'end') return { lines, h: Math.max(40, lines.length * LINE_HEIGHT + 16) };
  return { lines, h: lines.length * LINE_HEIGHT + 22 };
}

const labelWidth = (text) => Math.min([...text].length, LABEL_MAX) * LABEL_CHAR + 8;

// spacing을 주면 그 간격으로 한 번 그린다. 주지 않으면 겹침이 없어질 때까지 간격을 넓혀 다시 그린다.
export function layoutFlowchart(chart, spacing) {
  if (spacing !== undefined) return layoutAt(chart, spacing);
  return layoutUntilClean((step) => layoutAt(chart, step));
}

function layoutAt(chart, S) {
  const ROW = ROW_GAP * S;
  const BRANCH = BRANCH_GAP * S;
  const CHAIN = CHAIN_GAP * S;
  const CHAIN_V = CHAIN_VGAP * S;
  const LIFT = 14 * S;
  const byId = new Map(chart.nodes.map((node) => [node.id, node]));
  const outgoing = (id, kind) => chart.edges.filter((edge) => edge.from === id && edge.kind === kind);

  const main = [];
  for (let id = chart.nodes.find((node) => node.type === 'start')?.id; id !== undefined && !main.includes(id);) {
    main.push(id);
    id = outgoing(id, 'main')[0]?.to;
  }
  // 갈래: 판단에서 나간 '아니오' 선을 따라 오른쪽으로 이어지는 상자들
  const chainFrom = (id) => {
    const chain = [id];
    for (let next = outgoing(id, 'no')[0]; next && !chain.includes(next.to); next = outgoing(next.to, 'no')[0]) chain.push(next.to);
    return chain;
  };

  const boxes = new Map();
  const place = (id, x, y) => {
    const { lines, h } = sizeOf(byId.get(id));
    boxes.set(id, { id, type: byId.get(id).type, lines, x, y, w: NODE_WIDTH, h });
  };
  const heightOf = (id) => sizeOf(byId.get(id)).h;
  const branchX = MARGIN + NODE_WIDTH + BRANCH;

  // 갈래 선의 이름표가 들어갈 자리(LIFT + 이름표)를 줄 사이에 남긴다.
  let rowTop = MARGIN + LIFT + LABEL_HEIGHT + 4;
  for (const id of main) {
    const chains = outgoing(id, 'no').map((edge) => chainFrom(edge.to)).filter((chain) => chain.every((member) => !boxes.has(member) && !main.includes(member)));
    const mainH = heightOf(id);
    const chainHeights = chains.map((chain) => Math.max(...chain.map(heightOf)));
    const firstCenter = rowTop + Math.max(mainH, chainHeights[0] ?? 0) / 2;
    place(id, MARGIN, firstCenter - mainH / 2);
    let bottom = firstCenter + mainH / 2;
    let chainTop = firstCenter - (chainHeights[0] ?? 0) / 2;
    chains.forEach((chain, k) => {
      const center = chainTop + chainHeights[k] / 2;
      chain.forEach((member, position) => place(member, branchX + position * (NODE_WIDTH + CHAIN), center - heightOf(member) / 2));
      chainTop += chainHeights[k] + CHAIN_V;
      bottom = Math.max(bottom, center + chainHeights[k] / 2);
    });
    rowTop = bottom + ROW;
  }
  // 본 줄기·갈래 어디에도 닿지 않은 상자는 맨 아래에 둔다.
  for (const node of chart.nodes.filter((item) => !boxes.has(item.id))) {
    place(node.id, MARGIN, rowTop);
    rowTop += heightOf(node.id) + ROW;
  }

  const cx = (box) => box.x + box.w / 2;
  const cy = (box) => box.y + box.h / 2;
  // 상자 위쪽에 들어오는 선은 왼쪽(35%), 나가는 선은 오른쪽(65%)에 붙여 서로 포개지지 않게 한다.
  const topIn = (box) => box.x + box.w * 0.35;
  const topOut = (box) => box.x + box.w * 0.65;
  const routes = chart.edges.filter((edge) => boxes.has(edge.from) && boxes.has(edge.to)).map((edge) => {
    const source = boxes.get(edge.from);
    const target = boxes.get(edge.to);
    const label = truncate(edge.label, LABEL_MAX);
    const w = labelWidth(label);
    let points;
    let labelBox = null;
    if (edge.kind === 'main') {
      points = [[cx(source), source.y + source.h], [cx(target), target.y]];
      if (label) labelBox = { x: cx(source) + 8, y: (source.y + source.h + target.y) / 2 - LABEL_HEIGHT / 2, w, h: LABEL_HEIGHT };
    } else if (edge.kind === 'loop') {
      // 되돌아가기: 위로 올라가 처리 상자의 오른쪽으로 들어간다.
      const x = topOut(source);
      points = [[x, source.y], [x, cy(target)], [target.x + target.w, cy(target)]];
      if (label) labelBox = { x: x + 6, y: (source.y + cy(target)) / 2 - LABEL_HEIGHT / 2, w, h: LABEL_HEIGHT };
    } else if (source.x === MARGIN) {
      // 본 줄기의 판단에서 갈래로: 오른쪽으로 나와 위로 올라갔다가 옆으로 가서 상자 위로 내려간다.
      // 갈래가 여럿이면 마름모 오른쪽 아래 변에서 조금씩 낮게 나가고 세로 통로도 비껴 세운다.
      const k = outgoing(edge.from, 'no').indexOf(edge);
      const dy = k * 10 * S;
      const startX = source.x + source.w - (dy * source.w) / source.h;
      const startY = cy(source) + dy;
      const trunk = source.x + source.w + (TRUNK_OFFSET + k * 10) * S;
      const lane = target.y - LIFT;
      const x = topIn(target);
      points = [[startX, startY], [trunk, startY], [trunk, lane], [x, lane], [x, target.y]];
      if (label) labelBox = { x: (trunk + x) / 2 - w / 2, y: lane - LABEL_HEIGHT - 2, w, h: LABEL_HEIGHT };
    } else {
      // 갈래 안에서 다음 상자로: 위로 → 옆으로 → 아래로
      const lane = Math.min(source.y, target.y) - LIFT;
      points = [[topOut(source), source.y], [topOut(source), lane], [topIn(target), lane], [topIn(target), target.y]];
      if (label) labelBox = { x: (topOut(source) + topIn(target)) / 2 - w / 2, y: lane - LABEL_HEIGHT - 2, w, h: LABEL_HEIGHT };
    }
    return { from: edge.from, to: edge.to, kind: edge.kind, label, points, labelBox };
  });

  const all = [...boxes.values()];
  const labelRight = routes.filter((route) => route.labelBox).map((route) => route.labelBox.x + route.labelBox.w);
  const width = Math.max(...all.map((box) => box.x + box.w), ...labelRight) + MARGIN;
  const height = Math.max(...all.map((box) => box.y + box.h)) + MARGIN;
  return { nodes: all, routes, width, height };
}

function textMarkup(box) {
  const top = box.y + box.h / 2 - ((box.lines.length - 1) * LINE_HEIGHT) / 2 + 5;
  const tspans = box.lines.map((line, i) => `<tspan x="${box.x + box.w / 2}" y="${top + i * LINE_HEIGHT}">${escapeHtml(line)}</tspan>`).join('');
  return `<text class="fc-text">${tspans}</text>`;
}

function shapeMarkup(box) {
  if (box.type === 'decision') {
    const { x, y, w, h } = box;
    return `<polygon class="fc-decision" points="${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}"/>`;
  }
  const rounded = box.type === 'start' || box.type === 'end';
  return `<rect class="fc-${box.type}" x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="${rounded ? box.h / 2 : 6}"/>`;
}

// <svg> 없이 그룹 안에 들어갈 내용만 만든다. 스타일과 화살표는 담는 쪽(도화지)이 정의한다.
export function renderFlowchart(chart) {
  const { nodes, routes, width, height, collisions = [], spacing = 1 } = layoutFlowchart(chart);
  const edges = routes.map((route) => {
    const d = route.points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x} ${y}`).join(' ');
    const label = route.labelBox
      ? `<text class="fc-label" x="${route.labelBox.x + route.labelBox.w / 2}" y="${route.labelBox.y + route.labelBox.h / 2 + 4}">${escapeHtml(route.label)}</text>`
      : '';
    return `<g class="fc-edge fc-edge-${route.kind}"><path d="${d}" marker-end="url(#board-arrow)"/>${label}</g>`;
  }).join('');
  const boxes = nodes.map((box) => `<g data-flow-node="${escapeHtml(box.id)}" data-node-type="${box.type}">${shapeMarkup(box)}${textMarkup(box)}</g>`).join('');
  return { markup: edges + boxes, width, height, collisions, spacing };
}
