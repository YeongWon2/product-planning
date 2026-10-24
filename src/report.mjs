// 폴더 하나를 검사해 지금 단계와 추가돼야 완성인 것을 낸다 (docs/harness.md 4·5장).
// 앞 문서가 다 통과해야 뒤 문서를 본다: brief → plan → spec(+trace) → dev + diagram.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BRIEF_STEPS, checkBrief, parseBrief } from './brief.mjs';
import { PLAN_STEPS, checkPlan, parsePlan } from './plan.mjs';
import { SPEC_STEPS, checkSpec, parseSpec } from './spec.mjs';
import { DEV_STEPS, checkDev, devIds, parseDev } from './dev.mjs';
import { checkDiagram, parseDiagram } from './diagram.mjs';
import { citable } from './cite.mjs';
import { checkTrace, progressOf } from './trace.mjs';

export const FILES = { brief: 'brief.md', plan: 'plan.md', spec: 'spec.md', trace: 'trace.json', dev: 'dev.md', diagram: 'diagram.md' };
const STEPS = { ...BRIEF_STEPS, ...PLAN_STEPS, ...SPEC_STEPS, ...DEV_STEPS };
const QUOTE = '원문을 인용해';
const NEXT = {
  1: '결과 폴더 이름이 될 영어 기능 이름을 묻는다.',
  2: '지금 무엇이 문제인지, 근거(숫자, 출처)가 무엇인지 묻는다.',
  3: '무엇이 되면 성공인지 숫자로 된 지표를 묻는다.',
  4: `목표를 ${QUOTE} "그러려면 무엇이 돼야 하나요?"를 묻고, 사람이 한 말을 원문으로 남긴다.`,
  5: '이번에 하지 않을 것과 지켜야 할 기한·정책·법을 묻는다.',
  6: '정할 것을 묻고, 남은 게 없으면 비즈니스 요구사항 전체를 보여 주고 확정을 받는다.',
  7: `BR을 ${QUOTE} 누가 쓰는지, 무엇을 원하는지, 평소 어떻게 행동하는지 묻는다.`,
  8: `BR과 페르소나의 원하는 것을 ${QUOTE} 무엇을 해 줘야 하는지 묻는다.`,
  9: '요구사항마다 "이것만 먼저 나가도 쓸 만한가요?"로 우선순위를 묻는다.',
  10: `요구사항을 ${QUOTE} "이게 되면 완성"인 기준을 묻는다.`,
  11: '정할 것을 묻고, 남은 게 없으면 PRD 미리 보기를 보여 주고 확정을 받는다.',
  12: `요구사항을 ${QUOTE} 대상마다 어떤 상태를 거치는지 묻는다.`,
  13: '흐름을 가르는 조건과 갈래를 묻는다.',
  14: '요구사항을 피쳐(F)로 묶고 반복될 흐름을 함수(FN)로 뺄지 묻는다.',
  15: `진행표에서 작성중이거나 대기인 단위 하나를 골라 완성 기준을 ${QUOTE} 다음 분기를 묻는다.`,
  16: 'sheet로 검토지를 받아 완성 기준마다 근거 줄을 찾고, 빠진 것은 사람에게 묻는다.',
  17: '기획 상세 스펙 전체를 보여 주고 확정을 받는다. 확정되면 개발 스펙으로 넘어갈지 묻는다.',
  18: `quotes로 원문을 받아, PRD 제약·범위 밖을 ${QUOTE} 무엇을 정했고 왜인지 묻는다.`,
  19: `트리의 진입·행동을 ${QUOTE} 어떤 구성 요소가 무엇을 책임지는지 묻는다.`,
  20: `상태표의 대상을 ${QUOTE} 무엇을 저장하고 깨지면 안 되는 규칙이 무엇인지 묻는다.`,
  21: `트리의 사용자 행동을 ${QUOTE} 무엇을 보내고 성공·실패 때 무엇을 받는지 묻는다.`,
  22: `계약을 ${QUOTE} 누가 누구를 어떤 순서로 부르는지, 조건 갈래마다 무엇이 오가는지 묻는다.`,
  23: `조건의 실패 갈래를 ${QUOTE} 실패하면 무엇이 보이고 시스템은 무엇을 하는지 묻는다.`,
  24: `PRD 지표와 페르소나 행동 패턴을 ${QUOTE} 숫자로 된 제약을 묻는다.`,
  25: '먼저 깔아야 할 것과 P1부터의 작업 순서를 묻는다.',
  26: `완성 기준을 ${QUOTE} 무엇을 해 보면 완성인지 확인되는지 묻는다.`,
  27: '프로젝트 규칙 파일(CLAUDE.md, 컨벤션 문서)을 읽고 결정과 어긋나는 게 없는지 개발자와 확인한다.',
  28: '남은 것을 묻고, 없으면 개발 스펙과 시퀀스 다이어그램을 보여 주고 확정을 받는다.',
};

