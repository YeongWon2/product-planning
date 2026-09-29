# 코어 파이프라인 (P1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `spec.json` 하나를 넣으면 검사 결과 `report.json`과, 화면 흐름이 자동 도출된 정본 `{기능}.html`이 항상 같은 모양으로 나온다.

**Architecture:** 원천 모델을 읽어 ID 색인을 만들고, 파생기(동작 가능표 빈칸 · 정할 것 · 완료 조건 초안 · 화면 흐름)가 파생 모델을 만든다. 검사기는 원천 + 파생 모델에 관계 규칙을 적용해 보고서를 만들고, 렌더러가 셋을 HTML 한 파일(본문 + SVG + 모델 데이터 + 표식)로 만든다. 모든 단계는 순수 함수이며 입력 순서만으로 출력 순서가 정해진다.

**Tech Stack:** Node.js 20 이상 (개발 환경 24.11.1), ESM `.mjs`, 테스트는 `node:test` + `node:assert/strict`. 외부 의존성 0.

**Spec:** `docs/산출물-명세.md` (계약), `docs/설계서.md` 3장·4.1절·5.1절·8장 (배경)

## Global Constraints

- 외부 의존성을 추가하지 않는다. 필요해지면 작업을 멈추고 사용자에게 패키지·버전·이유·대안을 묻는다.
- 같은 입력 → 바이트 단위로 같은 출력. 시각·난수·Map 순회 외 정렬되지 않은 값을 출력에 쓰지 않는다.
- 사람에게 보이는 모든 문구는 한글이다. 요소는 이름으로 부르고, 내부 ID는 HTML 본문 텍스트에 넣지 않는다 (부록 추적표와 속성만 예외).
- 본체 코드(`src/`)에 특정 도메인·제품·도구 이름을 넣지 않는다. 예제(`examples/`)는 범용 예제("항목 배정")만 쓴다.
- 입력이 잘못돼도 예외로 멈추지 않는다. 형식 오류는 `report.issues`로, JSON 파싱 실패만 CLI 종료 코드 3으로 알린다.
- 커밋 메시지는 한글, conventional 접두어, Co-Authored-By를 넣지 않는다.

## Review Focus

- 존재하지 않는 ID를 참조한 입력 (오타) → 멈추지 않고 "알 수 없는 참조" 차단 이슈로 보고한다. (Task 4 테스트)
- 이름에 `<`, `&`, `"`, `</script>`가 들어간 입력 → HTML·SVG·모델 데이터 모두에서 깨지지 않고 그대로 보인다. (Task 5·6 테스트)
- 거의 빈 입력 (`scenarios: []` 등) → HTML은 만들어지고 "착수 불가"와 사유가 보인다. (Task 4·6 테스트)
- 상태 전이·화면 이동에 되돌아가는 고리 → 도출과 배치가 끝나고 노드 좌표가 유한하다. (Task 3·5 테스트)
- 같은 ID가 두 번 나온 입력 → 첫 번째를 쓰고 "ID 중복" 차단 이슈를 낸다. (Task 1 테스트)

---

## 파일 구조

```
package.json                    type=module, test 스크립트, engines
scripts/spec.mjs                CLI: check · build
src/model/load.mjs              parseSpec(text) · loadSpec(path) · 기본값 채우기
src/model/index.mjs             buildIndex(spec): ID 색인, 중복 ID, 이름 조회
src/model/labels.mjs            표기 사전 (3.4절), 조사 josa()
src/derive/permissions.mjs      permissionGrid(): 칸 목록과 빈칸
src/derive/questions.mjs        deriveQuestions(): 자동 정할 것
src/derive/acceptance.mjs       deriveAcceptanceDrafts(): 완료 조건 초안
src/flow/derive.mjs             deriveFlow(): 규칙 F1~F10
src/check/rules.mjs             관계 규칙 (규칙 하나 = 함수 하나)
src/check/run.mjs               runPipeline(spec): 파생 + 검사 + 점수
src/render/escape.mjs           escapeHtml() · jsonForScript()
src/render/flow-svg.mjs         renderFlowSvg(): 결정적 배치
src/render/html.mjs             renderHtml(result): 섹션 11개
examples/assignment/spec.json   범용 예제 (테스트 고정 입력)
test/*.test.mjs
.claude-plugin/plugin.json      플러그인 선언
skills/spec/SKILL.md            사용 흐름 스킬
```

---

### Task 1: 기반 — 원천 읽기, 색인, 표기

**Files:**
- Create: `package.json`, `src/model/load.mjs`, `src/model/index.mjs`, `src/model/labels.mjs`, `examples/assignment/spec.json`
- Test: `test/model.test.mjs`

**Interfaces:**
- Produces:
  - `parseSpec(text: string) → { spec: object|null, error: string|null }` — JSON 파싱 + 누락된 배열·프로필 기본값 채우기
  - `loadSpec(path: string) → { spec, error }`
  - `DEFAULT_PROFILE = { modalMaxInputs: 3, screenStates: [...5개], defaultOwner: '기획' }`
  - `buildIndex(spec) → { get(id) → {kind, item}|undefined, name(id) → string, has(id) → boolean, duplicates: Array<{id, kinds}> }`. kind는 `userType|app|requirement|entity|state|action|scenario|acceptance|metric|event|question|decision`
  - `LABELS` (3.4절 표기), `josa(word, pair) → word+조사` (pair: `'이/가'`, `'을/를'`, `'은/는'`, `'으로/로'`)
  - `quote(word, pair?) → "'word'" + 조사` — 따옴표로 감싼 이름 뒤에 받침에 맞는 조사를 붙인다. pair가 없으면 따옴표만

