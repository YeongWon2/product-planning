import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSpec, parseSpec } from '../src/model/load.mjs';
import { runPipeline } from '../src/check/run.mjs';
import { buildModel, buildPrompt, renderPages } from '../src/render/html.mjs';

const example = () => loadSpec(new URL('../examples/assignment/spec.json', import.meta.url).pathname).spec;
const pagesOf = (spec) => renderPages(runPipeline(parseSpec(JSON.stringify(spec)).spec), { name: 'assignment' });
// 부분마다 파일이 따로 있다. 테스트는 네 파일을 이어 붙여 한 번에 본다.
const FILES = ['assignment.html', 'assignment.scenarios.html', 'assignment.flowcharts.html', 'assignment.spec.html'];
const render = (spec) => { const pages = pagesOf(spec); return FILES.map((file) => pages[file]).join('\n'); };
const renderHtml = (result) => renderPages(result, { name: 'assignment' })['assignment.html'];

// 사람이 브라우저에서 보는 글자만 남긴다. 스크립트(모델 데이터·도화지 조작)는 뺀다.
function bodyText(html) {
  return (html.includes('<body>') ? html.split('<body>')[1] : html)
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<(title|style)[\s\S]*?<\/\1>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
}
const part = (html, key) => html.split(`data-part="${key}"`)[1].split('</section>')[0];

