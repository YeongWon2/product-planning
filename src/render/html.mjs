import { LABELS, quote, readableRef } from '../model/labels.mjs';
import { escapeHtml as h, jsonForScript } from './escape.mjs';
import { layoutFlow, renderFlowSvg } from './flow-svg.mjs';
import { renderFlowchart } from './flowchart-svg.mjs';
import { BOARD_SCRIPT, BOARD_STYLE, packRows, renderBoard } from './board.mjs';

const FORMAT = 'product-planning/spec@1';

const RULE_TEXT = {
  F1: '여러 개를 보는 동작 → 목록 화면',
  F2: '하나를 보는 동작 → 상세 화면',
  F3: '입력이 적음 → 모달',
  F4: '입력이 많음 → 화면',
  F5: '입력 없음 → 지금 화면의 버튼',
  F6: '되돌릴 수 없음 → 확인 창',
  F7: '만들기 완료 → 상세 또는 목록',
  F8: '마침 → 연 화면으로',
  F9: '다른 앱에 영향 → 알림',
  F10: '시나리오 단계 순서',
  F12: '자동 처리 → 결과가 보이는 화면',
  결정: '사람의 결정',
};

const SECTIONS = [
  ['summary', '요약'],
  ['scenarios', '사용자와 시나리오'],
  ['entities', '개체와 상태'],
  ['permissions', '동작 가능표'],
  ['flow', '흐름도'],
  ['screens', '화면 목록'],
  ['acceptance', '완료 조건'],
  ['metrics', '지표와 이벤트'],
  ['review', '검토 결과'],
  ['questions', '정할 것과 결정'],
  ['trace', '부록: 추적표'],
];

const mark = (id, kind) => ` data-spec-id="${h(id)}" data-spec-kind="${kind}"`;
const percent = (ratio) => `${Math.round(ratio * 1000) / 10}%`;
const table = (head, rows) => `<div class="table-wrap"><table><thead><tr>${head.map((cell) => `<th>${cell}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
const empty = (text) => `<p class="empty">${h(text)}</p>`;

function sourceBadge(source) {
  const kind = Object.hasOwn(LABELS.source, source?.kind) ? source.kind : 'assumption';
  const ref = typeof source?.ref === 'string' && source.ref !== '' ? ` <span class="source-ref">${h(readableRef(source.ref))}</span>` : '';
  return `<span class="badge badge-${kind}">${LABELS.source[kind]}</span>${ref}`;
}

function section(key, title, body) {
  const number = SECTIONS.findIndex(([name]) => name === key) + 1;
  return `<section id="s-${number}" data-section="${key}"><h2>${number}. ${h(title)}</h2>${body}</section>`;
}

function summarySection({ spec, index, report }) {
  const verdict = report.ready
    ? '<div class="verdict verdict-ready"><strong>착수 가능</strong></div>'
    : `<div class="verdict verdict-blocked"><strong>착수 불가</strong><ul>${report.reasons.map((reason) => `<li>${h(reason)}</li>`).join('')}</ul></div>`;
  const problem = spec.summary.problem;
  const problemMarkup = typeof problem?.text === 'string' && problem.text !== ''
    ? `<p class="problem">${h(problem.text)} ${sourceBadge(problem.source)}</p>`
    : empty('해결할 문제가 적혀 있지 않습니다');
  const metrics = spec.summary.metrics.length === 0
    ? empty('목표 지표가 없습니다')
    : `<ul>${spec.summary.metrics.map((metric) => `<li${mark(metric.id, 'metric')}>${h(index.name(metric.id))} ${sourceBadge(metric.source)}</li>`).join('')}</ul>`;
  const outOfScope = spec.summary.outOfScope.length === 0
    ? empty('이번에 하지 않는 것이 없습니다')
    : `<ul>${spec.summary.outOfScope.map((item) => `<li>${h(item)}</li>`).join('')}</ul>`;
  const { score } = report;
  const scoreTable = table(['검사 항목', '통과', '통과율', '가정 비율', '차단 이슈', '경고', '착수를 막는 정할 것'], [
    `<tr><td>${score.checked}</td><td>${score.passed}</td><td>${percent(score.ratio)}</td><td>${percent(score.assumptionRatio)}</td><td>${score.blockIssues}</td><td>${score.warnIssues}</td><td>${score.blockingQuestions}</td></tr>`,
  ]);
  return section('summary', '요약', `${verdict}<h3>해결할 문제</h3>${problemMarkup}<h3>목표 지표</h3>${metrics}<h3>이번에 하지 않는 것</h3>${outOfScope}<h3>품질 점수</h3>${scoreTable}`);
}

