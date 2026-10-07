# Hermes Agent 스펙 (공식 문서 + 소스 분석)

- 대상: github.com/NousResearch/hermes-agent `d02f2118` (2026-10-07), MIT
- 방법: 공식 문서(hermes-agent.nousresearch.com/docs, 레포 `website/docs`) + 소스 코드 직접 확인. 경로는 레포 루트 기준. 확인 못 한 것은 [추정].
- 주의: README와 코드가 다른 곳이 있다(예: 세션 검색의 LLM 요약은 현재 코드에 없음, 반복 한도 수치). **코드를 기준**으로 적었다.
- 같이 보기: [../openclaw/spec.md](../openclaw/spec.md)

## 1. 한 줄 정의

경험에서 스킬을 만들고, 쓰면서 고치고, 기억을 스스로 정리하며, 세션이 쌓일수록 사용자를 더 깊이 아는 **자기 개선형 개인 AI 에이전트**. 터미널·메신저·데스크톱·웹 어디서든 같은 에이전트 코어로 돈다.

## 2. 규모와 스택

| 항목 | 값 |
|---|---|
| 추적 파일 | 약 17,800개 |
| 백엔드 | Python 3.14 (uv로 관리), 동기식 `AIAgent` |
| TUI | React 19 + Ink(포크) + nanostores (Node) |
| 웹 대시보드 | Vite 8 + React 19 + react-router + Tailwind 4 + xterm.js |
| 데스크톱 | Electron 40 + React 19 + TanStack Query + Tailwind 4 |
| 도구 / 툴셋 | 70개 이상 / 28개 |
| 터미널 백엔드 | local · docker · ssh · singularity · modal · daytona · vercel_sandbox |
| 메신저 어댑터 | 약 20개 (Telegram · Discord · Slack · WhatsApp · Signal · Email · Teams · Matrix …) |

## 3. 구성 요소

```
hermes (python 진입점 → hermes_cli.main)
├ AIAgent 코어            run_agent.py(얇은 facade) → agent/conversation_loop.py + agent/turn_*.py
│                          모든 진입점이 같은 프로세스 안에서 이 코어를 만든다 (에이전트 전용 데몬 없음)
├ 상시 프로세스 1: 메신저 게이트웨이   hermes gateway run|start (gateway/run.py)
│     어댑터 약 20개 · cron 스케줄러 · kanban dispatcher · 선택적 OpenAI 호환 API(8642)
├ 상시 프로세스 2: UI 백엔드           hermes serve / hermes dashboard (FastAPI, 127.0.0.1:9119)
│     REST + /api/ws(JSON-RPC) + /api/pty(TUI 중계)
├ 클라이언트
│   ├ 클래식 CLI   prompt_toolkit REPL, AIAgent 직접 호출
│   ├ TUI          Node/Ink ↔ python tui_gateway, stdio 위 JSON-RPC
│   ├ 데스크톱     Electron이 자기 전용 `hermes serve --port 0`을 띄우고 /api/ws로 접속
│   └ 웹 대시보드  /chat은 진짜 TUI를 xterm.js로 PTY 임베드 (React로 채팅 재구현 금지 규칙)
├ ACP 서버 / MCP 서버  둘 다 stdio JSON-RPC (에디터·Claude Code 등에 붙음)
└ 저장소              ~/.hermes/state.db · kanban.db (SQLite WAL, 여러 프로세스가 동시 사용)
```

- **핵심 아이디어**: TUI·데스크톱·대시보드가 결국 같은 백엔드(`tui_gateway.server.dispatch`)를 쓰고 **전송만 다르다**(stdio / WS / PTY).
- OpenClaw와 달리 상시 프로세스가 둘(메신저 게이트웨이, UI 백엔드)로 나뉘고, 같은 SQLite를 공유한다.

**단일 인스턴스**
- 게이트웨이: 프로필별 `gateway.pid`, `gateway.lock`, `gateway_state.json`.
- 생존 확인 1순위: 제어 소켓 `gateway.sock`(Windows는 named pipe). 한 줄 JSON `identify`/`status`에 한 줄로 답한다. TCP 금지.
- `serve` 포트 충돌 시 `BACKEND_PORT_IN_USE port=` 표식을 찍고 종료. `--port 0`이면 임의 포트.
- SQLite 동시 쓰기: WAL + `BEGIN IMMEDIATE` + 지터 재시도.

