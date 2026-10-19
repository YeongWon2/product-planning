// plan.md 읽기와 기획 단계 검사 (docs/planning-guide.md, docs/harness.md 5장 1~5).
import { readField, readStatus, sections } from './md.mjs';
import { sentenceIssues } from './text.mjs';

export const PLAN_STEPS = { 1: '기획 › 1. 요약과 목표', 2: '기획 › 2. 페르소나', 3: '기획 › 3. 요구사항', 4: '기획 › 4. 완성 기준', 5: '기획 › 5. 범위와 확정' };
export const PRIORITIES = ['꼭', '나중에'];
export const NONE = '없음';
const SUMMARY_MAX = 3;
const PERSONA_LABELS = { '원하는 것': 'needs', '행동 패턴': 'patterns', 불편: 'pains' };
// 줄만 모아 두는 구역. 선택 구역은 비어 있으면 아직 안 물은 것이고, `없음`이면 물었는데 없는 것이다.
export const LIST_SECTIONS = { '한 줄 요약': 'summary', 배경: 'background', '범위 밖': 'outOfScope', '지켜야 할 조건': 'constraints', '일정과 리스크': 'schedule', '참고 문서': 'references' };
export const OPTIONAL_SECTIONS = ['지켜야 할 조건', '일정과 리스크', '참고 문서'];

