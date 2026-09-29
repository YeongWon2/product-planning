import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSpec } from '../src/model/load.mjs';
import { buildIndex } from '../src/model/index.mjs';
import { deriveFlow } from '../src/flow/derive.mjs';

function flowOf(input) {
  const { spec } = parseSpec(JSON.stringify({
    meta: { title: 't' },
    apps: [{ id: 'P1', name: '관리자 웹' }, { id: 'P2', name: '담당자 앱' }],
    userTypes: [{ id: 'U1', name: '관리자' }, { id: 'U2', name: '담당자' }],
    entities: [{ id: 'E1', name: '항목' }],
    ...input,
  }));
  return deriveFlow(spec, buildIndex(spec));
}

const inputs = (n) => Array.from({ length: n }, (_, i) => ({ name: `입력${i}`, rules: ['필수'] }));
const step = (action) => ({ userType: 'U1', app: 'P1', action });

test('목록 → 만들기(입력 2개) → 상세: 모달을 거쳐 상세로 간다', () => {
  const flow = flowOf({
    actions: [
      { id: 'L', name: '항목 목록 보기', entity: 'E1', kind: 'list' },
      { id: 'C', name: '항목 만들기', entity: 'E1', kind: 'create', inputs: inputs(2) },
      { id: 'V', name: '항목 상세 보기', entity: 'E1', kind: 'view' },
    ],
    scenarios: [{ id: 'S1', name: '배정', steps: [step('L'), step('C'), step('V')] }],
  });
  const byId = Object.fromEntries(flow.screens.map((s) => [s.id, s]));
  assert.equal(byId['sc:P1:E1:list'].name, '항목 목록');
  assert.equal(byId['sc:P1:E1:modal:C'].type, 'modal');
  assert.equal(byId['sc:P1:E1:modal:C'].rule, 'F3');
  assert.deepEqual(flow.edges.map((e) => [e.from, e.to, e.rule]), [
    ['sc:P1:E1:list', 'sc:P1:E1:modal:C', 'F10'],
    ['sc:P1:E1:modal:C', 'sc:P1:E1:view', 'F7'],
  ]);
  assert.equal(flow.stepScreens['S1#2'], 'sc:P1:E1:modal:C');
  assert.deepEqual(flow.entries, ['sc:P1:E1:list']);
});

test('입력이 기준보다 많으면 화면(F4), 사람 결정이 있으면 모달로 덮어쓴다', () => {
  const actions = [
    { id: 'L', name: '항목 목록 보기', entity: 'E1', kind: 'list' },
    { id: 'U', name: '항목 수정하기', entity: 'E1', kind: 'update', inputs: inputs(4) },
  ];
  const scenarios = [{ id: 'S1', name: '수정', steps: [step('L'), step('U')] }];
  const auto = flowOf({ actions, scenarios });
  assert.equal(auto.screens.find((s) => s.id === 'sc:P1:E1:form:U').rule, 'F4');
  const decided = flowOf({ actions, scenarios, decisions: [{ id: 'D1', name: '수정은 모달로 한다' }], flowOverrides: [{ action: 'U', as: 'modal', decision: 'D1' }] });
  const modal = decided.screens.find((s) => s.id === 'sc:P1:E1:modal:U');
  assert.equal(modal.rule, '결정');
  assert.equal(modal.reason, '수정은 모달로 한다');
});

test('되돌릴 수 없는 동작은 확인 창을 끼우고 연 화면으로 돌아온다', () => {
  const flow = flowOf({
    actions: [
      { id: 'V', name: '항목 상세 보기', entity: 'E1', kind: 'view' },
      { id: 'X', name: '항목 마감하기', entity: 'E1', kind: 'other', irreversible: true },
    ],
    scenarios: [{ id: 'S1', name: '마감', steps: [step('V'), step('X')] }],
  });
  assert.deepEqual(flow.edges.map((e) => [e.from, e.to, e.rule]), [
    ['sc:P1:E1:view', 'sc:P1:E1:confirm:X', 'F6'],
    ['sc:P1:E1:confirm:X', 'sc:P1:E1:view', 'F8'],
  ]);
});

test('다른 앱에 영향을 주면 알림과 받는 쪽 상세를 잇는다', () => {
  const flow = flowOf({
    actions: [
      { id: 'L', name: '항목 목록 보기', entity: 'E1', kind: 'list' },
      { id: 'C', name: '항목 만들기', entity: 'E1', kind: 'create', inputs: inputs(1), crossApp: [{ app: 'P2', userType: 'U2', effect: '새 항목 알림' }] },
    ],
    scenarios: [{ id: 'S1', name: '배정', steps: [step('L'), step('C')] }],
  });
  const notify = flow.screens.find((s) => s.id === 'sc:P2:notify:C');
  assert.equal(notify.name, '새 항목 알림');
  assert.equal(notify.type, 'notification');
  assert.ok(flow.edges.some((e) => e.from === 'sc:P2:notify:C' && e.to === 'sc:P2:E1:view' && e.rule === 'F9'));
  assert.ok(flow.entries.includes('sc:P2:notify:C'));
});