function scenariosSection({ spec, index, derived }) {
  const userTypes = spec.userTypes.length === 0
    ? empty('사용자 유형이 없습니다')
    : `<div class="cards">${spec.userTypes.map((userType) => `<div class="card"${mark(userType.id, 'userType')}><strong>${h(index.name(userType.id))}</strong><p>${h(userType.goal ?? '')}</p>${sourceBadge(userType.source)}</div>`).join('')}</div>`;

  const screenName = new Map(derived.screens.map((screen) => [screen.id, screen.name]));
  const requirements = spec.requirements.map((requirement) => {
    const scenarios = spec.scenarios.filter((scenario) => scenario.requirement === requirement.id).map((scenario) => {
      const steps = scenario.steps.map((step, position) => {
        const screenId = derived.stepScreens[`${scenario.id}#${position + 1}`];
        // '에서'는 받침과 무관하게 같은 조사라 quote()의 조사 쌍을 쓰지 않는다.
        const where = screenId ? h(`${quote(screenName.get(screenId))}에서`) : '<span class="gap">화면 정해지지 않음</span>';
        const text = typeof step.text === 'string' && step.text !== '' ? step.text : index.name(step.action);
        return `<li>${h(text)} <span class="meta">${h(index.name(step.userType))} · ${h(index.name(step.app))} · ${where}</span></li>`;
      }).join('');
      return `<div class="scenario"${mark(scenario.id, 'scenario')}><h4>${h(index.name(scenario.id))} <span class="meta">${h(LABELS.scenarioKind[scenario.kind] ?? '')}</span></h4><ol>${steps}</ol></div>`;
    }).join('');
    const priority = LABELS.priority[requirement.priority] ?? '우선순위 없음';
    return `<div class="requirement"${mark(requirement.id, 'requirement')}><h3>${h(index.name(requirement.id))} <span class="chip">${h(priority)}</span> ${sourceBadge(requirement.source)}</h3>${scenarios || empty('시나리오가 없습니다')}</div>`;
  }).join('');

  return section('scenarios', '사용자와 시나리오', `<h3>사용자 유형</h3>${userTypes}${requirements || empty('요구사항이 없습니다')}`);
}

function entitiesSection({ spec, index }) {
  const body = spec.entities.map((entity) => {
    const states = entity.states.length === 0
      ? empty('상태가 없는 개체입니다')
      : `<p>${entity.states.map((state) => `<span class="chip"${mark(state.id, 'state')}>${h(index.name(state.id))}${state.initial === true ? ' · 시작' : ''}${state.terminal === true ? ' · 끝' : ''}</span>`).join(' ')}</p>`;
    const transitions = entity.transitions.length === 0
      ? ''
      : table(['지금 상태', '동작', '다음 상태'], entity.transitions.map((transition) => `<tr><td>${h(index.name(transition.from))}</td><td>${h(index.name(transition.action))}</td><td>${h(index.name(transition.to))}</td></tr>`));
    return `<div${mark(entity.id, 'entity')}><h3>${h(index.name(entity.id))}</h3>${states}${transitions}</div>`;
  }).join('');
  return section('entities', '개체와 상태', body || empty('개체가 없습니다'));
}

