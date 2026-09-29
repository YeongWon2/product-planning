import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cli = new URL('../scripts/spec.mjs', import.meta.url).pathname;
const example = new URL('../examples/assignment/spec.json', import.meta.url).pathname;
const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });

test('check는 착수 불가면 1로 끝나고 한글 요약을 낸다', () => {
  const result = run('check', example);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /착수 불가/);
  assert.match(result.stdout, /동작 가능표 빈칸/);
});

test('check는 착수 가능하면 0으로 끝난다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'spec-'));
  const ready = join(dir, 'spec.json');
  // 예제에 일부러 비워 둔 동작 가능표 칸 하나만 채우면 착수 가능이 된다.
  const spec = JSON.parse(readFileSync(example, 'utf8'));
  spec.permissions.push({ userType: 'U1', action: 'AC5', state: 'ST2', value: 'hide' });
  writeFileSync(ready, JSON.stringify(spec));
  const result = run('check', ready);
  assert.equal(result.status, 0, result.stdout);
  assert.match(result.stdout, /착수 가능/);
});

test('build는 사람용 HTML, AI용 model.json, 검사 결과를 쓴다', () => {
  const out = mkdtempSync(join(tmpdir(), 'spec-'));
  const result = run('build', example, '--out', out);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(existsSync(join(out, 'assignment.html')));
  assert.equal(JSON.parse(readFileSync(join(out, 'report.json'), 'utf8')).ready, false);
  assert.equal(JSON.parse(readFileSync(join(out, 'model.json'), 'utf8')).document.parts.length, 4);
  assert.match(result.stdout, /프롬프트[\s\S]*model\.json/, '붙여 넣을 프롬프트를 함께 찍는다');
  assert.match(result.stdout, /assignment\.html/);
});

test('깨진 JSON은 3, 사용법 오류는 2로 끝난다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'spec-'));
  const broken = join(dir, 'spec.json');
  writeFileSync(broken, '{ 깨진');
  const brokenRun = run('check', broken);
  assert.equal(brokenRun.status, 3);
  assert.match(brokenRun.stderr, /JSON/);
  assert.equal(run().status, 2);
  assert.equal(run('build').status, 2);
  assert.equal(run('모르는명령', example).status, 2);
});

test('저장소에 올린 예제 출력은 지금 코드로 다시 만든 것과 같다', () => {
  const out = mkdtempSync(join(tmpdir(), 'spec-'));
  assert.equal(run('build', example, '--out', out).status, 0);
  const committed = new URL('../examples/assignment/out/', import.meta.url).pathname;
  for (const file of ['assignment.html', 'model.json', 'report.json']) {
    assert.equal(
      readFileSync(join(out, file), 'utf8'),
      readFileSync(join(committed, file), 'utf8'),
      `${file}이 오래됐습니다. node scripts/spec.mjs build examples/assignment/spec.json 으로 다시 만드세요`,
    );
  }
});

import { chmodSync } from 'node:fs';
import { openerFor } from '../src/open-file.mjs';

test('운영체제마다 기본 프로그램으로 파일을 여는 명령을 고른다', () => {
  assert.deepEqual(openerFor('darwin', '/a/b.html'), { command: 'open', args: ['/a/b.html'] });
  assert.deepEqual(openerFor('win32', 'C:\\a\\b.html'), { command: 'cmd', args: ['/c', 'start', '""', 'C:\\a\\b.html'] });
  assert.deepEqual(openerFor('linux', '/a/b.html'), { command: 'xdg-open', args: ['/a/b.html'] });
});

// 실제 창을 띄우지 않도록 여는 명령을 받은 인자를 적는 가짜로 바꾼다.
function fakeOpener() {
  const dir = mkdtempSync(join(tmpdir(), 'opener-'));
  const log = join(dir, 'opened.txt');
  const script = join(dir, 'open.sh');
  writeFileSync(script, `#!/bin/sh\nprintf '%s' "$1" > "${log}"\n`);
  chmodSync(script, 0o755);
  return { script, log };
}
const runWith = (env, ...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });

test('build --open은 만든 HTML을 창으로 연다', () => {
  const { script, log } = fakeOpener();
  const out = mkdtempSync(join(tmpdir(), 'out-'));
  const result = runWith({ SPEC_OPEN_COMMAND: script }, 'build', example, '--out', out, '--open');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(log, 'utf8'), join(out, 'assignment.html'));
  assert.match(result.stdout, /창으로 열었습니다/);
});

test('--open이 없으면 창을 열지 않는다', () => {
  const { script, log } = fakeOpener();
  const out = mkdtempSync(join(tmpdir(), 'out-'));
  assert.equal(runWith({ SPEC_OPEN_COMMAND: script }, 'build', example, '--out', out).status, 0);
  assert.equal(existsSync(log), false);
});

test('창을 열지 못해도 빌드는 성공으로 끝나고 직접 열 경로를 알린다', () => {
  const out = mkdtempSync(join(tmpdir(), 'out-'));
  const result = runWith({ SPEC_OPEN_COMMAND: join(out, '없는-명령') }, 'build', example, '--out', out, '--open');
  assert.equal(result.status, 0);
  assert.match(result.stderr, /창을 열지 못했습니다.*직접 여세요/s);
  assert.ok(existsSync(join(out, 'assignment.html')));
});
