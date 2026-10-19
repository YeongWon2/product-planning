import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkPlan, parsePlan } from '../src/plan.mjs';
import { checkSdd, parseSdd } from '../src/sdd.mjs';
import { evaluate } from '../src/report.mjs';
import { sentenceIssues } from '../src/text.mjs';

const EXAMPLE = new URL('../examples/post-edit/', import.meta.url).pathname;
const CLI = new URL('../scripts/pp.mjs', import.meta.url).pathname;
const read = (file) => readFileSync(join(EXAMPLE, file), 'utf8');
const plan = parsePlan(read('plan.md'));
const kinds = (issues) => issues.map((issue) => issue.kind);

function copyExample(edit = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'pp-'));
  cpSync(EXAMPLE, dir, { recursive: true });
  for (const [file, change] of Object.entries(edit)) writeFileSync(join(dir, file), change(readFileSync(join(dir, file), 'utf8')));
  return dir;
}

test('예시는 끝까지 통과한다', () => {
  const report = evaluate(EXAMPLE);
  assert.equal(report.stage, '완료');
  assert.equal(report.progress.percent, 100);
  assert.deepEqual(report.progress.perRequirement, [{ id: 'R1', met: 3, total: 3 }], '제외한 기준은 세지 않는다');
});

test('기획은 앞 단계부터 하나씩 막는다', () => {
  const report = evaluate(copyExample({ 'plan.md': (s) => s.replace('행동 패턴\n- 글을 올린 직후 휴대폰으로 다시 읽어 본다.\n', '').replace('누구: P1', '누구: P9') }));
  assert.equal(report.stage, '요구사항 › 1. 페르소나');
  assert.deepEqual(kinds(report.issues), ['행동 패턴 없음']);
  assert.ok(report.rest >= 1, '뒤 단계 건수는 따로 센다');
});

test('페르소나가 요구사항에 안 쓰이면 묻는다', () => {
  const extra = parsePlan(read('plan.md').replace('## 요구사항', '### P2 관리자\n\n원하는 것\n- 신고된 글을 막고 싶다.\n\n행동 패턴\n- 아침마다 신고 목록을 본다.\n\n## 요구사항'));
  assert.ok(kinds(checkPlan(extra)).includes('안 쓰인 페르소나'));
});

test('정할 것이 남거나 확정 전이면 SDD로 넘어가지 않는다', () => {
  const report = evaluate(copyExample({ 'plan.md': (s) => s.replace('상태: 확정', '상태: 작성중').replace('## 정할 것', '## 정할 것\n\n- 관리자도 남의 글을 고칠 수 있는가?') }));
  assert.equal(report.stage, 'PRD › 7. 확정');
  assert.deepEqual(kinds(report.issues), ['정할 것 남음', '확정 전']);
  assert.equal(report.progress, null);
});

