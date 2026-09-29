import { quote } from '../model/labels.mjs';

// 모델이 판단하는 검토 항목 (설계서 5.3·5.4절). 기계로 판정하는 휴리스틱 1·3·4·7·9는 관계 규칙이 이미 잡는다.
// 항목 하나 = 기준 × 대상. 판단은 spec.reviews에 key로 적는다.
export const CRITERIA = Object.freeze({
  H2: { name: '사용자의 말을 쓴다', question: '앱마다 같은 개념을 같은 말로 부르는가, 사용자에게 낯선 내부 용어가 문구에 없는가' },
  H5: { name: '오류를 예방한다', question: '제약을 입력 단계에서 막는가(선택지 제한·비활성), 아니면 제출한 뒤에야 거절하는가' },
  H6: { name: '기억하지 않게 한다', question: '앞 단계에서 고른 값을 다시 입력하게 하지 않는가, 선택지를 목록으로 보여 주는가' },
  H8: { name: '필요한 것만 보여 준다', question: '이 화면의 주요 동작이 하나로 분명한가, 시나리오와 무관한 동작이 섞여 있지 않은가' },
  H10: { name: '도움을 준다', question: '처음 사용해 비어 있을 때 무엇을 하면 되는지 알려 주는가' },
  W: { name: '인지적 워크스루', question: 'W1 이 단계에서 무엇을 하려 할지 아는가 · W2 필요한 요소가 이 상태에서 보이는가 · W3 그 요소가 원하는 결과를 낼 거라고 연결 짓는가 · W4 누른 뒤 제대로 됐다고 아는가' },
});

export const SEVERITY = Object.freeze({ 0: '문제 아님', 1: '표현만의 문제', 2: '지연·혼란, 추가 단계', 3: '잘못된 결과·오류, 우회 필요', 4: '과업을 끝낼 수 없음·데이터 손실' });

