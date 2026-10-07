# OpenClaw 스펙 (소스 분석)

- 대상: github.com/openclaw/openclaw `ccadf6ac` (2026-10-07), 패키지 버전 2026.9.8, MIT
- 방법: 공식 문서 + 소스 코드 직접 확인. 경로는 레포 루트 기준. 확인 못 한 것은 [추정].
- 범위 밖: provider·인증 구현 코드는 분석하지 못함(권한 판단기 거부) → 8장은 문서 수준.

## 1. 한 줄 정의

내 컴퓨터에서 상시 도는 **게이트웨이 데몬 하나**가 에이전트·세션·채널·도구를 소유하고, CLI·웹·앱이 모두 같은 WebSocket 클라이언트로 붙는 **개인/팀 AI 비서 플랫폼**.

## 2. 규모

| 항목 | 값 |
|---|---|
| 추적 파일 | 약 52,800개 (TypeScript 모노레포, pnpm) |
| 큰 디렉터리 | `src/agents` 4,742 · `src/gateway` 4,322 · `src/infra` 2,574 · `src/config` 1,469 · `src/plugins` 1,444 |
| 확장(extensions) | 175개 (provider·채널·workboard·lobster 등) |
| 번들 스킬 | 약 50개 |
| 코어 RPC 메서드 | 492개 |
| SQLite 테이블 | 전역 약 150개 + 에이전트별 DB |
| 앱 | macOS · iOS · Android · Linux |

## 3. 구성 요소

```
openclaw (bin: openclaw.mjs)
├ CLI                 약 70개 최상위 명령 (src/cli, src/commands)
├ Gateway 데몬        WS+HTTP 한 포트 127.0.0.1:18789 (src/gateway/server.ts)
│  ├ 에이전트 런타임   턴 루프 · 큐 lane · compaction (packages/agent-core, src/agents)
│  ├ Scheduler        cron · heartbeat (src/cron)
│  ├ 플러그인 호스트   extensions/* (provider · 채널 · workboard · lobster …)
│  └ Store            node:sqlite, WAL (src/state)
├ Control UI          Vite + Lit SPA, 같은 포트에서 서빙 (ui/)
├ SDK                 @openclaw/gateway-protocol · gateway-client(공개) · sdk(private)
└ 앱                  apps/* (WS 클라이언트 또는 node 역할)
```

**프로세스·수명주기**
- 실행: `openclaw gateway run`(포그라운드) / `gateway install|start|stop|restart|status`(서비스).
- 서비스: macOS launchd `ai.openclaw.gateway`(RunAtLoad·KeepAlive), Linux systemd user unit, Windows 작업 스케줄러.
- 단일 인스턴스: 상태 폴더 락 파일(PID, 죽은 프로세스 회수) + 메타 락 + 포트 배타 바인드(500ms × 20회 재시도).
- `restart --safe`: 진행 중 작업을 최대 5분 기다린 뒤 재시작.
- HTTP: `/healthz`, `/readyz`, `/__openclaw__/*`, 선택적 OpenAI 호환 API.

## 4. 프로토콜

**프레임 3종** (`packages/gateway-protocol/src/schema/frames.ts`, TypeBox → JSON Schema, 버전 4)
```ts
{ type:"req",   id, method, params? }
{ type:"res",   id, ok, payload? | error{code,message,retryable?,retryAfterMs?} }
{ type:"event", event, payload?, seq?, stateVersion? }
```

**연결 순서**: 서버 `connect.challenge{nonce}` → 클라이언트 `req connect{protocol 범위, client, role, scopes, auth, device}` → 서버 `hello-ok{정책, 메서드 목록, 스냅샷}`.

**역할과 권한**
- 역할: `operator`(CLI·UI), `node`(카메라·화면 같은 기능 제공 기기), `worker`(클라우드).
- 스코프: `operator.read|write|admin|approvals|questions|pairing|talk`.
- 인증: `none|token|password|trusted-proxy`, loopback은 자동 승인.