- [ ] **Step 1: 실패하는 테스트 작성**

```js
// test/model.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSpec, loadSpec } from '../src/model/load.mjs';
import { buildIndex } from '../src/model/index.mjs';
import { josa, quote } from '../src/model/labels.mjs';

test('예제 원천을 읽고 기본 프로필을 채운다', () => {
  const { spec, error } = loadSpec(new URL('../examples/assignment/spec.json', import.meta.url).pathname);
  assert.equal(error, null);
  assert.equal(spec.meta.profile.modalMaxInputs, 3);
  assert.ok(spec.actions.length > 0);
});

test('누락된 배열은 빈 배열로 채운다', () => {
  const { spec } = parseSpec('{"meta":{"title":"빈 기획서"}}');
  for (const key of ['userTypes', 'apps', 'requirements', 'entities', 'actions', 'permissions', 'scenarios', 'acceptance', 'events', 'questions', 'decisions', 'flowOverrides']) {
    assert.deepEqual(spec[key], [], key);
  }
  assert.deepEqual(spec.summary.outOfScope, []);
});

test('JSON 파싱 실패는 한글 오류 문장으로 돌려준다', () => {
  const { spec, error } = parseSpec('{ 깨진');
  assert.equal(spec, null);
  assert.match(error, /JSON/);
});

test('색인은 상태까지 찾고 중복 ID를 모은다', () => {
  const { spec } = parseSpec(JSON.stringify({
    meta: { title: 't' },
    userTypes: [{ id: 'X', name: '가' }],
    apps: [{ id: 'X', name: '나' }],
    entities: [{ id: 'E1', name: '항목', states: [{ id: 'ST1', name: '예정' }] }],
  }));
  const index = buildIndex(spec);
  assert.equal(index.get('ST1').kind, 'state');
  assert.equal(index.name('E1'), '항목');
  assert.equal(index.get('X').kind, 'userType');
  assert.deepEqual(index.duplicates, [{ id: 'X', kinds: ['userType', 'app'] }]);
  assert.equal(index.name('없음'), '(알 수 없음: 없음)');
});

test('조사는 받침에 맞춘다', () => {
  assert.equal(josa('관리자', '이/가'), '관리자가');
  assert.equal(josa('항목', '을/를'), '항목을');
  assert.equal(josa('사용자', '은/는'), '사용자는');
  assert.equal(josa('목록', '으로/로'), '목록으로');
  assert.equal(josa('파일', '으로/로'), '파일로');
  assert.equal(quote('항목 고정하기', '을/를'), "'항목 고정하기'를");
  assert.equal(quote('완료'), "'완료'");
});
```

- [ ] **Step 2: 실패 확인** — Run: `node --test test/model.test.mjs` / Expected: FAIL (모듈 없음)

- [ ] **Step 3: 구현**
  - `package.json`: `{"name":"product-planning","version":"0.1.0","type":"module","private":true,"engines":{"node":">=20"},"scripts":{"test":"node --test test/","spec":"node scripts/spec.mjs"}}`
  - `load.mjs`: `JSON.parse` 실패 시 `{ spec: null, error: 'JSON을 읽을 수 없습니다: ' + message }`. 배열 키 12개는 `Array.isArray`가 아니면 `[]`. `summary`, `summary.outOfScope`, `summary.metrics` 기본값. `meta.profile`은 `{ ...DEFAULT_PROFILE, ...meta.profile }`.
  - `index.mjs`: 배열을 입력 순서로 순회해 `Map`에 넣는다. 이미 있으면 첫 항목을 유지하고 `duplicates`에 kind를 모은다. 개체의 `states`도 kind `state`로 넣는다. `name(id)`은 없으면 `(알 수 없음: {id})`.
  - `labels.mjs`: 받침 판정은 마지막 글자 코드가 `가`~`힣`일 때 `(code - 0xAC00) % 28`. `으로/로`는 받침 없음 또는 받침 ㄹ(8)이면 `로`. 한글이 아니면 앞 형태(`이`, `을`, `은`, `으로`)를 쓴다.
  - `examples/assignment/spec.json`: 사용자 유형 2 (배정 관리자, 담당자), 앱 2 (관리자 웹, 담당자 앱), 요구사항 2, 개체 1 (항목: 예정 → 진행 중 → 완료), 동작 5 (목록 보기 list, 상세 보기 view, 만들기 create 입력 2개 + 담당자 앱으로 crossApp, 마감하기 other irreversible, 수정 update 입력 4개), 시나리오 1 (목록 → 만들기 → 상세 → 마감), 동작 가능표는 일부러 칸 1개를 비운다, 완료 조건 1, 지표 1 + 이벤트 1, 정할 것 1.

- [ ] **Step 4: 통과 확인** — Run: `node --test test/model.test.mjs` / Expected: PASS 5

- [ ] **Step 5: 커밋** — `git add package.json src/model examples test/model.test.mjs && git commit -m "feat: 원천 읽기와 ID 색인, 한글 조사 처리를 추가한다"`

---

### Task 2: 동작 가능표 · 정할 것 · 완료 조건 초안

**Files:**
- Create: `src/derive/permissions.mjs`, `src/derive/questions.mjs`, `src/derive/acceptance.mjs`
- Test: `test/derive.test.mjs`

