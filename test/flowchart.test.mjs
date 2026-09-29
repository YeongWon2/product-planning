import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSpec } from '../src/model/load.mjs';
import { runPipeline } from '../src/check/run.mjs';
import { layoutFlowchart, renderFlowchart } from '../src/render/flowchart-svg.mjs';

// 판단이 생기는 네 가지(상태 조건, 입력 규칙, 확인 창, 서버 결과)를 한 기능에 모았다.
const spec = parseSpec(JSON.stringify({
  meta: { title: 't' },
  wording: { denied: '권한이 없습니다', empty: '아직 과제가 없어요', loadError: '불러오지 못했습니다' },
  userTypes: [{ id: 'U1', name: '코치' }, { id: 'U9', name: '시스템', automatic: true }],
  apps: [{ id: 'P1', name: '코치 웹' }, { id: 'P2', name: '선수 앱' }],
  entities: [{
    id: 'E1', name: '과제',
    states: [{ id: 'ON', name: '진행 중', initial: true }, { id: 'OFF', name: '조기 마감', terminal: true }],
    transitions: [{ from: 'ON', to: 'OFF', action: 'CLOSE' }],
  }],
  actions: [
    { id: 'LIST', name: '과제 목록 보기', entity: 'E1', kind: 'list' },
    { id: 'VIEW', name: '과제 상세 보기', entity: 'E1', kind: 'view' },
    { id: 'CLOSE', name: '과제 조기 마감하기', entity: 'E1', kind: 'other', async: true, irreversible: true,
      inputs: [{ name: '마감 사유', type: 'text', max: 100 }], success: '과제를 마감했습니다',
      failures: [{ name: '다른 코치의 과제', message: '다른 코치가 부여한 과제는 마감할 수 없습니다' }, { name: '통신 실패', message: '네트워크 이슈가 발생했습니다' }],
      crossApp: [{ app: 'P2', userType: 'U1', effect: '마감된 과제가 목록에서 사라진다' }] },
    { id: 'EXPIRE', name: '과제 기한 종료', entity: 'E1', kind: 'other' },
  ],
  permissions: [
    { userType: 'U1', action: 'LIST', value: 'allow' },
    { userType: 'U1', action: 'VIEW', state: 'ON', value: 'allow' }, { userType: 'U1', action: 'VIEW', state: 'OFF', value: 'allow' },
    { userType: 'U1', action: 'CLOSE', state: 'ON', value: 'allow' }, { userType: 'U1', action: 'CLOSE', state: 'OFF', value: 'hide' },
  ],
  requirements: [{ id: 'R1', name: '코치가 과제를 마감한다', userType: 'U1', priority: 'must' }],
  scenarios: [
    { id: 'S1', name: '조기 마감', requirement: 'R1', kind: 'main', steps: [
      { userType: 'U1', app: 'P1', action: 'LIST', text: '과제 목록을 연다' },
      { userType: 'U1', app: 'P1', action: 'VIEW', text: '과제를 연다' },
      { userType: 'U1', app: 'P1', action: 'CLOSE', text: '사유를 적고 마감한다' }] },
    { id: 'S2', name: '기한 종료', requirement: 'R1', kind: 'main', steps: [
      { userType: 'U9', app: 'P1', action: 'EXPIRE', text: '기한이 지나면 끝난다' }] },
  ],
})).spec;

const charts = () => runPipeline(spec).derived.flowcharts;
const chartOf = (kind, id) => charts().find((chart) => chart.kind === kind && chart.of === id);
const textOf = (chart, id) => chart.nodes.find((node) => node.id === id).text;
// 시작에서 '예'와 순서만 따라간 본 줄기
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
const branches = (chart) => chart.edges.filter((edge) => edge.kind !== 'main').map((edge) => [edge.label, `${chart.nodes.find((n) => n.id === edge.to).type}:${textOf(chart, edge.to)}`]);

test('시나리오 플로우차트는 판단 없이 기능 순서와 상태 변화만 잇는다', () => {
  assert.deepEqual(mainPath(chartOf('scenario', 'S1')), [
    'start:코치 · 코치 웹', 'process:과제 목록을 연다', 'process:과제를 연다', 'process:사유를 적고 마감한다', "state:'과제' 진행 중 → 조기 마감", 'end:끝',
  ]);
  assert.deepEqual(branches(chartOf('scenario', 'S1')), []);
  assert.deepEqual(mainPath(chartOf('scenario', 'S2')), ['start:시스템 · 규칙에 따라 자동', 'process:기한이 지나면 끝난다', 'end:끝']);
});

