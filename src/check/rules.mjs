import { LABELS, PRODUCT, WORDING, josa, quote } from '../model/labels.mjs';
import { statesForAction } from '../derive/permissions.mjs';

// 규칙 하나는 함수 하나다. 모든 규칙은 (ctx) → { checked, issues } 를 돌려주고,
// 이슈 하나는 검사한 대상 하나에 대응한다. 그래야 점수(통과 수 = 검사 수 − 이슈 수)가 맞다.

const target = (index, id) => ({ id: String(id), name: index.name(id) });
const issue = (rule, level, message, targets) => ({ rule, level, message, targets });

const COLLECTIONS = [
  ['userType', (spec) => spec.userTypes],
  ['app', (spec) => spec.apps],
  ['requirement', (spec) => spec.requirements],
  ['entity', (spec) => spec.entities],
  ['state', (spec) => spec.entities.flatMap((entity) => entity.states)],
  ['action', (spec) => spec.actions],
  ['scenario', (spec) => spec.scenarios],
  ['metric', (spec) => spec.summary.metrics],
  ['event', (spec) => spec.events],
  ['question', (spec) => spec.questions],
  ['decision', (spec) => spec.decisions],
];

const hasText = (value) => typeof value === 'string' && value.trim() !== '';

export function idMissing({ spec }) {
  const issues = [];
  let checked = 0;
  for (const [kind, pick] of [...COLLECTIONS, ['acceptance', (s) => s.acceptance]]) {
    for (const item of pick(spec)) {
      checked += 1;
      if (!hasText(item.id)) {
        const label = hasText(item.name) ? quote(item.name) : '이름도 없는 항목';
        issues.push(issue('id-missing', 'block', `${LABELS.kind[kind]} ${label}에 ID가 없어 다른 요소와 연결할 수 없습니다`, []));
      }
    }
  }
  return { checked, issues };
}

export function idDuplicate({ index }) {
  const issues = index.duplicates.map(({ id, kinds }) => issue(
    'id-duplicate', 'block',
    `${kinds.map((kind) => LABELS.kind[kind]).join(', ')}에서 같은 ID를 함께 씁니다. 첫 번째만 사용합니다: '${id}'`,
    [target(index, id)],
  ));
  return { checked: Math.max(issues.length, 1), issues };
}

export function names({ spec, index }) {
  const issues = [];
  let checked = 0;
  for (const [kind, pick] of COLLECTIONS) {
    const seen = new Map();
    for (const item of pick(spec)) {
      if (!hasText(item.id)) continue;
      checked += 1;
      if (!hasText(item.name)) {
        issues.push(issue('name-missing', 'block', `${LABELS.kind[kind]} '${item.id}'에 한글 이름이 없습니다`, [target(index, item.id)]));
        continue;
      }
      if (seen.has(item.name)) {
        issues.push(issue('name-duplicate', 'block', `${LABELS.kind[kind]} 이름 ${quote(item.name, '이/가')} 겹칩니다. 같은 종류끼리는 이름이 달라야 합니다`, [target(index, seen.get(item.name)), target(index, item.id)]));
      } else {
        seen.set(item.name, item.id);
      }
    }
  }
  return { checked, issues };
}

