import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSpec, parseSpec } from '../src/model/load.mjs';
import { runPipeline } from '../src/check/run.mjs';
import { renderHtml } from '../src/render/html.mjs';

const example = () => loadSpec(new URL('../examples/assignment/spec.json', import.meta.url).pathname).spec;

function bodyText(html) {
  const body = html.split('<body>')[1].split('<script type="application/json"')[0];
  const beforeTrace = body.split('data-section="trace"')[0];
  // 사람이 브라우저에서 보는 글자로 비교한다.
  return beforeTrace
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

test('11개 섹션이 순서대로 있다', () => {
  const html = renderHtml(runPipeline(example()));
  const order = [...html.matchAll(/data-section="([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(order, ['summary', 'scenarios', 'entities', 'permissions', 'flow', 'screens', 'acceptance', 'metrics', 'review', 'questions', 'trace']);
});

test('본문에는 내부 ID가 보이지 않는다 (부록 제외)', () => {
  const spec = example();
  const text = bodyText(renderHtml(runPipeline(spec)));
  const ids = [...spec.userTypes, ...spec.apps, ...spec.requirements, ...spec.actions, ...spec.scenarios, ...spec.acceptance].map((x) => x.id);
  for (const id of ids) assert.ok(!new RegExp(`\\b${id}\\b`).test(text), `본문에 ID ${id}`);
  assert.ok(!text.includes('sc:'), '본문에 화면 ID');
});

test('요약에 착수 판정과 사유, 품질 점수가 보인다', () => {
  const text = bodyText(renderHtml(runPipeline(example())));
  assert.match(text, /착수 불가/);
  assert.match(text, /차단 이슈 1건/);
  assert.match(text, /착수를 막는 정할 것 1건/);
});

test('동작 가능표의 빈칸은 정할 것으로 보인다', () => {
  const html = renderHtml(runPipeline(example()));
  const table = html.split('data-section="permissions"')[1].split('data-section="flow"')[0];
  assert.match(table, /정할 것/);
  assert.match(table, /숨김/);
  assert.match(table, /허용 · 모든 상태/);
});

test('완료 조건은 상황 → 행동 → 결과로 쓰고 초안은 확인 필요로 표시한다', () => {
  const html = renderHtml(runPipeline(example()));
  const section = html.split('data-section="acceptance"')[1].split('data-section="metrics"')[0];
  assert.match(section, /상황/);
  assert.match(section, /행동/);
  assert.match(section, /결과/);
  assert.match(section, /확인 필요/);
});

test('모델 데이터를 다시 읽을 수 있고 메타가 있다', () => {
  const html = renderHtml(runPipeline(example()));
  const json = html.split('<script type="application/json" id="spec-model">')[1].split('</script>')[0];
  const model = JSON.parse(json);
  assert.equal(model.format, 'product-planning/spec@1');
  assert.ok(model.derived.screens.length > 0);
  assert.equal(model.report.ready, false);
  assert.match(html, /<meta name="spec-ready" content="false">/);
  assert.match(html, /<meta name="spec-score" content="[0-9.]+">/);
});

test('특수문자 이름과 빈 입력도 깨지지 않는다', () => {
  const { spec } = parseSpec(JSON.stringify({ meta: { title: '</script><b>제목</b>' } }));
  const html = renderHtml(runPipeline(spec));
  assert.ok(html.includes('&lt;/script&gt;&lt;b&gt;제목&lt;/b&gt;'));
  assert.ok(html.includes('착수 불가'));
  assert.equal(html.split('<script type="application/json"').length, 2);
  assert.ok(!html.includes('<script>'), '실행 스크립트가 없어야 한다');
});

test('본문에 undefined·null·NaN 같은 값이 새어 나오지 않는다', () => {
  const text = bodyText(renderHtml(runPipeline(example())));
  assert.ok(!/undefined|null|NaN/.test(text), text.match(/.{0,30}(undefined|null|NaN).{0,30}/)?.[0]);
  assert.match(text, /'항목 만들기'에서/);
});

test('같은 입력이면 HTML이 바이트 단위로 같다', () => {
  assert.equal(renderHtml(runPipeline(example())), renderHtml(runPipeline(example())));
});
