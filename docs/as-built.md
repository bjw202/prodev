# 지금 코드가 어떻게 생겼나 (as-built)

설계는 `ARCHITECTURE.md` 다. **여기는 실제로 만들어진 것**을 적는다. 둘이 다르면 8절에 그 자리와 ADR 번호가 있다.
단계가 끝날 때마다 갱신한다 (`TASKS.md` 0절). 마지막 갱신 2026-09-10, 3단계 관문(T3.M) 통과 뒤.

---

## 1. 폴더 나무

```
prodev/
  PRD.md ARCHITECTURE.md ADR.md TASKS.md VERIFICATION.md README.md CLAUDE.md
  scripts/      부품 열 (아래 2절)
  common/hooks/ 훅 셋 + places.js
  common/       settings.template.json · statusline.sh
  .claude/agents/   서브에이전트 여섯
  .claude/skills/   스킬 열셋 (열둘 + 오케스트레이터)
  test/         단위 시험 아홉 파일 + fixtures/
  test/server/  서버가 필요한 시험 둘 (npm test 에 안 섞인다)
  docs/         harness-input · skill-matrix · launch · as-built(이 파일) · log
  bots/<봇>/    setup.js 가 만든다. git 제외. **이 저장소의 어떤 시험도 여기를 만지지 않는다**
```

## 2. `scripts/` — 부품 열

| 파일 | 무엇을 하나 | 입력 → 출력 | 누가 부르나 |
|---|---|---|---|
| `chat.js` | minidiscord DB 를 읽기 전용으로 연다 | `rooms`·`search`(AND)·`around`·`since`·`tail`·`show` → 글 목록/JSON | 비서 · find.js · journal · 검수 |
| `count.js` | 보낼 글의 분량 | 파일 또는 stdin → `(N자 · N줄 · 최장 N어절)` | pre-reply 훅 |
| `index.js` | 카드·위키·inbox 머리말 → 색인 | 과제 폴더 → `index.md` · `index.json`(`errors`) · `next E\|R\|D\|N` | intake · research · schedule · pre-reply |
| `find.js` | 층 다섯을 차례로 뒤진다 | 낱말들 → 층 · 경로/번호 · status, `find.log` | 비서 (find 스킬) |
| `peek.js` | 파일 겉을 본다 | 파일 → 행 수 · 열 이름 · 앞 5행 · 형식 | intake |
| `intake-copy.js` | 첨부를 inbox 로 들인다 | slug + 파일들 → inbox 폴더 · `.v2` · SHA-256 · `files.md` · 원본 0444. 서버 저장명이면 uuid 앞머리를 벗겨 원래 이름으로 | intake |
| `plot.py` | csv 한 열을 그림으로 | csv + 열 → `<과제>/tmp/*.png` (없으면 한 줄 내고 exit 0) | intake |
| `setup.js` | 설치 · 방 · cron · 보관 | (아래 5절) | 사람 |
| `retro-cost.js` | 세션 기록에서 값·승인 수 | 기록 → 숫자, `--record` | meta |
| `replay.js` | 사람 역할을 API 로 재생 | 대본 JSON + 기록 JSONL 경로 → 기록 · exit 0/1 | meta (검수) |

## 3. `common/hooks/` — 훅 셋 + 자리 찾기

| 파일 | 사건 | 하는 것 | 실패했을 때 |
|---|---|---|---|
| `session-start.js` | SessionStart (startup·resume·clear·compact) | 파일 일곱을 순서대로 `additionalContext` 로. **없음·못 읽음·잘림을 말로 가른다** | fail-open (exit 0) |
| `pre-compact.js` | PreCompact | 기록 꼬리 → `claude -p` 요약 → `handoff-compact.md`, **본방**에 "정리 중" (알림 계정. 방은 `chat_id` → env → `rooms.json` 의 본방) | fail-open. 못 썼으면 "못 썼다"를 파일에 적는다 |
| `pre-reply.js` | PreToolUse `mcp__minidiscord-channel__reply` | 다섯을 차례로 본다 (아래) | 막을 때 **exit 2 + stderr 한 줄**. 통과는 exit 0 무언 |
| `places.js` | (모듈) | 봇 폴더 · 과제 폴더 · DB · 방 이름을 env 로 찾는다 | 모르면 `null` — 부르는 쪽이 정한다 |

`pre-reply.js` 가 보는 차례 (앞이 걸리면 뒤는 안 본다):
1. `chat_id` 없음 → 막음
2. 분량 (`count.js` 로 잰다) → 넘으면 막음
3. `/자료` 방이면 확정 조건 (ADR-008 + 봉투 벗기기 보충) → 아니면 막음
4. `/보고` 방 발송이면 결재 글 작성자 = `charter.md` 의 PL → 아니면 막음
5. `index.json` 의 `errors > 0` → 막음

