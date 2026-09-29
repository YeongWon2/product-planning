import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSpec } from '../src/model/load.mjs';
import { runPipeline } from '../src/check/run.mjs';

// 판단이 생기는 네 가지(상태 조건, 입력 규칙, 확인 창, 서버 결과)를 한 시나리오에 모았다.
const spec = parseSpec(JSON.stringify({
  meta: { title: 't' },
  userTypes: [{ id: 'U1', name: '코치' }, { id: 'U9', name: '시스템', automatic: true }],
  apps: [{ id: 'P1', name: '코치 웹' }, { id: 'P2', name: '선수 앱' }],
  entities: [{
    id: 'E1', name: '과제',
    states: [{ id: 'ON', name: '진행 중', initial: true }, { id: 'OFF', name: '조기 마감', terminal: true }],
    transitions: [{ from: 'ON', to: 'OFF', action: 'CLOSE' }],
  }],
  actions: [
    { id: 'VIEW', name: '과제 상세 보기', entity: 'E1', kind: 'view' },
    { id: 'CLOSE', name: '과제 조기 마감하기', entity: 'E1', kind: 'other', async: true, irreversible: true,
      inputs: [{ name: '마감 사유', rules: ['최대 100자'] }], success: '과제를 마감했습니다',
      failures: [{ name: '다른 코치의 과제', message: '다른 코치가 부여한 과제는 마감할 수 없습니다' }, { name: '통신 실패', message: '네트워크 이슈가 발생했습니다' }],
      crossApp: [{ app: 'P2', userType: 'U1', effect: '마감된 과제가 목록에서 사라진다' }] },
    { id: 'EXPIRE', name: '과제 기한 종료', entity: 'E1', kind: 'other' },
  ],
  permissions: [
    { userType: 'U1', action: 'VIEW', state: 'ON', value: 'allow' }, { userType: 'U1', action: 'VIEW', state: 'OFF', value: 'allow' },
    { userType: 'U1', action: 'CLOSE', state: 'ON', value: 'allow' }, { userType: 'U1', action: 'CLOSE', state: 'OFF', value: 'hide' },
  ],
  requirements: [{ id: 'R1', name: '코치가 과제를 마감한다', userType: 'U1', priority: 'must' }],
  scenarios: [
    { id: 'S1', name: '조기 마감', requirement: 'R1', kind: 'main', steps: [
      { userType: 'U1', app: 'P1', action: 'VIEW', text: '과제를 연다' },
      { userType: 'U1', app: 'P1', action: 'CLOSE', text: '사유를 적고 마감한다' }] },
    { id: 'S2', name: '기한 종료', requirement: 'R1', kind: 'main', steps: [
      { userType: 'U9', app: 'P1', action: 'EXPIRE', text: '기한이 지나면 끝난다' }] },
  ],
})).spec;

const chartOf = (id) => runPipeline(spec).derived.flowcharts.find((chart) => chart.scenario === id);
const textOf = (chart, id) => chart.nodes.find((node) => node.id === id).text;
// 시작에서 '예'와 단계 순서만 따라간 본 줄기
function mainPath(chart) {
  const path = [];
  let current = chart.nodes.find((node) => node.type === 'start');
  while (current) {
    path.push(`${current.type}:${current.text}`);
    const next = chart.edges.find((edge) => edge.from === current.id && edge.kind === 'main');
    current = next && chart.nodes.find((node) => node.id === next.to);
  }
  return path;
}

test('시나리오마다 시작에서 끝까지 이어지는 플로우차트를 만든다', () => {
  assert.deepEqual(mainPath(chartOf('S1')), [
    'start:코치 · 코치 웹',
    'process:과제를 연다',
    "decision:'과제'가 '진행 중' 상태인가?",
    'process:사유를 적고 마감한다',
    'decision:입력 규칙을 지켰나?',
    'decision:확인 창에서 확인했나?',
    'decision:과제 조기 마감하기 성공?',
    'message:성공 안내',
    "state:'과제' 진행 중 → 조기 마감",
    "message:'선수 앱'에 알림",
    'end:끝',
  ]);
});