**메서드 묶음 (492개 중 핵심)**
| 묶음 | 예 |
|---|---|
| 대화 | `chat.send/history/abort`, `agent`, `agent.wait` |
| 세션 (62) | `sessions.create/list/subscribe/fork/rewind` |
| 에이전트 | `agents.list/create/update/files.get|set` |
| 설정·마법사 | `config.get/patch/schema`, `wizard.start/next` |
| 모델·도구 | `models.authLogin/authSetApiKey/probe`, `tools.*`, `skills.*`, `mcp.*` |
| 승인·질문 | `exec.approval.*`, `approval.*`, `question.request/resolve` |
| 자동화·기억 | `cron.*`, `transcripts.*`, `memory.search/get` |
| 칸반 | `workboard.cards.*`, `workboard.boards.*` |

**이벤트**: `agent`, `chat`, `session.message`, `session.tool`, `session.narration`(최근 발화 요약), `session.observer`(헤드라인), `sessions.changed`, `presence`, `tick`, `heartbeat`, `cron`, `exec.approval.requested`, `question.requested`, `plugin.workboard.changed`, `shutdown`.
- 이벤트는 다시 보내 주지 않는다. `seq`가 비면 클라이언트가 재연결해 스냅샷을 다시 받는다.

**SDK** (`packages/sdk`, private)
```ts
const oc = new OpenClaw({ gateway: "auto", token })
await oc.connect()
const run = await oc.agents.get("main").run("...")   // → Run
for await (const e of run.events()) { … }; await run.wait()
// 네임스페이스: agents · sessions · runs · models · tools · artifacts · approvals · environments
```

## 5. CLI와 온보딩

- 전역 플래그: `--profile <이름>`(→ `~/.openclaw-<이름>`), `--dev`(→ `~/.openclaw-dev`, 포트 19001).
- 주요 명령: `onboard`, `setup`, `config`, `doctor`, `dashboard`, `gateway`, `status`, `logs`, `agent`, `agents`, `sessions`, `chat`/`tui`, `models`, `skills`, `plugins`, `cron`, `approvals`, `memory`, `backup`, `gateway call <method>`(임의 RPC).
- `onboard` 순서 (`src/wizard/setup.ts`):
  1. 보안 안내
  2. 첫 에이전트 이름
  3. 접근 권한 (전체 / 먼저 묻기)
  4. 쓸 수 있는 AI 탐지 (환경 변수 키, 로컬 CLI)
  5. provider 선택 → **실제 호출로 검증한 뒤 저장**
  6. Claude Code·Codex 메모리 가져오기 제안
  7. 워크스페이스·게이트웨이·세션 기본값
  8. 채널·스킬·플러그인 추천
  9. 웹 UI를 열고 일회성 관리자 권한 전달
- 같은 마법사를 RPC(`wizard.*`)로도 돌릴 수 있다.

## 6. 설정과 상태

```
~/.openclaw/
  openclaw.json                 설정 (JSON5, Zod strict 검증)
  .env · credentials/ · secrets/
  state/openclaw.sqlite         전역: cron · 승인 · 페어링 · 작업 실행 · 플러그인 상태 …
  agents/<id>/agent/openclaw-agent.sqlite   에이전트별: 세션 · transcript(FTS5) · 메모리 인덱스 · 인증 프로필 · 보드
  workspace/ (또는 workspace-<id>/)         사람이 보는 파일
  logs/ · tmp/openclaw-<uid>/(락)
```
- 설정 최상위 키: `agents`, `models`, `auth`, `tools`, `skills`, `plugins`, `session`, `cron`, `memory`, `approvals`, `gateway`, `channels`, `mcp`, `ui` …
- 스키마가 바뀌면 `doctor --fix`가 옛 설정을 백업하고 새 형식으로 옮긴다. 옛 키는 계속 받아 주지 않는다.

## 7. 에이전트

