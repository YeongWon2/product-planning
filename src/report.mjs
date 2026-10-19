// 작업 폴더 하나를 검사해 지금 단계와 추가돼야 완성인 것을 낸다 (docs/harness.md 4·5장).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PLAN_STEPS, checkPlan, parsePlan } from './plan.mjs';
import { SDD_STEPS, checkSdd, parseSdd } from './sdd.mjs';
import { checkTrace, progressOf } from './trace.mjs';

export const FILES = { plan: 'plan.md', sdd: 'sdd.md', trace: 'trace.json', lock: 'lock.json' };
const STEPS = { ...PLAN_STEPS, ...SDD_STEPS };
const NEXT = {
  1: '누가 쓰는지, 무엇을 원하는지, 평소 어떻게 행동하는지 묻는다.',
  2: '페르소나의 필요에서 출발해 무엇을 해 줘야 하는지, 꼭 할지 나중에 할지 묻는다.',
  3: '요구사항마다 "이게 되면 완성"인 기준을 묻는다.',
  4: '이번에 하지 않는 것을 묻고, 요구사항 전체를 보여 준 뒤 잠가도 되는지 묻는다.',
  5: '잠긴 요구사항을 바탕으로 요약과 배경, 무엇으로 확인할 목표를 묻는다.',
  6: '요구사항마다 어떤 규칙으로 동작하는지, 예외는 무엇인지 묻는다.',
  7: '선택 구역과 작성자, 정할 것을 묻고, 남은 게 없으면 PRD 전체를 보여 주고 확정을 받는다.',
  8: '대상마다 어떤 상태를 거치는지 묻는다.',
  9: '흐름을 가르는 조건과 갈래를 묻는다. 권한 조건도 여기에 넣는다.',
  10: '요구사항을 피쳐로 묶고 반복될 흐름을 함수로 뺄지 묻는다.',
  11: '진행표에서 작성중이거나 대기인 단위 하나를 골라 다음 분기를 묻는다.',
  12: 'sheet로 검토지를 받아 완성 기준마다 근거 줄을 찾고, 빠진 것은 사람에게 묻는다.',
  13: 'SDD 스펙 전체를 보여 주고 확정을 받는다.',
};
const RELOCK = '사람에게 무엇이 바뀌었는지 보여 주고, 맞으면 unlock 뒤 다시 lock한다. 아니면 잠근 때로 되돌린다.';
const PRD_DONE = 'export로 PRD를 프로젝트 docs에 쓰고, 여기서 끝낼지 SDD로 넘어갈지 묻는다.';

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
  const lockPath = join(folder, FILES.lock);
  const lock = existsSync(lockPath) ? readJson(lockPath) : null;
  const issues = checkPlan(plan, { lock }).map((issue) => ({ ...issue, file: FILES.plan }));
  const prdDone = issues.length === 0;
  let progress = null;
  if (prdDone) {
    const sddPath = join(folder, FILES.sdd);
    if (!existsSync(sddPath)) {
      issues.push({ step: 8, kind: 'SDD 없음', message: 'PRD가 확정됐다. SDD로 넘어가면 init을 다시 돌려 sdd.md 틀을 만든다.' });
    } else {
      const sdd = parseSdd(readFileSync(sddPath, 'utf8'));
      issues.push(...checkSdd(sdd, plan).map((issue) => ({ ...issue, file: FILES.sdd })));
      const tracePath = join(folder, FILES.trace);
      const trace = existsSync(tracePath) ? readJson(tracePath) : null;
      const traced = checkTrace(plan, sdd, trace);
      progress = progressOf(plan, traced.met);
      // 트리가 다 맞기 전에는 대조가 계속 흔들리므로 대조 결과는 트리 검사가 끝난 뒤에만 보인다.
      if (!issues.some((issue) => issue.step <= 11)) issues.push(...traced.issues);
    }
  }
  const step = issues.length ? Math.min(...issues.map((issue) => issue.step)) : null;
  const current = issues.filter((issue) => issue.step === step);
  const sddMissing = current.some((issue) => issue.kind === 'SDD 없음');
  const relock = current.some((issue) => issue.kind === '잠근 뒤 바뀜');
  return {
    stage: step === null ? '완료' : STEPS[step],
    step,
    prdDone,
    issues: current,
    rest: issues.length - current.length,
    progress,
    next: step === null ? 'export로 PRD와 SDD를 프로젝트 docs에 쓰고, 사람에게 모두 완성됐다고 알린다.' : sddMissing ? PRD_DONE : relock ? RELOCK : NEXT[step],
  };
}

export function formatReport(report) {
  const lines = [`단계  ${report.stage}`];
  if (report.progress) {
    const per = report.progress.perRequirement.map((item) => `${item.id} ${item.met}/${item.total}`).join(' · ');
    lines.push(`완성도  ${per} · 전체 ${report.progress.percent}%`);
  } else {
    lines.push(report.prdDone ? '완성도  SDD 대조 전' : '완성도  PRD 확정 전');
  }
  if (report.issues.length) {
    lines.push('추가되어야 완성');
    report.issues.forEach((issue, index) => lines.push(`${index + 1}. [${issue.kind}] ${issue.message}${issue.line ? ` (${issue.file} ${issue.line}줄)` : ''}`));
  }
  if (report.rest) lines.push(`그 밖에 ${report.rest}건`);
  lines.push(`다음  ${report.next}`);
  return lines.join('\n');
}
