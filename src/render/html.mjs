import { LABELS, PRODUCT, WORDING, quote, readableRef } from '../model/labels.mjs';
import { escapeHtml as h, jsonForScript } from './escape.mjs';
import { renderFlowchart } from './flowchart-svg.mjs';
import { BOARD_SCRIPT, BOARD_STYLE, packRows, renderBoard } from './board.mjs';
import { renderStates } from './state-svg.mjs';
import { renderOverview } from './overview-svg.mjs';

const FORMAT = 'product-planning/spec@1';

// 사람이 읽는 문서는 네 부분뿐이다. 이것만 보고 개발할 수 있어야 한다.
// 흐름과 갈래는 플로우차트(그림)에, 정확한 값(권한·검증·문구)은 기능명세서(표)에 한 번씩만 적는다.
// 나머지(화면 목록·이동, 완료 조건 초안, 검사 세부, 결정 기록 등)는 AI용 모델 데이터에만 둔다.
const PARTS = [
  { key: 'prd', title: 'PRD', lead: '무엇을 왜 만드나', shows: ['product', 'apps', 'summary.problem', 'userTypes', 'summary.metrics', 'requirements'] },
  { key: 'scenarios', title: '시나리오', lead: '누가 어떤 순서로 하나', shows: ['scenarios', 'acceptance'] },
  { key: 'flowcharts', title: '플로우차트', lead: '어떤 판단을 거쳐 어떻게 끝나나', shows: ['derived.overview', 'derived.flowcharts'] },
  { key: 'spec', title: '기능명세서', lead: '기능마다 누가, 무엇을 넣고, 무엇이 바뀌고, 어떤 경우를 막나', shows: ['entities', 'actions', 'derived.permissionCells', 'derived.edgeCases'] },
];
const DATA_ONLY = [
  'derived.screens', 'derived.edges', 'derived.stepScreens', 'derived.entries', 'derived.overrideResults',
  'derived.acceptanceDrafts', 'derived.permissionGaps', 'derived.questions', 'report', 'decisions', 'questions', 'events', 'summary.outOfScope',
];

const INPUT_TYPE = {
  text: '텍스트', number: '숫자', date: '날짜', period: '기간', select: '하나 선택', multiSelect: '여러 개 선택', file: '파일', url: '링크', boolean: '예/아니오',
};

const mark = (id, kind) => ` data-spec-id="${h(id)}" data-spec-kind="${kind}"`;
const table = (className, head, rows) => `<div class="table-wrap"><table class="${className}"><thead><tr>${head.map((cell) => `<th>${cell}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
const empty = (text) => `<p class="empty">${h(text)}</p>`;
const text = (value) => (typeof value === 'string' ? value : '');
const isAutomatic = (index, userType) => index.get(userType)?.kind === 'userType' && index.get(userType).item.automatic === true;

function sourceNote(source) {
  if (typeof source?.ref !== 'string' || source.ref === '') return source?.kind === 'assumption' ? '<span class="source source-assumption">가정</span>' : '';
  return `<span class="source">${h(readableRef(source.ref))}</span>`;
}

function part(key, body) {
  const position = PARTS.findIndex((item) => item.key === key);
  const { title, lead } = PARTS[position];
  return `<section id="${key}" class="part part-${key}" data-part="${key}"><header class="part-head"><span class="part-no">${position + 1}</span><div><h2>${h(title)}</h2><p>${h(lead)}</p></div></header><div class="part-body">${body}</div></section>`;
}

// 착수를 막는 것이 남았을 때만 맨 위에 알린다. 다 풀리면 아무것도 보이지 않는다.
function pendingBanner({ spec, index, derived, report }) {
  if (report.ready) return '';
  const questions = [
    ...spec.questions.filter((question) => question.blocking === true).map((question) => index.name(question.id)),
    ...derived.questions.map((question) => question.name),
  ];
  const blocks = report.issues.filter((item) => item.level === 'block').map((item) => item.message);
  const items = [...questions, ...blocks.filter((message) => !questions.includes(message))];
  return `<aside class="pending"><strong>착수 전에 정할 것 ${items.length}건</strong><ul>${items.map((item) => `<li>${h(item)}</li>`).join('')}</ul></aside>`;
}

