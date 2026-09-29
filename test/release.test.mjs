import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseCommit, touchesPlugin, bumpFor, nextVersion, planRelease, renderChangelogSection, applyRelease,
} from '../tools/release/lib.mjs';

const commit = (subject, files = ['src/a.mjs'], body = '') => parseCommit({ sha: 'abcdef1234567', subject, body, files });

test('Conventional Commits 제목을 읽는다', () => {
  assert.deepEqual(
    (({ type, scope, breaking, description }) => ({ type, scope, breaking, description }))(commit('feat(flow): 흐름을 도출한다')),
    { type: 'feat', scope: 'flow', breaking: false, description: '흐름을 도출한다' },
  );
  assert.equal(commit('fix!: 형식을 바꾼다').breaking, true);
  assert.equal(commit('refactor: 정리', ['src/a.mjs'], 'BREAKING CHANGE: spec 형식이 바뀐다').breaking, true);
  assert.equal(commit('규칙 없는 제목').type, null);
});

test('플러그인 파일이 바뀐 커밋만 배포 대상이다', () => {
  assert.equal(touchesPlugin(['src/check/run.mjs']), true);
  assert.equal(touchesPlugin(['docs/산출물-명세.md']), true);
  assert.equal(touchesPlugin(['.claude-plugin/plugin.json']), true);
  assert.equal(touchesPlugin(['test/cli.test.mjs', 'examples/assignment/out/report.json', 'README.md', 'tools/release/lib.mjs']), false);
});

test('커밋 종류로 올릴 자리를 정한다', () => {
  assert.equal(bumpFor([commit('fix: 고친다'), commit('docs: 문서')], '0.2.0'), 'patch');
  assert.equal(bumpFor([commit('fix: 고친다'), commit('feat: 기능')], '0.2.0'), 'minor');
  assert.equal(bumpFor([commit('feat!: 깨는 변경')], '1.4.0'), 'major');
  // 1.0.0 전에는 호환이 깨져도 minor 로 올린다.
  assert.equal(bumpFor([commit('feat!: 깨는 변경')], '0.4.0'), 'minor');
  assert.equal(bumpFor([commit('test: 테스트만', ['test/a.test.mjs'])], '0.2.0'), null);
  assert.equal(bumpFor([commit('chore(release): product-planning v0.2.0', ['.claude-plugin/plugin.json'])], '0.2.0'), null);
});

test('다음 버전을 계산한다', () => {
  assert.equal(nextVersion('0.1.0', 'patch'), '0.1.1');
  assert.equal(nextVersion('0.1.9', 'minor'), '0.2.0');
  assert.equal(nextVersion('1.2.3', 'major'), '2.0.0');
  assert.throws(() => nextVersion('v1', 'patch'), /버전/);
});

test('변경 기록은 종류별로 묶고 짧은 SHA를 붙인다', () => {
  const section = renderChangelogSection({
    version: '0.2.0',
    date: '2026-09-29',
    commits: [commit('feat(flow): 흐름을 도출한다'), commit('fix: 빈 입력을 막는다'), commit('docs: 명세를 고친다')],
  });
  assert.equal(section, [
    '## 0.2.0 — 2026-09-29',
    '',
    '### 새 기능',
    '- 흐름을 도출한다 (abcdef1)',
    '',
    '### 고친 것',
    '- 빈 입력을 막는다 (abcdef1)',
    '',
    '### 그 밖의 변경',
    '- 명세를 고친다 (abcdef1)',
    '',
  ].join('\n'));
});

test('배포 계획은 대상 커밋이 없으면 배포하지 않는다', () => {
  const none = planRelease({ version: '0.2.0', date: '2026-09-29', commits: [commit('test: 테스트', ['test/a.test.mjs'])] });
  assert.equal(none.releasable, false);
  const some = planRelease({ version: '0.2.0', date: '2026-09-29', commits: [commit('feat: 기능')] });
  assert.deepEqual({ releasable: some.releasable, next: some.next, tag: some.tag }, { releasable: true, next: '0.3.0', tag: 'product-planning--v0.3.0' });
});

test('배포 적용은 plugin.json 버전과 CHANGELOG.md만 바꾼다', () => {
  const root = mkdtempSync(join(tmpdir(), 'release-'));
  mkdirSync(join(root, '.claude-plugin'));
  writeFileSync(join(root, '.claude-plugin', 'plugin.json'), `${JSON.stringify({ name: 'product-planning', version: '0.1.0' }, null, 2)}\n`);
  const plan = planRelease({ version: '0.1.0', date: '2026-09-29', commits: [commit('feat: 기능')] });
  applyRelease(root, plan);
  applyRelease(root, planRelease({ version: '0.2.0', date: '2026-09-30', commits: [commit('fix: 고침')] }));
  assert.equal(JSON.parse(readFileSync(join(root, '.claude-plugin', 'plugin.json'), 'utf8')).version, '0.2.1');
  const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
  assert.ok(changelog.startsWith('# 변경 기록\n'));
  assert.ok(changelog.indexOf('## 0.2.1') < changelog.indexOf('## 0.2.0'), '새 버전이 위에 온다');
});

test('버전은 plugin.json 한 곳에만 있다', () => {
  const read = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
  assert.match(read('.claude-plugin/plugin.json').version, /^\d+\.\d+\.\d+$/);
  for (const entry of read('.claude-plugin/marketplace.json').plugins) assert.equal('version' in entry, false, entry.name);
  assert.equal('version' in read('package.json'), false);
});

test('CLI는 git 이력에서 마지막 배포 태그 이후 커밋으로 계획을 세운다', () => {
  const root = mkdtempSync(join(tmpdir(), 'release-git-'));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'test');
  mkdirSync(join(root, '.claude-plugin'));
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, '.claude-plugin', 'plugin.json'), `${JSON.stringify({ name: 'product-planning', version: '0.2.0' }, null, 2)}\n`);
  writeFileSync(join(root, 'src', 'a.mjs'), '1');
  git('add', '.');
  git('commit', '-q', '-m', 'feat: 처음');
  git('tag', 'product-planning--v0.2.0');
  writeFileSync(join(root, 'src', 'a.mjs'), '2');
  git('commit', '-q', '-am', 'fix: 고친다');
  mkdirSync(join(root, 'docs'));
  writeFileSync(join(root, 'docs', '설계서.md'), '한글 파일명');
  git('add', '.');
  git('commit', '-q', '-m', 'docs: 한글 파일명 문서를 고친다');
  writeFileSync(join(root, 'notes.txt'), 'x');
  git('add', '.');
  git('commit', '-q', '-m', 'chore: 플러그인 밖 파일');

  const cli = new URL('../tools/release.mjs', import.meta.url).pathname;
  const result = spawnSync(process.execPath, [cli, 'plan', '--json', '--root', root], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.next, '0.2.1');
  assert.deepEqual(plan.commits.map((item) => item.description), ['고친다', '한글 파일명 문서를 고친다']);
});
