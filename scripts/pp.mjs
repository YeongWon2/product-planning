#!/usr/bin/env node
// 하네스 CLI (docs/harness.md 1장). 문서 내용을 쓰지 않는다. init은 빈 틀을, lock은 잠금 지문을, export는 결과물을 만든다.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkPlan, lockFingerprint, parsePlan } from '../src/plan.mjs';
import { parseSdd } from '../src/sdd.mjs';
import { FILES, InputError, evaluate, formatReport } from '../src/report.mjs';
import { sheet } from '../src/trace.mjs';
import { discard, exportResult } from '../src/export.mjs';

const USAGE = `사용법:
  node scripts/pp.mjs init    <폴더> <기능 이름>   없는 파일만 빈 틀로 만든다
  node scripts/pp.mjs check   <폴더> [--json]      지금 단계와 추가돼야 완성인 것을 보여 준다
  node scripts/pp.mjs lock    <폴더>               사람이 확인한 요구사항을 잠근다
  node scripts/pp.mjs unlock  <폴더>               요구사항 잠금을 푼다
  node scripts/pp.mjs sheet   <폴더>               요구사항 대조 검토지를 JSON으로 낸다
  node scripts/pp.mjs export  <폴더> <문서 폴더> [--force] [--keep]
                                                   확정된 PRD(와 SDD)를 <문서 폴더>/{feature}/에 쓴다 (보통 <프로젝트>/docs)
  node scripts/pp.mjs discard <폴더>               내보내지 않고 작업 폴더를 지운다`;

// 요구사항 단계 구역을 먼저, PRD 인터뷰 구역을 뒤에 둔다.
const PLAN_SECTIONS = ['페르소나', '요구사항', '범위 밖', '요약', '배경', '목표', '용어', '지켜야 할 조건', '일정과 리스크', '참고 문서', '정할 것'];
const planTemplate = (name) => `# ${name} 기획\n\n상태: 작성중\n작성자:\n\n${PLAN_SECTIONS.map((title) => `## ${title}\n`).join('\n')}`;
const sddTemplate = (name) => `# ${name} SDD 스펙\n\n상태: 작성중\n\n## 상태표\n\n| 대상 | 상태 | 뜻 |\n|---|---|---|\n\n## 조건표\n\n| 조건 | 갈래 | 정해지는 곳 |\n|---|---|---|\n\n## 진행표\n\n| 단위 | 종류 | 요구사항 | 진행 |\n|---|---|---|---|\n`;

function init(folder, name) {
  if (!name) throw new InputError('기능 이름이 필요하다.');
  mkdirSync(folder, { recursive: true });
  const planPath = join(folder, FILES.plan);
  const sddPath = join(folder, FILES.sdd);
  const made = [];
  if (!existsSync(planPath)) {
    writeFileSync(planPath, planTemplate(name));
    made.push(planPath);
  }
  const prdDone = evaluate(folder).prdDone;
  if (prdDone && !existsSync(sddPath)) {
    writeFileSync(sddPath, sddTemplate(name));
    made.push(sddPath);
  }
  console.log(made.length ? `만들었다: ${made.join(', ')}` : '새로 만들 파일이 없다.');
  if (!prdDone) console.log('sdd.md는 PRD가 확정된 뒤에 만든다.');
}

// 요구사항 단계(1~4)에서 잠금 말고 남은 것이 없을 때만 잠근다.
function lock(folder) {
  const plan = parsePlan(readFileSync(join(folder, FILES.plan), 'utf8'));
  const left = checkPlan(plan, { lock: { fingerprint: lockFingerprint(plan) } }).filter((issue) => issue.step <= 4);
  if (left.length) throw new InputError(`요구사항이 아직 다 갖춰지지 않았다: ${left.map((issue) => issue.kind).join(', ')}. check로 먼저 끝낸다.`);
  writeFileSync(join(folder, FILES.lock), `${JSON.stringify({ fingerprint: lockFingerprint(plan) }, null, 2)}\n`);
  console.log(`잠갔다: 요구사항 ${plan.requirements.length}개, 완성 기준 ${plan.requirements.reduce((n, r) => n + r.criteria.length, 0)}개`);
}

function run([command, folder, ...rest]) {
  if (!command || !folder || !['init', 'check', 'lock', 'unlock', 'sheet', 'export', 'discard'].includes(command)) {
    console.error(USAGE);
    return 2;
  }
  if (command === 'init') {
    init(folder, rest.join(' ').trim());
    return 0;
  }
  if (command === 'lock') {
    lock(folder);
    return 0;
  }
  if (command === 'unlock') {
    rmSync(join(folder, FILES.lock), { force: true });
    console.log('잠금을 풀었다. 요구사항을 고친 뒤 사람이 확인하면 다시 lock한다.');
    return 0;
  }
  if (command === 'export') {
    const target = rest.find((arg) => !arg.startsWith('--'));
    if (!target) throw new InputError('문서 폴더 경로가 필요하다. 보통 <프로젝트>/docs다.');
    const result = exportResult(folder, target, { force: rest.includes('--force'), keep: rest.includes('--keep') });
    if (result.written.length) console.log(`썼다: ${result.written.join(', ')}`);
    if (result.unchanged.length) console.log(`그대로다: ${result.unchanged.join(', ')}`);
    if (result.removed) console.log(`지웠다: ${folder}`);
    else if (!result.complete) console.log('SDD를 이어 쓸 수 있게 작업 폴더를 남겼다. 여기서 끝내려면 discard로 지운다.');
    return 0;
  }
  if (command === 'discard') {
    discard(folder);
    console.log(`지웠다: ${folder}`);
    return 0;
  }
  if (command === 'sheet') {
    const read = (file) => readFileSync(join(folder, file), 'utf8');
    if (!existsSync(join(folder, FILES.sdd))) throw new InputError('sdd.md가 없다. PRD를 확정하고 init으로 만든다.');
    console.log(JSON.stringify(sheet(parsePlan(read(FILES.plan)), parseSdd(read(FILES.sdd))), null, 2));
    return 0;
  }
  const report = evaluate(folder);
  console.log(rest.includes('--json') ? JSON.stringify(report, null, 2) : formatReport(report));
  return report.step === null ? 0 : 1;
}

try {
  process.exitCode = run(process.argv.slice(2));
} catch (error) {
  if (!(error instanceof InputError) && error.code !== 'ENOENT') throw error;
  console.error(error.message);
  process.exitCode = 2;
}
