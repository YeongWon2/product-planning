// spec.md 읽기와 기획 4단계(기획 상세 스펙) 검사 (docs/spec-guide.md, docs/harness.md 5장 12~17).
// 단위마다 유스케이스 명세 틀(기본 흐름 · 대안 흐름 · 예외 흐름)로 쓴다. 기호 없이 번호와 낱말만 쓴다.
import { listTree, readStatus, sections, splitIds, tableRows } from './md.mjs';
import { sentenceCount } from './text.mjs';

export const SPEC_STEPS = { 12: '기획 › 4-1. 상태 수립', 13: '기획 › 4-2. 조건 수립', 14: '기획 › 4-3. 단위 나누기', 15: '기획 › 4-4. 단위별 흐름', 16: '기획 › 4-5. 요구사항 대조', 17: '기획 › 4-6. 확정' };
export const MAX_BRANCH_DEPTH = 3;
export const SEP = ' › ';
export const FLOWS = ['기본 흐름', '대안 흐름', '예외 흐름'];
const PROGRESS = ['대기', '작성중', '완료'];
const KIND = { F: '유스케이스', FN: '함수' };
// 유스케이스 항목. 우선순위·이해관계자는 PRD에 있어 두지 않는다.
export const ITEMS = ['목적', '행위자', '시작', '사전 조건', '기본 흐름 조건', '성공 결과', '실패 시 보장'];
const REQUIRED_ITEMS = ['목적', '행위자', '시작', '성공 결과', '실패 시 보장'];
// 예전 표기의 기호와 이모지. 어느 환경에서도 읽히게 낱말로 바꾸게 한다.
export const SYMBOLS = /[◆⇒↪→]|\*\*|\p{Extended_Pictographic}/u;
const STEP = /^(\d+(?:[a-z]\d+)*)\.\s+(.+)$/;
const EXTENSION = /^(\d+(?:[a-z]\d+)*[a-z])\.\s+(.+)$/;

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
      spec.units.push({ id: unit[1], kind: KIND[unit[2]], name: unit[3].trim(), requirements: splitIds(unit[4] ?? ''), line: section.line, ...readUnit(section.body) });
    } else {
      spec.unknown.push({ title: section.title, line: section.line });
    }
  }
  return spec;
}

