import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkPlan, parsePlan } from '../src/plan.mjs';
import { parseBrief } from '../src/brief.mjs';
import { checkSpec, parseSpec } from '../src/spec.mjs';
import { evaluate } from '../src/report.mjs';
import { sentenceIssues } from '../src/text.mjs';

const EXAMPLE = new URL('../examples/post-edit/', import.meta.url).pathname;
const CLI = new URL('../scripts/pp.mjs', import.meta.url).pathname;
const read = (file) => readFileSync(join(EXAMPLE, file), 'utf8');
const brief = parseBrief(read('brief.md'));
const plan = parsePlan(read('plan.md'));
const kinds = (issues) => issues.map((issue) => issue.kind);

// 예시를 post-edit 이름의 임시 폴더로 복사하고 파일을 고친다. 고침 값이 null이면 그 파일을 지운다.
function copyExample(edit = {}) {
  const dir = join(mkdtempSync(join(tmpdir(), 'pp-')), 'post-edit');
  cpSync(EXAMPLE, dir, { recursive: true });
  for (const [file, change] of Object.entries(edit)) {
    if (change === null) rmSync(join(dir, file));
    else writeFileSync(join(dir, file), change(readFileSync(join(dir, file), 'utf8')));
  }
  return dir;
}
const stageOf = (edit) => evaluate(copyExample(edit));
// 요구사항을 고친 뒤 사람이 확인해 다시 잠근 상태를 만든다.
function relocked(edit) {
  const dir = copyExample({ ...edit, 'lock.json': null });
  assert.equal(spawnSync('node', [CLI, 'lock', dir]).status, 0);
  return evaluate(dir);
}

test('예시는 네 문서 끝까지 통과한다', () => {
  const report = evaluate(EXAMPLE);
  assert.equal(report.stage, '완료');
  assert.deepEqual(report.done, { plan: true, dev: true });
  assert.deepEqual(report.progress.perRequirement, [{ id: 'R1', met: 3, total: 3 }], '제외한 기준은 세지 않는다');
});

test('비즈니스 요구사항: 원문 없는 BR과 숫자 없는 지표를 막는다', () => {
  const report = stageOf({ 'brief.md': (s) => s.replace(/원문: .+\n/, '').replace('월 30건에서 5건 아래로', '많이') });
  assert.equal(report.stage, '기획 › 1-3. 목표');
  assert.deepEqual(kinds(report.issues), ['지표 없는 목표']);
  assert.ok(report.rest >= 1, '뒤 단계의 원문 없음은 따로 센다');
  assert.ok(kinds(evaluate(copyExample({ 'brief.md': (s) => s.replace(/원문: .+\n/, '') })).issues).includes('원문 없음'));
});

test('비즈니스 요구사항이 확정 전이면 기획으로 넘어가지 않는다', () => {
  const report = stageOf({ 'brief.md': (s) => s.replace('상태: 확정', '상태: 작성중') });
  assert.equal(report.stage, '기획 › 1-6. 확정');
  assert.equal(report.progress, null);
});

test('기획: 근거 BR과 우선순위가 있어야 하고, BR마다 요구사항이 있어야 한다', () => {
  const noBasis = stageOf({ 'plan.md': (s) => s.replace('근거: BR1\n', '') });
  assert.equal(noBasis.stage, '기획 › 2-2. 요구사항');
  assert.deepEqual(kinds(noBasis.issues), ['근거 없는 요구사항']);
  const noPriority = stageOf({ 'plan.md': (s) => s.replace('우선순위: P1\n', '') });
  assert.deepEqual(kinds(noPriority.issues), ['우선순위 없음', 'P1 없음']);
  const orphan = checkPlan(plan, parseBrief(read('brief.md').replace('## 범위 밖', '### BR2 관리자도 글을 막을 수 있어야 한다\n\n근거 목표: G1\n원문: "관리자도요"\n\n## 범위 밖')));
  assert.ok(kinds(orphan).includes('요구사항 없는 BR'));
});