## 4. 프로토콜 (UI ↔ 백엔드)

- **표준 JSON-RPC 2.0**, 줄 단위. 양방향이며 메시지는 세 종류다.
  - 클라이언트 → 서버 메서드: `prompt.submit`, `session.list/resume`, `slash.exec`, `complete.slash`, `subagent.list/steer/interrupt` …
  - **서버 → 클라이언트 요청**: `approval`, `clarify`, `sudo`, `secret`. id는 `srq-<n>`. 응답이 올 때까지 에이전트 스레드가 멈춰 기다린다. 재접속하면 `open_requests`로 다시 띄운다.
  - 서버 → 클라이언트 이벤트: `method:"event"` 알림.
- 이벤트에는 세션별로 단조 증가하는 `seq`가 붙고 replay 버퍼에 쌓인다. 재접속 시 `session.events.since`로 빠진 것만 받는다.
- 계약 단일 소스: Pydantic(`tui_gateway/contracts/*.py`, extra 금지) → TS 타입 + OpenRPC 문서 자동 생성(`scripts/gen_gateway_contracts.py`).

```json
{"jsonrpc":"2.0","id":3,"method":"prompt.submit","params":{"session_id":"s1","text":"..."}}
{"jsonrpc":"2.0","method":"event","params":{"type":"tool.start","session_id":"s1","seq":42,
 "payload":{"tool_id":"t7","name":"terminal","args":{"cmd":"ls"},"preview":"ls"}}}
```

- 주요 이벤트: `gateway.ready`, `message.start`, `message.delta`, `reasoning.delta`, `tool.generating` → `tool.start` → `tool.complete{duration_s, summary, inline_diff, todos}`, `todo.updated`, `status.update`, `session.usage`, `message.complete`, `notification.show`, `session.title`.

## 5. CLI와 온보딩

- 전역 옵션 `-p/--profile`. 프로필을 만들면 그 이름의 명령이 생긴다(예: `coder chat`).
- 명령 묶음
  - 대화·모델: `chat`(`-z` 한 번 실행, `--format stream-json`), `model`, `moa`(여러 모델 혼합), `fallback`
  - 게이트웨이: `gateway run|start|stop|restart|status|install|setup`
  - 작업: `cron`, `kanban`, `project`, `webhook`, `hooks`, `pause|resume`
  - 진단: `status`, `doctor`, `logs`, `usage`, `debug`, `backup|import`, `checkpoints`, `prompt-size`
  - 확장: `config`, `skills`, `bundles`, `curator`, `memory`, `plugins`, `tools`, `mcp`, `acp`, `skin`
  - 세션·분석: `sessions`, `insights`, `journey`(배운 것 타임라인)
  - 서버·앱: `serve`, `dashboard`, `desktop`
  - 이전: `claw`(OpenClaw에서 옮겨 오기), `import-agent`(`~/.claude`, `~/.codex` 가져오기)
- `hermes setup` 순서: model → tts → terminal 백엔드 → gateway(메신저) → tools(플랫폼별 on/off) → agent(최대 턴 등). 섹션 하나만(`setup <section>`), 빈 항목만(`--quick`), 비대화식(`--non-interactive`) 실행 가능. TUI와 데스크톱은 같은 온보딩을 RPC로 처리.
- 모델 고르기: 왼쪽엔 **자격 증명이 있는 provider만**, 오른쪽엔 그 provider의 **선별된 에이전트용 모델 목록**. 고르면 `config.yaml`에 기록, 진행 중 세션은 `/model`로 바로 바꿈.

## 6. 설정과 상태

