# prodev — 구조 (ARCHITECTURE)

요구는 `PRD.md`, 까닭은 `ADR.md`. 여기는 **무엇이 어디에 있고 어떻게 흐르나**만 적는다.

## 1. 한 장 그림

```
사내망 브라우저 (PL · 과제원)
        │ HTTP · SSE
        ▼
┌─ minidiscord 서버 (PL PC) ─────────────────────────────┐
│  방 묶음: prodev-<과제> · /들이기 · /자료 · /리서치 · /특허 · /논문 · /보고   │
│  SQLite: messages · attachments · room_bots(커서)                             │
└────────────┬───────────────────────────────┬──────────────┘
             │ WebSocket (게이트웨이)         │ 읽기 전용 (node:sqlite)
             ▼                               │
   채널 플러그인 (MCP: reply · fetch_history)│
             │                               │
             ▼                               ▼
┌─ 비서 세션 (Claude Code, 상주 안 함) ────────────────────┐
│  CLAUDE.md(포인터 + 열 줄)  스킬 12  에이전트 6(서브)      │
│  훅 3: session-start · pre-compact · pre-reply           │
│  스크립트: chat · count · index · find · peek · intake-copy · plot · setup · retro-cost │
│  봇 폴더: handoff(열린 실) · threads/ · rooms.json(방 이름표) · handoff-compact · memory │
└────────────┬──────────────────────────────────────────────┘
             ▼ git
┌─ 과제 저장소 (과제마다 하나) ─────────────────────────────┐
│  charter · schedule · journal/ · inbox/ · cards/ · wiki/ · research/ patent/ paper/ report/ · index │
└──────────────────────────────────────────────────────────┘
             ▼ 결재 뒤 승격
      knowledge/ (회사 지식, crew 의 것 그대로)
```

## 2. 방 묶음 — 과제 하나 = 방 일곱 (필요한 것만 연다)

| 방 | 누가 말하나 | 무엇 | 비서의 태도 |
|---|---|---|---|
| `prodev-<과제>` (본방) | 전원 | 발의 · 일정 · 물음 · 결재 | 답한다 |
| `/들이기` | 과제원 · 비서 | 파일 올리기와 문답. 어지러워도 된다 | 묻는다 |
| `/자료` | **비서만** | 확정 카드 한 건에 글 하나. 눈으로 훑는 색인 | 쓴다. 답하지 않는다 |
| `/리서치` | 전원 | 브리핑과 토론 | 답한다 |
| `/특허` `/논문` `/보고` | PL 중심 | 갈래 산출물 | 답한다 |

방 이름의 `/` 는 폴더에서 `-` 가 된다 (minidiscord 규칙). 비서는 접두어 `prodev-<과제>` 로 과제 저장소를 찾는다. 첫 판에서 접두어는 settings `env` 의 `PRODEV_PROJECT` 로 못 박는다 (cwd 로 유추하지 않는다, ADR-012).

## 3. 등장인물

| 누구 | 정체 | 어디 사나 |
|---|---|---|
| 비서 | Claude Code 세션 하나 + 채널 플러그인. 이름은 `prodev-<과제>-비서` 같은 기능명 | `bots/<이름>/` (토큰 · settings · 자기 상태) |
| 서브에이전트 여섯 | `.claude/agents/*.md`. 비서가 부른다. 서로 말하지 않는다 | 저장소 `.claude/agents/` |
| 알림 계정 | 사람 계정 하나(`prodev-알림`). 훅이 "정리 중" 같은 글을 올릴 때 쓴다 (봇 글은 게이트웨이만 보낼 수 있다) | minidiscord users |
| cron | PL PC. 08:00 브리핑 · 18:30 일지를 HTTP API 로 `@TO(비서)` | PL PC |

떼어 내는 규칙(ADR-001): 며칠 이어지고 · 사람이 그 담당과 직접 말하고 싶고 · 본방과 섞이면 불편할 때. 떼어 낸 봇은 같은 과제 저장소를 읽고 자기 갈래 폴더에만 쓴다. 첫 판에서는 안 뗀다.