**Interfaces:**
- Consumes: `buildIndex`, `josa`, `LABELS`
- Produces:
  - `permissionGrid(spec, index) → { cells: Array<{userType, action, state|null, value|null}>, gaps: Array<{userType, action, state|null}> }` — 순서: 사용자 유형 → 동작 → 상태 (입력 순서)
  - `deriveQuestions(spec, index, { gaps, flowQuestions }) → Array<{id, name, owner, blocking: true, auto: true}>` — id는 `auto:perm:{userType}:{action}:{state|-}`
  - `deriveAcceptanceDrafts(spec, index, cells) → Array<{requirement|null, situation, action, result, from}>`

- [ ] **Step 1: 실패하는 테스트 작성**

```js
// test/derive.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSpec } from '../src/model/load.mjs';
import { buildIndex } from '../src/model/index.mjs';
import { permissionGrid } from '../src/derive/permissions.mjs';
import { deriveQuestions } from '../src/derive/questions.mjs';
import { deriveAcceptanceDrafts } from '../src/derive/acceptance.mjs';

const base = {
  meta: { title: 't' },
  userTypes: [{ id: 'U1', name: '관리자' }],
  entities: [{ id: 'E1', name: '항목', states: [{ id: 'ST1', name: '예정', initial: true }, { id: 'ST2', name: '완료', terminal: true }], transitions: [{ from: 'ST1', to: 'ST2', action: 'A2' }] }],
  actions: [{ id: 'A1', name: '항목 수정하기', entity: 'E1', kind: 'update' }, { id: 'A2', name: '항목 마감하기', entity: 'E1', kind: 'other' }],
  permissions: [
    { userType: 'U1', action: 'A1', state: 'ST1', value: 'allow' },
    { userType: 'U1', action: 'A1', state: 'ST2', value: 'hide' },
    { userType: 'U1', action: 'A2', state: 'ST1', value: 'allow' },
  ],
  scenarios: [{ id: 'S1', name: '마감', requirement: 'R1', steps: [{ userType: 'U1', app: 'P1', action: 'A2' }] }],
};

function setup(overrides = {}) {
  const { spec } = parseSpec(JSON.stringify({ ...base, ...overrides }));
  return { spec, index: buildIndex(spec) };
}

test('사용자 유형 × 동작 × 상태 칸을 만들고 빈칸을 찾는다', () => {
  const { spec, index } = setup();
  const { cells, gaps } = permissionGrid(spec, index);
  assert.equal(cells.length, 4);
  assert.deepEqual(gaps, [{ userType: 'U1', action: 'A2', state: 'ST2' }]);
});

test('상태 없는 개체는 상태 없이 칸을 만든다', () => {
  const { spec, index } = setup({
    entities: [{ id: 'E1', name: '설정' }],
    actions: [{ id: 'A1', name: '설정 바꾸기', entity: 'E1', kind: 'update' }],
    permissions: [],
  });
  assert.deepEqual(permissionGrid(spec, index).gaps, [{ userType: 'U1', action: 'A1', state: null }]);
});

test('빈칸은 사람이 읽는 질문이 된다', () => {
  const { spec, index } = setup();
  const { gaps } = permissionGrid(spec, index);
  const [question] = deriveQuestions(spec, index, { gaps, flowQuestions: [] });
  assert.equal(question.name, "'관리자'는 '완료' 상태의 '항목'에 '항목 마감하기'를 할 수 있는가?");
  assert.equal(question.owner, '기획');
  assert.equal(question.blocking, true);
});

test('허용이 아닌 칸과 전이에서 완료 조건 초안을 만든다', () => {
  const { spec, index } = setup();
  const drafts = deriveAcceptanceDrafts(spec, index, permissionGrid(spec, index).cells);
  const hidden = drafts.find((d) => d.from === 'permission');
  assert.equal(hidden.situation, "'관리자'가 '완료' 상태의 '항목'을 볼 때");
  assert.equal(hidden.result, '해당 버튼이 보이지 않는다');
  const transition = drafts.find((d) => d.from === 'transition');
  assert.equal(transition.result, "'완료' 상태가 된다");
  assert.equal(transition.requirement, 'R1');
});
```

- [ ] **Step 2: 실패 확인** — Run: `node --test test/derive.test.mjs` / Expected: FAIL

- [ ] **Step 3: 구현**
  - `permissionGrid`: 동작의 개체가 없거나 색인에 없으면 그 동작은 건너뛴다 (참조 오류는 Task 4 규칙이 보고). 칸 조회 키는 `userType|action|state??'-'`.
  - `deriveQuestions`: 빈칸 문장 = `'{U}'${는} '{상태}' 상태의 '{개체}'에 '{동작}'${를} 할 수 있는가?` (조사는 josa로 따옴표 앞 단어 기준, 상태 없으면 "'{U}'는 '{개체}'에 '{동작}'을 할 수 있는가?"). `flowQuestions`는 그대로 뒤에 붙인다.
  - `deriveAcceptanceDrafts`: 결과 문구 `hide → '해당 버튼이 보이지 않는다'`, `disable → '해당 버튼이 눌리지 않는다'`, `deny → '동작이 거절되고 이유가 안내된다'`. 요구사항은 그 동작을 단계에 쓰는 첫 시나리오의 `requirement` (없으면 null). 전이 초안: 상황 `'{개체}'가 '{from}' 상태일 때`, 행동 `'{동작}'을 하면`, 결과 `'{to}' 상태가 된다`.

- [ ] **Step 4: 통과 확인** — Run: `node --test test/derive.test.mjs` / Expected: PASS 4

- [ ] **Step 5: 커밋** — `git commit -m "feat: 동작 가능표 빈칸과 자동 정할 것, 완료 조건 초안을 파생한다"`

---

