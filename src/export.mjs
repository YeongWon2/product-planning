// 결과물 내보내기·다시 읽어 오기와 작업 폴더 지우기 (docs/harness.md 6장).
// 결과물은 대상 프로젝트의 docs/product/{feature}/에 prd·spec·dev·diagram 네 파일로 남는다.
// 작업 흔적(상태 줄, 기능 줄, 진행표, 정할 것, 기획에 돌려보낼 것, trace.json)은 넣지 않는다.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { FILES, InputError, evaluate, load } from './report.mjs';
import { parseSpec } from './spec.mjs';
import { criteriaOf, lockFingerprint, parsePlan } from './plan.mjs';
import { parseBrief } from './brief.mjs';
import { linkify, unlink } from './link.mjs';

export const OUTPUTS = { prd: 'prd.md', spec: 'spec.md', dev: 'dev.md', diagram: 'diagram.md' };
const TITLES = { prd: '기획 PRD', spec: '기획 상세 스펙', dev: '개발 스펙', diagram: '시퀀스 다이어그램' };
const WORK_FILES = new Set(Object.values(FILES));
const BRIEF_PART = ['왜 지금', '목표', '비즈니스 요구사항'];
const BRIEF_TAIL = ['범위 밖', '제약'];
const PLAN_PART = ['페르소나', '요구사항'];

export const resultDir = (project, feature) => join(project, 'docs', 'product', feature);

// { 제목: '## 제목' 부터 다음 ## 앞까지의 줄 }
function rawSections(source) {
  const result = new Map();
  let current = null;
  for (const line of source.split(/\r?\n/)) {
    if (line.startsWith('## ')) {
      current = line.slice(3).trim();
      result.set(current, [line]);
    } else if (current) result.get(current).push(line);
  }
  return result;
}

const pick = (sections, titles) => titles.filter((title) => sections.has(title)).map((title) => sections.get(title).join('\n').trim());

// 상태 줄·기능 줄과 버릴 구역을 뺀다. 제목(#)과 나머지 머리는 그대로 둔다.
function clean(source, drop = []) {
  const head = [];
  const sections = rawSections(source);
  for (const line of source.split(/\r?\n/)) {
    if (line.startsWith('## ')) break;
    if (!/^(상태|기능):/.test(line)) head.push(line);
  }
  return [head.join('\n').trim(), ...[...sections.keys()].filter((title) => !drop.includes(title)).map((title) => sections.get(title).join('\n').trim())];
}

const nameOf = (plan) => plan.title.replace(/\s*기획$/, '');
const join2 = (parts) => `${parts.filter(Boolean).join('\n\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;

export function render(folder, { withDev }) {
  const docs = load(folder);
  const read = (file) => readFileSync(join(folder, file), 'utf8');
  const keys = withDev ? ['prd', 'spec', 'dev', 'diagram'] : ['prd', 'spec'];
  const nav = `> 기준 문서: ${keys.map((key) => `[${TITLES[key]}](${OUTPUTS[key]})`).join(' · ')}`;
  const brief = rawSections(read(FILES.brief));
  const plan = rawSections(read(FILES.plan));
  const files = {
    [OUTPUTS.prd]: join2([`# ${nameOf(docs.plan)} 기획 PRD`, nav, ...pick(brief, BRIEF_PART), ...pick(plan, PLAN_PART), ...pick(brief, BRIEF_TAIL)]),
  };
  const withNav = ([title, ...rest]) => join2([title, nav, ...rest]);
  files[OUTPUTS.spec] = withNav(clean(read(FILES.spec), ['진행표']));
  if (withDev) {
    files[OUTPUTS.dev] = withNav(clean(read(FILES.dev), ['기획에 돌려보낼 것', '정할 것']));
    files[OUTPUTS.diagram] = withNav(clean(read(FILES.diagram)));
  }
  return linkify(files, registry(docs, withDev), [OUTPUTS.prd, OUTPUTS.spec]);
}

function registry(docs, withDev) {
  const map = new Map();
  const put = (ids, file) => ids.forEach((id) => id && map.set(id, file));
  put(docs.brief.goals.map((goal) => goal.id), OUTPUTS.prd);
  put(docs.brief.requirements.map((item) => item.id), OUTPUTS.prd);
  put(docs.plan.personas.map((persona) => persona.id), OUTPUTS.prd);
  put(docs.plan.requirements.map((requirement) => requirement.id), OUTPUTS.prd);
  put(criteriaOf(docs.plan).map((criterion) => criterion.id), OUTPUTS.prd);
  put(docs.spec.units.map((unit) => unit.id), OUTPUTS.spec);
  if (withDev) {
    const { dev } = docs;
    put([...dev.decisions, ...dev.components, ...dev.models, ...dev.contracts, ...dev.errors, ...dev.constraints, ...dev.tasks, ...dev.checks].map((item) => item.id), OUTPUTS.dev);
    put(docs.diagram.sequences.map((sequence) => sequence.id), OUTPUTS.diagram);
  }
  return map;
}

// 하네스 파일만 든 폴더인지 확인한다. 다른 파일이 있으면 엉뚱한 폴더일 수 있으니 지우지 않는다.
function assertWorkFolder(folder) {
  if (!existsSync(join(folder, FILES.brief))) throw new InputError(`${folder}는 작업 폴더가 아니다 (brief.md 없음).`);
  const others = readdirSync(folder).filter((name) => !WORK_FILES.has(name));
  if (others.length) throw new InputError(`${folder}에 하네스 파일이 아닌 것(${others.join(', ')})이 있어 지우지 않는다.`);
}

