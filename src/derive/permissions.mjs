import { LABELS } from '../model/labels.mjs';

// 만들기 전에는 상태가 없고, 목록은 여러 상태를 함께 보여 주므로 상태별 칸을 두지 않는다.
const STATELESS_KINDS = new Set(['list', 'create']);

const cellKey = (userType, action, state) => `${userType}|${action}|${state ?? '-'}`;

// 허용·숨김·비활성·불가가 아닌 값은 적지 않은 것과 같게 본다. 빈칸으로 드러나 정할 것이 된다.
const isKnownValue = (value) => Object.hasOwn(LABELS.permission, value);

export function statesForAction(action, index) {
  const entity = index.get(action.entity);
  if (entity?.kind !== 'entity') return null;
  if (STATELESS_KINDS.has(action.kind) || entity.item.states.length === 0) return [null];
  return entity.item.states.map((state) => state.id);
}

export function permissionGrid(spec, index) {
  const written = new Map();
  for (const row of spec.permissions) {
    const key = cellKey(row.userType, row.action, row.state ?? null);
    if (!written.has(key) && isKnownValue(row.value)) written.set(key, row.value);
  }

  const cells = [];
  const gaps = [];
  for (const userType of index.canonical(spec.userTypes)) {
    for (const action of index.canonical(spec.actions)) {
      const states = statesForAction(action, index);
      // 개체를 찾을 수 없는 동작은 칸을 만들 수 없다. 참조 오류는 검사 단계가 보고한다.
      if (states === null) continue;
      for (const state of states) {
        const value = written.get(cellKey(userType.id, action.id, state)) ?? null;
        cells.push({ userType: userType.id, action: action.id, state, value });
        if (value === null) gaps.push({ userType: userType.id, action: action.id, state });
      }
    }
  }
  return { cells, gaps };
}
