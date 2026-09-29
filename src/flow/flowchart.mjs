import { WORDING, quote } from '../model/labels.mjs';

// 플로우차트 세 종류. 같은 사실을 두 번 그리지 않도록 역할을 나눈다.
//   시나리오: 요구사항을 이루는 기능의 순서와 그때 바뀌는 상태. 판단은 없다.
//   기능:    기능 하나가 어떤 판단을 거쳐 어떻게 끝나나. 판단은 사람이 그리지 않고 모델에서 나온다.
//             FC1 상태 조건(동작 가능표) · FC2 입력 규칙 · FC3 확인 창(되돌릴 수 없음) · FC4 서버 결과(실패 안내)
//   페이지:  화면 하나가 권한·불러오기·빈 화면을 어떻게 다루고, 거기서 무엇을 할 수 있나.
// 안내 문구 원문과 권한 값은 기능명세서에만 둔다. 플로우차트는 흐름과 갈래 조건만 보인다.

function builder(prefix) {
  const nodes = [];
  const edges = [];
  const node = (type, text) => {
    const id = `${prefix}:n${nodes.length + 1}`;
    nodes.push({ id, type, text });
    return id;
  };
  const link = (from, to, kind = 'main', label = '') => edges.push({ from, to, kind, label });
  let current = null;
  let pendingLabel = '';
  const start = (text) => { current = node('start', text); };
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
  const finish = () => advance(node('end', '끝'));
  return { nodes, edges, node, link, start, advance, decide, finish };
}

