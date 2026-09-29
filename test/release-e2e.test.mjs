import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// release.yml이 GitHub에서 하는 일을 로컬에서 그대로 재현한다.
// 원격은 bare 저장소, gh는 받은 인자를 기록하는 가짜로 바꾸고,
// 워크플로와 같은 두 단계(release.mjs apply → publish.sh)를 같은 순서로 돌린다.
const RELEASE_CLI = fileURLToPath(new URL('../tools/release.mjs', import.meta.url));
const PUBLISH = fileURLToPath(new URL('../tools/release/publish.sh', import.meta.url));

const FAKE_GH = `#!/bin/sh
: > "$GH_LOG"
for arg in "$@"; do printf '%s\\n' "$arg" >> "$GH_LOG"; done
while [ $# -gt 0 ]; do
  if [ "$1" = "--notes-file" ]; then cp "$2" "$GH_LOG.notes"; fi
  shift
done
`;

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function commitFile(work, path, content, message) {
  mkdirSync(join(work, path, '..'), { recursive: true });
  writeFileSync(join(work, path), content);
  git(work, 'add', '.');
  git(work, 'commit', '-q', '-m', message);
}

function setup() {
  const base = mkdtempSync(join(tmpdir(), 'release-e2e-'));
  const remote = join(base, 'remote.git');
  const work = join(base, 'work');
  const bin = join(base, 'bin');
  git(base, 'init', '-q', '--bare', '-b', 'main', remote);
  git(base, 'clone', '-q', remote, work);
  for (const repo of [work]) {
    git(repo, 'config', 'user.email', 'test@example.com');
    git(repo, 'config', 'user.name', 'test');
  }
  mkdirSync(bin);
  writeFileSync(join(bin, 'gh'), FAKE_GH);
  chmodSync(join(bin, 'gh'), 0o755);
  commitFile(work, '.claude-plugin/plugin.json', `${JSON.stringify({ name: 'product-planning', version: '0.1.0' }, null, 2)}\n`, 'feat: 처음');
  git(work, 'push', '-q', '-u', 'origin', 'main');
  return { base, remote, work, bin, ghLog: join(base, 'gh.log') };
}

// GitHub가 GITHUB_OUTPUT을 읽는 방식: `이름=값` 한 줄, 또는 `이름<<구분자` … `구분자` 여러 줄.
function readGithubOutput(file) {
  const lines = readFileSync(file, 'utf8').split('\n');
  const outputs = {};
  for (let i = 0; i < lines.length; i += 1) {
    const heredoc = /^([^=<]+)<<(.+)$/.exec(lines[i]);
    if (heredoc) {
      const [, name, delimiter] = heredoc;
      const end = lines.indexOf(delimiter, i + 1);
      assert.notEqual(end, -1, `${name}의 구분자 ${delimiter}가 닫히지 않았습니다`);
      outputs[name] = lines.slice(i + 1, end).join('\n');
      i = end;
    } else if (lines[i].includes('=')) {
      const at = lines[i].indexOf('=');
      outputs[lines[i].slice(0, at)] = lines[i].slice(at + 1);
    }
  }
  return outputs;
}

// 워크플로의 두 단계. 두 번째 단계는 releasable이 true일 때만 돈다(release.yml의 if와 같다).
function applyStep(env) {
  const outputFile = join(env.base, `output-${Date.now()}-${Math.random()}`);
  const apply = spawnSync(process.execPath, [RELEASE_CLI, 'apply', '--github-output', '--root', env.work], {
    encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: outputFile },
  });
  assert.equal(apply.status, 0, apply.stderr);
  return readGithubOutput(outputFile);
}

