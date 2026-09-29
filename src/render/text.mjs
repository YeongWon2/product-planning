// 그림 속 글의 폭을 어림한다. 글꼴을 읽을 수 없으므로 글자 종류별 폭(글꼴 크기에 대한 비율)을 쓴다.
// 한글·한자·전각은 1, 영문 대문자·숫자는 0.62, 소문자·기호는 0.55, 공백은 0.3. 조금 넉넉하게 잡아 넘치지 않게 한다.
function charRatio(char) {
  const code = char.codePointAt(0);
  if (char === ' ') return 0.3;
  if ((code >= 0xac00 && code <= 0xd7a3) || (code >= 0x3130 && code <= 0x318f) || (code >= 0x4e00 && code <= 0x9fff) || (code >= 0xff00 && code <= 0xffef)) return 1;
  if (/[A-Z0-9]/.test(char)) return 0.62;
  if (/[·…→←↑↓~]/.test(char)) return 0.8;
  return 0.55;
}

export function textWidth(text, fontSize) {
  let width = 0;
  for (const char of String(text)) width += charRatio(char) * fontSize;
  return Math.ceil(width);
}

// 폭 안에 들어가도록 낱말 사이에서 끊고, 한 낱말이 폭보다 길면 글자 단위로 끊는다. 줄 바꿈(\n)은 그대로 둔다.
export function wrapToWidth(text, fontSize, maxWidth) {
  const lines = [];
  for (const paragraph of String(text).split('\n')) {
    let line = '';
    for (const word of paragraph.split(' ')) {
      const next = line ? `${line} ${word}` : word;
      if (textWidth(next, fontSize) <= maxWidth) { line = next; continue; }
      if (line) lines.push(line);
      line = '';
      let rest = word;
      while (textWidth(rest, fontSize) > maxWidth) {
        let cut = '';
        for (const char of rest) {
          if (textWidth(cut + char, fontSize) > maxWidth) break;
          cut += char;
        }
        if (cut === '') cut = [...rest][0];
        lines.push(cut);
        rest = [...rest].slice([...cut].length).join('');
      }
      line = rest;
    }
    lines.push(line);
  }
  return lines.length === 0 ? [''] : lines;
}
