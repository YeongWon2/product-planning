import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSpec } from '../src/model/load.mjs';
import { runPipeline } from '../src/check/run.mjs';
import { layoutOverview, renderOverview } from '../src/render/overview-svg.mjs';
import { findCollisions, overlap } from '../src/render/layout-check.mjs';

const example = () => parseSpec(readFileSync(new URL('../examples/assignment/spec.json', import.meta.url), 'utf8'));
const resultOf = () => { const { spec, problems } = example(); return runPipeline(spec, problems); };

test('전체 흐름도는 서비스마다 틀을 두고 그 안에 앱과 화면, 바깥에 API 서버를 둔다', () => {
  const { derived } = resultOf();
  const { overview } = derived;
  assert.deepEqual(overview.services.map((service) => [service.id, service.apps.map((app) => app.id)]), [['SV1', ['P1']], ['SV2', ['P2']]]);
  assert.deepEqual(overview.systems.map((system) => system.id), ['API1']);
  const kinds = new Set(overview.edges.map((edge) => edge.kind));
  for (const kind of ['flow', 'cross', 'call']) assert.ok(kinds.has(kind), `${kind} 선이 있다`);
  assert.ok(overview.edges.some((edge) => edge.kind === 'cross' && edge.to.startsWith('sc:P2:')), '다른 서비스로 가는 영향이 선으로 이어진다');
  assert.ok(overview.edges.filter((edge) => edge.kind === 'call').every((edge) => edge.to === 'API1'));
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
  assert.match(markup, />항목 API</);
  assert.equal(markup, renderOverview(result.derived.overview, result.index).markup);
});

test('겹치면 간격을 넓혀 다시 그리고, 끝까지 겹치면 겹침 목록을 남긴다', () => {
  const result = resultOf();
  const drawn = renderOverview(result.derived.overview, result.index);
  assert.ok(drawn.spacing >= 1);
  assert.deepEqual(drawn.collisions, []);
});
