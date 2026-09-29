import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSpec } from '../src/model/load.mjs';
import { runPipeline } from '../src/check/run.mjs';
import { layoutOverview, renderOverview } from '../src/render/overview-svg.mjs';
import { findCollisions, overlap } from '../src/render/layout-check.mjs';

const example = () => parseSpec(readFileSync(new URL('../examples/assignment/spec.json', import.meta.url), 'utf8'));
const resultOf = () => { const { spec, problems } = example(); return runPipeline(spec, problems); };

test('전체 흐름은 화면이 아니라 요구사항을 상자로 두고, 서비스 틀 안에 앱별로 놓는다', () => {
  const { derived, spec } = resultOf();
  const { overview } = derived;
  assert.deepEqual(overview.services.map((service) => service.id), ['SV1', 'SV2']);
  const nodes = overview.services.flatMap((service) => service.apps.flatMap((app) => app.nodes));
  for (const requirement of spec.requirements) assert.ok(nodes.includes(requirement.id), `${requirement.id}가 전체 흐름에 있다`);
  assert.ok(nodes.every((id) => !id.startsWith('sc:')), '화면은 전체 흐름에 없다');
  assert.deepEqual(overview.systems.map((system) => system.id), ['API1']);
});

test('선은 먼저 만들어야 쓸 수 있는 순서, 다른 서비스 영향, API 호출 세 가지다', () => {
  const { overview } = resultOf().derived;
  const edge = (kind) => overview.edges.filter((item) => item.kind === kind);
  assert.deepEqual(edge('order').map((item) => [item.from, item.to, item.label]), [['R1', 'R2', '항목']]);
  assert.ok(edge('cross').some((item) => item.from === 'R1' && item.to === 'app:P2'), '다른 서비스 앱으로 가는 영향');
  assert.ok(edge('call').length > 0 && edge('call').every((item) => item.to === 'API1'));
});

test('전체 흐름도는 겹침이 없고, 화면은 자기 앱 틀 안에, 앱 틀은 자기 서비스 틀 안에 있다', () => {
  const result = resultOf();
  const layout = layoutOverview(result.derived.overview, result.index);
  assert.deepEqual(findCollisions(layout), []);
  const inside = (a, b) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
  for (const node of layout.nodes.filter((item) => item.app)) {
    const app = layout.containers.find((item) => item.id === node.app);
    assert.ok(inside(node, app), `${node.id}가 앱 틀 밖에 있다`);
    assert.ok(inside(app, layout.containers.find((item) => item.id === app.service)), `${app.id}가 서비스 틀 밖에 있다`);
  }
  assert.equal(layout.routes.length, result.derived.overview.edges.length);
});

test('옆으로 가는 선은 위로 올라갔다가 옆으로 가서 아래로 내려온다', () => {
  const result = resultOf();
  const { routes } = layoutOverview(result.derived.overview, result.index);
  for (const route of routes) {
    const ys = route.points.map(([, y]) => y);
    const lane = Math.min(...ys);
    assert.ok(lane < ys[0] && lane < ys[ys.length - 1], `${route.from}→${route.to}은 위쪽 통로를 지난다`);
    for (let i = 1; i < route.points.length; i += 1) {
      const [a, b] = [route.points[i - 1], route.points[i]];
      assert.ok(a[0] === b[0] || a[1] === b[1], '꺾인 선은 가로·세로 선분만 쓴다');
    }
  }
});

test('전체 흐름도 SVG는 서비스 이름과 API 서버를 보이고 같은 입력이면 같다', () => {
  const result = resultOf();
  const { markup } = renderOverview(result.derived.overview, result.index);
  assert.match(markup, /class="ov-service"/);
  assert.match(markup, />관리자 서비스</);
  assert.match(markup, /class="ov-req"/);
  assert.match(markup, />항목 API</);
  assert.equal(markup, renderOverview(result.derived.overview, result.index).markup);
});

test('겹치면 간격을 넓혀 다시 그리고, 끝까지 겹치면 겹침 목록을 남긴다', () => {
  const result = resultOf();
  const drawn = renderOverview(result.derived.overview, result.index);
  assert.ok(drawn.spacing >= 1);
  assert.deepEqual(drawn.collisions, []);
});
