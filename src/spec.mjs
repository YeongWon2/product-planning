// spec.md 읽기와 기획 4단계(기획 상세 스펙) 검사 (docs/spec-guide.md, docs/harness.md 5장 12~17).
import { listTree, readStatus, sections, splitIds, tableRows } from './md.mjs';
import { sentenceCount } from './text.mjs';

export const SPEC_STEPS = { 12: '기획 › 4-1. 상태 수립', 13: '기획 › 4-2. 조건 수립', 14: '기획 › 4-3. 단위 나누기', 15: '기획 › 4-4. 단위별 트리', 16: '기획 › 4-5. 요구사항 대조', 17: '기획 › 4-6. 확정' };
export const MAX_BRANCH_DEPTH = 3;
export const SEP = ' › ';
const PROGRESS = ['대기', '작성중', '완료'];
const KIND = { F: '피쳐', FN: '함수' };

export function parseSpec(source) {
  const lines = source.split(/\r?\n/);
  const spec = { status: readStatus(lines), title: lines.find((line) => line.startsWith('# '))?.slice(2).trim() ?? '', states: [], conditions: [], progress: [], units: [], unknown: [] };
  for (const section of sections(lines)) {
    const unit = section.title.match(/^((FN|F)\d+)\s*·\s*([^·]+?)(?:\s*·\s*(.+))?$/);
    if (section.title === '상태표') {
      spec.states = tableRows(section.body).map(({ cells: [target, state, meaning = ''], line }) => ({ target, state, meaning, line }));
    } else if (section.title === '조건표') {
      spec.conditions = tableRows(section.body).map(({ cells: [name, branches = '', decided = ''], line }) => ({ name, branches: splitIds(branches), decided, line }));
    } else if (section.title === '진행표') {
      spec.progress = tableRows(section.body).map(({ cells: [id, name, requirements = '', status], line }) => ({ id, name, requirements: splitIds(requirements), status, line }));
    } else if (unit) {
      spec.units.push({ id: unit[1], kind: KIND[unit[2]], name: unit[3].trim(), requirements: splitIds(unit[4] ?? ''), line: section.line, nodes: listTree(section.body).map(classify) });
    } else {
      spec.unknown.push({ title: section.title, line: section.line });
    }
  }
  return spec;
}

function classify(node) {
  const branch = node.text.match(/^\*\*(.+)\*\*$/);
  const kind = node.text.startsWith('? ') ? 'condition' : node.text.startsWith('◆ ') ? 'state' : branch ? 'branch' : node.text.startsWith('↪ ') ? 'call' : 'step';
  return { ...node, kind, label: branch ? branch[1].trim() : node.text.slice(2).trim(), children: node.children.map(classify) };
}

const isTerminal = (node) => node.kind === 'call' || node.text.includes('→') || node.text.includes('⇒');

// 트리의 모든 줄과 경로. 요구사항 대조의 근거 줄, 개발 스펙의 출처로 쓴다.
export function linePaths(spec) {
  const paths = [];
  const walk = (node, prefix, unit) => {
    const path = prefix + SEP + node.text;
    paths.push({ path, line: node.line, node, unit });
    node.children.forEach((child) => walk(child, path, unit));
  };
  for (const unit of spec.units) unit.nodes.forEach((node) => walk(node, unit.id, unit));
  return paths;
}

// 사용자 행동 줄: [단추] 누름처럼 대괄호로 시작하고 "진입"이 아닌 줄이다.
export const isAction = (node) => node.kind === 'step' && /^\[[^\]]+\]\s*(?!진입)\S/.test(node.text);

// → 뒤의 화면 결과 문장들.
export function results(spec) {
  return new Set(linePaths(spec).map(({ node }) => node.text.match(/→\s*(.+)$/)?.[1].trim()).filter(Boolean));
}