```
~/.hermes/                      (= HERMES_HOME, 기본 프로필)
  config.yaml                   동작 설정 (버전 50)
  .env                          비밀값만 (동작 설정은 반드시 yaml)
  auth.json                     OAuth 자격 증명
  SOUL.md                       에이전트 정체성 (시스템 프롬프트 1번 자리)
  memories/MEMORY.md · USER.md  에이전트가 직접 관리하는 기억
  skills/ · plugins/ · cron/ · sessions/ · checkpoints/ · logs/{agent,gateway,errors}.log
  state.db                      세션·메시지·전문 검색
  kanban.db                     프로필 사이 공유 작업판
  gateway.{pid,lock,sock} · gateway_state.json
  profiles/<이름>/              프로필마다 위와 같은 구조의 완전히 독립된 홈
```
- 경로는 반드시 `get_hermes_home()`으로 얻는다(우선순위: 코드 내 override → `HERMES_HOME` → 기본값). `~/.hermes` 하드코딩은 린트 규칙 위반.
- 프로젝트 지침 파일은 하나만 읽는다: `.hermes.md` > `AGENTS.md` > `CLAUDE.md` > `.cursorrules`. `SOUL.md`는 항상 따로 읽는다.
- **두 프로세스가 같은 프로필을 쓰면 기억이 섞인다** → 공유가 필요하면 외부 메모리 provider.

**state.db** (스키마 버전 31)
- `sessions`: id, source(cli/telegram…), model, system_prompt, parent_session_id(압축 계보), 토큰·비용, title, profile_name, archived, pinned …
- `messages`: session_id, role, content, tool_calls(JSON), tool_name, timestamp, reasoning …
- 전문 검색: `messages_fts`, `messages_fts_trigram`, `messages_fts_cjk`(**한국어 1~2글자 검색 대응**, `native/fts5_cjk`)
- 그 밖: `session_model_usage`, `compression_locks`, `async_delegations`, `delivery_obligations`(발송 대기함)

**kanban.db**
- `tasks`(assignee, status, claim_lock/claim_expires, workspace_path, branch_name, consecutive_failures, worker_pid), `task_links`, `task_comments`, `task_events`, `task_runs`, `task_attachments`
- 상태: triage → todo → scheduled → ready → running → blocked → review → done (+archived)

## 7. 에이전트 코어

**한 턴** (`run_conversation()`)
1. user 메시지 추가
2. 시스템 프롬프트를 캐시에서 쓰거나 새로 조립
3. 컨텍스트가 50%를 넘으면 미리 압축
4. provider 형식으로 변환 (chat_completions / codex_responses / anthropic_messages)
5. 일회성 안내 주입(예산 경고, 컨텍스트 압박) + 캐시 표시
6. 모델 호출(백그라운드 스레드, 메인은 응답·중단·시간 초과를 기다림)
7. 도구 호출이 있으면 실행 후 4로, 텍스트면 세션 저장 + 기억 flush

- 도구 여러 개는 스레드 풀로 **병렬 실행**, 사용자에게 묻는 `clarify` 같은 도구만 순차.
- `todo`, `memory`, `session_search`, `delegate_task`는 레지스트리보다 먼저 가로채 에이전트 상태를 직접 바꾼다.
- 반복 한도: 메인은 설정값(기본 없음), 하위 에이전트 250. 한도에 닿으면 도구 없이 마지막 요약.
- 바쁠 때 새 입력: `interrupt`(기본, 진행 중 턴을 새 입력으로 전환) · `steer`(다음 도구 호출 뒤 끼워 넣기) · `queue`. `/btw`로 곁가지 질문.

**컨텍스트 압축** (에이전트 50%, 게이트웨이 85%)
1. 오래된 도구 출력을 "지워짐" 표시로 교체(모델 호출 없음)
2. 앞부분 보호 + 뒤쪽은 토큰 예산으로 보호, 도구 호출·결과 쌍은 자르지 않음
3. 보조 모델이 구조화 요약: **Goal / Constraints & Preferences / Progress(Done·In Progress·Blocked) / Key Decisions / Relevant Files / Next Steps / Critical Context**
4. 재조립하고 자식 세션 계보를 만든다. 압축 직전 기억 flush.

**시스템 프롬프트 3층**
| 층 | 내용 |
|---|---|
| stable | `SOUL.md`(없으면 기본 정체성), 도구·모델 안내, 플랫폼 힌트 |
| context | 프로젝트 지침 파일 하나, git 상태 |
| volatile | 스킬 목록, `MEMORY.md`·`USER.md` 스냅샷, 외부 기억 블록, 시각·세션·모델 정보 |

