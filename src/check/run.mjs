import { buildIndex } from '../model/index.mjs';
import { LABELS } from '../model/labels.mjs';
import { permissionGrid } from '../derive/permissions.mjs';
import { deriveQuestions } from '../derive/questions.mjs';
import { deriveAcceptanceDrafts } from '../derive/acceptance.mjs';
import { deriveFlow } from '../flow/derive.mjs';
import { deriveFlowcharts } from '../flow/flowchart.mjs';
import { deriveEdgeCases } from '../derive/edge-cases.mjs';
import { RULES } from './rules.mjs';

const round3 = (value) => Math.round(value * 1000) / 1000;

// 출처가 없거나 가정인 사실의 비율. 사람이 판단의 근거를 얼마나 갖고 있는지 보여 준다.
function assumptionRatio(spec) {
  const facts = [
    ...(spec.summary.problem ? [spec.summary.problem] : []),
    ...spec.userTypes, ...spec.requirements, ...spec.acceptance, ...spec.summary.metrics,
  ];
  if (facts.length === 0) return 0;
  const assumed = facts.filter((fact) => {
    const kind = fact.source?.kind;
    return !Object.hasOwn(LABELS.source, kind) || kind === 'assumption';
  });
  return round3(assumed.length / facts.length);
}

function derive(spec, index) {
  const flow = deriveFlow(spec, index);
  const grid = permissionGrid(spec, index);
  return {
    screens: flow.screens,
    edges: flow.edges,
    stepScreens: flow.stepScreens,
    entries: flow.entries,
    overrideResults: flow.overrideResults,
    permissionCells: grid.cells,
    permissionGaps: grid.gaps,
    questions: deriveQuestions(spec, index, { gaps: grid.gaps, flowQuestions: flow.questions }),
    acceptanceDrafts: deriveAcceptanceDrafts(spec, index, grid.cells),
    flowcharts: deriveFlowcharts(spec, index, grid.cells, flow),
    edgeCases: deriveEdgeCases(spec, index, grid.cells),
  };
}

function check(ctx) {
  let checked = 0;
  const issues = [];
  for (const rule of RULES) {
    const result = rule(ctx);
    checked += result.checked;
    issues.push(...result.issues);
  }
  const blockIssues = issues.filter((item) => item.level === 'block').length;
  const warnIssues = issues.length - blockIssues;
  const blockingQuestions = ctx.spec.questions.filter((question) => question.blocking === true).length + ctx.derived.questions.length;
  const passed = Math.max(checked - issues.length, 0);

  const reasons = [];
  if (blockIssues > 0) reasons.push(`차단 이슈 ${blockIssues}건`);
  if (blockingQuestions > 0) reasons.push(`착수를 막는 정할 것 ${blockingQuestions}건`);

  return {
    ready: blockIssues === 0 && blockingQuestions === 0,
    score: {
      checked,
      passed,
      ratio: checked === 0 ? 0 : round3(passed / checked),
      assumptionRatio: assumptionRatio(ctx.spec),
      blockingQuestions,
      blockIssues,
      warnIssues,
    },
    reasons,
    issues,
  };
}

// problems 는 parseSpec·loadSpec 이 돌려준 형식 오류 목록이다. 넘기지 않으면 형식 검사를 할 수 없다.
export function runPipeline(spec, problems = []) {
  const index = buildIndex(spec);
  const derived = derive(spec, index);
  const report = check({ spec, index, derived, problems });
  return { spec, index, derived, report };
}
