import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { packRows, renderBoard } from '../src/render/board.mjs';
import { parseSpec } from '../src/model/load.mjs';
import { runPipeline } from '../src/check/run.mjs';
import { renderHtml } from '../src/render/html.mjs';

const frame = (id, title, width, height) => ({ id, title, subtitle: '부제', width, height, markup: `<rect width="${width}" height="${height}"/>` });
const rows = [[frame('map', '화면 지도', 900, 300)], [frame('s1', '과제 <부여>', 400, 700), frame('s2', '과제 수정', 500, 500)]];
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test('도화지는 프레임을 줄마다 나란히 놓고 서로 겹치지 않게 한다', () => {
  const html = renderBoard({ rows });
  const boxes = [...html.matchAll(/data-frame="([^"]+)" data-box="([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+)"/g)]
    .map(([, id, x, y, w, h]) => ({ id, x: +x, y: +y, w: +w, h: +h }));
  assert.deepEqual(boxes.map((box) => box.id), ['map', 's1', 's2']);
  boxes.forEach((one, i) => boxes.slice(i + 1).forEach((two) => assert.equal(overlaps(one, two), false, `${one.id}와 ${two.id}가 겹친다`)));
  assert.ok(boxes[1].y > boxes[0].y + boxes[0].h, '둘째 줄은 첫 줄 아래에 온다');
  assert.equal(boxes[1].y, boxes[2].y, '같은 줄은 위를 맞춘다');
});

test('확대·이동 도구와 프레임 바로가기를 두고, 스크립트가 없어도 그림은 원래 크기로 보인다', () => {
  const html = renderBoard({ rows });
  for (const control of ['in', 'out', 'fit', 'reset', 'full']) assert.ok(html.includes(`data-zoom="${control}"`), control);
  assert.ok(html.includes('<option value="s1">과제 &lt;부여&gt;</option>'));
  assert.match(html, /<svg[^>]*data-width="\d+"[^>]*width="\d+"[^>]*height="\d+"/);
  assert.equal((html.match(/<script>/g) ?? []).length, 1, '도구 스크립트는 한 번만 넣는다');
  assert.ok(!/<script[^>]+src=/.test(html) && !/<link/.test(html), '외부 파일을 참조하지 않는다');
  assert.equal(html, renderBoard({ rows }));
});

test('정본 HTML의 흐름도 절에 화면 지도와 시나리오마다 플로우차트 프레임이 들어간다', () => {
  const { spec } = parseSpec(readFileSync(new URL('../examples/assignment/spec.json', import.meta.url), 'utf8'));
  const result = runPipeline(spec);
  const html = renderHtml(result);
  const flow = html.split('data-section="flow"')[1].split('data-section="screens"')[0];
  assert.match(flow, /<h2>5\. 흐름도<\/h2>/);
  const frames = [...flow.matchAll(/data-frame="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(frames, ['screen-map', ...spec.scenarios.map((scenario) => `flowchart-${scenario.id}`)]);
  assert.match(flow, /data-node-type="decision"/);
  const model = JSON.parse(html.match(/<script type="application\/json" id="spec-model">([\s\S]*?)<\/script>/)[1]);
  assert.equal(model.derived.flowcharts.length, spec.scenarios.length);
});

test('프레임이 많으면 화면 비율에 가깝게 여러 줄로 채우고 순서는 지킨다', () => {
  const many = Array.from({ length: 12 }, (_, i) => frame(`f${i}`, `시나리오 ${i}`, 400 + (i % 3) * 120, 500 + (i % 4) * 150));
  const packed = packRows(many, [frame('map', '화면 지도', 1600, 700)]);
  assert.deepEqual(packed[0].map((item) => item.id), ['map'], '고정한 줄은 맨 위에 그대로 둔다');
  assert.deepEqual(packed.slice(1).flat().map((item) => item.id), many.map((item) => item.id));
  const html = renderBoard({ rows: packed });
  const [, width, height] = html.match(/data-width="(\d+)" data-height="(\d+)"/).map(Number);
  assert.ok(width / height > 1 && width / height < 2.6, `비율 ${width}×${height}`);
});
