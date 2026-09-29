import { quote } from '../model/labels.mjs';

// 입력을 받아 개체를 바꾸는 동작. 입력 수에 따라 모달·화면·버튼으로 나뉜다 (F3·F4·F5).
const FORM_KINDS = new Set(['create', 'update', 'delete', 'other']);

// 사람은 화면을 이름으로 부르므로 이름이 겹치면 안 된다. 겹칠 때만 앱 이름을 붙여 짧은 이름을 유지한다.
function withDistinctNames(screens, index) {
  const count = new Map();
  for (const screen of screens) count.set(screen.name, (count.get(screen.name) ?? 0) + 1);
  return screens.map((screen) => (count.get(screen.name) > 1
    ? { ...screen, name: `${screen.name} · ${index.name(screen.app)}` }
    : screen));
}

export function deriveFlow(spec, index) {
  const { modalMaxInputs, screenStates } = spec.meta.profile;
  const screens = new Map();
  const edges = new Map();
  const questions = new Map();
  const stepScreens = {};
  const entries = [];

  const overrides = new Map();
  for (const override of spec.flowOverrides) {
    if (!overrides.has(override.action)) overrides.set(override.action, override);
  }
  const hasKind = (entity, kind) => spec.actions.some((action) => action.entity === entity && action.kind === kind);

  function addScreen(screen) {
    if (!screens.has(screen.id)) screens.set(screen.id, { ...screen, states: [...screenStates] });
    return screen.id;
  }
  function addEdge(from, to, label, rule) {
    if (!from || !to || from === to) return;
    const key = `${from}\u0000${to}\u0000${label}`;
    if (!edges.has(key)) edges.set(key, { from, to, label, rule });
  }
  function addEntry(id) {
    if (!entries.includes(id)) entries.push(id);
  }
  function ask(id, name) {
    if (!questions.has(id)) questions.set(id, { id, name });
  }

  const entityName = (action) => index.name(action.entity);
  const listScreen = (app, action) => addScreen({
    id: `sc:${app}:${action.entity}:list`, name: `${entityName(action)} 목록`, app, entity: action.entity,
    type: 'screen', rule: 'F1', reason: '여러 개를 보는 동작',
  });
  const viewScreen = (app, action) => addScreen({
    id: `sc:${app}:${action.entity}:view`, name: `${entityName(action)} 상세`, app, entity: action.entity,
    type: 'screen', rule: 'F2', reason: '하나를 보는 동작',
  });

  function openForm(action, app, current) {
    const count = action.inputs.length;
    const override = overrides.get(action.id);
    // 모달은 뜰 바탕 화면이 있어야 하므로, 연 화면이 없으면 결정이 있어도 화면으로 연다.
    const asModal = current !== null && (override ? override.as === 'modal' : count <= modalMaxInputs);
    let rule = asModal ? 'F3' : 'F4';
    let reason = asModal
      ? `입력 ${count}개가 모달 기준 ${modalMaxInputs}개 이하`
      : current === null ? '연 화면이 없어 화면으로 연다' : `입력 ${count}개가 모달 기준 ${modalMaxInputs}개 초과`;
    if (override && current !== null) {
      rule = '결정';
      reason = index.has(override.decision) ? index.name(override.decision) : '사람의 결정';
    }
    const pattern = asModal ? 'modal' : 'form';
    return addScreen({
      id: `sc:${app}:${action.entity}:${pattern}:${action.id}`, name: action.name, app, entity: action.entity,
      type: asModal ? 'modal' : 'screen', rule, reason,
    });
  }

  function arrivalAfter(action, app, opener, completedAt) {
    if (action.kind === 'create') {
      if (hasKind(action.entity, 'view')) return { to: viewScreen(app, action), rule: 'F7' };
      if (hasKind(action.entity, 'list')) return { to: listScreen(app, action), rule: 'F7' };
      return { to: opener ?? completedAt, rule: 'F7' };
    }
    if (action.kind === 'delete' && hasKind(action.entity, 'list')) return { to: listScreen(app, action), rule: 'F8' };
    return { to: opener ?? completedAt, rule: 'F8' };
  }

  function notifyOtherApps(action, from) {
    for (const target of action.crossApp) {
      const notification = addScreen({
        id: `sc:${target.app}:notify:${action.id}`,
        name: typeof target.effect === 'string' && target.effect !== '' ? target.effect : `${action.name} 알림`,
        app: target.app, entity: action.entity, type: 'notification', rule: 'F9',
        reason: `${quote(action.name, '이/가')} 다른 앱에 영향을 준다`,
      });
      addEdge(from, notification, `${index.name(target.app)}에 알림`, 'F9');
      addEdge(notification, viewScreen(target.app, action), '알림 열기', 'F9');
      addEntry(notification);
    }
  }

  // 단계 하나를 적용하고 { stepScreen, current } 를 돌려준다. current 는 다음 단계가 시작할 화면이다.
  function applyStep(action, app, current) {
    if (action.kind === 'list' || action.kind === 'view') {
      const target = action.kind === 'list' ? listScreen(app, action) : viewScreen(app, action);
      addEdge(current, target, action.name, 'F10');
      return { stepScreen: target, current: target };
    }
    if (!FORM_KINDS.has(action.kind)) {
      ask(`auto:flow:kind:${action.id}`, `${quote(action.name)}의 종류를 정해야 한다`);
      return { stepScreen: null, current };
    }

    let working = current;
    if (action.inputs.length === 0) {
      if (current === null) {
        ask(`auto:flow:where:${action.id}`, `${quote(action.name, '을/를')} 어느 화면에서 하는가?`);
        return { stepScreen: null, current };
      }
    } else {
      working = openForm(action, app, current);
      addEdge(current, working, action.name, 'F10');
    }

    let completedAt = working;
    if (action.irreversible === true) {
      completedAt = addScreen({
        id: `sc:${app}:${action.entity}:confirm:${action.id}`, name: `${action.name} 확인`, app, entity: action.entity,
        type: 'confirm', rule: 'F6', reason: '되돌릴 수 없는 동작',
      });
      addEdge(working, completedAt, action.name, 'F6');
    }

    const arrival = arrivalAfter(action, app, current, completedAt);
    addEdge(completedAt, arrival.to, '완료', arrival.rule);
    notifyOtherApps(action, arrival.to);
    return { stepScreen: working, current: arrival.to };
  }

  for (const scenario of spec.scenarios) {
    let current = null;
    scenario.steps.forEach((step, position) => {
      const entry = index.get(step.action);
      // 알 수 없는 동작·개체는 검사 단계가 참조 오류로 보고한다. 흐름은 그 단계를 건너뛴다.
      if (entry?.kind !== 'action' || !index.is(entry.item.entity, 'entity')) return;
      const before = current;
      const result = applyStep(entry.item, step.app, current);
      if (result.stepScreen !== null) {
        stepScreens[`${scenario.id}#${position + 1}`] = result.stepScreen;
        if (before === null) addEntry(result.stepScreen);
      }
      current = result.current;
    });
  }

  return {
    screens: withDistinctNames([...screens.values()], index),
    edges: [...edges.values()],
    stepScreens,
    questions: [...questions.values()],
    entries,
  };
}
