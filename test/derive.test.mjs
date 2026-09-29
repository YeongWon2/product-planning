import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSpec } from '../src/model/load.mjs';
import { buildIndex } from '../src/model/index.mjs';
import { permissionGrid } from '../src/derive/permissions.mjs';
import { deriveQuestions } from '../src/derive/questions.mjs';
import { deriveAcceptanceDrafts } from '../src/derive/acceptance.mjs';

const base = {
  meta: { title: 't' },
  userTypes: [{ id: 'U1', name: '관리자' }],
  entities: [{ id: 'E1', name: '항목', states: [{ id: 'ST1', name: '예정', initial: true }, { id: 'ST2', name: '완료', terminal: true }], transitions: [{ from: 'ST1', to: 'ST2', action: 'A2' }] }],
  actions: [{ id: 'A1', name: '항목 수정하기', entity: 'E1', kind: 'update' }, { id: 'A2', name: '항목 마감하기', entity: 'E1', kind: 'other' }],
  permissions: [
    { userType: 'U1', action: 'A1', state: 'ST1', value: 'allow' },
    { userType: 'U1', action: 'A1', state: 'ST2', value: 'hide' },
    { userType: 'U1', action: 'A2', state: 'ST1', value: 'allow' },
  ],
  scenarios: [{ id: 'S1', name: '마감', requirement: 'R1', steps: [{ userType: 'U1', app: 'P1', action: 'A2' }] }],
};

function setup(overrides = {}) {
  const { spec } = parseSpec(JSON.stringify({ ...base, ...overrides }));
  return { spec, index: buildIndex(spec) };
}

test('사용자 유형 × 동작 × 상태 칸을 만들고 빈칸을 찾는다', () => {
  const { spec, index } = setup();
  const { cells, gaps } = permissionGrid(spec, index);
  assert.equal(cells.length, 4);
  assert.deepEqual(gaps, [{ userType: 'U1', action: 'A2', state: 'ST2' }]);
});

test('상태 없는 개체는 상태 없이 칸을 만든다', () => {
  const { spec, index } = setup({
    entities: [{ id: 'E1', name: '설정' }],
    actions: [{ id: 'A1', name: '설정 바꾸기', entity: 'E1', kind: 'update' }],
    permissions: [],
  });
  assert.deepEqual(permissionGrid(spec, index).gaps, [{ userType: 'U1', action: 'A1', state: null }]);
});

test('목록 보기와 만들기는 상태가 있는 개체에서도 사용자 유형마다 한 칸이다', () => {
  const { spec, index } = setup({
    actions: [{ id: 'L', name: '항목 목록 보기', entity: 'E1', kind: 'list' }, { id: 'C', name: '항목 만들기', entity: 'E1', kind: 'create' }],
    permissions: [{ userType: 'U1', action: 'L', value: 'allow' }],
  });
  const { cells, gaps } = permissionGrid(spec, index);
  assert.equal(cells.length, 2);
  assert.deepEqual(gaps, [{ userType: 'U1', action: 'C', state: null }]);
});

test('빈칸은 사람이 읽는 질문이 된다', () => {
  const { spec, index } = setup();
  const { gaps } = permissionGrid(spec, index);
  const [question] = deriveQuestions(spec, index, { gaps, flowQuestions: [] });
  assert.equal(question.name, "'관리자'는 '완료' 상태의 '항목'에 '항목 마감하기'를 할 수 있는가?");
  assert.equal(question.owner, '기획');
  assert.equal(question.blocking, true);
  assert.equal(question.auto, true);
});

test('흐름에서 나온 질문은 빈칸 질문 뒤에 붙는다', () => {
  const { spec, index } = setup();
  const questions = deriveQuestions(spec, index, { gaps: [], flowQuestions: [{ id: 'auto:flow:x', name: '흐름 질문' }] });
  assert.deepEqual(questions, [{ id: 'auto:flow:x', name: '흐름 질문', owner: '기획', blocking: true, auto: true }]);
});

test('허용이 아닌 칸과 전이에서 완료 조건 초안을 만든다', () => {
  const { spec, index } = setup();
  const drafts = deriveAcceptanceDrafts(spec, index, permissionGrid(spec, index).cells);
  const hidden = drafts.find((d) => d.from === 'permission');
  assert.equal(hidden.situation, "'관리자'가 '완료' 상태의 '항목'을 볼 때");
  assert.equal(hidden.action, "'항목 수정하기'를 하려 하면");
  assert.equal(hidden.result, '해당 버튼이 보이지 않는다');
  const transition = drafts.find((d) => d.from === 'transition');
  assert.equal(transition.situation, "'항목'이 '예정' 상태일 때");
  assert.equal(transition.result, "'완료' 상태가 된다");
  assert.equal(transition.requirement, 'R1');
});
