// diagram.md 읽기와 시퀀스 다이어그램 검사 (docs/diagram-guide.md, docs/harness.md 5장 22·28).
// Mermaid 전체가 아니라 작성법 3장의 줄 표기만 읽는다. 모르는 줄은 그려지지 않는 것으로 본다.
import { readStatus, sections, splitIds } from './md.mjs';
import { covers, resolve } from './cite.mjs';
import { exceptions, results } from './spec.mjs';

export const MAX_BLOCK_DEPTH = 3;
const OPEN = /^(alt|opt|loop|par|critical|break|rect)\b\s*(.*)$/;
const MIDDLE = /^(else|and|option)\b\s*(.*)$/;
const IGNORED = /^(%%|Note\b|autonumber\b|activate\b|deactivate\b|title\b)/;

export function parseDiagram(source) {
  const lines = source.split(/\r?\n/);
  const diagram = { status: readStatus(lines), title: lines.find((line) => line.startsWith('# '))?.slice(2).trim() ?? '', sequences: [], unknown: [] };
  for (const section of sections(lines)) {
    const head = section.title.match(/^(S\d+)\s*·\s*(.+)$/);
    if (!head) {
      diagram.unknown.push({ title: section.title, line: section.line });
      continue;
    }
    const sequence = { id: head[1], name: head[2].trim(), line: section.line, code: null, basis: null };
    let inside = false;
    for (const { text, line } of section.body) {
      if (!inside && text.trim() === '```mermaid' && !sequence.code) {
        inside = true;
        sequence.code = [];
      } else if (inside && text.trim() === '```') {
        inside = false;
      } else if (inside) {
        sequence.code.push({ text: text.trim(), line });
      } else {
        const basis = text.trim().match(/^계약:\s*(.+?)\s*·\s*(?:흐름|트리):\s*(.+)$/);
        if (basis) sequence.basis = { contracts: splitIds(basis[1]), tree: basis[2].trim(), line };
      }
    }
    if (inside) sequence.unclosed = true;
    diagram.sequences.push(sequence);
  }
  return diagram;
}

// 그림 하나를 참여자, 메시지, 묶음으로 읽는다.
function readCode(code) {
  const parsed = { participants: new Map(), messages: [], blocks: [], bad: [], maxDepth: 0, started: false };
  const stack = [];
  for (const { text, line } of code) {
    if (text === '' || IGNORED.test(text)) continue;
    if (!parsed.started) {
      if (text === 'sequenceDiagram') parsed.started = true;
      else parsed.bad.push({ text, line });
      continue;
    }
    const declare = text.match(/^(actor|participant)\s+([A-Za-z0-9_]+)(?:\s+as\s+(.+))?$/);
    const message = text.match(/^([A-Za-z0-9_]+)\s*(-->>|->>)\s*([A-Za-z0-9_]+)\s*:\s*(.+)$/);
    const open = text.match(OPEN);
    const middle = text.match(MIDDLE);
    if (declare) parsed.participants.set(declare[2], { kind: declare[1], name: (declare[3] ?? declare[2]).trim(), line });
    else if (message) parsed.messages.push({ from: message[1], reply: message[2] === '-->>', to: message[3], text: message[4].trim(), line });
    else if (open) {
      const block = { kind: open[1], labels: [{ text: open[2].trim(), line }] };
      stack.push(block);
      parsed.blocks.push(block);
      parsed.maxDepth = Math.max(parsed.maxDepth, stack.length);
    } else if (middle && stack.length) stack.at(-1).labels.push({ text: middle[2].trim(), line });
    else if (text === 'end' && stack.length) stack.pop();
    else parsed.bad.push({ text, line });
  }
  if (stack.length) parsed.bad.push({ text: `${stack.at(-1).kind}를 닫는 end가 없다`, line: stack.at(-1).labels[0].line });
  return parsed;
}

