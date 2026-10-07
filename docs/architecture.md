# planbot 아키텍처

도구를 만드는 사람용 문서다. 기획서 규칙(한 문장, 코드 금지)은 여기엔 적용하지 않는다.

- 무엇을 만드는지: [spec.md](spec.md)
- 근거: [OpenClaw 스펙](../benchmark/openclaw/spec.md) · [Hermes 스펙](../benchmark/hermes/spec.md) · [manyfast 선별](../benchmark/manyfast/선별.md)
- 출처 표기: **[OC]** OpenClaw · **[H]** Hermes · **[MF]** manyfast · **[new]** planbot 고유

## 0. 설계 원칙

1. **데몬 하나가 진실의 원천, 나머지는 얇은 클라이언트** [OC][H] — CLI·웹은 같은 dispatch를 부른다. UI는 캐시일 뿐이다.
2. **판단은 AI, 강제는 코드** [OC 교훈][new] — 위임·역할 지침은 프롬프트일 뿐이다. 순서·게이트·배분·린트·승인은 하네스 코드가 한다.
3. **스스로 깨어나는 건 heartbeat, 스스로 배우는 건 리뷰 루프** — 깨어남 [OC], 배움 [H].
4. **사람은 회의와 컨펌만** [new] — 서버가 사람에게 요청을 보내고 기다린다 [H].
5. **메인 Claude Code와 완전히 분리된 세션** [new] — 내 `~/.claude` 플러그인·훅·지침이 섞이지 않는다.
6. **작게** — OpenClaw RPC 492개·테이블 150개, Hermes 7종 백엔드 같은 것은 가져오지 않는다. 메서드 20여 개, 테이블 10여 개로 시작한다.

## 1. 한눈에

```
┌──────────────────────────────── planbot (프로그램 하나, TypeScript) ────────────────────────────────┐
│                                                                                                    │
│  CLI  planbot onboard | start | stop | status | new | open | doctor | logs | --profile <이름>        │
│        │ stdio JSON-RPC (같은 dispatch)                                                             │
│        ▼                                                                                            │
│  Gateway 데몬  127.0.0.1:4317  (HTTP + WS 한 포트, 웹 UI 정적 서빙)                    [OC][H]       │
│   ├─ RPC Dispatch      JSON-RPC 2.0 · 서버→클라 요청 · 이벤트 seq + replay              [H]          │
│   ├─ Orchestrator      회의 · 팀 논의 · 회의 재요청 · 결과물 보고 (상태 머신)            [new]        │
│   ├─ Harness           단계 게이트 · 린트 · 3회 재시도 · 백업 · 행동 검증               [new]        │
│   ├─ Board             칸반 카드 · claim · dispatch · 이벤트 로그 · done은 사람만         [OC][H]      │
│   ├─ Scheduler         heartbeat(체크리스트 비면 호출 0) · 하루 예산 · curator          [OC][H]      │
│   ├─ Learning          컨펌/반려 뒤 리뷰 → 기억·스킬 수정 제안 → 사람 승인              [H]          │
│   ├─ Store             SQLite 하나 (WAL, FTS5 CJK)                                    [H]          │
│   └─ Providers         Claude(Agent SDK, 격리) · Codex(exec, 격리) · fake              [new]        │
│                                                                                                    │
│  Web UI  React + shadcn + PixiJS — 사무실 · 회의실 · 칸반 · 문서/흐름도/와이어프레임 · 타임라인   [new] │
│  core SDK (의존성 0) — 기획서 모델 · md 파서/직렬화 · 린트 · HTML 렌더                         [new] │
└────────────────────────────────────────────────────────────────────────────────────────────────────┘

~/.planbot/                 상태 홈 (설정 · DB · 캐릭터 · provider 격리 홈)        [OC][H]
~/planbot/<기획 이름>/       워크스페이스 (doc.md · doc.html · sources/ · .backups/)  [OC]
```

## 2. 프로세스

