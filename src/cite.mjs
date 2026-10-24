// 개발 스펙과 다이어그램이 인용할 수 있는 원문 (docs/dev-guide.md 4장 출처 모양).
// 출처는 번호(쉼표로 여럿) 또는 "곳 › 원문" 경로다. 앞의 "PRD › ", "기획 상세 스펙 › "는 떼고 본다.
import { SEP, linePaths } from './spec.mjs';

const PREFIXES = ['PRD', '기획 PRD', '기획 상세 스펙', '개발 스펙'];
const LABELS = { needs: '원하는 것', patterns: '행동 패턴', pains: '불편' };
export const ID = /^(BR|FN|G|P|R|F|D|A|M|C|E|N|T|V|S)\d+(-\d+)?$/;

// { paths: Map(경로 → 문서 이름), ids: Set(번호) }
export function citable(brief, plan, spec) {
  const paths = new Map();
  const put = (path, doc) => paths.set(path, doc);
  for (const { text } of brief.why) put(`왜 지금${SEP}${text}`, 'PRD');
  for (const { text } of brief.outOfScope) put(`범위 밖${SEP}${text}`, 'PRD');
  for (const { text } of brief.constraints) put(`제약${SEP}${text}`, 'PRD');
  for (const goal of brief.goals) if (goal.fields['지표']) put(`${goal.id} 지표${SEP}${goal.fields['지표'].text}`, 'PRD');
  for (const persona of plan.personas) {
    for (const [key, label] of Object.entries(LABELS)) for (const { text } of persona[key]) put(`${persona.id} ${label}${SEP}${text}`, 'PRD');
  }
  for (const { target } of spec.states) put(`상태표${SEP}${target}`, '기획 상세 스펙');
  for (const { name } of spec.conditions) put(`조건표${SEP}${name}`, '기획 상세 스펙');
  for (const { path } of linePaths(spec)) put(path, '기획 상세 스펙');
  const ids = new Set([
    ...brief.goals.map((goal) => goal.id),
    ...brief.requirements.map((requirement) => requirement.id),
    ...plan.personas.map((persona) => persona.id),
    ...plan.requirements.flatMap((requirement) => [requirement.id, ...requirement.criteria.map((criterion) => criterion.id)]),
    ...spec.units.map((unit) => unit.id),
  ]);
  return { paths, ids };
}

export function stripPrefix(text) {
  for (const prefix of PREFIXES) if (text.startsWith(prefix + SEP)) return text.slice(prefix.length + SEP.length);
  return text;
}

// 출처 하나를 풀어 { ok, path, ids }로 낸다. 끝의 마침표는 원문의 일부로 보지 않을 수도 있어 둘 다 본다.
export function resolve(text, sources, devIds = new Set()) {
  const value = stripPrefix(text.trim());
  const parts = value.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length && parts.every((part) => ID.test(part))) {
    return { ok: parts.every((part) => sources.ids.has(part) || devIds.has(part)), ids: parts, path: null };
  }
  for (const candidate of [value, value.replace(/\.$/, ''), `${value}.`]) {
    if (sources.paths.has(candidate)) return { ok: true, ids: [], path: candidate };
  }
  return { ok: false, ids: [], path: value };
}

// 출처 경로가 트리의 그 줄이거나 그 아래 줄을 가리키는가.
export const covers = (path, target) => path === target || path.startsWith(target + SEP);
