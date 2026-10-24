import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { InputError, evaluate, load } from '../src/report.mjs';
import { render } from '../src/export.mjs';
import { userFlow } from '../src/flow.mjs';
import { citable } from '../src/cite.mjs';
import { sheet } from '../src/trace.mjs';

// 작업 파일이 어떤 모양으로 망가져도 하네스는 검토 결과나 InputError로 답하고, 예외로 죽지 않는다.
const EXAMPLE = new URL('../examples/post-edit/', import.meta.url).pathname;
const CLI = new URL('../scripts/pp.mjs', import.meta.url).pathname;
const FILES = readdirSync(EXAMPLE);
const GARBAGE = ['', '|', '| |', '- ', '### ', '## ', '## F', '## F1 ·', '- 1a.', '- 1.', '  - 1a1. 끝난다', '출처:', '출처: F1 › ', '| 항목 | 내용 |', '|---|', '- 9z. 조건: ', '- 없음:', '```', '상태: 확정', '### F9 없는', '| 기본 흐름 › | A9 | C9 | M9 | E9 |', '- 1. FN9 를 따른다', '- 2. 0로 돌아간다', '"', '- 1a. a: b: c', '| x |', '- R1-9', '### R1', '### P1', '누구:', '- [ ] T1', '- V1 R9-9 · x', '호출: A1 → ', '실패: ,', '- 1. 게시글이 에서 로 바뀐다', '- 3. "x" <y> `z`'];
const BROKEN_JSON = ['', '{', '[]', 'null', '"x"', '{"R1-1": null}', '{"R1-1": {"verdict": "met"}}', '{"R1-1": {"verdict": "met", "evidence": "x"}}', '{"fingerprint": 3}'];

function random(seed) {
  let state = seed;
  const next = () => ((state = (state * 1103515245 + 12345) % 2147483648) / 2147483648);
  return { next, pick: (list) => list[Math.floor(next() * list.length)] };
}

function mutate(text, { next, pick }) {
  const lines = text.split('\n');
  for (let i = 0, times = 1 + Math.floor(next() * 8); i < times; i++) {
    const at = Math.floor(next() * (lines.length + 1));
    const op = pick(['del', 'dup', 'ins', 'cut', 'indent', 'trim']);
    if (op === 'del') lines.splice(at, 1);
    else if (op === 'dup') lines.splice(at, 0, lines[at] ?? '');
    else if (op === 'ins') lines.splice(at, 0, pick(GARBAGE));
    else if (lines[at] === undefined) continue;
    else if (op === 'cut') lines[at] = lines[at].slice(0, Math.floor(next() * lines[at].length));
    else if (op === 'indent') lines[at] = `  ${lines[at]}`;
    else lines[at] = lines[at].trimStart();
  }
  return lines.join('\n');
}

const quiet = (fn) => {
  try {
    fn();
  } catch (error) {
    if (!(error instanceof InputError)) throw error;
  }
};

test('망가진 작업 파일 400가지에도 check·export·flow·sheet·quotes가 죽지 않는다', () => {
  const rng = random(20261025);
  const base = mkdtempSync(join(tmpdir(), 'pp-fuzz-'));
  for (let n = 0; n < 400; n++) {
    const dir = join(base, String(n), 'post-edit');
    cpSync(EXAMPLE, dir, { recursive: true });
    const targets = [...new Set(FILES.filter(() => rng.next() < 0.3).concat(rng.pick(FILES)))];
    for (const file of targets) {
      const path = join(dir, file);
      if (rng.next() < 0.05) rmSync(path);
      else writeFileSync(path, file.endsWith('.json') && rng.next() < 0.5 ? rng.pick(BROKEN_JSON) : mutate(readFileSync(path, 'utf8'), rng));
    }
    const where = `${n}번째 (${targets.join(', ')})`;
    assert.doesNotThrow(() => quiet(() => evaluate(dir)), where);
    assert.doesNotThrow(() => quiet(() => render(dir, { withDev: true })), where);
    assert.doesNotThrow(() => quiet(() => {
      const docs = load(dir);
      if (docs.spec) userFlow(docs.spec);
      if (docs.plan && docs.spec) sheet(docs.plan, docs.spec);
      if (docs.brief && docs.plan && docs.spec) citable(docs.brief, docs.plan, docs.spec);
    }), where);
  }
  rmSync(base, { recursive: true });
});

test('CLI는 파일이 빠져도 스택 트레이스 없이 알린다', () => {
  for (const missing of ['brief.md', 'plan.md', 'spec.md', 'dev.md']) {
    const dir = join(mkdtempSync(join(tmpdir(), 'pp-')), 'post-edit');
    cpSync(EXAMPLE, dir, { recursive: true });
    rmSync(join(dir, missing));
    for (const command of ['check', 'sheet', 'quotes', 'flow', 'lock']) {
      const result = spawnSync('node', [CLI, command, dir], { encoding: 'utf8' });
      assert.ok(result.status <= 2, `${missing} 없이 ${command}: ${result.status}`);
      assert.doesNotMatch(result.stderr, /\n\s+at /, `${missing} 없이 ${command}`);
    }
  }
});
