import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { parseSpec } from '../src/model/load.mjs';
import { runPipeline } from '../src/check/run.mjs';

const text = () => readFileSync(new URL('../examples/assignment/spec.json', import.meta.url), 'utf8');
const load = (patch = {}) => parseSpec(JSON.stringify({ ...JSON.parse(text()), ...patch }));
const run = (patch) => { const { spec, problems } = load(patch); return runPipeline(spec, problems); };
const issuesOf = (result, rule) => result.report.issues.filter((item) => item.rule === rule);

test('검토지는 모델이 판단할 휴리스틱과 워크스루 항목을 대상별로 만든다', () => {
  const { worksheet } = run().derived.review;
  const keys = worksheet.map((item) => item.key);
  assert.ok(keys.includes('H5:AC3') && keys.includes('H5:AC5'), '입력이 있는 동작마다 오류 예방 시점');
  assert.ok(keys.includes('H6:S1') && keys.includes('H6:S2'), '시나리오마다 기억 부담');
  assert.ok(keys.includes('H2:E1'), '개체마다 용어 일관성');
  assert.ok(keys.some((key) => key.startsWith('H8:sc:')), '페이지마다 필요한 것만');
  assert.ok(keys.some((key) => key.startsWith('H10:sc:')), '목록 화면마다 처음 사용 안내');
  assert.deepEqual(keys.filter((key) => key.startsWith('W:')), ['W:S1#1', 'W:S1#2', 'W:S1#3', 'W:S2#1', 'W:S2#2', 'W:S2#3', 'W:S2#4'], '기본 흐름 단계마다 워크스루');
  const item = worksheet.find((entry) => entry.key === 'H5:AC3');
  assert.match(item.question, /막는가/);
  assert.equal(item.targetName, '항목 만들기');
  assert.ok(item.context.inputs.some((input) => input.name === '제목'), '판단에 필요한 사실을 함께 준다');
  assert.equal(new Set(keys).size, keys.length, '항목은 겹치지 않는다');
});

test('판단이 빠진 항목은 review-coverage 경고가 된다', () => {
  const result = run();
  assert.equal(issuesOf(result, 'review-coverage').length, result.derived.review.worksheet.length);
});

const fullReviews = (result, change = () => ({})) => result.derived.review.worksheet.map((item) => ({
  key: item.key, verdict: 'pass', evidence: [item.target.split('#')[0]], finding: '문제 없음', ...change(item),
}));

test('근거가 없거나 없는 요소를 근거로 들면 review-evidence 경고, 심각도 3~4가 남으면 착수 불가다', () => {
  const base = run();
  const reviews = fullReviews(base, (item) => (item.key === 'H5:AC3' ? { verdict: 'issue', severity: 3, evidence: ['AC3'], finding: '담당자를 고르기 전에 저장할 수 있다' } : item.key === 'H6:S1' ? { evidence: [] } : item.key === 'H6:S2' ? { evidence: ['없는ID'] } : {}));
  const result = run({ reviews, reviewRounds: [reviews, reviews] });
  assert.deepEqual(issuesOf(result, 'review-coverage'), []);
  const evidence = issuesOf(result, 'review-evidence').map((item) => item.message);
  assert.equal(evidence.length, 2, evidence.join('\n'));
  const severe = issuesOf(result, 'review-severity');
  assert.equal(severe.length, 1);
  assert.equal(severe[0].level, 'block');
  assert.match(severe[0].message, /담당자를 고르기 전에 저장할 수 있다/);
  const accepted = reviews.map((item) => (item.key === 'H5:AC3' ? { ...item, accepted: 'D1' } : item));
  const ok = run({ reviews: accepted, reviewRounds: [accepted, accepted], decisions: [{ id: 'D1', name: '이번에는 저장 뒤 검증으로 간다', source: { kind: 'decision' } }] });
  assert.deepEqual(issuesOf(ok, 'review-severity'), [], '결정으로 받아들이면 막지 않는다');
});

test('두 번의 독립 판단이 80% 미만으로 일치하면 어긋난 항목을 경고한다 (일관성 하네스)', () => {
  const base = run();
  const first = fullReviews(base);
  const second = fullReviews(base, (item) => (item.key.startsWith('W:') ? { verdict: 'issue', severity: 2, finding: '다르게 봄' } : {}));
  const result = run({ reviews: first, reviewRounds: [first, second] });
  const agreement = issuesOf(result, 'review-agreement');
  assert.equal(agreement.length, 1);
  assert.match(agreement[0].message, /일치율 \d+%/);
  assert.match(agreement[0].message, /W:S1#1/);
  assert.equal(result.derived.review.agreement.disagreements.length, 7);
  const none = run({ reviews: first });
  assert.match(issuesOf(none, 'review-agreement')[0].message, /두 번/, '두 번 판단한 기록이 없으면 알린다');
  assert.deepEqual(issuesOf(run({ reviews: first, reviewRounds: [first, first] }), 'review-agreement'), []);
});

test('판단 형식이 틀리면 형식 오류로 보고한다', () => {
  const { problems } = load({ reviews: [{ key: 'H5:AC3', verdict: '좋음', severity: 9, evidence: 'AC3' }], reviewRounds: 'x' });
  const paths = problems.map((item) => item.path);
  for (const path of ['reviews[0].verdict', 'reviews[0].severity', 'reviews[0].evidence', 'reviewRounds']) assert.ok(paths.includes(path), path);
});

test('review 명령은 검토지를 JSON으로 찍는다', () => {
  const cli = new URL('../scripts/spec.mjs', import.meta.url).pathname;
  const example = new URL('../examples/assignment/spec.json', import.meta.url).pathname;
  const out = spawnSync(process.execPath, [cli, 'review', example], { encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
  const sheet = JSON.parse(out.stdout);
  assert.ok(Array.isArray(sheet.worksheet) && sheet.worksheet.length > 0);
  assert.ok(sheet.instructions.includes('근거'));
});
