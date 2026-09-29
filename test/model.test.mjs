import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSpec, loadSpec } from '../src/model/load.mjs';
import { buildIndex } from '../src/model/index.mjs';
import { josa, quote } from '../src/model/labels.mjs';

test('예제 원천을 읽고 기본 프로필을 채운다', () => {
  const { spec, error } = loadSpec(new URL('../examples/assignment/spec.json', import.meta.url).pathname);
  assert.equal(error, null);
  assert.equal(spec.meta.profile.modalMaxInputs, 3);
  assert.ok(spec.actions.length > 0);
});

test('누락된 배열은 빈 배열로 채운다', () => {
  const { spec } = parseSpec('{"meta":{"title":"빈 기획서"}}');
  for (const key of ['userTypes', 'apps', 'requirements', 'entities', 'actions', 'permissions', 'scenarios', 'acceptance', 'events', 'questions', 'decisions', 'flowOverrides']) {
    assert.deepEqual(spec[key], [], key);
  }
  assert.deepEqual(spec.summary.outOfScope, []);
});

test('JSON 파싱 실패는 한글 오류 문장으로 돌려준다', () => {
  const { spec, error } = parseSpec('{ 깨진');
  assert.equal(spec, null);
  assert.match(error, /JSON/);
});

test('색인은 상태까지 찾고 중복 ID를 모은다', () => {
  const { spec } = parseSpec(JSON.stringify({
    meta: { title: 't' },
    userTypes: [{ id: 'X', name: '가' }],
    apps: [{ id: 'X', name: '나' }],
    entities: [{ id: 'E1', name: '항목', states: [{ id: 'ST1', name: '예정' }] }],
  }));
  const index = buildIndex(spec);
  assert.equal(index.get('ST1').kind, 'state');
  assert.equal(index.name('E1'), '항목');
  assert.equal(index.get('X').kind, 'userType');
  assert.deepEqual(index.duplicates, [{ id: 'X', kinds: ['userType', 'app'] }]);
  assert.equal(index.name('없음'), '(알 수 없음: 없음)');
});

test('조사는 받침에 맞춘다', () => {
  assert.equal(josa('관리자', '이/가'), '관리자가');
  assert.equal(josa('항목', '을/를'), '항목을');
  assert.equal(josa('사용자', '은/는'), '사용자는');
  assert.equal(josa('목록', '으로/로'), '목록으로');
  assert.equal(josa('파일', '으로/로'), '파일로');
  assert.equal(quote('항목 고정하기', '을/를'), "'항목 고정하기'를");
  assert.equal(quote('완료'), "'완료'");
});