function prdPart({ spec, index }) {
  const problem = text(spec.summary.problem?.text);
  const users = spec.userTypes.filter((userType) => userType.automatic !== true);
  const metrics = spec.summary.metrics;
  const requirementRows = spec.requirements.map((requirement) => `<tr${mark(requirement.id, 'requirement')}><td data-label="우선순위"><span class="priority priority-${h(requirement.priority ?? 'none')}">${h(LABELS.priority[requirement.priority] ?? '우선순위 없음')}</span></td><td data-label="요구사항">${h(index.name(requirement.id))}</td><td data-label="누가">${h(index.has(requirement.userType) ? index.name(requirement.userType) : '')}</td></tr>`);
  const { kind, systems } = spec.product;
  const services = systems.filter((system) => system.kind === 'service');
  const others = systems.filter((system) => system.kind !== 'service');
  const count = (label, n) => (n > 0 ? `${label} ${n}개` : null);
  const summary = [PRODUCT.kind[kind] ?? '구분 정해지지 않음', count('서비스', services.length), count('API', systems.filter((system) => system.kind === 'api').length), count('외부 시스템', systems.filter((system) => system.kind === 'external').length)].filter(Boolean).join(' · ');
  const appLabel = (id) => {
    const app = spec.apps.find((item) => item.id === id);
    return app ? `${index.name(app.id)}${app.platform ? ` (${app.platform.map((item) => PRODUCT.platform[item]).join('·')})` : ''}` : String(id);
  };
  const structure = `<p class="structure"><span class="k">구성</span> ${h(summary)}</p>`
    + (systems.length === 0 ? '' : `<ul class="plain systems">${[
      ...services.map((system) => `<li${mark(system.id, 'system')}><strong>${h(index.name(system.id))}</strong> ${h(system.apps.map(appLabel).join(', '))}</li>`),
      ...others.map((system) => `<li${mark(system.id, 'system')}><strong>${h(index.name(system.id))}</strong> ${h(PRODUCT.system[system.kind])}</li>`),
    ].join('')}</ul>`);
  return part('prd', [
    structure,
    '<h3>해결할 문제</h3>',
    problem ? `<p class="lead">${h(problem)} ${sourceNote(spec.summary.problem.source)}</p>` : empty('해결할 문제가 적혀 있지 않습니다'),
    '<h3>대상 사용자</h3>',
    users.length === 0 ? empty('사용자 유형이 없습니다') : `<ul class="plain">${users.map((userType) => `<li${mark(userType.id, 'userType')}><strong>${h(index.name(userType.id))}</strong> ${h(text(userType.goal))}</li>`).join('')}</ul>`,
    '<h3>목표 지표</h3>',
    metrics.length === 0 ? empty('목표 지표가 없습니다') : `<ul class="plain">${metrics.map((metric) => `<li${mark(metric.id, 'metric')}>${h(index.name(metric.id))}${metric.events.length > 0 ? ` <span class="muted">측정: ${h(metric.events.filter((event) => index.has(event)).map((event) => index.name(event)).join(', '))}</span>` : ''}</li>`).join('')}</ul>`,
    '<h3>요구사항</h3>',
    requirementRows.length === 0 ? empty('요구사항이 없습니다') : table('requirements stack', ['우선순위', '요구사항', '누가'], requirementRows),
  ].join(''));
}

// 단계는 플로우차트가 보여 주므로 여기서는 시나리오가 무엇인지와 완료 조건만 적는다.
function scenariosPart({ spec, index }) {
  const actionName = (id) => (index.has(id) ? index.name(id) : text(id));
  const groups = spec.requirements.map((requirement) => {
    const scenarios = spec.scenarios.filter((scenario) => scenario.requirement === requirement.id).map((scenario) => {
      const first = scenario.steps[0];
      const who = first && index.has(first.userType) ? index.name(first.userType) : '';
      return `<li${mark(scenario.id, 'scenario')}><a href="#frame-flowchart-scenario-${h(scenario.id)}">${h(index.name(scenario.id))}</a> <span class="tag">${h(LABELS.scenarioKind[scenario.kind] ?? '')}</span> <span class="muted">${h([who, `${scenario.steps.length}단계`].filter(Boolean).join(' · '))}</span></li>`;
    }).join('');
    const conditions = spec.acceptance.filter((condition) => condition.requirement === requirement.id).map((condition) => `<li${mark(condition.id, 'acceptance')}><span class="k">상황</span> ${h(text(condition.situation))} <span class="k">행동</span> ${h(actionName(condition.action))} <span class="k">결과</span> ${h(text(condition.result))}</li>`).join('');
    return `<article class="group"${mark(requirement.id, 'requirement')}><h3>${h(index.name(requirement.id))}</h3>${scenarios ? `<ul class="scenario-list">${scenarios}</ul>` : empty('시나리오가 없습니다')}${conditions ? `<h4 class="sub">완료 조건</h4><ul class="conditions">${conditions}</ul>` : ''}</article>`;
  }).join('');
  return part('scenarios', groups || empty('요구사항이 없습니다'));
}

const CHART_SUBTITLE = {
  scenario: (chart, spec, index) => {
    const scenario = spec.scenarios.find((item) => item.id === chart.of);
    const requirement = chart.requirement && index.has(chart.requirement) ? index.name(chart.requirement) : '요구사항 없음';
    return `시나리오 · ${[requirement, LABELS.scenarioKind[scenario?.kind]].filter(Boolean).join(' · ')}`;
  },
  function: () => '기능',
  page: (chart, spec, index) => `페이지 · ${index.has(chart.app) ? index.name(chart.app) : ''}`,
};