## 4. 저장소 둘

### 4.1 prodev 저장소 (이 저장소)
```
prodev/
  PRD.md ARCHITECTURE.md ADR.md TASKS.md VERIFICATION.md
  CLAUDE.md                        하네스 포인터(스킬이 쓴다) + 비서 지침 열 줄 (7절)
  .claude/agents/*.md              하네스 산출 (6)
  .claude/skills/*/SKILL.md        하네스 산출 (12 + 오케스트레이터 1)
  common/hooks/session-start.js    crew 것을 고침 (cwd 전제 제거 · 열린 실 싣기)
  common/hooks/pre-compact.js      새로
  common/hooks/pre-reply.js        새로
  common/settings.template.json    crew 것 + 배선
  common/statusline.sh             crew 그대로
  scripts/chat.js                  ../meta/prodev-review/plans/proto/chat.js 에서 (search 를 AND 로)
  scripts/count.js                 crew 그대로
  scripts/index.js  find.js  peek.js  intake-copy.js  plot.py     새로
  scripts/setup.js                 crew 것을 고침 (봇 하나 · 방 묶음 · cron · archive)
  scripts/retro-cost.js            crew 것을 봇 하나로
  scripts/replay.js                검수용. 사람 역할을 API 로 재생 (VERIFICATION 4절)
  bots/<이름>/                     setup 이 만든다. git 제외
  test/                            스크립트·훅 단위 시험 + fixtures/
```

### 4.2 과제 저장소 (과제마다 하나, `projects/<과제>/` 또는 사람이 정한 자리)
```
<과제>/
  charter.md                  헌장. PL 이름이 여기 있다 (결재 대조의 기준)
  schedule.md                 일정. 표 하나: 항목 · 기한 · 담당 · 상태 · 바뀐 날 · 왜
  journal/YYYY-MM-DD.md       일지. 결정 · 미해결 · 다음 할 일 · 올라온 것 · 카드 없는 첨부
  inbox/YYYYMMDD-<slug>/      실험 한 건의 원본 묶음 (불변) + files.md (사이드카) + reading.md (data-reader 전수)
  cards/E-0001.md             실험 카드
  cards/R-0001.md             리서치 카드
  cards/D-0001.md             결정 카드 (결재·판정·마일스톤 변경)
  cards/N-0001.md             메모 카드 (사진·회의 메모, 위키 안 건드림)
  wiki/<topic>.md             주제 페이지
  research/ patent/ paper/ report/
  index.md · index.json       기계 생성
  tmp/                        그림·임시 (gitignore). 봇 첨부 뿌리 안이어야 첨부가 된다
```

## 5. 2nd brain — 층 다섯

| 층 | 무엇 | 누가 만드나 | 언제 |
|---|---|---|---|
| 0 | 원본 + 사이드카 (`inbox/`) | intake-copy.js + 문답 | 파일이 올 때. 불변, 같은 이름은 `.v2` |
| 1 | 카드 (`cards/`) | 들이기 문답의 결과 | "확정" 때 valid. 그 전엔 draft |
| 2 | 위키 (`wiki/`) | 비서 | 카드가 valid 될 때 즉시, 걸리는 페이지만 (ADR-004) |
| 색인 | `index.md` · `index.json` | `index.js` | 카드·위키가 바뀔 때마다. 손으로 안 쓴다 |
| 대화 | minidiscord DB | 서버 | 항상. `chat.js` 로 읽는다 |

