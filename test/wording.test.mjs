import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSpec } from '../src/model/load.mjs';
import { runPipeline } from '../src/check/run.mjs';
import { renderPages } from '../src/render/html.mjs';

const WORDING = {
  inputError: '입력 내용을 확인해 주세요', denied: '권한이 없습니다', empty: '아직 항목이 없습니다', loadError: '불러오지 못했습니다. 다시 시도해 주세요',
  network: '네트워크 이슈가 발생했습니다', unknown: '문제가 생겼습니다. 잠시 후 다시 시도해 주세요', sessionExpired: '다시 로그인해 주세요', confirmOk: '확인', confirmCancel: '취소',
};
const base = (extra) => parseSpec(JSON.stringify({
  meta: { title: 't' },
  userTypes: [{ id: 'U1', name: '코치' }, { id: 'U2', name: '선수' }],
  apps: [{ id: 'P1', name: '코치 웹' }, { id: 'P2', name: '선수 앱' }],
  entities: [{ id: 'E1', name: '과제', states: [{ id: 'ON', name: '진행 중', initial: true }, { id: 'OFF', name: '조기 마감', terminal: true }], transitions: [{ from: 'ON', to: 'OFF', action: 'CLOSE' }] }],
  actions: [
    { id: 'LIST', name: '과제 목록 보기', entity: 'E1', kind: 'list' },
    { id: 'CLOSE', name: '과제 조기 마감하기', entity: 'E1', kind: 'other', async: true, irreversible: true,
      inputs: [{ name: '마감 사유', type: 'text', max: 200, error: '200자까지 적을 수 있어요' }],
      success: '과제를 마감했습니다', failures: [{ name: '통신 실패', message: '네트워크 이슈가 발생했습니다' }],
      crossApp: [{ app: 'P2', userType: 'U2', effect: '마감된 과제가 목록에서 사라진다' }] },
  ],
  permissions: [{ userType: 'U1', action: 'LIST', value: 'allow' }, { userType: 'U2', action: 'LIST', value: 'allow' }, { userType: 'U1', action: 'CLOSE', state: 'ON', value: 'allow' }, { userType: 'U1', action: 'CLOSE', state: 'OFF', value: 'hide' }, { userType: 'U2', action: 'CLOSE', state: 'ON', value: 'deny' }, { userType: 'U2', action: 'CLOSE', state: 'OFF', value: 'deny' }],
  ...extra,
}));
const rules = (spec, problems) => runPipeline(spec, problems).report.issues.filter((i) => i.rule === 'wording').map((i) => i.message);

test('공통 문구·확인 창 문구·다른 앱 알림 문구가 없으면 경고한다', () => {
  const { spec } = base({});
  const found = rules(spec);
  assert.ok(found.some((m) => /공통 문구.*inputError/.test(m)), found.join('\n'));
  assert.ok(found.some((m) => /'과제 조기 마감하기'.*확인 창 문구/.test(m)));
  assert.ok(found.some((m) => /'과제 조기 마감하기'.*'선수 앱'.*알림 문구/.test(m)));
});

test('문구를 다 채우면 경고가 없고, 형식이 틀리면 형식 오류로 보고한다', () => {
  const full = base({
    wording: WORDING,
    actions: [
      { id: 'LIST', name: '과제 목록 보기', entity: 'E1', kind: 'list', empty: '아직 과제가 없어요' },
      { id: 'CLOSE', name: '과제 조기 마감하기', entity: 'E1', kind: 'other', async: true, irreversible: true,
        inputs: [{ name: '마감 사유', type: 'text', max: 200, error: '200자까지 적을 수 있어요' }],
        confirm: { message: '마감하면 선수는 더 제출할 수 없습니다. 마감할까요?', ok: '마감', cancel: '취소' },
        denied: '내가 부여한 과제만 마감할 수 있어요',
        success: '과제를 마감했습니다', failures: [{ name: '통신 실패', message: '네트워크 이슈가 발생했습니다' }],
        crossApp: [{ app: 'P2', userType: 'U2', effect: '마감된 과제가 목록에서 사라진다', message: '코치가 과제를 마감했어요' }] },
    ],
  });
  assert.deepEqual(rules(full.spec, full.problems), []);
  const bad = base({ wording: { inputError: 3 }, actions: [{ id: 'X', name: 'x', entity: 'E1', kind: 'other', irreversible: true, confirm: '문자열', inputs: [{ name: 'a', type: 'text', error: 1 }], crossApp: [{ app: 'P2', message: 2 }] }] });
  const paths = bad.problems.map((p) => p.path);
  for (const path of ['wording.inputError', 'actions[0].confirm', 'actions[0].inputs[0].error', 'actions[0].crossApp[0].message']) assert.ok(paths.includes(path), path);
});

