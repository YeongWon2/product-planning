import { quote } from '../model/labels.mjs';

function gapQuestion(index, gap) {
  const userType = quote(index.name(gap.userType), '은/는');
  const action = quote(index.name(gap.action), '을/를');
  const entity = quote(index.name(index.get(gap.action)?.item.entity));
  if (gap.state === null) return `${userType} ${entity}에 ${action} 할 수 있는가?`;
  return `${userType} ${quote(index.name(gap.state))} 상태의 ${entity}에 ${action} 할 수 있는가?`;
}

// 자동으로 만든 정할 것은 모두 착수를 막는다. 사람이 답하기 전까지 기획이 비어 있기 때문이다.
export function deriveQuestions(spec, index, { gaps, flowQuestions }) {
  const owner = spec.meta.profile.defaultOwner;
  const fromGaps = gaps.map((gap) => ({
    id: `auto:perm:${gap.userType}:${gap.action}:${gap.state ?? '-'}`,
    name: gapQuestion(index, gap),
    owner,
    blocking: true,
    auto: true,
  }));
  const fromFlow = flowQuestions.map((question) => ({ id: question.id, name: question.name, owner, blocking: true, auto: true }));
  return [...fromGaps, ...fromFlow];
}
