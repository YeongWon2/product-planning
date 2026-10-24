// dev.md 읽기와 개발 스펙 검사 (docs/dev-guide.md, docs/harness.md 5장 18~28).
import { bullets, items, readStatus, sections, splitIds, tableRows } from './md.mjs';
import { covers, resolve } from './cite.mjs';
import { SEP, isAction, linePaths } from './spec.mjs';
import { criteriaOf } from './plan.mjs';
import { duplicates } from './brief.mjs';

export const DEV_STEPS = { 18: '개발 › 5-1. 결정', 19: '개발 › 5-2. 아키텍처', 20: '개발 › 5-3. 데이터', 21: '개발 › 5-4. 계약', 22: '개발 › 5-5. 시퀀스', 23: '개발 › 5-6. 오류', 24: '개발 › 5-7. 제약', 25: '개발 › 5-8. 작업', 26: '개발 › 5-9. 검증', 27: '개발 › 5-10. 규칙 대조', 28: '개발 › 5-11. 확정' };
const SECTION_STEP = { '결정 기록': 18, 아키텍처: 19, '데이터 모델': 20, 계약: 21, '오류·경계': 23, '비기능 제약': 24, '작업 계획': 25, 검증: 26, '프로젝트 규칙 대조': 27, '기획에 돌려보낼 것': 28, '정할 것': 28 };

