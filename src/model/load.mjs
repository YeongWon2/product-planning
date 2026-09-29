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

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// 뒤 단계가 형식 검사 없이 순회할 수 있도록 배열이 아니거나 객체가 아닌 항목은 걸러 낸다.
// 내용이 틀린 것은 검사 단계가 이슈로 보고하므로 여기서는 모양만 맞춘다.
const objects = (value) => (Array.isArray(value) ? value.filter(isObject) : []);
const strings = (value) => (Array.isArray(value) ? value.filter((item) => typeof item === 'string') : []);

function normalizeEntity(entity) {
  return { ...entity, states: objects(entity.states), transitions: objects(entity.transitions) };
}

function normalizeAction(action) {
  return {
    ...action,
    inputs: objects(action.inputs).map((input) => ({ ...input, rules: strings(input.rules) })),
    failures: objects(action.failures),
    crossApp: objects(action.crossApp),
  };
}

function normalize(raw) {
  const meta = isObject(raw.meta) ? raw.meta : {};
  const profile = isObject(meta.profile) ? meta.profile : {};
  const summary = isObject(raw.summary) ? raw.summary : {};

  const spec = { ...raw };
  spec.meta = {
    ...meta,
    profile: {
      ...DEFAULT_PROFILE,
      screenStates: [...DEFAULT_PROFILE.screenStates],
      ...profile,
    },
  };
  spec.summary = {
    ...summary,
    outOfScope: strings(summary.outOfScope),
    metrics: objects(summary.metrics).map((metric) => ({ ...metric, events: strings(metric.events) })),
  };
  for (const key of ARRAY_KEYS) spec[key] = objects(raw[key]);
  spec.entities = spec.entities.map(normalizeEntity);
  spec.actions = spec.actions.map(normalizeAction);
  spec.scenarios = spec.scenarios.map((scenario) => ({ ...scenario, steps: objects(scenario.steps) }));
  return spec;
}

export function parseSpec(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { spec: null, error: `JSON을 읽을 수 없습니다: ${error.message}` };
  }
  if (!isObject(raw)) return { spec: null, error: '기획서의 최상위 값은 객체여야 합니다' };
  return { spec: normalize(raw), error: null };
}

export function loadSpec(path) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    return { spec: null, error: `파일을 읽을 수 없습니다: ${path} (${error.code ?? error.message})` };
  }
  return parseSpec(text);
}
