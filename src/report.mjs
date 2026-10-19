// 폴더 하나를 검사해 지금 단계와 추가돼야 완성인 것을 낸다 (docs/harness.md 4·5장).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PLAN_STEPS, checkPlan, parsePlan } from './plan.mjs';
import { SDD_STEPS, checkSdd, parseSdd } from './sdd.mjs';
import { checkTrace, progressOf } from './trace.mjs';

export const FILES = { plan: 'plan.md', sdd: 'sdd.md', trace: 'trace.json' };
const STEPS = { ...PLAN_STEPS, ...SDD_STEPS };
const NEXT = {
  1: '무엇을 왜 하는지 한 줄 요약과 배경, 무엇으로 확인할 목표를 묻는다.',
  2: '누가 쓰는지, 무엇을 원하는지, 평소 어떻게 행동하는지 묻는다.',
  3: '페르소나의 필요에서 출발해 무엇을 해 줘야 하는지, 꼭 할지 나중에 할지 묻는다.',
  4: '요구사항마다 "이게 되면 완성"인 기준을 묻는다.',
  5: '범위 밖과 선택 구역, 작성자, 정할 것을 묻고, 남은 게 없으면 기획 전체를 보여 주고 확정을 받는다.',
  6: '대상마다 어떤 상태를 거치는지 묻는다.',
  7: '흐름을 가르는 조건과 갈래를 묻는다.',
  8: '요구사항을 피쳐로 묶고 반복될 흐름을 함수로 뺄지 묻는다.',
  9: '진행표에서 작성중이거나 대기인 단위 하나를 골라 다음 분기를 묻는다.',
  10: 'sheet로 검토지를 받아 완성 기준마다 근거 줄을 찾고, 빠진 것은 사람에게 묻는다.',
  11: 'SDD 스펙 전체를 보여 주고 확정을 받는다.',
};

export class InputError extends Error {}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new InputError(`${path}를 JSON으로 읽지 못했다: ${error.message}`);
  }
}

export function evaluate(folder) {
  const planPath = join(folder, FILES.plan);
  if (!existsSync(planPath)) throw new InputError(`${planPath}가 없다. init으로 틀을 먼저 만든다.`);
  const plan = parsePlan(readFileSync(planPath, 'utf8'));
  const issues = checkPlan(plan).map((issue) => ({ ...issue, file: FILES.plan }));
  let progress = null;
  if (issues.length === 0) {
    const sddPath = join(folder, FILES.sdd);
    if (!existsSync(sddPath)) {
      issues.push({ step: 6, kind: 'SDD 없음', message: '기획이 확정됐으니 init을 다시 돌려 sdd.md 틀을 만든다.' });
    } else {
      const sdd = parseSdd(readFileSync(sddPath, 'utf8'));
      issues.push(...checkSdd(sdd, plan).map((issue) => ({ ...issue, file: FILES.sdd })));
      const tracePath = join(folder, FILES.trace);
      const trace = existsSync(tracePath) ? readJson(tracePath) : null;
      const traced = checkTrace(plan, sdd, trace);
      progress = progressOf(plan, traced.met);
      // 트리가 다 맞기 전에는 대조가 계속 흔들리므로 대조 결과는 트리 검사가 끝난 뒤에만 보인다.
      if (!issues.some((issue) => issue.step <= 9)) issues.push(...traced.issues);
    }
  }
  const step = issues.length ? Math.min(...issues.map((issue) => issue.step)) : null;
  const current = issues.filter((issue) => issue.step === step);
  return {
    stage: step === null ? '완료' : STEPS[step],
    step,
    issues: current,
    rest: issues.length - current.length,
    progress,
    next: step === null ? '사람에게 기획과 SDD 스펙이 모두 완성됐다고 알린다.' : NEXT[step],
  };
}

export function formatReport(report) {
  const lines = [`단계  ${report.stage}`];
  if (report.progress) {
    const per = report.progress.perRequirement.map((item) => `${item.id} ${item.met}/${item.total}`).join(' · ');
    lines.push(`완성도  ${per} · 전체 ${report.progress.percent}%`);
  } else {
    lines.push('완성도  기획 확정 전');
  }
  if (report.issues.length) {
    lines.push('추가되어야 완성');
    report.issues.forEach((issue, index) => lines.push(`${index + 1}. [${issue.kind}] ${issue.message}${issue.line ? ` (${issue.file} ${issue.line}줄)` : ''}`));
  }
  if (report.rest) lines.push(`그 밖에 ${report.rest}건`);
  lines.push(`다음  ${report.next}`);
  return lines.join('\n');
}