### Task 3: 화면 흐름 자동 도출 (F1~F10)

**Files:**
- Create: `src/flow/derive.mjs`
- Test: `test/flow.test.mjs`

**Interfaces:**
- Consumes: `buildIndex`, `spec.meta.profile.modalMaxInputs`, `spec.flowOverrides`
- Produces: `deriveFlow(spec, index) → { screens: Screen[], edges: Edge[], stepScreens: Record<string, string>, questions: Array<{id, name}>, entries: string[] }`
  - `Screen = { id, name, app, entity, type: 'screen'|'modal'|'confirm'|'notification', rule, reason, states }`
  - 화면 ID: `sc:{app}:{entity}:{pattern}` (pattern: `list`, `view`, `create`, `update`, `form:{action}`, `modal:{action}`, `confirm:{action}`), 알림: `sc:{app}:notify:{action}`
  - `Edge = { from, to, label, rule }` — 같은 (from, to, label)은 한 번만

**규칙 적용 (단계마다 `current` 화면을 들고 간다):**

| 동작 종류 | 처리 |
|---|---|
| `list` | F1 `{개체} 목록` 화면. current가 있고 다르면 current → 화면 (F10, 라벨 = 단계 동작 이름) |
| `view` | F2 `{개체} 상세` 화면. 이동은 위와 같음 |
| `create`·`update`·`other` 이고 입력 0개 | F5 current에 머문다. 이동 없음. current가 없으면 정할 것 "'{동작}'을 어느 화면에서 하는가?" |
| `create`·`update`·`other` 이고 1 ≤ 입력 ≤ 기준, current 있음 | F3 모달 `{동작 이름}` (type modal). current → 모달 |
| 입력 > 기준, 또는 current 없음 | F4 화면 `{동작 이름}` (type screen) |
| `delete` | 입력 규칙은 위와 같고 입력 0개면 current에서 바로 동작 |
| `irreversible: true` | F6 확인 창 `{동작 이름} 확인` (type confirm)을 동작 직전에 끼운다 |
| 완료 후 (create) | F7 같은 앱에 그 개체의 `view` 동작이 있으면 상세, 없고 `list`가 있으면 목록, 둘 다 없으면 연 화면. 라벨 "완료" |
| 완료 후 (update·other·delete·확인 창) | F8 연 화면으로 돌아간다. 라벨 "완료". delete는 목록이 있으면 목록 |
| `crossApp` 대상마다 | F9 알림 `sc:{대상 앱}:notify:{동작}` (이름 = effect). 완료 도착 화면 → 알림 (라벨 "{대상 앱 이름}에 알림"), 알림 → 대상 앱의 `{개체} 상세` (라벨 "알림 열기"). 알림은 entries에 넣는다 |
| 알 수 없는 종류 | 정할 것 "'{동작}'의 종류를 정해야 한다" 후 current 유지 |
| `flowOverrides[action].as` | F3/F4 판단을 덮어쓴다. rule은 `결정`, reason은 결정 이름 |

- entries: 각 시나리오 첫 단계가 만든 화면 + 알림
- 화면 `states`는 `profile.screenStates` 복사

- [ ] **Step 1: 실패하는 테스트 작성**