| 항목 | 결정 | 출처 |
|---|---|---|
| 상시 프로세스 | 게이트웨이 데몬 **하나** (Hermes처럼 둘로 나누지 않음) | [OC] |
| 실행 | `planbot start`(백그라운드) / `planbot gateway run`(포그라운드, 개발용) | [OC] |
| 서비스 등록 | 선택: macOS launchd(RunAtLoad·KeepAlive). 기본은 수동 시작 | [OC] |
| 포트 | `127.0.0.1:4317` 고정 바인드, 외부 노출 없음. `--profile dev`는 4318 | [OC] |
| 단일 인스턴스 | 상태 홈의 락 파일(PID, 죽은 프로세스 회수) + 포트 배타 바인드 + 생존 확인용 `/healthz` | [OC][H] |
| 종료 | 진행 중 모델 호출이 끝나기를 최대 60초 기다린 뒤 종료, 진행 상태는 DB에 있어 재시작 시 이어감 | [OC] |

## 3. 프로토콜

**전송**: WebSocket(`/rpc`) + stdio(CLI). 둘 다 **줄 단위 JSON-RPC 2.0**, 같은 dispatch를 쓴다 [H].

**메시지 세 종류** [H]
```jsonc
// 클라 → 서버 요청
{"jsonrpc":"2.0","id":7,"method":"task.create","params":{"text":"간단한 일정관리 앱 기획해줘"}}
// 서버 → 클라 이벤트 (프로젝트별 단조 증가 seq)
{"jsonrpc":"2.0","method":"event","params":{"type":"agent.say","project":"p1","seq":128,
  "payload":{"agent":"ux","to":"policy","text":"환불은 결제 후 며칠까지예요?"}}}
// 서버 → 클라 요청 (사람이 답할 때까지 해당 흐름이 멈춤)
{"jsonrpc":"2.0","id":"srq-3","method":"meeting.request","params":{"project":"p1","agenda":[…]}}
```

**연결**: 첫 메시지는 `connect{client, protocol}` [OC]. 응답에 현재 스냅샷(칸반·열린 요청·캐릭터 상태)을 담는다. 재접속 시 `events.since{project, seq}`로 빠진 것만 받는다 [H]. 버퍼를 넘으면 스냅샷을 다시 받는다 [OC]. 열린 서버 요청은 재접속하면 다시 띄운다 [H].

**메서드 (시작 세트 약 20개)**
| 묶음 | 메서드 |
|---|---|
| 연결·상태 | `connect`, `health`, `snapshot.get`, `events.since` |
| 프로젝트 | `project.list`, `project.create`, `project.open`, `task.create`(할 일 맡기기) |
| 회의 | `meeting.answer`, `meeting.accept`(재요청 수락) |
| 컨펌 | `result.approve`, `result.reject{sections, reason}` |
| 칸반 | `board.get`, `card.get` |
| 문서 | `doc.get`, `doc.render`, `doc.export` |
| 팀 | `agents.list`, `agent.get`(성격·지금 하는 일·최근 대화·기억) |
| 학습 | `learning.list`, `learning.approve`, `learning.reject` |
| 설정 | `config.get`, `config.patch`, `onboard.step` |

**서버 → 클라 요청**: `meeting.request`(요구사항 회의 / 재회의), `result.confirm`(결과물 컨펌), `learning.confirm`("다음부터 이렇게 기억할까요?").

**이벤트**: `agent.state`(idle·walking·thinking·typing·talking·resting), `agent.say`(말풍선 한 줄), `agent.move`(목적지), `card.moved`, `card.claimed`, `card.comment`, `meeting.opened|closed`, `doc.changed`, `review.finding`, `budget.update`, `learning.proposed`.

**계약 단일 소스**: zod 스키마 하나(`packages/protocol`) → 서버 검증 + 웹 타입 [H(Pydantic→TS 생성 방식)].

## 4. 상태와 파일

```
~/.planbot/                         (= PLANBOT_HOME, --profile X → ~/.planbot-X)       [OC][H]
  config.json5                      동작 설정 (zod 검증)
  .env                              비밀값만 (API 키)                                   [H]
  planbot.db                        SQLite 하나 (WAL)
  agents/<역할>/                    캐릭터 홈 (아래 5장)
  skills/                           팀 공용 기획 스킬
  providers/claude-home/ codex-home/  provider 격리 홈
  logs/{gateway,agents,errors}.log
  gateway.lock · gateway.json(PID·포트)
~/planbot/<기획>/                   워크스페이스 — 사람이 보고 git에 넣는 곳
  doc.md · doc.html · sources/ · .backups/<시각>.md
```
- 경로는 반드시 `planbotHome()`으로 얻는다 [H].
- 설정이 바뀌어 옛 형식이 안 맞으면 `planbot doctor --fix`가 백업 후 옮긴다 [OC].

