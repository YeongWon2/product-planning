import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { textWidth, wrapToWidth } from '../src/render/text.mjs';
import { layoutBoardFrames } from '../src/render/board.mjs';
import { parseSpec } from '../src/model/load.mjs';
import { runPipeline } from '../src/check/run.mjs';
import { layoutFlowchart } from '../src/render/flowchart-svg.mjs';
import { layoutOverview } from '../src/render/overview-svg.mjs';

test('글 폭은 한글·영문·숫자·공백을 따로 센다', () => {
  assert.ok(textWidth('가나다', 13) > textWidth('abc', 13));
  assert.ok(textWidth('2~50자', 13) < textWidth('이이이이이', 13));
  for (const line of wrapToWidth('대상 선수·연결할 상세 목표·인증 방식·과제명·과제 설명 입력', 13, 180)) assert.ok(textWidth(line, 13) <= 180, line);
  for (const line of wrapToWidth('띄어쓰기없는아주아주긴낱말이계속이어진다고해도', 13, 120)) assert.ok(textWidth(line, 13) <= 120, line);
});

test('프레임 제목과 부제는 프레임 안에 들어간다', () => {
  const frames = layoutBoardFrames([[{ id: 'a', title: '코치가 선수의 제출물을 확인하고 피드백을 남긴다', subtitle: '시나리오 · 코치가 선수의 제출물을 확인하고 피드백을 남긴다 · 기본 흐름', width: 120, height: 80, markup: '' }]]);
  for (const { frame, w } of frames.placed) {
    assert.ok(textWidth(frame.title, 17) + 48 <= w, '제목');
    assert.ok(textWidth(frame.subtitle, 13) + 48 <= w, '부제');
  }
});

const result = () => { const { spec, problems } = parseSpec(readFileSync(new URL('../examples/assignment/spec.json', import.meta.url), 'utf8')); return runPipeline(spec, problems); };

test('플로우차트와 전체 흐름의 상자 글은 상자 안에 들어간다', () => {
  const r = result();
  const layouts = [...r.derived.flowcharts.map((chart) => layoutFlowchart(chart)), layoutOverview(r.derived.overview, r.index)];
  for (const layout of layouts) {
    for (const node of layout.nodes) {
      const lines = node.lines ?? [];
      const room = node.type === 'decision' ? node.w * 0.6 : node.w - 20;
      for (const line of lines) assert.ok(textWidth(line, 13) <= room, `${node.id}: '${line}' 폭 ${textWidth(line, 13)} > ${room}`);
      assert.ok(lines.length * 18 <= (node.type === 'decision' ? node.h * 0.62 : node.h - 8), `${node.id}: 줄이 상자를 넘는다`);
    }
  }
});