// 기획이 끝났으면 PRD와 기획 상세 스펙을, 개발까지 끝났으면 네 문서를 낸다.
// 개발까지 끝나 네 문서를 냈을 때만 작업 폴더를 지운다. 기획만 냈으면 개발을 이어 쓰도록 남긴다.
export function exportResult(folder, project, { force = false, keep = false } = {}) {
  const report = evaluate(folder);
  if (!report.done.plan) throw new InputError(`아직 기획이 완료가 아니다 (단계: ${report.stage}). check로 남은 것을 먼저 끝낸다.`);
  const devStarted = existsSync(join(folder, FILES.dev)) || existsSync(join(folder, FILES.diagram));
  if (devStarted && !report.done.dev) throw new InputError(`개발 스펙을 쓰는 중이다 (단계: ${report.stage}). 끝내고 내보내거나, 기획만 내보내려면 dev.md와 diagram.md를 먼저 치운다.`);
  const feature = load(folder).brief.feature;
  const target = resultDir(project, feature);
  const outputs = render(folder, { withDev: report.done.dev });
  const paths = Object.keys(outputs).map((name) => join(target, name));
  const existing = paths.filter((path) => existsSync(path));
  if (existing.length && !force) throw new InputError(`${existing.join(', ')}가 이미 있다. 다시 읽어 와 고친 것이면 --force로 덮어쓴다.`);
  const remove = report.done.dev && !keep;
  if (remove) assertWorkFolder(folder);
  mkdirSync(target, { recursive: true });
  for (const [name, content] of Object.entries(outputs)) writeFileSync(join(target, name), content);
  if (remove) rmSync(folder, { recursive: true });
  return { paths, removed: remove, withDev: report.done.dev };
}

// 프로젝트의 결과물을 작업 폴더로 되돌린다. 확정된 문서이므로 상태는 확정으로 두고, 고칠 문서만 사람이 작성중으로 돌린다.
export function importResult(project, folder) {
  const feature = basename(resolve(folder));
  const source = resultDir(project, feature);
  const read = (key) => (existsSync(join(source, OUTPUTS[key])) ? unlink(readFileSync(join(source, OUTPUTS[key]), 'utf8')) : null);
  const prd = read('prd');
  const spec = read('spec');
  if (!prd || !spec) throw new InputError(`${source}에 prd.md와 spec.md가 없다.`);
  if (existsSync(folder) && readdirSync(folder).length) throw new InputError(`${folder}가 비어 있지 않다. 작업 중인 폴더를 덮어쓰지 않는다.`);
  const prdTitle = prd.split('\n').find((line) => line.startsWith('# '))?.slice(2).replace(/\s*기획 PRD$/, '').trim() ?? feature;
  const sections = rawSections(prd);
  const confirmed = (title, parts) => join2([`# ${title}`, '상태: 확정', ...parts]);
  const files = {
    [FILES.brief]: join2([`# ${prdTitle} 비즈니스 요구사항`, `상태: 확정\n기능: ${feature}`, ...pick(sections, [...BRIEF_PART, ...BRIEF_TAIL]), '## 정할 것']),
    [FILES.plan]: confirmed(`${prdTitle} 기획`, [...pick(sections, PLAN_PART), '## 정할 것']),
    [FILES.spec]: withProgress(spec),
  };
  const dev = read('dev');
  const diagram = read('diagram');
  if (dev && diagram) {
    files[FILES.dev] = join2([...withStatus(dev), '## 기획에 돌려보낼 것', '## 정할 것']);
    files[FILES.diagram] = join2(withStatus(diagram));
  }
  // 확정된 결과물이므로 요구사항도 잠근 채로 읽어 온다.
  files[FILES.lock] = `${JSON.stringify({ fingerprint: lockFingerprint(parsePlan(files[FILES.plan]), parseBrief(files[FILES.brief])) }, null, 2)}\n`;
  mkdirSync(folder, { recursive: true });
  for (const [name, content] of Object.entries(files)) writeFileSync(join(folder, name), content);
  return { paths: Object.keys(files).map((name) => join(folder, name)) };
}

// 제목 아래에 상태 줄을 넣고 기준 문서 줄을 뗀 [제목, ...구역].
function withStatus(text) {
  const [title, ...rest] = clean(text);
  return [title, '상태: 확정', ...rest];
}

// 진행표는 결과물에 없으므로 트리 목록에서 다시 만든다. 확정된 트리이므로 모두 완료다.
function withProgress(text) {
  const parsed = parseSpec(text);
  const rows = parsed.units.map((unit) => `| ${unit.id} | ${unit.name} | ${unit.requirements.join(', ')} | 완료 |`);
  const progress = ['## 진행표', '', '| 단위 | 이름 | 요구사항 | 진행 |', '|---|---|---|---|', ...rows].join('\n');
  const [title, ...rest] = withStatus(text);
  const index = rest.findIndex((part) => /^## (FN|F)\d+/.test(part));
  rest.splice(index < 0 ? rest.length : index, 0, progress);
  return join2([title, ...rest]);
}

export function discard(folder) {
  assertWorkFolder(folder);
  rmSync(folder, { recursive: true });
}
