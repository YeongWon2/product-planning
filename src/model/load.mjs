import { PRODUCT } from './labels.mjs';
import { readFileSync } from 'node:fs';

export const DEFAULT_PROFILE = Object.freeze({
  modalMaxInputs: 3,
  screenStates: Object.freeze(['불러오는 중', '빈 화면', '오류', '권한 없음', '보기 전용']),
  defaultOwner: '기획',
});

const ARRAY_KEYS = [
  'userTypes', 'apps', 'requirements', 'entities', 'actions', 'permissions',
  'scenarios', 'acceptance', 'events', 'questions', 'decisions', 'flowOverrides',
];

const FLOW_OVERRIDE_AS = new Set(['screen', 'modal']);

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// 뒤 단계가 형식 검사 없이 순회할 수 있게 모양을 맞추되, 버린 값은 모두 problems 에 경로와 함께 남긴다.
// 조용히 버리면 사람이 적은 사실이 산출물에서 빠진 채 착수 판정이 나가기 때문이다.
function createNormalizer() {
  const problems = [];
  const report = (path, expected) => problems.push({ path, expected });

  function objects(value, path) {
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
      report(path, '목록이어야 합니다');
      return [];
    }
    return value.filter((item, position) => {
      if (isObject(item)) return true;
      report(`${path}[${position}]`, '객체여야 합니다');
      return false;
    });
  }

  function strings(value, path) {
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
      report(path, '문자열 목록이어야 합니다');
      return [];
    }
    return value.filter((item, position) => {
      if (typeof item === 'string') return true;
      report(`${path}[${position}]`, '문자열이어야 합니다');
      return false;
    });
  }

  function boolean(item, key, path) {
    if (item[key] === undefined || typeof item[key] === 'boolean') return item[key];
    report(`${path}.${key}`, 'true 또는 false여야 합니다');
    return undefined;
  }

  function string(item, key, path) {
    if (item[key] === undefined || typeof item[key] === 'string') return item[key];
    report(`${path}.${key}`, '문자열이어야 합니다');
    return undefined;
  }

  function name(item, path) {
    if (item.name === undefined || typeof item.name === 'string') return item.name;
    report(`${path}.name`, '문자열이어야 합니다');
    return undefined;
  }

  return { problems, report, objects, strings, boolean, string, name };
}

function normalizeProfile(raw, n) {
  const profile = { ...DEFAULT_PROFILE, screenStates: [...DEFAULT_PROFILE.screenStates] };
  if (raw === undefined) return profile;
  if (!isObject(raw)) {
    n.report('meta.profile', '객체여야 합니다');
    return profile;
  }
  const extra = Object.fromEntries(Object.entries(raw).filter(([key]) => !Object.hasOwn(DEFAULT_PROFILE, key)));
  Object.assign(profile, extra);
  if (raw.modalMaxInputs !== undefined) {
    if (Number.isInteger(raw.modalMaxInputs) && raw.modalMaxInputs >= 0) profile.modalMaxInputs = raw.modalMaxInputs;
    else n.report('meta.profile.modalMaxInputs', '0 이상의 정수여야 합니다. 기본값 3을 씁니다');
  }
  if (raw.screenStates !== undefined) {
    const valid = Array.isArray(raw.screenStates) && raw.screenStates.length > 0 && raw.screenStates.every((state) => typeof state === 'string' && state !== '');
    if (valid) profile.screenStates = [...raw.screenStates];
    else n.report('meta.profile.screenStates', '비어 있지 않은 문자열 목록이어야 합니다. 기본 5종을 씁니다');
  }
  if (raw.defaultOwner !== undefined) {
    if (typeof raw.defaultOwner === 'string' && raw.defaultOwner !== '') profile.defaultOwner = raw.defaultOwner;
    else n.report('meta.profile.defaultOwner', '비어 있지 않은 문자열이어야 합니다. 기본값 기획을 씁니다');
  }
  return profile;
}