// 시나리오(요구사항 순) → 기능 → 페이지 순서로 한 도화지에 올린다.
function flowchartsPart({ spec, index, derived }) {
  if (derived.flowcharts.length === 0) return part('flowcharts', empty('그릴 시나리오가 없습니다'));
  const order = new Map(spec.requirements.map((requirement, position) => [requirement.id, position]));
  const kindOrder = { scenario: 0, function: 1, page: 2 };
  const charts = [...derived.flowcharts].sort((a, b) => (kindOrder[a.kind] - kindOrder[b.kind]) || ((order.get(a.requirement) ?? order.size) - (order.get(b.requirement) ?? order.size)));
  const frames = charts.map((chart) => {
    const { markup, width, height } = renderFlowchart(chart);
    return { id: `flowchart-${chart.kind}-${chart.of}`, title: chart.name, subtitle: CHART_SUBTITLE[chart.kind](chart, spec, index), width, height, markup };
  });
  // 맨 윗줄: 서비스·앱·화면·API를 한눈에 보는 전체 흐름도
  const pinned = [];
  if (derived.overview.services.length > 0) {
    const { markup, width, height } = renderOverview(derived.overview, index);
    pinned.push({ id: 'flowchart-overview', title: '전체 흐름', subtitle: '서비스·앱별 요구사항과 먼저 만들어야 쓰는 순서, 다른 서비스 영향, API 호출', width, height, markup });
  }
  const legend = '<p class="legend"><span class="shape fc-shape-start">시작·끝</span><span class="shape">처리</span><span class="shape fc-shape-decision">판단</span><span class="shape fc-shape-message">안내</span><span class="shape fc-shape-state">상태 변화</span><span class="muted">전체 흐름은 서비스 사이 연결, 시나리오는 순서, 기능은 판단 갈래, 페이지는 화면 상태를 보입니다. 문구와 권한 값은 기능명세서에 있습니다.</span></p>';
  return part('flowcharts', `${legend}${renderBoard({ rows: packRows(frames, pinned), withScript: false })}`);
}

// 누가: 사용자 유형마다 한 토막. 모든 상태에서 같으면 값만, 다르면 "진행 중 가능, 완료 정할 것"처럼 상태를 붙인다.
function whoLine(action, spec, index, cells, users = null) {
  const label = (value) => (value === null ? '정할 것' : value === 'allow' ? '가능' : LABELS.permission[value]);
  const parts = [];
  for (const userType of spec.userTypes.filter((item) => !isAutomatic(index, item.id) && (users === null || users.has(item.id)))) {
    const own = cells.filter((cell) => cell.userType === userType.id && cell.action === action.id);
    // 모든 상태에서 불가인 사용자는 적지 않는다. 공통 규칙에 '누가에 없는 사용자는 할 수 없음'이 있다.
    if (own.length === 0 || own.every((cell) => cell.value === 'deny')) continue;
    const values = new Set(own.map((cell) => cell.value));
    const body = values.size === 1
      ? `<span class="perm perm-${own[0].value ?? 'gap'}">${h(label(own[0].value))}</span>`
      : own.map((cell) => `<span class="perm perm-${cell.value ?? 'gap'}">${h(index.name(cell.state))} ${h(label(cell.value))}</span>`).join(', ');
    parts.push(`<span class="who-item"><strong>${h(index.name(userType.id))}</strong> ${body}</span>`);
  }
  return parts.join(' · ');
}

// 막는 경우: 서로 다른 원인만 한 줄. 공통 문구로 처리하는 통신 실패 같은 불특정 오류는 맨 위 공통 규칙에 있으므로 뺀다.
// 모든 상태에서 막히는 사용자는 이름만, 일부 상태만 막히면 그 상태를 붙인다. 경계값 하나하나는 모델 데이터에 있다.
function blockedLine(action, spec, index, derived) {
  const causes = [];
  const add = (cause) => { if (cause && !causes.includes(cause)) causes.push(cause); };
  const cases = derived.edgeCases.filter((item) => item.action === action.id && !item.ok);
  if (cases.some((item) => item.category === '입력')) add('입력 규칙 위반');
  // 사용자는 '누가'에 이미 있다. 여기에는 할 수 있는 사람이 있는데도 막히는 상태만 남긴다.
  const cells = derived.permissionCells.filter((cell) => cell.action === action.id && cell.state !== null && !isAutomatic(index, cell.userType));
  const able = new Set(cells.filter((cell) => cell.value === 'allow').map((cell) => cell.userType));
  const closedStates = [...new Set(cells.map((cell) => cell.state))]
    .filter((state) => cells.filter((cell) => cell.state === state && able.has(cell.userType)).every((cell) => cell.value !== 'allow'));
  if (able.size > 0 && closedStates.length > 0) add(`${closedStates.map((state) => quote(index.name(state))).join('·')} 상태`);
  if (action.irreversible === true) add('확인 창에서 취소');
  const generic = new Set(Object.values(WORDING));
  const commonText = new Set(Object.values(spec.wording));
  for (const failure of action.failures) if (typeof failure.name === 'string' && !generic.has(failure.name) && !commonText.has(failure.message)) add(failure.name);
  return causes.length === 0 ? '' : `<p class="blocked"><span class="k bad">막는 경우</span> ${causes.map((cause) => h(cause)).join(' · ')}</p>`;
}

