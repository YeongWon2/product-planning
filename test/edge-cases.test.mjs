import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSpec } from '../src/model/load.mjs';
import { runPipeline } from '../src/check/run.mjs';

const withInputs = (inputs) => parseSpec(JSON.stringify({
  meta: { title: 't' },
  entities: [{ id: 'E1', name: '과제' }],
  actions: [{ id: 'A1', name: '과제 부여하기', entity: 'E1', kind: 'create', inputs }],
}));
const casesOf = (inputs) => runPipeline(withInputs(inputs).spec).derived.edgeCases.filter((item) => item.category === '입력').map((item) => [item.input, item.given, item.ok ? 'pass' : 'fail']);

test('텍스트는 필수·최소·최대 글자 수의 경계값을 만든다', () => {
  assert.deepEqual(casesOf([{ name: '과제명', type: 'text', required: true, min: 2, max: 50 }]), [
    ['과제명', '비워 둠', 'fail'],
    ['과제명', '공백만 입력', 'fail'],
    ['과제명', '1자', 'fail'],
    ['과제명', '2자', 'pass'],
    ['과제명', '50자', 'pass'],
    ['과제명', '51자', 'fail'],
  ]);
});

test('파일은 개수·파일당 용량·형식의 경계값을 만든다', () => {
  assert.deepEqual(casesOf([{ name: '자료 파일', type: 'file', maxCount: 5, maxSizeMB: 300, formats: ['jpg', 'pdf'] }]), [
    ['자료 파일', '비워 둠', 'pass'],
    ['자료 파일', '5개', 'pass'],
    ['자료 파일', '6개', 'fail'],
    ['자료 파일', '파일 하나가 300MB', 'pass'],
    ['자료 파일', '파일 하나가 300MB 초과', 'fail'],
    ['자료 파일', '허용하지 않는 형식 (jpg·pdf 외)', 'fail'],
  ]);
});

test('선택·여러 개 선택·날짜·주소·추가 조건도 경계값을 만든다', () => {
  assert.deepEqual(casesOf([
    { name: '인증 방식', type: 'select', required: true, options: ['인증 필요', '인증 불필요'] },
    { name: '대상 선수', type: 'multiSelect', required: true, max: 30 },
    { name: '시작일', type: 'date', required: true, min: '오늘', rules: ['팀 목표 기간 안'] },
    { name: '외부 링크', type: 'url' },
  ]), [
    ['인증 방식', '비워 둠', 'fail'],
    ['인증 방식', "'인증 필요' 선택", 'pass'],
    ['인증 방식', '목록에 없는 값', 'fail'],
    ['대상 선수', '비워 둠', 'fail'],
    ['대상 선수', '1개', 'pass'],
    ['대상 선수', '30개', 'pass'],
    ['대상 선수', '31개', 'fail'],
    ['시작일', '비워 둠', 'fail'],
    ['시작일', '오늘보다 이전', 'fail'],
    ['시작일', '오늘', 'pass'],
    ['시작일', "'팀 목표 기간 안'을 어김", 'fail'],
    ['외부 링크', '비워 둠', 'pass'],
    ['외부 링크', '주소 형식이 아님', 'fail'],
  ]);
});

test('형식(type)이 없거나 틀린 입력은 검증을 알 수 없다고 경고하고, 틀린 값은 형식 오류로 보고한다', () => {
  const { spec, problems } = withInputs([{ name: '메모', rules: ['최대 100자'] }, { name: '기간', type: '달력' }, { name: '수', type: 'number', min: '둘' }]);
  assert.ok(problems.some((p) => p.path === 'actions[0].inputs[1].type'));
  assert.ok(problems.some((p) => p.path === 'actions[0].inputs[2].min'));
  const warned = runPipeline(spec, problems).report.issues.filter((i) => i.rule === 'input-rule').map((i) => i.message);
  assert.ok(warned.some((m) => /'메모'.*형식/.test(m)), warned.join('\n'));
});

test('선택 입력에 목록이 없으면 경고한다', () => {
  const warned = runPipeline(withInputs([{ name: '인증 방식', type: 'select', required: true }]).spec).report.issues.filter((i) => i.rule === 'input-rule');
  assert.match(warned[0].message, /목록/);
});