test('요약과 목표: 요약이 없거나 목표에 확인 방법이 없으면 1단계에서 막는다', () => {
  const report = evaluate(copyExample({ 'plan.md': (s) => s.replace(/## 요약\n\n(.+\n)+/, '## 요약\n\n').replace('확인: 관련 문의가 한 달 30건에서 0건이 된다.\n', '') }));
  assert.equal(report.stage, 'PRD › 5. 요약과 목표');
  assert.deepEqual(kinds(report.issues), ['요약 없음', '확인 방법 없음']);
});

test('요구사항마다 우선순위는 꼭 또는 나중에다', () => {
  assert.deepEqual(kinds(checkPlan(parsePlan(read('plan.md').replace('우선순위: 꼭\n', '')))), ['우선순위 없음']);
  assert.deepEqual(kinds(checkPlan(parsePlan(read('plan.md').replace('우선순위: 꼭', '우선순위: P0')))), ['모르는 우선순위']);
});

test('범위 밖이 비면 잠그기 전에 막고, 선택 구역과 작성자는 PRD 확정에서 막는다', () => {
  const scope = evaluate(copyExample({ 'plan.md': (s) => s.replace('- 관리자가 남의 글을 고치는 일은 이번에 하지 않는다.\n', '') }));
  assert.equal(scope.stage, '요구사항 › 4. 범위와 잠금');
  assert.deepEqual(kinds(scope.issues), ['범위 밖 없음']);
  const report = evaluate(copyExample({ 'plan.md': (s) => s.replace('작성자: 영원', '작성자:').replace('## 참고 문서\n\n없음\n', '## 참고 문서\n') }));
  assert.equal(report.stage, 'PRD › 7. 확정');
  assert.deepEqual(kinds(report.issues), ['안 물은 구역', '작성자 없음']);
});

test('잠금: 잠그기 전이나 잠근 뒤 요구사항이 바뀌면 PRD로 넘어가지 않는다', () => {
  const unlocked = copyExample();
  rmSync(join(unlocked, 'lock.json'));
  const before = evaluate(unlocked);
  assert.equal(before.stage, '요구사항 › 4. 범위와 잠금');
  assert.deepEqual(kinds(before.issues), ['잠금 전']);
  const changed = evaluate(copyExample({ 'plan.md': (s) => s.replace('우선순위: 꼭', '우선순위: 나중에') }));
  assert.deepEqual(kinds(changed.issues), ['잠근 뒤 바뀜']);
  assert.match(changed.next, /unlock 뒤 다시 lock/);
  const policy = evaluate(copyExample({ 'plan.md': (s) => s.replace('- 고친 횟수에는 제한이 없다.\n', '- 고친 횟수에는 제한이 없도록 원활하게 한다.\n') }));
  assert.equal(policy.stage, 'PRD › 6. 정책', 'PRD 단계에서 채우는 정책은 잠금에 들지 않는다');
});

test('PRD: 예외는 "상황 → 처리", 용어는 "용어: 뜻" 모양이어야 표로 낼 수 있다', () => {
  const exception = evaluate(copyExample({ 'plan.md': (s) => s.replace('- 관리자가 막은 글 → 작성자도 고칠 수 없다.', '- 관리자가 막은 글은 작성자도 고칠 수 없다.') }));
  assert.deepEqual(kinds(exception.issues), ['예외 모양']);
  const term = evaluate(copyExample({ 'plan.md': (s) => s.replace('- 막은 글: 신고가', '- 막은 글은 신고가') }));
  assert.deepEqual(kinds(term.issues), ['용어 모양']);
  const meaning = evaluate(copyExample({ 'plan.md': (s) => s.replace('신고가 쌓여 관리자가 보이지 않게 한 글', '관리자에 의해 막힌 글입니다.') }));
  assert.deepEqual(kinds(meaning.issues), ['번역투', '존댓말'], '용어의 뜻도 문장 규칙을 본다');
  const none = evaluate(copyExample({ 'plan.md': (s) => s.replace('- 관리자가 막은 글 → 작성자도 고칠 수 없다.', '- 없음') }));
  assert.match(none.issues[0].message, /예외 칸을 지운다/);
  assert.equal(evaluate(copyExample({ 'plan.md': (s) => s.replace('- R1-1 작성자는', '- R1-1: 작성자는') })).stage, '완료', 'R1-1: 콜론도 읽는다');
});

test('lock: 요구사항이 덜 갖춰지면 잠그지 않는다', () => {
  const dir = copyExample({ 'plan.md': (s) => s.replace('왜: 오타를 발견하면 바로 고치고 싶다.\n', '') });
  rmSync(join(dir, 'lock.json'));
  assert.equal(spawnSync('node', [CLI, 'lock', dir]).status, 2);
  assert.equal(existsSync(join(dir, 'lock.json')), false);
});

test('PRD: 요구사항마다 정책이 있어야 하고 배경과 정책은 길이 상한이 있다', () => {
  const report = evaluate(copyExample({ 'plan.md': (s) => s.replace(/정책\n(- .+\n)+/, '').replace('들어온다.\n', `들어온다.\n${'- 배경이 길다.\n'.repeat(4)}`) }));
  assert.equal(report.stage, 'PRD › 5. 요약과 목표');
  assert.deepEqual(kinds(report.issues), ['긴 구역']);
  assert.ok(report.rest >= 1);
  const policy = evaluate(copyExample({ 'plan.md': (s) => s.replace(/정책\n(- .+\n)+/, '') }));
  assert.equal(policy.stage, 'PRD › 6. 정책');
  assert.deepEqual(kinds(policy.issues), ['정책 없음']);
});

test('기획 문장 규칙: 두 문장, 개발 용어, 모호한 말, 긴 문장', () => {
  assert.deepEqual(kinds(sentenceIssues('고친다. 저장한다.')), ['한 줄 두 문장']);
  assert.deepEqual(kinds(sentenceIssues('API로 저장한다.')), ['개발 용어']);
  assert.deepEqual(kinds(sentenceIssues('필요 시 알림 등을 보낸다.')), ['모호한 말']);
  assert.deepEqual(kinds(sentenceIssues('가'.repeat(81))), ['긴 문장']);
  assert.deepEqual(sentenceIssues('오타를 발견하면 바로 고치고 싶다.'), []);
});

test('AI 말투 규칙: 상투어, 번역투, 꾸밈, 존댓말', () => {
  assert.deepEqual(kinds(sentenceIssues('다양한 글을 원활하게 고친다.')), ['AI 말투']);
  assert.deepEqual(kinds(sentenceIssues('체계적이고 효과적이며 안정적으로 고친다.')), ['AI 말투']);
  assert.deepEqual(kinds(sentenceIssues('수정은 작성자에 의해 진행된다.')), ['번역투']);
  assert.deepEqual(kinds(sentenceIssues('**바로** 고친다.')), ['꾸밈']);
  assert.deepEqual(kinds(sentenceIssues('작성자는 글을 고칠 수 있습니다.')), ['존댓말']);
  assert.deepEqual(sentenceIssues('알림을 통해 작성자에게 알린다.'), [], '~를 통해는 막지 않는다');
  assert.deepEqual(sentenceIssues('휴대폰이 손에 있어서 바로 고친다.'), [], '~에 있어서는 막지 않는다');
  assert.deepEqual(sentenceIssues('글을 올린 직후 다시 읽어 본다. (가정)'), [], '(가정)은 문장 수에 넣지 않는다');
  assert.deepEqual(sentenceIssues('등산을 간다.'), []);
  assert.deepEqual(kinds(sentenceIssues('커피 등을 산다.')), ['모호한 말']);
  assert.deepEqual(kinds(sentenceIssues('취소할 수 있어요.')), ['존댓말']);
});

test('SDD 트리: 빠진 상태와 갈래, 없는 함수, 끝 없는 가지', () => {
  const sdd = parseSdd(read('sdd.md')
    .replace('| 게시글 | 잠김 |', '| 게시글 | 삭제됨 | 지운 글이다 |\n| 게시글 | 잠김 |')
    .replace('    - **아니오**\n      - → 모달이 바로 닫힌다\n', '')
    .replace('↪ 수정 중 닫기', '↪ 없는 흐름')
    .replace('- → [수정] 단추가 비활성이다', '- [수정] 단추가 비활성이다'));
  const found = kinds(checkSdd(sdd, plan));
  for (const kind of ['빠진 상태', '빠진 갈래', '없는 함수', '끝 없는 가지', '안 쓰인 함수']) assert.ok(found.includes(kind), kind);
});

test('SDD 트리: 표에 없는 재료와 너무 깊은 분기', () => {
  const deep = '      - **게시됨**\n        - ? 고친 내용이 있는가\n          - **예**\n            - ? 수정 권한이 있는가\n              - **예**\n                - → 끝\n              - **아니오**\n                - → 끝\n          - **아니오**\n            - → 끝\n';
  const sdd = parseSdd(read('sdd.md').replace(/      - \*\*게시됨\*\*\n(?:        .*\n)+/, deep).replace('- → [수정] 단추가 비활성이다', '- [저장] 누름 ⇒ 잠김 → 보관됨'));
  const found = kinds(checkSdd(sdd, plan));
  assert.ok(found.includes('너무 깊은 트리'));
  assert.ok(found.includes('없는 재료'), '상태표에 없는 보관됨');
});

test('요구사항이 피쳐에 없거나 진행표가 트리와 다르면 단위 나누기에서 막는다', () => {
  const report = evaluate(copyExample({ 'sdd.md': (s) => s.replace('## 피쳐 · 게시글 수정 · R1', '## 피쳐 · 게시글 수정').replace('| 수정 중 닫기 | 함수 | R1 | 완료 |', '| 수정 중 닫기 | 함수 | R1 | 끝 |') }));
  assert.equal(report.stage, 'SDD › 3. 단위 나누기');
  assert.deepEqual(kinds(report.issues), ['피쳐 없는 요구사항', '진행표 불일치']);
});

test('대조: 빠진 것은 그대로 보여 주고, 바뀐 기준과 근거 줄은 낡은 것으로 본다', () => {
  const missing = evaluate(copyExample({ 'trace.json': (s) => { const t = JSON.parse(s); t['R1-2'] = { verdict: 'missing', missing: '저장한 뒤 댓글이 어떻게 되는지 줄이 있어야 완성이다.', fingerprint: t['R1-2'].fingerprint }; return JSON.stringify(t); } }));
  assert.equal(missing.stage, 'SDD › 5. 요구사항 대조');
  assert.deepEqual(missing.issues.map((i) => i.message), ['R1-2 저장한 뒤 댓글이 어떻게 되는지 줄이 있어야 완성이다.']);
  assert.equal(missing.progress.percent, 67);

  const dir = copyExample({
    'plan.md': (s) => s.replace('고친 뒤에도 댓글이 그대로 남는다.', '고친 뒤에도 댓글과 좋아요가 그대로 남는다.'),
    'sdd.md': (s) => s.replace('수정 모달이 열린다', '수정 화면이 열린다'),
  });
  assert.equal(spawnSync('node', [CLI, 'lock', dir]).status, 0, '사람이 바꾼 기준을 다시 잠근다');
  assert.deepEqual(kinds(evaluate(dir).issues), ['대조 낡음', '대조 낡음']);
});

test('CLI: 종료 코드와 init', () => {
  assert.equal(spawnSync('node', [CLI, 'check', EXAMPLE]).status, 0);
  assert.equal(spawnSync('node', [CLI, 'check', '/없는/폴더']).status, 2);
  assert.equal(spawnSync('node', [CLI]).status, 2);
  const dir = join(mkdtempSync(join(tmpdir(), 'pp-')), 'new-feature');
  assert.match(execFileSync('node', [CLI, 'init', dir, '새 기능'], { encoding: 'utf8' }), /sdd.md는 PRD가 확정된 뒤에/);
  const fresh = spawnSync('node', [CLI, 'check', dir], { encoding: 'utf8' });
  assert.equal(fresh.status, 1);
  assert.match(fresh.stdout, /단계 {2}요구사항 › 1\. 페르소나/);
  const sheet = JSON.parse(execFileSync('node', [CLI, 'sheet', EXAMPLE], { encoding: 'utf8' }));
  assert.equal(sheet.criteria.length, 3);
  assert.ok(sheet.lines.every((line) => line.includes(' › ')));
});

test('문서는 200줄 이하다', () => {
  for (const file of ['docs/design.md', 'docs/planning-guide.md', 'docs/sdd-guide.md', 'docs/harness.md', 'README.md', 'skills/yw-plan/SKILL.md', 'skills/yw-sdd/SKILL.md']) {
    const lines = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8').split('\n').length;
    assert.ok(lines <= 200, `${file} ${lines}줄`);
  }
});

test('export: PRD가 확정되면 <문서 폴더>/{feature}/prd.md만 쓰고 작업 폴더를 남긴다', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'pp-')), 'post-edit');
  cpSync(EXAMPLE, dir, { recursive: true });
  rmSync(join(dir, 'sdd.md'));
  rmSync(join(dir, 'trace.json'));
  const project = mkdtempSync(join(tmpdir(), 'pp-project-'));
  assert.equal(spawnSync('node', [CLI, 'export', dir, project]).status, 0);
  const prd = readFileSync(join(project, 'post-edit/prd.md'), 'utf8');
  assert.match(prd, /^# 게시글 수정 PRD\n\n작성자: 영원 · 작성일: \d{4}-\d{2}-\d{2}\n\n> 번호: G 목표, P 페르소나, R 요구사항, R1-1 R1의 완성 기준\n\n## 요약\n\n- 작성자가 올린 글을 지우지 않고 고칠 수 있게 한다\.\n- 고쳐도/);
  const heads = [...prd.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
  assert.deepEqual(heads, ['요약', '배경', '목표', '페르소나', '용어', '요구사항', '범위 밖', '지켜야 할 조건'], '없음인 선택 구역은 빠진다');
  assert.match(prd, /\| G1 \| 댓글이 사라진다는 문의를 없앤다 \| 관련 문의가 한 달 30건에서 0건이 된다\. \|/);
  assert.match(prd, /### P1 글을 자주 올리는 작성자\n\n동네 소식을 하루에 두세 번 올리는 사람이다\.\n\n#### 원하는 것\n\n- 오타를 발견하면 바로 고치고 싶다\./);
  assert.match(prd, /\| 막은 글 \| 신고가 쌓여 관리자가 보이지 않게 한 글 \|/);
  assert.match(prd, /#### 예외\n\n\| 상황 \| 처리 \|\n\|---\|---\|\n\| 관리자가 막은 글 \| 작성자도 고칠 수 없다\. \|/);
  assert.match(prd, /\| R1 \| 작성자는 올린 글을 고칠 수 있다 \| P1 글을 자주 올리는 작성자 \| 꼭 \|/);
  assert.match(prd, /#### 정책\n\n- 제목과 본문을 고칠 수 있다\./);
  assert.match(prd, /- R1-4 고친 기록을 다른 사람이 볼 수 있다\. \(제외: 다음 분기에 한다\)/);
  assert.ok(!prd.includes('**'), '굵게 라벨을 쓰지 않는다');
  for (const trace of ['상태:', '누구:', '우선순위:', '정할 것', '상태표']) assert.ok(!prd.includes(trace), trace);
  assert.equal(existsSync(join(project, 'post-edit/sdd.md')), false);
  assert.equal(existsSync(dir), true, 'SDD를 이어 쓸 수 있게 남긴다');

  const unlocked = copyExample();
  rmSync(join(unlocked, 'lock.json'));
  assert.equal(spawnSync('node', [CLI, 'export', unlocked, project]).status, 2, 'PRD 확정 전에는 쓰지 않는다');
});

test('export: SDD까지 끝나면 sdd.md를 더하고, 같은 PRD는 그대로 두고, 작업 폴더를 지운다', () => {
  const project = mkdtempSync(join(tmpdir(), 'pp-project-'));
  const first = join(mkdtempSync(join(tmpdir(), 'pp-')), 'post-edit');
  cpSync(EXAMPLE, first, { recursive: true });
  rmSync(join(first, 'sdd.md'));
  spawnSync('node', [CLI, 'export', first, project]);
  cpSync(EXAMPLE, first, { recursive: true });
  const result = spawnSync('node', [CLI, 'export', first, project], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /그대로다: .*prd\.md/);
  const sdd = readFileSync(join(project, 'post-edit/sdd.md'), 'utf8');
  assert.match(sdd, /^# 게시글 수정 SDD 스펙\n\n> PRD: \[prd\.md\]\(prd\.md\)\n/);
  assert.match(sdd, /## 피쳐 · 게시글 수정 · R1/);
  for (const trace of ['상태:', '진행표', '## 페르소나']) assert.ok(!sdd.includes(trace), trace);
  assert.equal(existsSync(first), false);

  const changed = copyExample({ 'plan.md': (s) => s.replace('고친 횟수에는 제한이 없다.', '하루에 열 번까지 고칠 수 있다.') });
  const again = join(mkdtempSync(join(tmpdir(), 'pp-')), 'post-edit');
  cpSync(changed, again, { recursive: true });
  assert.equal(spawnSync('node', [CLI, 'export', again, project]).status, 2, '내용이 다르면 --force 없이 덮어쓰지 않는다');
  assert.equal(existsSync(again), true);
});

test('export: 결과 폴더가 작업 폴더와 겹치면 내보내지 않고, .DS_Store는 무시한다', () => {
  const project = mkdtempSync(join(tmpdir(), 'pp-project-'));
  const dir = join(project, 'post-edit');
  cpSync(EXAMPLE, dir, { recursive: true });
  assert.equal(spawnSync('node', [CLI, 'export', dir, project]).status, 2, '결과 폴더가 작업 폴더 자신이다');
  assert.equal(spawnSync('node', [CLI, 'export', dir, join(dir, 'docs')]).status, 2, '결과 폴더가 작업 폴더 안이다');
  assert.equal(existsSync(join(dir, 'plan.md')), true);

  const work = join(mkdtempSync(join(tmpdir(), 'pp-')), 'post-edit');
  cpSync(EXAMPLE, work, { recursive: true });
  writeFileSync(join(work, '.DS_Store'), '');
  assert.equal(spawnSync('node', [CLI, 'export', work, mkdtempSync(join(tmpdir(), 'pp-docs-'))]).status, 0);
  assert.equal(existsSync(work), false);
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