function publishStep(env, outputs) {
  return spawnSync('bash', [PUBLISH], {
    cwd: env.work,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${env.bin}:${process.env.PATH}`,
      GH_LOG: env.ghLog,
      TAG: outputs.tag,
      VERSION: outputs.version,
      NOTES: outputs.notes,
    },
  });
}

function runWorkflow(env) {
  const outputs = applyStep(env);
  if (outputs.releasable !== 'true') return { outputs, publish: null };
  const publish = publishStep(env, outputs);
  assert.equal(publish.status, 0, publish.stderr);
  return { outputs, publish };
}

const remoteGit = (env, ...args) => git(env.base, '--git-dir', env.remote, ...args);
const remoteTags = (env) => remoteGit(env, 'tag', '-l').split('\n').filter(Boolean);

test('main push 한 번이 버전 커밋·태그·릴리스까지 끝낸다', () => {
  const env = setup();
  const { outputs } = runWorkflow(env);

  assert.deepEqual({ releasable: outputs.releasable, version: outputs.version, tag: outputs.tag },
    { releasable: 'true', version: '0.2.0', tag: 'product-planning--v0.2.0' });
  assert.equal(remoteGit(env, 'log', '-1', '--format=%s', 'main'), 'chore(release): product-planning v0.2.0');
  assert.equal(remoteGit(env, 'rev-list', '-n', '1', 'product-planning--v0.2.0'), remoteGit(env, 'rev-parse', 'main'), '태그가 배포 커밋을 가리킨다');
  assert.equal(JSON.parse(remoteGit(env, 'show', 'main:.claude-plugin/plugin.json')).version, '0.2.0');
  assert.match(remoteGit(env, 'show', 'main:CHANGELOG.md'), /^# 변경 기록\n\n## 0\.2\.0 — /);

  const ghArgs = readFileSync(env.ghLog, 'utf8').trim().split('\n');
  assert.deepEqual(ghArgs.slice(0, 6), ['release', 'create', 'product-planning--v0.2.0', '--title', 'product-planning v0.2.0', '--notes-file']);
  const notes = readFileSync(`${env.ghLog}.notes`, 'utf8');
  assert.match(notes, /### 새 기능\n- 처음 \([0-9a-f]{7}\)/);
});

test('배포 직후 다시 돌리면 아무것도 하지 않고, 다음 fix는 patch로 쌓인다', () => {
  const env = setup();
  runWorkflow(env);

  const again = runWorkflow(env);
  assert.equal(again.outputs.releasable, 'false', '배포 커밋은 다시 배포를 부르지 않는다');
  assert.deepEqual(remoteTags(env), ['product-planning--v0.2.0']);

  commitFile(env.work, 'src/a.mjs', '1', 'fix: 빈 입력을 막는다');
  commitFile(env.work, 'test/a.test.mjs', '1', 'test: 테스트만 추가한다');
  git(env.work, 'push', '-q', 'origin', 'main');
  const next = runWorkflow(env);
  assert.equal(next.outputs.tag, 'product-planning--v0.2.1');
  const changelog = remoteGit(env, 'show', 'main:CHANGELOG.md');
  assert.ok(changelog.indexOf('## 0.2.1') < changelog.indexOf('## 0.2.0'), '새 버전이 위에 온다');
  const section = changelog.slice(changelog.indexOf('## 0.2.1'), changelog.indexOf('## 0.2.0'));
  assert.match(section, /### 고친 것\n- 빈 입력을 막는다/);
  assert.doesNotMatch(section, /테스트만/, '플러그인 밖 커밋은 변경 기록에 없다');
});

test('배포 중 main이 앞서가면 태그도 릴리스도 만들지 않는다', () => {
  const env = setup();
  const outputs = applyStep(env);

  // 워크플로가 도는 사이 사람이 main에 push했다.
  const other = join(env.base, 'other');
  git(env.base, 'clone', '-q', env.remote, other);
  git(other, 'config', 'user.email', 'other@example.com');
  git(other, 'config', 'user.name', 'other');
  commitFile(other, 'src/b.mjs', '1', 'feat: 동시에 들어온 변경');
  git(other, 'push', '-q', 'origin', 'main');

  const publish = publishStep(env, outputs);
  assert.notEqual(publish.status, 0, 'main push가 거절되면 실패해야 한다');
  assert.deepEqual(remoteTags(env), [], '태그만 올라가면 다음 배포가 같은 태그로 영영 실패한다');
  assert.equal(existsSync(env.ghLog), false, '릴리스를 만들지 않는다');
  assert.equal(remoteGit(env, 'log', '-1', '--format=%s', 'main'), 'feat: 동시에 들어온 변경');
});