```js
// test/flow.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSpec } from '../src/model/load.mjs';
import { buildIndex } from '../src/model/index.mjs';
import { deriveFlow } from '../src/flow/derive.mjs';

function flowOf(input) {
  const { spec } = parseSpec(JSON.stringify({
    meta: { title: 't' },
    apps: [{ id: 'P1', name: '관리자 웹' }, { id: 'P2', name: '담당자 앱' }],
    userTypes: [{ id: 'U1', name: '관리자' }, { id: 'U2', name: '담당자' }],
    entities: [{ id: 'E1', name: '항목' }],
    ...input,
  }));
  return deriveFlow(spec, buildIndex(spec));
}

const inputs = (n) => Array.from({ length: n }, (_, i) => ({ name: `입력${i}`, rules: ['필수'] }));
const step = (action) => ({ userType: 'U1', app: 'P1', action });

test('목록 → 만들기(입력 2개) → 상세: 모달을 거쳐 상세로 간다', () => {
  const flow = flowOf({
    actions: [
      { id: 'L', name: '항목 목록 보기', entity: 'E1', kind: 'list' },
      { id: 'C', name: '항목 만들기', entity: 'E1', kind: 'create', inputs: inputs(2) },
      { id: 'V', name: '항목 상세 보기', entity: 'E1', kind: 'view' },
    ],
    scenarios: [{ id: 'S1', name: '배정', steps: [step('L'), step('C'), step('V')] }],
  });
  const byId = Object.fromEntries(flow.screens.map((s) => [s.id, s]));
  assert.equal(byId['sc:P1:E1:list'].name, '항목 목록');
  assert.equal(byId['sc:P1:E1:modal:C'].type, 'modal');
  assert.equal(byId['sc:P1:E1:modal:C'].rule, 'F3');
  assert.deepEqual(flow.edges.map((e) => [e.from, e.to, e.rule]), [
    ['sc:P1:E1:list', 'sc:P1:E1:modal:C', 'F10'],
    ['sc:P1:E1:modal:C', 'sc:P1:E1:view', 'F7'],
  ]);
  assert.equal(flow.stepScreens['S1#2'], 'sc:P1:E1:modal:C');
  assert.deepEqual(flow.entries, ['sc:P1:E1:list']);
});

test('입력이 기준보다 많으면 화면(F4), 사람 결정이 있으면 모달로 덮어쓴다', () => {
  const actions = [
    { id: 'L', name: '항목 목록 보기', entity: 'E1', kind: 'list' },
    { id: 'U', name: '항목 수정하기', entity: 'E1', kind: 'update', inputs: inputs(4) },
  ];
  const scenarios = [{ id: 'S1', name: '수정', steps: [step('L'), step('U')] }];
  const auto = flowOf({ actions, scenarios });
  assert.equal(auto.screens.find((s) => s.id === 'sc:P1:E1:form:U').rule, 'F4');
  const decided = flowOf({ actions, scenarios, decisions: [{ id: 'D1', name: '수정은 모달로 한다' }], flowOverrides: [{ action: 'U', as: 'modal', decision: 'D1' }] });
  const modal = decided.screens.find((s) => s.id === 'sc:P1:E1:modal:U');
  assert.equal(modal.rule, '결정');
  assert.equal(modal.reason, '수정은 모달로 한다');
});

test('되돌릴 수 없는 동작은 확인 창을 끼우고 연 화면으로 돌아온다', () => {
  const flow = flowOf({
    actions: [
      { id: 'V', name: '항목 상세 보기', entity: 'E1', kind: 'view' },
      { id: 'X', name: '항목 마감하기', entity: 'E1', kind: 'other', irreversible: true },
    ],
    scenarios: [{ id: 'S1', name: '마감', steps: [step('V'), step('X')] }],
  });
  assert.deepEqual(flow.edges.map((e) => [e.from, e.to, e.rule]), [
    ['sc:P1:E1:view', 'sc:P1:E1:confirm:X', 'F6'],
    ['sc:P1:E1:confirm:X', 'sc:P1:E1:view', 'F8'],
  ]);
});

test('다른 앱에 영향을 주면 알림과 받는 쪽 상세를 잇는다', () => {
  const flow = flowOf({
    actions: [
      { id: 'L', name: '항목 목록 보기', entity: 'E1', kind: 'list' },
      { id: 'C', name: '항목 만들기', entity: 'E1', kind: 'create', inputs: inputs(1), crossApp: [{ app: 'P2', userType: 'U2', effect: '새 항목 알림' }] },
    ],
    scenarios: [{ id: 'S1', name: '배정', steps: [step('L'), step('C')] }],
  });
  const notify = flow.screens.find((s) => s.id === 'sc:P2:notify:C');
  assert.equal(notify.name, '새 항목 알림');
  assert.equal(notify.type, 'notification');
  assert.ok(flow.edges.some((e) => e.from === 'sc:P2:notify:C' && e.to === 'sc:P2:E1:view' && e.rule === 'F9'));
  assert.ok(flow.entries.includes('sc:P2:notify:C'));
});

test('종류를 모르는 동작과 진입 화면이 없는 동작은 정할 것이 된다', () => {
  const flow = flowOf({
    actions: [{ id: 'Q', name: '항목 처리하기', entity: 'E1', kind: '???' }, { id: 'B', name: '항목 고정하기', entity: 'E1', kind: 'other' }],
    scenarios: [{ id: 'S1', name: '처리', steps: [step('Q'), step('B')] }],
  });
  assert.deepEqual(flow.questions.map((q) => q.name), ["'항목 처리하기'의 종류를 정해야 한다", "'항목 고정하기'를 어느 화면에서 하는가?"]);
});

test('같은 화면으로 되돌아가는 고리가 있어도 끝난다', () => {
  const flow = flowOf({
    actions: [
      { id: 'L', name: '항목 목록 보기', entity: 'E1', kind: 'list' },
      { id: 'V', name: '항목 상세 보기', entity: 'E1', kind: 'view' },
    ],
    scenarios: [{ id: 'S1', name: '왕복', steps: [step('L'), step('V'), step('L'), step('V')] }],
  });
  assert.equal(flow.screens.length, 2);
  assert.equal(flow.edges.length, 2);
});
```

- [ ] **Step 2: 실패 확인** — Run: `node --test test/flow.test.mjs` / Expected: FAIL

- [ ] **Step 3: 구현** — 위 표대로 `deriveFlow` 작성. 화면·이동은 `Map`에 입력 순서로 넣고 마지막에 `[...map.values()]`. 질문 문장의 조사는 `josa`로 만든다.

- [ ] **Step 4: 통과 확인** — Run: `node --test test/flow.test.mjs` / Expected: PASS 6

- [ ] **Step 5: 커밋** — `git commit -m "feat: 시나리오와 동작에서 화면 흐름을 규칙으로 자동 도출한다"`

---

### Task 4: 관계 규칙 검사와 품질 점수

**Files:**
- Create: `src/check/rules.mjs`, `src/check/run.mjs`
- Test: `test/check.test.mjs`

**Interfaces:**
- Consumes: Task 1~3 전부
- Produces: `runPipeline(spec) → { spec, index, derived: {screens, edges, stepScreens, entries, permissionGaps, questions, acceptanceDrafts}, report }` (`report`는 산출물 명세 4장 구조)
- 규칙 함수 형태: `(ctx) → { checked: number, issues: Issue[] }`, `Issue = { rule, level: 'block'|'warn', message, targets: [{id, name}] }`

**규칙 목록 (P1):**