DB 를 못 열면 `/자료` 방만 fail-closed. 방 갈래를 DB 로도 `rooms.json` 으로도 모르면 막지 않는다.

## 4. `.claude/` — 에이전트 여섯 · 스킬 열셋

에이전트 (전부 서브. 팀 모드 없음. `model: opus`. 돌려주는 것은 20줄 안, 전수는 파일에, 커밋 안 함):
`data-reader` · `researcher` · `reviewer` · `patent-analyst` · `paper-writer` · `report-writer`

스킬: `charter` · `intake` · `find` · `research` · `schedule` · `brief` · `journal` · `patent` · `paper` · `report` · `review` · `close`
\+ `prodev-orchestrator` (봉투 → 스킬 분기표, 본문 20줄).
스킬 본문이 설계와 맞는지는 `docs/skill-matrix.md` 가 칸칸이 대조한다 (72칸).

## 5. `setup.js` 가 만드는 것

| 명령 | 만드는 것 |
|---|---|
| `setup.js [--project <과제폴더>]` | 과제 폴더의 하위 열 · 봇 폴더 · `.env`(봇 토큰) · `.claude/settings.json` · `.mcp.json`(토큰 있을 때만) |
| `setup.js rooms <과제>` | 방 일곱 + 봇 참여 + `rooms.json` |
| `setup.js cron` | crontab 두 줄을 stdout 으로 (쿠키 + `--form-string`, ADR-018) |
| `setup.js archive <방>` | 방 하나 보관 |

만들어지는 `settings.json`:
- `env` 여섯: `CLAUDE_CODE_DISABLE_AUTO_MEMORY` · `PATH`(변수 참조 없는 실제 폴더만) · `PRODEV_BOT` · `PRODEV_PROJECT` · `MINIDISCORD_DB` · `MINIDISCORD_URL`
- `permissions.allow` 41건 · `deny` 틀 5건 + 서버 업로드 폴더 2건(과제 폴더를 덮지 않을 때만, ADR-019) · `additionalDirectories` 3
- `hooks` 셋 배선 · `statusLine` · `autoCompactEnabled` · `autoCompactWindow`
- **deny 가 과제 폴더를 덮으면 설치가 예외로 죽는다** (ADR-019)

## 6. 환경 변수 전부

| 이름 | 누가 읽나 | 기본값 · 없으면 |
|---|---|---|
| `PRODEV_PROJECT` | places.js · index.js · find.js · intake-copy.js | 없으면 과제 폴더를 모른다 (훅은 그 검사를 건너뛴다) |
| `PRODEV_BOT` | places.js | 봇 폴더를 `<repo>/bots/<이름>` 으로 |
| `PRODEV_BOT_DIR` | places.js | 있으면 이것이 이긴다 |
| `PRODEV_HANDOFF` | places.js | 없으면 `<봇폴더>/handoff-compact.md` |
| `PRODEV_NOTIFY_TOKEN` | pre-compact.js · cron 두 줄 | 알림 계정의 `md_session` 값. 없으면 봇 폴더 `.env` → 그것도 없으면 알림 건너뜀 (ADR-018) |
| `PRODEV_NOTIFY_ROOM` | pre-compact.js | 봉투의 `chat_id` 가 먼저 → env → `rooms.json` 의 본방. 셋 다 없으면 알림 건너뜀 |
| `PRODEV_INTAKE_ROOTS` | intake-copy.js | 없으면 `MINIDISCORD_BOT_FILES_DIR`, 그것도 없으면 막지 않는다 |
| `PRODEV_AUTOCOMPACT` | setup.js | 650000 |
| `PRODEV_FAKE_CLAUDE` | pre-compact.js | 시험용. 요약을 부르지 않는다 |
| `PRODEV_FIND_LOG` | find.js | 없으면 봇 폴더의 `find.log` |
| `MINIDISCORD_DB` | places.js · chat.js | 없으면 `<minidiscord>/server/data/minidiscord.db` |
| `MINIDISCORD_URL` | setup.js · pre-compact.js | `http://127.0.0.1:3000` |
| `MINIDISCORD_DIR` | setup.js · 시험 | 없으면 저장소의 형제 `minidiscord` |
| `MINIDISCORD_BOT_FILES_DIR` | setup.js · intake-copy.js | 봇 첨부 뿌리 = **과제 저장소들의 부모** |
| `MINIDISCORD_USER` | setup.js · retro-cost.js | `prodev-setup` · `observer` |
| `MINIDISCORD_SERVER` | setup.js (.mcp.json 에 박는다) | `ws://<URL>/bot` |
| `REPLAY_TOKEN_PL` · `REPLAY_TOKEN_MEMBER` | replay.js | 없으면 **시작 전에 exit 1** |

