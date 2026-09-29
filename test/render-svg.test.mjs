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