function normalize(raw) {
  const n = createNormalizer();
  const section = (key) => {
    if (raw[key] === undefined) return {};
    if (isObject(raw[key])) return raw[key];
    n.report(key, '객체여야 합니다');
    return {};
  };
  const meta = section('meta');
  const summary = section('summary');

  const spec = { ...raw };
  // 공통 문구: 값은 모두 문자열이다.
  const wording = raw.wording === undefined || (typeof raw.wording === 'object' && raw.wording !== null && !Array.isArray(raw.wording)) ? { ...(raw.wording ?? {}) } : (n.report('wording', '객체여야 합니다'), {});
  for (const key of Object.keys(wording)) if (typeof wording[key] !== 'string') { n.report(`wording.${key}`, '문자열이어야 합니다'); delete wording[key]; }
  spec.wording = wording;
  spec.product = normalizeProduct(raw.product, n);
  spec.reviews = normalizeReviews(raw.reviews, 'reviews', n);
  if (raw.reviewRounds === undefined) spec.reviewRounds = [];
  else if (!Array.isArray(raw.reviewRounds)) { n.report('reviewRounds', '판단 목록 두 개의 목록이어야 합니다'); spec.reviewRounds = []; }
  else spec.reviewRounds = raw.reviewRounds.map((round, i) => normalizeReviews(round, `reviewRounds[${i}]`, n));
  spec.meta = { ...meta, profile: normalizeProfile(meta.profile, n) };
  spec.summary = {
    ...summary,
    outOfScope: n.strings(summary.outOfScope, 'summary.outOfScope'),
    metrics: n.objects(summary.metrics, 'summary.metrics').map((metric, i) => ({
      ...metric, name: n.name(metric, `summary.metrics[${i}]`), events: n.strings(metric.events, `summary.metrics[${i}].events`),
    })),
  };
  for (const key of ARRAY_KEYS) spec[key] = n.objects(raw[key], key);

  const named = (key) => spec[key].map((item, i) => ({ ...item, name: n.name(item, `${key}[${i}]`) }));
  for (const key of ['userTypes', 'apps', 'requirements', 'events', 'decisions']) spec[key] = named(key);
  // 플랫폼은 하나(문자열)나 여럿(목록). 정규화하면 늘 목록이다.
  spec.apps = spec.apps.map((app, i) => {
    if (app.platform === undefined) return app;
    const list = Array.isArray(app.platform) ? app.platform : [app.platform];
    if (list.length > 0 && list.every((item) => Object.hasOwn(PRODUCT.platform, item))) return { ...app, platform: list };
    n.report(`apps[${i}].platform`, `${Object.keys(PRODUCT.platform).join('·')} 중 하나나 그 목록이어야 합니다`);
    const { platform, ...rest } = app;
    return rest;
  });
  spec.userTypes = spec.userTypes.map((userType, i) => ({ ...userType, automatic: n.boolean(userType, 'automatic', `userTypes[${i}]`) }));

  spec.entities = spec.entities.map((entity, i) => {
    const path = `entities[${i}]`;
    return {
      ...entity,
      name: n.name(entity, path),
      states: n.objects(entity.states, `${path}.states`).map((state, j) => ({
        ...state,
        name: n.name(state, `${path}.states[${j}]`),
        initial: n.boolean(state, 'initial', `${path}.states[${j}]`),
        terminal: n.boolean(state, 'terminal', `${path}.states[${j}]`),
      })),
      transitions: n.objects(entity.transitions, `${path}.transitions`),
    };
  });

  spec.actions = spec.actions.map((action, i) => {
    const path = `actions[${i}]`;
    return {
      ...action,
      name: n.name(action, path),
      inputs: n.objects(action.inputs, `${path}.inputs`).map((input, j) => normalizeInput(input, `${path}.inputs[${j}]`, n)),
      async: n.boolean(action, 'async', path),
      irreversible: n.boolean(action, 'irreversible', path),
      success: n.string(action, 'success', path),
      denied: n.string(action, 'denied', path),
      empty: n.string(action, 'empty', path),
      confirm: normalizeConfirm(action.confirm, `${path}.confirm`, n),
      calls: n.strings(action.calls, `${path}.calls`),
      failures: n.objects(action.failures, `${path}.failures`),
      crossApp: n.objects(action.crossApp, `${path}.crossApp`).map((target, j) => ({ ...target, message: n.string(target, 'message', `${path}.crossApp[${j}]`) })),
    };
  });

  spec.scenarios = spec.scenarios.map((scenario, i) => ({
    ...scenario, name: n.name(scenario, `scenarios[${i}]`), steps: n.objects(scenario.steps, `scenarios[${i}].steps`),
  }));
  spec.questions = spec.questions.map((question, i) => ({
    ...question, name: n.name(question, `questions[${i}]`), blocking: n.boolean(question, 'blocking', `questions[${i}]`),
  }));
  spec.flowOverrides.forEach((override, i) => {
    if (!FLOW_OVERRIDE_AS.has(override.as)) n.report(`flowOverrides[${i}].as`, "'screen' 또는 'modal'이어야 합니다. 적용하지 않습니다");
  });

  return { spec, problems: n.problems };
}

// 입력 검증의 형식. 글로 적은 규칙(rules)은 형식으로 나타낼 수 없는 추가 조건에만 쓴다.
export const INPUT_TYPES = ['text', 'number', 'date', 'period', 'select', 'multiSelect', 'file', 'url', 'boolean'];
// 글자 수·값·개수처럼 숫자로만 뜻이 맞는 범위. 날짜·기간은 '오늘', '1개월'처럼 글로도 적는다.
const NUMERIC_RANGE = new Set(['text', 'number', 'multiSelect']);