function rangeOf(input) {
  const parts = [];
  const range = (unit) => {
    if (input.min !== undefined && input.max !== undefined) return `${input.min}~${input.max}${unit}`;
    if (input.min !== undefined) return `최소 ${input.min}${unit}`;
    if (input.max !== undefined) return `최대 ${input.max}${unit}`;
    return '';
  };
  if (input.type === 'text') parts.push(range('자'));
  if (input.type === 'number') parts.push(range(''));
  if (input.type === 'multiSelect') parts.push(range('개'));
  if (input.type === 'date') {
    if (input.min !== undefined) parts.push(`${input.min} 이후`);
    if (input.max !== undefined) parts.push(`${input.max}까지`);
  }
  if (input.type === 'period') parts.push(range(''));
  if (input.options?.length > 0) parts.push(input.options.join('·'));
  if (typeof input.optionsFrom === 'string') parts.push(`${input.optionsFrom}에서 고름`);
  if (input.type === 'file') {
    if (input.maxCount !== undefined) parts.push(`최대 ${input.maxCount}개`);
    if (input.maxSizeMB !== undefined) parts.push(`파일당 ${input.maxSizeMB}MB`);
    if (input.totalSizeMB !== undefined) parts.push(`합계 ${input.totalSizeMB}MB`);
    if (input.formats?.length > 0) parts.push(input.formats.join('·'));
  }
  parts.push(...input.rules);
  if (typeof input.note === 'string') parts.push(input.note);
  return parts.filter(Boolean).join(' · ');
}

function inputsTable(action) {
  if (action.inputs.length === 0) return '';
  // 오류 문구 열은 기능이 공통 문구와 다르게 정한 입력이 있을 때만 둔다.
  const withError = action.inputs.some((input) => text(input.error));
  const rows = action.inputs.map((input) => {
    const type = INPUT_TYPE[input.type];
    return `<tr><td data-label="항목">${h(text(input.name))}</td><td data-label="형식">${type ? h(type) : '<span class="gap">형식 없음</span>'}</td><td data-label="필수">${input.required === true ? '예' : '아니오'}</td><td data-label="범위·조건">${h(rangeOf(input))}</td>${withError ? `<td data-label="오류 문구">${h(text(input.error))}</td>` : ''}</tr>`;
  });
  return table('inputs stack', ['항목', '형식', '필수', '범위·조건', ...(withError ? ['오류 문구'] : [])], rows);
}

function resultsList(action, spec, index) {
  const items = [];
  for (const entity of spec.entities) {
    for (const transition of entity.transitions.filter((item) => item.action === action.id)) {
      items.push(`<li><span class="k">상태</span> ${h(index.name(entity.id))}: ${h(index.name(transition.from))} → ${h(index.name(transition.to))}</li>`);
    }
  }
  if (action.irreversible === true) {
    const ok = text(action.confirm?.ok) || text(spec.wording.confirmOk) || '확인';
    const cancel = text(action.confirm?.cancel) || text(spec.wording.confirmCancel) || '취소';
    items.push(`<li><span class="k">확인 창</span> ${text(action.confirm?.message) ? h(action.confirm.message) : '<span class="gap">문구 없음</span>'} [${h(ok)} / ${h(cancel)}]</li>`);
  }
  if (text(action.empty)) items.push(`<li><span class="k">빈 화면</span> ${h(action.empty)}</li>`);
  if (text(action.denied)) items.push(`<li><span class="k">권한 없음</span> ${h(action.denied)}</li>`);
  if (text(action.success)) items.push(`<li><span class="k ok">성공</span> ${h(action.success)}</li>`);
  // 공통 문구와 같은 실패는 맨 위 공통 문구에 있으므로 되풀이하지 않는다.
  const commonText = new Set(Object.values(spec.wording));
  for (const failure of action.failures.filter((item) => !commonText.has(item.message))) items.push(`<li><span class="k bad">${h(text(failure.name) || '실패')}</span> ${h(text(failure.message))}</li>`);
  for (const target of action.crossApp) {
    const who = [target.app, target.userType].filter((id) => index.has(id)).map((id) => index.name(id)).join(' ');
    const message = text(target.message) ? ` — 알림 "${h(target.message)}"` : ' — <span class="gap">알림 문구 없음</span>';
    items.push(`<li><span class="k">다른 앱</span> ${h(who)}: ${h(text(target.effect))}${message}</li>`);
  }
  return items.length === 0 ? '' : `<ul class="messages">${items.join('')}</ul>`;
}

