import { escapeHtml, truncate } from './escape.mjs';

// 플로우차트 한 장의 배치. 본 줄기는 왼쪽 한 열로 위에서 아래로, 판단의 갈래는 그 줄 오른쪽으로 뻗는다.
// 갈래가 여러 개면 아래로 쌓고, 그만큼 그 줄의 높이를 늘려 다음 줄과 겹치지 않게 한다.
const MARGIN = 24;
const NODE_WIDTH = 220;
const LINE_HEIGHT = 18;
const ROW_GAP = 36;
const BRANCH_GAP = 170;
const CHAIN_GAP = 56;
const CHAIN_VGAP = 16;
const TRUNK_OFFSET = 28;
const LABEL_CHAR = 11;
const LABEL_HEIGHT = 14;
const LABEL_MAX = 12;
// 한 줄에 들어가는 글자 수. 마름모는 안쪽이 좁아 더 짧게 끊는다.
const WRAP = { decision: 10, default: 14 };

export function wrap(text, max) {
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

export function layoutFlowchart(chart) {
  const byId = new Map(chart.nodes.map((node) => [node.id, node]));
  const outgoing = (id, kind) => chart.edges.filter((edge) => edge.from === id && edge.kind === kind);

  const main = [];
  for (let id = chart.nodes.find((node) => node.type === 'start')?.id; id !== undefined;) {
    main.push(id);
    id = outgoing(id, 'main')[0]?.to;
  }
  // 갈래: 판단에서 나간 '아니오' 선을 따라 오른쪽으로 이어지는 상자들
  const chainFrom = (id) => {
    const chain = [id];
    for (let next = outgoing(id, 'no')[0]; next; next = outgoing(next.to, 'no')[0]) chain.push(next.to);
    return chain;
  };

  const boxes = new Map();
  const place = (id, x, y) => {
    const { lines, h } = sizeOf(byId.get(id));
    boxes.set(id, { id, type: byId.get(id).type, lines, x, y, w: NODE_WIDTH, h });
  };
  const heightOf = (id) => sizeOf(byId.get(id)).h;
  const branchX = MARGIN + NODE_WIDTH + BRANCH_GAP;

  let rowTop = MARGIN;
  for (const id of main) {
    const chains = outgoing(id, 'no').map((edge) => chainFrom(edge.to));
    const mainH = heightOf(id);
    const chainHeights = chains.map((chain) => Math.max(...chain.map(heightOf)));
    const firstCenter = rowTop + Math.max(mainH, chainHeights[0] ?? 0) / 2;
    place(id, MARGIN, firstCenter - mainH / 2);
    let bottom = firstCenter + mainH / 2;
    let chainTop = firstCenter - (chainHeights[0] ?? 0) / 2;
    chains.forEach((chain, k) => {
      const center = chainTop + chainHeights[k] / 2;
      chain.forEach((member, position) => place(member, branchX + position * (NODE_WIDTH + CHAIN_GAP), center - heightOf(member) / 2));
      chainTop += chainHeights[k] + CHAIN_VGAP;
      bottom = Math.max(bottom, center + chainHeights[k] / 2);
    });
    rowTop = bottom + ROW_GAP;
  }
  // 본 줄기·갈래 어디에도 닿지 않은 상자는 맨 아래에 둔다.
  for (const node of chart.nodes.filter((item) => !boxes.has(item.id))) {
    place(node.id, MARGIN, rowTop);
    rowTop += heightOf(node.id) + ROW_GAP;
  }

  const cx = (box) => box.x + box.w / 2;
  const cy = (box) => box.y + box.h / 2;
  const routes = chart.edges.filter((edge) => boxes.has(edge.from) && boxes.has(edge.to)).map((edge) => {
    const source = boxes.get(edge.from);
    const target = boxes.get(edge.to);
    const label = truncate(edge.label, LABEL_MAX);
    let points;
    let labelBox = null;
    if (edge.kind === 'main') {
      points = [[cx(source), source.y + source.h], [cx(target), target.y]];
      if (label) labelBox = { x: cx(source) + 8, y: (source.y + source.h + target.y) / 2 - LABEL_HEIGHT / 2, w: labelWidth(label), h: LABEL_HEIGHT };
    } else if (edge.kind === 'loop') {
      points = [[cx(source), source.y], [cx(source), cy(target)], [target.x + target.w, cy(target)]];
      if (label) labelBox = { x: cx(source) + 6, y: (source.y + cy(target)) / 2 - LABEL_HEIGHT / 2, w: labelWidth(label), h: LABEL_HEIGHT };
    } else if (source.x === MARGIN) {
      // 본 줄기의 판단에서 오른쪽 갈래로
      const startX = source.x + source.w;
      const trunk = startX + TRUNK_OFFSET;
      points = cy(source) === cy(target)
        ? [[startX, cy(source)], [target.x, cy(target)]]
        : [[startX, cy(source)], [trunk, cy(source)], [trunk, cy(target)], [target.x, cy(target)]];
      const from = cy(source) === cy(target) ? startX : trunk;
      if (label) labelBox = { x: (from + target.x) / 2 - labelWidth(label) / 2, y: cy(target) - LABEL_HEIGHT - 3, w: labelWidth(label), h: LABEL_HEIGHT };
    } else {
      points = [[source.x + source.w, cy(source)], [target.x, cy(target)]];
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
  const { nodes, routes, width, height } = layoutFlowchart(chart);
  const edges = routes.map((route) => {
    const d = route.points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x} ${y}`).join(' ');
    const label = route.labelBox
      ? `<text class="fc-label" x="${route.labelBox.x + route.labelBox.w / 2}" y="${route.labelBox.y + route.labelBox.h / 2 + 4}">${escapeHtml(route.label)}</text>`
      : '';
    return `<g class="fc-edge fc-edge-${route.kind}"><path d="${d}" marker-end="url(#board-arrow)"/>${label}</g>`;
  }).join('');
  const boxes = nodes.map((box) => `<g data-flow-node="${escapeHtml(box.id)}" data-node-type="${box.type}">${shapeMarkup(box)}${textMarkup(box)}</g>`).join('');
  return { markup: edges + boxes, width, height };
}
