// sdd.md 읽기와 SDD 단계 검사 (docs/sdd-guide.md, docs/harness.md 5장 8~11, 13).
import { listTree, readStatus, sections, tableRows } from './md.mjs';
import { sentenceCount } from './text.mjs';

export const SDD_STEPS = { 8: 'SDD › 1. 상태 수립', 9: 'SDD › 2. 조건 수립', 10: 'SDD › 3. 단위 나누기', 11: 'SDD › 4. 단위별 트리', 12: 'SDD › 5. 요구사항 대조', 13: 'SDD › 6. 확정' };
export const MAX_BRANCH_DEPTH = 3;
const PROGRESS = ['대기', '작성중', '완료'];
const SEP = ' › ';

export function parseSdd(source) {
  const lines = source.split(/\r?\n/);
  const sdd = { status: readStatus(lines), states: [], conditions: [], progress: [], units: [], unknown: [] };
  for (const section of sections(lines)) {
    const unit = section.title.match(/^(피쳐|함수)\s*·\s*([^·]+?)(?:\s*·\s*(.+))?$/);
    if (section.title === '상태표') {
      sdd.states = tableRows(section.body).map(({ cells: [target, state], line }) => ({ target, state, line }));
    } else if (section.title === '조건표') {
      sdd.conditions = tableRows(section.body).map(({ cells: [name, branches = ''], line }) => ({ name, branches: branches.split(',').map((b) => b.trim()).filter(Boolean), line }));
    } else if (section.title === '진행표') {
      sdd.progress = tableRows(section.body).map(({ cells: [name, kind, requirements = '', status], line }) => ({ name, kind, requirements: splitIds(requirements), status, line }));
    } else if (unit) {
      sdd.units.push({ kind: unit[1], name: unit[2].trim(), requirements: splitIds(unit[3] ?? ''), line: section.line, nodes: listTree(section.body).map(classify) });
    } else {
      sdd.unknown.push({ title: section.title, line: section.line });
    }
  }
  return sdd;
}

const splitIds = (text) => text.split(',').map((id) => id.trim()).filter(Boolean);

function classify(node) {
  const branch = node.text.match(/^\*\*(.+)\*\*$/);
  const kind = node.text.startsWith('? ') ? 'condition' : node.text.startsWith('◆ ') ? 'state' : branch ? 'branch' : node.text.startsWith('↪ ') ? 'call' : 'step';
  return { ...node, kind, label: branch ? branch[1].trim() : node.text.slice(2).trim(), children: node.children.map(classify) };
}

const isTerminal = (node) => node.kind === 'call' || node.text.includes('→') || node.text.includes('⇒');

// 트리의 모든 줄 경로. 요구사항 대조의 근거 줄로 쓴다.
export function linePaths(sdd) {
  const paths = [];
  const walk = (node, prefix) => {
    const path = prefix + SEP + node.text;
    paths.push({ path, line: node.line });
    node.children.forEach((child) => walk(child, path));
  };
  for (const unit of sdd.units) unit.nodes.forEach((node) => walk(node, unit.name));
  return paths;
}