// 모든 기능에 같은 규칙은 한 번만 적는다. 기능마다 되풀이하지 않는다.
function commonRules(spec) {
  const lines = [
    '누가에 없는 사용자는 할 수 없음. 숨김은 보이지 않음, 비활성은 보이지만 눌리지 않음, 불가는 권한 없음 안내.',
    '입력 규칙을 어기면 칸 아래 오류를 안내하고 저장하지 않음.',
  ];
  if (spec.actions.some((action) => action.async === true)) lines.push('서버 처리는 처리 중 다시 눌러도 한 번만 요청함.');
  if (spec.actions.some((action) => action.kind === 'list' || action.kind === 'view')) lines.push(`목록·상세 화면은 ${spec.meta.profile.screenStates.join('·')} 상태를 갖는다.`);
  const words = Object.entries(WORDING).filter(([key]) => text(spec.wording[key])).map(([key, label]) => `<li><span class="k">${h(label)}</span> ${h(spec.wording[key])}</li>`);
  const wordingBlock = words.length === 0 ? '' : `<div class="common"><span class="k">공통 문구</span><ul class="wording">${words.join('')}</ul></div>`;
  return `<p class="common"><span class="k">공통 규칙</span> ${lines.map((line) => h(line)).join(' ')}</p>${wordingBlock}`;
}

// 서비스마다 나눈다. 기능은 그 기능이 쓰이는 앱(시나리오 단계)이 속한 서비스 아래에 두고,
// 두 서비스에서 함께 쓰면 양쪽에 두되 '누가'에는 그 서비스의 앱을 쓰는 사용자만 보인다.
function specPart(result) {
  const { spec, index } = result;
  const services = spec.product.systems.filter((system) => system.kind === 'service');
  if (services.length === 0) return part('spec', commonRules(spec) + entityGroups(result, spec.actions, null) || empty('동작이 없습니다'));
  const steps = spec.scenarios.flatMap((scenario) => scenario.steps);
  const sections = services.map((service) => {
    const apps = new Set(service.apps);
    const own = steps.filter((step) => apps.has(step.app));
    const actions = spec.actions.filter((action) => own.some((step) => step.action === action.id));
    if (actions.length === 0) return '';
    const users = new Set(own.map((step) => step.userType));
    const appNames = service.apps.filter((id) => index.is(id, 'app')).map((id) => index.name(id)).join(', ');
    return `<section class="service"${mark(service.id, 'system')}><h3 class="service-head">${h(index.name(service.id))} <span class="muted">${h(appNames)}</span></h3>${entityGroups(result, actions, users)}</section>`;
  }).join('');
  const placed = new Set(services.flatMap((service) => steps.filter((step) => service.apps.includes(step.app)).map((step) => step.action)));
  const rest = spec.actions.filter((action) => !placed.has(action.id));
  const restSection = rest.length === 0 ? '' : `<section class="service"><h3 class="service-head">서비스 정해지지 않음</h3>${entityGroups(result, rest, null)}</section>`;
  return part('spec', (sections + restSection) ? commonRules(spec) + sections + restSection : empty('동작이 없습니다'));
}

function entityGroups({ spec, index, derived }, actionsInScope, users) {
  const automaticActions = new Set(spec.scenarios.flatMap((scenario) => scenario.steps).filter((step) => isAutomatic(index, step.userType)).map((step) => step.action));
  return spec.entities.map((entity) => {
    const actions = actionsInScope.filter((action) => action.entity === entity.id);
    if (actions.length === 0) return '';
    const diagram = entity.states.length === 0 ? '' : `<div class="state-wrap">${renderStates(entity, index)}</div>`;
    const functions = actions.map((action) => {
      const automatic = automaticActions.has(action.id);
      const tags = [automatic ? '자동 처리' : null, action.async === true ? '서버 처리' : null]
        .filter(Boolean).map((tag) => `<span class="tag">${h(tag)}</span>`).join('');
      const hasCells = derived.permissionCells.some((cell) => cell.action === action.id && !isAutomatic(index, cell.userType));
      const who = automatic ? '<span class="muted">규칙에 따라 저절로 일어남</span>'
        : whoLine(action, spec, index, derived.permissionCells, users) || (hasCells ? '<span class="gap">아무도 할 수 없음</span>' : '<span class="gap">동작 가능표 없음</span>');
      return `<div class="function"${mark(action.id, 'action')}>`
        + `<div class="function-head"><h4>${h(index.name(action.id))}${tags}</h4><div class="who">${who}</div></div>`
        + (automatic ? '' : inputsTable(action))
        + resultsList(action, spec, index)
        + (automatic ? '' : blockedLine(action, spec, index, derived))
        + '</div>';
    }).join('');
    return `<article class="group"${mark(entity.id, 'entity')}><h3>${h(index.name(entity.id))}</h3>${diagram}${functions}</article>`;
  }).join('');
}

