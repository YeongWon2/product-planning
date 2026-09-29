export const LABELS = Object.freeze({
  permission: { allow: '허용', hide: '숨김', disable: '비활성', deny: '불가' },
  priority: { must: '필수', should: '권장', could: '선택' },
  scenarioKind: { main: '기본 흐름', alt: '대안 흐름', exception: '예외 흐름' },
  screenType: { screen: '화면', modal: '모달', confirm: '확인 창', notification: '알림' },
  source: { code: '코드', schema: '스키마', doc: '문서', data: '데이터', reference: '레퍼런스', decision: '결정', assumption: '가정' },
  actionKind: { list: '목록', view: '상세', create: '만들기', update: '수정', delete: '삭제', other: '기타' },
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