**planbot.db 테이블**
| 테이블 | 내용 | 출처 |
|---|---|---|
| `projects` | 기획 하나 = 워크스페이스 경로, 단계, 상태 | [new] |
| `cards` | 칸반 카드: section, status, assignee, claim_owner, claim_expires, attempts, parent_id | [OC][H] |
| `card_events` | created · moved · claimed · comment · lint_failed · rejected … (타임라인) | [OC][H] |
| `meetings` | 종류(요구사항/재회의), 안건, 답, 요약 `{overview, decisions, open, risks}` | [OC] |
| `messages` | 캐릭터 간·회의 발화 (who, to, text, card_id) | [new] |
| `messages_fts` | FTS5 + CJK 토크나이저 — 한글 회의·논의 검색 | [H] |
| `events` | 프로토콜 이벤트 append-only (seq) | [OC][H] |
| `pending_requests` | 열린 서버→클라 요청 (재접속 시 재표시) | [H] |
| `agent_sessions` | 캐릭터별 provider 세션 id, 마지막 깨어남, 체크리스트 | [OC] |
| `learning_proposals` | 기억·스킬 수정 제안과 승인 상태 | [H] |
| `usage` | 날짜·캐릭터·모델별 토큰과 비용 | [H] |
| `schema_meta` | 스키마 버전 (앞으로만 마이그레이션) | [OC] |

## 5. 팀과 캐릭터

**캐릭터 = 영속 에이전트 하나 = 홈 폴더 하나** [OC]. 일회성 하위 에이전트로 만들지 않는다 — Hermes의 위임 모델은 부모 대화를 모르고 기억을 못 써서 "서로 논의하는 팀원"에 맞지 않는다 [H 교훈].

```
~/.planbot/agents/pm/
  IDENTITY.md   이름 · 색 · 소품 · 자리 위치 (그림과 연출용)              [OC]
  SOUL.md       말투·성격 (규칙은 바꾸지 않음)                             [OC][H]
  ROLE.md       담당 섹션 · 할 수 있는 행동 · 상시 지시 · 넘길 때 형식      [OC AGENTS.md]
  MEMORY.md     팀·프로젝트 사실 (최대 2,000자, 사용률 헤더)               [H]
  USER.md       기획자 취향·컨펌 패턴 (최대 1,200자)                        [H]
  skills/       이 역할의 기획 스킬 1~3개 (SKILL.md)                        [H]
```

| 캐릭터 | 담당 | 비고 |
|---|---|---|
| PM | 회의 진행, 카드 분해, 재회의 요청, 결과물 보고 | **유일한 사람 창구**, 모든 결과는 PM을 거친다 [OC coordinator] |
| 스토리텔러 | 사용자 역할, 도메인 스토리 | |
| UX 설계자 | 유저플로우 | |
| 화면 담당 | 와이어프레임 | |
| 정책 담당 | 정책, 하지 않는 것 | |
| 검토단 | 6관점 검토 | 작성 AI와 **다른 provider**(기본 Codex) |
| 서기 | 회의 요약, 린트, 직렬화, 빌드 | 모델 호출 최소 (대부분 코드) |

**프롬프트 조립 (3층)** [H]
| 층 | 내용 | 캐시 |
|---|---|---|
| stable | `SOUL.md` · `ROLE.md` · 기획서 형식·린트 규칙 요약 · 행동 스키마 | 세션 내내 고정 |
| context | 프로젝트 한 줄 정의 · 확정 요구사항 · 담당 섹션 현재 내용 | 회의마다 갱신 |
| volatile | `MEMORY.md`·`USER.md` 스냅샷 · 스킬 목록(설명 60자) · 받은 메시지 · 지금 카드 | 매 턴 |
- 세션 중 기억이 바뀌어도 프롬프트는 고정, 다음 회의(세션)부터 반영 [H 고정 스냅샷].
- 파일당 상한 + 전체 상한, 넘치면 자르고 "직접 읽어라" 안내 [OC].

