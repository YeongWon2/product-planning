#!/usr/bin/env node
// 하네스 CLI (docs/harness.md 1장). 문서 내용을 쓰지 않는다. init은 빈 틀을, export·import는 결과물을 옮긴다.
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve as resolvePath } from 'node:path';
import { FEATURE } from '../src/brief.mjs';
import { checkPlan, lockFingerprint } from '../src/plan.mjs';
import { FILES, InputError, evaluate, formatReport, load } from '../src/report.mjs';
import { citable } from '../src/cite.mjs';
import { sheet } from '../src/trace.mjs';
import { discard, exportResult, importResult, keepPrivate } from '../src/export.mjs';
import { userFlow } from '../src/flow.mjs';

const USAGE = `사용법:
  node scripts/pp.mjs init    <폴더> [기능 이름]       지금 단계에 필요한 파일 가운데 없는 것만 빈 틀로 만든다
  node scripts/pp.mjs check   <폴더> [--json]          지금 단계와 추가돼야 완성인 것을 보여 준다
  node scripts/pp.mjs lock    <폴더>                   사람이 확인한 요구사항을 잠근다
  node scripts/pp.mjs unlock  <폴더>                   요구사항 잠금을 푼다
  node scripts/pp.mjs sheet   <폴더>                   요구사항 대조 검토지를 JSON으로 낸다
  node scripts/pp.mjs quotes  <폴더>                   개발 스펙이 인용할 수 있는 원문 목록을 JSON으로 낸다
  node scripts/pp.mjs flow    <폴더>                   기획 상세 스펙에서 유저 플로우(Mermaid)를 만들어 보여 준다
  node scripts/pp.mjs export  <폴더> [프로젝트 폴더] [--force] [--keep]
                                                       결과물을 <프로젝트>/docs/product/{기능}/에 내보낸다
                                                       (폴더가 <프로젝트>/.product-planning/{기능}/이면 프로젝트는 생략)
  node scripts/pp.mjs import  <프로젝트 폴더> <폴더>   프로젝트의 결과물을 작업 폴더로 다시 읽어 온다
  node scripts/pp.mjs discard <폴더>                   내보내지 않고 작업 폴더를 지운다`;

const TEMPLATES = {
  brief: (name, feature) => `# ${name} 비즈니스 요구사항\n\n상태: 작성중\n기능: ${feature}\n\n## 왜 지금\n\n## 목표\n\n## 비즈니스 요구사항\n\n## 범위 밖\n\n## 제약\n\n## 정할 것\n`,
  plan: (name) => `# ${name} 기획\n\n상태: 작성중\n\n## 페르소나\n\n## 요구사항\n\n## 정할 것\n`,
  spec: (name) => `# ${name} 기획 상세 스펙\n\n상태: 작성중\n\n## 상태표\n\n| 대상 | 상태 | 뜻 |\n|---|---|---|\n\n## 조건표\n\n| 조건 | 갈래 | 정해지는 곳 |\n|---|---|---|\n\n## 진행표\n\n| 단위 | 이름 | 요구사항 | 진행 |\n|---|---|---|---|\n`,
  dev: (name) => `# ${name} 개발 스펙\n\n상태: 작성중\n\n## 결정 기록\n\n## 아키텍처\n\n| 번호 | 구성 요소 | 책임 | 하지 않는 것 | 기대는 곳 |\n|---|---|---|---|---|\n\n## 데이터 모델\n\n## 계약\n\n## 흐름 설계\n\n## 오류·경계\n\n## 비기능 제약\n\n## 작업 계획\n\n## 검증\n\n## 프로젝트 규칙 대조\n\n| 규칙 | 원문 | 결과 |\n|---|---|---|\n\n## 기획에 돌려보낼 것\n\n## 정할 것\n`,
};
// 이 단계에서 막히면 다음 파일 틀을 만들 차례다.
const NEXT_FILES = { '기획 없음': ['plan'], '기획 상세 스펙 없음': ['spec'], '개발 스펙 없음': ['dev'] };

function init(folder, givenName) {
  mkdirSync(folder, { recursive: true });
  keepPrivate(folder);
  const made = [];
  const write = (key, name, feature) => {
    const path = join(folder, FILES[key]);
    if (existsSync(path)) return;
    writeFileSync(path, TEMPLATES[key](name, feature));
    made.push(path);
  };
  const feature = basename(resolvePath(folder));
  if (!existsSync(join(folder, FILES.brief))) {
    if (!givenName) throw new InputError('처음 만들 때는 기능 이름이 필요하다.');
    write('brief', givenName, FEATURE.test(feature) ? feature : '');
  }
  const name = givenName || load(folder).brief.title.replace(/\s*비즈니스 요구사항$/, '');
  const report = evaluate(folder);
  for (const key of NEXT_FILES[report.issues[0]?.kind] ?? []) write(key, name);
  console.log(made.length ? `만들었다: ${made.join(', ')}` : '새로 만들 파일이 없다.');
  console.log(`단계  ${evaluate(folder).stage}`);
}