export function parsePlan(source) {
  const lines = source.split(/\r?\n/);
  const plan = {
    status: readStatus(lines), author: readField(lines, '작성자'),
    summary: [], background: [], goals: [], personas: [], requirements: [],
    outOfScope: [], constraints: [], schedule: [], references: [], questions: [], stray: [],
  };
  for (const section of sections(lines)) {
    if (LIST_SECTIONS[section.title]) {
      plan[LIST_SECTIONS[section.title]] = section.body
        .filter(({ text }) => text.trim() !== '')
        .map(({ text, line }) => ({ text: text.trim().replace(/^- /, ''), line }));
    } else if (section.title === '목표') {
      readEntities(section.body, /^### (G\d+) (.+)$/, plan.goals, plan.stray, readGoalLine, 1);
    } else if (section.title === '페르소나') {
      readEntities(section.body, /^### (P\d+) (.+)$/, plan.personas, plan.stray, readPersonaLine, 2);
    } else if (section.title === '요구사항') {
      readEntities(section.body, /^### (R\d+) (.+)$/, plan.requirements, plan.stray, readRequirementLine, 3);
    } else if (section.title === '정할 것') {
      for (const { text, line } of section.body) if (text.startsWith('- ')) plan.questions.push({ text: text.slice(2).trim(), line });
    }
  }
  return plan;
}

function readEntities(body, heading, into, stray, readLine, step) {
  let current = null;
  for (const { text, line } of body) {
    const match = text.match(heading);
    if (match) {
      current = { id: match[1], name: match[2].trim(), line, label: null, needs: [], patterns: [], pains: [], description: [], who: null, why: null, priority: null, check: null, criteria: [] };
      into.push(current);
    } else if (text.trim() !== '') {
      if (!current || !readLine(current, text.trim(), line)) stray.push({ text: text.trim(), line, step });
    }
  }
}

function readGoalLine(goal, text, line) {
  const check = text.match(/^확인:\s*(.*)$/);
  if (check) return (goal.check = { text: check[1].trim(), line });
  return false;
}

function readPersonaLine(persona, text, line) {
  if (PERSONA_LABELS[text]) return (persona.label = PERSONA_LABELS[text]);
  if (text.startsWith('- ')) {
    if (!persona.label) return false;
    persona[persona.label].push({ text: text.slice(2).trim(), line });
    return true;
  }
  if (persona.label) return false;
  persona.description.push({ text, line });
  return true;
}

function readRequirementLine(requirement, text, line) {
  const who = text.match(/^누구:\s*(.*)$/);
  if (who) return (requirement.who = { ids: who[1].split(',').map((id) => id.trim()).filter(Boolean), line });
  const why = text.match(/^왜:\s*(.*)$/);
  if (why) return (requirement.why = { text: why[1].trim(), line });
  const priority = text.match(/^우선순위:\s*(.*)$/);
  if (priority) return (requirement.priority = { text: priority[1].trim(), line });
  if (text === '완성 기준') return (requirement.label = 'criteria');
  if (requirement.label === 'criteria' && text.startsWith('- ')) {
    const match = text.slice(2).match(/^(R\d+-\d+)\s+(?:\[제외:\s*([^\]]+)\]\s*)?(.+)$/);
    if (!match) return false;
    requirement.criteria.push({ id: match[1], excluded: match[2]?.trim() ?? null, text: match[3].trim(), line });
    return true;
  }
  return false;
}

export function checkPlan(plan) {
  const issues = [];
  const add = (step, kind, message, line) => issues.push({ step, kind, message, line });
  const proseRules = (step, items) => {
    for (const { text, line } of items) for (const issue of sentenceIssues(text)) add(step, issue.kind, issue.message, line);
  };

  if (plan.summary.length === 0) add(1, '요약 없음', '무엇을, 누구에게, 왜 하는지 한 줄 요약이 있어야 완성이다.');
  if (plan.summary.length > SUMMARY_MAX) add(1, '긴 요약', `한 줄 요약을 ${SUMMARY_MAX}줄 안으로 줄인다.`, plan.summary[SUMMARY_MAX].line);
  proseRules(1, plan.summary);
  if (plan.background.length === 0) add(1, '배경 없음', '왜 이 기능이 필요한지 배경 문장이 있어야 완성이다.');
  proseRules(1, plan.background);
  if (plan.goals.length === 0) add(1, '목표 없음', '이 기능으로 이루려는 목표가 하나 이상 있어야 완성이다.');
  duplicates(plan.goals, (id, line) => add(1, '번호 겹침', `목표 번호 ${id}가 두 번 나온다.`, line));
  for (const goal of plan.goals) {
    if (!goal.check?.text) add(1, '확인 방법 없음', `${goal.id} ${goal.name}을 이뤘는지 무엇으로 확인하는지 있어야 완성이다. 숫자가 없으면 무엇을 보고 알지 쓴다.`, goal.line);
    proseRules(1, [{ text: goal.name, line: goal.line }, ...(goal.check?.text ? [goal.check] : [])]);
  }

  if (plan.personas.length === 0) add(2, '페르소나 없음', '누가 쓰는지 페르소나가 하나 이상 있어야 완성이다.');
  duplicates(plan.personas, (id, line) => add(2, '번호 겹침', `페르소나 번호 ${id}가 두 번 나온다.`, line));
  for (const persona of plan.personas) {
    if (persona.needs.length === 0) add(2, '원하는 것 없음', `${persona.id} ${persona.name}이 무엇을 원하는지 있어야 완성이다.`, persona.line);
    if (persona.patterns.length === 0) add(2, '행동 패턴 없음', `${persona.id} ${persona.name}이 평소 어떻게 행동하는지 있어야 완성이다.`, persona.line);
    proseRules(2, [{ text: persona.name, line: persona.line }, ...persona.description, ...persona.needs, ...persona.patterns, ...persona.pains]);
  }
  for (const { text, line, step } of plan.stray) add(step, '모르는 줄', `"${text}"가 어느 칸인지 알 수 없다. 작성법의 머리 이름으로 옮긴다.`, line);

  const personaIds = new Set(plan.personas.map((persona) => persona.id));
  if (plan.requirements.length === 0) add(3, '요구사항 없음', '페르소나의 필요에서 나온 요구사항이 하나 이상 있어야 완성이다.');
  duplicates(plan.requirements, (id, line) => add(3, '번호 겹침', `요구사항 번호 ${id}가 두 번 나온다.`, line));
  for (const requirement of plan.requirements) {
    const label = `${requirement.id} ${requirement.name}`;
    if (!requirement.who || requirement.who.ids.length === 0) add(3, '누구 없음', `${label}이 어느 페르소나를 위한 것인지 있어야 완성이다.`, requirement.line);
    for (const id of requirement.who?.ids ?? []) if (!personaIds.has(id)) add(3, '없는 페르소나', `${label}의 누구 ${id}가 페르소나에 없다.`, requirement.who.line);
    if (!requirement.why?.text) add(3, '왜 없음', `${label}이 페르소나의 어떤 필요를 푸는지 있어야 완성이다.`, requirement.line);
    if (!requirement.priority?.text) add(3, '우선순위 없음', `${label}이 이번에 꼭 할 것인지 나중에 해도 되는지 있어야 완성이다.`, requirement.line);
    else if (!PRIORITIES.includes(requirement.priority.text)) add(3, '모르는 우선순위', `${label}의 우선순위 "${requirement.priority.text}"는 ${PRIORITIES.join(' 또는 ')}여야 한다.`, requirement.priority.line);
    proseRules(3, [{ text: requirement.name, line: requirement.line }, ...(requirement.why?.text ? [requirement.why] : [])]);
  }
  const used = new Set(plan.requirements.flatMap((requirement) => requirement.who?.ids ?? []));
  for (const persona of plan.personas) {
    if (plan.requirements.length && !used.has(persona.id)) add(3, '안 쓰인 페르소나', `${persona.id} ${persona.name}을 위한 요구사항이 없다. 빠졌는지 범위 밖인지 정해야 완성이다.`, persona.line);
  }

  const seen = new Map();
  for (const requirement of plan.requirements) {
    if (requirement.criteria.length === 0) add(4, '완성 기준 없음', `${requirement.id} ${requirement.name}에 "이게 되면 완성"인 기준이 있어야 완성이다.`, requirement.line);
    for (const criterion of requirement.criteria) {
      if (!criterion.id.startsWith(`${requirement.id}-`)) add(4, '번호 어긋남', `${criterion.id}가 ${requirement.id} 아래에 있다.`, criterion.line);
      if (seen.has(criterion.id)) add(4, '번호 겹침', `완성 기준 번호 ${criterion.id}가 두 번 나온다.`, criterion.line);
      seen.set(criterion.id, criterion);
    }
    proseRules(4, requirement.criteria);
  }

  if (plan.outOfScope.length === 0) add(5, '범위 밖 없음', `이번에 하지 않는 것이 있어야 완성이다. 정말 없으면 "${NONE}"이라고 쓴다.`);
  proseRules(5, plan.outOfScope);
  for (const title of OPTIONAL_SECTIONS) {
    const key = LIST_SECTIONS[title];
    if (plan[key].length === 0) add(5, '안 물은 구역', `${title}을 한 번 묻는다. 없으면 "${NONE}"이라고 쓰고, 내보낼 때 빠진다.`);
  }
  proseRules(5, [...plan.constraints, ...plan.schedule]);
  if (!plan.author) add(5, '작성자 없음', '작성자: 줄에 기획을 쓴 사람 이름이 있어야 완성이다.');
  for (const question of plan.questions) add(5, '정할 것 남음', question.text, question.line);
  proseRules(5, plan.questions);
  if (plan.status !== '확정') {
    const hint = plan.status && plan.status !== '작성중' ? `상태 "${plan.status}"는 작성중이나 확정이어야 한다.` : '사람이 기획을 읽고 확정하면 상태: 확정으로 바꾼다.';
    add(5, '확정 전', hint);
  }
  return issues;
}

function duplicates(items, report) {
  const seen = new Set();
  for (const item of items) {
    if (seen.has(item.id)) report(item.id, item.line);
    seen.add(item.id);
  }
}

// 선택 구역이 `없음` 한 줄뿐이면 내보낼 때 뺀다.
export const isNone = (items) => items.length === 1 && items[0].text.replace(/\.$/, '') === NONE;

export function criteriaOf(plan) {
  return plan.requirements.flatMap((requirement) => requirement.criteria.map((criterion) => ({ ...criterion, requirement: requirement.id })));
}