**정의** (`agents.defaults` + `agents.entries.<id>`)
- 키: `id, name, workspace, model, utilityModel, decisionModel, skills, subagents, heartbeat, identity, sandbox, tools, humanDelay, typingMode, bootstrapMaxChars …`
- 층 분리: **provider**(anthropic…) / **model** / **agent runtime**(`openclaw` 내장 · `codex` · `copilot` · `claude-cli`) / **channel**.
- 에이전트마다 워크스페이스, `agentDir`(인증·모델 레지스트리), 세션 DB를 따로 가진다.

**워크스페이스 파일** (매 세션 시스템 프롬프트에 주입)
| 파일 | 역할 |
|---|---|
| `AGENTS.md` | 운영 규칙, 상시 지시(standing orders), `## Tools` |
| `SOUL.md` | 인격·말투 |
| `IDENTITY.md` | 이름·이모지·분위기 |
| `USER.md` | 사용자 정보 (별도 4,000자) |
| `MEMORY.md` | 장기 기억 (있을 때만) |
| `memory/YYYY-MM-DD.md` | 일별 기억 — 주입하지 않고 도구로 검색 |
| `BOOTSTRAP.md` | 첫 실행 한 번 |
- 크기 상한: 파일당 20,000자, 합계 60,000자. 넘치면 자르고 "직접 읽어라"는 안내를 넣는다.

**한 턴** (`packages/agent-core/src/agent-loop.ts`)
1. `agent` RPC → `{runId}` 즉시 반환
2. 세션 lane(세션당 동시 1) → 전역 lane(`maxConcurrent`) 대기
3. 모델 스트림 → 도구 실행 → 끼어든 메시지(steer) 주입 → 반복
4. 이벤트: lifecycle / assistant / tool
5. 마무리: `NO_REPLY` 거르기, 빈 답이면 도구 없이 한 번 더
- 큐 모드: `steer`(기본) · `followup` · `collect` · `interrupt`, debounce 500ms.
- compaction: 컨텍스트가 차면 오래된 턴을 요약. 도구 호출·결과 쌍은 자르지 않음. 원본 기록은 디스크에 그대로.
- memory flush: compaction 직전에 "기억할 것 저장" 무음 턴(싼 모델 지정 가능).

**세션**
- 키: `agent:<agentId>:<나머지>` — 예 `agent:main:main`, `agent:ops:cron:<job>:run:<runId>`, `agent:main:subagent:<uuid>`.
- 저장: 에이전트별 SQLite. 기본은 같은 세션을 계속 이어 쓰고, `daily`·`idle` 리셋을 선택할 수 있다.

**스스로 깨어나기**
- heartbeat: 에이전트마다 시스템 소유 예약 작업, 기본 30분. 짧은 체크리스트가 비어 있으면 **모델을 부르지 않고 건너뜀**. 할 말이 없으면 `HEARTBEAT_OK`로 답하고 버림.
- 이벤트 깨우기: 최소 30초 간격, 60초에 5회 넘으면 차단.
- cron: 한 번·간격·cron식·웹훅. 에이전트가 `cron` 도구로 직접 예약할 수 있다.
- standing orders: `AGENTS.md`에 범위·트리거·에스컬레이션을 적어 상시 권한을 준다.

**멀티 에이전트·팀**
- `openclaw agents team create` → coordinator(비서실장) · researcher · writer · reviewer.
- 역할 원본: `docs/reference/templates/roles/<role>/CLAW.md` + `workspace/AGENTS.md`.
- coordinator 규칙: 사람의 단일 창구, 모든 결과는 coordinator를 거친다, 전문가끼리 주고받지 않는다, 넘길 때 산출물 경로·검증·불확실성을 단다, 외부 행동은 사람 승인.
- 에이전트 간 도구: `sessions_send`(다른 세션에 턴 실행, 즉시 반환 또는 대기), `sessions_spawn`(격리된 하위 에이전트), `sessions_yield`(자식 결과 대기), `agents_wait`.
- 한도: 하위 에이전트 깊이 5, 에이전트당 자식 5.
- **문서의 경고**: 위임 설정은 프롬프트 지침일 뿐 스케줄러가 아니다. 일을 실제로 굴리는 건 dispatch·heartbeat·cron 코드다.