export class InputError extends Error {}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new InputError(`${path}를 JSON으로 읽지 못했다: ${error.message}`);
  }
}

// 폴더의 작업 파일을 읽어 둔다. 없는 파일은 null이다.
export function load(folder) {
  const read = (name, parse) => (existsSync(join(folder, FILES[name])) ? parse(readFileSync(join(folder, FILES[name]), 'utf8')) : null);
  if (!existsSync(join(folder, FILES.brief))) throw new InputError(`${join(folder, FILES.brief)}가 없다. init으로 틀을 먼저 만든다.`);
  const trace = existsSync(join(folder, FILES.trace)) ? readJson(join(folder, FILES.trace)) : null;
  return { brief: read('brief', parseBrief), plan: read('plan', parsePlan), spec: read('spec', parseSpec), dev: read('dev', parseDev), diagram: read('diagram', parseDiagram), trace };
}

const tag = (file) => (issue) => ({ ...issue, file });
const missing = (step, kind, message) => [{ step, kind, message }];

export function evaluate(folder) {
  const docs = load(folder);
  const { brief, plan, spec, dev, diagram, trace } = docs;
  const issues = checkBrief(brief).map(tag(FILES.brief));
  let progress = null;
  let planDone = false;
  if (issues.length === 0) {
    if (!plan) issues.push(...missing(7, '기획 없음', '비즈니스 요구사항이 확정됐으니 init을 다시 돌려 plan.md 틀을 만든다.'));
    else issues.push(...checkPlan(plan, brief).map(tag(FILES.plan)));
  }
  if (issues.length === 0) {
    if (!spec) issues.push(...missing(12, '기획 상세 스펙 없음', 'PRD가 확정됐으니 init을 다시 돌려 spec.md 틀을 만든다.'));
    else {
      issues.push(...checkSpec(spec, plan).map(tag(FILES.spec)));
      const traced = checkTrace(plan, spec, trace);
      progress = progressOf(plan, traced.met);
      // 트리가 다 맞기 전에는 대조가 계속 흔들리므로 대조 결과는 트리 검사가 끝난 뒤에만 보인다.
      if (!issues.some((issue) => issue.step <= 15)) issues.push(...traced.issues.map(tag(FILES.trace)));
    }
    planDone = issues.length === 0;
  }
  if (planDone) {
    if (!dev || !diagram) issues.push(...missing(18, '개발 스펙 없음', '기획이 모두 확정됐다. 개발로 넘어가려면 init을 다시 돌려 dev.md와 diagram.md 틀을 만든다.'));
    else {
      const sources = citable(brief, plan, spec);
      issues.push(...checkDev(dev, { brief, plan, spec, sources, diagram }).map(tag(FILES.dev)));
      issues.push(...checkDiagram(diagram, { plan, spec, dev, sources, ids: devIds(dev, diagram) }).map(tag(FILES.diagram)));
    }
  }
  const step = issues.length ? Math.min(...issues.map((issue) => issue.step)) : null;
  const current = issues.filter((issue) => issue.step === step);
  const devDone = planDone && step === null;
  return {
    stage: step === null ? '완료' : planDone && current[0]?.kind === '개발 스펙 없음' ? '기획 완료' : STEPS[step],
    step,
    issues: current,
    rest: issues.length - current.length,
    progress,
    done: { plan: planDone, dev: devDone },
    next: step === null ? '네 문서가 모두 완성됐다고 알리고 export로 프로젝트에 내보낸다.' : planDone && current[0]?.kind === '개발 스펙 없음' ? '기획이 끝났다고 알리고, 개발 스펙으로 넘어갈지 묻는다. 그만두면 export로 기획만 내보낸다.' : NEXT[step],
  };
}

export function formatReport(report) {
  const lines = [`단계  ${report.stage}`];
  if (report.progress) {
    const per = report.progress.perRequirement.map((item) => `${item.id} ${item.met}/${item.total}`).join(' · ');
    lines.push(`완성도  ${per} · 전체 ${report.progress.percent}%`);
  } else {
    lines.push('완성도  기획 상세 스펙 전');
  }
  if (report.issues.length) {
    lines.push('추가되어야 완성');
    report.issues.forEach((issue, index) => lines.push(`${index + 1}. [${issue.kind}] ${issue.message}${issue.line ? ` (${issue.file} ${issue.line}줄)` : ''}`));
  }
  if (report.rest) lines.push(`그 밖에 ${report.rest}건`);
  lines.push(`다음  ${report.next}`);
  return lines.join('\n');
}