function permissionsSection({ spec, index, derived }) {
  const body = index.canonical(spec.entities).map((entity) => {
    const cells = derived.permissionCells.filter((cell) => index.get(cell.action)?.item.entity === entity.id);
    if (cells.length === 0) return '';
    const columns = entity.states.length === 0 ? [null] : entity.states.map((state) => state.id);
    const head = ['사용자 유형', '동작', ...columns.map((state) => (state === null ? '모든 경우' : h(index.name(state))))];
    const rows = [];
    for (const userType of index.canonical(spec.userTypes)) {
      for (const action of index.canonical(spec.actions).filter((item) => item.entity === entity.id)) {
        const own = cells.filter((cell) => cell.userType === userType.id && cell.action === action.id);
        if (own.length === 0) continue;
        // 상태와 무관한 칸은 여러 열을 합치므로 첫 열의 값처럼 읽히지 않게 '모든 상태'를 붙인다.
        const cellMarkup = (cell = { value: null }, span = 1) => {
          const base = cell.value === null ? '정할 것' : LABELS.permission[cell.value];
          const label = span > 1 ? `${base} · 모든 상태` : base;
          const className = cell.value === null ? 'gap' : `perm-${cell.value}`;
          return `<td class="${className}"${span > 1 ? ` colspan="${span}"` : ''}>${h(label)}</td>`;
        };
        const stateCells = own.length === 1 && own[0].state === null
          ? cellMarkup(own[0], columns.length)
          : columns.map((state) => cellMarkup(own.find((cell) => cell.state === state))).join('');
        rows.push(`<tr><td>${h(index.name(userType.id))}</td><td>${h(index.name(action.id))}</td>${stateCells}</tr>`);
      }
    }
    return `<h3>${h(index.name(entity.id))}</h3>${table(head, rows)}`;
  }).join('');
  return section('permissions', '동작 가능표', body || empty('동작 가능표를 만들 동작이 없습니다'));
}

// 화면 지도(화면 사이 이동)와 시나리오마다 플로우차트(판단 분기)를 한 도화지에 프레임으로 올린다.
// 첫 줄은 화면 지도, 그다음 줄부터 요구사항마다 그 시나리오들을 나란히 둔다.
function flowSection({ spec, index, derived }) {
  const pinned = [];
  if (derived.screens.length > 0) {
    const input = { apps: spec.apps, screens: derived.screens, edges: derived.edges, entries: derived.entries };
    const { width, height } = layoutFlow(input);
    pinned.push({ id: 'screen-map', title: '화면 지도', subtitle: '화면 사이 이동 (흐름 규칙 F1~F12)', width, height, markup: renderFlowSvg(input) });
  }
  const frameOf = (chart) => {
    const { markup, width, height } = renderFlowchart(chart);
    const scenario = spec.scenarios.find((item) => item.id === chart.scenario);
    const kind = LABELS.scenarioKind[scenario?.kind] ?? '';
    const requirement = chart.requirement && index.has(chart.requirement) ? index.name(chart.requirement) : '요구사항 없음';
    return { id: `flowchart-${chart.scenario}`, title: chart.name, subtitle: [requirement, kind].filter(Boolean).join(' · '), width, height, markup };
  };
  // 요구사항 순서대로, 요구사항이 없는 시나리오는 맨 뒤에 둔다.
  const order = new Map(spec.requirements.map((requirement, position) => [requirement.id, position]));
  const charts = [...derived.flowcharts].sort((a, b) => (order.get(a.requirement) ?? order.size) - (order.get(b.requirement) ?? order.size));
  const rows = packRows(charts.map(frameOf), pinned);
  if (rows.length === 0) return section('flow', '흐름도', empty('그릴 시나리오나 화면이 없습니다'));

  const legend = '<p class="legend"><span class="shape fc-shape-start">시작·끝</span> <span class="shape">처리</span> <span class="shape fc-shape-decision">판단</span> <span class="shape fc-shape-message">안내</span> <span class="shape fc-shape-state">상태 변화</span>'
    + ' · 화면 지도: <span class="shape shape-screen">화면</span> <span class="shape shape-modal">모달</span> <span class="shape shape-confirm">확인 창</span> <span class="shape shape-notification">알림</span></p>';
  const name = new Map(derived.screens.map((screen) => [screen.id, screen.name]));
  const edgeRows = derived.edges.map((edge) => `<tr><td>${h(name.get(edge.from))}</td><td>${h(edge.label)}</td><td>${h(name.get(edge.to))}</td><td>${h(edge.rule)} · ${h(RULE_TEXT[edge.rule] ?? '')}</td></tr>`);
  const edgeTable = edgeRows.length === 0 ? '' : `<details><summary>화면 이동 표 (${edgeRows.length}건)</summary>${table(['출발 화면', '행동', '도착 화면', '적용 규칙'], edgeRows)}</details>`;
  return section('flow', '흐름도', `${legend}${renderBoard({ rows, withScript: false })}${edgeTable}`);
}