// 모델 판단(휴리스틱·워크스루). verdict: pass·issue·na, severity 0~4, evidence: 근거 요소 ID 목록.
function normalizeReviews(list, path, n) {
  if (list === undefined) return [];
  return n.objects(list, path).map((item, i) => {
    const at = `${path}[${i}]`;
    const result = { ...item, key: n.string(item, 'key', at), finding: n.string(item, 'finding', at), fix: n.string(item, 'fix', at), accepted: n.string(item, 'accepted', at), fingerprint: n.string(item, 'fingerprint', at), evidence: n.strings(item.evidence, `${at}.evidence`) };
    if (!['pass', 'issue', 'na'].includes(item.verdict)) { n.report(`${at}.verdict`, 'pass·issue·na 중 하나여야 합니다'); delete result.verdict; }
    if (item.severity !== undefined && !(Number.isInteger(item.severity) && item.severity >= 0 && item.severity <= 4)) { n.report(`${at}.severity`, '0~4의 정수여야 합니다'); delete result.severity; }
    return result;
  });
}

// 서비스 구성: 구분(kind)과 이 기획이 걸치는 시스템(서비스·API 서버·외부 시스템).
function normalizeProduct(product, n) {
  if (product === undefined) return { kind: undefined, systems: [] };
  if (typeof product !== 'object' || product === null || Array.isArray(product)) {
    n.report('product', '객체여야 합니다 ({ kind, systems })');
    return { kind: undefined, systems: [] };
  }
  let kind = product.kind;
  if (kind !== undefined && !Object.hasOwn(PRODUCT.kind, kind)) {
    n.report('product.kind', `${Object.keys(PRODUCT.kind).join('·')} 중 하나여야 합니다`);
    kind = undefined;
  }
  const systems = n.objects(product.systems, 'product.systems').map((system, i) => {
    const path = `product.systems[${i}]`;
    const result = { ...system, name: n.name(system, path), apps: n.strings(system.apps, `${path}.apps`) };
    if (!Object.hasOwn(PRODUCT.system, system.kind)) {
      n.report(`${path}.kind`, `${Object.keys(PRODUCT.system).join('·')} 중 하나여야 합니다`);
      result.kind = 'service';
    }
    return result;
  });
  return { ...product, kind, systems };
}

// 확인 창: message는 필수 문구, ok·cancel은 단추 글(없으면 공통 문구).
function normalizeConfirm(confirm, path, n) {
  if (confirm === undefined) return undefined;
  if (typeof confirm !== 'object' || confirm === null || Array.isArray(confirm)) {
    n.report(path, '객체여야 합니다 ({ message, ok, cancel })');
    return undefined;
  }
  return { message: n.string(confirm, 'message', path), ok: n.string(confirm, 'ok', path), cancel: n.string(confirm, 'cancel', path) };
}

function normalizeInput(input, path, n) {
  const result = { ...input, rules: n.strings(input.rules, `${path}.rules`) };
  if (input.type !== undefined && !INPUT_TYPES.includes(input.type)) {
    n.report(`${path}.type`, `${INPUT_TYPES.join('·')} 중 하나여야 합니다`);
    delete result.type;
  }
  result.required = n.boolean(input, 'required', path);
  result.error = n.string(input, 'error', path);
  for (const key of ['min', 'max']) {
    if (input[key] === undefined) continue;
    const numeric = NUMERIC_RANGE.has(result.type);
    const valid = numeric ? Number.isFinite(input[key]) : Number.isFinite(input[key]) || typeof input[key] === 'string';
    if (!valid) {
      n.report(`${path}.${key}`, numeric ? '숫자여야 합니다' : '숫자나 문자열이어야 합니다');
      delete result[key];
    }
  }
  for (const key of ['maxCount', 'maxSizeMB', 'totalSizeMB']) {
    if (input[key] !== undefined && !(Number.isFinite(input[key]) && input[key] > 0)) {
      n.report(`${path}.${key}`, '0보다 큰 숫자여야 합니다');
      delete result[key];
    }
  }
  if (input.note !== undefined && typeof input.note !== 'string') {
    n.report(`${path}.note`, '문자열이어야 합니다');
    delete result.note;
  }
  if (input.optionsFrom !== undefined && typeof input.optionsFrom !== 'string') {
    n.report(`${path}.optionsFrom`, '문자열이어야 합니다');
    delete result.optionsFrom;
  }
  for (const key of ['options', 'formats']) {
    if (input[key] !== undefined) result[key] = n.strings(input[key], `${path}.${key}`);
  }
  return result;
}

export function parseSpec(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { spec: null, error: `JSON을 읽을 수 없습니다: ${error.message}`, problems: [] };
  }
  if (!isObject(raw)) return { spec: null, error: '기획서의 최상위 값은 객체여야 합니다', problems: [] };
  const { spec, problems } = normalize(raw);
  return { spec, error: null, problems };
}

export function loadSpec(path) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    return { spec: null, error: `파일을 읽을 수 없습니다: ${path} (${error.code ?? error.message})`, problems: [] };
  }
  return parseSpec(text);
}