test('잠금: 요구사항이 다 서면 잠가야 하고, 잠근 뒤 바뀌면 다시 확인한다', () => {
  const unlocked = stageOf({ 'lock.json': null });
  assert.equal(unlocked.stage, '기획 › 2-4. 완성 기준과 잠금');
  assert.deepEqual(kinds(unlocked.issues), ['잠금 전']);
  const changed = stageOf({ 'plan.md': (s) => s.replace('고친 뒤에도 댓글이 그대로 남는다.', '고친 뒤에도 댓글과 좋아요가 그대로 남는다.') });
  assert.deepEqual(kinds(changed.issues), ['잠근 뒤 바뀜']);
  assert.match(changed.next, /unlock 뒤 다시 lock/);
  const dir = copyExample({ 'lock.json': null, 'plan.md': (s) => s.replace('우선순위: P1\n', '') });
  assert.equal(spawnSync('node', [CLI, 'lock', dir]).status, 2, '요구사항이 덜 서면 잠그지 않는다');
  const ready = copyExample({ 'lock.json': null });
  assert.equal(spawnSync('node', [CLI, 'lock', ready]).status, 0);
  assert.equal(evaluate(ready).stage, '완료');
  assert.equal(spawnSync('node', [CLI, 'unlock', ready]).status, 0);
  assert.equal(existsSync(join(ready, 'lock.json')), false);
});

test('페르소나가 요구사항에 안 쓰이면 묻는다', () => {
  const extra = parsePlan(read('plan.md').replace('## 요구사항', '### P2 관리자\n\n원하는 것\n- 신고된 글을 막고 싶다.\n\n행동 패턴\n- 아침마다 신고 목록을 본다.\n\n## 요구사항'));
  assert.ok(kinds(checkPlan(extra, brief)).includes('안 쓰인 페르소나'));
});

test('기획 문장 규칙: 두 문장, 개발 용어, 모호한 말, 긴 문장, AI 말투, 번역투, 존댓말', () => {
  assert.deepEqual(kinds(sentenceIssues('고친다. 저장한다.')), ['한 줄 두 문장']);
  assert.deepEqual(kinds(sentenceIssues('API로 저장한다.')), ['개발 용어']);
  assert.deepEqual(kinds(sentenceIssues('필요 시 알림 등을 보낸다.')), ['모호한 말']);
  assert.deepEqual(kinds(sentenceIssues('가'.repeat(81))), ['긴 문장']);
  assert.deepEqual(kinds(sentenceIssues('다양한 기능을 원활하게 쓴다.')), ['AI 말투']);
  assert.deepEqual(kinds(sentenceIssues('글이 관리자에 의해 잠긴다.')), ['번역투']);
  assert.deepEqual(kinds(sentenceIssues('글을 고칠 수 있어요.')), ['존댓말']);
  assert.deepEqual(sentenceIssues('오타를 발견하면 바로 고치고 싶다.'), []);
});