| rule | level | 검사 |
|---|---|---|
| `id-duplicate` | block | 중복 ID |
| `name-missing` | block | 이름 없는 요소 |
| `name-duplicate` | block | 같은 kind 안 이름 중복 |
| `ref-unknown` | block | 요구사항.userType, 동작.entity, 칸.userType/action/state, 시나리오.requirement, 단계.userType/app/action, 전이.from/to/action, 완료 조건.requirement, 지표.events, 이벤트.action, crossApp.app/userType, flowOverrides.action/decision |
| `requirement-scenario` | block | 요구사항 → 시나리오 1 이상 |
| `requirement-acceptance` | block | 요구사항 → 확정 완료 조건 1 이상 |
| `permission-gap` | block | 동작 가능표 빈칸 (대상: 사용자 유형, 동작, 상태) |
| `state-reachable` | block | 시작 상태에서 도달할 수 없는 상태 |
| `state-exit` | block | 끝 상태가 아닌데 나가는 전이가 없는 상태 |
| `state-initial` | block | 상태가 있는데 시작 상태가 없음 |
| `flow-step` | block | 화면에 연결되지 않은 시나리오 단계 |
| `flow-orphan` | block | entries에서 도달할 수 없는 화면 |
| `input-rule` | warn | 규칙 없는 입력 (휴리스틱 5) |
| `async-feedback` | warn | `async` 동작에 `success` 또는 `failures` 없음 (휴리스틱 1·9) |
| `metric-event` | block | 지표 → 이벤트 1 이상 |
| `problem-source` | block | 문제에 가정이 아닌 출처 |
| `out-of-scope` | block | 이번에 하지 않는 것 1개 이상 |
| `question-owner` | block | 사람이 적은 정할 것에 담당자 |

- `score.ratio = passed / checked` (소수 셋째 자리 반올림), `passed = checked − 이슈를 낸 대상 수`
- `assumptionRatio`: 문제·사용자 유형·요구사항·확정 완료 조건·지표 중 출처가 없거나 `assumption`인 비율
- `ready = blockIssues === 0 && blockingQuestions === 0` (blockingQuestions = 사람이 적은 `blocking: true` + 자동 정할 것)
- `reasons`: 차단 이슈가 있으면 "차단 이슈 N건", 막는 정할 것이 있으면 "착수를 막는 정할 것 N건"

- [ ] **Step 1: 실패하는 테스트 작성**

```js
// test/check.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSpec, loadSpec } from '../src/model/load.mjs';
import { runPipeline } from '../src/check/run.mjs';

const rulesOf = (report) => report.issues.map((i) => i.rule);

test('예제는 의도한 빈칸 때문에 착수 불가다', () => {
  const { spec } = loadSpec(new URL('../examples/assignment/spec.json', import.meta.url).pathname);
  const { report } = runPipeline(spec);
  assert.equal(report.ready, false);
  assert.ok(rulesOf(report).includes('permission-gap'));
  assert.ok(report.reasons.some((r) => r.startsWith('차단 이슈')));
});

test('없는 ID를 참조해도 멈추지 않고 차단 이슈를 낸다', () => {
  const { spec } = parseSpec(JSON.stringify({
    meta: { title: 't' },
    requirements: [{ id: 'R1', name: '요구', userType: '오타' }],
    scenarios: [{ id: 'S1', name: '시나리오', requirement: 'R1', steps: [{ userType: 'U9', app: 'P9', action: 'A9' }] }],
  }));
  const { report } = runPipeline(spec);
  const unknown = report.issues.filter((i) => i.rule === 'ref-unknown');
  assert.ok(unknown.length >= 4);
  assert.match(unknown[0].message, /알 수 없는/);
});

test('거의 빈 입력은 착수 불가이며 사유가 있다', () => {
  const { spec } = parseSpec('{"meta":{"title":"빈 기획서"}}');
  const { report } = runPipeline(spec);
  assert.equal(report.ready, false);
  assert.ok(rulesOf(report).includes('problem-source'));
  assert.ok(rulesOf(report).includes('out-of-scope'));
  assert.ok(report.reasons.length > 0);
});

test('도달할 수 없는 상태와 빠져나갈 수 없는 상태를 찾는다', () => {
  const { spec } = parseSpec(JSON.stringify({
    meta: { title: 't' },
    entities: [{ id: 'E1', name: '항목', states: [
      { id: 'A', name: '예정', initial: true }, { id: 'B', name: '진행 중' }, { id: 'C', name: '보류' }, { id: 'D', name: '완료', terminal: true },
    ], transitions: [{ from: 'A', to: 'B', action: 'X' }, { from: 'B', to: 'A', action: 'X' }] }],
    actions: [{ id: 'X', name: '바꾸기', entity: 'E1', kind: 'other' }],
  }));
  const { report } = runPipeline(spec);
  const names = (rule) => report.issues.filter((i) => i.rule === rule).flatMap((i) => i.targets.map((t) => t.name));
  assert.deepEqual(names('state-reachable'), ['보류', '완료']);
  assert.deepEqual(names('state-exit'), ['보류']);
});

test('같은 입력이면 보고서가 같다', () => {
  const { spec } = loadSpec(new URL('../examples/assignment/spec.json', import.meta.url).pathname);
  assert.equal(JSON.stringify(runPipeline(spec).report), JSON.stringify(runPipeline(structuredClone(spec)).report));
});
```

- [ ] **Step 2: 실패 확인** — Run: `node --test test/check.test.mjs` / Expected: FAIL
- [ ] **Step 3: 구현** — 규칙 표대로 `rules.mjs`에 함수 하나씩, `run.mjs`에서 파생 → 규칙 실행 → 점수. 메시지 예: `"'${이름}'${이/가} 참조하는 '${id}'는 알 수 없는 ID입니다"` (참조 대상은 ID 그대로 보여 준다. 이름이 없기 때문이다).
- [ ] **Step 4: 통과 확인** — Run: `node --test` / Expected: 전체 PASS
- [ ] **Step 5: 커밋** — `git commit -m "feat: 관계 규칙 검사와 품질 점수, 착수 가능 판정을 추가한다"`

