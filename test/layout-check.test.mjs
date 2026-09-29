import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findCollisions } from '../src/render/layout-check.mjs';

const box = (id, x, y, w = 100, h = 40) => ({ id, x, y, w, h });

test('겹침 검사는 상자끼리, 선이 다른 상자를 지남, 선끼리 포갬, 글자끼리·글자와 상자 겹침을 찾는다', () => {
  const nodes = [box('A', 0, 0), box('B', 300, 0), box('C', 150, 0), box('D', 150, 20)];
  const routes = [
    { from: 'A', to: 'B', points: [[100, 20], [300, 20]], labelBox: { x: 160, y: 10, w: 40, h: 14 } },
    { from: 'B', to: 'A', points: [[300, 20], [100, 20]], labelBox: { x: 170, y: 12, w: 40, h: 14 } },
  ];
  const kinds = findCollisions({ nodes, routes }).map((item) => item.kind);
  for (const kind of ['상자 겹침', '선이 상자를 지남', '선이 포개짐', '글자 겹침', '글자가 상자를 가림']) assert.ok(kinds.includes(kind), kind);
});

test('겹침이 없으면 빈 목록이다', () => {
  const nodes = [box('A', 0, 0), box('B', 300, 0)];
  const routes = [{ from: 'A', to: 'B', points: [[100, 20], [300, 20]], labelBox: { x: 180, y: 0, w: 40, h: 14 } }];
  assert.deepEqual(findCollisions({ nodes, routes }), []);
});

test('담는 틀(container)은 안에 든 상자와 겹쳐도 되고, 선은 틀의 테두리를 지나도 된다', () => {
  const nodes = [box('A', 20, 40), box('B', 400, 40)];
  const containers = [{ id: 'S1', x: 0, y: 0, w: 200, h: 120 }, { id: 'S2', x: 380, y: 0, w: 200, h: 120 }];
  const routes = [{ from: 'A', to: 'B', points: [[120, 60], [400, 60]], labelBox: null }];
  assert.deepEqual(findCollisions({ nodes, routes, containers }), []);
  assert.deepEqual(findCollisions({ nodes, routes, containers: [...containers, { id: 'P1', x: 10, y: 30, w: 150, h: 80 }] }), [], '틀 안의 틀은 괜찮다');
  const bad = findCollisions({ nodes, routes: [], containers: [...containers, { id: 'S3', x: 150, y: 0, w: 100, h: 50 }] });
  assert.ok(bad.some((item) => item.kind === '틀 겹침'));
});

test('선이 다른 선의 이름표나 제목을 지나면 찾는다', () => {
  const nodes = [box('A', 0, 100), box('B', 300, 100)];
  const routes = [
    { from: 'A', to: 'B', points: [[100, 120], [150, 120], [150, 20], [250, 20], [250, 120], [300, 120]], labelBox: { x: 180, y: 6, w: 40, h: 14 } },
    { from: 'B', to: 'A', points: [[300, 130], [200, 130], [200, 0]], labelBox: null },
  ];
  const kinds = findCollisions({ nodes, routes, labels: [{ x: 140, y: 60, w: 30, h: 14, text: '서비스' }] }).map((item) => `${item.kind}:${item.b}`);
  assert.ok(kinds.includes('선이 글자를 지남:A→B'), kinds.join(','));
  assert.ok(kinds.includes('선이 글자를 지남:서비스'), kinds.join(','));
});