test('기능명세서는 공통 문구를 한 번 적고, 기능마다 덮어쓴 문구와 확인 창 문구만 보인다', () => {
  const { spec } = base({ wording: WORDING, actions: [
    { id: 'LIST', name: '과제 목록 보기', entity: 'E1', kind: 'list', empty: '아직 과제가 없어요' },
    { id: 'CLOSE', name: '과제 조기 마감하기', entity: 'E1', kind: 'other', async: true, irreversible: true,
      inputs: [{ name: '마감 사유', type: 'text', max: 200, error: '200자까지 적을 수 있어요' }],
      confirm: { message: '마감하면 선수는 더 제출할 수 없습니다. 마감할까요?', ok: '마감', cancel: '취소' }, denied: '내가 부여한 과제만 마감할 수 있어요',
      success: '과제를 마감했습니다', failures: [], crossApp: [{ app: 'P2', userType: 'U2', effect: '목록에서 사라진다', message: '코치가 과제를 마감했어요' }] },
  ] });
  const html = renderPages(runPipeline(spec), { name: 't' })['t.spec.html'];
  const text = html.split('data-part="spec"')[1].replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<svg[\s\S]*?<\/svg>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/\s+/g, ' ');
  assert.match(text, /공통 문구 .*입력 오류 입력 내용을 확인해 주세요.*권한 없음 권한이 없습니다.*빈 화면 아직 항목이 없습니다.*통신 실패 네트워크 이슈가 발생했습니다.*로그인 만료 다시 로그인해 주세요/);
  assert.match(text, /빈 화면 아직 과제가 없어요/, '덮어쓴 빈 화면 문구');
  assert.match(text, /마감 사유 텍스트 아니오 최대 200자 200자까지 적을 수 있어요/, '입력 오류 문구 열');
  assert.match(text, /확인 창 마감하면 선수는 더 제출할 수 없습니다\. 마감할까요\? \[마감 \/ 취소\]/);
  assert.match(text, /권한 없음 내가 부여한 과제만 마감할 수 있어요/);
  assert.match(text, /다른 앱 선수 앱 선수: 목록에서 사라진다 — 알림 "코치가 과제를 마감했어요"/);
});

test('엣지 케이스의 기대 결과는 정해진 문구를 쓴다', () => {
  const { spec } = base({ wording: WORDING, actions: [
    { id: 'LIST', name: '과제 목록 보기', entity: 'E1', kind: 'list', empty: '아직 과제가 없어요' },
    { id: 'CLOSE', name: '과제 조기 마감하기', entity: 'E1', kind: 'other', irreversible: true, inputs: [{ name: '마감 사유', type: 'text', max: 200, error: '200자까지 적을 수 있어요' }], confirm: { message: '마감할까요?' }, denied: '내가 부여한 과제만 마감할 수 있어요' },
  ] });
  const cases = runPipeline(spec).derived.edgeCases;
  const find = (action, given) => cases.find((c) => c.action === action && c.given === given).expect;
  assert.equal(find('CLOSE', '201자'), "'마감 사유' 오류 안내: 200자까지 적을 수 있어요");
  assert.equal(find('CLOSE', "'선수'가 '진행 중' 상태에서 시도"), '권한 없음 안내: 내가 부여한 과제만 마감할 수 있어요');
  assert.equal(find('LIST', '빈 화면'), '비어 있음 안내: 아직 과제가 없어요');
  assert.equal(find('LIST', '오류'), '오류 안내와 다시 시도: 불러오지 못했습니다. 다시 시도해 주세요');
});
