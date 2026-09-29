import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSpec } from '../src/model/load.mjs';
import { runPipeline } from '../src/check/run.mjs';
import { RULES } from '../src/check/rules.mjs';

const load = () => parseSpec(readFileSync(new URL('../examples/assignment/spec.json', import.meta.url), 'utf8'));

test('엣지 케이스는 모두 어느 플로우차트에 그려져 있다 (누락 검사)', () => {
  const { spec, problems } = load();
  const { report } = runPipeline(spec, problems);
  assert.deepEqual(report.issues.filter((issue) => issue.rule === 'flow-coverage').map((issue) => issue.message), []);
});

test('플로우차트에서 갈래가 빠지면 누락 검사가 찾아낸다', () => {
  const { spec, problems } = load();
  const result = runPipeline(spec, problems);
  const chart = result.derived.flowcharts.find((item) => item.kind === 'function' && item.of === 'AC4');
  chart.edges = chart.edges.filter((edge) => edge.label !== '마감 실패');
  chart.nodes = chart.nodes.filter((node) => node.text !== '확인 창에서 확인했나?');
  const rule = RULES.find((item) => item.name === 'flowCoverage');
  const messages = rule({ ...result, problems }).issues.map((issue) => issue.message);
  assert.ok(messages.some((m) => /'항목 마감하기'.*서버.*마감 실패/.test(m)), messages.join('\n'));
  assert.ok(messages.some((m) => /'항목 마감하기'.*확인 창/.test(m)));
});