export function referencesKnown({ spec, index }) {
  const issues = [];
  let checked = 0;
  const who = (id, pair) => quote(index.name(id), pair);

  // ID는 받침을 알 수 없으므로 조사가 붙지 않게 문장 끝에 둔다.
  function report(owner, where, kind, value) {
    const shown = hasText(value) ? `'${value}'` : '(비어 있음)';
    issues.push(issue('ref-unknown', 'block', `${where} 알 수 없는 ${LABELS.kind[kind]} ID를 참조합니다: ${shown}`, owner ? [target(index, owner)] : []));
  }
  function expect(owner, where, value, kind) {
    checked += 1;
    if (!index.is(value, kind)) report(owner, where, kind, value);
  }

  for (const requirement of spec.requirements) {
    expect(requirement.id, `요구사항 ${who(requirement.id, '이/가')}`, requirement.userType, 'userType');
  }
  for (const action of spec.actions) {
    expect(action.id, `동작 ${who(action.id, '이/가')}`, action.entity, 'entity');
    for (const destination of action.crossApp) {
      const where = `동작 ${who(action.id)}의 다른 앱 영향이`;
      expect(action.id, where, destination.app, 'app');
      expect(action.id, where, destination.userType, 'userType');
    }
  }
  for (const entity of spec.entities) {
    for (const transition of entity.transitions) {
      const where = `개체 ${who(entity.id)}의 상태 전이가`;
      for (const field of ['from', 'to']) {
        checked += 1;
        if (!entity.states.some((state) => state.id === transition[field])) report(entity.id, where, 'state', transition[field]);
      }
      expect(entity.id, where, transition.action, 'action');
    }
  }
  spec.permissions.forEach((row, position) => {
    const where = `동작 가능표 ${position + 1}번째 칸이`;
    expect(null, where, row.userType, 'userType');
    expect(null, where, row.action, 'action');
    if (row.state === undefined || !index.is(row.action, 'action')) return;
    const action = index.get(row.action).item;
    const allowed = statesForAction(action, index) ?? [];
    checked += 1;
    if (allowed.includes(row.state)) return;
    const stateless = allowed.length === 1 && allowed[0] === null;
    issues.push(issue('ref-unknown', 'block', stateless
      ? `${where} ${quote(action.name)}에 상태를 적었지만 이 동작은 상태별 칸이 없습니다`
      : `${where} ${quote(action.name)} 개체의 상태가 아닌 ID를 참조합니다: '${row.state}'`, [target(index, row.action)]));
  });
  for (const scenario of spec.scenarios) {
    expect(scenario.id, `시나리오 ${who(scenario.id, '이/가')}`, scenario.requirement, 'requirement');
    scenario.steps.forEach((step, position) => {
      const where = `시나리오 ${who(scenario.id)}의 ${position + 1}번째 단계가`;
      expect(scenario.id, where, step.userType, 'userType');
      expect(scenario.id, where, step.app, 'app');
      expect(scenario.id, where, step.action, 'action');
    });
  }
  for (const condition of spec.acceptance) expect(condition.id, '완료 조건이', condition.requirement, 'requirement');
  for (const metric of spec.summary.metrics) {
    for (const event of metric.events) expect(metric.id, `지표 ${who(metric.id, '이/가')}`, event, 'event');
  }
  for (const event of spec.events) {
    if (event.action !== undefined) expect(event.id, `이벤트 ${who(event.id, '이/가')}`, event.action, 'action');
  }
  for (const override of spec.flowOverrides) {
    expect(null, '흐름 바꾸기가', override.action, 'action');
    if (override.decision !== undefined) expect(null, '흐름 바꾸기가', override.decision, 'decision');
  }
  return { checked, issues };
}

export function requirementCoverage({ spec, index }) {
  const issues = [];
  for (const requirement of spec.requirements) {
    if (!spec.scenarios.some((scenario) => scenario.requirement === requirement.id)) {
      issues.push(issue('requirement-scenario', 'block', `요구사항 ${quote(index.name(requirement.id), '을/를')} 이루는 시나리오가 없습니다`, [target(index, requirement.id)]));
    }
    if (!spec.acceptance.some((condition) => condition.requirement === requirement.id)) {
      issues.push(issue('requirement-acceptance', 'block', `요구사항 ${quote(index.name(requirement.id), '을/를')} 검증하는 확정 완료 조건이 없습니다`, [target(index, requirement.id)]));
    }
  }
  return { checked: spec.requirements.length * 2, issues };
}

export function permissionGaps({ index, derived }) {
  const issues = derived.permissionGaps.map((gap) => {
    const targets = [target(index, gap.userType), target(index, gap.action)];
    if (gap.state !== null) targets.push(target(index, gap.state));
    return issue('permission-gap', 'block', `동작 가능표 빈칸: ${targets.map((t) => quote(t.name)).join(' × ')}`, targets);
  });
  return { checked: derived.permissionCells.length, issues };
}

