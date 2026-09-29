// 그린 그림의 겹침을 찾는다. 배치 함수는 이 목록이 빌 때까지 간격을 넓혀 다시 그린다 (하네스 루프).
//   상자 겹침 · 선이 상자를 지남 · 선이 포개짐 · 글자 겹침 · 글자가 상자를 가림 · 틀 겹침
// 담는 틀(container, 예: 서비스 상자)은 안의 상자와 겹쳐도 되고 선이 테두리를 지나도 된다. 틀끼리만 겹치면 안 된다.

export const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// 선분이 사각형 안쪽을 지나는지 (Liang–Barsky). 경계에 닿는 것은 지나는 것으로 보지 않는다.
export function crosses([x1, y1], [x2, y2], rect) {
  const inset = { x: rect.x + 2, y: rect.y + 2, w: rect.w - 4, h: rect.h - 4 };
  const dx = x2 - x1;
  const dy = y2 - y1;
  let t0 = 0;
  let t1 = 1;
  for (const [p, q] of [[-dx, x1 - inset.x], [dx, inset.x + inset.w - x1], [-dy, y1 - inset.y], [dy, inset.y + inset.h - y1]]) {
    if (p === 0) { if (q < 0) return false; continue; }
    const r = q / p;
    if (p < 0) t0 = Math.max(t0, r); else t1 = Math.min(t1, r);
    if (t0 > t1) return false;
  }
  return true;
}

const segmentsOf = (route) => route.points.slice(1).map((end, i) => [route.points[i], end]);

// 두 선분이 같은 가로줄이나 세로줄에 2px 넘게 포개지는지
function collinear([a1, a2], [b1, b2]) {
  for (const axis of [0, 1]) {
    const other = 1 - axis;
    if (a1[other] !== a2[other] || b1[other] !== b2[other] || a1[other] !== b1[other]) continue;
    const lo = Math.max(Math.min(a1[axis], a2[axis]), Math.min(b1[axis], b2[axis]));
    const hi = Math.min(Math.max(a1[axis], a2[axis]), Math.max(b1[axis], b2[axis]));
    if (hi - lo > 2) return true;
  }
  return false;
}

// labels: 선에 딸리지 않은 글자(제목 등). 선은 어느 글자도 지나면 안 된다.
export function findCollisions({ nodes, routes, containers = [], labels = [] }) {
  const found = [];
  const add = (kind, a, b) => found.push({ kind, a, b });
  nodes.forEach((one, i) => nodes.slice(i + 1).forEach((two) => { if (overlap(one, two)) add('상자 겹침', one.id, two.id); }));
  // 틀 안에 틀이 든 것(서비스 안의 앱)은 겹침이 아니다.
  const contains = (a, b) => b.x >= a.x && b.y >= a.y && b.x + b.w <= a.x + a.w && b.y + b.h <= a.y + a.h;
  containers.forEach((one, i) => containers.slice(i + 1).forEach((two) => { if (overlap(one, two) && !contains(one, two) && !contains(two, one)) add('틀 겹침', one.id, two.id); }));
  routes.forEach((route, i) => {
    const name = `${route.from}→${route.to}`;
    for (const [p, q] of segmentsOf(route)) {
      for (const node of nodes) if (node.id !== route.from && node.id !== route.to && crosses(p, q, node)) add('선이 상자를 지남', name, node.id);
    }
    for (const other of routes.slice(i + 1)) {
      if (segmentsOf(route).some((a) => segmentsOf(other).some((b) => collinear(a, b)))) add('선이 포개짐', name, `${other.from}→${other.to}`);
    }
    const texts = [...labels.map((box) => ({ box, owner: null })), ...routes.filter((other) => other !== route && other.labelBox).map((other) => ({ box: other.labelBox, owner: other }))];
    for (const [p, q] of segmentsOf(route)) {
      for (const { box, owner } of texts) if (crosses(p, q, box)) add('선이 글자를 지남', name, owner ? `${owner.from}→${owner.to}` : box.text ?? '제목');
    }
    for (const box of labels) for (const node of nodes) if (overlap(box, node)) add('글자가 상자를 가림', box.text ?? '제목', node.id);
    if (route.labelBox) {
      for (const node of nodes) if (overlap(route.labelBox, node)) add('글자가 상자를 가림', name, node.id);
      for (const other of routes.slice(i + 1)) if (other.labelBox && overlap(route.labelBox, other.labelBox)) add('글자 겹침', name, `${other.from}→${other.to}`);
    }
  });
  return found;
}

// 간격 배율을 키워 가며 겹침이 없어질 때까지 다시 그린다. 끝까지 남으면 마지막 결과와 남은 겹침을 돌려준다.
export const SPACING_STEPS = [1, 1.25, 1.5, 2, 2.5];
export function layoutUntilClean(layout) {
  let last = null;
  for (const spacing of SPACING_STEPS) {
    const result = layout(spacing);
    const collisions = findCollisions(result);
    last = { ...result, spacing, collisions };
    if (collisions.length === 0) return last;
  }
  return last;
}
