import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSpec, loadSpec } from '../src/model/load.mjs';
import { runPipeline } from '../src/check/run.mjs';

const rulesOf = (report) => report.issues.map((i) => i.rule);
const example = () => loadSpec(new URL('../examples/assignment/spec.json', import.meta.url).pathname).spec;

test('예제는 의도한 빈칸 때문에 착수 불가다', () => {
  const { report } = runPipeline(example());
  assert.equal(report.ready, false);
  assert.ok(rulesOf(report).includes('permission-gap'));
  assert.ok(report.reasons.some((r) => r.startsWith('차단 이슈')));
});

test('예제의 빈칸은 이름으로 설명된다', () => {
  const { report } = runPipeline(example());
  const gap = report.issues.find((i) => i.rule === 'permission-gap');
  assert.deepEqual(gap.targets.map((t) => t.name), ['배정 관리자', '항목 수정하기', '완료']);
});

test('없는 ID를 참조해도 멈추지 않고 차단 이슈를 낸다', () => {
  const { spec } = parseSpec(JSON.stringify({
    meta: { title: 't' },
    requirements: [{ id: 'R1', name: '요구', userType: '오타' }],
    scenarios: [{ id: 'S1', name: '시나리오', requirement: 'R1', steps: [{ userType: 'U9', app: 'P9', action: 'A9' }] }],
  }));
  const { report } = runPipeline(spec);
  const unknown = report.issues.filter((i) => i.rule === 'ref-unknown');
  assert.ok(unknown.length >= 4);
  assert.match(unknown[0].message, /알 수 없는/);
});

test('거의 빈 입력은 착수 불가이며 사유가 있다', () => {
  const { spec } = parseSpec('{"meta":{"title":"빈 기획서"}}');
  const { report } = runPipeline(spec);
  assert.equal(report.ready, false);
  assert.ok(rulesOf(report).includes('problem-source'));
  assert.ok(rulesOf(report).includes('out-of-scope'));
  assert.ok(report.reasons.length > 0);
});

test('도달할 수 없는 상태와 빠져나갈 수 없는 상태를 찾는다', () => {
  const { spec } = parseSpec(JSON.stringify({
    meta: { title: 't' },
    entities: [{ id: 'E1', name: '항목', states: [
      { id: 'A', name: '예정', initial: true }, { id: 'B', name: '진행 중' }, { id: 'C', name: '보류' }, { id: 'D', name: '완료', terminal: true },
    ], transitions: [{ from: 'A', to: 'B', action: 'X' }, { from: 'B', to: 'A', action: 'X' }] }],
    actions: [{ id: 'X', name: '바꾸기', entity: 'E1', kind: 'other' }],
  }));
  const { report } = runPipeline(spec);
  const names = (rule) => report.issues.filter((i) => i.rule === rule).flatMap((i) => i.targets.map((t) => t.name));
  assert.deepEqual(names('state-reachable'), ['보류', '완료']);
  assert.deepEqual(names('state-exit'), ['보류']);
});

test('같은 ID가 두 번 나오면 차단 이슈를 낸다', () => {
  const { spec } = parseSpec(JSON.stringify({ meta: { title: 't' }, userTypes: [{ id: 'X', name: '가' }], apps: [{ id: 'X', name: '나' }] }));
  const issue = runPipeline(spec).report.issues.find((i) => i.rule === 'id-duplicate');
  assert.equal(issue.level, 'block');
});

test('규칙이 없는 입력과 피드백이 없는 비동기 동작은 경고다', () => {
  const { report } = runPipeline(example());
  const inputRule = report.issues.find((i) => i.rule === 'input-rule');
  assert.equal(inputRule.level, 'warn');
  assert.match(inputRule.message, /메모/);
});

test('점수와 착수 판정은 명세 §4의 모양이다', () => {
  const { report } = runPipeline(example());
  for (const key of ['checked', 'passed', 'ratio', 'assumptionRatio', 'blockingQuestions', 'blockIssues', 'warnIssues']) {
    assert.equal(typeof report.score[key], 'number', key);
  }
  assert.ok(report.score.passed < report.score.checked);
  assert.ok(report.score.blockingQuestions >= 1);
});

test('같은 입력이면 보고서가 같다', () => {
  assert.equal(JSON.stringify(runPipeline(example()).report), JSON.stringify(runPipeline(example()).report));
});