function screensSection({ index, derived }) {
  const cards = derived.screens.map((screen) => `<div class="card"${mark(screen.id, 'screen')}><strong>${h(screen.name)}</strong><p class="meta">${h(LABELS.screenType[screen.type] ?? screen.type)} · ${h(index.name(screen.app))}</p><p>${h(screen.rule)} · ${h(RULE_TEXT[screen.rule] ?? '')}<br><span class="meta">${h(screen.reason)}</span></p><p>${screen.states.map((state) => `<span class="chip">${h(state)} · 기본값</span>`).join(' ')}</p></div>`).join('');
  return section('screens', '화면 목록', cards ? `<div class="cards">${cards}</div>` : empty('도출된 화면이 없습니다'));
}

function conditionMarkup(condition, extra = '') {
  return `<dl class="condition"><dt>상황</dt><dd>${h(condition.situation)}</dd><dt>행동</dt><dd>${h(condition.action)}</dd><dt>결과</dt><dd>${h(condition.result)}</dd></dl>${extra}`;
}

function acceptanceSection({ spec, index, derived }) {
  const groups = spec.requirements.map((requirement) => {
    const confirmed = spec.acceptance.filter((condition) => condition.requirement === requirement.id);
    const drafts = derived.acceptanceDrafts.filter((draft) => draft.requirement === requirement.id);
    const confirmedMarkup = confirmed.length === 0
      ? '<p class="gap">확정된 완료 조건이 없습니다</p>'
      : confirmed.map((condition, position) => `<div${mark(condition.id, 'acceptance')}><h4>${h(index.name(requirement.id))} ${position + 1} ${sourceBadge(condition.source)}</h4>${conditionMarkup(condition)}</div>`).join('');
    const draftMarkup = drafts.length === 0 ? '' : `<details open><summary>자동 초안 ${drafts.length}건 · 확인 필요</summary>${drafts.map((draft) => conditionMarkup(draft)).join('')}</details>`;
    return `<div class="requirement"><h3>${h(index.name(requirement.id))}</h3>${confirmedMarkup}${draftMarkup}</div>`;
  }).join('');
  const orphanDrafts = derived.acceptanceDrafts.filter((draft) => draft.requirement === null);
  const orphanMarkup = orphanDrafts.length === 0 ? '' : `<div class="requirement"><h3>요구사항이 정해지지 않은 초안</h3><details open><summary>자동 초안 ${orphanDrafts.length}건 · 확인 필요</summary>${orphanDrafts.map((draft) => conditionMarkup(draft)).join('')}</details></div>`;
  return section('acceptance', '완료 조건', (groups + orphanMarkup) || empty('완료 조건이 없습니다'));
}

function metricsSection({ spec, index }) {
  const rows = spec.summary.metrics.map((metric) => `<tr${mark(metric.id, 'metric')}><td>${h(index.name(metric.id))}</td><td>${metric.events.length === 0 ? '<span class="gap">이벤트 없음</span>' : metric.events.map((event) => h(index.name(event))).join(', ')}</td><td>${sourceBadge(metric.source)}</td></tr>`);
  return section('metrics', '지표와 이벤트', rows.length === 0 ? empty('지표가 없습니다') : table(['지표', '측정 이벤트', '출처'], rows));
}