## 6. 진행 상태 머신과 칸반

```
요청 ─▶ 요구사항 회의 ─▶ 팀 논의 ─▶ 팀 리뷰 ─▶ 결과 컨펌 ─▶ 완료
          ▲  (사람)        │  ▲         │         (사람) │ 섹션별 반려
          └── 재회의 ◀─────┘  └─────────┘                 └──▶ 팀 논의
```

**카드** [OC Workboard][H kanban]
- 카드 하나 = 기획서 섹션 하나(또는 유저플로우·정책의 소제목 하나).
- 필드: `section, status, assignee, claim{owner, expires}, attempts, parent, links(blocks), comments, proof(초안 diff)`.
- 상태: `requested → meeting → discussing → reviewing → confirming → done` + `blocked(재회의 대기)`.
- **done은 사람만** [OC] — `result.approve`만 카드를 done으로 옮긴다.

**dispatch (코드)** [OC]
1. 확정 요구사항이 생기면 PM이 카드를 쪼갠다(분해 행동).
2. 선행 카드가 끝난 카드를 `discussing` 가능으로 승격(단계 순서: 정의 → 스토리 → 플로우 → 와이어 → 정책 → 나머지).
3. 담당 캐릭터에게 배정: **캐릭터당 동시 1장**, 전체 동시 실행 최대 3.
4. claim 만료(기본 10분 무소식) → 회수하고 재배정.
5. 같은 카드 린트 3회 실패 → `blocked` + 재회의 안건 [new].

## 7. 캐릭터 루프 — "사람처럼"

**깨어남** [OC heartbeat]
- 데몬 스케줄러가 캐릭터별 주기(기본 진행 중 30초, 대기 중 10분)로 깨운다.
- 깨우기 전에 **코드가 체크리스트를 먼저 본다**: 내 카드가 있나, 받은 메시지가 있나, 리뷰할 게 있나. 전부 없으면 **모델을 부르지 않고** `resting` 연출만.
- 이벤트 깨우기: 메시지 수신·카드 배정 시 즉시(최소 간격 5초, 폭주 방지).
- 캐릭터마다 실행 lane 하나(동시 1턴) + 전역 동시 상한 [OC].

**한 턴**
1. Orchestrator가 입력 조립: 3층 프롬프트 + 이번 깨어난 이유.
2. provider 호출 — **구조화 출력**으로 행동 하나를 고른다.
   ```ts
   type Action =
     | { kind: "write_section"; card: string; draft: SectionJson; say: string }
     | { kind: "discuss"; to: AgentId; text: string; card?: string }        // 팀 논의
     | { kind: "comment"; card: string; text: string }
     | { kind: "request_meeting"; items: AgendaItem[] }                      // PM만
     | { kind: "review"; card: string; findings: Finding[] }                 // 검토단만
     | { kind: "decompose"; cards: CardDraft[] }                              // PM만
     | { kind: "report_result" }                                              // PM만
     | { kind: "rest"; say?: string }
   ```
3. Harness 검증: 역할에 허용된 행동인가, 지금 상태에서 가능한가, `draft`가 린트를 통과하는가.
4. 통과 → 상태 변경 + 이벤트. 실패 → 오류를 붙여 같은 캐릭터 재시도(최대 3).
5. 웹이 이벤트로 연출: 상대 자리로 걸어가 말풍선, 타이핑, 카드 이동.

**팀 논의 규칙** [OC coordinator 규칙 응용]
- 전문가끼리 직접 `discuss` 허용(사무실에서 보이는 대화), 단 **결론은 카드 코멘트로 남기고 PM이 취합**.
- 한 카드에서 같은 두 캐릭터 왕복 4회 넘으면 PM 개입 → 그래도 안 맞으면 재회의 안건.
- 넘길 때 형식: 바꾼 줄 · 근거 · 불확실한 것 [OC].

## 8. 회의