---

### Task 5: 화면 흐름 SVG

**Files:**
- Create: `src/render/escape.mjs`, `src/render/flow-svg.mjs`
- Test: `test/render-svg.test.mjs`

**Interfaces:**
- Produces:
  - `escapeHtml(value) → string` (`& < > " '` 치환)
  - `jsonForScript(value) → string` (`JSON.stringify` 후 `<` → `<`, U+2028/2029 이스케이프)
  - `layoutFlow({ apps, screens, edges, entries }) → { nodes: Array<{id, x, y, w, h, lane}>, width, height }` — 레인 = 앱 (입력 순서, 화면이 없는 앱은 제외), 열 = entries에서 너비 우선 탐색 거리 (도달 못 하면 0), 같은 레인·열은 세로로 쌓는다
  - `renderFlowSvg(input) → string` — `<svg ... role="img" aria-label="화면 흐름도">`, 노드마다 `<g data-spec-id="{id}" data-spec-kind="screen">`, 이름이 12자를 넘으면 11자 + "…"로 줄이고 `<title>`에 전체 이름, 종류별 모양 (screen 실선 / modal 점선 / confirm 주황 테두리 / notification 둥근 알약), 앞으로 가는 이동은 직선, 뒤로 가는 이동은 아래로 휜 곡선, 라벨은 중간

- [ ] **Step 1: 실패하는 테스트 작성**

```js
// test/render-svg.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, jsonForScript } from '../src/render/escape.mjs';
import { layoutFlow, renderFlowSvg } from '../src/render/flow-svg.mjs';

const apps = [{ id: 'P1', name: '관리자 웹' }];
const screens = [
  { id: 'a', name: '목록 <특수> & "따옴표"', app: 'P1', type: 'screen' },
  { id: 'b', name: '상세', app: 'P1', type: 'modal' },
];
const edges = [{ from: 'a', to: 'b', label: '열기' }, { from: 'b', to: 'a', label: '완료' }];

test('HTML과 스크립트용 JSON을 안전하게 만든다', () => {
  assert.equal(escapeHtml('<a href="x">&\''), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  assert.ok(!jsonForScript({ n: '</script>' }).includes('</script>'));
  assert.deepEqual(JSON.parse(jsonForScript({ n: '</script>' })), { n: '</script>' });
});

test('고리가 있어도 배치가 끝나고 좌표가 유한하다', () => {
  const { nodes, width, height } = layoutFlow({ apps, screens, edges, entries: ['a'] });
  assert.equal(nodes.length, 2);
  for (const n of nodes) assert.ok(Number.isFinite(n.x) && Number.isFinite(n.y));
  assert.ok(nodes.find((n) => n.id === 'b').x > nodes.find((n) => n.id === 'a').x);
  assert.ok(width > 0 && height > 0);
});

test('SVG는 이름을 이스케이프하고 ID를 속성에만 둔다', () => {
  const svg = renderFlowSvg({ apps, screens, edges, entries: ['a'] });
  assert.ok(svg.includes('목록 &lt;특수&gt; &amp; &quot;따옴표&quot;'));
  assert.ok(svg.includes('data-spec-id="a"'));
  assert.equal(svg, renderFlowSvg({ apps, screens, edges, entries: ['a'] }));
});
```

- [ ] **Step 2~4**: 실패 확인 → 구현 → `node --test test/render-svg.test.mjs` PASS 3
- [ ] **Step 5: 커밋** — `git commit -m "feat: 화면 흐름도를 결정적 배치의 SVG로 그린다"`

---

### Task 6: HTML 정본

**Files:**
- Create: `src/render/html.mjs`
- Test: `test/render-html.test.mjs`

**Interfaces:**
- Consumes: `runPipeline` 결과, `renderFlowSvg`, `escapeHtml`, `jsonForScript`, `LABELS`, `josa`
- Produces: `renderHtml(result) → string` — 산출물 명세 3장 그대로. 섹션마다 `<section id="s-{n}" data-section="{영문 키}">` (`summary`, `scenarios`, `entities`, `permissions`, `flow`, `screens`, `acceptance`, `metrics`, `review`, `questions`, `trace`)

- [ ] **Step 1: 실패하는 테스트 작성**

```js
// test/render-html.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSpec, parseSpec } from '../src/model/load.mjs';
import { runPipeline } from '../src/check/run.mjs';
import { renderHtml } from '../src/render/html.mjs';

const example = () => loadSpec(new URL('../examples/assignment/spec.json', import.meta.url).pathname).spec;

function bodyText(html) {
  const body = html.split('<body>')[1].split('<script type="application/json"')[0];
  const beforeTrace = body.split('data-section="trace"')[0];
  return beforeTrace.replace(/<[^>]+>/g, ' ');
}

test('11개 섹션이 순서대로 있다', () => {
  const html = renderHtml(runPipeline(example()));
  const order = [...html.matchAll(/data-section="([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(order, ['summary', 'scenarios', 'entities', 'permissions', 'flow', 'screens', 'acceptance', 'metrics', 'review', 'questions', 'trace']);
});

test('본문에는 내부 ID가 보이지 않는다 (부록 제외)', () => {
  const spec = example();
  const html = renderHtml(runPipeline(spec));
  const text = bodyText(html);
  const ids = [...spec.userTypes, ...spec.requirements, ...spec.actions, ...spec.scenarios].map((x) => x.id);
  for (const id of ids) assert.ok(!new RegExp(`\\b${id}\\b`).test(text), `본문에 ID ${id}`);
});

test('모델 데이터를 다시 읽을 수 있고 메타가 있다', () => {
  const html = renderHtml(runPipeline(example()));
  const json = html.split('<script type="application/json" id="spec-model">')[1].split('</script>')[0];
  const model = JSON.parse(json);
  assert.equal(model.format, 'product-planning/spec@1');
  assert.ok(model.derived.screens.length > 0);
  assert.match(html, /<meta name="spec-ready" content="false">/);
});

test('특수문자 이름과 빈 입력도 깨지지 않는다', () => {
  const { spec } = parseSpec(JSON.stringify({ meta: { title: '</script><b>제목</b>' } }));
  const html = renderHtml(runPipeline(spec));
  assert.ok(html.includes('&lt;/script&gt;&lt;b&gt;제목&lt;/b&gt;'));
  assert.ok(html.includes('착수 불가'));
  assert.equal(html.split('<script type="application/json"').length, 2);
});

test('같은 입력이면 HTML이 바이트 단위로 같다', () => {
  assert.equal(renderHtml(runPipeline(example())), renderHtml(runPipeline(example())));
});
```

