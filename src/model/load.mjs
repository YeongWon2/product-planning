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

  function name(item, path) {
    if (item.name === undefined || typeof item.name === 'string') return item.name;
    report(`${path}.name`, '문자열이어야 합니다');
    return undefined;
  }

  return { problems, report, objects, strings, boolean, name };
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
      failures: n.objects(action.failures, `${path}.failures`),
      crossApp: n.objects(action.crossApp, `${path}.crossApp`),
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

function normalizeInput(input, path, n) {
  const result = { ...input, rules: n.strings(input.rules, `${path}.rules`) };
  if (input.type !== undefined && !INPUT_TYPES.includes(input.type)) {
    n.report(`${path}.type`, `${INPUT_TYPES.join('·')} 중 하나여야 합니다`);
    delete result.type;
  }
  result.required = n.boolean(input, 'required', path);
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