export function parseDev(source) {
  const lines = source.split(/\r?\n/);
  const dev = { status: readStatus(lines), title: lines.find((line) => line.startsWith('# '))?.slice(2).trim() ?? '', decisions: [], components: [], architectureSources: [], models: [], contracts: [], errors: [], constraints: [], phases: [], tasks: [], checks: [], rules: [], returns: [], questions: [], stray: [] };
  for (const section of sections(lines)) {
    const step = SECTION_STEP[section.title];
    const read = (pattern, keys) => {
      const result = items(section.body, pattern, keys);
      dev.stray.push(...result.stray.map((item) => ({ ...item, step })));
      return result.items;
    };
    if (section.title === '결정 기록') dev.decisions = read(/^### (D\d+) (.+)$/, ['이유', '버린 대안', '출처']);
    else if (section.title === '아키텍처') {
      dev.components = tableRows(section.body).map(({ cells: [id, name = '', duty = '', notDuty = '', deps = ''], line }) => ({ id, name, duty, notDuty, deps: splitIds(deps), line }));
      for (const { text, line } of section.body) {
        const source = text.match(/출처:\s*(.+)$/);
        if (source) dev.architectureSources.push({ text: source[1].trim(), line });
      }
    } else if (section.title === '데이터 모델') dev.models = read(/^### (M\d+) (.+)$/, ['출처']);
    else if (section.title === '계약') dev.contracts = read(/^### (C\d+) (.+)$/, ['호출', '입력', '성공', '실패', '출처']).map(readCall);
    else if (section.title === '오류·경계') dev.errors = read(/^### (E\d+) (.+)$/, ['상황', '보이는 것', '시스템 처리', '출처']);
    else if (section.title === '비기능 제약') dev.constraints = bullets(section.body).map(readConstraint);
    else if (section.title === '작업 계획') readTasks(section.body, dev);
    else if (section.title === '검증') dev.checks = bullets(section.body).map(readCheck);
    else if (section.title === '프로젝트 규칙 대조') dev.rules = tableRows(section.body).map(({ cells: [rule = '', quote = '', result = ''], line }) => ({ rule, quote, result, line }));
    else if (section.title === '기획에 돌려보낼 것') dev.returns = bullets(section.body);
    else if (section.title === '정할 것') dev.questions = bullets(section.body);
    else dev.stray.push({ text: `## ${section.title}`, line: section.line, step: 18 });
  }
  return dev;
}

function readCall(contract) {
  const call = contract.fields['호출']?.text.match(/^(A\d+)\s*→\s*(A\d+)$/);
  const failure = contract.fields['실패']?.text ?? '';
  return { ...contract, from: call?.[1] ?? null, to: call?.[2] ?? null, failures: failure === '없음' ? [] : splitIds(failure) };
}

function readConstraint({ text, line }) {
  const match = text.match(/^(N\d+)\s+(.+?)(?:\s*출처:\s*(.+))?$/);
  return match ? { id: match[1], text: match[2].trim(), source: match[3] ? { text: match[3].trim(), line } : null, line } : { id: null, text, line };
}

function readCheck({ text, line }) {
  const match = text.match(/^(V\d+)\s+(R\d+-\d+)\s*·\s*(.+)$/);
  return match ? { id: match[1], criterion: match[2], text: match[3].trim(), line } : { id: null, text, line };
}

function readTasks(body, dev) {
  for (const { text, line } of body) {
    const phase = text.match(/^### (.+)$/);
    if (phase) dev.phases.push({ title: phase[1].trim(), requirements: phase[1].match(/R\d+/g) ?? [], line });
    const task = text.match(/^- \[( |x)\] (T\d+)(\s+\[P\])?\s+(.+?)(?:\s*근거:\s*(.+))?$/);
    if (task) dev.tasks.push({ id: task[2], done: task[1] === 'x', parallel: Boolean(task[3]), text: task[4].trim(), basis: splitIds(task[5]), line });
  }
}

export const devIds = (dev, diagram) => new Set([
  ...dev.decisions, ...dev.components, ...dev.models, ...dev.contracts, ...dev.errors, ...dev.constraints, ...dev.tasks, ...dev.checks, ...(diagram?.sequences ?? []),
].map((item) => item.id).filter(Boolean));

export function checkDev(dev, { brief, plan, spec, sources, diagram }) {
  const issues = [];
  const add = (step, kind, message, line) => issues.push({ step, kind, message, line });
  const ids = devIds(dev, diagram);
  const cited = [];
  const source = (step, label, field, line) => {
    if (!field?.text) return add(step, '출처 없음', `${label}에 어느 원문에서 나왔는지 \`출처:\`가 있어야 완성이다.`, line);
    const found = resolve(field.text, sources, ids);
    if (!found.ok) add(step, '출처 낡음', `${label}의 출처 "${field.text}"가 지금 기획 문서에 그대로 없다. quotes로 원문을 다시 찾는다.`, field.line);
    if (found.path) cited.push(found.path);
  };
  const missingFields = (step, item, keys) => {
    for (const key of keys) if (!item.fields[key]?.text) add(step, '빈 칸', `${item.id} ${item.title}에 \`${key}:\`가 있어야 완성이다.`, item.line);
  };
  for (const { text, line, step } of dev.stray) add(step, '모르는 줄', `"${text}"가 어느 칸인지 알 수 없다. 작성법의 머리 이름으로 옮긴다.`, line);

  duplicates(dev.decisions, (id, line) => add(18, '번호 겹침', `결정 번호 ${id}가 두 번 나온다.`, line));
  for (const decision of dev.decisions) {
    missingFields(18, decision, ['이유']);
    source(18, `${decision.id} ${decision.title}`, decision.fields['출처'], decision.line);
  }
  for (const field of dev.architectureSources) source(19, '아키텍처', field, field.line);
  for (const model of dev.models) source(20, `${model.id} ${model.title}`, model.fields['출처'], model.line);
  for (const contract of dev.contracts) source(21, `${contract.id} ${contract.title}`, contract.fields['출처'], contract.line);
  for (const error of dev.errors) source(23, `${error.id} ${error.title}`, error.fields['출처'], error.line);
  for (const constraint of dev.constraints) {
    if (!constraint.id) add(24, '모르는 줄', `"${constraint.text}"는 \`- N번호 문장 출처: …\` 모양으로 쓴다.`, constraint.line);
    else source(24, constraint.id, constraint.source, constraint.line);
  }
  const askedAbout = (predicate) => cited.some(predicate);
  for (const { text } of brief.constraints) {
    if (!askedAbout((path) => path === `제약${SEP}${text}`)) add(18, '안 물어봄', `PRD 제약 "${text}"를 인용한 결정이나 제약이 없다.`);
  }

  const components = new Map(dev.components.map((component) => [component.id, component]));
  if (dev.components.length === 0) add(19, '아키텍처 없음', '구성 요소와 책임이 아키텍처 표에 하나 이상 있어야 완성이다.');
  duplicates(dev.components, (id, line) => add(19, '번호 겹침', `구성 요소 번호 ${id}가 두 번 나온다.`, line));
  for (const component of dev.components) {
    if (!/^A\d+$/.test(component.id)) add(19, '번호 형식', `구성 요소 번호 "${component.id}"는 A숫자로 쓴다.`, component.line);
    if (!component.duty) add(19, '책임 없음', `${component.id} ${component.name}이 무엇을 책임지는지 있어야 완성이다.`, component.line);
    for (const id of component.deps) if (!components.has(id)) add(19, '없는 구성 요소', `${component.id}가 기대는 ${id}가 아키텍처 표에 없다.`, component.line);
  }

  for (const { target } of uniqueTargets(spec)) {
    if (!askedAbout((path) => path === `상태표${SEP}${target}` || path.includes(`◆ ${target} 상태`))) add(20, '안 물어봄', `상태표의 대상 "${target}"를 인용한 데이터 모델이 없다.`);
  }

  duplicates(dev.contracts, (id, line) => add(21, '번호 겹침', `계약 번호 ${id}가 두 번 나온다.`, line));
  for (const contract of dev.contracts) {
    const label = `${contract.id} ${contract.title}`;
    if (!contract.from) add(21, '호출 없음', `${label}에 \`호출: A번호 → A번호\`가 있어야 완성이다.`, contract.line);
    else {
      for (const id of [contract.from, contract.to]) if (!components.has(id)) add(21, '없는 구성 요소', `${label}의 호출에 아키텍처 표에 없는 ${id}가 나온다.`, contract.fields['호출'].line);
      if (components.has(contract.from) && components.has(contract.to) && !components.get(contract.from).deps.includes(contract.to)) add(21, '거꾸로 의존', `${label}이 ${contract.from} → ${contract.to}로 부르는데 ${contract.from}의 기대는 곳에 ${contract.to}가 없다.`, contract.fields['호출'].line);
    }
    missingFields(21, contract, ['입력', '성공', '실패']);
  }
  for (const { path, node } of linePaths(spec)) {
    // 그 줄, 그 아래 줄, 그 위 갈래 가운데 하나를 인용했으면 물어본 것으로 본다.
    if (isAction(node) && !askedAbout((cite) => covers(cite, path) || covers(path, cite))) add(21, '안 물어봄', `"${path}"를 인용한 계약이나 결정이 없다.`);
  }

  const errors = new Set(dev.errors.map((error) => error.id));
  duplicates(dev.errors, (id, line) => add(23, '번호 겹침', `오류 번호 ${id}가 두 번 나온다.`, line));
  for (const error of dev.errors) missingFields(23, error, ['상황', '보이는 것', '시스템 처리']);
  for (const contract of dev.contracts) {
    for (const id of contract.failures) if (!errors.has(id)) add(23, '이름 없는 실패', `${contract.id}의 실패 ${id}가 오류·경계에 없다.`, contract.fields['실패']?.line);
  }
  for (const { name } of spec.conditions) {
    if (!askedAbout((path) => path === `조건표${SEP}${name}` || path.includes(`? ${name}`))) add(23, '안 물어봄', `조건 "${name}"를 인용한 계약이나 오류가 없다.`);
  }

  if (dev.tasks.length === 0) add(25, '작업 없음', '기반 작업과 P1부터의 작업이 작업 계획에 하나 이상 있어야 완성이다.');
  duplicates(dev.tasks, (id, line) => add(25, '번호 겹침', `작업 번호 ${id}가 두 번 나온다.`, line));
  for (const task of dev.tasks) {
    if (task.basis.length === 0) add(25, '근거 없는 작업', `${task.id}에 \`근거:\`가 있어야 완성이다.`, task.line);
    for (const id of task.basis) if (!sources.ids.has(id) && !ids.has(id)) add(25, '근거 없는 작업', `${task.id}의 근거 ${id}가 어느 문서에도 없다.`, task.line);
  }
  const planned = new Set([...dev.phases.flatMap((phase) => phase.requirements), ...dev.tasks.flatMap((task) => task.basis)]);
  for (const requirement of plan.requirements) {
    if (!planned.has(requirement.id)) add(25, '안 물어봄', `${requirement.id} ${requirement.name}을 다루는 작업 단계가 없다.`);
  }

  const criteria = new Map(criteriaOf(plan).map((criterion) => [criterion.id, criterion]));
  for (const check of dev.checks) {
    if (!check.id) add(26, '모르는 줄', `"${check.text}"는 \`- V번호 R번호-번호 · 문장\` 모양으로 쓴다.`, check.line);
    else if (!criteria.has(check.criterion)) add(26, '없는 기준', `${check.id}의 ${check.criterion}가 완성 기준에 없다.`, check.line);
  }
  duplicates(dev.checks.filter((check) => check.id), (id, line) => add(26, '번호 겹침', `검증 번호 ${id}가 두 번 나온다.`, line));
  const verified = new Set(dev.checks.map((check) => check.criterion));
  for (const criterion of criteria.values()) {
    if (!criterion.excluded && !verified.has(criterion.id)) add(26, '검증 없는 기준', `${criterion.id} "${criterion.text}"를 무엇으로 확인하는지 검증이 있어야 완성이다.`);
  }

  if (dev.rules.length === 0) add(27, '규칙 대조 없음', '프로젝트 규칙 파일과 대조한 줄이 하나 이상 있어야 완성이다. 규칙 파일이 없으면 그렇게 한 줄 쓴다.');
  for (const rule of dev.rules) if (!rule.result) add(27, '결과 없음', `규칙 "${rule.rule}"와 맞는지 결과가 있어야 완성이다.`, rule.line);

  for (const item of dev.returns) add(28, '기획에 돌려보낼 것 남음', `${item.text} — 기획을 고치고 다시 확정해야 이어 쓴다.`, item.line);
  for (const item of dev.questions) add(28, '정할 것 남음', item.text, item.line);
  if (dev.status !== '확정') add(28, '확정 전', '개발자가 개발 스펙을 읽고 확정하면 상태: 확정으로 바꾼다.');
  return issues;
}

function uniqueTargets(spec) {
  const seen = new Map();
  for (const state of spec.states) if (!seen.has(state.target)) seen.set(state.target, state);
  return [...seen.values()];
}