export function checkSpec(spec, plan) {
  const issues = [];
  const add = (step, kind, message, line) => issues.push({ step, kind, message, line });
  const statesOf = new Map();
  for (const { target, state } of spec.states) statesOf.set(target, [...(statesOf.get(target) ?? []), state]);
  const allStates = new Set(spec.states.map(({ state }) => state));
  const conditions = new Map(spec.conditions.map((condition) => [condition.name, condition]));
  const functions = new Map(spec.units.filter((unit) => unit.kind === '함수').map((unit) => [unit.id, unit]));
  const used = { states: new Set(), conditions: new Set(), functions: new Set() };

  if (spec.states.length === 0) add(12, '상태표 비었음', '대상마다 어떤 상태를 거치는지 상태표가 있어야 완성이다.');
  if (spec.conditions.length === 0) add(13, '조건표 비었음', '흐름을 가르는 조건과 갈래가 조건표에 있어야 완성이다.');
  for (const condition of spec.conditions) {
    if (condition.branches.length < 2) add(13, '갈래 부족', `조건 "${condition.name}"에 갈래가 둘 이상 있어야 한다.`, condition.line);
  }
  for (const { title, line } of spec.unknown) add(14, '모르는 머리', `"## ${title}"는 작성법에 없는 머리다. F번호 · 이름 · R번호 또는 FN번호 · 이름으로 쓴다.`, line);

  const requirementIds = new Set(plan.requirements.map((requirement) => requirement.id));
  const featured = new Set(spec.units.filter((unit) => unit.kind === '피쳐').flatMap((unit) => unit.requirements));
  if (spec.units.length === 0) add(14, '단위 없음', '요구사항을 피쳐와 함수로 나눈 단위가 있어야 완성이다.');
  for (const requirement of plan.requirements) {
    if (!featured.has(requirement.id)) add(14, '피쳐 없는 요구사항', `${requirement.id} ${requirement.name}을 다루는 피쳐가 있어야 완성이다.`);
  }
  const ids = new Set();
  for (const unit of spec.units) {
    if (ids.has(unit.id)) add(14, '번호 겹침', `단위 번호 ${unit.id}가 두 번 나온다.`, unit.line);
    ids.add(unit.id);
    for (const id of unit.requirements) if (!requirementIds.has(id)) add(14, '없는 요구사항', `${unit.id} ${unit.name}의 ${id}가 기획에 없다.`, unit.line);
    const row = spec.progress.find((entry) => entry.id === unit.id);
    if (!row) add(14, '진행표 불일치', `${unit.id} ${unit.name}이 진행표에 없다.`, unit.line);
    else if (row.name !== unit.name) add(14, '진행표 불일치', `진행표에서 ${unit.id}의 이름이 "${row.name}"인데 트리는 "${unit.name}"이다.`, row.line);
  }
  for (const row of spec.progress) {
    if (!spec.units.some((unit) => unit.id === row.id)) add(14, '진행표 불일치', `진행표의 ${row.id} 트리가 없다.`, row.line);
    if (!PROGRESS.includes(row.status)) add(14, '진행표 불일치', `${row.id}의 진행은 ${PROGRESS.join(', ')} 중 하나여야 한다.`, row.line);
  }

  const walk = (node, unit, depth, parent, isLast) => {
    const where = `${unit.id}${SEP}${node.text}`;
    if (sentenceCount(node.kind === 'branch' ? node.label : node.text.replace(/^(\?|◆|↪)\s+/, '')) > 1) add(15, '한 줄 두 문장', `${where}를 한 줄에 한 문장으로 나눈다.`, node.line);
    if (node.kind === 'branch' && parent?.kind !== 'condition' && parent?.kind !== 'state') add(15, '갈래 위치', `${where}는 ? 또는 ◆ 바로 아래에만 쓴다.`, node.line);
    // 형제 줄은 위에서 아래로 이어지는 순서이므로, 끝은 마지막 줄에서만 본다.
    if (node.children.length === 0 && isLast && !isTerminal(node)) add(15, '끝 없는 가지', `${where} 다음에 무엇이 되는지(→, ⇒, ↪) 있어야 완성이다.`, node.line);
    const nextDepth = node.kind === 'condition' || node.kind === 'state' ? depth + 1 : depth;
    if (nextDepth > MAX_BRANCH_DEPTH && nextDepth > depth) add(15, '너무 깊은 트리', `${where}에서 분기가 ${MAX_BRANCH_DEPTH}단계를 넘는다. 함수로 잘라낸다.`, node.line);
    if (node.kind === 'condition') checkBranches(node, conditions.get(node.label)?.branches, `조건표에 "${node.label}"가 없다.`, '빠진 갈래', where, used.conditions, add);
    if (node.kind === 'state') {
      const target = node.label.replace(/\s*상태$/, '');
      checkBranches(node, statesOf.get(target), `상태표에 대상 "${target}"가 없다.`, '빠진 상태', where, used.states, add, true);
    }
    if (node.kind === 'condition' && conditions.has(node.label)) used.conditions.add(node.label);
    if (node.kind === 'call') {
      const [id, ...rest] = node.label.split(/\s+/);
      used.functions.add(id);
      const target = functions.get(id);
      if (!target) add(15, '없는 함수', `${where}가 부르는 FN 트리가 없다.`, node.line);
      else if (rest.length && rest.join(' ') !== target.name) add(15, '없는 함수', `${where}의 이름이 ${id} "${target.name}"과 다르다.`, node.line);
    }
    const transition = node.text.match(/⇒\s*(.+?)\s*→\s*(.+)$/);
    if (transition) {
      for (const state of [transition[1].trim(), transition[2].trim()]) {
        if (allStates.has(state)) used.states.add(state);
        else add(15, '없는 재료', `${where}의 상태 "${state}"가 상태표에 없다.`, node.line);
      }
    }
    node.children.forEach((child, index) => walk(child, unit, nextDepth, node, index === node.children.length - 1));
  };
  for (const unit of spec.units) {
    if (unit.nodes.length === 0) add(15, '빈 트리', `${unit.id} ${unit.name}에 줄이 있어야 완성이다.`, unit.line);
    unit.nodes.forEach((node, index) => walk(node, unit, 0, null, index === unit.nodes.length - 1));
  }
  if (spec.units.length) {
    for (const state of allStates) if (!used.states.has(state)) add(15, '안 쓰인 재료', `상태 "${state}"가 어느 트리에도 없다. 빠졌는지 표에서 뺄지 정해야 완성이다.`);
    for (const { name, line } of spec.conditions) if (!used.conditions.has(name)) add(15, '안 쓰인 재료', `조건 "${name}"가 어느 트리에도 없다. 빠졌는지 표에서 뺄지 정해야 완성이다.`, line);
    for (const [id, unit] of functions) if (!used.functions.has(id)) add(15, '안 쓰인 함수', `${id} ${unit.name}을 부르는 곳이 없다.`, unit.line);
  }

  if (spec.status !== '확정') add(17, '확정 전', '사람이 기획 상세 스펙을 읽고 확정하면 상태: 확정으로 바꾼다.');
  return issues;
}

function checkBranches(node, expected, unknownMessage, missingKind, where, used, add, markEach = false) {
  const branches = node.children.filter((child) => child.kind === 'branch').map((child) => child.label);
  for (const child of node.children) if (child.kind !== 'branch') add(15, '갈래 위치', `${where} 바로 아래는 **갈래**만 쓴다.`, child.line);
  if (!expected) return add(15, '없는 재료', `${where}: ${unknownMessage}`, node.line);
  for (const branch of expected) if (!branches.includes(branch)) add(15, missingKind, `${where} 아래 '${branch}' 갈래가 없다.`, node.line);
  for (const branch of branches) if (!expected.includes(branch)) add(15, '없는 재료', `${where} 아래 '${branch}'는 표에 없는 갈래다.`, node.line);
  if (markEach) branches.filter((branch) => expected.includes(branch)).forEach((branch) => used.add(branch));
}
