// 결과물 내보내기와 작업 폴더 지우기 (docs/harness.md 6장).
// PRD가 확정되면 <프로젝트>/docs/{feature}/prd.md를, SDD까지 끝나면 sdd.md도 쓴다.
// 작업 흔적(상태 줄, 진행표, 정할 것, trace.json, lock.json)과 `없음`인 선택 구역은 넣지 않는다.
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { sections } from './md.mjs';
import { LIST_SECTIONS, OPTIONAL_SECTIONS, isNone, parsePlan } from './plan.mjs';
import { FILES, InputError, evaluate } from './report.mjs';

const WORK_FILES = new Set(Object.values(FILES));
export const OUTPUT = { prd: 'prd.md', sdd: 'sdd.md' };
// 사람이 3초 안에 훑도록 왜 → 누구 → 무엇 → 어디까지 순서로 놓는다.
const PRD_ORDER = ['요약', '배경', '목표', '페르소나', '요구사항', '범위 밖', ...OPTIONAL_SECTIONS];
// 누구·우선순위는 요구사항 표로 올리므로 본문에서 뺀다.
const TABLE_FIELDS = /^(누구|우선순위):/;

const finish = (lines) => `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
const cell = (text) => text.replace(/\|/g, '\\|');
const today = () => new Date().toLocaleDateString('sv-SE');

// 상태 줄과 버릴 구역을 뺀다. 제목(#)과 나머지 머리는 그대로 둔다.
function clean(source, drop) {
  const out = [];
  let skipping = false;
  for (const line of source.split(/\r?\n/)) {
    if (/^상태:/.test(line)) continue;
    if (line.startsWith('## ')) skipping = drop.includes(line.slice(3).trim());
    if (!skipping) out.push(line);
  }
  return finish(out);
}

function renderPrd(source, plan, date) {
  const lines = source.split(/\r?\n/);
  const raw = new Map(sections(lines).map((section) => [section.title, section.body.map(({ text }) => text)]));
  const title = (lines.find((line) => line.startsWith('# ')) ?? '# 기획').replace(/ 기획$/, ' PRD');
  const persona = new Map(plan.personas.map((p) => [p.id, p.name]));
  const out = [title, '', `작성자: ${plan.author} · 작성일: ${date}`];
  for (const name of PRD_ORDER) {
    if (OPTIONAL_SECTIONS.includes(name) && isNone(plan[LIST_SECTIONS[name]])) continue;
    out.push('', `## ${name}`, '');
    if (name !== '요구사항') {
      out.push(...(raw.get(name) ?? []));
      continue;
    }
    out.push('| ID | 요구사항 | 누구 | 우선순위 |', '|---|---|---|---|');
    for (const r of plan.requirements) out.push(`| ${r.id} | ${cell(r.name)} | ${cell(r.who.ids.map((id) => persona.get(id) ?? id).join(', '))} | ${r.priority.text} |`);
    out.push('', ...raw.get(name).filter((line) => !TABLE_FIELDS.test(line)));
  }
  return finish(out);
}

// 쓸 문서만 낸다. PRD 확정 전이면 아무것도 내지 않는다.
export function render(folder, { date = today() } = {}) {
  const report = evaluate(folder);
  if (!report.prdDone) throw new InputError(`아직 PRD 확정 전이다 (단계: ${report.stage}). check로 남은 것을 먼저 끝낸다.`);
  const source = readFileSync(join(folder, FILES.plan), 'utf8');
  const outputs = { [OUTPUT.prd]: renderPrd(source, parsePlan(source), date) };
  if (report.step === null) {
    // SDD 맨 위에 짝이 되는 PRD를 알린다. 두 파일은 같은 폴더에 놓인다.
    const sdd = clean(readFileSync(join(folder, FILES.sdd), 'utf8'), ['진행표']);
    outputs[OUTPUT.sdd] = sdd.replace(/^(# .+\n)/, `$1\n> PRD: [${OUTPUT.prd}](${OUTPUT.prd})\n`);
  }
  return { outputs, complete: report.step === null };
}

// 하네스 파일만 든 폴더인지 확인한다. 다른 파일이 있으면 엉뚱한 폴더일 수 있으니 지우지 않는다.
function assertWorkFolder(folder) {
  if (!existsSync(join(folder, FILES.plan))) throw new InputError(`${folder}는 작업 폴더가 아니다 (plan.md 없음).`);
  const others = readdirSync(folder).filter((name) => !WORK_FILES.has(name));
  if (others.length) throw new InputError(`${folder}에 하네스 파일이 아닌 것(${others.join(', ')})이 있어 지우지 않는다.`);
}

// 작성일만 다르면 같은 문서로 본다. 앞서 낸 PRD를 SDD와 함께 다시 낼 때 막히지 않게 한다.
const sameDoc = (a, b) => a.replace(/ · 작성일: .*$/m, '') === b.replace(/ · 작성일: .*$/m, '');

// 결과: { dir, written, unchanged, complete, removed }
export function exportResult(folder, projectDir, { force = false, keep = false } = {}) {
  const { outputs, complete } = render(folder);
  const dir = join(projectDir, 'docs', basename(resolve(folder)));
  const written = [];
  const unchanged = [];
  const conflicts = [];
  for (const [name, content] of Object.entries(outputs)) {
    const path = join(dir, name);
    if (!existsSync(path)) written.push(path);
    else if (sameDoc(readFileSync(path, 'utf8'), content)) unchanged.push(path);
    else if (force) written.push(path);
    else conflicts.push(path);
  }
  if (conflicts.length) throw new InputError(`${conflicts.join(', ')}가 이미 있고 내용이 다르다. 덮어쓰려면 --force를 붙인다.`);
  // PRD만 낸 때는 SDD를 이어 쓸 수 있게 작업 폴더를 남긴다.
  const remove = complete && !keep;
  if (remove) assertWorkFolder(folder);
  mkdirSync(dir, { recursive: true });
  for (const path of written) writeFileSync(path, outputs[basename(path)]);
  if (remove) rmSync(folder, { recursive: true });
  return { dir, written, unchanged, complete, removed: remove };
}

export function discard(folder) {
  assertWorkFolder(folder);
  rmSync(folder, { recursive: true });
}