test('기간은 짧음·김으로, 동작 설명(note)은 경계값 없이, 추가 조건은 받침에 맞춰 쓴다', () => {
  assert.deepEqual(casesOf([
    { name: '기한', type: 'period', required: true, min: '1개월', max: '1년', options: ['1개월', '3개월'] },
    { name: '외부 링크', type: 'url', note: '새 탭으로 연다' },
    { name: '인증 미디어', type: 'file', rules: ['인증 필요 과제면 필수'] },
  ]), [
    ['기한', '비워 둠', 'fail'],
    ['기한', '1개월보다 짧음', 'fail'],
    ['기한', '1개월', 'pass'],
    ['기한', '1년', 'pass'],
    ['기한', '1년보다 김', 'fail'],
    ['기한', "'1개월' 선택", 'pass'],
    ['외부 링크', '비워 둠', 'pass'],
    ['외부 링크', '주소 형식이 아님', 'fail'],
    ['인증 미디어', '비워 둠', 'pass'],
    ['인증 미디어', "'인증 필요 과제면 필수'를 어김", 'fail'],
  ]);
});

// 입력 말고도 개발자가 알아야 하는 경우들. 기능마다 권한·상태·확인 창·서버·화면·다른 앱·자동 처리에서 나온다.
const full = parseSpec(JSON.stringify({
  meta: { title: 't' },
  userTypes: [{ id: 'U1', name: '코치' }, { id: 'U2', name: '선수' }, { id: 'U9', name: '시스템', automatic: true }],
  apps: [{ id: 'P1', name: '코치 웹' }, { id: 'P2', name: '선수 앱' }],
  entities: [{ id: 'E1', name: '과제', states: [{ id: 'ON', name: '진행 중', initial: true }, { id: 'OFF', name: '조기 마감', terminal: true }], transitions: [{ from: 'ON', to: 'OFF', action: 'CLOSE' }, { from: 'ON', to: 'OFF', action: 'EXPIRE' }] }],
  actions: [
    { id: 'LIST', name: '과제 목록 보기', entity: 'E1', kind: 'list' },
    { id: 'CLOSE', name: '과제 조기 마감하기', entity: 'E1', kind: 'other', async: true, irreversible: true,
      failures: [{ name: '다른 코치의 과제', message: '다른 코치가 부여한 과제는 마감할 수 없습니다' }],
      crossApp: [{ app: 'P2', userType: 'U2', effect: '마감된 과제가 목록에서 사라진다' }] },
    { id: 'EXPIRE', name: '과제 기한 종료', entity: 'E1', kind: 'other' },
  ],
  permissions: [
    { userType: 'U1', action: 'LIST', value: 'allow' }, { userType: 'U2', action: 'LIST', value: 'allow' },
    { userType: 'U1', action: 'CLOSE', state: 'ON', value: 'allow' }, { userType: 'U1', action: 'CLOSE', state: 'OFF', value: 'hide' },
    { userType: 'U2', action: 'CLOSE', state: 'ON', value: 'deny' },
  ],
  scenarios: [{ id: 'S0', name: '기한', steps: [{ userType: 'U9', app: 'P1', action: 'EXPIRE' }] }],
})).spec;
const of = (action) => runPipeline(full).derived.edgeCases.filter((item) => item.action === action).map((item) => [item.category, item.given, item.expect]);

test('권한·상태·확인 창·서버·다른 앱에서 기능마다 엣지 케이스를 뽑는다', () => {
  assert.deepEqual(of('CLOSE'), [
    ['권한', "'코치'가 '조기 마감' 상태에서 시도", '보이지 않음'],
    ['권한', "'선수'가 '진행 중' 상태에서 시도", '권한 없음 안내'],
    ['권한', "'선수'가 '조기 마감' 상태에서 시도", '정할 것 (동작 가능표 빈칸)'],
    ['상태', "'진행 중' 상태에서 마침", "'조기 마감' 상태가 됨"],
    ['확인 창', '확인 창에서 취소', '아무것도 바뀌지 않음'],
    ['서버', '다른 코치의 과제', '다른 코치가 부여한 과제는 마감할 수 없습니다'],
    ['서버', '처리 중 다시 누름', '요청을 한 번만 보냄'],
    ['다른 앱', "'선수 앱'의 '선수'", '마감된 과제가 목록에서 사라진다'],
  ]);
});

test('목록·상세는 프로필의 화면 상태마다, 자동 처리는 조건 경계마다 엣지 케이스를 뽑는다', () => {
  assert.deepEqual(of('LIST'), [
    ['화면', '불러오는 중', '불러오는 중 표시'],
    ['화면', '빈 화면', '비어 있음 안내'],
    ['화면', '오류', '오류 안내와 다시 시도'],
    ['화면', '권한 없음', '권한 없음 안내'],
    ['화면', '보기 전용', '고치는 요소를 숨김'],
  ]);
  assert.deepEqual(of('EXPIRE'), [
    ['자동', "'진행 중'에서 조건 충족 직전", "'진행 중' 유지"],
    ['자동', "'진행 중'에서 조건 충족 순간", "'조기 마감' 상태가 됨"],
  ]);
});