// 기획 2-4단계까지 잠금 말고 남은 것이 없을 때만 잠근다.
function lock(folder) {
  const { brief, plan } = load(folder);
  if (!plan) throw new InputError('plan.md가 없다. 요구사항을 먼저 세운다.');
  const fingerprint = lockFingerprint(plan, brief);
  const left = checkPlan(plan, brief, { lock: { fingerprint } }).filter((issue) => issue.step <= 10);
  if (left.length) throw new InputError(`요구사항이 아직 다 갖춰지지 않았다: ${[...new Set(left.map((issue) => issue.kind))].join(', ')}. check로 먼저 끝낸다.`);
  writeFileSync(join(folder, FILES.lock), `${JSON.stringify({ fingerprint }, null, 2)}\n`);
  console.log(`잠갔다: 요구사항 ${plan.requirements.length}개, 완성 기준 ${plan.requirements.reduce((n, r) => n + r.criteria.length, 0)}개`);
}

function quotes(folder) {
  const { brief, plan, spec } = load(folder);
  if (!plan || !spec) throw new InputError('plan.md나 spec.md가 없다. 기획과 기획 상세 스펙을 먼저 쓴다.');
  const sources = citable(brief, plan, spec);
  return {
    instructions: [
      '질문할 때 아래 quote 하나를 원문 그대로 인용한다.',
      '답을 옮길 때 그 quote를 출처: 줄에 그대로 쓴다. 앞에 문서 이름(PRD › 또는 기획 상세 스펙 ›)을 붙여도 된다.',
      '번호(BR1, R1-2, F1처럼)만으로 출처를 쓸 수도 있다.',
    ],
    quotes: [...sources.paths].map(([quote, doc]) => ({ doc, quote })),
    ids: [...sources.ids],
  };
}

function run([command, first, ...rest]) {
  const commands = ['init', 'check', 'lock', 'unlock', 'sheet', 'quotes', 'flow', 'export', 'import', 'discard'];
  if (!command || !first || !commands.includes(command)) {
    console.error(USAGE);
    return 2;
  }
  const flags = rest.filter((arg) => arg.startsWith('--'));
  const args = rest.filter((arg) => !arg.startsWith('--'));
  if (command === 'init') {
    init(first, args.join(' ').trim());
    return 0;
  }
  if (command === 'lock') {
    lock(first);
    return 0;
  }
  if (command === 'unlock') {
    rmSync(join(first, FILES.lock), { force: true });
    console.log('잠금을 풀었다. 요구사항을 고친 뒤 사람이 확인하면 다시 lock한다.');
    return 0;
  }
  if (command === 'export') {
    const result = exportResult(first, args[0], { force: flags.includes('--force'), keep: flags.includes('--keep') });
    console.log(`내보냈다: ${result.paths.join(', ')}`);
    console.log(result.removed ? `지웠다: ${first}` : result.withDev ? '' : '기획만 내보냈다. 개발 스펙을 이어 쓰도록 작업 폴더는 남겼다.');
    return 0;
  }
  if (command === 'import') {
    if (!args[0]) throw new InputError('작업 폴더 경로가 필요하다.');
    console.log(`읽어 왔다: ${importResult(first, args[0]).paths.join(', ')}`);
    return 0;
  }
  if (command === 'discard') {
    discard(first);
    console.log(`지웠다: ${first}`);
    return 0;
  }
  if (command === 'sheet') {
    const { plan, spec } = load(first);
    if (!plan || !spec) throw new InputError('spec.md가 없다. 기획을 확정하고 init으로 만든다.');
    console.log(JSON.stringify(sheet(plan, spec), null, 2));
    return 0;
  }
  if (command === 'flow') {
    const { spec } = load(first);
    if (!spec) throw new InputError('spec.md가 없다. PRD를 확정하고 init으로 만든다.');
    console.log(userFlow(spec));
    return 0;
  }
  if (command === 'quotes') {
    console.log(JSON.stringify(quotes(first), null, 2));
    return 0;
  }
  const report = evaluate(first);
  console.log(flags.includes('--json') ? JSON.stringify(report, null, 2) : formatReport(report));
  return report.step === null ? 0 : 1;
}

try {
  process.exitCode = run(process.argv.slice(2));
} catch (error) {
  if (error instanceof InputError || error.code === 'ENOENT') {
    console.error(error.message);
    process.exitCode = 2;
  } else {
    // 작업 파일이 어떤 모양이어도 스택 트레이스로 끝나지 않게 한다. 하네스 버그이므로 따로 알린다.
    console.error(`하네스 내부 오류: ${error.message}\n작업 파일은 그대로다. PP_DEBUG=1로 다시 돌리면 자세한 위치가 나온다.`);
    if (process.env.PP_DEBUG) console.error(error.stack);
    process.exitCode = 3;
  }
}