const STYLE = `
:root{--ink:#1f2430;--muted:#5b6372;--line:#e3e6ec;--soft:#f6f7f9;--ok:#1a7f4b;--bad:#b42318;--warn:#b54708;--gap:#fff4e5}
*{box-sizing:border-box}
body{margin:0;background:#f3f4f7;color:var(--ink);font:15px/1.65 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Noto Sans KR",sans-serif}
.top{position:sticky;top:0;z-index:5;background:#ffffffee;backdrop-filter:blur(6px);border-bottom:1px solid var(--line)}
.top-inner{max-width:1080px;margin:0 auto;padding:12px 16px;display:flex;gap:16px;align-items:center;flex-wrap:wrap}
.top h1{font-size:18px;margin:0;flex:1 1 auto}
.part-links{display:flex;gap:6px;flex-wrap:wrap}
.part-link{font-size:13px;text-decoration:none;color:var(--ink);border:1px solid var(--line);border-radius:999px;padding:3px 12px;background:#fff}.part-link.current{background:var(--ink);color:#fff;border-color:var(--ink)}
.copy-prompt{font:13px sans-serif;border:1px solid var(--ink);background:var(--ink);color:#fff;border-radius:999px;padding:4px 12px;cursor:pointer}
.prompt-box{width:100%;min-height:96px;font:12px ui-monospace,monospace;margin-top:8px}
main{max-width:1080px;margin:0 auto;padding:24px 16px 80px}
.pending{background:#fdecea;border:1px solid #f5c2bd;color:var(--bad);border-radius:10px;padding:12px 16px;margin:0 0 24px}.pending ul{margin:6px 0 0;padding-left:20px}
.part{background:#fff;border-radius:14px;margin:0 0 28px;box-shadow:0 1px 2px #0000000d;overflow:visible;border-top:6px solid var(--accent)}
.part-prd{--accent:#2f5fd0}.part-scenarios{--accent:#1a7f4b}.part-flowcharts{--accent:#7a4cc2}.part-spec{--accent:#c2410c}
.part-head{display:flex;gap:14px;align-items:center;padding:20px 24px 8px}
.part-no{flex:0 0 36px;height:36px;border-radius:50%;background:var(--accent);color:#fff;font:700 17px/36px sans-serif;text-align:center}
.part-head h2{margin:0;font-size:22px}.part-head p{margin:0;color:var(--muted);font-size:13px}
.part-body{padding:4px 24px 24px}
h3{font-size:17px;margin:22px 0 8px}h4{font-size:15px;margin:14px 0 6px}
.lead{font-size:16px}.structure{margin:4px 0 6px;font-size:15px}.systems li{font-size:14px}
.plain{list-style:none;padding:0;margin:0}.plain li{padding:4px 0;border-bottom:1px dashed var(--line)}
.muted{color:var(--muted);font-size:13px}.empty{color:var(--muted)}
.source{font-size:12px;color:var(--muted);background:var(--soft);border-radius:4px;padding:0 6px}.source-assumption{color:var(--warn);background:var(--gap)}
.table-wrap{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:14px;margin:6px 0}
th,td{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}td{overflow-wrap:anywhere;word-break:keep-all}
.part-body,.group,.function,.messages li,.common,.pending li{overflow-wrap:anywhere;word-break:keep-all;min-width:0}th{color:var(--muted);font-weight:600;font-size:12px;white-space:nowrap}
.priority{display:inline-block;border-radius:4px;padding:0 6px;font-size:12px;font-weight:600}
.priority-must{background:#fdecea;color:var(--bad)}.priority-should{background:#fff4e5;color:var(--warn)}.priority-could,.priority-none{background:var(--soft);color:var(--muted)}
.group{border:1px solid var(--line);border-radius:10px;padding:4px 18px 14px;margin:14px 0}
.service{margin:22px 0 8px}.service-head{font-size:19px;margin:0 0 4px;padding:8px 12px;border-left:5px solid var(--accent);background:var(--soft);border-radius:6px}
.group>h3{margin-top:14px}
.scenario-list{list-style:none;padding:0;margin:0}.scenario-list li{padding:4px 0}.scenario-list a{color:var(--ink);font-weight:600;text-decoration:none;border-bottom:1px dotted var(--muted)}
.tag{display:inline-block;font-size:11px;font-weight:500;color:var(--muted);border:1px solid var(--line);border-radius:999px;padding:0 7px;margin-left:4px;vertical-align:middle}
.sub{color:var(--muted);font-size:13px;margin-bottom:4px}
.conditions{list-style:none;padding:0;margin:0}.conditions li{padding:6px 10px;background:var(--soft);border-radius:6px;margin:4px 0}
.k{display:inline-block;font-size:11px;font-weight:700;color:var(--muted);margin:0 4px 0 6px}.k:first-child{margin-left:0}.k.ok{color:var(--ok)}.k.bad{color:var(--bad)}
.function{border-top:1px solid var(--line);padding:10px 0 12px}
.function-head{display:flex;gap:16px;align-items:baseline;flex-wrap:wrap}.function-head h4{margin:0;flex:1 1 auto}
.who{font-size:13px;color:var(--muted)}.who-item strong{color:var(--ink);font-weight:600}
.common{background:var(--soft);border-radius:8px;padding:8px 12px;font-size:13px;margin:8px 0 4px}.wording{list-style:none;margin:2px 0 0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:0 16px}
.blocked{margin:4px 0 0;font-size:13px}
.state-wrap{overflow-x:auto;margin:4px 0 8px}.state-diagram{display:block}
.states{font-size:13px;color:var(--muted);margin:0 0 6px}.state{color:var(--ink);background:var(--soft);border-radius:4px;padding:0 6px}.arrow{margin:0 4px}
.perm-allow{color:var(--ok)}.perm-gap{background:var(--gap);color:var(--warn);font-weight:600;padding:0 4px;border-radius:4px}
.perm-hide,.perm-disable,.perm-deny{color:var(--muted)}
.gap{background:var(--gap);color:var(--warn);font-weight:600;padding:0 4px;border-radius:4px}
.inputs{font-size:13px}.inputs td:nth-child(1){white-space:nowrap;font-weight:600}.inputs td:nth-child(2),.inputs td:nth-child(3){white-space:nowrap}
.messages{list-style:none;padding:0;margin:6px 0 0;font-size:13px}.messages li{padding:1px 0}
.legend{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:0 0 8px}
.legend .shape{display:inline-block;padding:0 10px;border:1.4px solid #3d4452;border-radius:6px;font-size:12px;background:#fff}
.fc-shape-start{background:#1f2430!important;color:#fff;border-radius:999px!important}.fc-shape-decision{background:#fff7e6!important;border-color:#b54708!important}.fc-shape-message{background:#f6f7f9!important;border-style:dashed!important}.fc-shape-state{background:#eef4ff!important;border-color:#2f5fd0!important}
${BOARD_STYLE}
/* 플로우차트 파일: 머리글 아래를 모두 도화지로 쓴다 */
.fullscreen main{max-width:none;padding:0}.fullscreen .part{border-radius:0;margin:0;box-shadow:none}.fullscreen .part-head{padding:10px 16px 0}.fullscreen .part-body{padding:0}
.fullscreen .legend{padding:0 16px 8px}.fullscreen .board-live{width:100%;left:0;transform:none;border-radius:0;border-left:0;border-right:0;margin:0}
.fullscreen .board-live .board-view{height:calc(100vh - 176px)}
/* 좁은 화면: 표는 칸 이름이 붙은 카드로 쌓고, 머리글과 여백을 줄인다 */
@media (max-width:720px){.stack thead{display:none}.stack,.stack tbody,.stack tr,.stack td{display:block;width:100%}.stack tr{border:1px solid var(--line);border-radius:8px;margin:6px 0;padding:4px 8px}.stack td{border:0;padding:3px 0;white-space:normal!important}.stack td::before{content:attr(data-label);display:block;font-size:11px;color:var(--muted);font-weight:600}.part-body{padding:4px 14px 18px}.part-head{padding:16px 14px 6px}.group{padding:4px 12px 12px}.top-inner{gap:8px}.top h1{font-size:16px;flex-basis:100%}.function-head{display:block}.who{margin-top:2px}.wording{grid-template-columns:1fr}}
@media print{.top{position:static}.part{box-shadow:none;break-inside:auto}.group,.function,tr{break-inside:avoid}}
`;