**스킬·훅·도구**
- `SKILL.md`: YAML(name, description, requires…) + 본문. 우선순위는 워크스페이스 > 프로젝트 > 개인 > 관리형 > 번들.
- 주입: 이름·위치 목록만 넣고(최대 150개, 18,000자), 모델이 필요할 때 본문을 읽는다.
- 훅: `agent:bootstrap`, `session:compact:*`, `message:*`, `gateway:startup` / 플러그인 훅 `before_tool_call`(막기·승인 요청 가능), `agent_end` …
- 기본 도구: `read/write/edit/apply_patch`, `exec`, `ask_user`, `web_search/fetch`, `browser`, `sessions_*`, `cron`, `memory_*`, `progress_card`.
- 도구 정책: 프로필 → allow/deny → 에이전트·샌드박스 정책. 빠진 도구는 스키마조차 모델에 안 보낸다.
- 샌드박스: 기본 꺼짐, Docker·Podman·SSH 선택.

## 8. provider·인증 (문서 수준, 코드 미확인)

- 모델 참조는 `provider/model`로 고정하고, 구동 방식은 `agentRuntime.id`로 따로 고른다(`openclaw` 내장 API 루프 / `claude-cli` / `codex` / `copilot`).
- API 키와 OAuth를 모두 지원하고, OpenAI Codex는 ChatGPT OAuth를 쓴다.
- 온보딩에서 로컬 CLI를 탐지해 후보로 제시한다.
- 사용자 `~/.claude`와 어떻게 격리하는지는 문서에 없음 [추정 불가].

## 9. Workboard (칸반 플러그인)

- 위치: `extensions/workboard`, 계약 `packages/workboard-contract`(의존성 0).
- 카드: `id, title, notes, status, priority, labels, agentId, sessionKey, runId, execution{mode: autonomous|manual}, position, events[], metadata{attempts, comments, links(parent/child/blocks), proof, artifacts, claim}`.
- 상태: `triage → backlog → todo → scheduled → ready → running → review → blocked → done`.
- 에이전트 도구: `workboard_claim`(잠금) · `heartbeat` · `complete` · `block` · `specify`(대충 쓴 카드 → 명확한 할 일) · `decompose`(하위 카드로 분해) · `link`(선행 완료 시 자동 ready) · `move` · `comment` · `proof`.
- dispatcher 한 번: 의존 풀린 카드 승격 → 만료 claim 막힘 처리 → ready 카드 최대 3장을 하위 에이전트로 실행(에이전트당 1장).
- **done은 사람이 옮긴다** → 사실상 컨펌 게이트.
- 이벤트 24종(created, moved, claimed, heartbeat, decomposed, proof_added …) → 타임라인.
- 세션 보드: 카드 없이 세션 상태로 자동 배치(입력 필요 · 막힘 · 작업 중 · 리뷰 · 완료).

## 10. 사람 확인 (Human-in-the-loop)

| 장치 | 동작 |
|---|---|
| `ask_user` 도구 | 질문 1~3개를 구조화해 묻고 기다림. 웹에서는 입력창 위 패널로 뜸 |
| exec 승인 | 명령 실행 정책 `deny|allowlist|ask|auto|full`, 응답 `allow-once|allow-always|deny`, 시간 초과 시 거부 |
| 플러그인 승인 | `before_tool_call`에서 `requireApproval{title, severity, timeoutMs}` 반환 |
| Lobster 워크플로 | YAML 단계 파이프라인. `approval: required` 지점에서 `needs_approval`/`needs_input` + `resumeToken`으로 멈췄다가 `resume`으로 재개 |
| Workboard | done 열은 사람만 |

## 11. 웹 UI (Control UI)