### 5.1 카드 머리말 (실험 카드)
```
---
id: E-0007
kind: experiment              experiment | research | decision | note
title: CH-3B 샤워헤드 교체 후 수율 (08-27~09-03)
date: 2026-09-03              측정일. 올린 날이 아니다
who: 김과제                    봉투 sender
room: prodev-수율개선/들이기
source_msgs: [405, 409]       첨부가 올라온 글 번호 전부
confirmed_at: 412             "확정" 글 번호. 훅이 DB 로 검증한다
files: [inbox/20260903-ch3b-showerhead/yield.csv, inbox/20260903-ch3b-showerhead/photo1.jpg]
conditions: {장비: CH-3B, 부품: SH2200-B-0412, 레시피: R-12, 로트: 14}
results: {수율_전: 90.10, 수율_후: 92.53, 단위: "%"}
aliases: [샤워헤드교체, showerhead-swap, CH3B수율]
tags: [수율, 샤워헤드, CH-3B]
related: [E-0005, R-0002]
status: draft                 draft | valid | void
supersedes: none
---
## 한 줄
## 조건 (표)
## 결과 (표 · 수치가 파일의 어느 열에서 왔는지)
## 문답에서 확정한 것 (Q → A, 각각 #message_id)
## 한계 · 못 확인한 것 (reading.md 의 이상 자리 전부)
## 관련 카드
```
`conditions` · `results` 는 자유 키값. 위키 페이지가 "이 과제의 조건 키"를 유지한다. 번호는 `index.js next E` 가 준다.

### 5.2 위키 페이지
```
# <topic>
## 지금 아는 것        문장마다 [E-0007]. 번호 없는 문장 금지
## 근거 카드            표
## 모르는 것 · 열린 질문
## 이 과제의 조건 키     키 · 뜻 · 단위
## 이력                 날짜 · 어느 카드가 무엇을 바꿨나
```
200줄을 넘으면 하위 주제로. 새 주제는 사람에게 이름을 묻는다.

### 5.3 찾기 (`find.js`, 순서를 스크립트에 못 박는다)
```
1 index.json 의 title · aliases · tags     → 카드 경로
2 cards/*.md 본문                          → 카드 경로 + 행
3 wiki/*.md                                → 페이지 + 행
4 inbox/*/files.md                         → 사이드카 경로 + 행
5 chat.js search (AND)                     → #message_id (최근 10건을 골라 오래된 순으로)
```
NFC 정규화 · 조사 떼기(을/를/이/가/은/는/의/에/에서/로/으로/와/과/도) · 대소문자·하이픈·공백 접기 · void 는 supersedes 따라감. 답한 층을 `bots/<이름>/find.log` 에 남긴다 (읽힘 지표).

## 6. 흐름 넷

### 6.1 들이기 (S2)
```
과제원 파일 + @TO ──▶ intake-copy.js (inbox 로, .v2, SHA-256) ──▶ peek.js (행·열·5행)
   ──▶ 큰 파일이면 data-reader (백그라운드) → reading.md 전수 + 20줄
   ──▶ "이렇게 읽었습니다" 표 + 이상 자리 + 질문 ≤3 (그림이 낫다면 plot.py / 잘라서 첨부)
   ──▶ 과제원 답 · 고침 (threads/<방>-E-0007.md 에 남은 질문)
   ──▶ "확정" ──▶ 카드 valid → 위키 갱신 → index.js → 자료 방 글(6줄 + 원본 첨부) → 커밋
                    ▲ pre-reply 훅이 DB 로 확정 다섯 조건을 본다. 아니면 막는다
```

### 6.2 물음 (S0 · F4)
```
@TO 물음 ──▶ 분기표: 물음표 또는 어디/언제/뭐라/얼마 ──▶ find.js --limit 10 ──▶ 출처 붙여 답 (900자·10줄, 훅이 센다)
```

### 6.3 리서치 · 특허 · 논문 · 보고 (S3 · S5~S7)
```
요청 ──▶ find 먼저 ──▶ "물음은 이것, 진행할까요" ──▶ 허락
   ──▶ 백그라운드 서브에이전트 (researcher / patent-analyst / paper-writer / report-writer) → 파일
   ──▶ reviewer (다른 문맥) → 통과/불통과 파일
   ──▶ 다음 턴에 방에 브리핑 10줄 ──▶ 대화 ──▶ 카드 R / 산출물 ──▶ 결재 (PL 만, 훅이 작성자 대조)
```