test('기능 플로우차트는 권한·상태 조건·입력 규칙·확인 창·서버 결과의 판단과 갈래를 그린다', () => {
  const chart = chartOf('function', 'CLOSE');
  assert.deepEqual(mainPath(chart), [
    'start:과제 조기 마감하기', "decision:'과제'가 '진행 중' 상태인가?", 'process:마감 사유 입력', 'decision:입력 규칙을 지켰나?',
    'decision:확인 창에서 확인했나?', 'decision:과제 조기 마감하기 성공?', 'message:성공 안내', "state:'과제' 진행 중 → 조기 마감", "message:'선수 앱'에 알림", 'end:끝',
  ]);
  assert.deepEqual(branches(chart), [
    ['아니오', 'end:할 수 없음'], ['아니오', 'message:입력 오류 안내'], ['다시 입력', 'process:마감 사유 입력'], ['아니오', 'end:취소'],
    ['다른 코치의 과제', 'message:오류 안내'], ['', 'end:끝'], ['통신 실패', 'message:오류 안내'], ['', 'end:끝'],
  ]);
  assert.equal(chartOf('function', 'EXPIRE'), undefined, '자동 처리는 기능 플로우차트를 만들지 않는다');
  assert.deepEqual(mainPath(chartOf('function', 'LIST')), ['start:과제 목록 보기', 'process:목록을 보여 준다', 'end:끝']);
});

test('할 수 없는 사용자가 있으면 권한 판단을, 공통 서버 오류가 정해져 있으면 그 갈래를 더한다', () => {
  const withMore = parseSpec(JSON.stringify({
    ...JSON.parse(JSON.stringify(spec)),
    wording: { ...spec.wording, network: '네트워크를 확인해 주세요', unknown: '잠시 후 다시 시도해 주세요', sessionExpired: '다시 로그인해 주세요' },
    userTypes: [...spec.userTypes, { id: 'U2', name: '선수' }],
    permissions: [...spec.permissions, { userType: 'U2', action: 'CLOSE', state: 'ON', value: 'deny' }, { userType: 'U2', action: 'CLOSE', state: 'OFF', value: 'deny' }],
  })).spec;
  const chart = runPipeline(withMore).derived.flowcharts.find((item) => item.kind === 'function' && item.of === 'CLOSE');
  const path = mainPath(chart);
  assert.equal(path[1], 'decision:권한이 있나?');
  const labels = branches(chart).map(([label, to]) => `${label}:${to}`);
  assert.ok(labels.includes('아니오:end:권한 없음 안내'));
  for (const name of ['통신 실패', '알 수 없는 오류', '로그인 만료']) assert.ok(labels.includes(`${name}:message:오류 안내`), name);
  assert.equal(labels.filter((label) => label.startsWith('통신 실패')).length, 1, '이미 적은 실패는 두 번 그리지 않는다');
});

test('페이지 플로우차트는 권한·불러오기·빈 화면을 거쳐 화면에서 할 수 있는 것을 보인다', () => {
  const chart = chartOf('page', 'sc:P1:E1:view');
  assert.equal(chart.name, '과제 상세');
  assert.deepEqual(mainPath(chart), [
    'start:코치 웹 · 과제 상세', 'decision:권한이 있나?', 'process:불러오는 중', 'decision:불러왔나?', 'decision:데이터가 있나?',
    'process:화면 표시\n· 과제 조기 마감하기', 'end:끝',
  ]);
  assert.deepEqual(branches(chart), [
    ['아니오', 'end:권한 없음 안내: 권한이 없습니다'], ['아니오', 'message:불러오지 못했습니다'], ['다시 시도', 'process:불러오는 중'], ['아니오', 'end:비어 있음 안내: 아직 과제가 없어요'],
  ]);
  assert.equal(charts().filter((chart) => chart.kind === 'page').length, 3, '모달·확인 창은 페이지가 아니다');
});

