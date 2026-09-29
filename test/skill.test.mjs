import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const skill = readFileSync(new URL('../skills/yw-product-spec/SKILL.md', import.meta.url), 'utf8');
const frontmatter = Object.fromEntries(
  skill.split('---')[1].trim().split('\n').map((line) => [line.slice(0, line.indexOf(':')), line.slice(line.indexOf(':') + 1).trim()]),
);

test('스킬은 명령으로만 돌고 요청을 인자로 받는다', () => {
  assert.equal(frontmatter.name, 'yw-product-spec');
  assert.equal(frontmatter['disable-model-invocation'], 'true', '모델이 대화 중에 알아서 켜지 않는다');
  assert.ok(frontmatter['argument-hint'], '자동완성에 인자 힌트가 보인다');
  assert.match(skill, /\$ARGUMENTS/, '요청 문장이 본문에 들어간다');
});

test('스킬의 완료 기준은 착수 가능과 통과율 100%다', () => {
  assert.match(skill, /착수 가능/);
  assert.match(skill, /통과율 100%/);
  assert.match(skill, /request-scope/, '요청 밖 경고를 다루는 방법이 있다');
});