- **고정 스냅샷**: 세션 중에 기억을 써도 디스크만 바뀌고 프롬프트는 그대로다(캐시 보존). 다음 세션이나 압축 때 반영.
- 크기 상한: `MEMORY.md` 2,200자, `USER.md` 1,375자, 지침 파일은 모델 창에 비례(최소 20k자), 스킬 설명은 목록에서 60자로 자름.
- 주입 전에 인젝션·유출 패턴을 보안 검사.

## 8. 기억과 학습 루프 (Hermes의 차별점)

**기억 두 층**
- **항상 넣는 기억**: `MEMORY.md`(환경·관례·교훈), `USER.md`(사용자 성향·취향). 항목은 `§`로 구분. 헤더에 `[67% — 1,474/2,200 chars]` 같은 사용률을 보여 줘서 에이전트가 용량을 스스로 관리한다.
  - 도구: 추가 / 교체 / 삭제만(읽기는 이미 주입돼 있어 없음). 넘치면 자동 압축하지 않고 **오류를 돌려줘 에이전트가 스스로 정리**하게 한다.
- **찾아보는 기억**: 과거 세션 전체 전문 검색(약 20ms, 모델 호출 없음). "사용자에게 다시 묻기 전에 먼저 검색하라"는 지침이 프롬프트에 있다.

**스스로 기억을 남기게 하는 장치 (nudge)**
- 프롬프트 안내가 아니라 **백그라운드 리뷰**다.
  - 기억 카운터: 사용자 턴 10번마다 발동.
  - 스킬 카운터: 도구 반복 10번 이상이면 발동.
  - 에이전트가 직접 기억·스킬을 쓰면 카운터는 0으로.
- 발동하면 응답을 보낸 **뒤에** 같은 모델로 대화 스냅샷을 재생하는 분신(fork)을 띄워, 허용된 도구로만 "무엇을 배웠나"를 정리한다(1회 약 30K 토큰 → 예약 작업에서는 끔).
- 규칙: 한 사실은 한 곳에만 저장(기억이든 스킬이든 하나).
- 사용자 통제: 쓰기 전 승인(`write_approval` → `/memory pending|approve|reject`), "기억 갱신됨" 알림, `/journey`에서 배운 것 타임라인 보고 수정·삭제.

**스킬 학습**
- 만드는 경로: (a) 작업 중 에이전트가 직접 (b) 백그라운드 리뷰 (c) `/learn`(코드·URL·방금 한 일·노트를 스킬로)
- 리뷰 신호: 사용자의 스타일·형식 교정이나 불만, 작업 방식 교정, 새로 찾은 기법, 틀린 것으로 드러난 스킬.
- 우선순위: 이번에 쓴 스킬 고치기 → 기존 큰 스킬 고치기 → 참고 파일 추가 → 마지막에야 새 스킬. 고치기 전에 반드시 읽기.
- 저장 금지: 환경 탓 실패, "X 도구가 안 된다" 같은 부정 주장, 일회성 작업 이야기, 해결 안 된 실패를 권장법처럼 포장.
- **"기록이 아니라 교훈"**: 날짜·번호 대신 일반화된 규칙 + 이유 한 구절.
- `SKILL.md`(agentskills.io 호환): frontmatter `name`(≤64자), `description`(≤60자), `version`, `tags`, `requires_toolsets` / 본문 When to Use · Procedure · Pitfalls · Verification.
- 단계적 공개: 목록(약 3k 토큰) → 본문 → 참고 파일.
- Curator: 7일마다 유휴 시 정리. 14일 미사용 → 오래됨, 30일 → 보관(삭제 안 함), 고정 스킬은 제외.

**사용자 모델링 (Honcho, 플러그인)**
- 저장: 메시지, 사용자 표상, 사실 카드, AI 자기 표상, 서버 추론으로 얻은 결론, 세션 요약.
- 매 턴 두 층 주입: 기본 맥락 + 변증법 보충("지금 이 사용자에게 중요한 것"을 모델이 합성). 처음엔 "이 사람은 누구인가", 세션 중엔 "이번에 중요한 것"을 묻는다. 깊이 1~3패스(자기 점검 → 모순 조정).
- 에이전트별로 사용자를 따로 볼 수 있다.

