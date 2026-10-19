// 결과물 내보내기와 작업 폴더 지우기 (docs/harness.md 6장).
// PRD가 확정되면 <문서 폴더>/{feature}/prd.md를, SDD까지 끝나면 sdd.md도 쓴다. 문서 폴더는 보통 <프로젝트>/docs다.
// 작업 흔적(상태 줄, 진행표, 정할 것, trace.json, lock.json, sheet.json)과 `없음`인 선택 구역은 넣지 않는다.
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { EXCEPTION, LIST_SECTIONS, NONE, OPTIONAL_SECTIONS, TERM, isNone, parsePlan } from './plan.mjs';
import { FILES, InputError, evaluate } from './report.mjs';

const WORK_FILES = new Set(Object.values(FILES));
// 운영체제가 몰래 만드는 파일은 작업 폴더 검사에서 무시한다.
const OS_FILES = new Set(['.DS_Store', 'Thumbs.db']);
export const OUTPUT = { prd: 'prd.md', sdd: 'sdd.md' };
// 사람이 3초 안에 훑도록 왜 → 누구 → 무엇 → 어디까지 순서로 놓는다. 칸이 둘 이상인 것은 표로, 문장 여럿은 목록으로 낸다.
// 처음 읽는 사람이 번호를 알아보게 맨 위에 한 줄로 알린다.
const LEGEND = '> 번호: G 목표, P 페르소나, R 요구사항, R1-1 R1의 완성 기준';
const PRD_ORDER = ['요약', '배경', '목표', '페르소나', '용어', '요구사항', '범위 밖', '지켜야 할 조건', '일정과 리스크', '참고 문서'];

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

const table = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((row) => `| ${row.map(cell).join(' | ')} |`)];
const list = (items) => items.map((item) => `- ${item.text}`);
// 줄 구역은 한 줄씩 목록으로 낸다. 줄바꿈만 있으면 md에서 한 문단으로 합쳐지기 때문이다.
const lines = (items) => (isNone(items) ? [NONE] : list(items));
const labeled = (label, items) => (items.length ? ['', `#### ${label}`, '', ...list(items)] : []);

function personaBlock(p) {
  return [`### ${p.id} ${p.name}`, '', ...p.description.map((d) => d.text), ...labeled('원하는 것', p.needs), ...labeled('행동 패턴', p.patterns), ...labeled('불편', p.pains)];
}

function requirementBlock(r) {
  const criteria = r.criteria.map((c) => ({ text: `${c.id} ${c.text}${c.excluded ? ` (제외: ${c.excluded})` : ''}` }));
  const out = [`### ${r.id} ${r.name}`, '', `왜: ${r.why.text}`, ...labeled('완성 기준', criteria), ...labeled('정책', r.policies)];
  if (r.exceptions.length) out.push('', '#### 예외', '', ...table(['상황', '처리'], r.exceptions.map((e) => e.text.match(EXCEPTION).slice(1))));
  return out;
}

function renderPrd(source, plan, date) {
  const title = (source.split(/\r?\n/).find((line) => line.startsWith('# ')) ?? '# 기획').replace(/ 기획$/, ' PRD');
  const persona = new Map(plan.personas.map((p) => [p.id, `${p.id} ${p.name}`]));
  const out = [title, '', `작성자: ${plan.author} · 작성일: ${date}`, '', LEGEND];
  for (const name of PRD_ORDER) {
    if (OPTIONAL_SECTIONS.includes(name) && isNone(plan[LIST_SECTIONS[name]])) continue;
    out.push('', `## ${name}`, '');
    if (name === '목표') out.push(...table(['ID', '목표', '확인 방법'], plan.goals.map((g) => [g.id, g.name, g.check.text])));
    else if (name === '페르소나') plan.personas.forEach((p, i) => out.push(...(i ? [''] : []), ...personaBlock(p)));
    else if (name === '용어') out.push(...table(['용어', '뜻'], plan.terms.map((t) => t.text.match(TERM).slice(1))));
    else if (name === '요구사항') {
      out.push(...table(['ID', '요구사항', '누구', '우선순위'], plan.requirements.map((r) => [r.id, r.name, r.who.ids.map((id) => persona.get(id) ?? id).join(', '), r.priority.text])));
      for (const r of plan.requirements) out.push('', ...requirementBlock(r));
    } else out.push(...lines(plan[LIST_SECTIONS[name]]));
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
  const others = readdirSync(folder).filter((name) => !WORK_FILES.has(name) && !OS_FILES.has(name));
  if (others.length) throw new InputError(`${folder}에 하네스 파일이 아닌 것(${others.join(', ')})이 있어 지우지 않는다. 그 파일을 치우거나, 작업 폴더를 남기려면 --keep을 붙인다.`);
}

// 작성일만 다르면 같은 문서로 본다. 앞서 낸 PRD를 SDD와 함께 다시 낼 때 막히지 않게 한다.
const sameDoc = (a, b) => a.replace(/ · 작성일: .*$/m, '') === b.replace(/ · 작성일: .*$/m, '');

const inside = (child, parent) => !relative(parent, child).startsWith('..') && !relative(parent, child).startsWith('/');
const overlaps = (a, b) => inside(a, b) || inside(b, a);

// 결과: { dir, written, unchanged, complete, removed }
export function exportResult(folder, docsDir, { force = false, keep = false } = {}) {
  const { outputs, complete } = render(folder);
  const dir = join(docsDir, basename(resolve(folder)));
  // 결과 폴더와 작업 폴더가 겹치면 작업 폴더를 지울 때 결과물까지 지워진다.
  if (overlaps(resolve(folder), resolve(dir))) throw new InputError(`결과 폴더 ${dir}가 작업 폴더 ${folder}와 겹친다. 작업 폴더 밖의 문서 폴더를 준다.`);
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
