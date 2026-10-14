<div align="center">

# product-planning

**기획은 사람의 말로, SDD 스펙은 분기 트리로. AI가 자동으로 쓰지 않고 사람과 같이 쓴다.**

![version](https://img.shields.io/github/v/tag/YeongWon2/product-planning?label=version&sort=semver)
![deps](https://img.shields.io/badge/dependencies-0-success)
![lang](https://img.shields.io/badge/docs-한국어-green)

[설계서](docs/design.md) · [기획 작성법](docs/planning-guide.md) · [SDD 스펙 작성법](docs/sdd-guide.md) · [하네스](docs/harness.md)

</div>

---

## 왜 필요한가

| 흔한 증상 | 결과 |
|---|---|
| 기획과 개발 스펙이 한 문서에 섞여 있다 | 비개발자도 개발자도 읽기 어렵다 |
| AI가 흐름을 자동으로 만든다 | 사람이 원한 것과 다른 흐름이 그럴듯하게 채워진다 |
| 요구사항이 누구의 무슨 필요에서 나왔는지 없다 | 우선순위를 정할 근거가 없다 |
| 상태·권한·수정 여부에 따른 분기가 빠진다 | "잠긴 글이면 이 단추는요?"를 개발 중에 묻는다 |
| 다 됐는지 판단할 기준이 없다 | 완성이 사람마다 다르다 |

## 무엇을 만드나

| 파일 | 읽는 사람 | 담는 것 |
|---|---|---|
| `plan.md` | 비개발자 | 배경, 페르소나(원하는 것·행동 패턴), 요구사항, 완성 기준 |
| `sdd.md` | 개발자 | 상태표, 조건표, 진행표, 피쳐·함수 분기 트리 |
| `trace.json` | 하네스 | 완성 기준마다 근거가 되는 트리 줄 |

세 파일은 작업 중에만 프로젝트 밖 `~/.product-planning/work/{feature}/`에 있다.
완료되면 기획과 SDD 스펙을 합친 `{feature}.md` 한 파일만 고른 경로에 남기고 작업 폴더는 지운다.

## 어떻게 쓰나

```mermaid
flowchart LR
    A[사람이 답한다] --> B[AI가 옮긴다]
    B --> C[하네스 check]
    C -->|추가되어야 완성| D[AI가 1~3개 묻는다]
    D --> A
    C -->|걸린 것 없음| E[다음 단계]
    E --> D
```

1. `/yw-plan 기획하고 싶은 것 한 줄`로 기획을 시작한다.
2. 배경 → 페르소나 → 요구사항 → 완성 기준 순서로 묻고 답하며 `plan.md`를 채운다.
3. 사람이 기획을 확정하면 `/yw-sdd {feature}`로 SDD 스펙을 시작한다.
4. 상태표 → 조건표 → 단위 나누기 → 단위별 트리 → 요구사항 대조 순서로 같이 쓴다.
5. 하네스가 `완료`를 내면 결과물을 남길 경로를 고르고, `{feature}.md` 한 파일로 내보낸다.

회사 프로젝트에서 로컬 대화 기록까지 줄이는 법은 [하네스](docs/harness.md) 7장에 있다.

## SDD 트리 모양

```md
## 피쳐 · 게시글 수정 · R1

- [게시글 상세] 진입
- ? 수정 권한이 있는가
  - **아니오**
    - → [수정] 단추가 보이지 않는다
  - **예**
    - ◆ 게시글 상태
      - **게시됨**
        - [수정] 누름 → 수정 모달이 열린다
        - ↪ 수정 중 닫기
      - **잠김**
        - → [수정] 단추가 비활성이다
```

| 표시 | 뜻 |
|---|---|
| `?` | 조건 분기 (조건표의 조건) |
| `◆` | 상태 분기 (상태표의 모든 상태) |
| `→` | 화면 결과 |
| `⇒ 앞 → 뒤` | 상태 전이 |
| `↪` | 함수 호출 |

## 하네스 보고

```text
단계  SDD › 4. 단위별 트리
완성도  R1 1/3 · 전체 33%
추가되어야 완성
1. [빠진 상태] 게시글 수정 › ◆ 게시글 상태 아래 '잠김' 갈래가 없다. (sdd.md 34줄)
다음  진행표에서 작성중이거나 대기인 단위 하나를 골라 다음 분기를 묻는다.
```

```bash
node scripts/pp.mjs check examples/post-edit
```

## 구성

| 위치 | 내용 |
|---|---|
| `skills/yw-plan/` | 기획 단계를 이끄는 스킬 |
| `skills/yw-sdd/` | SDD 스펙 단계를 이끄는 스킬 |
| `scripts/pp.mjs` | 하네스 CLI (`init`, `check`, `sheet`, `export`, `discard`) |
| `src/` | 기획·SDD 읽기, 규칙, 대조, 보고 |
| `examples/post-edit/` | 끝까지 통과한 예시 |
| `docs/` | 설계서와 작성법. 모든 문서는 200줄 이하 |

## 개발

```bash
npm test
```

의존성이 없고 Node 20 이상에서 돈다.