// 판단의 근거가 된 사실의 지문. 사실이 바뀌면 지문이 바뀌어 예전 판단이 낡았음을 안다 (FNV-1a 32비트).
export function fingerprintOf(value) {
  let hash = 0x811c9dc5;
  for (const char of JSON.stringify(value)) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function buildWorksheet(spec, index, flow, cells) {
  const items = [];
  const nameOf = (id) => (index.has(id) ? index.name(id) : String(id));
  const push = (criterion, target, targetName, context, extra = {}) => items.push({
    key: `${criterion}:${target}`, criterion, criterionName: CRITERIA[criterion].name, question: CRITERIA[criterion].question, target, targetName, context, fingerprint: fingerprintOf(context), ...extra,
  });
  const actionFacts = (action) => ({
    inputs: action.inputs.map((input) => ({ name: input.name, type: input.type, required: input.required === true, min: input.min, max: input.max, options: input.options, optionsFrom: input.optionsFrom, rules: input.rules, note: input.note })),
    success: action.success, failures: action.failures.map((failure) => ({ name: failure.name, message: failure.message })), confirm: action.confirm,
    permissions: cells.filter((cell) => cell.action === action.id).map((cell) => ({ userType: nameOf(cell.userType), state: cell.state === null ? null : nameOf(cell.state), value: cell.value })),
  });

  for (const entity of spec.entities) {
    const actions = spec.actions.filter((action) => action.entity === entity.id);
    if (actions.length === 0) continue;
    push('H2', entity.id, entity.name, {
      states: entity.states.map((state) => state.name),
      actions: actions.map((action) => action.name),
      wording: Object.values(spec.wording),
      apps: [...new Set(spec.scenarios.flatMap((scenario) => scenario.steps).filter((step) => actions.some((action) => action.id === step.action)).map((step) => nameOf(step.app)))],
    });
  }
  for (const action of spec.actions.filter((item) => item.inputs.length > 0)) push('H5', action.id, action.name, actionFacts(action));
  for (const scenario of spec.scenarios) {
    push('H6', scenario.id, scenario.name, {
      steps: scenario.steps.map((step) => ({ who: nameOf(step.userType), app: nameOf(step.app), action: nameOf(step.action), text: step.text, inputs: index.get(step.action)?.item.inputs?.map((input) => input.name) ?? [] })),
    });
  }
  for (const screen of flow.screens.filter((item) => item.type === 'screen')) {
    const exits = flow.edges.filter((edge) => edge.from === screen.id).map((edge) => edge.label);
    push('H8', screen.id, screen.name, { app: nameOf(screen.app), actions: [...new Set(exits)], states: screen.states });
    if (screen.rule === 'F1') {
      const list = spec.actions.find((action) => action.entity === screen.entity && action.kind === 'list');
      push('H10', screen.id, screen.name, { empty: list?.empty ?? spec.wording.empty ?? null, actions: [...new Set(exits)] });
    }
  }
  for (const scenario of spec.scenarios.filter((item) => item.kind === 'main' || item.kind === undefined)) {
    scenario.steps.forEach((step, i) => {
      const action = index.get(step.action)?.item;
      const screen = flow.stepScreens[`${scenario.id}#${i + 1}`];
      push('W', `${scenario.id}#${i + 1}`, `${scenario.name} ${i + 1}단계: ${step.text ?? nameOf(step.action)}`, {
        userType: nameOf(step.userType), app: nameOf(step.app), screen: screen ? flow.screens.find((item) => item.id === screen)?.name : null,
        action: action ? { name: action.name, ...actionFacts(action) } : null,
      }, { userType: step.userType });
    });
  }
  return items;
}

export const REVIEW_INSTRUCTIONS = [
  '검토지의 항목마다 판단해 spec.json의 reviews에 { key, verdict, severity, evidence, finding, fix?, fingerprint } 로 적는다. fingerprint는 검토지 항목의 값을 그대로 옮긴다.',
  'verdict: pass(문제 없음) · issue(문제 있음) · na(해당 없음, finding에 사유). issue면 severity 1~4 (설계서 5.6절).',
  '모든 판단에는 근거 요소 ID(evidence)가 1개 이상 있어야 한다. 근거는 context에 나온 사실과 spec의 요소 ID·화면 ID만 쓴다. 추측으로 문제를 만들지 않는다.',
  '같은 검토지로 두 번 독립적으로 판단해 reviewRounds: [첫째, 둘째]에 넣고, 어긋난 항목만 다시 따져 reviews에 최종 판단을 적는다. 둘째 판단은 첫째를 보지 않은 별도 에이전트가 한다.',
  '심각도 3~4는 spec을 고쳐 없애거나, 받아들이면 decisions에 사유를 남기고 accepted에 그 결정 ID를 적는다.',
].join('\n');

// 두 번의 판단이 얼마나 일치하나: 같은 key의 verdict(와 issue면 심각도 2 이상 여부)가 같으면 일치.
export function agreementOf(rounds) {
  if (!Array.isArray(rounds) || rounds.length < 2) return null;
  const [first, second] = rounds;
  const byKey = (list) => new Map(list.map((item) => [item.key, item]));
  const a = byKey(first);
  const b = byKey(second);
  const keys = [...new Set([...a.keys(), ...b.keys()])];
  const same = (x, y) => x && y && x.verdict === y.verdict && (x.verdict !== 'issue' || (x.severity >= 2) === (y.severity >= 2));
  const disagreements = keys.filter((key) => !same(a.get(key), b.get(key)));
  return { total: keys.length, agreed: keys.length - disagreements.length, ratio: keys.length === 0 ? 1 : (keys.length - disagreements.length) / keys.length, disagreements };
}

export const describeKey = (item, index) => `${CRITERIA[item.criterion]?.name ?? item.criterion} — ${quote(item.targetName ?? (index.has(item.target) ? index.name(item.target) : item.target))}`;
