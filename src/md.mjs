// 작업 파일이 공통으로 쓰는 md 읽기. 머리(##)로 구역을 나누고 표와 중첩 목록, 번호 항목을 읽는다.

// 첫 ## 앞의 "키: 값" 줄. 상태·기능처럼 문서 머리에 두는 값이다.
export function readHead(lines, key) {
  for (const line of lines) {
    if (line.startsWith('## ')) break;
    const match = line.match(new RegExp(`^${key}:\\s*(.*)$`));
    if (match) return match[1].trim();
  }
  return null;
}

// ### 번호 제목 아래 "키: 값" 줄과 나머지 줄을 읽는다. keys에 없는 키는 나머지 줄로 둔다.
// [{ id, title, line, fields: { 키: { text, line } }, lines: [{ text, line }] }], 첫 항목 앞의 줄은 stray로 낸다.
export function items(body, pattern, keys) {
  const result = [];
  const stray = [];
  for (const { text, line } of body) {
    const match = text.match(pattern);
    if (match) {
      result.push({ id: match[1], title: (match[2] ?? '').trim(), line, fields: {}, lines: [] });
      continue;
    }
    if (text.trim() === '') continue;
    const current = result.at(-1);
    if (!current) {
      stray.push({ text: text.trim(), line });
      continue;
    }
    const field = text.match(/^([^:]+?):\s*(.*)$/);
    if (field && keys.includes(field[1].trim())) current.fields[field[1].trim()] = { text: field[2].trim(), line };
    else current.lines.push({ text: text.trim(), line });
  }
  return { items: result, stray };
}

export const bullets = (body) => body.filter(({ text }) => text.startsWith('- ')).map(({ text, line }) => ({ text: text.slice(2).trim(), line }));
export const splitIds = (text) => (text ?? '').split(',').map((id) => id.trim()).filter(Boolean);

export function readStatus(lines) {
  for (const line of lines) {
    if (line.startsWith('## ')) break;
    const match = line.match(/^상태:\s*(.+)$/);
    if (match) return match[1].trim();
  }
  return null;
}

// [{ title, line, body: [{ text, line }] }]. 첫 ## 앞의 줄은 버린다.
export function sections(lines) {
  const result = [];
  lines.forEach((text, index) => {
    if (text.startsWith('## ')) result.push({ title: text.slice(3).trim(), line: index + 1, body: [] });
    else if (result.length) result.at(-1).body.push({ text, line: index + 1 });
  });
  return result;
}

// 머리 줄과 구분 줄을 뺀 행. 칸은 앞뒤 공백을 지운다.
export function tableRows(body) {
  const rows = body.filter(({ text }) => text.trim().startsWith('|'));
  return rows.slice(2).map(({ text, line }) => ({
    cells: text.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim()),
    line,
  }));
}

// 중첩 목록을 트리로 읽는다. 들여쓰기 폭이 늘면 자식, 같으면 형제다.
export function listTree(body) {
  const roots = [];
  const stack = [];
  for (const { text, line } of body) {
    const match = text.match(/^(\s*)- (.*)$/);
    if (!match) continue;
    const node = { text: match[2].trim(), line, children: [] };
    const indent = match[1].length;
    while (stack.length && stack.at(-1).indent >= indent) stack.pop();
    (stack.length ? stack.at(-1).node.children : roots).push(node);
    stack.push({ indent, node });
  }
  return roots;
}