## 7. 시험 묶음

`npm test` — 서버가 필요 없다. **87건 · 0 실패.**

| 파일 | 건수 | 무엇을 |
|---|---|---|
| `chat.test.js` | 10 | fixture DB 하나로 여섯 명령 |
| `count.test.js` | 4 | 세는 법 하나 |
| `find.test.js` | 16 | 층 다섯 · 조사 떼기 · void 따라가기 |
| `hooks.test.js` | 31 | session-start 5 · pre-compact 5 + 알림 6 · pre-reply 15 |
| `index.test.js` | 8 | 머리말 부분집합 · `next` · errors |
| `intake.test.js` | 9 | 뿌리 밖 거절 · `.v2` · 0444 · 서버 저장명의 uuid 벗기기 셋 |
| `peek.test.js` | 5 | csv · xlsx · pdf · jpg · 모르는 형식 |
| `plot.test.js` | 2 | 그림 하나 · 안 죽는다 |
| `smoke.test.js` | 2 | 부품·fixture 가 제자리 |

`npm run test:server` — 진짜 minidiscord 를 임시로 띄운다. **20건 · 0 실패** (setup 12 · replay 8).
**저장소 사본에서 돌린다.** `MINIDISCORD_DIR` 하나만 주면 된다:
```
git archive HEAD | tar -x -C <임시>/사본 && cp -r node_modules <임시>/사본/
cd <임시>/사본 && MINIDISCORD_DIR=<실제 minidiscord> npm run test:server
```
마지막 시험이 "시험은 실제 `bots/` 를 만지지 않는다 (시험 전후 목록이 같다)" 를 못 박는다.

## 8. 설계와 다르게 된 자리

| 무엇 | 왜 | ADR |
|---|---|---|
| 찾기 층 순서에서 `files.md` 가 대화보다 앞 | 대화 층에 봇이 붙여넣은 코드가 걸려 사이드카에 닿지 못했다 | ADR-016 |
| `paper/sections/<절>.md` · `<산출물>.review.md` | 설계에 자리가 없던 둘. 통과 전 초안과 원고를 갈라야 했고, F8 이 판정 파일을 요구한다 | ADR-017 |
| 알림이 Bearer+JSON 이 아니라 쿠키+multipart | 서버가 Bearer 를 안 읽고(401) 글 올리기는 multipart 만 받는다(406). `-F` 가 아니라 `--form-string` — `-F` 는 `@TO(` 를 파일 경로로 읽는다 | ADR-018 |
| 파일 뿌리를 deny 하지 않는다 | 파일 뿌리가 과제 저장소들의 부모라, 막으면 봇이 헌장을 못 쓴다. 0층 불변은 0444 와 git 이 지킨다 | ADR-019 |
| 산출물을 방에 첨부한다 | 경로만 주면 사람이 열러 가지 않는다 | ADR-020 |
| `rooms.json` 은 방 이름표. `last_seen_id` 를 믿지 않는다 | 재생 다섯에서 그 값이 끝까지 0 이었는데 놓친 글은 서버 재배달이 다 가져왔다. ADR-006 을 뒤집었다 | ADR-021 |
| 확정 어휘를 봉투 벗긴 뒤에 본다 | 사람 글은 언제나 `@TO(…)` 로 시작한다. 안 벗기면 확정이 영영 안 된다 | ADR-008 보충 |
| 봇 `settings.json` 의 env 에 `MINIDISCORD_URL` | 없으면 훅이 기본 3000 을 보고 알림을 조용히 건너뛴다 | — |
| intake 가 서버 저장명의 uuid 를 벗긴다 | 안 벗기면 같은 파일이 이름만 다른 채 둘이 된다 (`.v2` 가 안 걸린다) | — |
| 압축 알림의 방을 `rooms.json` 의 본방에서 찾는다 | PreCompact 입력에 `chat_id` 가 없고 `setup.js` 는 설치 때 방 번호를 모른다 (방은 나중에 만든다) | — |

## 9. 아직 그대로인 것 (알고 두는 것)

- `rooms.json` 의 `last_seen_id` 칸은 `setup.js` 가 0 으로 쓰고 아무도 갱신하지 않는다. 읽는 코드도 없다 (ADR-021).
- cron 두 줄은 `setup.js cron` 이 내기만 한다. crontab 에 붙이는 것은 사람이 한다 (`docs/launch.md` 8절).
- `bots/` 는 git 제외다. 봇 토큰은 서버 `bots` 표에도 평문으로 있어 잃어도 거기서 꺼낼 수 있다.