test('플로우차트는 종류·대상·이름을 갖고 같은 입력이면 같다', () => {
  const first = charts();
  assert.deepEqual(first.map((chart) => [chart.kind, chart.of, chart.requirement]), [
    ['scenario', 'S1', 'R1'], ['scenario', 'S2', 'R1'], ['function', 'LIST', null], ['function', 'VIEW', null], ['function', 'CLOSE', null],
    ['page', 'sc:P1:E1:list', null], ['page', 'sc:P1:E1:view', null], ['page', 'sc:P2:E1:view', null],
  ]);
  assert.deepEqual(first, charts());
});

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
  for (const chart of charts()) {
    const { nodes, routes } = layoutFlowchart(chart);
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
  const { markup, width, height } = renderFlowchart(chartOf('function', 'CLOSE'));
  assert.ok(width > 0 && height > 0);
  assert.match(markup, /<polygon class="fc-decision"/);
  assert.match(markup, /class="fc-start"/);
  assert.match(markup, /<tspan[^>]*>&#39;과제&#39;가 &#39;진행<\/tspan>/, '긴 판단 글은 줄을 바꾼다');
  assert.equal(markup, renderFlowchart(chartOf('function', 'CLOSE')).markup);
});

import { findCollisions } from '../src/render/layout-check.mjs';

test('갈래 선은 위로 올라갔다가 오른쪽으로 가서 상자 위로 들어가고, 모든 플로우차트에 겹침이 없다', () => {
  for (const chart of charts()) {
    const layout = layoutFlowchart(chart);
    assert.deepEqual(findCollisions(layout), [], `${chart.kind} ${chart.of}`);
    const byId = new Map(layout.nodes.map((node) => [node.id, node]));
    for (const route of layout.routes.filter((item) => item.kind === 'no')) {
      const target = byId.get(route.to);
      const [, last] = [route.points[route.points.length - 2], route.points[route.points.length - 1]];
      assert.equal(last[1], target.y, `${route.from}→${route.to}은 상자 위쪽으로 들어간다`);
      for (let i = 1; i < route.points.length; i += 1) {
        const [a, b] = [route.points[i - 1], route.points[i]];
        assert.ok(a[0] === b[0] || a[1] === b[1], '가로·세로 선분만 쓴다');
      }
    }
  }
});

test('긴 글도 상자 밖으로 넘치지 않는다', () => {
  const long = { kind: 'function', of: 'X', name: 'x', nodes: [
    { id: 'a', type: 'start', text: '아주아주긴이름이붙은기능을시작한다' },
    { id: 'b', type: 'decision', text: '대상 선수가 모두 이 팀 목표의 상세 목표에 속해 있는가?' },
    { id: 'c', type: 'end', text: '끝' },
  ], edges: [{ from: 'a', to: 'b', kind: 'main', label: '' }, { from: 'b', to: 'c', kind: 'main', label: '예' }] };
  const { nodes } = layoutFlowchart(long);
  for (const node of nodes) {
    const widest = Math.max(...node.lines.map((line) => [...line].length)) * 13;
    const room = node.type === 'decision' ? node.w * 0.62 : node.w - 16;
    assert.ok(widest <= room, `${node.id}: 글 폭 ${widest} > 자리 ${room}`);
    assert.ok(node.lines.length * 18 <= (node.type === 'decision' ? node.h * 0.62 : node.h), `${node.id}: 줄이 상자 높이를 넘는다`);
  }
});

test('사용자마다 할 수 있는 상태가 다르면 사용자별 상태 판단을 그린다', () => {
  const partial = parseSpec(JSON.stringify({
    ...JSON.parse(JSON.stringify(spec)),
    userTypes: [...spec.userTypes, { id: 'U2', name: '선수' }],
    permissions: [...spec.permissions, { userType: 'U2', action: 'VIEW', state: 'ON', value: 'allow' }, { userType: 'U2', action: 'VIEW', state: 'OFF', value: 'hide' }],
  })).spec;
  const chart = runPipeline(partial).derived.flowcharts.find((item) => item.kind === 'function' && item.of === 'VIEW');
  assert.ok(mainPath(chart).includes("decision:'선수'이면 '과제'가 '진행 중' 상태인가?"), mainPath(chart).join('\n'));
  assert.ok(branches(chart).some(([label, to]) => label === '아니오' && to === 'end:할 수 없음'));
});
