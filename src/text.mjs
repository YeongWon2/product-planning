// 문장 규칙. 기획(요구사항·PRD)은 비개발자가 읽으므로 모든 규칙을, SDD 트리는 한 줄 한 문장만 본다.
// AI 말투 목록은 오탐이 적은 것만 둔다. 근거는 docs/design.md 5장.

const JARGON = ['API', 'DB', 'JSON', 'null', '서버', '데이터베이스', '컴포넌트', '함수', '엔드포인트'];
const VAGUE = ['적절히', '필요 시', '필요시', '가능하면'];
// AI 상투어와 예고·결산 문구 (humanizer, humanizer-ko #7·#25·#28, korean-humanizer CHEATSHEET).
const AI_WORDS = [
  '다양한', '핵심적', '필수적', '혁신적', '획기적', '전반적', '심층적', '포괄적', '효율적', '원활', '극대화', '시너지', '패러다임',
  '자리매김', '주목할 만한', '도모', '모색', '한층 더', '매우 중요', '다음과 같', '결론적으로', '요컨대', '궁극적으로', '종합하면',
];
// 번역투와 군더더기 (humanizer-ko #23·#26, humanize-korean A-1~A-9).
// `~를 통해`, `~에 있어서`는 실제 경로·장소일 때가 많아 넣지 않는다 ("손에 있어서 바로 고친다").
const TRANSLATIONESE = [/에 의해/, /되어지/, /가지고 있/, /와 관련하여/, /[을를] (진행|수행)하/, /라고 할 수 있/, /하는 것이 가능/];
const DECORATION = [/\*\*/, /—/, /\p{Extended_Pictographic}/u];
const POLITE = /(니다|세요|어요|아요|해요|에요|예요|죠)[.!?]?$/;
// `등` 뒤에 조사가 붙어도 모호한 말로 본다. `등산`처럼 붙은 낱말은 넘긴다.
const ETC = /(^|\s)등(을|이|의|과|도|에|으로)?([\s.,]|$)/;
// 작성법이 권하는 끝 표시 `(가정)`은 문장 수에 넣지 않는다.
const ASSUMPTION = /\s*\(가정\)$/;
const MAX_ADJECTIVAL = 2;
export const MAX_LENGTH = 80;

export function sentenceCount(text) {
  return text.split(/(?<=[.!?])\s+(?=\S)/).filter((part) => part.trim() !== '').length;
}

function hasWord(text, word) {
  // 영문 용어는 단어 경계로, 한글 용어는 포함 여부로 본다.
  if (/^[A-Za-z]+$/.test(word)) return new RegExp(`(^|[^A-Za-z])${word}([^A-Za-z]|$)`, 'i').test(text);
  return text.includes(word);
}

export function sentenceIssues(text) {
  const issues = [];
  const add = (kind, message) => issues.push({ kind, message });
  if (sentenceCount(text.replace(ASSUMPTION, '')) > 1) add('한 줄 두 문장', `"${text}"를 한 줄에 한 문장으로 나눈다.`);
  const jargon = JARGON.filter((word) => hasWord(text, word));
  if (jargon.length) add('개발 용어', `"${text}"에서 ${jargon.join(', ')}를 비개발자 말로 바꾼다.`);
  const vague = VAGUE.filter((word) => text.includes(word));
  if (ETC.test(text)) vague.push('등');
  if (vague.length) add('모호한 말', `"${text}"에서 ${vague.join(', ')} 대신 끝이 닫힌 말로 쓴다.`);
  if ([...text].length > MAX_LENGTH) add('긴 문장', `"${text.slice(0, 20)}…"를 ${MAX_LENGTH}자 안으로 줄인다.`);
  const ai = AI_WORDS.filter((word) => text.includes(word));
  if ((text.match(/[가-힣]+적(?:인|으로|이고|이며|이다)?(?![가-힣])/g) ?? []).length > MAX_ADJECTIVAL) ai.push('~적 여러 번');
  if (ai.length) add('AI 말투', `"${text}"에서 ${ai.join(', ')} 같은 말을 빼고 무엇이 어떻게 되는지 그대로 쓴다.`);
  const stiff = TRANSLATIONESE.map((pattern) => text.match(pattern)?.[0]).filter(Boolean);
  if (stiff.length) add('번역투', `"${text}"에서 ${stiff.join(', ')}를 우리말 순서로 고친다.`);
  if (DECORATION.some((pattern) => pattern.test(text))) add('꾸밈', `"${text}"에서 굵게, 긴 줄표, 이모지를 뺀다.`);
  if (POLITE.test(text)) add('존댓말', `"${text}"를 "~한다"로 끝낸다.`);
  return issues;
}