export function states({ spec, index }) {
  const issues = [];
  let checked = 0;
  for (const entity of spec.entities) {
    if (entity.states.length === 0) continue;
    const initial = entity.states.filter((state) => state.initial === true).map((state) => state.id);
    checked += 1;
    if (initial.length === 0) {
      issues.push(issue('state-initial', 'block', `개체 ${quote(entity.name)}에 시작 상태가 없습니다`, [target(index, entity.id)]));
    } else {
      const reached = new Set(initial);
      const queue = [...initial];
      while (queue.length > 0) {
        const from = queue.shift();
        for (const transition of entity.transitions) {
          if (transition.from === from && !reached.has(transition.to)) {
            reached.add(transition.to);
            queue.push(transition.to);
          }
        }
      }
      for (const state of entity.states) {
        checked += 1;
        if (!reached.has(state.id)) {
          issues.push(issue('state-reachable', 'block', `${quote(entity.name)}의 ${quote(state.name)} 상태에는 시작 상태에서 갈 수 없습니다`, [target(index, state.id)]));
        }
      }
    }
    for (const state of entity.states) {
      if (state.terminal === true) continue;
      checked += 1;
      if (!entity.transitions.some((transition) => transition.from === state.id)) {
        issues.push(issue('state-exit', 'block', `${quote(entity.name)}의 ${quote(state.name)} 상태에서 나가는 전이가 없습니다. 끝 상태라면 끝 상태로 표시하세요`, [target(index, state.id)]));
      }
    }
  }
  return { checked, issues };
}

export function flowSteps({ spec, index, derived }) {
  const issues = [];
  let checked = 0;
  for (const scenario of spec.scenarios) {
    scenario.steps.forEach((_, position) => {
      checked += 1;
      if (!Object.hasOwn(derived.stepScreens, `${scenario.id}#${position + 1}`)) {
        issues.push(issue('flow-step', 'block', `시나리오 ${quote(index.name(scenario.id))}의 ${position + 1}번째 단계가 어느 화면에서 일어나는지 정해지지 않았습니다`, [target(index, scenario.id)]));
      }
    });
  }
  return { checked, issues };
}

export function flowOrphans({ derived }) {
  const reached = new Set(derived.entries);
  const queue = [...derived.entries];
  while (queue.length > 0) {
    const from = queue.shift();
    for (const edge of derived.edges) {
      if (edge.from === from && !reached.has(edge.to)) {
        reached.add(edge.to);
        queue.push(edge.to);
      }
    }
  }
  const issues = derived.screens
    .filter((screen) => !reached.has(screen.id))
    .map((screen) => issue('flow-orphan', 'block', `화면 ${quote(screen.name)}에는 진입점에서 갈 수 없습니다`, [{ id: screen.id, name: screen.name }]));
  return { checked: derived.screens.length, issues };
}

// 검증은 형식(type)과 범위로 적어야 개발자가 같은 규칙을 만들고 경계값 사례를 뽑을 수 있다.
export function inputRules({ spec }) {
  const issues = [];
  let checked = 0;
  const warn = (action, message) => issues.push(issue('input-rule', 'warn', message, [{ id: String(action.id), name: action.name }]));
  for (const action of spec.actions) {
    for (const input of action.inputs) {
      checked += 1;
      const label = `${quote(action.name)}의 입력 ${quote(input.name ?? '이름 없음')}`;
      if (input.type === undefined) warn(action, `${label}에 형식(type)이 없어 어떤 검증인지 알 수 없습니다. text·number·date·select·file 등으로 적으세요`);
      else if ((input.type === 'select') && !(input.options?.length > 0) && typeof input.optionsFrom !== 'string') warn(action, `${label}은 선택 입력인데 고를 수 있는 목록(options)이나 목록을 가져올 곳(optionsFrom)이 없습니다`);
    }
  }
  return { checked, issues };
}

