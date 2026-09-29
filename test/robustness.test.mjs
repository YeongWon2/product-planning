import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSpec } from '../src/model/load.mjs';
import { runPipeline } from '../src/check/run.mjs';
import { renderHtml } from '../src/render/html.mjs';

// 최종 리뷰에서 나온 입력들. 원천 → 검사 → HTML 끝까지 통과시킨다.
const exampleText = readFileSync(new URL('../examples/assignment/spec.json', import.meta.url), 'utf8');

function pipelineOf(mutate) {
  const raw = JSON.parse(exampleText);
  mutate(raw);
  const { spec, problems } = parseSpec(JSON.stringify(raw));
  const result = runPipeline(spec, problems);
  return { ...result, html: renderHtml(result) };
}

const readyExample = (raw) => {
  raw.permissions.push({ userType: 'U1', action: 'AC5', state: 'ST2', value: 'hide' });
};
const rulesOf = (report) => report.issues.map((item) => item.rule);

test('준비된 예제는 착수 가능하다 (아래 테스트들의 기준점)', () => {
  const { report } = pipelineOf(readyExample);
  assert.equal(report.ready, true, JSON.stringify(report.issues));
});

test('사용자 유형·동작·개체 ID가 겹쳐도 HTML까지 만들어지고 칸이 두 배가 되지 않는다', () => {
  for (const duplicate of [
    (raw) => raw.userTypes.push({ id: 'U1', name: '둘째' }),
    (raw) => raw.actions.push({ ...raw.actions[2], name: '복제된 동작' }),
    (raw) => raw.entities.push({ id: 'E1', name: '다른 개체', states: [{ id: 'X1', name: '다른 상태', initial: true, terminal: true }], transitions: [] }),
  ]) {
    const { report, derived, html } = pipelineOf((raw) => { readyExample(raw); duplicate(raw); });
    assert.ok(rulesOf(report).includes('id-duplicate'));
    assert.equal(derived.permissionCells.length, 16);
    assert.match(html, /착수 불가/);
  }
});

test('형식이 틀린 필드는 조용히 사라지지 않고 차단 이슈가 된다', () => {
  const { report } = pipelineOf((raw) => {
    readyExample(raw);
    raw.actions[2].inputs = '제목, 담당자';
    raw.actions[2].crossApp = { app: 'P2', userType: 'U2', effect: '새 항목 알림' };
    raw.actions[3].irreversible = 'true';
    raw.scenarios[0].steps = { userType: 'U1', app: 'P1', action: 'AC1' };
  });
  assert.equal(report.ready, false);
  const messages = report.issues.filter((item) => item.rule === 'shape').map((item) => item.message).join('\n');
  assert.match(messages, /actions\[2\]\.inputs/);
  assert.match(messages, /actions\[2\]\.crossApp/);
  assert.match(messages, /actions\[3\]\.irreversible/);
  assert.match(messages, /scenarios\[0\]\.steps/);
});

test('필수 영역이 비었거나 단계 없는 시나리오는 착수 가능이 아니다', () => {
  const { spec, problems } = parseSpec(JSON.stringify({
    meta: { title: '준비됨' },
    summary: { problem: { text: '문제', source: { kind: 'doc' } }, outOfScope: ['x'] },
  }));
  const bare = runPipeline(spec, problems).report;
  assert.equal(bare.ready, false);
  assert.ok(rulesOf(bare).includes('required'));

  const { report } = pipelineOf((raw) => { readyExample(raw); raw.scenarios[1].steps = []; });
  assert.ok(rulesOf(report).includes('scenario-steps'));
  assert.equal(report.ready, false);
});

test('잘못된 프로필 값은 멈추지 않고 기본값을 쓰며 이슈를 낸다', () => {
  for (const profile of [{ screenStates: null }, { screenStates: '불러오는 중, 오류' }, { modalMaxInputs: '세 개' }]) {
    const { spec, report, derived } = pipelineOf((raw) => { readyExample(raw); raw.meta.profile = profile; });
    assert.ok(rulesOf(report).includes('shape'), JSON.stringify(profile));
    assert.equal(spec.meta.profile.modalMaxInputs, 3);
    assert.deepEqual(derived.screens[0].states, ['불러오는 중', '빈 화면', '오류', '권한 없음', '보기 전용']);
  }
});

test('적용되지 않은 흐름 바꾸기는 경고하고, 허용되지 않은 값은 적용하지 않는다', () => {
  const { report, derived } = pipelineOf((raw) => {
    readyExample(raw);
    raw.decisions = [{ id: 'DX', name: '목록은 모달로 한다' }];
    raw.flowOverrides = [
      { action: 'AC1', as: 'modal', decision: 'DX' },
      { action: 'AC4', as: 'screen', decision: 'DX' },
      { action: 'AC3', as: 'popup', decision: 'DX' },
    ];
  });
  const warnings = report.issues.filter((item) => item.rule === 'flow-override');
  assert.equal(warnings.length, 2);
  assert.ok(warnings.every((item) => item.level === 'warn'));
  assert.ok(report.issues.some((item) => item.rule === 'shape' && /flowOverrides\[2\]\.as/.test(item.message)));
  assert.equal(derived.screens.find((screen) => screen.id === 'sc:P1:E1:modal:AC3').rule, 'F3');
});

test('사용자 유형의 automatic이 true/false가 아니면 형식 오류로 보고한다', () => {
  const { problems, spec } = parseSpec(JSON.stringify({ userTypes: [{ id: 'U9', name: '시스템', automatic: '예' }] }));
  assert.ok(problems.some((p) => p.path === 'userTypes[0].automatic'), JSON.stringify(problems));
  assert.equal(spec.userTypes[0].automatic, undefined);
});
