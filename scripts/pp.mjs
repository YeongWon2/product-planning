#!/usr/bin/env node
// 하네스 CLI (docs/harness.md 1장). 문서 내용을 쓰지 않는다. init은 빈 틀을, export·import는 결과물을 옮긴다.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve as resolvePath } from 'node:path';
import { FEATURE } from '../src/brief.mjs';
import { FILES, InputError, evaluate, formatReport, load } from '../src/report.mjs';
import { citable } from '../src/cite.mjs';
import { sheet } from '../src/trace.mjs';
import { discard, exportResult, importResult } from '../src/export.mjs';

const USAGE = `사용법:
  node scripts/pp.mjs init    <폴더> [기능 이름]       지금 단계에 필요한 파일 가운데 없는 것만 빈 틀로 만든다
  node scripts/pp.mjs check   <폴더> [--json]          지금 단계와 추가돼야 완성인 것을 보여 준다
  node scripts/pp.mjs sheet   <폴더>                   요구사항 대조 검토지를 JSON으로 낸다
  node scripts/pp.mjs quotes  <폴더>                   개발 스펙이 인용할 수 있는 원문 목록을 JSON으로 낸다
  node scripts/pp.mjs export  <폴더> <프로젝트 폴더> [--force] [--keep]
                                                       결과물을 <프로젝트>/docs/product/{기능}/에 내보낸다
  node scripts/pp.mjs import  <프로젝트 폴더> <폴더>   프로젝트의 결과물을 작업 폴더로 다시 읽어 온다
  node scripts/pp.mjs discard <폴더>                   내보내지 않고 작업 폴더를 지운다`;

const TEMPLATES = {
  brief: (name, feature) => `# ${name} 비즈니스 요구사항\n\n상태: 작성중\n기능: ${feature}\n\n## 왜 지금\n\n## 목표\n\n## 비즈니스 요구사항\n\n## 범위 밖\n\n## 제약\n\n## 정할 것\n`,
  plan: (name) => `# ${name} 기획\n\n상태: 작성중\n\n## 페르소나\n\n## 요구사항\n\n## 정할 것\n`,
  spec: (name) => `# ${name} 기획 상세 스펙\n\n상태: 작성중\n\n## 상태표\n\n| 대상 | 상태 | 뜻 |\n|---|---|---|\n\n## 조건표\n\n| 조건 | 갈래 | 정해지는 곳 |\n|---|---|---|\n\n## 진행표\n\n| 단위 | 이름 | 요구사항 | 진행 |\n|---|---|---|---|\n`,
  dev: (name) => `# ${name} 개발 스펙\n\n상태: 작성중\n\n## 결정 기록\n\n## 아키텍처\n\n| 번호 | 구성 요소 | 책임 | 하지 않는 것 | 기대는 곳 |\n|---|---|---|---|---|\n\n## 데이터 모델\n\n## 계약\n\n## 오류·경계\n\n## 비기능 제약\n\n## 작업 계획\n\n## 검증\n\n## 프로젝트 규칙 대조\n\n| 규칙 | 원문 | 결과 |\n|---|---|---|\n\n## 기획에 돌려보낼 것\n\n## 정할 것\n`,
  diagram: (name) => `# ${name} 시퀀스 다이어그램\n\n상태: 작성중\n`,
};
// 이 단계에서 막히면 다음 파일 틀을 만들 차례다.
const NEXT_FILES = { '기획 없음': ['plan'], '기획 상세 스펙 없음': ['spec'], '개발 스펙 없음': ['dev', 'diagram'] };

function init(folder, givenName) {
  mkdirSync(folder, { recursive: true });
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

function quotes(folder) {
  const { brief, plan, spec } = load(folder);
  if (!spec) throw new InputError('spec.md가 없다. 기획 상세 스펙을 먼저 쓴다.');
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
  const commands = ['init', 'check', 'sheet', 'quotes', 'export', 'import', 'discard'];
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
  if (command === 'export') {
    if (!args[0]) throw new InputError('프로젝트 폴더 경로가 필요하다.');
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
  if (!(error instanceof InputError) && error.code !== 'ENOENT') throw error;
  console.error(error.message);
  process.exitCode = 2;
}