test('앱이 달라 이름이 겹치는 화면은 앱 이름을 붙여 구분한다', () => {
  const flow = flowOf({
    actions: [
      { id: 'V', name: '항목 상세 보기', entity: 'E1', kind: 'view' },
      { id: 'X', name: '항목 고정하기', entity: 'E1', kind: 'other', inputs: inputs(1), crossApp: [{ app: 'P2', userType: 'U2', effect: '고정 알림' }] },
    ],
    scenarios: [{ id: 'S1', name: '고정', steps: [step('V'), step('X')] }],
  });
  const names = flow.screens.map((s) => s.name);
  assert.ok(names.includes('항목 상세 · 관리자 웹'));
  assert.ok(names.includes('항목 상세 · 담당자 앱'));
  assert.equal(new Set(names).size, names.length);
});

test('종류를 모르는 동작과 진입 화면이 없는 동작은 정할 것이 된다', () => {
  const flow = flowOf({
    actions: [{ id: 'Q', name: '항목 처리하기', entity: 'E1', kind: '???' }, { id: 'B', name: '항목 고정하기', entity: 'E1', kind: 'other' }],
    scenarios: [{ id: 'S1', name: '처리', steps: [step('Q'), step('B')] }],
  });
  assert.deepEqual(flow.questions.map((q) => q.name), ["'항목 처리하기'의 종류를 정해야 한다", "'항목 고정하기'를 어느 화면에서 하는가?"]);
});

test('같은 화면으로 되돌아가는 고리가 있어도 끝난다', () => {
  const flow = flowOf({
    actions: [
      { id: 'L', name: '항목 목록 보기', entity: 'E1', kind: 'list' },
      { id: 'V', name: '항목 상세 보기', entity: 'E1', kind: 'view' },
    ],
    scenarios: [{ id: 'S1', name: '왕복', steps: [step('L'), step('V'), step('L'), step('V')] }],
  });
  assert.equal(flow.screens.length, 2);
  assert.equal(flow.edges.length, 2);
});

const automatic = (action, app = 'P1') => ({ userType: 'U9', app, action });
const withAutomatic = (input) => flowOf({
  userTypes: [{ id: 'U1', name: '관리자' }, { id: 'U9', name: '시스템', automatic: true }],
  ...input,
});

test('F12 자동 처리 단계는 새 화면 없이 그 개체가 보이는 상세 화면에 연결한다', () => {
  const flow = withAutomatic({
    actions: [
      { id: 'L', name: '항목 목록 보기', entity: 'E1', kind: 'list' },
      { id: 'V', name: '항목 상세 보기', entity: 'E1', kind: 'view' },
      { id: 'X', name: '항목 기한 종료', entity: 'E1', kind: 'other' },
    ],
    // 자동 시나리오가 먼저 나와도 사람 시나리오가 만든 화면을 찾는다.
    scenarios: [
      { id: 'S0', name: '기한', steps: [automatic('X')] },
      { id: 'S1', name: '보기', steps: [step('L'), step('V')] },
    ],
  });
  assert.equal(flow.stepScreens['S0#1'], 'sc:P1:E1:view');
  assert.deepEqual(flow.screens.map((s) => s.id), ['sc:P1:E1:list', 'sc:P1:E1:view'], '자동 처리는 화면을 만들지 않는다');
  assert.equal(flow.edges.some((e) => e.label === '항목 기한 종료'), false, '자동 처리는 이동을 만들지 않는다');
  assert.deepEqual(flow.entries, ['sc:P1:E1:list']);
  assert.deepEqual(flow.questions, []);
});

test('F12 단계의 앱에 화면이 없으면 다른 앱의 상세·목록 화면을 쓴다', () => {
  const flow = withAutomatic({
    actions: [
      { id: 'L', name: '항목 목록 보기', entity: 'E1', kind: 'list' },
      { id: 'X', name: '항목 기한 종료', entity: 'E1', kind: 'other' },
    ],
    scenarios: [
      { id: 'S1', name: '보기', steps: [step('L')] },
      { id: 'S0', name: '기한', steps: [automatic('X', 'P2')] },
    ],
  });
  assert.equal(flow.stepScreens['S0#1'], 'sc:P1:E1:list');
});

test('F12 결과를 보여 줄 화면이 없으면 정할 것으로 올린다', () => {
  const flow = withAutomatic({
    actions: [{ id: 'X', name: '항목 기한 종료', entity: 'E1', kind: 'other' }],
    scenarios: [{ id: 'S0', name: '기한', steps: [automatic('X')] }],
  });
  assert.equal(flow.stepScreens['S0#1'], undefined);
  assert.deepEqual(flow.questions.map((q) => q.name), ["'항목 기한 종료'의 결과가 보이는 화면이 없다. 이 개체를 보는 목록이나 상세 동작이 필요하다"]);
  assert.deepEqual(flow.screens, []);
});