test('사람이 읽는 문서는 부분마다 파일이 따로 있고 위쪽 탭으로 오간다', () => {
  const pages = pagesOf(example());
  assert.deepEqual(Object.keys(pages), FILES);
  FILES.forEach((file, i) => {
    const html = pages[file];
    assert.match(html, /^<!doctype html>/);
    assert.deepEqual([...html.matchAll(/data-part="([a-z]+)"/g)].map((m) => m[1]), [['prd', 'scenarios', 'flowcharts', 'spec'][i]]);
    assert.deepEqual([...html.matchAll(/<a class="part-link[^"]*" href="([^"]+)"/g)].map((m) => m[1]), FILES, '탭은 네 파일로 간다');
    assert.match(html, new RegExp(`<a class="part-link current" href="${FILES[i].replace('.', '\\.')}"`), '지금 부분이 표시된다');
  });
  assert.equal(FILES.filter((file) => pages[file].includes('id="spec-model"')).length, 1, '모델 데이터는 첫 파일에만 넣는다');
});

test('플로우차트 파일은 화면 전체를 도화지로 쓴다', () => {
  const html = pagesOf(example())['assignment.flowcharts.html'];
  assert.match(html, /<body class="fullscreen">/);
  assert.match(html, /\.fullscreen \.board-live \.board-view\{height:calc\(100vh/);
});

test('본문에는 내부 ID와 개발에 필요 없는 정보가 보이지 않는다', () => {
  const text = bodyText(render(example()));
  for (const id of ['U1', 'U2', 'P1', 'R1', 'E1', 'ST1', 'AC3', 'S1', 'M1']) assert.ok(!new RegExp(`\\b${id}\\b`).test(text), `${id}가 보인다`);
  for (const word of ['이번에 하지 않는 것', '품질 점수', '추적표', '화면 목록', '화면 지도', '자동 초안']) assert.ok(!text.includes(word), `${word}가 보인다`);
});

test('착수 전에 정할 것이 있으면 맨 위에 알린다', () => {
  const html = render(example());
  const top = bodyText(html.split('data-part="prd"')[0]);
  assert.match(top, /착수 전에 정할 것/);
  assert.match(top, /'배정 관리자'는 '완료' 상태의 '항목'에 '항목 수정하기'를 할 수 있는가\?/);
});

test('시나리오는 요구사항마다 시나리오 한 줄과 완료 조건만 보이고, 단계는 플로우차트에만 있다', () => {
  const html = render(example());
  const text = bodyText(part(html, 'scenarios'));
  assert.match(text, /관리자가 항목을 배정한다/);
  assert.match(text, /항목 배정 · 기본 흐름 기본 흐름 배정 관리자 · 3단계/);
  assert.ok(!text.includes('제목과 담당자를 넣어 항목을 만든다'), '단계 글은 시나리오 부분에 없다');
  assert.ok(part(html, 'flowcharts').includes('제목과 담당자를'), '단계 글은 플로우차트에 있다');
  assert.match(text, /상황 .+ 행동 .+ 결과 .+/, '완료 조건은 상황·행동·결과로 보인다');
});

test('플로우차트는 전체 흐름 한 장과 시나리오·기능·페이지마다 한 장씩 도화지에 올린다', () => {
  const html = part(render(example()), 'flowcharts');
  const frames = [...html.matchAll(/data-frame="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(frames[0], 'flowchart-overview', '맨 앞은 전체 흐름');
  assert.deepEqual(frames.slice(1, 3), example().scenarios.map((s) => `flowchart-scenario-${s.id}`));
  assert.ok(frames.some((id) => id.startsWith('flowchart-function-')) && frames.some((id) => id.startsWith('flowchart-page-')), '기능·페이지 플로우차트도 있다');
});

test('기능명세서는 공통 규칙 한 번, 기능마다 누가·넣는 것·결과·막는 경우 한 줄로 끝난다', () => {
  const html = part(render(example()), 'spec');
  const text = bodyText(html);
  assert.match(html, /<svg class="state-diagram"/);
  assert.match(text, /공통 규칙 .*숨김은 보이지 않음.*입력 규칙을 어기면.*한 번만 요청.*불러오는 중·빈 화면·오류·권한 없음·보기 전용/);
  assert.match(text, /항목 만들기 서버 처리 배정 관리자 가능 · 담당자 숨김/, '누가는 제목 옆 한 줄');
  assert.match(text, /누가에 없는 사용자는 할 수 없음/, '불가인 사용자는 공통 규칙 한 줄로 뺀다');
  assert.match(text, /제목 텍스트 예 최대 50자/, '항목 · 형식 · 필수 · 범위 순서');
  assert.match(text, /성공 항목을 배정했습니다/);
  assert.match(text, /막는 경우 입력 규칙 위반 · 저장 실패/, '사용자는 막는 경우에 되풀이하지 않는다');
  assert.match(text, /항목 수정하기[\s\S]*막는 경우 입력 규칙 위반 · '완료' 상태/, '할 수 있는 사람도 막히는 상태만 남긴다');
  assert.ok(!text.includes('엣지 케이스'), '경계값 나열은 문서에 없다 (모델 데이터에만)');
  assert.ok(!text.includes('51자'));
  assert.match(text, /배정 관리자 진행 중 가능\s*,\s*완료 정할 것/, '빈칸은 정할 것으로 보인다');
  assert.match(text, /메모 형식 없음/, '형식 없는 입력은 드러낸다');
});

test('AI용 모델 데이터는 문서 지도와 함께 다시 읽을 수 있다', () => {
  const result = runPipeline(example());
  const html = renderHtml(result);
  const embedded = JSON.parse(html.match(/<script type="application\/json" id="spec-model">([\s\S]*?)<\/script>/)[1]);
  assert.deepEqual(embedded, JSON.parse(JSON.stringify(buildModel(result))));
  assert.equal(embedded.format, 'product-planning/spec@1');
  assert.deepEqual(embedded.document.parts.map((item) => item.key), ['prd', 'scenarios', 'flowcharts', 'spec']);
  assert.ok(embedded.document.dataOnly.includes('derived.screens'));
  assert.ok(embedded.document.parts.find((item) => item.key === 'spec').shows.includes('derived.edgeCases'));
  assert.ok(Array.isArray(embedded.derived.edgeCases) && embedded.derived.edgeCases.length > 0);
  assert.match(html, /<meta name="spec-ready" content="false">/);
});

test('특수문자 이름과 빈 입력도 깨지지 않는다', () => {
  const spec = example();
  spec.meta.title = '<b>제목</b> & "따옴표"';
  spec.requirements[0].name = "<script>alert('x')</script>";
  const html = render(spec);
  assert.ok(!html.includes("<script>alert('x')</script>"));
  assert.ok(html.includes('&lt;b&gt;제목&lt;/b&gt;'));
  assert.doesNotThrow(() => renderHtml(runPipeline(parseSpec('{}').spec)));
});

test('본문에 undefined·null·NaN 같은 값이 새어 나오지 않는다', () => {
  for (const spec of [example(), {}]) {
    const text = bodyText(render(spec));
    for (const leak of ['undefined', 'null', 'NaN', '[object Object]']) assert.ok(!text.includes(leak), `${leak}가 보인다`);
  }
});

test('같은 입력이면 HTML이 바이트 단위로 같다', () => {
  assert.equal(render(example()), render(example()));
});

test('출처 위치의 § 기호는 장·절로 풀어 보여 준다', () => {
  const spec = example();
  spec.summary.problem.source = { kind: 'doc', ref: '기획 문서 §3, §5.1.2' };
  const text = bodyText(render(spec));
  assert.ok(text.includes('기획 문서 3장, 5.1.2절'));
  assert.ok(!text.includes('§'));
});

test('프롬프트 복사 버튼은 파일 위치로 채울 자리표와 읽는 법이 담긴 프롬프트를 준다', () => {
  const html = renderHtml(runPipeline(example()));
  assert.match(html, /<button[^>]*data-copy-prompt/);
  const prompt = JSON.parse(html.match(/<script type="application\/json" id="spec-prompt">([\s\S]*?)<\/script>/)[1]);
  assert.equal(prompt, buildPrompt());
  assert.ok(prompt.includes('{html}') && prompt.includes('{model}'), '경로는 열릴 때 채운다');
  assert.match(prompt, /derived\.edgeCases/);
  assert.match(buildPrompt({ html: '/a/b.html', model: '/a/model.json' }), /\/a\/b\.html[\s\S]*\/a\/model\.json/);
  assert.ok(!/<script[^>]+src=/.test(html), '외부 스크립트를 쓰지 않는다');
});

test('모든 상태에서 불가인 사용자와 공통 문구와 같은 실패는 기능마다 되풀이하지 않는다', () => {
  const spec = example();
  const network = '네트워크 연결을 확인해 주세요';
  spec.wording.network = network;
  spec.actions.find((a) => a.id === 'AC3').failures.push({ name: '통신 실패', message: network });
  // 상태 다이어그램 글자는 빼고 본문만 본다.
  const text = bodyText(part(render(spec), 'spec').replace(/<svg[\s\S]*?<\/svg>/g, ' '));
  const fn = text.slice(text.indexOf('항목 만들기'), text.indexOf('항목 마감하기'));
  assert.ok(fn.length > 0);
  assert.ok(!/담당자 불가/.test(text), '불가만 있는 사용자는 누가에 없다');
  assert.equal((fn.match(new RegExp(network, 'g')) ?? []).length, 0, '공통 문구와 같은 실패 문구는 기능에 없다');
  assert.ok(!/막는 경우[^.]*통신 실패/.test(fn), '막는 경우에도 없다');
});

test('좁은 화면에서는 표를 칸 이름이 붙은 카드로 쌓고 긴 글은 줄을 바꾼다', () => {
  const html = pagesOf(example())['assignment.spec.html'];
  assert.match(html, /@media \(max-width:720px\)\{[^}]*\.stack thead\{display:none\}/);
  assert.match(html, /td\{[^}]*overflow-wrap:anywhere[^}]*word-break:keep-all/);
  assert.match(html, /<table class="inputs stack">/);
  assert.match(html, /<td data-label="범위·조건">/);
});