export function deriveFlowcharts(spec, index, cells, flow) {
  const isAutomatic = (userType) => index.get(userType)?.kind === 'userType' && index.get(userType).item.automatic === true;
  const automaticActions = new Set(spec.scenarios.flatMap((scenario) => scenario.steps).filter((step) => isAutomatic(step.userType)).map((step) => step.action));
  const nameOf = (id) => (index.has(id) ? index.name(id) : String(id));

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
    return [...groups.values()].map((group) => `${quote(nameOf(group.entity))} ${group.froms.map((from) => nameOf(from)).join('·')} → ${nameOf(group.to)}`);
  }

  const scenarioCharts = spec.scenarios.map((scenario) => {
    const b = builder(`scenario:${scenario.id}`);
    const first = scenario.steps[0];
    b.start(first === undefined ? '시작'
      : isAutomatic(first.userType) ? `${nameOf(first.userType)} · 규칙에 따라 자동` : `${nameOf(first.userType)} · ${nameOf(first.app)}`);
    for (const step of scenario.steps) {
      const entry = index.get(step.action);
      if (entry?.kind !== 'action') continue;
      b.advance(b.node('process', typeof step.text === 'string' && step.text !== '' ? step.text : entry.item.name));
      for (const text of stateChanges(entry.item)) b.advance(b.node('state', text));
    }
    b.finish();
    return { kind: 'scenario', of: scenario.id, requirement: scenario.requirement ?? null, name: index.name(scenario.id), nodes: b.nodes, edges: b.edges };
  });

  const functionCharts = spec.actions.filter((action) => !automaticActions.has(action.id)).map((action) => {
    const b = builder(`function:${action.id}`);
    b.start(action.name);

    // FC0: 이 기능을 전혀 할 수 없는 사용자가 있으면 먼저 권한을 판단한다.
    const humans = cells.filter((cell) => cell.action === action.id && !isAutomatic(cell.userType));
    const users = [...new Set(humans.map((cell) => cell.userType))];
    const canUse = (user) => humans.some((cell) => cell.userType === user && cell.value === 'allow');
    if (users.some(canUse) && users.some((user) => !canUse(user))) {
      b.link(b.decide('권한이 있나?'), b.node('end', '권한 없음 안내'), 'no', '아니오');
    }

    // FC1: 상태에 따라 할 수 없는 경우를 판단한다.
    //   할 수 있는 사람 모두가 같은 상태에서만 되면 "'개체'가 X 상태인가?" 하나,
    //   사용자마다 되는 상태가 다르면 "'사용자'이면 '개체'가 X 상태인가?"를 사용자마다 그린다.
    const own = cells.filter((cell) => cell.action === action.id && cell.state !== null && !isAutomatic(cell.userType));
    const states = [...new Set(own.map((cell) => cell.state))];
    const allowedOf = (user) => states.filter((state) => own.some((cell) => cell.userType === user && cell.state === state && cell.value === 'allow'));
    const partial = [...new Set(own.map((cell) => cell.userType))]
      .map((user) => ({ user, allowed: allowedOf(user) }))
      .filter(({ allowed }) => allowed.length > 0 && allowed.length < states.length);
    const stateList = (allowed) => allowed.map((state) => quote(nameOf(state))).join('·');
    const able = [...new Set(own.map((cell) => cell.userType))].filter((user) => allowedOf(user).length > 0);
    const sameForAll = partial.length > 0 && partial.length === able.length && partial.every(({ allowed }) => allowed.join() === partial[0].allowed.join());
    if (sameForAll) {
      b.link(b.decide(`${quote(nameOf(action.entity), '이/가')} ${stateList(partial[0].allowed)} 상태인가?`), b.node('end', '할 수 없음'), 'no', '아니오');
    } else {
      for (const { user, allowed } of partial) {
        b.link(b.decide(`${quote(nameOf(user))}이면 ${quote(nameOf(action.entity), '이/가')} ${stateList(allowed)} 상태인가?`), b.node('end', '할 수 없음'), 'no', '아니오');
      }
    }

    const inputNames = action.inputs.map((input) => input.name).filter((name) => typeof name === 'string' && name !== '');
    const processText = inputNames.length > 0 ? `${inputNames.join('·')} 입력`
      : action.kind === 'list' ? '목록을 보여 준다' : action.kind === 'view' ? '상세를 보여 준다' : `${action.name} 실행`;
    const processId = b.node('process', processText);
    b.advance(processId);

    if (action.inputs.some((input) => input.type !== undefined || (Array.isArray(input.rules) && input.rules.length > 0))) {
      const decision = b.decide('입력 규칙을 지켰나?');
      const warning = b.node('message', '입력 오류 안내');
      b.link(decision, warning, 'no', '아니오');
      b.link(warning, processId, 'loop', '다시 입력');
    }
    if (action.irreversible === true) b.link(b.decide('확인 창에서 확인했나?'), b.node('end', '취소'), 'no', '아니오');
    // FC4: 기능 고유의 실패와, 공통 문구로 정한 불특정 오류(통신 실패·알 수 없는 오류·로그인 만료)를 모두 갈래로 그린다.
    const named = action.failures.map((failure) => (typeof failure.name === 'string' ? failure.name : ''));
    const generic = action.async === true
      ? ['network', 'unknown', 'sessionExpired'].filter((key) => typeof spec.wording[key] === 'string' && spec.wording[key] !== '' && !named.includes(WORDING[key])).map((key) => WORDING[key])
      : [];
    if (action.async === true && named.length + generic.length > 0) {
      const decision = b.decide(`${action.name} 성공?`);
      for (const name of [...named, ...generic]) {
        const message = b.node('message', '오류 안내');
        b.link(decision, message, 'no', name);
        b.link(message, b.node('end', '끝'), 'no');
      }
    }
    if (typeof action.success === 'string' && action.success !== '') b.advance(b.node('message', '성공 안내'));
    for (const text of stateChanges(action)) b.advance(b.node('state', text));
    for (const target of action.crossApp) b.advance(b.node('message', `${quote(nameOf(target.app))}에 알림`));
    b.finish();
    return { kind: 'function', of: action.id, requirement: null, name: action.name, nodes: b.nodes, edges: b.edges };
  });

  const withText = (base, text) => (typeof text === 'string' && text !== '' ? `${base}: ${text}` : base);
  const pageCharts = flow.screens.filter((screen) => screen.type === 'screen').map((screen) => {
    const b = builder(`page:${screen.id}`);
    const appName = nameOf(screen.app);
    const suffix = ` · ${appName}`;
    const name = screen.name.endsWith(suffix) ? screen.name.slice(0, -suffix.length) : screen.name;
    b.start(`${appName} · ${name}`);
    b.link(b.decide('권한이 있나?'), b.node('end', withText('권한 없음 안내', spec.wording.denied)), 'no', '아니오');
    const loading = b.node('process', '불러오는 중');
    b.advance(loading);
    const loaded = b.decide('불러왔나?');
    const failed = b.node('message', typeof spec.wording.loadError === 'string' && spec.wording.loadError !== '' ? spec.wording.loadError : '오류 안내');
    b.link(loaded, failed, 'no', '아니오');
    b.link(failed, loading, 'loop', '다시 시도');
    if (screen.rule === 'F1' || screen.rule === 'F2') {
      const shows = spec.actions.find((action) => action.entity === screen.entity && action.kind === (screen.rule === 'F1' ? 'list' : 'view'));
      b.link(b.decide('데이터가 있나?'), b.node('end', withText('비어 있음 안내', shows?.empty ?? spec.wording.empty)), 'no', '아니오');
    }
    const exits = flow.edges.filter((edge) => edge.from === screen.id && edge.rule === 'F10')
      .map((edge) => `· ${edge.label}`);
    b.advance(b.node('process', ['화면 표시', ...exits].join('\n')));
    b.finish();
    return { kind: 'page', of: screen.id, requirement: null, name, app: screen.app, nodes: b.nodes, edges: b.edges };
  });

  return [...scenarioCharts, ...functionCharts, ...pageCharts];
}