export function asyncFeedback({ spec }) {
  const issues = [];
  const asyncActions = spec.actions.filter((action) => action.async === true);
  for (const action of asyncActions) {
    const missing = [];
    if (!hasText(action.success)) missing.push('성공 안내');
    if (action.failures.length === 0) missing.push('실패 안내');
    if (missing.length > 0) {
      issues.push(issue('async-feedback', 'warn', `서버를 거치는 ${quote(action.name)}에 ${missing.join('와 ')}가 없습니다 (상태 알림·오류 회복)`, [{ id: String(action.id), name: action.name }]));
    }
  }
  return { checked: asyncActions.length, issues };
}

export function metricEvents({ spec, index }) {
  const issues = spec.summary.metrics
    .filter((metric) => metric.events.length === 0)
    .map((metric) => issue('metric-event', 'block', `지표 ${quote(index.name(metric.id), '을/를')} 잴 이벤트가 없습니다`, [target(index, metric.id)]));
  return { checked: spec.summary.metrics.length, issues };
}

export function problemSource({ spec }) {
  const problem = spec.summary.problem;
  if (!hasText(problem?.text)) {
    return { checked: 1, issues: [issue('problem-source', 'block', '해결할 문제가 적혀 있지 않습니다', [])] };
  }
  const kind = problem.source?.kind;
  if (!Object.hasOwn(LABELS.source, kind) || kind === 'assumption') {
    return { checked: 1, issues: [issue('problem-source', 'block', '문제에 가정이 아닌 출처가 없습니다', [])] };
  }
  return { checked: 1, issues: [] };
}


export function questionOwners({ spec, index }) {
  const issues = spec.questions
    .filter((question) => !hasText(question.owner))
    .map((question) => issue('question-owner', 'block', `정할 것 ${quote(index.name(question.id))}에 담당자가 없습니다`, [target(index, question.id)]));
  return { checked: spec.questions.length, issues };
}

export function shape({ problems }) {
  const issues = problems.map((problem) => issue('shape', 'block', `형식 오류: ${problem.path} — ${problem.expected}`, []));
  return { checked: Math.max(issues.length, 1), issues };
}

const REQUIRED_SECTIONS = [
  ['userTypes', 'userType'], ['apps', 'app'], ['requirements', 'requirement'],
  ['entities', 'entity'], ['actions', 'action'], ['scenarios', 'scenario'],
];

// 비어 있는 영역이 있으면 검사할 대상 자체가 없어 모든 관계 규칙이 통과해 버린다. 그래서 먼저 막는다.
export function required({ spec }) {
  const issues = REQUIRED_SECTIONS
    .filter(([key]) => spec[key].length === 0)
    .map(([, kind]) => issue('required', 'block', `${josa(LABELS.kind[kind], '이/가')} 하나도 없습니다`, []));
  if (spec.summary.metrics.length === 0) issues.push(issue('required', 'block', '목표 지표가 하나도 없습니다', []));
  return { checked: REQUIRED_SECTIONS.length + 1, issues };
}

export function scenarioSteps({ spec, index }) {
  const issues = spec.scenarios
    .filter((scenario) => scenario.steps.length === 0)
    .map((scenario) => issue('scenario-steps', 'block', `시나리오 ${quote(index.name(scenario.id))}에 단계가 없습니다`, [target(index, scenario.id)]));
  return { checked: spec.scenarios.length, issues };
}

const OVERRIDE_REASON = {
  'not-form': '목록·상세를 보는 동작이라 모달·화면을 고를 수 없습니다',
  'no-inputs': '입력이 없어 지금 화면의 버튼으로 처리됩니다',
  'no-opener': '모달이 뜰 바탕 화면이 없어 화면으로 열었습니다',
  unused: '어느 시나리오 단계에서도 쓰이지 않습니다',
};

