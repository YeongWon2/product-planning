// 결과물 내보내기와 작업 폴더 지우기 (docs/harness.md 6장).
// 작업 흔적(상태 줄, 진행표, 정할 것, trace.json)은 결과물에 넣지 않는다.
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { FILES, InputError, evaluate } from './report.mjs';

const WORK_FILES = new Set(Object.values(FILES));
const DROP = { plan: ['정할 것'], sdd: ['진행표'] };

// 첫 # 제목과 상태 줄, 버릴 구역을 빼고 머리를 한 단계씩 내린다.
function body(source, drop) {
  const out = [];
  let skipping = false;
  for (const line of source.split(/\r?\n/)) {
    if (/^# /.test(line) || /^상태:/.test(line)) continue;
    if (line.startsWith('## ')) skipping = drop.includes(line.slice(3).trim());
    if (skipping) continue;
    out.push(line.startsWith('#') ? `#${line}` : line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function render(folder) {
  const plan = readFileSync(join(folder, FILES.plan), 'utf8');
  const sdd = readFileSync(join(folder, FILES.sdd), 'utf8');
  const title = plan.match(/^# (.+?)(?:\s*기획)?\s*$/m)?.[1] ?? '기획';
  return `# ${title}\n\n## 기획\n\n${body(plan, DROP.plan)}\n\n## SDD 스펙\n\n${body(sdd, DROP.sdd)}\n`;
}

// 하네스 파일만 든 폴더인지 확인한다. 다른 파일이 있으면 엉뚱한 폴더일 수 있으니 지우지 않는다.
function assertWorkFolder(folder) {
  if (!existsSync(join(folder, FILES.plan))) throw new InputError(`${folder}는 작업 폴더가 아니다 (plan.md 없음).`);
  const others = readdirSync(folder).filter((name) => !WORK_FILES.has(name));
  if (others.length) throw new InputError(`${folder}에 하네스 파일이 아닌 것(${others.join(', ')})이 있어 지우지 않는다.`);
}

export function exportResult(folder, target, { force = false, keep = false } = {}) {
  const report = evaluate(folder);
  if (report.step !== null) throw new InputError(`아직 완료가 아니다 (단계: ${report.stage}). check로 남은 것을 먼저 끝낸다.`);
  if (existsSync(target) && !force) throw new InputError(`${target}가 이미 있다. 덮어쓰려면 --force를 붙인다.`);
  if (!keep) assertWorkFolder(folder);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, render(folder));
  if (!keep) rmSync(folder, { recursive: true });
  return { target, removed: !keep };
}

export function discard(folder) {
  assertWorkFolder(folder);
  rmSync(folder, { recursive: true });
}
