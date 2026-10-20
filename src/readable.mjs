// 내보내는 SDD를 사람이 읽는 문장으로 푼다 (docs/sdd-guide.md 7장).
// 작업 폴더의 sdd.md는 기호 표기(`?` `◆` `→` `⇒` `↪`) 그대로 두고 검사한다. 기호는 쓰기와 검사에는 좋지만 읽기에는 걸린다.

// 받침이 있으면 true. 마지막 한글 글자로 본다. 한글이 없으면 받침이 없는 것으로 본다.
function finalOf(text) {
  const syllable = [...text].reverse().find((ch) => ch >= '가' && ch <= '힣');
  return syllable ? (syllable.charCodeAt(0) - 0xac00) % 28 : 0;
}
const object = (text) => (finalOf(text) ? '을' : '를');
// ㄹ 받침(8) 뒤에는 `로`를 쓴다.
const toward = (text) => (finalOf(text) && finalOf(text) !== 8 ? '으로' : '로');

const bold = (text) => text.replace(/\[([^\]]+)\]/g, '**$1**');

// `[수정] 누름` 같은 행동을 조건(`누르면`)과 문장(`누른다`)으로 바꾼다. 명사로 끝나면 `하다`를 붙인다.
const withN = (syllable) => String.fromCharCode(syllable.charCodeAt(0) + 4); // ㄴ 받침을 붙인다
function verb(word) {
  const head = word.slice(0, -1);
  const last = word.at(-1);
  if (last === '름') return { when: `${head}르면`, does: `${head}${withN('르')}다` };
  if (last === '함') return { when: `${head}하면`, does: `${head}한다` };
  if (last === '음') return { when: `${head}으면`, does: `${head}는다` };
  if (finalOf(last) === 16) {
    // 다른 ㅁ 받침: `봄` → `보면`, `본다`
    const open = String.fromCharCode(last.charCodeAt(0) - 16);
    return { when: `${head}${open}면`, does: `${head}${withN(open)}다` };
  }
  return { when: `${word}하면`, does: `${word}한다` };
}

// `[대상] 동작` → 조건과 문장. 대상은 굵게 하고 조사를 붙인다.
function action(text) {
  const match = text.trim().match(/^(?:\[([^\]]+)\]\s*)?(.+)$/);
  const words = match[2].trim().split(/\s+/);
  // 화면에 들어가는 것은 목적어가 아니라 장소다: `[게시글 상세] 진입` → `게시글 상세에 들어간다`.
  if (match[1] && words.length === 1 && words[0] === '진입') return { when: `**${match[1]}**에 들어가면`, does: `**${match[1]}**에 들어간다` };
  const { when, does } = verb(words.pop());
  const front = [match[1] ? `**${match[1]}**${object(match[1])}` : '', bold(words.join(' '))].filter(Boolean).join(' ');
  return { when: [front, when].filter(Boolean).join(' '), does: [front, does].filter(Boolean).join(' ') };
}

const transition = (text) => {
  const [from, to] = text.split(/\s*→\s*/);
  return `상태가 **${from}**에서 **${to}**${toward(to)} 바뀐다`;
};

// 한 줄(목록 표시 뒤)을 문장으로 푼다.
export function readableLine(text) {
  const t = text.trim();
  let m;
  if ((m = t.match(/^\?\s*(.+)$/))) return `**${m[1].replace(/\?$/, '')}?** 에 따라`;
  if ((m = t.match(/^◆\s*(.+)$/))) return `**${m[1]}** 에 따라`;
  if ((m = t.match(/^\*\*(.+)\*\*$/))) return `${m[1]}일 때`;
  if ((m = t.match(/^↪\s*(.+)$/))) return `공통 단계 따르기: **${m[1]}**`;
  if ((m = t.match(/^⇒\s*(.+)$/))) return transition(m[1]);
  if ((m = t.match(/^→\s*(.+)$/))) return bold(m[1]);
  if ((m = t.match(/^(.+?)\s*⇒\s*(.+)$/))) return `${action(m[1]).when} ${transition(m[2])}`;
  if ((m = t.match(/^(.+?)\s*→\s*(.+)$/))) return `${action(m[1]).when} ${bold(m[2])}`;
  if (/^\[[^\]]+\]\s*\S+$/.test(t)) return action(t).does;
  return bold(t);
}

// 제목도 기호 없이: `피쳐 · 이름 · R1` → `이름` + 요구사항 줄, `함수 · 이름` → `공통 단계 · 이름`.
export function readableSdd(source) {
  const out = [];
  for (const line of source.split('\n')) {
    let m;
    if ((m = line.match(/^## 피쳐 · (.+?)(?: · (R\d.*))?$/))) out.push(`## ${m[1]}`, ...(m[2] ? [`> 요구사항 ${m[2]}`] : []));
    else if ((m = line.match(/^## 함수 · (.+)$/))) out.push(`## 공통 단계 · ${m[1]}`);
    else if ((m = line.match(/^(\s*)- (.+)$/))) out.push(`${m[1]}- ${readableLine(m[2])}`);
    else out.push(line);
  }
  return out.join('\n');
}