- [ ] **Step 2~4**: 실패 확인 → 구현 (인라인 `<style>`, 스크립트 없음, 인쇄 가능, 폭 좁아도 표는 가로 스크롤) → `node --test` 전체 PASS
- [ ] **Step 5: 커밋** — `git commit -m "feat: 기획서 정본 HTML을 렌더링한다"`

---

### Task 7: CLI

**Files:**
- Create: `scripts/spec.mjs`
- Test: `test/cli.test.mjs`

**Interfaces:**
- `node scripts/spec.mjs check <spec.json>` → 요약 출력 (착수 가능 여부, 점수, 이슈 수, 이슈 목록). 종료 코드: 착수 가능 0, 착수 불가 1, 읽기 실패 3, 사용법 오류 2
- `node scripts/spec.mjs build <spec.json> [--out <dir>]` → `<dir>/{spec 파일이 있는 폴더 이름}.html`, `<dir>/report.json`. 기본 `<dir>`는 spec 옆 `out/`. 종료 코드: 쓰기 성공 0 (착수 불가여도 0), 읽기 실패 3

- [ ] **Step 1: 실패하는 테스트 작성**

```js
// test/cli.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cli = new URL('../scripts/spec.mjs', import.meta.url).pathname;
const example = new URL('../examples/assignment/spec.json', import.meta.url).pathname;
const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });

test('check는 착수 불가면 1로 끝나고 한글 요약을 낸다', () => {
  const result = run('check', example);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /착수 불가/);
});

test('build는 HTML과 보고서를 쓴다', () => {
  const out = mkdtempSync(join(tmpdir(), 'spec-'));
  const result = run('build', example, '--out', out);
  assert.equal(result.status, 0);
  assert.ok(existsSync(join(out, 'assignment.html')));
  assert.equal(JSON.parse(readFileSync(join(out, 'report.json'), 'utf8')).ready, false);
});

test('깨진 JSON은 3, 사용법 오류는 2로 끝난다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'spec-'));
  const broken = join(dir, 'spec.json');
  writeFileSync(broken, '{ 깨진');
  assert.equal(run('check', broken).status, 3);
  assert.equal(run().status, 2);
});
```

- [ ] **Step 2~4**: 실패 확인 → 구현 → `node --test` 전체 PASS
- [ ] **Step 5: 커밋** — `git commit -m "feat: check·build 명령을 추가한다"`

---

### Task 8: 플러그인 스킬과 사용법

**Files:**
- Create: `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `skills/spec/SKILL.md`
- Modify: `README.md` (사용법 섹션 추가, 로드맵 P1 체크)

- [ ] **Step 1**: Claude Code 플러그인·마켓플레이스 매니페스트 형식을 공식 문서로 확인한다 (필드 이름, skills 위치). 확인하지 않은 필드는 쓰지 않는다.
- [ ] **Step 2**: `skills/spec/SKILL.md` 작성 — 이 스킬이 하는 일: (1) 사용자와 짧게 인터뷰해 산출물 명세 2장 형식으로 `spec.json`을 쓰거나 고친다, (2) `node ${CLAUDE_PLUGIN_ROOT}/scripts/spec.mjs check`로 검사하고 차단 이슈를 사람의 언어로 설명한다, (3) 사실을 지어내지 않는다 — 모르는 것은 `questions`에 넣고 출처가 없으면 `assumption`, (4) `build`로 HTML을 만들고 경로를 알려 준다. 흐름·완료 조건 초안은 쓰지 않는다 (파생되기 때문).
- [ ] **Step 3**: 로컬에서 `claude --plugin-dir .` 또는 문서가 안내하는 방법으로 스킬이 목록에 보이는지 확인한다. 확인하지 못하면 그 사실을 보고에 적는다.
- [ ] **Step 4**: README에 사용법 (`npm test`, `node scripts/spec.mjs build examples/assignment/spec.json`)과 산출물 명세 링크를 추가한다.
- [ ] **Step 5: 커밋** — `git commit -m "feat: 기획서 작성 스킬과 플러그인 매니페스트를 추가한다"`

---

## 이 계획에서 하지 않는 것

- 휴리스틱·워크스루의 모델 판단, 예외 상황 표준 목록 검사, 보완 모드 (원천 수집·분해·대조), 출력 어댑터, 파생 산출물 (티켓 등), 와이어프레임 — 다음 계획에서 다룬다.