**요구사항 회의** (할 일을 받으면 바로)
1. PM이 할 일 문장과 자료를 읽고 안건을 만든다(필요한 팀원이 안건 추가).
2. 서버 → 클라 요청 `meeting.request` [H]: 안건 ≤5개, 각 안건은 선택지·추천·직접 입력 [MF][OC ask_user].
3. 웹: 캐릭터들이 회의실로 이동, 회의 모달.
4. 답이 오면 서기가 요약 `{overview, decisions[], open[], risks[]}` [OC 회의 요약]. "결정을 지어내지 말 것" 지침 포함.
5. `decisions` → 확정 요구사항, `open` → 다음 회의 후보.

**재회의**
- 팀 논의 중 빠진 요구사항 → 캐릭터가 PM에게 `discuss` → PM이 모아서 `request_meeting`.
- 묶음 규칙: 첫 요청 후 2분 또는 안건 3개가 모이면 발송. 그 사이 해당 카드만 `blocked`.
- 웹: PM이 내 자리로 걸어와 알림 → 수락하면 회의 모달.

**외부 회의록**: 파일을 던지면 결정을 확정·미정·기각으로 추출 [MF] → 확정은 카드 코멘트, 미정은 안건.

## 9. 결과물과 컨펌

- 모든 카드가 `confirming`이 되면 PM이 `report_result` → 서버 요청 `result.confirm`.
- 보여 줄 것: 기획서 요약, 섹션별 diff, 영향받는 줄, 남은 검토 지적.
- `result.approve` → 백업 → `doc.md` 확정 → `doc.html` 빌드 → 카드 done.
- `result.reject{sections, reason}` → 해당 카드만 `discussing`으로, 사유는 카드 코멘트 + **학습 신호**.

## 10. 기억과 학습 [H]

**언제**: 매 턴이 아니라 이벤트 때만 — 결과 컨펌, 섹션 반려, 회의 종료. (Hermes 리뷰 1회 약 30K 토큰 → 비용 때문에 이벤트 기반)

**어떻게**
1. 해당 캐릭터의 대화 스냅샷으로 **백그라운드 리뷰**를 돌린다(응답 후, 허용된 도구만).
2. 신호 우선순위: 사람의 반려·교정 > 회의에서 바뀐 결정 > 린트 반복 실패 패턴.
3. 결과는 **제안**으로만: 기억 추가·교체 / 스킬 Pitfalls 추가.
4. 서버 요청 `learning.confirm`("다음부터 '정책은 50자 안'으로 쓸까요?") → 승인 시 반영.
5. 사람에게 "배운 것" 타임라인(`/journey` 같은 화면) — 보고 지우기·고치기.

**규칙**
- 한 사실은 한 곳에만: 사실·취향 → `MEMORY.md`/`USER.md`, 절차·함정 → 스킬.
- "기록이 아니라 교훈": 날짜·사건 대신 일반화된 규칙 + 이유 한 구절.
- 저장 금지: 환경 탓 실패, 일회성 사정, 해결 안 된 실패를 권장법처럼.
- 기억이 상한을 넘으면 자동 압축하지 않고 오류 → 캐릭터가 스스로 정리.
- 스킬은 역할당 1~3개로 고정, 새로 만들지 않고 고치기만(난립 방지).
- curator: 30일 안 쓴 기억 항목은 보관(삭제 안 함).

**사용자 모델**: 캐릭터별 `USER.md` + PM이 모든 캐릭터에 공유하는 `team/USER.md`(기획자 공통 취향). Honcho 같은 외부 서버는 쓰지 않는다.

## 11. 기획서 파이프라인 (core)

- 모델: 섹션 · 줄(키워드, 문장, 가정 여부) · 플로우(단계, 분기, 행동) · 스토리(행위자, 대상, 동작) · 와이어프레임(요소, 단추 → 화면).
- `parse(md) → Doc`, `serialize(Doc) → md` (왕복 동일).
- 린트 L1~L10 (spec.md "린트" 절). 캐릭터 `draft`는 반드시 여기 통과.
- 렌더: 한 파일 HTML — 흐름도(소제목 레인), 스토리 그림, 와이어프레임, 단계 클릭 → 화면, 단추 클릭 → 다음 화면.
- 웹 문서 탭은 같은 렌더를 쓴다(내보낸 doc.html과 같은 화면).

## 12. Provider

