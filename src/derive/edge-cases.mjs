import { LABELS, WORDING, quote } from '../model/labels.mjs';

// 기능마다 개발자·QA가 알아야 하는 경우를 모델에서 모두 뽑는다. 사람이 따로 적지 않는다.
//   입력    검증 형식(type)의 경계값
//   권한    동작 가능표에서 '가능'이 아닌 칸
//   상태    상태 전이 (어느 상태에서 마치면 어느 상태가 되나)
//   확인 창 되돌릴 수 없는 동작의 취소
//   서버    실패 안내마다, 그리고 처리 중 다시 누름
//   화면    목록·상세의 프로필 화면 상태 (불러오는 중·빈 화면·오류·권한 없음·보기 전용)
//   다른 앱 다른 앱에 주는 영향
//   자동    규칙으로 일어나는 전이의 조건 경계
// 한 건은 { action, category, input, given(상황), ok(정상 경로인가), expect(기대 결과) } 다.

const count = (n, unit) => `${n}${unit}`;

function inputCases(input) {
  const cases = [];
  const add = (given, ok) => cases.push({ given, ok });
  const required = input.required === true;
  add('비워 둠', !required);

  switch (input.type) {
    case 'text':
      if (required) add('공백만 입력', false);
      if (Number.isFinite(input.min) && input.min > 1) add(count(input.min - 1, '자'), false);
      if (Number.isFinite(input.min)) add(count(input.min, '자'), true);
      if (Number.isFinite(input.max)) { add(count(input.max, '자'), true); add(count(input.max + 1, '자'), false); }
      break;
    case 'number':
      if (Number.isFinite(input.min)) { add(`${input.min - 1}`, false); add(`${input.min}`, true); }
      if (Number.isFinite(input.max)) { add(`${input.max}`, true); add(`${input.max + 1}`, false); }
      add('숫자가 아닌 값', false);
      break;
    case 'multiSelect': {
      const min = Number.isFinite(input.min) ? input.min : required ? 1 : null;
      if (min !== null && min > 1) add(count(min - 1, '개'), false);
      if (min !== null) add(count(min, '개'), true);
      if (Number.isFinite(input.max)) { add(count(input.max, '개'), true); add(count(input.max + 1, '개'), false); }
      break;
    }
    case 'select':
      if (input.options?.length > 0) add(`'${input.options[0]}' 선택`, true);
      add(typeof input.optionsFrom === 'string' ? `${input.optionsFrom}에 없는 값` : '목록에 없는 값', false);
      break;
    case 'date':
      if (input.min !== undefined) { add(`${input.min}보다 이전`, false); add(`${input.min}`, true); }
      if (input.max !== undefined) { add(`${input.max}`, true); add(`${input.max}보다 이후`, false); }
      break;
    case 'period':
      if (input.min !== undefined) { add(`${input.min}보다 짧음`, false); add(`${input.min}`, true); }
      if (input.max !== undefined) { add(`${input.max}`, true); add(`${input.max}보다 김`, false); }
      if (input.options?.length > 0) add(`'${input.options[0]}' 선택`, true);
      break;
    case 'file':
      if (Number.isFinite(input.maxCount)) { add(count(input.maxCount, '개'), true); add(count(input.maxCount + 1, '개'), false); }
      if (Number.isFinite(input.maxSizeMB)) { add(`파일 하나가 ${input.maxSizeMB}MB`, true); add(`파일 하나가 ${input.maxSizeMB}MB 초과`, false); }
      if (Number.isFinite(input.totalSizeMB)) add(`합계 ${input.totalSizeMB}MB 초과`, false);
      if (input.formats?.length > 0) add(`허용하지 않는 형식 (${input.formats.join('·')} 외)`, false);
      break;
    case 'url':
      add('주소 형식이 아님', false);
      break;
    default:
      break;
  }
  // note는 동작 설명이라 경계값을 만들지 않는다. rules는 형식으로 못 적은 추가 조건이다.
  for (const rule of input.rules) add(`${quote(rule, '을/를')} 어김`, false);
  return cases;
}

