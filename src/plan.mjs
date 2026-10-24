// plan.md 읽기와 기획 2·3단계 검사 (docs/planning-guide.md, docs/harness.md 5장 7~11).
import { readStatus, sections, splitIds } from './md.mjs';
import { sentenceIssues } from './text.mjs';
import { duplicates } from './brief.mjs';

export const PLAN_STEPS = { 7: '기획 › 2-1. 페르소나', 8: '기획 › 2-2. 요구사항', 9: '기획 › 2-3. 우선순위', 10: '기획 › 2-4. 완성 기준', 11: '기획 › 3. PRD 확정' };
export const PRIORITIES = ['P1', 'P2', 'P3'];
const PERSONA_LABELS = { '원하는 것': 'needs', '행동 패턴': 'patterns', 불편: 'pains' };

export function parsePlan(source) {
  const lines = source.split(/\r?\n/);
  const plan = { status: readStatus(lines), title: lines.find((line) => line.startsWith('# '))?.slice(2).trim() ?? '', personas: [], requirements: [], questions: [], stray: [] };
  for (const section of sections(lines)) {
    if (section.title === '페르소나') {
      readEntities(section.body, /^### (P\d+) (.+)$/, plan.personas, plan.stray, readPersonaLine, 7);
    } else if (section.title === '요구사항') {
      readEntities(section.body, /^### (R\d+) (.+)$/, plan.requirements, plan.stray, readRequirementLine, 8);
    } else if (section.title === '정할 것') {
      for (const { text, line } of section.body) if (text.startsWith('- ')) plan.questions.push({ text: text.slice(2).trim(), line });
    } else {
      plan.stray.push({ text: `## ${section.title}`, line: section.line, step: 7 });
    }
  }
  return plan;
}

function readEntities(body, heading, into, stray, readLine, step) {
  let current = null;
  for (const { text, line } of body) {
    const match = text.match(heading);
    if (match) {
      current = { id: match[1], name: match[2].trim(), line, label: null, needs: [], patterns: [], pains: [], description: [], who: null, basis: null, priority: null, why: null, criteria: [] };
      into.push(current);
    } else if (text.trim() !== '') {
      if (!current || !readLine(current, text.trim(), line)) stray.push({ text: text.trim(), line, step });
    }
  }
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
  const field = text.match(/^(누구|근거|우선순위|왜):\s*(.*)$/);
  if (field) {
    const value = field[2].trim();
    if (field[1] === '누구') requirement.who = { ids: splitIds(value), line };
    if (field[1] === '근거') requirement.basis = { ids: splitIds(value), line };
    if (field[1] === '우선순위') requirement.priority = { text: value, line };
    if (field[1] === '왜') requirement.why = { text: value, line };
    return true;
  }
  if (text === '완성 기준') return (requirement.label = 'criteria');
  if (requirement.label === 'criteria' && text.startsWith('- ')) {
    const match = text.slice(2).match(/^(R\d+-\d+)\s+(?:\[제외:\s*([^\]]+)\]\s*)?(.+)$/);
    if (!match) return false;
    requirement.criteria.push({ id: match[1], excluded: match[2]?.trim() ?? null, text: match[3].trim(), line });
    return true;
  }
  return false;
}

// brief는 확정된 비즈니스 요구사항이다. BR 근거와 범위 밖을 대조한다.
export function checkPlan(plan, brief) {
  const issues = [];
  const add = (step, kind, message, line) => issues.push({ step, kind, message, line });
  const proseRules = (step, list) => {
    for (const { text, line } of list) for (const issue of sentenceIssues(text)) add(step, issue.kind, issue.message, line);
  };

  if (plan.personas.length === 0) add(7, '페르소나 없음', '누가 쓰는지 페르소나가 하나 이상 있어야 완성이다.');
  duplicates(plan.personas, (id, line) => add(7, '번호 겹침', `페르소나 번호 ${id}가 두 번 나온다.`, line));
  for (const persona of plan.personas) {
    if (persona.needs.length === 0) add(7, '원하는 것 없음', `${persona.id} ${persona.name}이 무엇을 원하는지 있어야 완성이다.`, persona.line);
    if (persona.patterns.length === 0) add(7, '행동 패턴 없음', `${persona.id} ${persona.name}이 평소 어떻게 행동하는지 있어야 완성이다.`, persona.line);
    proseRules(7, [{ text: persona.name, line: persona.line }, ...persona.description, ...persona.needs, ...persona.patterns, ...persona.pains]);
  }
  for (const { text, line, step } of plan.stray) add(step, '모르는 줄', `"${text}"가 어느 칸인지 알 수 없다. 작성법의 머리 이름으로 옮긴다.`, line);

  const personaIds = new Set(plan.personas.map((persona) => persona.id));
  const briefIds = new Set(brief.requirements.map((requirement) => requirement.id));
  if (plan.requirements.length === 0) add(8, '요구사항 없음', '페르소나의 필요에서 나온 요구사항이 하나 이상 있어야 완성이다.');
  duplicates(plan.requirements, (id, line) => add(8, '번호 겹침', `요구사항 번호 ${id}가 두 번 나온다.`, line));
  for (const requirement of plan.requirements) {
    const label = `${requirement.id} ${requirement.name}`;
    if (!requirement.who || requirement.who.ids.length === 0) add(8, '누구 없음', `${label}이 어느 페르소나를 위한 것인지 있어야 완성이다.`, requirement.line);
    for (const id of requirement.who?.ids ?? []) if (!personaIds.has(id)) add(8, '없는 페르소나', `${label}의 누구 ${id}가 페르소나에 없다.`, requirement.who.line);
    if (!requirement.basis || requirement.basis.ids.length === 0) add(8, '근거 없는 요구사항', `${label}이 어느 비즈니스 요구사항에서 나왔는지 \`근거:\`가 있어야 완성이다.`, requirement.line);
    for (const id of requirement.basis?.ids ?? []) if (!briefIds.has(id)) add(8, '근거 없는 요구사항', `${label}의 근거 ${id}가 비즈니스 요구사항에 없다.`, requirement.basis.line);
    if (!requirement.why?.text) add(8, '왜 없음', `${label}이 페르소나의 어떤 필요를 푸는지 있어야 완성이다.`, requirement.line);
    proseRules(8, [{ text: requirement.name, line: requirement.line }, ...(requirement.why?.text ? [requirement.why] : [])]);
  }
  const used = new Set(plan.requirements.flatMap((requirement) => requirement.who?.ids ?? []));
  for (const persona of plan.personas) {
    if (plan.requirements.length && !used.has(persona.id)) add(8, '안 쓰인 페르소나', `${persona.id} ${persona.name}을 위한 요구사항이 없다. 빠졌는지 범위 밖인지 정해야 완성이다.`, persona.line);
  }

  for (const requirement of plan.requirements) {
    if (!requirement.priority) add(9, '우선순위 없음', `${requirement.id} ${requirement.name}에 우선순위(P1·P2·P3)가 있어야 완성이다.`, requirement.line);
    else if (!PRIORITIES.includes(requirement.priority.text)) add(9, '우선순위 형식', `${requirement.id}의 우선순위 "${requirement.priority.text}"는 P1, P2, P3 중 하나여야 한다.`, requirement.priority.line);
  }
  if (plan.requirements.length && !plan.requirements.some((requirement) => requirement.priority?.text === 'P1')) add(9, 'P1 없음', '그것만 나가도 쓸 수 있는 P1 요구사항이 하나 이상 있어야 완성이다.');

  const seen = new Set();
  for (const requirement of plan.requirements) {
    if (requirement.criteria.length === 0) add(10, '완성 기준 없음', `${requirement.id} ${requirement.name}에 "이게 되면 완성"인 기준이 있어야 완성이다.`, requirement.line);
    for (const criterion of requirement.criteria) {
      if (!criterion.id.startsWith(`${requirement.id}-`)) add(10, '번호 어긋남', `${criterion.id}가 ${requirement.id} 아래에 있다.`, criterion.line);
      if (seen.has(criterion.id)) add(10, '번호 겹침', `완성 기준 번호 ${criterion.id}가 두 번 나온다.`, criterion.line);
      seen.add(criterion.id);
    }
    proseRules(10, requirement.criteria);
  }

  const based = new Set(plan.requirements.flatMap((requirement) => requirement.basis?.ids ?? []));
  for (const requirement of brief.requirements) {
    if (!based.has(requirement.id)) add(11, '요구사항 없는 BR', `${requirement.id} ${requirement.title}을 근거로 쓰는 요구사항이 없다.`);
  }
  const outOfScope = new Set(brief.outOfScope.map(({ text }) => text));
  for (const criterion of criteriaOf(plan)) {
    if (!criterion.excluded && outOfScope.has(criterion.text)) add(11, '범위 밖과 겹침', `${criterion.id} "${criterion.text}"가 범위 밖에 있다. 제외하거나 범위를 고친다.`, criterion.line);
  }
  for (const question of plan.questions) add(11, '정할 것 남음', question.text, question.line);
  proseRules(11, plan.questions);
  if (plan.status !== '확정') {
    const hint = plan.status && plan.status !== '작성중' ? `상태 "${plan.status}"는 작성중이나 확정이어야 한다.` : '사람이 PRD 미리 보기를 읽고 확정하면 상태: 확정으로 바꾼다.';
    add(11, '확정 전', hint);
  }
  return issues;
}

export function criteriaOf(plan) {
  return plan.requirements.flatMap((requirement) => requirement.criteria.map((criterion) => ({ ...criterion, requirement: requirement.id })));
}