export function checkDiagram(diagram, { plan, spec, dev, sources, ids }) {
  const issues = [];
  const add = (step, kind, message, line) => issues.push({ step, kind, message, line });
  const components = new Map(dev.components.map((component) => [component.id, component]));
  const personas = new Set(plan.personas.map((persona) => persona.id));
  const contracts = new Map(dev.contracts.map((contract) => [contract.id, contract]));
  const conditions = new Map(spec.conditions.map((condition) => [condition.name, condition]));
  const plain = (text) => text.replace(/\.$/, '');
  const shown = new Set([...results(spec), ...dev.errors.map((error) => error.fields['보이는 것']?.text).filter(Boolean)].map(plain));
  const drawn = new Set();
  const drawnErrors = new Set();
  // 예외 흐름과 그 예외를 인용한 오류. 오류는 그림의 실패 응답으로, 예외 머리는 break 묶음 이름으로 나와야 한다.
  const exceptionPaths = exceptions(spec);
  const exceptionLabels = new Set(exceptionPaths.map(({ node }) => node.label));
  const exceptionErrors = dev.errors.map((error) => ({ error, path: error.fields['출처'] && resolve(error.fields['출처'].text, sources, ids).path }))
    .map(({ error, path }) => ({ error, exception: path && exceptionPaths.find((item) => covers(path, item.path)) }))
    .filter(({ exception }) => exception);

  for (const { title, line } of diagram.unknown) add(22, '모르는 머리', `"## ${title}"는 작성법에 없는 머리다. S번호 · 이름으로 쓴다.`, line);
  const seen = new Set();
  for (const sequence of diagram.sequences) {
    const label = `${sequence.id} ${sequence.name}`;
    if (seen.has(sequence.id)) add(22, '번호 겹침', `시퀀스 번호 ${sequence.id}가 두 번 나온다.`, sequence.line);
    seen.add(sequence.id);
    if (!sequence.code) {
      add(22, '그려지지 않음', `${label}에 \`\`\`mermaid 그림이 없다.`, sequence.line);
      continue;
    }
    if (sequence.unclosed) add(22, '그려지지 않음', `${label}의 \`\`\`mermaid 블록이 닫히지 않았다.`, sequence.line);
    const parsed = readCode(sequence.code);
    if (!parsed.started) add(22, '그려지지 않음', `${label}의 그림은 sequenceDiagram으로 시작해야 한다.`, sequence.line);
    for (const { text, line } of parsed.bad) add(22, '그려지지 않음', `${label}의 "${text}"를 읽지 못했다.`, line);
    if (parsed.maxDepth > MAX_BLOCK_DEPTH) add(22, '너무 깊은 그림', `${label}의 묶음 중첩이 ${MAX_BLOCK_DEPTH}단계를 넘는다.`, sequence.line);

    for (const [id, participant] of parsed.participants) {
      if (participant.kind === 'actor' ? !personas.has(id) : components.get(id)?.name !== participant.name) {
        add(22, '없는 참여자', `${label}의 ${participant.kind} ${id} ${participant.name}이 ${participant.kind === 'actor' ? '페르소나' : '아키텍처 표'}와 맞지 않는다.`, participant.line);
      }
    }
    for (const message of parsed.messages) {
      const where = `${label}의 "${message.from}${message.reply ? '-->>' : '->>'}${message.to}: ${message.text}"`;
      for (const id of [message.from, message.to]) if (!parsed.participants.has(id)) add(22, '없는 참여자', `${where}에 선언하지 않은 ${id}가 나온다.`, message.line);
      const id = message.text.match(/^(C\d+)\b/)?.[1];
      if (id) {
        drawn.add(id);
        const contract = contracts.get(id);
        if (!contract) add(22, '없는 계약', `${where}의 ${id}가 개발 스펙 계약에 없다.`, message.line);
        else {
          const [from, to] = message.reply ? [contract.to, contract.from] : [contract.from, contract.to];
          if (message.from !== from || message.to !== to) add(22, '다른 호출 방향', `${where}가 계약의 호출 ${contract.from} → ${contract.to}와 다르다.`, message.line);
          const failure = message.text.match(/실패\s*·\s*(E\d+)/)?.[1];
          if (failure) drawnErrors.add(failure);
          if (failure && !contract.failures.includes(failure)) add(22, '없는 실패', `${where}의 ${failure}가 ${id}의 실패에 없다.`, message.line);
        }
      } else if (!message.reply && components.has(message.from) && components.has(message.to) && !components.get(message.from).deps.includes(message.to)) {
        add(22, '없는 의존', `${where}인데 ${message.from}의 기대는 곳에 ${message.to}가 없다.`, message.line);
      }
      if (parsed.participants.get(message.to)?.kind === 'actor' && !shown.has(plain(message.text))) add(22, '다른 결과 문장', `${where}가 흐름의 화면 결과 문장이나 오류의 보이는 것과 다르다.`, message.line);
    }
    for (const block of parsed.blocks.filter((item) => item.kind === 'alt')) checkAlt(block, conditions, label, add);
    for (const block of parsed.blocks.filter((item) => item.kind === 'break')) {
      const name = block.labels[0].text;
      if (!exceptionLabels.has(name)) add(22, '없는 예외', `${label}의 "break ${name}"가 기획 상세 스펙 예외 흐름의 머리와 다르다.`, block.labels[0].line);
    }

    if (!sequence.basis) add(22, '근거 줄 없음', `${label} 그림 아래에 \`계약: … · 흐름: …\` 줄이 있어야 완성이다.`, sequence.line);
    else {
      for (const id of sequence.basis.contracts) if (!contracts.has(id)) add(22, '없는 계약', `${label} 근거 줄의 ${id}가 개발 스펙 계약에 없다.`, sequence.basis.line);
      if (!resolve(sequence.basis.tree, sources, ids).ok) add(22, '근거 줄 없음', `${label} 근거 줄의 흐름 "${sequence.basis.tree}"가 기획 상세 스펙에 없다.`, sequence.basis.line);
    }
  }
  for (const { error, exception } of exceptionErrors) {
    if (!drawnErrors.has(error.id)) add(22, '그림 없는 예외', `예외 흐름 "${exception.path}"의 ${error.id} ${error.title}이 어느 시퀀스에도 "C번호 실패 · ${error.id}"로 그려지지 않았다.`, error.line);
  }
  for (const contract of dev.contracts) if (!drawn.has(contract.id)) add(22, '그림 없는 계약', `${contract.id} ${contract.title}이 어느 시퀀스에도 나오지 않는다.`, contract.line);

  if (diagram.status !== '확정') add(28, '확정 전', '개발자가 시퀀스 다이어그램을 읽고 확정하면 상태: 확정으로 바꾼다.');
  return issues;
}

function checkAlt(block, conditions, label, add) {
  const branches = new Map();
  for (const { text, line } of block.labels) {
    const match = text.match(/^(.+?):\s*(.+)$/);
    const condition = match && conditions.get(match[1].trim());
    if (!condition) {
      add(22, '없는 조건', `${label}의 alt·else "${text}"가 조건표의 "조건: 갈래" 모양이 아니다.`, line);
      continue;
    }
    if (!condition.branches.includes(match[2].trim())) add(22, '없는 조건', `${label}의 "${text}"에서 '${match[2].trim()}'는 조건표에 없는 갈래다.`, line);
    branches.set(condition.name, [...(branches.get(condition.name) ?? []), match[2].trim()]);
  }
  for (const [name, found] of branches) {
    for (const branch of conditions.get(name).branches) if (!found.includes(branch)) add(22, '빠진 갈래', `${label}의 alt에 "${name}: ${branch}" 갈래가 없다.`, block.labels[0].line);
  }
}