// 사람이 적은 결정이 흐름에 반영되지 않았다면 알려야 한다. 착수를 막을 일은 아니므로 경고다.
export function flowOverrideResults({ index, derived }) {
  const issues = derived.overrideResults
    .filter((entry) => entry.result !== 'applied' && index.is(entry.action, 'action'))
    .map((entry) => issue('flow-override', 'warn', `흐름 바꾸기가 ${quote(index.name(entry.action))}에 적용되지 않았습니다: ${OVERRIDE_REASON[entry.result]}`, [target(index, entry.action)]));
  return { checked: derived.overrideResults.length, issues };
}

// 요청한 것만 기획한다: 동작은 어느 시나리오 단계에서 쓰여야 하고, 개체는 동작이 하나 이상 있어야 한다.
// 쓰이지 않는 요소는 요청에 없던 기능이거나 시나리오가 빠진 것이다. 어느 쪽인지는 사람이 정하므로 경고로 둔다.
export function requestScope({ spec, index }) {
  const usedActions = new Set(spec.scenarios.flatMap((scenario) => scenario.steps.map((step) => step.action)));
  const issues = [];
  for (const action of spec.actions) {
    if (!usedActions.has(action.id)) {
      issues.push(issue('request-scope', 'warn', `동작 ${quote(index.name(action.id), '이/가')} 어느 시나리오에서도 쓰이지 않습니다. 요청 밖이면 빼고, 필요하면 시나리오에 넣으세요`, [target(index, action.id)]));
    }
  }
  for (const entity of spec.entities) {
    if (!spec.actions.some((action) => action.entity === entity.id)) {
      issues.push(issue('request-scope', 'warn', `개체 ${quote(index.name(entity.id))}에는 동작이 없습니다. 요청 밖이면 빼세요`, [target(index, entity.id)]));
    }
  }
  return { checked: spec.actions.length + spec.entities.length, issues };
}

// 우선순위가 없으면 무엇부터 만들지 정할 수 없다. 착수는 막지 않지만 100%로 치지 않는다.
export function requirementPriority({ spec, index }) {
  const issues = spec.requirements
    .filter((requirement) => !Object.hasOwn(LABELS.priority, requirement.priority))
    .map((requirement) => issue('requirement-priority', 'warn', `요구사항 ${quote(index.name(requirement.id))}에 우선순위(필수·권장·선택)가 없습니다`, [target(index, requirement.id)]));
  return { checked: spec.requirements.length, issues };
}

// 사람이 읽는 글에는 문서 기호를 쓰지 않는다. '§5.2.2'보다 '5.2.2 과제 기한 설정'이 읽힌다.
const SYMBOLS = /[§¶※]/;
export function plainText({ spec, index }) {
  const fields = [];
  const add = (owner, label, value) => { if (typeof value === 'string') fields.push({ owner, label, value }); };
  if (spec.summary.problem) add(null, '해결할 문제', spec.summary.problem.text);
  spec.summary.outOfScope.forEach((text) => add(null, '이번에 하지 않는 것', text));
  for (const [, items] of COLLECTIONS.map(([kind, pick]) => [kind, pick(spec)])) {
    for (const item of items) add(item.id, '이름', item.name);
  }
  for (const userType of spec.userTypes) add(userType.id, '목표', userType.goal);
  for (const action of spec.actions) {
    add(action.id, '성공 안내', action.success);
    for (const failure of action.failures) { add(action.id, '실패 이름', failure.name); add(action.id, '실패 안내', failure.message); }
    for (const input of action.inputs) { add(action.id, '입력 이름', input.name); (Array.isArray(input.rules) ? input.rules : []).forEach((rule) => add(action.id, '입력 규칙', rule)); }
    for (const target of action.crossApp) add(action.id, '다른 앱 영향', target.effect);
  }
  for (const scenario of spec.scenarios) scenario.steps.forEach((step) => add(scenario.id, '단계 글', step.text));
  for (const [key, value] of Object.entries(spec.wording)) add(null, `공통 문구 ${key}`, value);
  for (const action of spec.actions) { add(action.id, '확인 창 문구', action.confirm?.message); add(action.id, '권한 없음 문구', action.denied); add(action.id, '빈 화면 문구', action.empty); action.inputs.forEach((input) => add(action.id, '입력 오류 문구', input.error)); action.crossApp.forEach((item) => add(action.id, '알림 문구', item.message)); }
  for (const condition of spec.acceptance) { add(condition.id, '상황', condition.situation); add(condition.id, '결과', condition.result); }
  const issues = fields.filter((field) => SYMBOLS.test(field.value)).map((field) => {
    const where = field.owner === null ? field.label : `${quote(index.name(field.owner))}의 ${field.label}`;
    return issue('plain-text', 'warn', `${where}에 문서 기호(§ 등)가 있습니다. '5.2.2 과제 기한 설정'처럼 번호와 제목으로 쓰세요: ${quote(field.value)}`, field.owner === null ? [] : [target(index, field.owner)]);
  });
  return { checked: fields.length, issues };
}

