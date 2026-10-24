// brief.md 읽기와 기획 1단계 검사 (docs/brief-guide.md, docs/harness.md 5장 1~6).
import { bullets, items, readHead, readStatus, sections, splitIds } from './md.mjs';
import { sentenceIssues } from './text.mjs';

export const BRIEF_STEPS = { 1: '기획 › 1-1. 기능 이름', 2: '기획 › 1-2. 왜 지금', 3: '기획 › 1-3. 목표', 4: '기획 › 1-4. 비즈니스 요구사항', 5: '기획 › 1-5. 범위와 제약', 6: '기획 › 1-6. 확정' };
export const FEATURE = /^[a-z][a-z0-9-]*$/;

export function parseBrief(source) {
  const lines = source.split(/\r?\n/);
  const brief = { status: readStatus(lines), feature: readHead(lines, '기능'), title: lines.find((line) => line.startsWith('# '))?.slice(2).trim() ?? '', why: [], evidence: [], goals: [], requirements: [], outOfScope: [], constraints: [], questions: [], stray: [] };
  for (const section of sections(lines)) {
    if (section.title === '왜 지금') {
      for (const { text, line } of section.body) {
        if (text.trim() === '') continue;
        const evidence = text.trim().match(/^근거:\s*(.*)$/);
        if (evidence) brief.evidence.push({ text: evidence[1].trim(), line });
        else brief.why.push({ text: text.trim(), line });
      }
    } else if (section.title === '목표') {
      const read = items(section.body, /^### (G\d+) (.+)$/, ['지표']);
      brief.goals = read.items;
      brief.stray.push(...read.stray.map((item) => ({ ...item, step: 3 })));
    } else if (section.title === '비즈니스 요구사항') {
      const read = items(section.body, /^### (BR\d+) (.+)$/, ['근거 목표', '원문']);
      brief.requirements = read.items.map((item) => ({ ...item, goals: splitIds(item.fields['근거 목표']?.text) }));
      brief.stray.push(...read.stray.map((item) => ({ ...item, step: 4 })));
    } else if (section.title === '범위 밖') {
      brief.outOfScope = bullets(section.body);
    } else if (section.title === '제약') {
      brief.constraints = bullets(section.body);
    } else if (section.title === '정할 것') {
      brief.questions = bullets(section.body);
    } else {
      brief.stray.push({ text: `## ${section.title}`, line: section.line, step: 2 });
    }
  }
  return brief;
}

export function checkBrief(brief) {
  const issues = [];
  const add = (step, kind, message, line) => issues.push({ step, kind, message, line });
  const prose = (step, list) => {
    for (const { text, line } of list) for (const issue of sentenceIssues(text)) add(step, issue.kind, issue.message, line);
  };

  if (!brief.feature) add(1, '기능 이름 없음', '결과 폴더 이름이 될 영어 기능 이름이 `기능:` 줄에 있어야 완성이다.');
  else if (!FEATURE.test(brief.feature)) add(1, '기능 이름 형식', `기능 이름 "${brief.feature}"는 영어 소문자, 숫자, -만 쓴다.`);

  if (brief.why.length === 0) add(2, '문제 없음', '지금 무엇이 문제인지 한 문장 이상 있어야 완성이다.');
  if (brief.evidence.length === 0) add(2, '근거 없음', '문제의 근거(숫자, 출처)가 `근거:` 줄에 있어야 완성이다.');
  prose(2, [...brief.why, ...brief.evidence]);
  for (const { text, line, step } of brief.stray) add(step, '모르는 줄', `"${text}"가 어느 칸인지 알 수 없다. 작성법의 머리 이름으로 옮긴다.`, line);

  if (brief.goals.length === 0) add(3, '목표 없음', '무엇이 되면 성공인지 목표가 하나 이상 있어야 완성이다.');
  duplicates(brief.goals, (id, line) => add(3, '번호 겹침', `목표 번호 ${id}가 두 번 나온다.`, line));
  for (const goal of brief.goals) {
    const metric = goal.fields['지표'];
    if (!metric?.text || !/\d/.test(metric.text)) add(3, '지표 없는 목표', `${goal.id} ${goal.title}에 숫자로 된 지표가 있어야 완성이다.`, goal.line);
    prose(3, [{ text: goal.title, line: goal.line }, ...(metric?.text ? [metric] : [])]);
  }

  const goalIds = new Set(brief.goals.map((goal) => goal.id));
  if (brief.requirements.length === 0) add(4, 'BR 없음', '사업 입장에서 꼭 돼야 하는 비즈니스 요구사항이 하나 이상 있어야 완성이다.');
  duplicates(brief.requirements, (id, line) => add(4, '번호 겹침', `비즈니스 요구사항 번호 ${id}가 두 번 나온다.`, line));
  for (const requirement of brief.requirements) {
    const label = `${requirement.id} ${requirement.title}`;
    if (requirement.goals.length === 0) add(4, '근거 없는 요구사항', `${label}이 어느 목표를 위한 것인지 \`근거 목표:\`가 있어야 완성이다.`, requirement.line);
    for (const id of requirement.goals) if (!goalIds.has(id)) add(4, '근거 없는 요구사항', `${label}의 근거 목표 ${id}가 목표에 없다.`, requirement.fields['근거 목표'].line);
    if (!requirement.fields['원문']?.text) add(4, '원문 없음', `${label}에 사람이 한 말이 \`원문:\`으로 있어야 완성이다.`, requirement.line);
    prose(4, [{ text: requirement.title, line: requirement.line }]);
  }
  const usedGoals = new Set(brief.requirements.flatMap((requirement) => requirement.goals));
  for (const goal of brief.goals) {
    if (brief.requirements.length && !usedGoals.has(goal.id)) add(4, '이어지지 않은 목표', `${goal.id} ${goal.title}을 근거로 쓰는 비즈니스 요구사항이 없다.`, goal.line);
  }

  if (brief.outOfScope.length === 0) add(5, '범위 밖 없음', '이번에 하지 않을 것이 `범위 밖`에 한 줄 이상 있어야 완성이다.');
  prose(5, [...brief.outOfScope, ...brief.constraints]);

  for (const question of brief.questions) add(6, '정할 것 남음', question.text, question.line);
  if (brief.status !== '확정') add(6, '확정 전', '사람이 비즈니스 요구사항을 읽고 확정하면 상태: 확정으로 바꾼다.');
  return issues;
}

export function duplicates(list, report) {
  const seen = new Set();
  for (const item of list) {
    if (seen.has(item.id)) report(item.id, item.line);
    seen.add(item.id);
  }
}
