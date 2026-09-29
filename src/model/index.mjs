const SOURCES = [
  ['userType', 'userTypes'],
  ['app', 'apps'],
  ['requirement', 'requirements'],
  ['entity', 'entities'],
  ['action', 'actions'],
  ['scenario', 'scenarios'],
  ['acceptance', 'acceptance'],
  ['event', 'events'],
  ['question', 'questions'],
  ['decision', 'decisions'],
];

export function buildIndex(spec) {
  const entries = new Map();
  const duplicateKinds = new Map();

  function add(kind, item, parent = null) {
    const { id } = item;
    if (typeof id !== 'string' || id === '') return;
    if (entries.has(id)) {
      // 첫 항목을 유지한다. 뒤에 나온 항목은 중복으로만 기록하고 검사 단계가 차단 이슈로 알린다.
      if (!duplicateKinds.has(id)) duplicateKinds.set(id, [entries.get(id).kind]);
      duplicateKinds.get(id).push(kind);
      return;
    }
    entries.set(id, { kind, item, parent });
  }

  for (const [kind, key] of SOURCES) {
    for (const item of spec[key]) {
      add(kind, item);
      if (kind === 'entity') for (const state of item.states) add('state', state, item);
    }
  }
  for (const metric of spec.summary.metrics) add('metric', metric);

  return {
    get: (id) => entries.get(id),
    has: (id) => entries.has(id),
    is: (id, kind) => entries.get(id)?.kind === kind,
    name(id) {
      const entry = entries.get(id);
      if (!entry) return `(알 수 없음: ${id})`;
      return typeof entry.item.name === 'string' && entry.item.name !== '' ? entry.item.name : `(이름 없음: ${id})`;
    },
    // 같은 ID가 여러 번 나오면 색인에 먼저 등록된 항목만 쓴다. 표·흐름이 중복으로 두 번 그려지지 않게 한다.
    canonical: (items) => items.filter((item) => entries.get(item.id)?.item === item),
    duplicates: [...duplicateKinds].map(([id, kinds]) => ({ id, kinds })),
  };
}