// 유스케이스 항목 표와 ### 흐름 구역을 읽는다. 항목은 Cockburn·RUP 유스케이스 명세에서 PRD와 겹치지 않는 것만 둔다.
function readUnit(body) {
  const unit = { items: [], premises: [], flows: {}, noException: null, strayFlows: [] };
  let flow = null;
  let chunk = [];
  const head = [];
  const close = () => {
    if (flow) unit.flows[flow.name] = { line: flow.line, nodes: listTree(chunk).map(classify) };
    chunk = [];
  };
  for (const { text, line } of body) {
    const title = text.match(/^###\s+(.+)$/);
    if (title) {
      close();
      flow = { name: title[1].trim(), line };
      if (!FLOWS.includes(flow.name)) unit.strayFlows.push(flow);
      continue;
    }
    if (!flow) {
      head.push({ text, line });
      continue;
    }
    const none = text.match(/^-\s+없음:\s*(.*)$/);
    if (none && flow.name === '예외 흐름') unit.noException = { text: none[1].trim(), line };
    else chunk.push({ text, line });
  }
  close();
  unit.items = tableRows(head).map(({ cells: [name, value = ''], line }) => ({ name, value, line }));
  const premise = unit.items.find((item) => item.name === '기본 흐름 조건');
  if (premise && premise.value !== '없음') unit.premises = splitIds(premise.value).map((text) => ({ text, line: premise.line, ...material(text) }));
  return unit;
}

// "조건: 갈래" 또는 "대상 상태: 상태" 모양. 조건표·상태표의 말을 그대로 쓴다.
function material(label) {
  const at = label.lastIndexOf(': ');
  if (at < 0) return { subject: null, branch: null };
  return { subject: label.slice(0, at).trim(), branch: label.slice(at + 2).trim() };
}

function classify(node) {
  const extension = node.text.match(EXTENSION);
  const step = !extension && node.text.match(STEP);
  const children = node.children.map(classify);
  if (extension) return { ...node, kind: 'extension', id: extension[1], label: extension[2].trim(), ...material(extension[2].trim()), children };
  if (!step) return { ...node, kind: 'unnumbered', id: null, label: node.text, children };
  const label = step[2].trim();
  const back = label.match(/^(\S+?)(?:으로|로) 돌아간다$/);
  const call = label.match(/^(FN\d+)\s+(.+?)(?:을|를)\s+따른다$/);
  const transition = label.match(/(\S+)에서\s+(\S+?)(?:으로|로)\s+바뀐다$/);
  const kind = label === '끝난다' ? 'end' : back ? 'return' : call ? 'call' : transition ? 'transition' : /^사용자가\s/.test(label) ? 'action' : 'result';
  return { ...node, kind, id: step[1], label, target: back?.[1], call: call && { id: call[1], name: call[2].trim() }, transition: transition && [transition[1], transition[2]], children };
}

const isEnding = (node) => ['end', 'return', 'call'].includes(node.kind);
const walkNodes = (nodes, visit, parents = []) => nodes.forEach((node) => { visit(node, parents); walkNodes(node.children, visit, [...parents, node]); });

// 흐름의 모든 줄과 경로. 요구사항 대조의 근거 줄, 개발 스펙의 출처로 쓴다.
export function linePaths(spec) {
  const paths = [];
  for (const unit of spec.units) {
    for (const item of unit.items) paths.push({ path: `${unit.id}${SEP}${item.name}: ${item.value}`, line: item.line, node: { kind: 'item', text: item.value }, unit });
    for (const name of FLOWS) {
      if (unit.flows[name]) paths.push({ path: `${unit.id}${SEP}${name}`, line: unit.flows[name].line, node: { kind: 'flow', text: name }, unit });
      walkNodes(unit.flows[name]?.nodes ?? [], (node, parents) => {
        paths.push({ path: [unit.id, name, ...parents.map((parent) => parent.text), node.text].join(SEP), line: node.line, node, unit });
      });
    }
  }
  return paths;
}

// 사용자 행동 줄: "사용자가"로 시작하는 단계다.
export const isAction = (node) => node.kind === 'action';

// 화면에 보이는 결과 문장들.
export function results(spec) {
  return new Set(linePaths(spec).filter(({ node }) => node.kind === 'result').map(({ node }) => node.label));
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
  const featured = new Set(spec.units.filter((unit) => unit.kind === '유스케이스').flatMap((unit) => unit.requirements));
  if (spec.units.length === 0) add(14, '단위 없음', '요구사항을 유스케이스와 함수로 나눈 단위가 있어야 완성이다.');
  for (const requirement of plan.requirements) {
    if (!featured.has(requirement.id)) add(14, '유스케이스 없는 요구사항', `${requirement.id} ${requirement.name}을 다루는 유스케이스가 있어야 완성이다.`);
  }
  const ids = new Set();
  for (const unit of spec.units) {
    if (ids.has(unit.id)) add(14, '번호 겹침', `단위 번호 ${unit.id}가 두 번 나온다.`, unit.line);
    ids.add(unit.id);
    for (const id of unit.requirements) if (!requirementIds.has(id)) add(14, '없는 요구사항', `${unit.id} ${unit.name}의 ${id}가 기획에 없다.`, unit.line);
    const row = spec.progress.find((entry) => entry.id === unit.id);
    if (!row) add(14, '진행표 불일치', `${unit.id} ${unit.name}이 진행표에 없다.`, unit.line);
    else if (row.name !== unit.name) add(14, '진행표 불일치', `진행표에서 ${unit.id}의 이름이 "${row.name}"인데 흐름은 "${unit.name}"이다.`, row.line);
  }
  for (const row of spec.progress) {
    if (!spec.units.some((unit) => unit.id === row.id)) add(14, '진행표 불일치', `진행표의 ${row.id} 흐름이 없다.`, row.line);
    if (!PROGRESS.includes(row.status)) add(14, '진행표 불일치', `${row.id}의 진행은 ${PROGRESS.join(', ')} 중 하나여야 한다.`, row.line);
  }

  // 조건표·상태표의 말인지 보고, 단위마다 나온 갈래를 모은다.
  const useMaterial = (subject, branch, where, line, seen) => {
    const target = subject.replace(/\s*상태$/, '');
    const isState = subject.endsWith(' 상태') && statesOf.has(target);
    const expected = isState ? statesOf.get(target) : conditions.get(subject)?.branches;
    if (!expected) return add(15, '없는 재료', `${where}: 조건표에 "${subject}"가 없고 상태표에 대상 "${target}"도 없다.`, line);
    if (!expected.includes(branch)) return add(15, '없는 재료', `${where}의 '${branch}'는 표에 없는 갈래다.`, line);
    if (isState) used.states.add(branch);
    else used.conditions.add(subject);
    const key = isState ? `${target} 상태` : subject;
    seen.set(key, { expected, isState, line, found: new Set([...(seen.get(key)?.found ?? []), branch]) });
  };

  for (const unit of spec.units) {
    const label = `${unit.id} ${unit.name}`;
    const seen = new Map();
    for (const { line } of unit.strayFlows) add(15, '모르는 머리', `${label}의 ### 머리는 ${FLOWS.join(', ')} 중 하나로 쓴다.`, line);
    for (const item of unit.items) {
      if (!ITEMS.includes(item.name)) add(15, '모르는 항목', `${label}의 항목 "${item.name}"는 ${ITEMS.join(', ')} 중 하나로 쓴다.`, item.line);
      if (SYMBOLS.test(item.value)) add(15, '기호', `${label}의 ${item.name}에서 기호를 빼고 낱말로 쓴다.`, item.line);
      if (item.name !== '기본 흐름 조건' && sentenceCount(item.value) > 1) add(15, '한 줄 두 문장', `${label}의 ${item.name}을 한 문장으로 쓴다.`, item.line);
    }
    if (unit.kind === '유스케이스') {
      for (const name of REQUIRED_ITEMS) if (!unit.items.find((item) => item.name === name)?.value) add(15, '빠진 항목', `${label}의 항목 표에 ${name}이 있어야 완성이다.`, unit.line);
    }
    const actors = unit.items.find((item) => item.name === '행위자');
    for (const id of splitIds(actors?.value)) if (!plan.personas.some((persona) => persona.id === id)) add(15, '없는 행위자', `${label}의 행위자 ${id}가 기획의 페르소나에 없다.`, actors.line);
    const main = unit.flows['기본 흐름']?.nodes ?? [];
    if (main.length === 0) add(15, '빈 흐름', `${label}에 ### 기본 흐름 단계가 있어야 완성이다.`, unit.line);
    if (unit.kind === '유스케이스' && !unit.noException && !(unit.flows['예외 흐름']?.nodes.length)) add(15, '예외 흐름 없음', `${label}에서 실패하거나 끊기면 어떻게 되는지 ### 예외 흐름이 있어야 완성이다. 없으면 "- 없음: 이유"로 쓴다.`, unit.line);
    main.forEach((node, index) => {
      if (node.kind === 'extension' || node.kind === 'unnumbered') return;
      if (node.id !== String(index + 1)) add(15, '번호 순서', `${label} 기본 흐름의 "${node.text}"는 ${index + 1}번이어야 한다.`, node.line);
    });
    for (const premise of unit.premises) {
      if (!premise.subject) add(15, '없는 재료', `${label}의 기본 흐름 조건 "${premise.text}"는 "조건: 갈래" 모양으로 쓴다.`, premise.line);
      else useMaterial(premise.subject, premise.branch, `${label}의 기본 흐름 조건 "${premise.text}"`, premise.line, seen);
    }

    const stepIds = new Set();
    for (const name of FLOWS) walkNodes(unit.flows[name]?.nodes ?? [], (node) => node.kind !== 'extension' && node.id && stepIds.add(node.id));
    for (const name of FLOWS) {
      walkNodes(unit.flows[name]?.nodes ?? [], (node, parents) => {
        const where = `${unit.id}${SEP}${name}${SEP}${node.text}`;
        if (SYMBOLS.test(node.text)) add(15, '기호', `${where}에서 기호를 빼고 번호와 낱말로 쓴다.`, node.line);
        if (sentenceCount(node.label) > 1) add(15, '한 줄 두 문장', `${where}를 한 줄에 한 문장으로 나눈다.`, node.line);
        if (node.kind === 'unnumbered') return add(15, '번호 없는 줄', `${where}에 1. 또는 2a. 같은 단계 번호를 붙인다.`, node.line);
        if (node.kind === 'extension') {
          if (name === '기본 흐름') add(15, '흐름 위치', `${where}처럼 갈라지는 줄은 대안 흐름이나 예외 흐름에 쓴다.`, node.line);
          const from = node.id.slice(0, -1);
          if (!stepIds.has(from)) add(15, '없는 단계', `${where}가 갈라져 나오는 ${from}번 단계가 없다.`, node.line);
          const depth = (node.id.match(/[a-z]/g) ?? []).length;
          if (depth > MAX_BRANCH_DEPTH) add(15, '너무 깊은 흐름', `${where}에서 갈림이 ${MAX_BRANCH_DEPTH}단계를 넘는다. 함수로 잘라낸다.`, node.line);
          if (node.subject) useMaterial(node.subject, node.branch, where, node.line, seen);
          const steps = node.children.filter((child) => child.kind !== 'extension');
          if (!steps.length || !isEnding(steps.at(-1))) add(15, '끝 없는 흐름', `${where} 끝에 "N으로 돌아간다", "끝난다", "FN번호 이름을 따른다" 중 하나가 있어야 완성이다.`, node.line);
          return;
        }
        const owner = parents.findLast((parent) => parent.kind === 'extension');
        if (owner && !node.id.startsWith(owner.id)) add(15, '번호 순서', `${where}의 번호는 ${owner.id}로 시작해야 한다.`, node.line);
        if (node.kind === 'return' && !stepIds.has(node.target)) add(15, '없는 단계', `${where}가 돌아가는 ${node.target}번 단계가 없다.`, node.line);
        if (node.kind === 'call') {
          used.functions.add(node.call.id);
          const target = functions.get(node.call.id);
          if (!target) add(15, '없는 함수', `${where}가 부르는 FN 흐름이 없다.`, node.line);
          else if (node.call.name !== target.name) add(15, '없는 함수', `${where}의 이름이 ${node.call.id} "${target.name}"과 다르다.`, node.line);
        }
        if (node.kind === 'transition') {
          for (const state of node.transition) {
            if (allStates.has(state)) used.states.add(state);
            else add(15, '없는 재료', `${where}의 상태 "${state}"가 상태표에 없다.`, node.line);
          }
        }
      });
    }
    for (const [key, { expected, isState, line, found }] of seen) {
      for (const branch of expected) if (!found.has(branch)) add(15, isState ? '빠진 상태' : '빠진 갈래', `${label}에 "${key}: ${branch}"일 때의 흐름이 없다. 기본 흐름 조건이나 대안 흐름에 있어야 완성이다.`, line);
    }
  }
  if (spec.units.length) {
    for (const state of allStates) if (!used.states.has(state)) add(15, '안 쓰인 재료', `상태 "${state}"가 어느 흐름에도 없다. 빠졌는지 표에서 뺄지 정해야 완성이다.`);
    for (const { name, line } of spec.conditions) if (!used.conditions.has(name)) add(15, '안 쓰인 재료', `조건 "${name}"가 어느 흐름에도 없다. 빠졌는지 표에서 뺄지 정해야 완성이다.`, line);
    for (const [id, unit] of functions) if (!used.functions.has(id)) add(15, '안 쓰인 함수', `${id} ${unit.name}을 부르는 곳이 없다.`, unit.line);
  }

  if (spec.status !== '확정') add(17, '확정 전', '사람이 기획 상세 스펙을 읽고 확정하면 상태: 확정으로 바꾼다.');
  return issues;
}
