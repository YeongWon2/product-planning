// 결과물의 번호 앵커와 양방향 링크 (docs/design.md 5장). 작업 파일에는 번호만 쓰고, 내보낼 때 여기서 링크로 바꾼다.

const TOKEN = /(?<![A-Za-z0-9_#-])((?:BR|FN|G|P|R|F|D|A|M|C|E|N|T|V)\d+(?:-\d+)?)(?![A-Za-z0-9_])/g;
const DEFINITIONS = [
  /^(#{2,3} )((?:BR|FN|G|P|R|F|D|M|C|E)\d+)(?=\s)/,
  /^(- )(R\d+-\d+|N\d+|V\d+)(?=\s)/,
  /^(- \[[ x]\] )(T\d+)(?=\s)/,
  /^(\| )(A\d+)(?= \|)/,
];
// 우선순위 P1~P3은 페르소나 번호와 모양이 같으므로 링크하지 않는다.
const SKIP_LINE = /^우선순위:/;
const PRIORITY_HEADING = /^### (P\d+) · /;
export const REVERSE_LABEL = '쓰는 곳:';

const anchor = (id) => `<a id="${id.toLowerCase()}"></a>`;
const href = (id, file, here) => (file === here ? `#${id.toLowerCase()}` : `${file}#${id.toLowerCase()}`);

// registry: Map(번호 → 결과 파일 이름). files: { 파일 이름: 내용 }. reverseFor: 쓰는 곳 줄을 붙일 파일들.
export function linkify(files, registry, reverseFor = []) {
  const scanned = Object.fromEntries(Object.entries(files).map(([name, text]) => [name, scan(name, text, registry)]));
  const users = new Map();
  for (const [name, { refs }] of Object.entries(scanned)) {
    for (const { id, owner } of refs) {
      if (!owner || owner === id) continue;
      const list = users.get(id) ?? [];
      if (!list.some((user) => user.id === owner)) list.push({ id: owner, file: name });
      users.set(id, list);
    }
  }
  const out = {};
  for (const [name, { lines, defs }] of Object.entries(scanned)) {
    const result = [];
    lines.forEach((line, index) => {
      const def = defs.get(index);
      const list = def && reverseFor.includes(name) ? users.get(def.id) : null;
      const used = list?.length ? `${REVERSE_LABEL} ${list.map((user) => `[${user.id}](${href(user.id, user.file, name)})`).join(' · ')}` : null;
      if (used && def.heading) result.push(line, '', used);
      else if (used) result.push(`${line} — ${used}`);
      else result.push(line);
    });
    out[name] = result.join('\n');
  }
  return out;
}

function scan(name, text, registry) {
  const lines = [];
  const defs = new Map();
  const refs = [];
  let owner = null;
  let fenced = false;
  const link = (segment) => segment.split(/(`[^`]*`)/).map((part) => (part.startsWith('`') ? part : part.replace(TOKEN, (token) => {
    if (!registry.has(token)) return token;
    refs.push({ id: token, owner });
    return `[${token}](${href(token, registry.get(token), name)})`;
  }))).join('');
  for (const line of text.split('\n')) {
    if (line.trim().startsWith('```')) fenced = !fenced;
    if (fenced || line.trim().startsWith('```') || SKIP_LINE.test(line)) {
      lines.push(line);
      continue;
    }
    const priority = line.match(PRIORITY_HEADING);
    if (priority) {
      owner = null;
      lines.push(`### ${priority[1]} · ${link(line.slice(priority[0].length))}`);
      continue;
    }
    const match = DEFINITIONS.map((pattern) => line.match(pattern)).find((found) => found && registry.get(found[2]) === name);
    if (!match) {
      // 번호 없는 머리(## 아키텍처, ### 기반)에서 앞 항목의 범위가 끝난다.
      if (line.startsWith('#')) owner = null;
      lines.push(link(line));
      continue;
    }
    const id = match[2];
    const start = match.index + match[0].length - id.length;
    owner = id;
    defs.set(lines.length, { id, heading: line.startsWith('#') });
    lines.push(`${link(line.slice(0, start))}${anchor(id)}${id}${link(line.slice(start + id.length))}`);
  }
  return { lines, defs, refs };
}

// 결과물을 작업 파일 모양으로 되돌린다: 앵커, 번호 링크, 쓰는 곳 줄을 뗀다.
export function unlink(text) {
  return text.split('\n')
    .filter((line) => !line.startsWith(REVERSE_LABEL) && !line.startsWith('> 기준 문서:'))
    .map((line) => line
      .replace(/<a id="[^"]*"><\/a>/g, '')
      .replace(/\[((?:BR|FN|G|P|R|F|D|A|M|C|E|N|T|V|S)\d+(?:-\d+)?)\]\([^)]*\)/g, '$1')
      .replace(new RegExp(` — ${REVERSE_LABEL} .*$`), ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}
