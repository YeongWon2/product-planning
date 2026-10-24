// 요구사항 대조 (docs/harness.md 3장). 모델이 쓴 trace.json이 지금 기획과 기획 상세 스펙 흐름와 맞는지 센다.
import { createHash } from 'node:crypto';
import { criteriaOf } from './plan.mjs';
import { linePaths } from './spec.mjs';

export const fingerprint = (criterion) => createHash('sha1').update(`${criterion.id}\n${criterion.text}`).digest('hex').slice(0, 12);

export function sheet(plan, spec) {
  return {
    instructions: [
      '완성 기준마다 그 기준을 만족하는 흐름 줄을 lines에서 찾아 trace.json에 적는다.',
      '찾으면 verdict는 met이고 evidence에 줄 경로를 그대로 하나 이상 옮긴다.',
      '없으면 verdict는 missing이고 missing에 무엇이 추가돼야 완성인지 한 문장으로 적는다.',
      'fingerprint는 아래 값을 그대로 옮긴다.',
      '흐름를 직접 고치지 않는다.',
    ],
    criteria: criteriaOf(plan).filter((criterion) => !criterion.excluded).map((criterion) => ({ id: criterion.id, requirement: criterion.requirement, text: criterion.text, fingerprint: fingerprint(criterion) })),
    lines: linePaths(spec).map(({ path }) => path),
  };
}

// 결과: { issues, met: Set(기준 ID) }
export function checkTrace(plan, spec, trace) {
  const issues = [];
  const met = new Set();
  const add = (kind, message) => issues.push({ step: 16, kind, message });
  const paths = new Set(linePaths(spec).map(({ path }) => path));
  for (const criterion of criteriaOf(plan)) {
    if (criterion.excluded) continue;
    const entry = trace?.[criterion.id];
    if (!entry) {
      add('대조 없음', `${criterion.id} "${criterion.text}"를 흐름와 대조해야 한다.`);
    } else if (entry.fingerprint !== fingerprint(criterion)) {
      add('대조 낡음', `${criterion.id}의 기준 문장이 바뀌었으니 다시 대조한다.`);
    } else if (entry.verdict === 'missing') {
      add('요구사항', `${criterion.id} ${entry.missing || `"${criterion.text}"를 만족하는 줄이 있어야 완성이다.`}`);
    } else if (entry.verdict !== 'met') {
      add('대조 형식', `${criterion.id}의 verdict는 met 또는 missing이어야 한다.`);
    } else if (!Array.isArray(entry.evidence) || entry.evidence.length === 0) {
      add('근거 없음', `${criterion.id}가 met인데 근거 줄이 없다.`);
    } else if (entry.evidence.some((path) => !paths.has(path))) {
      add('대조 낡음', `${criterion.id}의 근거 줄이 지금 흐름에 없으니 다시 대조한다.`);
    } else {
      met.add(criterion.id);
    }
  }
  return { issues, met };
}

export function progressOf(plan, met) {
  const perRequirement = plan.requirements.map((requirement) => {
    const active = requirement.criteria.filter((criterion) => !criterion.excluded);
    return { id: requirement.id, met: active.filter((criterion) => met.has(criterion.id)).length, total: active.length };
  });
  const total = perRequirement.reduce((sum, item) => sum + item.total, 0);
  const done = perRequirement.reduce((sum, item) => sum + item.met, 0);
  return { perRequirement, met: done, total, percent: total ? Math.round((done / total) * 100) : 0 };
}