function reviewSection({ report }) {
  const list = (level, title) => {
    const items = report.issues.filter((item) => item.level === level);
    if (items.length === 0) return `<h3>${title}</h3>${empty('없음')}`;
    return `<h3>${title} ${items.length}건</h3><ul class="issues issues-${level}">${items.map((item) => `<li>${h(item.message)} <span class="rule">${h(item.rule)}</span></li>`).join('')}</ul>`;
  };
  return section('review', '검토 결과', `${list('block', '차단 이슈')}${list('warn', '경고')}`);
}

function questionsSection({ spec, index, derived }) {
  const human = spec.questions.map((question) => `<tr${mark(question.id, 'question')}><td>${h(index.name(question.id))}</td><td>${h(question.owner ?? '없음')}</td><td>${question.blocking === true ? '막음' : '-'}</td><td>사람</td></tr>`);
  const auto = derived.questions.map((question) => `<tr><td>${h(question.name)}</td><td>${h(question.owner)}</td><td>막음</td><td>자동</td></tr>`);
  const rows = [...human, ...auto];
  const questions = rows.length === 0 ? empty('정할 것이 없습니다') : table(['질문', '담당자', '착수를 막나', '누가 올렸나'], rows);
  const decisions = spec.decisions.length === 0
    ? empty('결정 기록이 없습니다')
    : `<ul>${spec.decisions.map((decision) => `<li${mark(decision.id, 'decision')}>${h(index.name(decision.id))} ${sourceBadge(decision.source)}</li>`).join('')}</ul>`;
  return section('questions', '정할 것과 결정', `<h3>정할 것</h3>${questions}<h3>결정</h3>${decisions}`);
}

// 부록만 내부 ID를 보인다. 다른 도구와 대조하거나 링크를 만들 때 쓴다.
function traceSection({ spec, index, derived }) {
  const screenName = new Map(derived.screens.map((screen) => [screen.id, screen.name]));
  const rows = spec.requirements.map((requirement) => {
    const scenarios = spec.scenarios.filter((scenario) => scenario.requirement === requirement.id);
    const screens = new Set();
    for (const scenario of scenarios) {
      scenario.steps.forEach((_, position) => {
        const screenId = derived.stepScreens[`${scenario.id}#${position + 1}`];
        if (screenId) screens.add(screenId);
      });
    }
    const conditions = spec.acceptance.filter((condition) => condition.requirement === requirement.id);
    const withId = (name, id) => `${h(name)} <code>${h(id)}</code>`;
    return `<tr><td>${withId(index.name(requirement.id), requirement.id)}</td><td>${scenarios.map((scenario) => withId(index.name(scenario.id), scenario.id)).join('<br>')}</td><td>${[...screens].map((id) => withId(screenName.get(id), id)).join('<br>')}</td><td>${conditions.map((condition) => `<code>${h(condition.id)}</code>`).join(', ')}</td></tr>`;
  });
  return section('trace', '부록: 추적표', rows.length === 0 ? empty('요구사항이 없습니다') : table(['요구사항', '시나리오', '화면', '완료 조건'], rows));
}

