// 전체 흐름도의 데이터. 서비스(틀) 안에 앱(틀), 그 안에 화면. API 서버·외부 시스템은 서비스 바깥 상자.
//   flow  같은 서비스 안의 화면 이동 (흐름 규칙 F1~F12)
//   cross 다른 서비스로 주는 영향 (F9 알림 등)
//   call  동작이 부르는 API 서버·외부 시스템 (actions[].calls)
const UNASSIGNED = '__unassigned';

export function deriveOverview(spec, index, flow) {
  const services = spec.product.systems.filter((system) => system.kind === 'service');
  const serviceOfApp = new Map();
  for (const service of services) for (const app of service.apps) if (!serviceOfApp.has(app)) serviceOfApp.set(app, service.id);
  const screensOf = (app) => flow.screens.filter((screen) => screen.app === app).map((screen) => screen.id);

  const out = services.map((service) => ({
    id: service.id, name: index.name(service.id),
    apps: service.apps.filter((app) => index.is(app, 'app')).map((app) => ({ id: app, name: index.name(app), screens: screensOf(app) })),
  }));
  const loose = [...new Set(flow.screens.map((screen) => screen.app))].filter((app) => !serviceOfApp.has(app));
  if (loose.length > 0) {
    out.push({ id: UNASSIGNED, name: '서비스 정해지지 않음', apps: loose.map((app) => ({ id: app, name: index.has(app) ? index.name(app) : String(app), screens: screensOf(app) })) });
    for (const app of loose) serviceOfApp.set(app, UNASSIGNED);
  }

  const screenApp = new Map(flow.screens.map((screen) => [screen.id, screen.app]));
  const edges = [];
  const seen = new Set();
  const add = (edge) => {
    const key = `${edge.from}\u0000${edge.to}\u0000${edge.kind}\u0000${edge.label}`;
    if (!seen.has(key)) { seen.add(key); edges.push(edge); }
  };
  for (const edge of flow.edges) {
    const same = serviceOfApp.get(screenApp.get(edge.from)) === serviceOfApp.get(screenApp.get(edge.to));
    add({ from: edge.from, to: edge.to, kind: same ? 'flow' : 'cross', label: edge.label });
  }

  const systems = spec.product.systems.filter((system) => system.kind !== 'service');
  const known = new Set(systems.map((system) => system.id));
  for (const action of spec.actions) {
    // 동작이 일어나는 화면: 그 동작의 폼·모달, 없으면 확인 창, 없으면 시나리오 단계의 화면
    const own = flow.screens.filter((screen) => screen.id.endsWith(`:${action.id}`));
    const source = own.find((screen) => screen.type !== 'confirm') ?? own[0]
      ?? flow.screens.find((screen) => spec.scenarios.some((scenario) => scenario.steps.some((step, i) => step.action === action.id && flow.stepScreens[`${scenario.id}#${i + 1}`] === screen.id)));
    if (!source) continue;
    for (const call of action.calls.filter((id) => known.has(id))) add({ from: source.id, to: call, kind: 'call', label: action.name });
  }
  // 틀 안에서는 앱 이름이 이미 보이므로 화면 이름 끝의 ' · 앱'은 뗀다.
  const names = Object.fromEntries(flow.screens.map((screen) => {
    const suffix = ` · ${index.has(screen.app) ? index.name(screen.app) : ''}`;
    return [screen.id, screen.name.endsWith(suffix) ? screen.name.slice(0, -suffix.length) : screen.name];
  }));
  const types = Object.fromEntries(flow.screens.map((screen) => [screen.id, screen.type]));
  return { services: out, systems: systems.map((system) => ({ id: system.id, name: index.name(system.id), kind: system.kind })), edges, names, types };
}
