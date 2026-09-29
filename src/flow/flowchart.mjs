import { LABELS, quote } from '../model/labels.mjs';

// 시나리오 하나를 시작 → 처리 → 판단 → 끝으로 잇는 플로우차트로 만든다.
// 판단은 사람이 그리지 않는다. 모델에 이미 있는 사실에서 나온다.
//   FC1 상태 조건: 동작 가능표에서 그 사용자 유형이 일부 상태에서만 할 수 있는 동작
//   FC2 입력 규칙: 검증 규칙이 있는 입력 → 어기면 오류 안내 후 다시 입력
//   FC3 확인 창: 되돌릴 수 없는 동작 → 취소하면 끝
//   FC4 서버 결과: 실패 안내가 있는 서버 동작 → 실패마다 안내 후 끝
// 성공 안내, 상태 변화, 다른 앱 알림은 본 줄기에 이어 붙인다. 자동 처리 단계는 판단 없이 그린다.

export function deriveFlowcharts(spec, index, cells) {
  return spec.scenarios.map((scenario) => chartFor(scenario, spec, index, cells));
}

function chartFor(scenario, spec, index, cells) {
  const nodes = [];
  const edges = [];
  const node = (type, text) => {
    const id = `${scenario.id}:n${nodes.length + 1}`;
    nodes.push({ id, type, text });
    return id;
  };
  const link = (from, to, kind = 'main', label = '') => edges.push({ from, to, kind, label });
  const isAutomatic = (userType) => index.get(userType)?.kind === 'userType' && index.get(userType).item.automatic === true;

  const first = scenario.steps[0];
  const startText = first === undefined
    ? '시작'
    : isAutomatic(first.userType) ? `${index.name(first.userType)} · 규칙에 따라 자동` : `${index.name(first.userType)} · ${index.name(first.app)}`;
  let current = node('start', startText);
  // 판단 다음 본 줄기는 '예'로 잇는다.
  let pendingLabel = '';
  const advance = (to) => {
    link(current, to, 'main', pendingLabel);
    pendingLabel = '';
    current = to;
  };
  const decide = (text) => {
    advance(node('decision', text));
    pendingLabel = '예';
    return current;
  };

  for (const step of scenario.steps) {
    const entry = index.get(step.action);
    if (entry?.kind !== 'action') continue;
    const action = entry.item;
    const automatic = isAutomatic(step.userType);

    if (!automatic) stateCondition(action, step.userType);
    const processId = node('process', step.text || action.name);
    advance(processId);

    if (!automatic) {
      if (action.inputs.some((input) => Array.isArray(input.rules) && input.rules.length > 0)) {
        const decision = decide('입력 규칙을 지켰나?');
        const warning = node('message', '칸 아래에 오류를 안내한다');
        link(decision, warning, 'no', '아니오');
        link(warning, processId, 'loop', '다시 입력');
      }
      if (action.irreversible === true) link(decide('확인 창에서 확인했나?'), node('end', '취소'), 'no', '아니오');
      if (action.async === true && action.failures.length > 0) {
        const decision = decide(`${action.name} 성공?`);
        for (const failure of action.failures) {
          const message = node('message', failure.message || failure.name);
          link(decision, message, 'no', failure.name ?? '');
          link(message, node('end', '끝'), 'no');
        }
      }
      if (typeof action.success === 'string' && action.success !== '') advance(node('message', action.success));
    }

    for (const text of stateChanges(action)) advance(node('state', text));
    if (!automatic) {
      for (const target of action.crossApp) advance(node('message', `${quote(index.name(target.app))}에 알림: ${target.effect ?? ''}`.trim()));
    }
  }
  advance(node('end', '끝'));
  return { scenario: scenario.id, requirement: scenario.requirement ?? null, name: index.name(scenario.id), nodes, edges };

  // FC1: 모든 상태에서 되는 동작이면 물을 것이 없다. 일부 상태에서만 되면 그 상태인지 먼저 판단한다.
  function stateCondition(action, userType) {
    const own = cells.filter((cell) => cell.userType === userType && cell.action === action.id && cell.state !== null);
    const allowed = own.filter((cell) => cell.value === 'allow');
    if (allowed.length === 0 || allowed.length === own.length) return;
    const decision = decide(`${quote(index.name(action.entity), '이/가')} ${allowed.map((cell) => quote(index.name(cell.state))).join('·')} 상태인가?`);
    const others = own.filter((cell) => cell.value !== 'allow')
      .map((cell) => `${quote(index.name(cell.state))}에서 ${cell.value === null ? '정할 것' : LABELS.permission[cell.value]}`);
    link(decision, node('end', `할 수 없음 (${others.join(', ')})`), 'no', '아니오');
  }

  // 이 동작이 일으키는 상태 전이. 같은 개체·같은 도착 상태는 한 줄로 묶는다.
  function stateChanges(action) {
    const groups = new Map();
    for (const entity of spec.entities) {
      for (const transition of entity.transitions.filter((item) => item.action === action.id)) {
        const key = `${entity.id}\u0000${transition.to}`;
        const group = groups.get(key) ?? { entity: entity.id, to: transition.to, froms: [] };
        group.froms.push(transition.from);
        groups.set(key, group);
      }
    }
    return [...groups.values()].map((group) => `${quote(index.name(group.entity))} ${group.froms.map((from) => index.name(from)).join('·')} → ${index.name(group.to)}`);
  }
}