const STYLE = `
:root{--ink:#1f2430;--muted:#5b6372;--line:#dfe3ea;--soft:#f6f7f9;--ok:#1a7f4b;--bad:#b42318;--warn:#b54708;--gap:#fff4e5}
*{box-sizing:border-box}
body{margin:0;background:#ffffff;color:var(--ink);font:15px/1.65 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Noto Sans KR",sans-serif}
main{max-width:1080px;margin:0 auto;padding:32px 16px 80px}
h1{font-size:28px;margin:0 0 8px}h2{font-size:21px;margin:48px 0 12px;padding-bottom:6px;border-bottom:2px solid var(--line)}
h3{font-size:17px;margin:24px 0 8px}h4{font-size:15px;margin:16px 0 6px}
nav ol{display:flex;flex-wrap:wrap;gap:4px 16px;padding:0;list-style:none;color:var(--muted);font-size:13px}
nav a{color:inherit}
.verdict{border-radius:8px;padding:12px 16px;margin:16px 0}.verdict ul{margin:4px 0 0}
.verdict-ready{background:#e8f6ee;color:var(--ok)}.verdict-blocked{background:#fdecea;color:var(--bad)}
.table-wrap{overflow-x:auto}table{border-collapse:collapse;min-width:100%;font-size:14px}
th,td{border:1px solid var(--line);padding:6px 10px;text-align:left;vertical-align:top}th{background:var(--soft);font-weight:600}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}
.card{border:1px solid var(--line);border-radius:8px;padding:12px}.card p{margin:6px 0}
.chip{display:inline-block;border:1px solid var(--line);border-radius:999px;padding:0 8px;font-size:12px;color:var(--muted)}
.badge{display:inline-block;border-radius:4px;padding:0 6px;font-size:12px;background:var(--soft);color:var(--muted)}
.badge-assumption{background:var(--gap);color:var(--warn)}.source-ref{font-size:12px;color:var(--muted)}
.meta{color:var(--muted);font-size:13px}.empty{color:var(--muted)}
.gap{background:var(--gap);color:var(--warn);font-weight:600}
.perm-allow{color:var(--ok)}.perm-hide,.perm-disable,.perm-deny{color:var(--muted)}
.fc-shape-start{background:#1f2430;color:#fff;border-radius:999px!important}.fc-shape-decision{background:#fff7e6;border-color:#b54708!important}.fc-shape-message{background:#f6f7f9;border-style:dashed!important}.fc-shape-state{background:#eef4ff;border-color:#2f5fd0!important}
.legend .shape{display:inline-block;padding:0 10px;border:1.4px solid #3d4452;border-radius:6px;font-size:12px}
.shape-modal{border-style:dashed!important}.shape-confirm{border-color:#c2410c!important}.shape-notification{border-color:#2f5fd0!important;border-radius:999px!important;background:#eef4ff}
.condition{display:grid;grid-template-columns:48px 1fr;gap:2px 12px;margin:6px 0 12px;padding:8px 12px;border-left:3px solid var(--line)}
.condition dt{color:var(--muted);font-weight:600}.condition dd{margin:0}
details summary{cursor:pointer;color:var(--warn);font-weight:600;margin:8px 0}
.issues li{margin:4px 0}.issues-block li::marker{color:var(--bad)}.issues-warn li::marker{color:var(--warn)}
.rule{font:12px ui-monospace,monospace;color:var(--muted)}code{font:12px ui-monospace,monospace;color:var(--muted)}
${BOARD_STYLE}
@media print{nav{display:none}h2{break-after:avoid}.card,.condition,tr{break-inside:avoid}}
`;

export function renderHtml(result) {
  const { spec, report } = result;
  const title = typeof spec.meta.title === 'string' && spec.meta.title !== '' ? spec.meta.title : '이름 없는 기획서';
  const nav = `<nav><ol>${SECTIONS.map(([, name], position) => `<li><a href="#s-${position + 1}">${position + 1}. ${h(name)}</a></li>`).join('')}</ol></nav>`;
  const sections = [
    summarySection(result), scenariosSection(result), entitiesSection(result), permissionsSection(result),
    flowSection(result), screensSection(result), acceptanceSection(result), metricsSection(result),
    reviewSection(result), questionsSection(result), traceSection(result),
  ].join('');
  const model = { format: FORMAT, spec, derived: result.derived, report };

  return '<!doctype html>\n'
    + '<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
    + `<title>${h(title)}</title>`
    + `<meta name="spec-format" content="${FORMAT}"><meta name="spec-version" content="${h(spec.meta.version ?? '')}">`
    + `<meta name="spec-ready" content="${report.ready}"><meta name="spec-score" content="${report.score.ratio}">`
    + `<style>${STYLE}</style></head>`
    + `<body><main><h1>${h(title)}</h1>${nav}${sections}</main>`
    + `<script type="application/json" id="spec-model">${jsonForScript(model)}</script>`
    + (sections.includes('data-board') ? BOARD_SCRIPT : '')
    + '</body></html>\n';
}
