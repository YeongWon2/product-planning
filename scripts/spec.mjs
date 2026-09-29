#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { loadSpec } from '../src/model/load.mjs';
import { runPipeline } from '../src/check/run.mjs';
import { renderHtml } from '../src/render/html.mjs';

const USAGE = `사용법:
  node scripts/spec.mjs check <spec.json>                 검사만 한다
  node scripts/spec.mjs build <spec.json> [--out <폴더>]  HTML과 report.json을 만든다 (기본: spec 옆 out/)`;

// 착수 불가(1)와 입력 오류(2·3)를 구분해야 자동화에서 "기획이 덜 됨"과 "도구를 잘못 씀"을 가를 수 있다.
const EXIT = { ready: 0, blocked: 1, usage: 2, unreadable: 3 };

function formatReport(report, questions) {
  const { score } = report;
  const lines = [
    report.ready ? '착수 가능' : `착수 불가 — ${report.reasons.join(', ')}`,
    `검사 ${score.checked}개 중 ${score.passed}개 통과 (${Math.round(score.ratio * 1000) / 10}%) · 차단 이슈 ${score.blockIssues} · 경고 ${score.warnIssues} · 착수를 막는 정할 것 ${score.blockingQuestions} · 가정 비율 ${Math.round(score.assumptionRatio * 1000) / 10}%`,
  ];
  for (const issue of report.issues) lines.push(`  [${issue.level === 'block' ? '차단' : '경고'}] ${issue.message}`);
  for (const question of questions) lines.push(`  [정할 것] ${question.name}`);
  return lines.join('\n');
}

function load(path) {
  const { spec, error } = loadSpec(path);
  if (error !== null) {
    process.stderr.write(`${error}\n`);
    process.exit(EXIT.unreadable);
  }
  return runPipeline(spec);
}

function check(path) {
  const result = load(path);
  process.stdout.write(`${formatReport(result.report, result.derived.questions)}\n`);
  process.exit(result.report.ready ? EXIT.ready : EXIT.blocked);
}

function build(path, outOption) {
  const result = load(path);
  const outDir = outOption ?? join(dirname(path), 'out');
  const name = basename(dirname(resolve(path)));
  const htmlPath = join(outDir, `${name}.html`);
  const reportPath = join(outDir, 'report.json');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(htmlPath, renderHtml(result));
  writeFileSync(reportPath, `${JSON.stringify(result.report, null, 2)}\n`);
  process.stdout.write(`${formatReport(result.report, result.derived.questions)}\n\n만든 파일:\n  ${htmlPath}\n  ${reportPath}\n`);
  process.exit(EXIT.ready);
}

function usage(message) {
  if (message) process.stderr.write(`${message}\n`);
  process.stderr.write(`${USAGE}\n`);
  process.exit(EXIT.usage);
}

const [command, path, ...rest] = process.argv.slice(2);
if (!command) usage();
if (!path) usage('기획서 파일(spec.json) 경로가 필요합니다');

if (command === 'check') {
  check(path);
} else if (command === 'build') {
  const outAt = rest.indexOf('--out');
  if (outAt !== -1 && !rest[outAt + 1]) usage('--out 뒤에 폴더 경로가 필요합니다');
  build(path, outAt === -1 ? undefined : rest[outAt + 1]);
} else {
  usage(`알 수 없는 명령입니다: ${command}`);
}
