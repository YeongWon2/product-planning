#!/usr/bin/env node
// 하네스 CLI (docs/harness.md 1장). 문서 내용을 쓰지 않는다. init은 빈 틀을, export는 결과물을 만든다.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parsePlan } from '../src/plan.mjs';
import { parseSdd } from '../src/sdd.mjs';
import { FILES, InputError, evaluate, formatReport } from '../src/report.mjs';
import { sheet } from '../src/trace.mjs';
import { discard, exportResult } from '../src/export.mjs';

const USAGE = `사용법:
  node scripts/pp.mjs init  <폴더> <기능 이름>   없는 파일만 빈 틀로 만든다
  node scripts/pp.mjs check <폴더> [--json]      지금 단계와 추가돼야 완성인 것을 보여 준다
  node scripts/pp.mjs sheet <폴더>               요구사항 대조 검토지를 JSON으로 낸다
  node scripts/pp.mjs export <폴더> <결과 폴더> [--force] [--keep]
                                                 완료된 기획 PRD와 SDD 스펙을 두 파일로 내보내고 작업 폴더를 지운다
  node scripts/pp.mjs discard <폴더>             내보내지 않고 작업 폴더를 지운다`;

const planTemplate = (name) => `# ${name} 기획\n\n상태: 작성중\n\n## 배경\n\n## 페르소나\n\n## 요구사항\n\n## 정할 것\n`;
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
  const confirmed = parsePlan(readFileSync(planPath, 'utf8')).status === '확정';
  if (confirmed && !existsSync(sddPath)) {
    writeFileSync(sddPath, sddTemplate(name));
    made.push(sddPath);
  }
  console.log(made.length ? `만들었다: ${made.join(', ')}` : '새로 만들 파일이 없다.');
  if (!confirmed) console.log('sdd.md는 기획이 확정된 뒤에 만든다.');
}

function run([command, folder, ...rest]) {
  if (!command || !folder || !['init', 'check', 'sheet', 'export', 'discard'].includes(command)) {
    console.error(USAGE);
    return 2;
  }
  if (command === 'init') {
    init(folder, rest.join(' ').trim());
    return 0;
  }
  if (command === 'export') {
    const target = rest.find((arg) => !arg.startsWith('--'));
    if (!target) throw new InputError('결과 폴더 경로가 필요하다.');
    const result = exportResult(folder, target, { force: rest.includes('--force'), keep: rest.includes('--keep') });
    console.log(`내보냈다: ${result.paths.join(', ')}${result.removed ? `\n지웠다: ${folder}` : ''}`);
    return 0;
  }
  if (command === 'discard') {
    discard(folder);
    console.log(`지웠다: ${folder}`);
    return 0;
  }
  if (command === 'sheet') {
    const read = (file) => readFileSync(join(folder, file), 'utf8');
    if (!existsSync(join(folder, FILES.sdd))) throw new InputError('sdd.md가 없다. 기획을 확정하고 init으로 만든다.');
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