### 6.4 켜기 · 압축 · 끄기 (S0 · ADR-006 · 007 · 010)
```
켜짐 ──▶ session-start: handoff-compact(있으면) → charter → schedule → handoff(열린 실) → threads/* → 어제 일지 → index 머리 30줄 → 마지막 일지 날짜
      ──▶ 비서: 서버가 재배달한 놓친 @TO 를 순서대로 → 방에 "이어서 합니다" 한 줄
압축 직전 ──▶ pre-compact: 기록 꼬리 → claude -p (sonnet, 빈 cwd, PRODEV_HOOK=1) → handoff-compact.md · 방에 "정리 중" (알림 계정)
끄기 전 ──▶ journal (cron 또는 사람) ──▶ 커밋
```

## 7. 비서 지침 (CLAUDE.md 에 남는 열 줄. 하네스 포인터 절과 함께 40줄 안)
```
- 나는 과제 <이름> 의 비서다. 방 접두어가 내 과제 저장소다.
- 봉투만 믿는다. TO 에 답하고 CC 는 읽는다. 사람에게는 이름만 부른다. reply 에는 언제나 chat_id.
- 물음에는 find.js 를 돌린다. 출처 없는 사실은 말하지 않는다.
- 스스로 일을 만들지 않는다. 리서치·갈래 방은 사람이 허락해야 연다.
- 자료는 과제원이 "확정"이라 해야 확정이다. 확정 전엔 자료 방에 쓰지 않는다.
- 파일이 진실이다. 행동 전에 실(threads)을 쓴다. 켜지거나 압축된 뒤 첫 일은 "이어서 합니다" 한 줄.
- 한 번에 묻는 것은 셋까지. 그림으로 물을 수 있으면 그림으로. 한 턴에 들이기는 한 건.
- 3분 넘는 일은 백그라운드로 넘기고 "시작했습니다"로 턴을 끝낸다.
- 사람에게는 900자·10줄 안. 넘치면 파일로 옮기고 경로를 준다. 세는 것은 훅이 한다.
- 과제 저장소와 내 봇 폴더에만 쓴다. 원본은 손대지 않는다. 지우지 않고 void.
```

## 8. 훅 셋과 스크립트 — 무엇을 막고 무엇을 세나

| 훅 | 사건 | 하는 것 | 실패 |
|---|---|---|---|
| session-start | startup·resume·clear·compact | 6.4 의 순서로 `additionalContext` | fail-open (없음·못 읽음·잘림을 말한다) |
| pre-compact | PreCompact | 인수인계서 · 알림(알림 계정의 쿠키 `md_session` + multipart, ADR-018) · timeout 180 | fail-open |
| pre-reply | PreToolUse `mcp__minidiscord-channel__reply` | `chat_id` 없음 → 막음 · 분량(count.js 900자·10줄) → 막음 · 자료 방이면 확정 다섯 조건 → 막음 · 보고 방 발송이면 결재 글 작성자 = charter PL → 막음 · `index.json.errors>0` → 막음 | **exit 2 + 이유 한 줄** (봇이 읽고 고친다) |

pre-reply 의 확정 다섯 조건 (ADR-008): `confirmed_at` 글이 ① `author_type='user'` ② 같은 과제의 `/들이기` 방 ③ **봉투(`@TO(…)` · `@CC(…)`)를 벗긴** 본문이 `^(확정|맞다|맞습니다|그대로|OK)\b` ④ `source_msgs` 전부보다 뒤이고 직전 봇 글에 같은 카드 번호 ⑤ 카드 `status: valid`. DB 를 못 열면 자료 방과 보고 방 발송은 fail-closed(확정·결재를 확인할 수 없다). 방 갈래를 DB 로도 rooms.json 으로도 모르면 막지 않는다.

