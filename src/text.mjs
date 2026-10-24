// 문장 규칙. 비즈니스 요구사항과 기획은 비개발자가 읽으므로 네 규칙을 모두, 기획 상세 스펙 트리는 한 줄 한 문장만 본다.

const JARGON = ['API', 'DB', 'JSON', 'null', '서버', '데이터베이스', '컴포넌트', '함수', '엔드포인트'];
const VAGUE = ['적절히', '필요 시', '필요시', '가능하면'];
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
  if (sentenceCount(text) > 1) issues.push({ kind: '한 줄 두 문장', message: `"${text}"를 한 줄에 한 문장으로 나눈다.` });
  const jargon = JARGON.filter((word) => hasWord(text, word));
  if (jargon.length) issues.push({ kind: '개발 용어', message: `"${text}"에서 ${jargon.join(', ')}를 비개발자 말로 바꾼다.` });
  const vague = VAGUE.filter((word) => text.includes(word));
  if (/(^|\s)등([\s.,]|$)/.test(text)) vague.push('등');
  if (vague.length) issues.push({ kind: '모호한 말', message: `"${text}"에서 ${vague.join(', ')} 대신 끝이 닫힌 말로 쓴다.` });
  if ([...text].length > MAX_LENGTH) issues.push({ kind: '긴 문장', message: `"${text.slice(0, 20)}…"를 ${MAX_LENGTH}자 안으로 줄인다.` });
  return issues;
}