- 스택: Vite 8 + Lit 3, 컴포넌트 `@awesome.me/webawesome`, 자체 라우터. React 없음.
- 상태: 전역 스토어 없음, **게이트웨이가 진실의 원천이고 UI는 캐시**. 이벤트로 증분 반영, 늦게 온 응답이 새 상태를 덮지 않게 요청 세대 번호 검사.
- 화면: `/chat`, `/activity`, `/agents`, `/workboard`, `/meetings`, `/dashboards`, `/sessions`, `/automations`, `/skills`, `/plugins`, `/settings/approvals`.
- 실시간 표시: `session.narration`(최근 발화 한 줄 요약), `session.observer`(유틸리티 모델이 만든 헤드라인).
- **캐릭터 연출**:
  - 로브스터 펫: SVG 스프라이트, 상태 `idle|busy|offline`, 동작 `wave|hop|nap|cheer|droop`. 실행 성공 → cheer, 실패 → droop. 도감 화면도 있음.
  - 마스코트: 기분 `idle|thinking|working|happy|celebrating|sad|sleepy|attentive`, 효과 반짝임·zzz·땀.
  - 에이전트 얼굴: agentId 해시로 색·눈·입이 정해지는 SVG.
- 다이어그램: `packages/mermaid-renderer`(샌드박스 iframe에서 SVG 렌더).

## 12. 회의 봇

- 실제 화상회의(Google Meet·Teams·Zoom·Slack huddle)에 Chrome 게스트로 참여하는 기능. 에이전트끼리 하는 내부 회의가 아니다.
- 모드: `agent`(STT → 에이전트 → TTS), `bidi`(실시간 음성 모델), `transcribe`(자막만).
- 산출물: 약 5분마다 노트 갱신, 퇴장 시 요약 `{overview, decisions[], actionItems[], risks[]}` (`src/transcripts/summary-model.ts`, "결정을 지어내지 말 것" 지침 포함).

## 13. planbot으로 가져갈 것 / 버릴 것

| OpenClaw | planbot에서 |
|---|---|
| 게이트웨이 데몬 1개, WS+HTTP 한 포트, 웹 UI 같은 포트 | **그대로** (`127.0.0.1` 고정) |
| req/res/event 프레임, `connect` 첫 프레임, `seq` 재동기화 | **그대로**, 메서드는 20개 안팎 |
| `--profile`, 상태 폴더 vs 워크스페이스 분리, JSON5+스키마 설정 | **그대로** |
| 온보딩: AI 탐지 → 선택 → 실제 호출 검증 → 웹 열기 | **그대로** |
| 워크스페이스 파일 (`AGENTS.md`/`SOUL.md`/`IDENTITY.md`/`MEMORY.md`) + 글자 상한 | 캐릭터마다 하나씩 |
| coordinator·전문가 팀과 운영 규칙 | PM = coordinator, 나머지 = 전문가 |
| `sessions_send` 에이전트 간 대화 | 팀 논의 (사무실에 말풍선으로 표시) |
| heartbeat (체크리스트 비면 모델 호출 0) + 세션 lane 직렬화 | 캐릭터가 스스로 깨어나는 장치 |
| Workboard 카드 스키마·claim·dispatch·이벤트 로그·done은 사람 | 칸반 그대로, 열만 우리 단계로 |
| `ask_user` (질문 1~3개 구조화) | 요구사항 회의의 질문 형식 |
| Lobster `needs_input`/`needs_approval` + resume | 회의 요청·결과 컨펌 체크포인트 |
| 회의 요약 스키마 `{overview, decisions, actionItems, risks}` | 요구사항 회의록 형식 |
| 펫·마스코트 상태 → 기분 → 동작 매핑 | 픽셀 캐릭터 연출 규칙 (그림은 새로) |
| `session.narration` | 캐릭터 머리 위 한 줄 말풍선 |
| 채널(메신저) · 기기 페어링 · node/worker · 멀티 사용자 · Tailscale | **버림** |
| Docker 샌드박스 · exec 승인 · 플러그인 마켓 · Claw 패키지 수명주기 | **버림** |
| 실제 화상회의 봇 · TTS/STT · 앱 · 에이전트별 DB 분리 · 150개 테이블 | **버림** |
| Lit + webawesome 거대 SPA | **버림** (React + shadcn + PixiJS로 작게) |
