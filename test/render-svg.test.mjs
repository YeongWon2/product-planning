import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, jsonForScript } from '../src/render/escape.mjs';
import { layoutFlow, renderFlowSvg } from '../src/render/flow-svg.mjs';

const apps = [{ id: 'P1', name: '관리자 웹' }];
const screens = [
  { id: 'a', name: '목록 <특수> & "따옴표"', app: 'P1', type: 'screen' },
  { id: 'b', name: '상세', app: 'P1', type: 'modal' },
];
const edges = [{ from: 'a', to: 'b', label: '열기' }, { from: 'b', to: 'a', label: '완료' }];

test('HTML과 스크립트용 JSON을 안전하게 만든다', () => {
  assert.equal(escapeHtml('<a href="x">&\''), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  assert.ok(!jsonForScript({ n: '</script>' }).includes('</script>'));
  assert.deepEqual(JSON.parse(jsonForScript({ n: '</script>' })), { n: '</script>' });
  const separators = String.fromCharCode(0x2028, 0x2029);
  assert.ok(!jsonForScript({ n: separators }).includes(separators));
  assert.deepEqual(JSON.parse(jsonForScript({ n: separators })), { n: separators });
});

test('고리가 있어도 배치가 끝나고 좌표가 유한하다', () => {
  const { nodes, width, height } = layoutFlow({ apps, screens, edges, entries: ['a'] });
  assert.equal(nodes.length, 2);
  for (const n of nodes) assert.ok(Number.isFinite(n.x) && Number.isFinite(n.y));
  assert.ok(nodes.find((n) => n.id === 'b').x > nodes.find((n) => n.id === 'a').x);
  assert.ok(width > 0 && height > 0);
});

test('앱마다 레인을 나누고 화면이 없는 앱은 뺀다', () => {
  const twoApps = [{ id: 'P1', name: '관리자 웹' }, { id: 'P0', name: '빈 앱' }, { id: 'P2', name: '담당자 앱' }];
  const { nodes, lanes } = layoutFlow({
    apps: twoApps,
    screens: [...screens, { id: 'c', name: '알림', app: 'P2', type: 'notification' }],
    edges,
    entries: ['a', 'c'],
  });
  assert.deepEqual(lanes.map((lane) => lane.name), ['관리자 웹', '담당자 앱']);
  assert.ok(nodes.find((n) => n.id === 'c').y > nodes.find((n) => n.id === 'a').y);
});

test('SVG는 이름을 이스케이프하고 ID를 속성에만 둔다', () => {
  const svg = renderFlowSvg({ apps, screens, edges, entries: ['a'] });
  assert.ok(svg.includes('목록 &lt;특수&gt; &amp; &quot;따옴표&quot;'));
  assert.ok(svg.includes('data-spec-id="a"'));
  assert.equal(svg, renderFlowSvg({ apps, screens, edges, entries: ['a'] }));
});

test('긴 이름은 줄이고 전체 이름은 title에 둔다', () => {
  const svg = renderFlowSvg({ apps, screens: [{ id: 'l', name: '아주 긴 화면 이름이 여기까지 이어진다', app: 'P1', type: 'screen' }], edges: [], entries: ['l'] });
  assert.ok(svg.includes('<title>아주 긴 화면 이름이 여기까지 이어진다</title>'));
  assert.ok(svg.includes('…'));
});

test('앱 이름이 붙은 화면 이름은 흐름도에서 잘리지 않는다', () => {
  const svg = renderFlowSvg({ apps, screens: [{ id: 'd', name: '항목 상세 · 관리자 웹', app: 'P1', type: 'screen' }], edges: [], entries: ['d'] });
  assert.ok(svg.includes('>항목 상세 · 관리자 웹</text>'));
});

// 한 화면에서 여러 폼으로 갈라지고 '완료'로 돌아오는, 실제 기획서에서 흔한 모양.
const busy = (() => {
  const s = (id, name, type = 'screen', app = 'P1') => ({ id, name, app, type });
  const busyScreens = [
    s('L', '과제 목록'), s('V', '과제 상세'), s('C', '과제 부여하기'),
    s('M1', '과제 수정하기', 'modal'), s('M2', '과제 조기 마감하기', 'modal'), s('K', '과제 조기 마감하기 확인', 'confirm'),
    s('H', '회차 목록'), s('F', '피드백 남기기', 'modal'), s('G', '상세 목표 목록'), s('GC', '상세 목표 만들기', 'modal'),
    s('PL', '과제 목록 · 선수 앱', 'screen', 'P2'), s('PV', '과제 상세 · 선수 앱', 'screen', 'P2'), s('PS', '회차 수행하기', 'modal', 'P2'),
  ];
  const e = (from, to, label) => ({ from, to, label });
  const busyEdges = [
    e('G', 'GC', '상세 목표 만들기'), e('GC', 'G', '완료'), e('G', 'C', '과제 부여하기'), e('C', 'V', '완료'),
    e('L', 'V', '과제 상세 보기'), e('V', 'M1', '과제 수정하기'), e('M1', 'V', '완료'), e('V', 'M2', '과제 조기 마감하기'),
    e('M2', 'K', '과제 조기 마감하기'), e('K', 'V', '완료'), e('V', 'H', '수행 이력 보기'), e('H', 'F', '피드백 남기기'), e('F', 'H', '완료'),
    e('PL', 'PV', '과제 상세 보기'), e('PV', 'PS', '회차 수행하기'), e('PS', 'PV', '완료'), e('C', 'PL', '선수 앱에 알림'),
  ];
  return { apps: [{ id: 'P1', name: '코치 웹' }, { id: 'P2', name: '선수 앱' }], screens: busyScreens, edges: busyEdges, entries: ['G', 'L', 'PL'] };
})();

const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
// 선분이 사각형 안쪽을 지나는지 (Liang–Barsky). 경계에 닿는 것은 지나는 것으로 보지 않는다.
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

test('이동 선은 다른 화면 상자를 지나지 않는다', () => {
  const { nodes, routes } = layoutFlow(busy);
  assert.equal(routes.length, busy.edges.length);
  for (const route of routes) {
    for (let i = 1; i < route.points.length; i += 1) {
      for (const node of nodes) {
        if (node.id === route.from || node.id === route.to) continue;
        assert.equal(crosses(route.points[i - 1], route.points[i], node), false, `${route.from}→${route.to} 선이 ${node.id} 상자를 지난다`);
      }
    }
  }
});

test('이동 이름표는 화면 상자나 다른 이름표와 겹치지 않는다', () => {
  const { nodes, routes } = layoutFlow(busy);
  routes.forEach((route, i) => {
    for (const node of nodes) assert.equal(overlaps(route.labelBox, node), false, `'${route.label}' 이름표가 ${node.id} 상자와 겹친다`);
    routes.slice(i + 1).forEach((other) => assert.equal(overlaps(route.labelBox, other.labelBox), false, `'${route.label}'과 '${other.label}' 이름표가 겹친다`));
  });
});

test('이름표는 선 위에서 읽히도록 흰 테두리를 두르고 배치는 결정적이다', () => {
  const svg = renderFlowSvg(busy);
  assert.match(svg, /\.edge text\{[^}]*paint-order:stroke/);
  assert.equal(svg, renderFlowSvg(busy));
});

test('서로 다른 이동의 선이 같은 줄 위에 포개지지 않는다', () => {
  const { routes } = layoutFlow(busy);
  const segments = routes.flatMap((route) => route.points.slice(1).map((end, i) => ({ route, a: route.points[i], b: end })));
  const span = (p, q) => [Math.min(p, q), Math.max(p, q)];
  segments.forEach((one, i) => {
    for (const two of segments.slice(i + 1)) {
      if (one.route === two.route) continue;
      for (const axis of [0, 1]) {
        const other = 1 - axis;
        // 둘 다 같은 축에 평행하고 같은 줄에 있으면 겹치는 길이를 본다.
        if (one.a[other] !== one.b[other] || two.a[other] !== two.b[other] || one.a[other] !== two.a[other]) continue;
        const [s1, e1] = span(one.a[axis], one.b[axis]);
        const [s2, e2] = span(two.a[axis], two.b[axis]);
        assert.ok(Math.min(e1, e2) - Math.max(s1, s2) <= 2, `${one.route.from}→${one.route.to}와 ${two.route.from}→${two.route.to}가 포개진다`);
      }
    }
  });
});