export function checkSdd(sdd, plan) {
  const issues = [];
  const add = (step, kind, message, line) => issues.push({ step, kind, message, line });
  const statesOf = new Map();
  for (const { target, state } of sdd.states) statesOf.set(target, [...(statesOf.get(target) ?? []), state]);
  const allStates = new Set(sdd.states.map(({ state }) => state));
  const conditions = new Map(sdd.conditions.map((condition) => [condition.name, condition]));
  const functions = new Set(sdd.units.filter((unit) => unit.kind === '함수').map((unit) => unit.name));
  const used = { states: new Set(), conditions: new Set(), functions: new Set() };

  if (sdd.states.length === 0) add(8, '상태표 비었음', '대상마다 어떤 상태를 거치는지 상태표가 있어야 완성이다.');
  if (sdd.conditions.length === 0) add(9, '조건표 비었음', '흐름을 가르는 조건과 갈래가 조건표에 있어야 완성이다.');
  for (const condition of sdd.conditions) {
    if (condition.branches.length < 2) add(9, '갈래 부족', `조건 "${condition.name}"에 갈래가 둘 이상 있어야 한다.`, condition.line);
  }
  for (const { title, line } of sdd.unknown) add(10, '모르는 머리', `"## ${title}"는 작성법에 없는 머리다. 피쳐 · 이름 · R번호 또는 함수 · 이름으로 쓴다.`, line);

  const requirementIds = new Set(plan.requirements.map((requirement) => requirement.id));
  const featured = new Set(sdd.units.filter((unit) => unit.kind === '피쳐').flatMap((unit) => unit.requirements));
  if (sdd.units.length === 0) add(10, '단위 없음', '요구사항을 피쳐와 함수로 나눈 단위가 있어야 완성이다.');
  for (const requirement of plan.requirements) {
    if (!featured.has(requirement.id)) add(10, '피쳐 없는 요구사항', `${requirement.id} ${requirement.name}을 다루는 피쳐가 있어야 완성이다.`);
  }
  for (const unit of sdd.units) {
    for (const id of unit.requirements) if (!requirementIds.has(id)) add(10, '없는 요구사항', `${unit.name}의 ${id}가 기획에 없다.`, unit.line);
    const row = sdd.progress.find((entry) => entry.name === unit.name);
    if (!row) add(10, '진행표 불일치', `${unit.kind} ${unit.name}이 진행표에 없다.`, unit.line);
    else if (row.kind !== unit.kind) add(10, '진행표 불일치', `진행표에서 ${unit.name}의 종류가 ${row.kind}인데 트리는 ${unit.kind}다.`, row.line);
  }
  for (const row of sdd.progress) {
    if (!sdd.units.some((unit) => unit.name === row.name)) add(10, '진행표 불일치', `진행표의 ${row.name} 트리가 없다.`, row.line);
    if (!PROGRESS.includes(row.status)) add(10, '진행표 불일치', `${row.name}의 진행은 ${PROGRESS.join(', ')} 중 하나여야 한다.`, row.line);
  }

  const walk = (node, unit, depth, parent, isLast) => {
    const where = `${unit.name}${SEP}${node.text}`;
    if (sentenceCount(node.kind === 'branch' ? node.label : node.text.replace(/^(\?|◆|↪)\s+/, '')) > 1) add(11, '한 줄 두 문장', `${where}를 한 줄에 한 문장으로 나눈다.`, node.line);
    if (node.kind === 'branch' && parent?.kind !== 'condition' && parent?.kind !== 'state') add(11, '갈래 위치', `${where}는 ? 또는 ◆ 바로 아래에만 쓴다.`, node.line);
    // 형제 줄은 위에서 아래로 이어지는 순서이므로, 끝은 마지막 줄에서만 본다.
    if (node.children.length === 0 && isLast && !isTerminal(node)) add(11, '끝 없는 가지', `${where} 다음에 무엇이 되는지(→, ⇒, ↪) 있어야 완성이다.`, node.line);
    const nextDepth = node.kind === 'condition' || node.kind === 'state' ? depth + 1 : depth;
    if (nextDepth > MAX_BRANCH_DEPTH && nextDepth > depth) add(11, '너무 깊은 트리', `${where}에서 분기가 ${MAX_BRANCH_DEPTH}단계를 넘는다. 함수로 잘라낸다.`, node.line);
    if (node.kind === 'condition') checkBranches(node, conditions.get(node.label)?.branches, `조건표에 "${node.label}"가 없다.`, '빠진 갈래', where, used.conditions, add);
    if (node.kind === 'state') {
      const target = node.label.replace(/\s*상태$/, '');
      checkBranches(node, statesOf.get(target), `상태표에 대상 "${target}"가 없다.`, '빠진 상태', where, used.states, add, true);
    }
    if (node.kind === 'condition' && conditions.has(node.label)) used.conditions.add(node.label);
    if (node.kind === 'call') {
      used.functions.add(node.label);
      if (!functions.has(node.label)) add(11, '없는 함수', `${where}가 부르는 함수 트리가 없다.`, node.line);
    }
    const transition = node.text.match(/⇒\s*(.+?)\s*→\s*(.+)$/);
    if (transition) {
      for (const state of [transition[1].trim(), transition[2].trim()]) {
        if (allStates.has(state)) used.states.add(state);
        else add(11, '없는 재료', `${where}의 상태 "${state}"가 상태표에 없다.`, node.line);
      }
    }
    node.children.forEach((child, index) => walk(child, unit, nextDepth, node, index === node.children.length - 1));
  };
  for (const unit of sdd.units) {
    if (unit.nodes.length === 0) add(11, '빈 트리', `${unit.kind} ${unit.name}에 줄이 있어야 완성이다.`, unit.line);
    unit.nodes.forEach((node, index) => walk(node, unit, 0, null, index === unit.nodes.length - 1));
  }
  if (sdd.units.length) {
    for (const state of allStates) if (!used.states.has(state)) add(11, '안 쓰인 재료', `상태 "${state}"가 어느 트리에도 없다. 빠졌는지 표에서 뺄지 정해야 완성이다.`);
    for (const { name, line } of sdd.conditions) if (!used.conditions.has(name)) add(11, '안 쓰인 재료', `조건 "${name}"가 어느 트리에도 없다. 빠졌는지 표에서 뺄지 정해야 완성이다.`, line);
    for (const name of functions) if (!used.functions.has(name)) add(11, '안 쓰인 함수', `함수 ${name}을 부르는 곳이 없다.`);
  }

  if (sdd.status !== '확정') add(13, '확정 전', '사람이 SDD 스펙을 읽고 확정하면 상태: 확정으로 바꾼다.');
  return issues;
}

function checkBranches(node, expected, unknownMessage, missingKind, where, used, add, markEach = false) {
  const branches = node.children.filter((child) => child.kind === 'branch').map((child) => child.label);
  for (const child of node.children) if (child.kind !== 'branch') add(11, '갈래 위치', `${where} 바로 아래는 **갈래**만 쓴다.`, child.line);
  if (!expected) return add(11, '없는 재료', `${where}: ${unknownMessage}`, node.line);
  for (const branch of expected) if (!branches.includes(branch)) add(11, missingKind, `${where} 아래 '${branch}' 갈래가 없다.`, node.line);
  for (const branch of branches) if (!expected.includes(branch)) add(11, '없는 재료', `${where} 아래 '${branch}'는 표에 없는 갈래다.`, node.line);
  if (markEach) branches.filter((branch) => expected.includes(branch)).forEach((branch) => used.add(branch));
}