## 9. 위임과 협업

- `delegate_task(goal, context)` 또는 `tasks=[…]` 병렬(기본 10개). 핸들을 즉시 돌려주고 결과는 나중에 새 메시지로. `output_schema`로 JSON 결과 계약.
- **하위 에이전트는 완전히 격리**: 부모 대화를 모르고 goal·context만 받는다. `SOUL.md` 없음, 별도 터미널, 선택적 git worktree. 기억 쓰기·사용자 질문·메시지 발송·예약 금지. 부모에는 최종 요약만 돌아온다.
- `execute_code`: 에이전트가 쓴 Python이 `from hermes_tools import web_search…`로 도구를 부르고, 중간 결과는 컨텍스트에 안 들어간다(출력만). 실행당 도구 50회, 출력 50KB, 300초.
- **Kanban**: 프로필 사이에 공유하는 영속 작업판. 워커마다 독립 프로세스와 정체성. 도구 `kanban_show/complete/block/heartbeat/comment/request_review`. 1시간마다 생존 신호, 4시간 없으면 회수. 공식 사용 사례로 **"기억이 쌓이는 이름 있는 디지털 트윈"**을 든다.
- 봇 전용 프로필로 그룹 채팅에서 여러 봇이 "팀"을 이룬다.

## 10. 예약 작업 (cron)

- 형식: `30m`(한 번), `every 2h`, cron식, ISO 시각. 자연어는 모델이 이 형식으로 바꿔 등록 [추정].
- 60초마다 tick → 할 때가 된 작업마다 **대화 이력 없는 새 세션**. 회차당 최대 한 번, 놓친 회차는 따라잡음.
- 작업마다 스킬 미리 로드, 모델 고정 가능. 실행 전 설정 검사로 막힌 작업은 모델 호출 안 함.
- 결과 전달 대상: 원래 대화 / 로컬 파일 / 메신저. 응답에 `[SILENT]`면 전달 생략(실패는 항상 전달).
- 작업별 메모장(SQLite, 값 16KB, 작업당 64KB)을 매번 주입해 진행 위치를 이어 간다.
- **OpenClaw식 heartbeat(주기적 자율 기상)는 없다.**

## 11. UI

- TUI 주요 부품: 스트리밍 마크다운, 생각 중 표시, 승인·질문 프롬프트, 하위 에이전트 패널, 모델 선택, 스킬·플러그인 허브, 목표 바, 대기 메시지.
- 웹 대시보드 화면: Chat(TUI 임베드), Sessions, Config, Env, Models, Skills, Plugins, Mcp, Cron, Channels, Profiles, ProfileBuilder, Logs, Analytics, Files, Webhooks, System, Docs.
- 데스크톱 화면: chat, session, agents, command-center, cron, profiles, messaging, settings, artifacts, hud, starmap, webhooks.
- 실시간 표시: 글자 단위 스트리밍, 도구 카드(인자 생성 중 → 시작 → 완료 + 요약·소요 시간·diff), 할 일 체크리스트, 상태 줄, 하위 에이전트 목록. 승인은 서버가 요청해서 모달로.

## 12. 플러그인 · MCP · ACP

- 플러그인: `plugin.yaml` + `register(ctx)` Python 패키지. 도구·훅·슬래시 명령·CLI 명령·기억/모델 provider·메신저 어댑터를 등록. 탐색 순서는 번들 → 사용자 → 프로젝트(허용 시) → pip. 서드파티는 허용 목록에 넣어야 켜짐.
- MCP: 클라이언트(설정의 서버 도구를 가져옴)이자 서버(`hermes mcp serve`로 메신저 대화를 MCP 도구로 노출). 무거운 서버는 유휴 시간·최대 수명으로 재시작.
- ACP: Zed·VS Code·JetBrains 안에서 Hermes를 띄우는 stdio 서버.

## 13. OpenClaw와 비교

