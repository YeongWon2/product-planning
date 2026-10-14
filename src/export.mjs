// 결과물 내보내기와 작업 폴더 지우기 (docs/harness.md 6장).
// 기획 PRD와 SDD 스펙을 두 파일로 낸다. 작업 흔적(상태 줄, 진행표, 정할 것, trace.json)은 넣지 않는다.
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { FILES, InputError, evaluate } from './report.mjs';

const WORK_FILES = new Set(Object.values(FILES));
const DROP = { plan: ['정할 것'], sdd: ['진행표'] };

// 상태 줄과 버릴 구역을 뺀다. 제목(#)과 나머지 머리는 그대로 둔다.
function clean(source, drop) {
  const out = [];
  let skipping = false;
  for (const line of source.split(/\r?\n/)) {
    if (/^상태:/.test(line)) continue;
    if (line.startsWith('## ')) skipping = drop.includes(line.slice(3).trim());
    if (!skipping) out.push(line);
  }
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

export const outputNames = (feature) => ({ prd: `${feature}-prd.md`, sdd: `${feature}-sdd.md` });

export function render(folder) {
  const names = outputNames(basename(resolve(folder)));
  const prd = clean(readFileSync(join(folder, FILES.plan), 'utf8'), DROP.plan);
  // SDD 문서 제목 아래에 짝이 되는 기획 문서를 알린다. 두 파일은 같은 폴더에 놓인다.
  const sdd = clean(readFileSync(join(folder, FILES.sdd), 'utf8'), DROP.sdd).replace(/^(# .+\n)/, `$1\n> 기획: [${names.prd}](${names.prd})\n`);
  return { [names.prd]: prd, [names.sdd]: sdd };
}

// 하네스 파일만 든 폴더인지 확인한다. 다른 파일이 있으면 엉뚱한 폴더일 수 있으니 지우지 않는다.
function assertWorkFolder(folder) {
  if (!existsSync(join(folder, FILES.plan))) throw new InputError(`${folder}는 작업 폴더가 아니다 (plan.md 없음).`);
  const others = readdirSync(folder).filter((name) => !WORK_FILES.has(name));
  if (others.length) throw new InputError(`${folder}에 하네스 파일이 아닌 것(${others.join(', ')})이 있어 지우지 않는다.`);
}

export function exportResult(folder, targetDir, { force = false, keep = false } = {}) {
  const report = evaluate(folder);
  if (report.step !== null) throw new InputError(`아직 완료가 아니다 (단계: ${report.stage}). check로 남은 것을 먼저 끝낸다.`);
  const outputs = render(folder);
  const paths = Object.keys(outputs).map((name) => join(targetDir, name));
  const existing = paths.filter((path) => existsSync(path));
  if (existing.length && !force) throw new InputError(`${existing.join(', ')}가 이미 있다. 덮어쓰려면 --force를 붙인다.`);
  if (!keep) assertWorkFolder(folder);
  mkdirSync(targetDir, { recursive: true });
  for (const [name, content] of Object.entries(outputs)) writeFileSync(join(targetDir, name), content);
  if (!keep) rmSync(folder, { recursive: true });
  return { paths, removed: !keep };
}

export function discard(folder) {
  assertWorkFolder(folder);
  rmSync(folder, { recursive: true });
}