// 문구가 없으면 개발자가 지어내야 한다. 공통 문구는 한 번, 확인 창과 다른 앱 알림은 기능마다 정한다.
export function wording({ spec, index }) {
  const issues = [];
  let checked = 0;
  for (const [key, label] of Object.entries(WORDING)) {
    checked += 1;
    if (!hasText(spec.wording[key])) issues.push(issue('wording', 'warn', `공통 문구 ${quote(label)}(wording.${key})가 없습니다`, []));
  }
  for (const action of spec.actions) {
    const target = [{ id: String(action.id), name: action.name }];
    if (action.irreversible === true) {
      checked += 1;
      if (!hasText(action.confirm?.message)) issues.push(issue('wording', 'warn', `${quote(action.name)}에 확인 창 문구(confirm.message)가 없습니다`, target));
    }
    for (const item of action.crossApp) {
      checked += 1;
      if (!hasText(item.message)) issues.push(issue('wording', 'warn', `${quote(action.name, '이/가')} ${quote(index.has(item.app) ? index.name(item.app) : String(item.app))}에 주는 알림 문구(crossApp.message)가 없습니다`, target));
    }
  }
  return { checked, issues };
}

// 서비스 구성: 무엇을 만드는지(새 서비스·기능 추가·프로젝트), 몇 개의 시스템에 걸치는지, 앱은 어느 서비스에 속하는지.
export function product({ spec, index }) {
  const issues = [];
  const warn = (message, targets = []) => issues.push(issue('product', 'warn', message, targets));
  const { kind, systems } = spec.product;
  let checked = 2;
  if (kind === undefined) warn(`구분(product.kind)이 없습니다. ${Object.entries(PRODUCT.kind).map(([key, label]) => `${key}(${label})`).join('·')} 중 하나로 적으세요`);
  if (systems.length === 0) warn('시스템(product.systems)이 없습니다. 이 기획이 걸치는 서비스·API 서버·외부 시스템을 적으세요');
  const owned = new Set(systems.filter((system) => system.kind === 'service').flatMap((system) => system.apps));
  if (systems.length > 0) {
    for (const app of spec.apps) {
      checked += 2;
      if (!owned.has(app.id)) warn(`앱 ${quote(index.name(app.id), '이/가')} 어느 서비스에도 속하지 않습니다`, [target(index, app.id)]);
      if (app.platform === undefined) warn(`앱 ${quote(index.name(app.id))}에 플랫폼(platform)이 없습니다`, [target(index, app.id)]);
    }
  }
  for (const action of spec.actions) {
    for (const call of action.calls) {
      checked += 1;
      if (!index.is(call, 'system')) warn(`${quote(action.name, '이/가')} 부르는 시스템 ${quote(call)}이 시스템 목록에 없습니다`, [{ id: String(action.id), name: action.name }]);
    }
  }
  return { checked, issues };
}

export const RULES = [
  shape, required, idMissing, idDuplicate, names, referencesKnown, requirementCoverage, permissionGaps, states,
  scenarioSteps, flowSteps, flowOrphans, flowOverrideResults, metricEvents, problemSource, questionOwners, inputRules, asyncFeedback, requestScope, requirementPriority, plainText, wording, product,
];