| 항목 | OpenClaw | Hermes |
|---|---|---|
| 언어 | TypeScript | Python (UI는 React/Ink) |
| 상시 프로세스 | 게이트웨이 하나가 전부 | 메신저 게이트웨이 + UI 백엔드 둘, DB 공유 |
| 프로토콜 | 자체 req/res/event 프레임 | 표준 JSON-RPC 2.0, stdio·WS 공용 |
| 사람 확인 | 승인 이벤트 + `ask_user` 도구 | **서버 → 클라이언트 요청**(답할 때까지 대기, 재접속 시 다시 표시) |
| 재접속 | seq 공백이면 스냅샷 다시 받기 | seq 이후 이벤트만 replay |
| 에이전트 파일 | AGENTS · SOUL · IDENTITY · USER · MEMORY | SOUL · MEMORY · USER + 프로젝트 지침 하나 |
| 스스로 깨어남 | **heartbeat** (체크리스트 비면 모델 호출 0) | 없음 (cron · kanban dispatcher · curator) |
| 스스로 배움 | 없음 | **카운터 → 백그라운드 리뷰 → 기억·스킬 자가 수정 → 승인 게이트** |
| 칸반 | Workboard (플러그인) | kanban.db (프로필 간 공유, 회로 차단기까지) |
| 팀 | coordinator + 전문가, `sessions_send`로 대화 | 봇 프로필 + 그룹 채팅, kanban 코멘트 |
| 하위 에이전트 | `sessions_spawn`, 깊이 5 | `delegate_task`, 완전 격리, 기억 쓰기 금지 |
| 한글 검색 | 없음 | CJK 전문 검색 색인 |
| 관계 | — | OpenClaw 이전 가이드·명령(`hermes claw`) 제공 |

## 14. planbot으로 가져갈 것 / 버릴 것

| Hermes | planbot에서 |
|---|---|
| 백엔드 하나 + 얇은 클라이언트, stdio·WS가 같은 dispatch 공유 | **그대로** (TS 데몬, CLI와 웹이 같은 dispatch) |
| JSON-RPC 2.0 + seq replay(`events.since`) | **그대로** — 새로고침해도 회의가 이어진다 |
| 서버 → 클라이언트 요청 (`approval`, `clarify`) | **회의 요청·결과 컨펌**을 이 방식으로 |
| 계약 단일 소스 → 타입 자동 생성 | zod 하나로 서버·웹 공유 |
| `.env`(비밀) vs `config.yaml`(동작) 분리, `get_home()` 강제, `--profile` | **그대로** |
| SQLite WAL + FTS5 CJK | 한글 회의록·결정 검색 |
| kanban 테이블(tasks · events · comments · runs, claim, review) | 칸반 저장 구조 |
| 캐릭터별 `MEMORY.md` + `USER.md`, 글자 상한 + 사용률 헤더, 넘치면 스스로 정리 | 캐릭터 기억 |
| 고정 스냅샷 (세션 중 프롬프트 불변) | 회의 하나 = 세션 하나 |
| 백그라운드 리뷰 → 기억·스킬 수정, **신호 = 사용자의 교정·반려** | 컨펌·반려 뒤 "무엇을 배웠나" 정리 (매 턴 아님, 이벤트 때만) |
| `write_approval` + `/journey` | "다음부터 이렇게 기억할까요?" 컨펌 카드 + 배운 것 타임라인 |
| "기록이 아니라 교훈", 저장 금지 목록 | 반려 패턴을 기획 스킬의 Pitfalls로 증류 |
| 압축 요약 템플릿 (Goal / Decisions / Blocked / Next Steps) | 회의·논의 인계 형식 |
| Curator (미사용 스킬 보관) | 그대로, 작게 |
| 메신저 어댑터 · 7종 터미널 백엔드 · Electron · PTY 임베드 · ACP · 학습 데이터 생성 | **버림** |
| 공격적 스킬 생성("Be ACTIVE") | **버림** — 기획 스킬은 1~3개로 고정하고 고치기만 |
| 위임 모델(일회성, 격리된 하위 에이전트) | **팀원에겐 안 씀** — 서로 논의하는 캐릭터는 영속 정체성 + 공유 보드 + 코멘트 |

**결론**: 스스로 깨어나는 건 OpenClaw의 heartbeat, 스스로 배우고 기억하는 건 Hermes의 리뷰 루프에서 가져온다. 골격은 OpenClaw(TS 데몬 하나), 통신은 Hermes(JSON-RPC + 서버 요청 + replay)가 가장 단순하다.
