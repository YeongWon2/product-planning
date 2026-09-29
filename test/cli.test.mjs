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

test('build는 HTML과 보고서를 쓴다', () => {
  const out = mkdtempSync(join(tmpdir(), 'spec-'));
  const result = run('build', example, '--out', out);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(existsSync(join(out, 'assignment.html')));
  assert.equal(JSON.parse(readFileSync(join(out, 'report.json'), 'utf8')).ready, false);
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
  for (const file of ['assignment.html', 'report.json']) {
    assert.equal(
      readFileSync(join(out, file), 'utf8'),
      readFileSync(join(committed, file), 'utf8'),
      `${file}이 오래됐습니다. node scripts/spec.mjs build examples/assignment/spec.json 으로 다시 만드세요`,
    );
  }
});