**모델과 구동 방식은 다른 축** [OC]
```json5
providers: {
  writer:   { model: "claude-sonnet", runtime: "api-key" },   // 작성·논의
  reviewer: { model: "gpt-5.x",      runtime: "codex-cli" },  // 검토단
  chatter:  { model: "claude-haiku", runtime: "api-key" },    // 잡담·진행 보고
}
```

**Claude** — Agent SDK, 캐릭터 턴마다 `query()`
- `settingSources: []` — 내 `~/.claude` 설정·플러그인·훅·CLAUDE.md 안 읽음
- `strictMcpConfig: true`, `mcpServers: {}` — MCP 0개
- `systemPrompt`: 3층 프롬프트(우리 것만), `tools`: 없음 또는 읽기만 — 쓰기는 하네스가
- `outputFormat: { type: "json_schema", schema: ActionSchema }`
- `env: { CLAUDE_CONFIG_DIR: ~/.planbot/providers/claude-home, CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" }`
- `cwd`: 워크스페이스, `resume`: 캐릭터별 세션 id

**Codex** — `codex exec --json --output-schema <file> --skip-git-repo-check -C <workspace>`, `CODEX_HOME=~/.planbot/providers/codex-home`

**인증 정책**
- 기본 `api-key`. 친구 공유도 이것만.
- Anthropic은 사전 승인 없이 제3자 제품이 claude.ai 구독 로그인을 제공하는 것을 허용하지 않는다 → planbot 안에 claude.ai 로그인 화면을 만들지 않는다.
- `local-cli` 런타임은 설정에서 명시적으로 켜는 개인용 선택지로만, 약관 확인 전까지 기본 꺼짐.
- 온보딩: 사용 가능한 provider 탐지 → 선택 → **실제 호출로 검증한 뒤 저장** [OC] → 웹 열기.

**fake provider**: 정해진 행동 시나리오를 재생 — 하네스·UI 테스트용.

## 13. 웹 UI

| 영역 | 내용 | 출처 |
|---|---|---|
| 스택 | Vite + React + shadcn/ui + Tailwind, 사무실은 PixiJS | [new] |
| 상태 | 게이트웨이가 진실, UI는 캐시. 이벤트로 증분 반영, 늦게 온 응답은 세대 번호로 무시 | [OC] |
| 사무실 | 픽셀 캐릭터 · 자리 · 회의실 · 내 자리, 이동·말풍선·타이핑 | [new] |
| 회의 모달 | 안건 · 선택지 · 추천 · 직접 입력 · 참석 캐릭터 발언 | [OC ask_user][MF] |
| 칸반 | 요청 · 요구사항 회의 · 팀 논의 · 팀 리뷰 · 결과 컨펌 · 완료 (+막힘 표시) | [OC][H] |
| 문서 | 기획서 · 흐름도 · 와이어프레임 · 클릭 이동 (core 렌더) | [new] |
| 타임라인 | 카드 이벤트 + 대화, 한글 검색 | [OC][H] |
| 캐릭터 패널 | 역할 · 성격 · 지금 하는 일 · 최근 대화 · 기억 · 배운 것 | [H journey] |
| 컨펌 | 결과물 diff · 섹션별 승인/반려 · 학습 제안 카드 | [H] |

**캐릭터 연출 = 상태의 순수 함수** [OC 펫·마스코트]
```
agent.state  idle → 자리에서 두리번 / thinking → 머리 위 … / typing → 키보드
             walking → 목적지로 이동 / talking → 말풍선 / resting → 커피·스트레칭
결과 이벤트  카드 done → 환호 / 반려 → 시무룩 / 린트 실패 → 머리 긁기
```
- 말풍선은 `agent.say` 한 줄(60자) [OC narration]. 외형은 `IDENTITY.md`의 색·소품.

## 14. 비용

- 체크리스트가 비면 호출 0 [OC].
- 모델 3단: chatter(잡담·진행 보고) / writer(작성·논의) / reviewer(검토, 다른 provider).
- 학습 리뷰는 이벤트 때만 [H].
- 하루 예산 초과 → 팀 휴식 + 알림, `budget.update` 이벤트.
- 사용량은 `usage` 테이블, 웹 상단에 오늘 사용량.

