import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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
  assert.equal(report.stage, '기획 › 2. 페르소나');
  assert.deepEqual(kinds(report.issues), ['행동 패턴 없음']);
  assert.ok(report.rest >= 1, '뒤 단계 건수는 따로 센다');
});

test('페르소나가 요구사항에 안 쓰이면 묻는다', () => {
  const extra = parsePlan(read('plan.md').replace('## 요구사항', '### P2 관리자\n\n원하는 것\n- 신고된 글을 막고 싶다.\n\n행동 패턴\n- 아침마다 신고 목록을 본다.\n\n## 요구사항'));
  assert.ok(kinds(checkPlan(extra)).includes('안 쓰인 페르소나'));
});

test('정할 것이 남거나 확정 전이면 SDD로 넘어가지 않는다', () => {
  const report = evaluate(copyExample({ 'plan.md': (s) => s.replace('상태: 확정', '상태: 작성중').replace('## 정할 것', '## 정할 것\n\n- 관리자도 남의 글을 고칠 수 있는가?') }));
  assert.equal(report.stage, '기획 › 5. 확정');
  assert.deepEqual(kinds(report.issues), ['정할 것 남음', '확정 전']);
  assert.equal(report.progress, null);
});

test('기획 문장 규칙: 두 문장, 개발 용어, 모호한 말, 긴 문장', () => {
  assert.deepEqual(kinds(sentenceIssues('고친다. 저장한다.')), ['한 줄 두 문장']);
  assert.deepEqual(kinds(sentenceIssues('API로 저장한다.')), ['개발 용어']);
  assert.deepEqual(kinds(sentenceIssues('필요 시 알림 등을 보낸다.')), ['모호한 말']);
  assert.deepEqual(kinds(sentenceIssues('가'.repeat(81))), ['긴 문장']);
  assert.deepEqual(sentenceIssues('오타를 발견하면 바로 고치고 싶다.'), []);
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

  const stale = evaluate(copyExample({
    'plan.md': (s) => s.replace('고친 뒤에도 댓글이 그대로 남는다.', '고친 뒤에도 댓글과 좋아요가 그대로 남는다.'),
    'sdd.md': (s) => s.replace('수정 모달이 열린다', '수정 화면이 열린다'),
  }));
  assert.deepEqual(kinds(stale.issues), ['대조 낡음', '대조 낡음']);
});

test('CLI: 종료 코드와 init', () => {
  assert.equal(spawnSync('node', [CLI, 'check', EXAMPLE]).status, 0);
  assert.equal(spawnSync('node', [CLI, 'check', '/없는/폴더']).status, 2);
  assert.equal(spawnSync('node', [CLI]).status, 2);
  const dir = join(mkdtempSync(join(tmpdir(), 'pp-')), 'new-feature');
  assert.match(execFileSync('node', [CLI, 'init', dir, '새 기능'], { encoding: 'utf8' }), /sdd.md는 기획이 확정된 뒤에/);
  const fresh = spawnSync('node', [CLI, 'check', dir], { encoding: 'utf8' });
  assert.equal(fresh.status, 1);
  assert.match(fresh.stdout, /단계 {2}기획 › 1\. 배경/);
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

test('export: 완료일 때만 한 파일로 내보내고 작업 흔적은 빼고 작업 폴더를 지운다', async () => {
  const { existsSync } = await import('node:fs');
  const dir = copyExample();
  const target = join(mkdtempSync(join(tmpdir(), 'pp-out-')), 'post-edit.md');
  assert.equal(spawnSync('node', [CLI, 'export', dir, target]).status, 0);
  const result = readFileSync(target, 'utf8');
  assert.match(result, /^# 게시글 수정\n\n## 기획\n/);
  assert.match(result, /## SDD 스펙\n/);
  assert.match(result, /### 피쳐 · 게시글 수정 · R1/);
  for (const trace of ['상태:', '진행표', '정할 것']) assert.ok(!result.includes(trace), trace);
  assert.equal(existsSync(dir), false);
  assert.equal(spawnSync('node', [CLI, 'export', copyExample(), target]).status, 2, '이미 있으면 덮어쓰지 않는다');

  const unfinished = copyExample({ 'trace.json': () => '{}' });
  assert.equal(spawnSync('node', [CLI, 'export', unfinished, `${target}.2`]).status, 2);
  assert.equal(existsSync(unfinished), true);
});

test('discard: 하네스 파일만 든 폴더만 지운다', async () => {
  const { existsSync } = await import('node:fs');
  const stray = copyExample();
  writeFileSync(join(stray, 'other.txt'), 'x');
  assert.equal(spawnSync('node', [CLI, 'discard', stray]).status, 2);
  assert.equal(existsSync(stray), true);
  const dir = copyExample();
  assert.equal(spawnSync('node', [CLI, 'discard', dir]).status, 0);
  assert.equal(existsSync(dir), false);
});
