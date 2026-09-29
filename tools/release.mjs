#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLUGIN_NAME, applyRelease, parseCommit, planRelease } from './release/lib.mjs';

const USAGE = `사용법:
  node tools/release.mjs plan  [--json] [--root <저장소>] [--github-output]   배포할지와 다음 버전을 계산한다
  node tools/release.mjs apply [--root <저장소>] [--github-output]            plugin.json 버전과 CHANGELOG.md를 갱신한다`;

const RECORD = '\u001e';
const FIELD = '\u001f';

// core.quotepath=false: 기본값이면 한글 파일명이 "docs/\354…"처럼 따옴표·8진수로 나와 경로 판정이 틀린다.
function git(root, args) {
  return execFileSync('git', ['-c', 'core.quotepath=false', ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function lastReleaseTag(root) {
  try {
    return git(root, ['describe', '--tags', '--match', `${PLUGIN_NAME}--v*`, '--abbrev=0']).trim();
  } catch (error) {
    // 배포 태그가 아직 없으면 처음 배포다. 저장소의 모든 커밋이 대상이 된다.
    // 태그가 없다는 것 외의 git 오류(저장소 아님 등)는 삼키지 않는다.
    if (/No names found|No tags can describe|cannot describe/.test(String(error.stderr))) return null;
    throw new Error(`마지막 배포 태그를 찾지 못했습니다: ${String(error.stderr).trim() || error.message}`);
  }
}

function readCommits(root) {
  const tag = lastReleaseTag(root);
  const range = tag ? [`${tag}..HEAD`] : ['HEAD'];
  const log = git(root, ['log', '--reverse', `--format=${RECORD}%H${FIELD}%s${FIELD}%b${FIELD}`, '--name-only', ...range]);
  return log.split(RECORD).filter((record) => record.trim() !== '').map((record) => {
    const [sha, subject, body, filesText = ''] = record.split(FIELD);
    return parseCommit({ sha, subject, body, files: filesText.split('\n').map((line) => line.trim()).filter(Boolean) });
  });
}

function plan(root) {
  const { version } = JSON.parse(readFileSync(join(root, '.claude-plugin', 'plugin.json'), 'utf8'));
  // 날짜는 실행 시각이 아니라 HEAD 커밋 날짜로 정해 같은 이력이면 같은 변경 기록이 나오게 한다.
  const date = git(root, ['log', '-1', '--format=%cs']).trim();
  return planRelease({ version, date, commits: readCommits(root) });
}

function writeGithubOutput(result) {
  const target = process.env.GITHUB_OUTPUT;
  if (!target) return;
  const delimiter = `NOTES_${Date.now()}`;
  appendFileSync(target, [
    `releasable=${result.releasable}`,
    `version=${result.next ?? ''}`,
    `tag=${result.tag ?? ''}`,
    `notes<<${delimiter}`, result.notes, delimiter, '',
  ].join('\n'));
}

function usage(message) {
  if (message) process.stderr.write(`${message}\n`);
  process.stderr.write(`${USAGE}\n`);
  process.exit(2);
}

const [command, ...rest] = process.argv.slice(2);
const rootAt = rest.indexOf('--root');
if (rootAt !== -1 && !rest[rootAt + 1]) usage('--root 뒤에 경로가 필요합니다');
const root = resolve(rootAt === -1 ? fileURLToPath(new URL('..', import.meta.url)) : rest[rootAt + 1]);

if (command !== 'plan' && command !== 'apply') usage(command ? `알 수 없는 명령입니다: ${command}` : undefined);

const result = plan(root);
if (command === 'apply') applyRelease(root, result);
if (rest.includes('--github-output')) writeGithubOutput(result);

if (rest.includes('--json')) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else if (!result.releasable) {
  process.stdout.write(`배포할 변경이 없습니다 (현재 ${result.current}). 플러그인 파일(${'.claude-plugin/, skills/, src/, scripts/, docs/'})이 바뀐 커밋이 없습니다.\n`);
} else {
  process.stdout.write(`${command === 'apply' ? '적용했습니다' : '계획'}: ${result.current} → ${result.next} (${result.bump}), 태그 ${result.tag}\n\n${result.notes}`);
}
