import { quote } from '../model/labels.mjs';

const RESULT_BY_VALUE = {
  hide: '해당 버튼이 보이지 않는다',
  disable: '해당 버튼이 눌리지 않는다',
  deny: '동작이 거절되고 이유가 안내된다',
};

// 초안이 어느 요구사항을 검증하는지는 그 동작을 처음 쓰는 시나리오의 요구사항으로 정한다.
function requirementByAction(spec) {
  const requirements = new Map();
  for (const scenario of spec.scenarios) {
    for (const step of scenario.steps) {
      if (!requirements.has(step.action) && typeof scenario.requirement === 'string') {
        requirements.set(step.action, scenario.requirement);
      }
    }
  }
  return requirements;
}

export function deriveAcceptanceDrafts(spec, index, cells) {
  const requirementOf = requirementByAction(spec);
  const drafts = [];

  for (const cell of cells) {
    if (!Object.hasOwn(RESULT_BY_VALUE, cell.value)) continue;
    const entityName = index.name(index.get(cell.action)?.item.entity);
    const target = cell.state === null
      ? quote(entityName, '을/를')
      : `${quote(index.name(cell.state))} 상태의 ${quote(entityName, '을/를')}`;
    drafts.push({
      requirement: requirementOf.get(cell.action) ?? null,
      situation: `${quote(index.name(cell.userType), '이/가')} ${target} 볼 때`,
      action: `${quote(index.name(cell.action), '을/를')} 하려 하면`,
      result: RESULT_BY_VALUE[cell.value],
      from: 'permission',
    });
  }

  for (const entity of spec.entities) {
    for (const transition of entity.transitions) {
      drafts.push({
        requirement: requirementOf.get(transition.action) ?? null,
        situation: `${quote(entity.name, '이/가')} ${quote(index.name(transition.from))} 상태일 때`,
        action: `${quote(index.name(transition.action), '을/를')} 하면`,
        result: `${quote(index.name(transition.to))} 상태가 된다`,
        from: 'transition',
      });
    }
  }
  return drafts;
}