// AI에게 붙여 넣는 프롬프트. HTML 안에는 자리표({html}·{model})로 넣고 열릴 때 파일 위치로 채운다.
// 그래야 파일을 옮겨도 맞고, 같은 입력이면 HTML이 기계마다 같다.
export function buildPrompt(paths = {}) {
  const html = paths.html ?? '{html}';
  const model = paths.model ?? '{model}';
  return [
    '아래 기획서대로 구현해 주세요.',
    `- 기획서 (사람용): ${html}`,
    `- 모델 데이터 (AI용, 정확한 값은 이쪽): ${model}`,
    '읽는 법: document.parts가 문서 구성, spec이 원본, derived.flowcharts가 시나리오별 흐름, derived.permissionCells가 권한표, derived.edgeCases가 기능별 엣지 케이스 전체, report가 검사 결과입니다.',
  ].join('\n');
}

// AI용 모델 데이터. 사람이 읽는 문서에 없는 것까지 모두 담고, 어느 부분이 무엇을 그렸는지 문서 지도로 알린다.
export function buildModel(result) {
  const { spec, report, derived } = result;
  return {
    format: FORMAT,
    document: { parts: PARTS.map(({ key, title, shows }) => ({ key, title, shows })), dataOnly: DATA_ONLY },
    spec,
    derived,
    report,
  };
}