const PERMISSION_EXPECT = { hide: '보이지 않음', disable: '비활성으로 보이고 누를 수 없음', deny: '권한 없음 안내' };
const withText = (base, text) => (typeof text === 'string' && text !== '' ? `${base}: ${text}` : base);
const SCREEN_EXPECT = {
  '불러오는 중': '불러오는 중 표시', '빈 화면': '비어 있음 안내', '오류': '오류 안내와 다시 시도', '권한 없음': '권한 없음 안내', '보기 전용': '고치는 요소를 숨김',
};

export function deriveEdgeCases(spec, index, cells) {
  const out = [];
  const isAutomatic = (userType) => index.get(userType)?.kind === 'userType' && index.get(userType).item.automatic === true;
  const automaticActions = new Set(spec.scenarios.flatMap((scenario) => scenario.steps).filter((step) => isAutomatic(step.userType)).map((step) => step.action));
  const nameOf = (id) => (index.has(id) ? index.name(id) : String(id));

  for (const action of spec.actions) {
    const push = (category, given, ok, expect, input = null) => out.push({ action: action.id, category, input, given, ok, expect });
    const transitions = spec.entities.flatMap((entity) => entity.transitions.filter((transition) => transition.action === action.id));

    if (automaticActions.has(action.id)) {
      for (const transition of transitions) {
        push('자동', `${quote(nameOf(transition.from))}에서 조건 충족 직전`, true, `${quote(nameOf(transition.from))} 유지`);
        push('자동', `${quote(nameOf(transition.from))}에서 조건 충족 순간`, true, `${quote(nameOf(transition.to))} 상태가 됨`);
      }
      continue;
    }

    for (const input of action.inputs) {
      if (input.type === undefined && input.rules.length === 0) continue;
      const name = typeof input.name === 'string' ? input.name : '';
      const error = input.error ?? spec.wording.inputError;
      for (const { given, ok } of inputCases(input)) push('입력', given, ok, ok ? '통과' : (typeof error === 'string' && error !== '' ? `${quote(name)} 오류 안내: ${error}` : `${quote(name)} 오류 안내, 저장하지 않음`), name);
    }

    for (const cell of cells.filter((item) => item.action === action.id && item.value !== 'allow' && !isAutomatic(item.userType))) {
      const where = cell.state === null ? '' : `${quote(nameOf(cell.state))} 상태에서 `;
      const expect = cell.value === null ? '정할 것 (동작 가능표 빈칸)' : cell.value === 'deny' ? withText('권한 없음 안내', action.denied ?? spec.wording.denied) : PERMISSION_EXPECT[cell.value] ?? LABELS.permission[cell.value];
      push('권한', `${quote(nameOf(cell.userType), '이/가')} ${where}시도`, false, expect);
    }

    for (const transition of transitions) push('상태', `${quote(nameOf(transition.from))} 상태에서 마침`, true, `${quote(nameOf(transition.to))} 상태가 됨`);

    if (action.irreversible === true) push('확인 창', '확인 창에서 취소', false, '아무것도 바뀌지 않음');

    if (action.async === true) {
      const named = new Set(action.failures.map((failure) => failure.name));
      for (const failure of action.failures) push('서버', typeof failure.name === 'string' ? failure.name : '실패', false, typeof failure.message === 'string' ? failure.message : '');
      // 기능이 따로 적지 않은 불특정 오류는 공통 문구로 처리한다.
      for (const key of ['network', 'unknown', 'sessionExpired']) {
        if (!named.has(WORDING[key]) && typeof spec.wording[key] === 'string') push('서버', WORDING[key], false, spec.wording[key]);
      }
      push('서버', '처리 중 다시 누름', false, '요청을 한 번만 보냄');
    }

    if (action.kind === 'list' || action.kind === 'view') {
      const screenText = { '빈 화면': action.empty ?? spec.wording.empty, '오류': spec.wording.loadError, '권한 없음': action.denied ?? spec.wording.denied };
      for (const state of spec.meta.profile.screenStates) push('화면', state, true, withText(SCREEN_EXPECT[state] ?? `${state} 표시`, screenText[state]));
    }

    for (const target of action.crossApp) {
      const who = [target.app, target.userType].filter((id) => index.has(id)).map((id) => quote(nameOf(id)));
      push('다른 앱', who.length === 2 ? `${who[0]}의 ${who[1]}` : who.join(' '), true, typeof target.effect === 'string' ? target.effect : '');
    }
  }
  return out;
}
