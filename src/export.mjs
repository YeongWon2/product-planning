// 결과물 내보내기와 작업 폴더 지우기 (docs/harness.md 6장).
// plan.md 하나에서 PRD와 요구사항 정의서를, sdd.md에서 SDD 스펙을 낸다.
// 작업 흔적(상태 줄, 진행표, 정할 것, trace.json)과 `없음`인 선택 구역은 넣지 않는다.
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { sections } from './md.mjs';
import { LIST_SECTIONS, OPTIONAL_SECTIONS, isNone, parsePlan } from './plan.mjs';
import { FILES, InputError, evaluate } from './report.mjs';

const WORK_FILES = new Set(Object.values(FILES));
const PRD_SECTIONS = ['한 줄 요약', '배경', '목표', '페르소나', '요구사항', '범위 밖', ...OPTIONAL_SECTIONS];

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

const finish = (lines) => `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
const cell = (text) => text.replace(/\|/g, '\\|');
const link = (name) => `[${name}](${name})`;
const today = () => new Date().toLocaleDateString('sv-SE');

export const outputNames = (feature) => ({ prd: `${feature}-prd.md`, requirements: `${feature}-requirements.md`, sdd: `${feature}-sdd.md` });

// PRD: 왜, 누구, 어디까지. 요구사항은 제목만 두고 자세한 것은 요구사항 정의서로 보낸다.
function renderPrd(source, plan, names, date) {
  const lines = source.split(/\r?\n/);
  const raw = new Map(sections(lines).map((section) => [section.title, section.body.map(({ text }) => text)]));
  const title = (lines.find((line) => line.startsWith('# ')) ?? '# 기획').replace(/ 기획$/, ' PRD');
  const out = [title, '', `> 요구사항 정의서: ${link(names.requirements)}`, '', '| 항목 | 내용 |', '|---|---|', `| 작성자 | ${cell(plan.author)} |`, `| 작성일 | ${date} |`];
  for (const name of PRD_SECTIONS) {
    if (OPTIONAL_SECTIONS.includes(name) && isNone(plan[LIST_SECTIONS[name]])) continue;
    out.push('', `## ${name}`, '');
    if (name === '요구사항') out.push(...plan.requirements.map((r) => `- ${r.id} ${r.name} (${r.priority.text})`), '', `완성 기준은 ${link(names.requirements)}에 있다.`);
    else out.push(...(raw.get(name) ?? []));
  }
  return finish(out);
}

// 요구사항 정의서: 요구사항 목록과 완성 기준을 표로 낸다. 제외한 기준도 사유와 함께 남긴다.
function renderRequirements(plan, title, names) {
  const persona = new Map(plan.personas.map((p) => [p.id, `${p.id} ${p.name}`]));
  const out = [title.replace(/ 기획$/, ' 요구사항 정의서'), '', `> PRD: ${link(names.prd)}`, '', '## 요구사항 목록', '', '| ID | 요구사항 | 누구 | 우선순위 | 왜 |', '|---|---|---|---|---|'];
  for (const r of plan.requirements) out.push(`| ${r.id} | ${cell(r.name)} | ${cell(r.who.ids.map((id) => persona.get(id)).join(', '))} | ${r.priority.text} | ${cell(r.why.text)} |`);
  out.push('', '## 완성 기준', '', '| ID | 완성 기준 | 비고 |', '|---|---|---|');
  for (const r of plan.requirements) for (const c of r.criteria) out.push(`| ${c.id} | ${cell(c.text)} | ${c.excluded ? cell(`제외: ${c.excluded}`) : ''} |`);
  return finish(out);
}

export function render(folder, { date = today() } = {}) {
  const names = outputNames(basename(resolve(folder)));
  const source = readFileSync(join(folder, FILES.plan), 'utf8');
  const plan = parsePlan(source);
  const title = source.split(/\r?\n/).find((line) => line.startsWith('# ')) ?? '# 기획';
  // SDD 문서 제목 아래에 짝이 되는 기획 문서를 알린다. 세 파일은 같은 폴더에 놓인다.
  const sdd = clean(readFileSync(join(folder, FILES.sdd), 'utf8'), ['진행표']).replace(/^(# .+\n)/, `$1\n> 기획: ${link(names.prd)} · ${link(names.requirements)}\n`);
  return { [names.prd]: renderPrd(source, plan, names, date), [names.requirements]: renderRequirements(plan, title, names), [names.sdd]: sdd };
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
