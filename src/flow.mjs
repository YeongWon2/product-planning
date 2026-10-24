// 기획 상세 스펙에서 유저 플로우(Mermaid flowchart)를 만든다 (docs/harness.md 6장).
// 사람이 그리지 않는다. 확정된 흐름을 그대로 옮기므로 글과 그림이 어긋나지 않는다.
import { FLOWS } from './spec.mjs';

// Mermaid가 따옴표·꺾쇠·백틱을 문법이나 HTML로 읽지 않게 엔티티로 바꿔 쓴다.
const ENTITIES = { '"': '#quot;', '<': '#lt;', '>': '#gt;', '`': '#96;' };
const label = (text) => `"${text.replace(/["<>`]/g, (char) => ENTITIES[char])}"`;
const nodeId = (unitId, stepId) => `${unitId}_${stepId}`;

// 단위 하나를 subgraph 줄로 낸다. 갈림 머리는 갈라진 단계에서 나오는 화살표 이름이 된다.
function unitLines(unit) {
  const lines = [`  subgraph ${unit.id}[${label(`${unit.id} ${unit.name}`)}]`];
  const edges = [];
  const item = (name) => unit.items.find((entry) => entry.name === name)?.value;
  const startId = `${unit.id}_start`;
  const doneId = `${unit.id}_done`;
  const stopId = `${unit.id}_stop`;
  let stopped = false;
  lines.push(`    ${startId}([${label(item('시작') ? `시작: ${item('시작')}` : `${unit.id} 시작`)}])`);
  const main = (unit.flows['기본 흐름']?.nodes ?? []).filter((node) => node.id && node.kind !== 'extension');
  const target = (node) => {
    if (node.kind === 'end') {
      stopped = true;
      return stopId;
    }
    if (node.kind === 'return') return nodeId(unit.id, node.target);
    if (node.kind === 'call') return `${node.call.id}_start`;
    return null;
  };
  const step = (node) => {
    const next = target(node);
    if (!next) lines.push(`    ${nodeId(unit.id, node.id)}[${label(`${node.id}. ${node.label}`)}]`);
    return next ?? nodeId(unit.id, node.id);
  };
  // 이어지는 단계를 차례로 잇고, 마지막 노드 id를 낸다.
  const chain = (from, nodes, first) => {
    let previous = from;
    nodes.forEach((node, index) => {
      const id = step(node);
      edges.push(index === 0 && first ? first(previous, id) : `    ${previous} --> ${id}`);
      previous = id;
    });
    return previous;
  };
  const last = chain(startId, main);
  lines.push(`    ${doneId}([${label(item('성공 결과') ? `성공: ${item('성공 결과')}` : '끝')}])`);
  edges.push(`    ${last} --> ${doneId}`);

  for (const name of FLOWS.slice(1)) {
    const arrow = name === '예외 흐름' ? '-.->' : '-->';
    const walk = (nodes) => nodes.filter((node) => node.kind === 'extension').forEach((extension) => {
      const from = nodeId(unit.id, extension.id.slice(0, -1));
      const steps = extension.children.filter((child) => child.kind !== 'extension' && child.id);
      if (steps.length) chain(from, steps, (previous, id) => `    ${previous} ${arrow}|${label(`${extension.id}. ${extension.label}`)}| ${id}`);
      walk(extension.children);
      steps.forEach((child) => walk(child.children));
    });
    walk(unit.flows[name]?.nodes ?? []);
  }
  if (stopped) lines.push(`    ${stopId}((${label('끝')}))`);
  lines.push('  end');
  return [...lines, ...edges];
}

export function userFlow(spec) {
  return ['flowchart TD', ...spec.units.flatMap(unitLines)].join('\n');
}

// 결과물 flow.md 본문. 제목과 기준 문서 줄은 내보낼 때 붙인다.
export function flowDocument(spec, title) {
  return [
    `# ${title} 유저 플로우`,
    '기획 상세 스펙에서 만든 그림이다. 고칠 때는 기획 상세 스펙을 고친다. 점선은 예외 흐름이다.',
    `\`\`\`mermaid\n${userFlow(spec)}\n\`\`\``,
  ];
}
