import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSpec } from '../src/model/load.mjs';
import { runPipeline } from '../src/check/run.mjs';
import { renderPages } from '../src/render/html.mjs';

const base = (product) => parseSpec(JSON.stringify({
  meta: { title: 't' },
  ...(product === undefined ? {} : { product }),
  apps: [{ id: 'P1', name: '코치 웹', platform: 'web' }, { id: 'P2', name: '선수 앱', platform: 'ios' }],
  entities: [{ id: 'E1', name: '과제' }],
  actions: [{ id: 'A1', name: '과제 부여하기', entity: 'E1', kind: 'create', calls: ['API'] }],
}));
const productIssues = ({ spec, problems }) => runPipeline(spec, problems).report.issues.filter((i) => i.rule === 'product').map((i) => i.message);

test('서비스 구성이 없으면 구분·시스템을 정하라고 경고한다', () => {
  const found = productIssues(base(undefined));
  assert.ok(found.some((m) => /구분/.test(m)), found.join('\n'));
  assert.ok(found.some((m) => /시스템/.test(m)));
});

test('어느 서비스에도 속하지 않은 앱, 없는 시스템을 부르는 동작, 플랫폼 없는 앱을 경고한다', () => {
  const found = productIssues(base({ kind: 'feature', systems: [{ id: 'S1', name: '코치 서비스', kind: 'service', apps: ['P1'] }] }));
  assert.ok(found.some((m) => /'선수 앱'.*어느 서비스에도/.test(m)), found.join('\n'));
  assert.ok(found.some((m) => /'과제 부여하기'.*'API'/.test(m)));
  const ok = base({ kind: 'feature', systems: [
    { id: 'S1', name: '코치 서비스', kind: 'service', apps: ['P1'] }, { id: 'S2', name: '선수 서비스', kind: 'service', apps: ['P2'] }, { id: 'API', name: 'IDP API', kind: 'api' },
  ] });
  assert.deepEqual(productIssues(ok), []);
});

test('형식이 틀린 서비스 구성은 형식 오류로 보고한다', () => {
  const { problems } = base({ kind: '서비스', systems: [{ id: 'S1', name: 'x', kind: 'server', apps: 'P1' }] });
  const paths = problems.map((p) => p.path);
  for (const path of ['product.kind', 'product.systems[0].kind', 'product.systems[0].apps']) assert.ok(paths.includes(path), path);
});

test('PRD 맨 위에 구분과 서비스·앱·플랫폼·API를 한 줄씩 보인다', () => {
  const { spec } = base({ kind: 'feature', systems: [
    { id: 'S1', name: '코치 서비스', kind: 'service', apps: ['P1'] }, { id: 'S2', name: '선수 서비스', kind: 'service', apps: ['P2'] }, { id: 'API', name: 'IDP API', kind: 'api' },
  ] });
  const html = renderPages(runPipeline(spec), { name: 't' })['t.html'];
  const text = html.split('data-part="prd"')[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  assert.match(text, /구성 기존 서비스에 기능 추가 · 서비스 2개 · API 1개/);
  assert.match(text, /코치 서비스 코치 웹 \(웹\)/);
  assert.match(text, /선수 서비스 선수 앱 \(iOS\)/);
  assert.match(text, /IDP API API 서버/);
});