test('기획 상세 스펙 흐름: 빠진 상태와 갈래, 없는 함수, 끝 없는 흐름, 빠진 예외 흐름', () => {
  const spec = parseSpec(read('spec.md')
    .replace('| 게시글 | 잠김 |', '| 게시글 | 삭제됨 | 지운 글이다 |\n| 게시글 | 잠김 |')
    .replace('- 1a. 고친 내용이 있는가: 아니오\n  - 1a1. 모달이 바로 닫힌다\n  - 1a2. 끝난다\n', '')
    .replace('3a1. FN1 수정 중 닫기를 따른다', '3a1. FN9 없는 흐름을 따른다')
    .replace('  - 1b2. 끝난다\n', '')
    .replace(/### 예외 흐름\n[\s\S]*?(?=## FN1)/, ''));
  const found = kinds(checkSpec(spec, plan));
  for (const kind of ['빠진 상태', '빠진 갈래', '없는 함수', '끝 없는 흐름', '안 쓰인 함수', '예외 흐름 없음']) assert.ok(found.includes(kind), kind);
});

test('기획 상세 스펙 흐름: 표에 없는 재료, 너무 깊은 갈림, 기호, 없는 단계', () => {
  const deep = '  - 1a2. 끝난다\n  - 1a2a. 수정 권한이 있는가: 예\n    - 1a2a1. 끝난다\n    - 1a2a1a. 수정 권한이 있는가: 예\n      - 1a2a1a1. 끝난다\n      - 1a2a1a1a. 수정 권한이 있는가: 예\n        - 1a2a1a1a1. 끝난다\n';
  const spec = parseSpec(read('spec.md')
    .replace('  - 1a2. 끝난다\n', deep)
    .replace('1b1. 수정 단추가 비활성이다', '1b1. 게시글이 잠김에서 보관됨으로 바뀐다')
    .replace('3b2. 2로 돌아간다', '3b2. 9로 돌아간다')
    .replace('2. 수정 모달이 열린다', '2. → 수정 모달이 열린다'));
  const found = kinds(checkSpec(spec, plan));
  assert.ok(found.includes('너무 깊은 흐름'));
  assert.ok(found.includes('없는 재료'), '상태표에 없는 보관됨');
  assert.ok(found.includes('기호'));
  assert.ok(found.includes('없는 단계'));
});

test('기획 상세 스펙 항목 표: 빠진 항목, 없는 행위자, 모르는 항목', () => {
  const spec = parseSpec(read('spec.md')
    .replace('| 실패 시 보장 | 저장하지 못하면 원래 글이 그대로 남는다 |\n', '')
    .replace('| 행위자 | P1 |', '| 행위자 | P9 |')
    .replace('| 사전 조건 |', '| 빈도 | 하루 두세 번이다 |\n| 사전 조건 |'));
  const found = kinds(checkSpec(spec, plan));
  for (const kind of ['빠진 항목', '없는 행위자', '모르는 항목']) assert.ok(found.includes(kind), kind);
});

test('요구사항이 유스케이스에 없거나 진행표가 흐름과 다르면 단위 나누기에서 막는다', () => {
  const report = stageOf({ 'spec.md': (s) => s.replace('## F1 · 게시글 수정 · R1', '## F1 · 게시글 수정').replace('| FN1 | 수정 중 닫기 | R1 | 완료 |', '| FN1 | 수정 중 닫기 | R1 | 끝 |') });
  assert.equal(report.stage, '기획 › 4-3. 단위 나누기');
  assert.deepEqual(kinds(report.issues), ['유스케이스 없는 요구사항', '진행표 불일치']);
});

test('대조: 빠진 것은 그대로 보여 주고, 바뀐 기준과 근거 줄은 낡은 것으로 본다', () => {
  const missing = stageOf({ 'trace.json': (s) => { const t = JSON.parse(s); t['R1-2'] = { verdict: 'missing', missing: '저장한 뒤 댓글이 어떻게 되는지 줄이 있어야 완성이다.', fingerprint: t['R1-2'].fingerprint }; return JSON.stringify(t); } });
  assert.equal(missing.stage, '기획 › 4-5. 요구사항 대조');
  assert.deepEqual(missing.issues.map((i) => i.message), ['R1-2 저장한 뒤 댓글이 어떻게 되는지 줄이 있어야 완성이다.']);
  assert.equal(missing.progress.percent, 67);

  const stale = relocked({
    'plan.md': (s) => s.replace('고친 뒤에도 댓글이 그대로 남는다.', '고친 뒤에도 댓글과 좋아요가 그대로 남는다.'),
    'spec.md': (s) => s.replace('수정 모달이 열린다', '수정 화면이 열린다'),
  });
  assert.deepEqual(kinds(stale.issues), ['대조 낡음', '대조 낡음']);
});

test('기획이 끝나고 개발 파일이 없으면 기획 완료로 알린다', () => {
  const report = stageOf({ 'dev.md': null });
  assert.equal(report.stage, '기획 완료');
  assert.deepEqual(report.done, { plan: true, dev: false });
  assert.match(report.next, /개발 스펙으로 넘어갈지/);
});

test('개발 스펙: 출처가 없거나 기획 원문과 다르면 막는다', () => {
  const noSource = stageOf({ 'dev.md': (s) => s.replace('출처: PRD › 범위 밖 › 고친 기록을 남이 보는 기능은 이번에 하지 않는다.\n', '') });
  assert.equal(noSource.stage, '개발 › 5-1. 결정');
  assert.deepEqual(kinds(noSource.issues), ['출처 없음']);
  const stale = relocked({ 'brief.md': (s) => s.replace('- 고친 기록을 남이 보는 기능은 이번에 하지 않는다.', '- 고친 기록 보기는 이번에 하지 않는다.') });
  assert.equal(stale.stage, '개발 › 5-1. 결정');
  assert.deepEqual(kinds(stale.issues), ['출처 낡음']);
});

test('개발 스펙: 기획의 행동·조건·제약을 인용한 항목이 없으면 안 물어봄으로 알린다', () => {
  const action = stageOf({ 'dev.md': (s) => s.replace(/### D3[\s\S]*?(?=### D4)/, '').replace(', D3, D4', ', D4') });
  assert.equal(action.stage, '개발 › 5-4. 계약');
  assert.deepEqual(kinds(action.issues), ['안 물어봄']);
  assert.match(action.issues[0].message, /사용자가 수정을 누른다/);
  const constraint = stageOf({ 'dev.md': (s) => s.replace('출처: PRD › 제약 › 11월 말 업데이트에 함께 나가야 한다.', '출처: D1') });
  assert.deepEqual(kinds(constraint.issues), ['안 물어봄']);
});

test('개발 스펙: 거꾸로 의존, 이름 없는 실패, 검증 없는 기준', () => {
  assert.deepEqual(kinds(stageOf({ 'dev.md': (s) => s.replace('| 수정 모달을 열고 닫고 고친 내용을 보낸다 | 권한을 최종 판단하지 않는다 | A2 |', '| 수정 모달을 열고 닫고 고친 내용을 보낸다 | 권한을 최종 판단하지 않는다 | |') }).issues), ['거꾸로 의존']);
  assert.deepEqual(kinds(stageOf({ 'dev.md': (s) => s.replace('실패: E1, E2', '실패: E1, E2, E3') }).issues), ['이름 없는 실패']);
  assert.deepEqual(kinds(stageOf({ 'dev.md': (s) => s.replace(/- V3 .+\n/, '') }).issues), ['검증 없는 기준']);
});

test('흐름 설계: 빠진 단계, 다른 받는 곳, 없는 계약, 실패 없는 예외, 설계 없는 계약', () => {
  const found = (change) => kinds(stageOf({ 'dev.md': change }).issues);
  assert.deepEqual(found((s) => s.replace('| 대안 흐름 › 1b. 게시글 상태: 잠김 | A1 | 없음 | M1 | 없음 |\n', '')), ['설계 없는 단계']);
  assert.deepEqual(found((s) => s.replace('| 기본 흐름 › 3. 사용자가 글을 고치고 저장을 누른다 | A1, A2 |', '| 기본 흐름 › 3. 사용자가 글을 고치고 저장을 누른다 | A2 |')), ['다른 받는 곳']);
  assert.deepEqual(found((s) => s.replace('| 예외 흐름 › 3b. 저장이 실패한다 | A1, A2 | C1 | M1 | E2 |', '| 예외 흐름 › 3b. 저장이 실패한다 | A1, A2 | C1 | M1 | 없음 |')), ['실패 없는 예외']);
  assert.deepEqual(found((s) => s.replace('| A1, A2 | C1 | M1 | E1, E2 |', '| A1, A2 | C9 | M1 | E1, E2 |')), ['없는 계약']);
  assert.ok(found((s) => s.replace(/\| C1 \|/g, '| 없음 |')).includes('설계 없는 계약'));
  assert.deepEqual(found((s) => s.replace('### FN1 수정 중 닫기\n', '### FN2 수정 중 닫기\n')), ['없는 유스케이스', '설계 없는 유스케이스']);
});

test('유저 플로우: 기획 상세 스펙에서 만들고, 갈림은 화살표 이름, 예외는 점선, 함수는 그 흐름으로 간다', () => {
  const flow = execFileSync('node', [CLI, 'flow', EXAMPLE], { encoding: 'utf8' });
  assert.match(flow, /^flowchart TD\n  subgraph F1\["F1 게시글 수정"\]/);
  assert.match(flow, /F1_1 -->\|"1a\. 수정 권한이 있는가: 아니오"\| F1_1a1/);
  assert.match(flow, /F1_3 -\.->\|"3b\. 저장이 실패한다"\| F1_3b1/);
  assert.match(flow, /F1_3b1 --> F1_2/, '돌아가는 단계로 잇는다');
  assert.match(flow, /\| FN1_start/, '함수를 따르면 그 함수 흐름의 시작으로 간다');
  assert.match(flow, /#quot;저장하지 않고 닫을까요\?#quot;/, '글 안의 따옴표는 바꿔 써서 그림이 깨지지 않는다');
});

test('예외 흐름과 실패 시 보장: 오류와 결정이 인용한다', () => {
  const exception = stageOf({ 'dev.md': (s) => s.replace('출처: F1 › 예외 흐름 › 3b. 저장이 실패한다', '출처: F1 › 대안 흐름 › 1a. 수정 권한이 있는가: 아니오') });
  assert.equal(exception.stage, '개발 › 5-6. 오류');
  assert.deepEqual(exception.issues.map((i) => i.message), ['예외 흐름 "F1 › 예외 흐름 › 3b. 저장이 실패한다"를 인용한 오류가 없다.']);
  const guarantee = stageOf({ 'dev.md': (s) => s.replace('출처: F1 › 실패 시 보장: 저장하지 못하면 원래 글이 그대로 남는다', '출처: D1') });
  assert.deepEqual(kinds(guarantee.issues), ['안 물어봄']);
  assert.match(guarantee.issues[0].message, /실패 시 보장/);
});

test('CLI: 종료 코드, 단계마다 init, quotes', () => {
  assert.equal(spawnSync('node', [CLI, 'check', EXAMPLE]).status, 0);
  assert.equal(spawnSync('node', [CLI, 'check', '/없는/폴더']).status, 2);
  assert.equal(spawnSync('node', [CLI]).status, 2);
  const dir = join(mkdtempSync(join(tmpdir(), 'pp-')), 'new-feature');
  assert.match(execFileSync('node', [CLI, 'init', dir, '새 기능'], { encoding: 'utf8' }), /brief\.md/);
  assert.equal(existsSync(join(dir, 'plan.md')), false, '비즈니스 요구사항이 확정되기 전에는 기획 틀을 만들지 않는다');
  const fresh = spawnSync('node', [CLI, 'check', dir], { encoding: 'utf8' });
  assert.equal(fresh.status, 1);
  assert.match(fresh.stdout, /단계 {2}기획 › 1-2\. 왜 지금/);

  const done = copyExample({ 'dev.md': null });
  assert.match(execFileSync('node', [CLI, 'init', done], { encoding: 'utf8' }), /dev\.md/);
  assert.match(spawnSync('node', [CLI, 'check', done], { encoding: 'utf8' }).stdout, /단계 {2}개발 › 5-1\. 결정/);

  const sheet = JSON.parse(execFileSync('node', [CLI, 'sheet', EXAMPLE], { encoding: 'utf8' }));
  assert.equal(sheet.criteria.length, 3);
  assert.ok(sheet.lines.every((line) => /^(F|FN)\d+ › /.test(line)));
  const quotes = JSON.parse(execFileSync('node', [CLI, 'quotes', EXAMPLE], { encoding: 'utf8' }));
  assert.ok(quotes.quotes.some(({ quote }) => quote === '범위 밖 › 고친 기록을 남이 보는 기능은 이번에 하지 않는다.'));
  assert.ok(quotes.ids.includes('BR1'));
});

test('레포 문서는 200줄 이하다', () => {
  for (const file of ['docs/design.md', 'docs/brief-guide.md', 'docs/planning-guide.md', 'docs/spec-guide.md', 'docs/dev-guide.md', 'docs/harness.md', 'README.md', 'skills/yw-plan/SKILL.md', 'skills/yw-dev/SKILL.md']) {
    const lines = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8').split('\n').length;
    assert.ok(lines <= 200, `${file} ${lines}줄`);
  }
});

test('export: 네 문서를 docs/product/{기능}/에 링크와 함께 내보내고 작업 흔적은 뺀다', () => {
  const dir = copyExample();
  const project = mkdtempSync(join(tmpdir(), 'pp-project-'));
  assert.equal(spawnSync('node', [CLI, 'export', dir, project]).status, 0);
  const out = (file) => readFileSync(join(project, 'docs/product/post-edit', file), 'utf8');
  const [prd, spec, flow, dev] = ['prd.md', 'spec.md', 'flow.md', 'dev.md'].map(out);
  assert.match(prd, /^# 게시글 수정 기획 PRD\n\n> 기준 문서: \[기획 PRD\]\(prd\.md\)/);
  assert.match(prd, /### <a id="r1"><\/a>R1 작성자는/);
  assert.match(prd, /쓰는 곳: \[F1\]\(spec\.md#f1\)/, '요구사항에서 그 요구사항을 다루는 트리로 간다');
  assert.match(prd, /R1-2 고친 뒤에도 댓글이 그대로 남는다\. — 쓰는 곳: \[V2\]\(dev\.md#v2\)/);
  assert.match(prd, /우선순위: P1\n/, '우선순위는 페르소나로 링크하지 않는다');
  assert.ok(prd.indexOf('## 왜 지금') < prd.indexOf('## 페르소나') && prd.indexOf('## 요구사항') < prd.indexOf('## 범위 밖'));
  assert.match(spec, /## <a id="f1"><\/a>F1 · 게시글 수정 · \[R1\]\(prd\.md#r1\)/);
  assert.match(dev, /출처: \[F1\]\(spec\.md#f1\) › 기본 흐름 › 1\. 사용자가 수정을 누른다/);
  assert.match(flow, /^# 게시글 수정 유저 플로우\n\n> 기준 문서: .*\[유저 플로우\]\(flow\.md\)/);
  assert.match(flow, /```mermaid\nflowchart TD\n[\s\S]*F1_3 -\.->\|"3b\. 저장이 실패한다"\| F1_3b1/, '예외 흐름은 점선이고 그림 안은 링크하지 않는다');
  for (const trace of [/^상태:/m, /^기능:/m, /진행표/, /정할 것/, /기획에 돌려보낼 것/]) assert.ok(![prd, spec, flow, dev].some((text) => trace.test(text)), String(trace));
  assert.equal(existsSync(dir), false, '네 문서를 다 내보내면 작업 폴더를 지운다');
  assert.equal(spawnSync('node', [CLI, 'export', copyExample(), project]).status, 2, '이미 있으면 --force 없이 덮어쓰지 않는다');
  assert.equal(spawnSync('node', [CLI, 'export', copyExample(), project, '--force']).status, 0);
});

test('export: 기획만 끝났으면 PRD·스펙·플로우만 내고 작업 폴더를 남기며, 개발을 쓰는 중이면 막는다', () => {
  const project = mkdtempSync(join(tmpdir(), 'pp-project-'));
  const planOnly = copyExample({ 'dev.md': null });
  assert.equal(spawnSync('node', [CLI, 'export', planOnly, project]).status, 0);
  assert.equal(existsSync(join(project, 'docs/product/post-edit/dev.md')), false);
  assert.equal(existsSync(join(project, 'docs/product/post-edit/flow.md')), true, '유저 플로우는 기획만 끝나도 나온다');
  assert.ok(!readFileSync(join(project, 'docs/product/post-edit/prd.md'), 'utf8').includes('dev.md'), '없는 문서는 기준 문서 줄에 없다');
  assert.equal(existsSync(planOnly), true);
  const writing = copyExample({ 'dev.md': (s) => s.replace('상태: 확정', '상태: 작성중') });
  assert.equal(spawnSync('node', [CLI, 'export', writing, mkdtempSync(join(tmpdir(), 'pp-project-'))]).status, 2);
  const unfinished = copyExample({ 'trace.json': () => '{}' });
  assert.equal(spawnSync('node', [CLI, 'export', unfinished, project]).status, 2);
});

test('import: 내보낸 결과물을 작업 파일로 되돌린다', () => {
  const project = mkdtempSync(join(tmpdir(), 'pp-project-'));
  assert.equal(spawnSync('node', [CLI, 'export', copyExample(), project]).status, 0);
  const dir = join(mkdtempSync(join(tmpdir(), 'pp-')), 'post-edit');
  assert.equal(spawnSync('node', [CLI, 'import', project, dir]).status, 0);
  for (const file of ['brief.md', 'plan.md', 'dev.md']) assert.equal(readFileSync(join(dir, file), 'utf8'), read(file), file);
  const report = evaluate(dir);
  assert.equal(report.stage, '기획 › 4-5. 요구사항 대조', '대조 파일은 결과물에 없으므로 다시 대조한다');
  assert.equal(spawnSync('node', [CLI, 'import', project, dir]).status, 2, '작업 중인 폴더를 덮어쓰지 않는다');
});

test('프로젝트 안 작업 폴더: git에서 빠지고, 프로젝트를 생략해 내보내면 흔적 없이 지워진다', () => {
  const project = mkdtempSync(join(tmpdir(), 'pp-project-'));
  const fresh = join(project, '.product-planning', 'invite');
  assert.equal(spawnSync('node', [CLI, 'init', fresh, '초대']).status, 0);
  assert.match(readFileSync(join(project, '.product-planning/.gitignore'), 'utf8'), /^\*$/m, '작업 파일은 git에 올라가지 않는다');
  assert.equal(spawnSync('node', [CLI, 'discard', fresh]).status, 0);
  assert.equal(existsSync(join(project, '.product-planning')), false, '마지막 작업 폴더를 지우면 .product-planning도 지운다');

  const dir = join(project, '.product-planning', 'post-edit');
  cpSync(copyExample(), dir, { recursive: true });
  assert.equal(spawnSync('node', [CLI, 'export', dir]).status, 0);
  assert.equal(existsSync(join(project, 'docs/product/post-edit/prd.md')), true);
  assert.equal(existsSync(join(project, '.product-planning')), false);
  assert.equal(spawnSync('node', [CLI, 'export', copyExample()]).status, 2, '프로젝트 밖 폴더는 프로젝트 경로가 있어야 한다');

  const back = join(project, '.product-planning', 'post-edit');
  assert.equal(spawnSync('node', [CLI, 'import', project, back]).status, 0);
  assert.equal(existsSync(join(project, '.product-planning/.gitignore')), true, 'import로 다시 만든 작업 폴더도 git에서 빠진다');
});

test('discard: 하네스 파일만 든 폴더만 지운다', () => {
  const stray = copyExample();
  writeFileSync(join(stray, 'other.txt'), 'x');
  assert.equal(spawnSync('node', [CLI, 'discard', stray]).status, 2);
  assert.equal(existsSync(stray), true);
  const dir = copyExample();
  assert.equal(spawnSync('node', [CLI, 'discard', dir]).status, 0);
  assert.equal(existsSync(dir), false);
});
