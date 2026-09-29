// 공통 문구의 종류. 기능마다 다르지 않은 안내는 spec.wording에 한 번만 적는다.
export const WORDING = Object.freeze({
  inputError: '입력 오류', denied: '권한 없음', empty: '빈 화면', loadError: '불러오기 오류',
  network: '통신 실패', unknown: '알 수 없는 오류', sessionExpired: '로그인 만료', confirmOk: '확인 단추', confirmCancel: '취소 단추',
});

// 서비스 구성의 값.
export const PRODUCT = Object.freeze({
  kind: { service: '새 서비스', feature: '기존 서비스에 기능 추가', project: '기간이 정해진 프로젝트' },
  system: { service: '서비스', api: 'API 서버', external: '외부 시스템' },
  platform: { web: '웹', ios: 'iOS', android: 'Android', desktop: '데스크톱', 'mobile-web': '모바일 웹' },
});

export const LABELS = Object.freeze({
  permission: { allow: '허용', hide: '숨김', disable: '비활성', deny: '불가' },
  priority: { must: '필수', should: '권장', could: '선택' },
  scenarioKind: { main: '기본 흐름', alt: '대안 흐름', exception: '예외 흐름' },
  screenType: { screen: '화면', modal: '모달', confirm: '확인 창', notification: '알림' },
  source: { code: '코드', schema: '스키마', doc: '문서', data: '데이터', reference: '레퍼런스', decision: '결정', assumption: '가정' },
  actionKind: { list: '목록', view: '상세', create: '만들기', update: '수정', delete: '삭제', other: '기타' },
  kind: {
    userType: '사용자 유형', app: '앱', requirement: '요구사항', entity: '개체', state: '상태', action: '동작',
    scenario: '시나리오', acceptance: '완료 조건', metric: '지표', event: '이벤트', question: '정할 것', decision: '결정',
  },
});

const HANGUL_FIRST = 0xac00;
const HANGUL_LAST = 0xd7a3;
const NO_FINAL = 0;
const FINAL_RIEUL = 8;

// 한글 음절이 아니면 null. 음절이면 종성 번호 (0 = 받침 없음).
function finalConsonant(word) {
  const last = String(word).trim().slice(-1);
  const code = last.charCodeAt(0);
  if (code < HANGUL_FIRST || code > HANGUL_LAST) return null;
  return (code - HANGUL_FIRST) % 28;
}

function particle(word, pair) {
  const [withFinal, withoutFinal] = pair.split('/');
  const final = finalConsonant(word);
  if (final === null) return withFinal;
  // '으로/로'만 받침 ㄹ 뒤에서도 '로'를 쓴다 (파일로, 목록으로).
  if (pair === '으로/로') return final === NO_FINAL || final === FINAL_RIEUL ? withoutFinal : withFinal;
  return final === NO_FINAL ? withoutFinal : withFinal;
}

export function josa(word, pair) {
  return `${word}${particle(word, pair)}`;
}

export function quote(word, pair) {
  return pair ? `'${word}'${particle(word, pair)}` : `'${word}'`;
}

// 문서 기호(§)는 읽는 사람이 뜻을 모를 수 있다. '§3'은 '3장', '§5.1.2'는 '5.1.2절'로 푼다.
export function readableRef(text) {
  return String(text)
    .replace(/§\s*(\d+(?:\.\d+)+)/g, '$1절')
    .replace(/§\s*(\d+)/g, '$1장')
    .replace(/§/g, '');
}