// 프롬프트는 어느 파일에서 복사해도 첫 파일({이름}.html)과 model.json을 가리킨다. 경로는 열린 위치에서 계산한다.
const PROMPT_SCRIPT = `<script>
(function () {
  var button = document.querySelector('[data-copy-prompt]');
  var template = JSON.parse(document.getElementById('spec-prompt').textContent);
  var here = location.href.split('#')[0].split('?')[0];
  var file = here.indexOf('file://') === 0 ? decodeURIComponent(here.slice(7)).replace(/^\\/([A-Za-z]:)/, '$1') : here;
  var dir = file.replace(/[^\\/\\\\]*$/, '');
  var prompt = template.split('{html}').join(dir + button.getAttribute('data-index')).split('{model}').join(dir + 'model.json');
  function fallback() {
    var box = document.createElement('textarea');
    box.value = prompt; box.readOnly = true; box.className = 'prompt-box';
    button.insertAdjacentElement('afterend', box); box.focus(); box.select();
    button.textContent = '아래 글을 복사하세요';
  }
  button.addEventListener('click', function () {
    var done = function () { button.textContent = '복사했습니다'; setTimeout(function () { button.textContent = '프롬프트 복사'; }, 1500); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(prompt).then(done, fallback);
    else fallback();
  });
})();
</script>`;

// 하네스: 모든 그림을 겹침 검사와 함께 다시 그려 보고, 간격을 넓혀도 남은 겹침을 돌려준다.
export function drawingReport(result) {
  const { derived, index } = result;
  const left = [];
  for (const chart of derived.flowcharts) {
    const { collisions } = renderFlowchart(chart);
    for (const item of collisions) left.push({ drawing: `${chart.kind}:${chart.name}`, ...item });
  }
  if (derived.overview.services.length > 0) for (const item of renderOverview(derived.overview, index).collisions) left.push({ drawing: '전체 흐름', ...item });
  return left;
}

// 부분마다 파일 하나. 첫 파일({이름}.html)이 PRD이고 AI용 모델 데이터를 품는다.
export function pageFiles(name) {
  return PARTS.map((item, position) => ({ key: item.key, file: position === 0 ? `${name}.html` : `${name}.${item.key}.html` }));
}

const PART_RENDERERS = { prd: prdPart, scenarios: scenariosPart, flowcharts: flowchartsPart, spec: specPart };

export function renderPages(result, { name = 'spec' } = {}) {
  const { spec, report } = result;
  const title = typeof spec.meta.title === 'string' && spec.meta.title !== '' ? spec.meta.title : '이름 없는 기획서';
  const files = pageFiles(name);
  const pages = {};
  files.forEach(({ key, file }, position) => {
    const nav = `<nav class="part-links">${files.map((item, i) => `<a class="part-link${i === position ? ' current' : ''}" href="${h(item.file)}">${i + 1} ${h(PARTS[i].title)}</a>`).join('')}</nav>`;
    const copyButton = `<button type="button" class="copy-prompt" data-copy-prompt data-index="${h(files[0].file)}" title="AI에게 붙여 넣을 프롬프트를 복사합니다">프롬프트 복사</button>`;
    const body = (position === 0 ? pendingBanner(result) : '') + PART_RENDERERS[key](result);
    const fullscreen = key === 'flowcharts';
    pages[file] = '<!doctype html>\n'
      + '<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
      + `<title>${h(`${title} · ${PARTS[position].title}`)}</title>`
      + `<meta name="spec-format" content="${FORMAT}"><meta name="spec-version" content="${h(spec.meta.version ?? '')}">`
      + `<meta name="spec-ready" content="${report.ready}"><meta name="spec-score" content="${report.score.ratio}">`
      + `<style>${STYLE}</style></head>`
      + `<body${fullscreen ? ' class="fullscreen"' : ''}><header class="top"><div class="top-inner"><h1>${h(title)}</h1>${nav}${copyButton}</div></header><main>${body}</main>`
      + (position === 0 ? `<script type="application/json" id="spec-model">${jsonForScript(buildModel(result))}</script>` : '')
      + `<script type="application/json" id="spec-prompt">${jsonForScript(buildPrompt())}</script>${PROMPT_SCRIPT}`
      + (body.includes('data-board') ? BOARD_SCRIPT : '')
      + '</body></html>\n';
  });
  return pages;
}
