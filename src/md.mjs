// plan.md·sdd.md가 공통으로 쓰는 md 읽기. 머리(##)로 구역을 나누고 표와 중첩 목록을 읽는다.

// 첫 ## 앞의 `이름: 값` 줄을 읽는다. 값이 비었으면 null이다.
export function readField(lines, name) {
  for (const line of lines) {
    if (line.startsWith('## ')) break;
    const match = line.match(new RegExp(`^${name}:\\s*(.*)$`));
    if (match) return match[1].trim() || null;
  }
  return null;
}

export const readStatus = (lines) => readField(lines, '상태');

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