// 문구 원문은 기능명세서에만 두고, 플로우차트는 흐름과 갈래 조건만 보인다.
test('판단의 아니오 갈래는 동작 가능표·입력 규칙·확인 창·실패 안내에서 나온다', () => {
  const chart = chartOf('S1');
  const branches = chart.edges.filter((edge) => edge.kind !== 'main').map((edge) => [edge.label, `${chart.nodes.find((n) => n.id === edge.to).type}:${textOf(chart, edge.to)}`]);
  assert.deepEqual(branches, [
    ['아니오', 'end:할 수 없음'],
    ['아니오', 'message:입력 오류 안내'],
    ['다시 입력', 'process:사유를 적고 마감한다'],
    ['아니오', 'end:취소'],
    ['다른 코치의 과제', 'message:오류 안내'],
    ['', 'end:끝'],
    ['통신 실패', 'message:오류 안내'],
    ['', 'end:끝'],
  ]);
});

test('자동 처리 시나리오는 판단 없이 상태 변화만 그린다', () => {
  assert.deepEqual(mainPath(chartOf('S2')), ['start:시스템 · 규칙에 따라 자동', 'process:기한이 지나면 끝난다', 'end:끝']);
});

test('플로우차트는 모델 데이터에 들어가고 같은 입력이면 같다', () => {
  const first = runPipeline(spec).derived.flowcharts;
  assert.deepEqual(first.map((chart) => [chart.scenario, chart.requirement, chart.name]), [['S1', 'R1', '조기 마감'], ['S2', 'R1', '기한 종료']]);
  assert.deepEqual(first, runPipeline(spec).derived.flowcharts);
});

import { layoutFlowchart, renderFlowchart } from '../src/render/flowchart-svg.mjs';

const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
function crosses([x1, y1], [x2, y2], rect) {
  const inset = { x: rect.x + 2, y: rect.y + 2, w: rect.w - 4, h: rect.h - 4 };
  const dx = x2 - x1;
  const dy = y2 - y1;
  let t0 = 0;
  let t1 = 1;
  for (const [p, q] of [[-dx, x1 - inset.x], [dx, inset.x + inset.w - x1], [-dy, y1 - inset.y], [dy, inset.y + inset.h - y1]]) {
    if (p === 0) { if (q < 0) return false; continue; }
    const r = q / p;
    if (p < 0) t0 = Math.max(t0, r); else t1 = Math.min(t1, r);
    if (t0 > t1) return false;
  }
  return true;
}

test('플로우차트 상자는 서로 겹치지 않고 선은 다른 상자를 지나지 않는다', () => {
  for (const id of ['S1', 'S2']) {
    const { nodes, routes } = layoutFlowchart(chartOf(id));
    nodes.forEach((one, i) => nodes.slice(i + 1).forEach((two) => assert.equal(overlaps(one, two), false, `${one.id}와 ${two.id}가 겹친다`)));
    for (const route of routes) {
      for (let i = 1; i < route.points.length; i += 1) {
        for (const box of nodes) {
          if (box.id === route.from || box.id === route.to) continue;
          assert.equal(crosses(route.points[i - 1], route.points[i], box), false, `${route.from}→${route.to} 선이 ${box.id}를 지난다`);
        }
      }
      if (route.labelBox) for (const box of nodes) assert.equal(overlaps(route.labelBox, box), false, `'${route.label}' 이름표가 ${box.id}를 가린다`);
    }
  }
});

test('판단은 마름모, 시작·끝은 둥근 상자로 그리고 긴 글은 줄을 바꾼다', () => {
  const { markup, width, height } = renderFlowchart(chartOf('S1'));
  assert.ok(width > 0 && height > 0);
  assert.match(markup, /<polygon class="fc-decision"/);
  assert.match(markup, /class="fc-start"/);
  assert.match(markup, /<tspan[^>]*>&#39;과제&#39;가 &#39;진행<\/tspan>/, '긴 판단 글은 줄을 바꾼다');
  assert.equal(markup, renderFlowchart(chartOf('S1')).markup);
});
