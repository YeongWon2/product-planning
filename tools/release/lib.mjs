import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const PLUGIN_NAME = 'product-planning';

// 설치한 사람의 Claude Code가 읽는 파일. 스킬이 docs/의 명세·설계서를 직접 읽으므로 docs/도 포함한다.
// 테스트·예제·README·배포 도구(tools/)만 바뀐 변경은 사용자에게 달라지는 것이 없어 배포하지 않는다.
export const PLUGIN_PATHS = ['.claude-plugin/', 'skills/', 'src/', 'scripts/', 'docs/'];

const CONVENTIONAL = /^(\w+)(?:\(([^)]*)\))?(!)?:\s*(.+)$/;
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
// 커밋 본문의 'Release-As: 1.0.0' 꼬리말로 다음 버전을 직접 정한다. 0.x에서 1.0.0으로 올릴 때처럼 자동 계산으로 못 가는 경우에 쓴다.
const RELEASE_AS = /^Release-As:\s*(\d+\.\d+\.\d+)\s*$/m;

export function parseCommit({ sha, subject, body = '', files = [] }) {
  const match = CONVENTIONAL.exec(subject.trim());
  const breaking = Boolean(match?.[3]) || /^BREAKING[ -]CHANGE:/m.test(body);
  return {
    sha,
    subject,
    type: match ? match[1] : null,
    scope: match?.[2] ?? null,
    breaking,
    releaseAs: RELEASE_AS.exec(body)?.[1] ?? null,
    description: match ? match[4] : subject.trim(),
    files,
  };
}

export const tagFor = (version) => `${PLUGIN_NAME}--v${version}`;
const isReleaseCommit = (commit) => commit.type === 'chore' && commit.scope === 'release';
export const touchesPlugin = (files) => files.some((file) => PLUGIN_PATHS.some((path) => file.startsWith(path)));
const releasableCommits = (commits) => commits.filter((commit) => !isReleaseCommit(commit) && touchesPlugin(commit.files));

export function bumpFor(commits, version) {
  const relevant = releasableCommits(commits);
  if (relevant.length === 0) return null;
  if (relevant.some((commit) => commit.breaking)) {
    // 1.0.0 전에는 형식이 아직 자리 잡는 중이라 호환이 깨져도 minor 로 올린다 (semver §4 관례).
    return version.startsWith('0.') ? 'minor' : 'major';
  }
  if (relevant.some((commit) => commit.type === 'feat')) return 'minor';
  return 'patch';
}

export function nextVersion(version, bump) {
  const match = SEMVER.exec(version);
  if (!match) throw new Error(`plugin.json 버전이 '주.부.수' 형식이 아닙니다: ${version}`);
  const [major, minor, patch] = match.slice(1).map(Number);
  if (bump === 'major') return `${major + 1}.0.0`;
  if (bump === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

const SECTIONS = [
  ['새 기능', (commit) => commit.type === 'feat'],
  ['고친 것', (commit) => commit.type === 'fix'],
  ['그 밖의 변경', (commit) => commit.type !== 'feat' && commit.type !== 'fix'],
];

export function renderChangelogSection({ version, date, commits }) {
  const lines = [`## ${version} — ${date}`, ''];
  for (const [title, belongs] of SECTIONS) {
    const items = commits.filter(belongs);
    if (items.length === 0) continue;
    lines.push(`### ${title}`);
    for (const commit of items) lines.push(`- ${commit.breaking ? '**호환 깨짐** ' : ''}${commit.description} (${commit.sha.slice(0, 7)})`);
    lines.push('');
  }
  return lines.join('\n');
}

const compareVersions = (a, b) => {
  const [x, y] = [a, b].map((v) => SEMVER.exec(v).slice(1).map(Number));
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
};

function forcedVersion(commits, version) {
  const wanted = commits.filter((commit) => !isReleaseCommit(commit) && commit.releaseAs).map((commit) => commit.releaseAs);
  if (wanted.length === 0) return null;
  const highest = wanted.sort(compareVersions).at(-1);
  if (compareVersions(highest, version) <= 0) throw new Error(`Release-As ${highest}가 지금 버전 ${version}보다 크지 않습니다.`);
  return highest;
}

export function planRelease({ version, date, commits }) {
  const forced = forcedVersion(commits, version);
  const relevant = forced ? commits.filter((commit) => !isReleaseCommit(commit) && (commit.releaseAs || touchesPlugin(commit.files))) : releasableCommits(commits);
  const bump = forced ? 'release-as' : bumpFor(commits, version);
  if (bump === null) return { releasable: false, current: version, next: null, tag: null, bump: null, commits: [], notes: '' };
  const next = forced ?? nextVersion(version, bump);
  return {
    releasable: true,
    current: version,
    next,
    tag: tagFor(next),
    bump,
    commits: relevant,
    notes: renderChangelogSection({ version: next, date, commits: relevant }),
  };
}

const CHANGELOG_HEADER = '# 변경 기록\n';

export function applyRelease(root, plan) {
  if (!plan.releasable) return;
  const manifestPath = join(root, '.claude-plugin', 'plugin.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  writeFileSync(manifestPath, `${JSON.stringify({ ...manifest, version: plan.next }, null, 2)}\n`);

  const changelogPath = join(root, 'CHANGELOG.md');
  const previous = existsSync(changelogPath) ? readFileSync(changelogPath, 'utf8') : CHANGELOG_HEADER;
  const rest = previous.startsWith(CHANGELOG_HEADER) ? previous.slice(CHANGELOG_HEADER.length).replace(/^\n+/, '') : previous;
  writeFileSync(changelogPath, `${CHANGELOG_HEADER}\n${plan.notes}\n${rest}`.replace(/\n+$/, '\n'));
}
