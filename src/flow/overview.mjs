// 전체 흐름의 데이터. 화면 단위가 아니라 요구사항 단위로 크게 본다.
//   서비스(틀) 안에 앱(틀), 그 안에 요구사항. API 서버·외부 시스템은 서비스 바깥 상자.
//   order 먼저 만들어야 쓸 수 있는 순서: 한 요구사항이 만든 개체를 다른 요구사항이 쓴다 (라벨: 개체 이름)
//   cross 다른 서비스·앱에 주는 영향 (actions[].crossApp). 받는 쪽에 그 개체를 쓰는 요구사항이 없으면 앱 자체로 잇는다
//   call  요구사항의 동작이 부르는 API 서버·외부 시스템 (actions[].calls)
// 화면 사이 이동은 페이지·기능 플로우차트에 있으므로 여기에는 없다.
const UNASSIGNED = '__unassigned';

export function deriveOverview(spec, index) {
  const isAutomatic = (userType) => index.get(userType)?.kind === 'userType' && index.get(userType).item.automatic === true;
  const actionOf = (id) => (index.get(id)?.kind === 'action' ? index.get(id).item : null);

  // 요구사항마다: 어느 앱에서 일어나나(단계가 가장 많은 앱), 무엇을 만들고 무엇을 쓰나, 자동인가
  const info = spec.requirements.map((requirement) => {
    const steps = spec.scenarios.filter((scenario) => scenario.requirement === requirement.id).flatMap((scenario) => scenario.steps);
    const tally = new Map();
    for (const step of steps) if (index.is(step.app, 'app')) tally.set(step.app, (tally.get(step.app) ?? 0) + 1);
    const app = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const actions = steps.map((step) => actionOf(step.action)).filter(Boolean);
    const creates = new Set(actions.filter((action) => action.kind === 'create').map((action) => action.entity));
    const uses = new Set(actions.filter((action) => action.kind !== 'create').map((action) => action.entity));
    return { id: requirement.id, app, actions, creates, uses, automatic: steps.length > 0 && steps.every((step) => isAutomatic(step.userType)) };
  });

  const services = spec.product.systems.filter((system) => system.kind === 'service');
  const serviceOfApp = new Map();
  for (const service of services) for (const app of service.apps) if (!serviceOfApp.has(app)) serviceOfApp.set(app, service.id);
  const nodesOf = (app) => info.filter((item) => item.app === app).map((item) => item.id);
  const out = services.map((service) => ({
    id: service.id, name: index.name(service.id),
    apps: service.apps.filter((app) => index.is(app, 'app')).map((app) => ({ id: app, name: index.name(app), nodes: nodesOf(app) })),
  }));
  const loose = [...new Set(info.map((item) => item.app).filter((app) => app !== null && !serviceOfApp.has(app)))];
  if (loose.length > 0) out.push({ id: UNASSIGNED, name: '서비스 정해지지 않음', apps: loose.map((app) => ({ id: app, name: index.name(app), nodes: nodesOf(app) })) });

  const edges = [];
  const seen = new Set();
  const add = (edge) => {
    const key = `${edge.from}\u0000${edge.to}\u0000${edge.kind}`;
    if (!seen.has(key)) { seen.add(key); edges.push(edge); }
  };
  for (const maker of info) {
    for (const user of info) {
      if (maker.id === user.id) continue;
      const shared = [...maker.creates].filter((entity) => user.uses.has(entity) && !user.creates.has(entity));
      if (shared.length > 0) add({ from: maker.id, to: user.id, kind: 'order', label: shared.map((entity) => index.name(entity)).join('·') });
    }
  }
  const names = Object.fromEntries(spec.requirements.map((requirement) => [requirement.id, index.name(requirement.id)]));
  const types = Object.fromEntries(info.map((item) => [item.id, item.automatic ? 'auto' : 'requirement']));
  for (const item of info) {
    for (const action of item.actions) {
      for (const target of action.crossApp) {
        if (!index.is(target.app, 'app') || target.app === item.app) continue;
        const receivers = info.filter((other) => other.app === target.app && other.uses.has(action.entity));
        if (receivers.length > 0) {
          for (const receiver of receivers) add({ from: item.id, to: receiver.id, kind: 'cross', label: `${index.name(target.app)}에 알림` });
          continue;
        }
        // 받는 앱에 그 개체를 쓰는 요구사항이 없으면 앱 자체를 상자로 두고 잇는다.
        const appNode = `app:${target.app}`;
        const home = out.flatMap((service) => service.apps).find((app) => app.id === target.app);
        if (home && !home.nodes.includes(appNode)) home.nodes.push(appNode);
        names[appNode] = `${index.name(target.app)} (영향 받음)`;
        types[appNode] = 'app';
        add({ from: item.id, to: appNode, kind: 'cross', label: `${index.name(target.app)}에 알림` });
      }
    }
  }
  const systems = spec.product.systems.filter((system) => system.kind !== 'service');
  const known = new Set(systems.map((system) => system.id));
  for (const item of info) {
    for (const system of [...new Set(item.actions.flatMap((action) => action.calls).filter((id) => known.has(id)))]) {
      const count = item.actions.filter((action) => action.calls.includes(system)).length;
      add({ from: item.id, to: system, kind: 'call', label: `호출 ${count}` });
    }
  }
  return { services: out, systems: systems.map((system) => ({ id: system.id, name: index.name(system.id), kind: system.kind })), edges, names, types };
}
