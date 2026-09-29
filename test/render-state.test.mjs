import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSpec } from '../src/model/load.mjs';
import { buildIndex } from '../src/model/index.mjs';
import { layoutStates, renderStates } from '../src/render/state-svg.mjs';

const { spec } = parseSpec(JSON.stringify({
  entities: [{
    id: 'E1', name: '과제',
    states: [{ id: 'PLAN', name: '예정', initial: true }, { id: 'ON', name: '진행 중' }, { id: 'DONE', name: '완료', terminal: true }, { id: 'MISS', name: '미완료', terminal: true }, { id: 'CLOSE', name: '조기 마감', terminal: true }],
    transitions: [
      { from: 'PLAN', to: 'ON', action: 'START' }, { from: 'ON', to: 'DONE', action: 'DO' }, { from: 'ON', to: 'MISS', action: 'EXPIRE' },
      { from: 'ON', to: 'CLOSE', action: 'STOP' }, { from: 'PLAN', to: 'CLOSE', action: 'STOP' }, { from: 'DONE', to: 'ON', action: 'REOPEN' },
    ],
  }],
  actions: [{ id: 'START', name: '과제 시작', entity: 'E1', kind: 'other' }, { id: 'DO', name: '회차 수행하기', entity: 'E1', kind: 'other' }, { id: 'EXPIRE', name: '과제 기한 종료', entity: 'E1', kind: 'other' }, { id: 'STOP', name: '과제 조기 마감하기', entity: 'E1', kind: 'other' }, { id: 'REOPEN', name: '다시 열기', entity: 'E1', kind: 'other' }],
}));
const index = buildIndex(spec);
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test('상태는 시작에서 닿는 순서로 한 줄에 놓고 상자와 이름표가 겹치지 않는다', () => {
  const { nodes, routes } = layoutStates(spec.entities[0], index);
  assert.deepEqual(nodes.map((node) => node.id), ['PLAN', 'ON', 'DONE', 'MISS', 'CLOSE']);
  assert.equal(routes.length, 6);
  nodes.forEach((one, i) => nodes.slice(i + 1).forEach((two) => assert.equal(overlaps(one, two), false)));
  for (const route of routes) {
    for (const node of nodes) assert.equal(overlaps(route.labelBox, node), false, `'${route.label}' 이름표가 ${node.id}를 가린다`);
    for (const other of routes) if (other !== route) assert.equal(overlaps(route.labelBox, other.labelBox), false, `'${route.label}'과 '${other.label}' 이름표가 겹친다`);
  }
});

test('상태 다이어그램 SVG는 시작·끝을 표시하고 같은 입력이면 같다', () => {
  const svg = renderStates(spec.entities[0], index);
  assert.match(svg, /<svg[^>]*aria-label="&#39;과제&#39; 상태 변화"/);
  assert.match(svg, /data-state="PLAN"[^>]*data-initial="true"/);
  assert.match(svg, /data-state="DONE"[^>]*data-terminal="true"/);
  assert.ok(svg.includes('>과제 조기 마감하기<') || svg.includes('과제 조기 마감…'));
  assert.equal(svg, renderStates(spec.entities[0], index));
});

import { findCollisions } from '../src/render/layout-check.mjs';

test('상태 다이어그램도 겹침 검사를 통과한다', () => {
  assert.deepEqual(findCollisions(layoutStates(spec.entities[0], index)), []);
});