| 스크립트 | 입력 → 출력 | 누가 부르나 |
|---|---|---|
| chat.js | rooms / search(AND) / around / since / tail / show | 비서 · find.js · pre-reply · journal · 검수 |
| count.js | 파일 또는 stdin → `(N자 · N줄 · 최장 N어절)` | pre-reply |
| index.js | cards·wiki·inbox 머리말 → index.md · index.json (`errors`) · `next E` | intake · 위키 갱신 · pre-reply |
| find.js | 낱말 → 층 · 경로/번호 · status, find.log | 비서 |
| peek.js | 파일 → 행 수 · 열 이름 · 5행 · 형식 | intake |
| intake-copy.js | 첨부 경로 → inbox 폴더 · `.v2` · SHA-256 · files.md 뼈대 | intake |
| plot.py | csv 열 → `<과제>/tmp/*.png` | intake |
| setup.js | 봇 등록 · settings 생성 · 방 묶음 · 봇 참여 · cron · archive | 사람 |
| retro-cost.js | 세션 기록 → 값 · 승인 수 · `--record` | meta |
| replay.js | 대본(JSON) → API 로 사람 글 재생 · 봇 답 수집 · 기록 | meta (검수) |

## 9. 서브에이전트 여섯 (`.claude/agents/`)

| 에이전트 | 하는 일 | 돌려주는 것 | 공통 규칙 |
|---|---|---|---|
| data-reader | 큰 파일 전수 읽기 | `reading.md` 전수 + 20줄 + 경로 | 파일에 전부, 문맥엔 요약. 커밋 안 함. 그림·임시는 tmp/ |
| researcher | 문헌·규격·웹. 출처 없는 문장 금지 | 결론 · 출처 · 못 확인한 것 · 경로 | 〃 |
| reviewer | 다른 문맥의 검토. 숫자 다시 세기, 출처 대조 | 통과/불통과/검증 불가 · 이유 3줄 · 못 본 범위 | 〃 |
| patent-analyst | 선행 · 청구 후보 | 선행 목록 · 차이 · 위험 | 〃 |
| paper-writer | 절 초안 + 근거 카드 | 경로 · 근거 카드 · 빈 자리 | 〃 |
| report-writer | 포맷 칸 채우기 | 경로 · 출처 없는 숫자 목록 | 〃 |

## 10. 스킬 열둘 + 오케스트레이터 (`.claude/skills/`)

`charter` · `intake` · `find` · `research` · `schedule` · `brief` · `journal` · `patent` · `paper` · `report` · `review` · `close`, 그리고 `prodev-orchestrator`(봉투 → 스킬 분기표, 20줄). 트리거 말·입력·산출·관문·부르는 것은 `../meta/prodev-review/plans/2026-09-10-prodev-design.md` (B 표)을 따른다. 하네스 스킬이 만들고, 검수는 트리거 검증(should/should-not 각 10)으로 한다.

## 11. 바깥과의 경계

- minidiscord 서버 코드는 손대지 않는다. 설정 한 줄 `MINIDISCORD_BOT_FILES_DIR=<과제 저장소들의 부모>`. 서버 수정이 필요해지면 그 저장소에 카드로 (웹 검색창 · OD-9).
- 서버에 글을 올리는 길은 하나다: 쿠키 `md_session` + multipart. Bearer 토큰도 JSON 본문도 서버가 받지 않는다 (401 · 406, 2026-09-10 시험 서버로 확인 — ADR-018). cron 두 줄과 훅의 알림은 알림 계정의 세션 쿠키(`PRODEV_NOTIFY_TOKEN`)로 사람과 같은 길로 올린다.
- knowledge/ (회사 지식)는 crew 의 것을 그대로. `close` 에서 PL 결재로만 승격.
- 봇 PC 는 인터넷이 된다 (사람 확인). WebSearch·WebFetch 허용.