## 15. 레포 구조 (pnpm 워크스페이스)

```
packages/
  core/        기획서 모델 · md 파서/직렬화 · 플로우·와이어 문법 · 린트 · HTML 렌더    (의존성 0)
  protocol/    zod 스키마: RPC 메서드 · 이벤트 · 서버 요청 · Action                     (서버·웹 공유)
  harness/     상태 머신 · 게이트 · 재시도 · 백업 · 행동 검증
  board/       카드 · claim · dispatch · 이벤트
  team/        역할 정의 · 프롬프트 3층 조립 · 캐릭터 루프 · 회의 · 논의 규칙
  learning/    리뷰 · 제안 · 기억 상한 관리 · curator
  providers/   claude(Agent SDK) · codex(exec) · fake
  gateway/     데몬 · HTTP/WS · stdio · scheduler · store(node:sqlite) · 락
  cli/         planbot 명령
  web/         React + shadcn + PixiJS
assets/agents/<역할>/   기본 IDENTITY · SOUL · ROLE · skills
assets/sprites/         픽셀 에셋
examples/               예시 기획 (골든 테스트)
```

기존 플러그인 레포의 `src/`, `scripts/`, `skills/`는 v1에서 제거한다. Claude Code 플러그인은 남긴다면 `planbot open`만 부르는 런처 하나.

## 16. 테스트

- core: md ↔ 모델 왕복, 린트 규칙별 통과·실패, HTML 골든.
- harness·board: fake provider로 할 일 → 회의 → 논의 → 재회의 → 컨펌 → 완료 전체 시나리오, claim 만료, 3회 실패 → 재회의.
- team: 역할별 허용 행동, 왕복 4회 → PM 개입.
- learning: 반려 → 제안 → 승인 → 다음 세션 프롬프트에 반영, 상한 초과 → 오류.
- protocol: 재접속 `events.since`, 열린 서버 요청 재표시, 늦은 응답 무시.
- providers: 격리 확인(내 `~/.claude` 플러그인이 세션에 안 보이는지), 출력 고정본 파싱.

## 17. 만드는 순서

| 단계 | 결과 | 확인 방법 |
|---|---|---|
| 0 | provider 격리 실험 | 내 플러그인이 안 섞인 Claude·Codex 호출 1회씩 |
| 1 | core | 예시 doc.md → doc.html (흐름도·와이어·클릭 이동) |
| 2 | protocol + gateway 뼈대 + CLI | `planbot start/status`, WS 접속, 이벤트 replay |
| 3 | harness + board + fake 팀 | 터미널에서 할 일 → 회의 → 컨펌까지 시나리오 통과 |
| 4 | 웹 (사무실 없이) | 회의 모달 · 칸반 · 문서 · 컨펌을 브라우저에서 |
| 5 | 실제 provider 팀 | 진짜 캐릭터들이 기획서 완성 |
| 6 | 사무실 연출 | 픽셀 캐릭터 · 이동 · 말풍선 · 회의실 |
| 7 | 학습 | 반려 → 배운 것 제안 → 승인 → 다음 기획에 반영 |
| 8 | 마무리 | 예산 · curator · 외부 회의록 · doctor · README · v1.0.0 |

4단계까지 캐릭터 연출 없이도 쓸 수 있고, 6단계에서 "사람처럼 움직이는 팀", 7단계에서 "기억하고 배우는 팀"이 완성된다.

## 18. 가져오지 않는 것

| 출처 | 항목 |
|---|---|
| OpenClaw | 메신저 채널 · 기기 페어링 · node/worker 역할 · 멀티 사용자 · Tailscale · Docker 샌드박스 · exec 승인 · 플러그인 마켓 · Claw 패키지 · 화상회의 봇 · 에이전트별 DB · Lit SPA |
| Hermes | 메신저 어댑터 20종 · 7종 터미널 백엔드 · Electron · PTY 임베드 · ACP · 학습 데이터 생성 · 공격적 스킬 생성 · 일회성 위임 모델(팀원용) · Honcho 서버 · 상시 프로세스 2개 구조 |
| manyfast | 기능 3계층·9슬롯 · 고해상도 와이어프레임 · 협업·공유 링크 · 크레딧 |
