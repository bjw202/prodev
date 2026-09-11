# 지금 코드가 어떻게 생겼나 (as-built)

설계는 `design/v3/ARCHITECTURE.md` 다. **여기는 실제로 만들어진 것**을 적는다. 둘이 다르면 8절에 그 자리와 ADR 번호가 있다.
단계가 끝날 때마다 갱신한다 (`design/v3/TASKS.md` 0절). 마지막 갱신 2026-09-11, 진화하는 비서 관문 B — 길(ADR-034~037) PR 뒤.

---

## 1. 폴더 나무

```
prodev/
  README.md CLAUDE.md
  design/v1/    지난 판 (1차 설계. 손대지 않는다)
  design/v2/    지난 판 (2차 설계 · 검색 안정성. 손대지 않는다)
  design/v3/    이 판의 설계 문서 다섯 (PRD · ARCHITECTURE · ADR · TASKS · VERIFICATION)
  scripts/      부품 열 (아래 2절)
  common/hooks/ 훅 셋 + places.js
  common/       settings.template.json · statusline.sh
  .claude/agents/   서브에이전트 여섯
  .claude/skills/   스킬 열다섯 (도메인 열넷 + 오케스트레이터)
  test/         단위 시험 열한 파일 + fixtures/
  test/server/  서버가 필요한 시험 둘 (npm test 에 안 섞인다)
  docs/         harness-input · skill-matrix · launch · as-built(이 파일) · log
  docs/evidence/  meta 의 판정 기록 사본 여덟 (내용 그대로. 고치지 않는다)
  bots/<봇>/    setup.js 가 만든다. git 제외. **이 저장소의 어떤 시험도 여기를 만지지 않는다**
```

## 2. `scripts/` — 부품 열

| 파일 | 무엇을 하나 | 입력 → 출력 | 누가 부르나 |
|---|---|---|---|
| `chat.js` | minidiscord DB 를 읽기 전용으로 연다 | `rooms`·`search`(AND)·`around`·`since`·`tail`·`show` → 글 목록/JSON | 비서 · find.js · journal · 검수 |
| `count.js` | 보낼 글의 분량 | 파일 또는 stdin → `(N자 · N줄 · 최장 N어절)` | pre-reply 훅 |
| `index.js` | 카드·위키·inbox 머리말 → 색인 | 과제 폴더 → `index.md` · `index.json`(`errors`) · `next E\|R\|D\|N` | intake · research · schedule · pre-reply |
| `find.js` | 층 **여섯**을 차례로 뒤진다 (index · 카드 · 위키 · **과제 문서** · inbox · 대화) | 낱말들 → 층 · 경로/번호 · status, `find.log`(칸 여섯) | 비서 (find 스킬) |
| `peek.js` | 파일 겉을 본다 | 파일 → 행 수 · 열 이름 · 앞 5행 · 형식 | intake |
| `intake-copy.js` | 첨부를 inbox 로 들인다 | slug + 파일들 → inbox 폴더 · `.v2` · SHA-256 · `files.md` · 원본 0444. 서버 저장명이면 uuid 앞머리를 벗겨 원래 이름으로 | intake |
| `plot.py` | csv 한 열을 그림으로 | csv + 열 → `<과제>/tmp/*.png` (없으면 한 줄 내고 exit 0) | intake |
| `setup.js` | 과제 폴더 · 설치 · 방 · cron · 보관 | (아래 5절) | 사람 |
| `retro-cost.js` | 세션 기록에서 값·승인 수 | 기록 → 숫자, `--record` | meta |
| `replay.js` | 사람 역할을 API 로 재생 | 대본 JSON + 기록 JSONL 경로 → 기록 · exit 0/1 | meta (검수) |

## 3. `common/hooks/` — 훅 셋 + 자리 찾기

| 파일 | 사건 | 하는 것 | 실패했을 때 |
|---|---|---|---|
| `session-start.js` | SessionStart (startup·resume·clear·compact) | `design/v3/ARCHITECTURE.md` 6.4 의 파일들을 그 순서대로 `additionalContext` 로 — **여덟 절**이고 여덟째가 `house.md`(상한 50줄, ADR-032). **없음·못 읽음·잘림을 말로 가른다**. `house.md` 가 잘리면 봇에게 "첫 답에 사람에게 말하고 스스로 줄이지 마라"고 시킨다. `compact` 일 때만 방에 "정리가 끝났습니다" 한 줄 | fail-open (exit 0) |
| `pre-compact.js` | PreCompact | 기록 꼬리 → `claude -p` 요약 → `handoff-compact.md`, **본방**에 "정리 중" (알림 계정. 방은 `chat_id` → env → `rooms.json` 의 본방) | fail-open. 못 썼으면 "못 썼다"를 파일에 적는다 |
| `pre-reply.js` | PreToolUse `mcp__minidiscord-channel__reply` | 다섯을 차례로 본다 (아래) | 막을 때 **exit 2 + stderr 한 줄**. 통과는 exit 0 무언 |
| `places.js` | (모듈) | 봇 폴더 · 과제 폴더 · DB · 방 이름을 env 로 찾는다. **알림 한 자리**(`알릴방` · `알림토큰` · `알린다`) — 훅 둘이 같이 쓴다 | 모르면 `null` — 부르는 쪽이 정한다 |

`pre-reply.js` 가 보는 차례 (앞이 걸리면 뒤는 안 본다):
1. `chat_id` 없음 → 막음
2. 분량 (`count.js` 로 잰다) → 넘으면 막음
3. 봉투를 벗긴 첫 줄이 `[카드]` 로 시작하면 → 꼴 검사 + 확정 조건 (ADR-008 + 봉투 벗기기 보충) → 아니면 막음
4. 봉투를 벗긴 첫 줄이 `[발송]` 로 시작하면 → 결재 글 작성자 = `charter.md` 의 PL → 아니면 막음
5. `index.json` 의 `errors > 0` → 막음

**3·4 의 방아쇠는 방이 아니라 표식이다** (ADR-022). 방이 둘로 줄어 방으로는 "카드 공지"와 "카드 번호를 말하는 평범한 답"을 가를 수 없기 때문이다. 확정 조건 ② 의 방 이름은 `/files` 이고, 발송은 방을 가리지 않는다.

DB 를 못 열거나 방을 몰라도 표식이 있으면 막는다 (카드 공지 · 발송은 fail-closed). 표식이 없는 글은 통과한다 — 거기까지 막으면 봇이 한 마디도 못 한다.

## 4. `.claude/` — 에이전트 여섯 · 스킬 열다섯

에이전트 (전부 서브. 팀 모드 없음. `model: opus`. 돌려주는 것은 20줄 안, 전수는 파일에, 커밋 안 함):
`data-reader` · `researcher` · `reviewer` · `patent-analyst` · `paper-writer` · `report-writer`

스킬: `charter` · `intake` · `find` · `research` · **`analysis`** · `schedule` · `brief` · `journal` · **`retro`** · `patent` · `paper` · `report` · `review` · `close`
\+ `prodev-orchestrator` (봉투 → 스킬 분기표 + 굳는 길 절).
**`analysis` 와 `retro` 는 v3 에서 손으로 더한 둘이다** (ADR-034 · 036) — 하네스가 만든 것이 아니라 ADR 로 정해 제작 세션이 썼다.
스킬 본문이 설계와 맞는지는 `docs/skill-matrix.md` 가 칸칸이 대조한다 (84칸). 글자 수준의 규격은 `test/skills.test.js` 가 기계로 본다.

## 5. `setup.js` 가 만드는 것

| 명령 | 만드는 것 |
|---|---|
| `setup.js [--project <이름\|폴더>]` | **과제 폴더 자체**(없으면 만든다) · 하위 **열둘**(`analysis/` · `templates/` 를 더했다) · `house.md` 골격 · `.gitignore`(`tmp/` 한 줄) · `git init` · 봇 폴더 · `.env`(봇 토큰 + **알림 계정 세션 쿠키**, ADR-024) · `.claude/settings.json` · `.mcp.json`(토큰 있을 때만). 이름만 주면 `$MINIDISCORD_BOT_FILES_DIR/<이름>` (ADR-023) |
| `setup.js rooms <과제>` | 방 둘(본방 · `<과제>/files`) + 봇 참여 + `rooms.json` |
| `setup.js cron` | crontab 두 줄을 stdout 으로 (쿠키 + `--form-string`, ADR-018) |
| `setup.js archive <방>` | 방 하나 보관 |

만들어지는 `settings.json`:
- `env` 일곱: `CLAUDE_CODE_DISABLE_AUTO_MEMORY` · `PATH`(변수 참조 없는 실제 폴더만) · **`CLAUDE_CODE_GIT_BASH_PATH`**(ADR-033. 기본 `C:\Program Files\Git\bin\bash.exe`, 같은 이름의 환경변수로 덮는다. 맥에서도 키가 있고 값이 비지 않는다) · `PRODEV_BOT` · `PRODEV_PROJECT` · `MINIDISCORD_DB` · `MINIDISCORD_URL`
- `permissions.allow` **22건**(Bash 항목 열. 41건에서 셸 도구 스물하나를 뺐고 `Grep`·`Glob` 을 이름으로 넣었다 — ADR-033) · `deny` 틀 5건 + 서버 업로드 폴더 2건(과제 폴더를 덮지 않을 때만, ADR-019) · `additionalDirectories` 3
- `hooks` 셋 배선 · `statusLine` · `autoCompactEnabled` · `autoCompactWindow`
- **deny 가 과제 폴더를 덮으면 설치가 예외로 죽는다** (ADR-019)

## 6. 환경 변수 전부

| 이름 | 누가 읽나 | 기본값 · 없으면 |
|---|---|---|
| `PRODEV_PROJECT` | places.js · index.js · find.js · intake-copy.js | 없으면 과제 폴더를 모른다 (훅은 그 검사를 건너뛴다) |
| `PRODEV_BOT` | places.js | 봇 폴더를 `<repo>/bots/<이름>` 으로 |
| `PRODEV_BOT_DIR` | places.js | 있으면 이것이 이긴다 |
| `PRODEV_HANDOFF` | places.js | 없으면 `<봇폴더>/handoff-compact.md` |
| `PRODEV_NOTIFY_TOKEN` | pre-compact.js · session-start.js · cron 두 줄 | `prodev-notify` 계정의 `md_session` 값. **`setup.js` 가 받아 봇 폴더 `.env` 에 쓴다** (ADR-024). 없으면 알림 건너뜀 (ADR-018) |
| `PRODEV_NOTIFY_ROOM` | pre-compact.js | 봉투의 `chat_id` 가 먼저 → env → `rooms.json` 의 본방. 셋 다 없으면 알림 건너뜀 |
| `PRODEV_INTAKE_ROOTS` | intake-copy.js | 없으면 `MINIDISCORD_BOT_FILES_DIR`, 그것도 없으면 막지 않는다 |
| `PRODEV_AUTOCOMPACT` | setup.js | 650000 |
| `PRODEV_FAKE_CLAUDE` | pre-compact.js | 시험용. 요약을 부르지 않는다 |
| `PRODEV_FIND_LOG` | find.js | 없으면 봇 폴더의 `find.log` |
| `MINIDISCORD_DB` | places.js · chat.js | 없으면 `<minidiscord>/server/data/minidiscord.db` |
| `MINIDISCORD_URL` | setup.js · pre-compact.js | `http://127.0.0.1:3000` |
| `MINIDISCORD_DIR` | setup.js · 시험 | 없으면 저장소의 형제 `minidiscord` |
| `MINIDISCORD_BOT_FILES_DIR` | setup.js · intake-copy.js | 봇 첨부 뿌리 = **과제 저장소들의 부모**. `--project` 에 이름만 줬을 때 과제 폴더를 만드는 자리다 (ADR-023) |
| `MINIDISCORD_USER` | setup.js · retro-cost.js | `prodev-setup` · `observer` |
| `MINIDISCORD_SERVER` | setup.js (.mcp.json 에 박는다) | `ws://<URL>/bot` |
| `REPLAY_TOKEN_PL` · `REPLAY_TOKEN_MEMBER` | replay.js | 없으면 **시작 전에 exit 1** |

## 7. 시험 묶음

`npm test` — 서버가 필요 없다. **133건 · 0 실패.**

| 파일 | 건수 | 무엇을 |
|---|---|---|
| `chat.test.js` | 10 | fixture DB 하나로 여섯 명령 |
| `count.test.js` | 4 | 세는 법 하나 |
| `find.test.js` | 20 | 층 여섯 · 조사 떼기 · void 따라가기 · 절 단위 매칭의 거짓 양성 |
| `hooks.test.js` | 41 | session-start 5 + **house.md 3**(여덟째 자리 · 50줄 잘림과 사람에게 말하기 · 딱 50줄 경계) + 압축 직후 알림 2 · pre-compact 5 + 알림 7 · pre-reply 19 (표식 사례 17 + fail-closed 2) |
| `index.test.js` | 8 | 머리말 부분집합 · `next` · errors |
| `intake.test.js` | 9 | 뿌리 밖 거절 · `.v2` · 0444 · 서버 저장명의 uuid 벗기기 셋 |
| `peek.test.js` | 5 | csv · xlsx · pdf · jpg · 모르는 형식 |
| `plot.test.js` | 2 | 그림 하나 · 안 죽는다 |
| `setup.test.js` | 10 | 과제 폴더의 자리 넷 · `.gitignore` 한 줄 · `house.md` 골격 · 다시 돌려도 안 덮음 · Git Bash 키 · 허용 목록 22건(뺀 스물하나 · 내장 셋 · 남긴 열) · deny (ADR-032 · 033) |
| `skills.test.js` | 22 | 스킬 열다섯이 제자리 · 머리말 · 분기표 순서(굳는 길 · analysis>find · retro>brief) · 트리거가 안 겹치나 · analysis 여섯 칸과 카드 필수와 관문 하나 · retro 근거와 판별 넷과 제안 셋 · report 의 templates 순서 · journal 의 되풀이 절 · CLAUDE.md 굳는 길 한 줄과 40줄 (ADR-034~037) |
| `smoke.test.js` | 2 | 부품·fixture 가 제자리 |

`npm run test:server` — 진짜 minidiscord 를 임시로 띄운다. **25건 · 0 실패** (setup 17 · replay 8).
실제로 쓰인 `settings.json` 에서 허용 22건과 `CLAUDE_CODE_GIT_BASH_PATH` 도 여기서 한 번 더 본다 — 틀만 보면 `setup.js` 의 치환이 빠져도 안 걸린다.
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
| 찾기 층이 여섯. 4층이 과제 문서(`charter.md` 절 · `schedule.md` 표 행), inbox 5 · 대화 6 | 예산 · 중간 점검 · 판정 기준이 헌장과 일정에 적혀 있는데 검색 층에 아예 없었다. 자리가 위키 뒤라 1~3층을 가로채지 못한다 | ADR-026 |
| 과제 문서는 파일이 아니라 절 · 행 단위로 맞댄다. 덩이마다 경로가 다르다 (`charter.md#<절 이름>` · `schedule.md#<첫 칸>`) | 헌장 한 파일에 목적·예산·판정 기준이 다 있어 통째로 맞대면 서로 다른 절의 낱말이 함께 걸린다 (`예산 감광액`). 덩이 여럿이 같은 경로를 쓰면 `dedupe` 가 묶어 조용히 버린다 | ADR-027 |
| `find.log` 한 줄에 층 **이름** 칸을 더했다 (`when·층·층 이름·건수·맨 위·물음`) | 층이 밀리면 옛 로그의 `4` 와 새 로그의 `4` 가 다른 뜻이 되어 주간 계측이 조용히 어긋난다 | ADR-026 |
| 카드 `## 결과` 는 갈래별 요약 표와 원본 실마리를 **둘 다**. `conditions` 에 가르는 축 · `aliases` 채우기 | v1 의 "또는" 을 봇이 짧은 쪽으로만 읽어, 이상 자리만 실은 카드가 이상한 것만 답했다 | ADR-028 |
| 과제가 쫓는 갈래는 **개체별 표**까지, 나머지는 요약 표 + 실마리. 개체 20 넘으면 상한 셋 | 요약 표는 **수**를 주지 개체를 주지 않는다. "여덟 중 여섯 이내" 는 답해도 "그 여섯이 어느 것이냐" 는 못 답한다 (1차 관문 실측) | ADR-030 |
| 대본 시험을 미니디스코드 없이 세션 대 세션으로 | 서버·계정·토큰·방 걸음이 사라져 되풀이가 싸진다. 대신 `pre-reply` 훅이 안 걸려 셋을 못 잰다 (`docs/launch.md` 11절) | ADR-029 |
| 과제 폴더에 `house.md` · `analysis/` · `templates/` · `.gitignore`. 훅이 `house.md` 를 여덟째로 싣는다 (상한 50줄) | 봇이 만들어 낸 것과 사람이 가르친 규칙이 **살 자리가 없었다.** 훅이 싣던 일곱은 전부 과제의 사실이고 규칙 칸이 하나도 없었다 | ADR-032 |
| `house.md` 가 잘리면 봇이 첫 답에 사람에게 말하고 스스로 줄이지 않는다 | 잘린 자리부터는 봇이 있는 줄도 모르는 규칙이다. 새 장치를 만들지 않고 훅이 이미 아는 잘림을 말만 시켰다 | ADR-032 |
| 허용 목록 41건 → 22건. `Grep`·`Glob` 을 이름으로 열고 셸 도구 스물하나를 뺐다. `env` 에 `CLAUDE_CODE_GIT_BASH_PATH` | 스킬·에이전트 본문이 부르는 바깥 명령은 `node`·`python3`·`git` 뿐이라 **봇이 할 수 있는 일이 줄지 않는다.** 줄어든 것은 셸로 새어 나갈 자리다 | ADR-033 |
| `analysis` 스킬과 `analysis/<날짜>-<slug>/`(`run.py` · 여섯 칸 `run.md`) + **카드 하나** | "이 자료로 t 검정 해 줘" 를 받을 자리가 스킬 열둘 어디에도 없었다. 카드가 없으면 `analysis/` 는 찾기 층에 없어 다음 주에 못 찾는다 | ADR-034 |
| 분석의 관문은 **모형 고르기 한 자리**뿐. 코드 짜는 데는 관문이 없다 | 가르는 기준은 측정법이 아니라 "누가 답이 맞는지 확인하나" 다. 피팅·t 검정은 잔차와 χ² 가 출력 안에 있어 기계가 스스로 확인하고, 모형 고르기는 봇이 그럴싸하게 틀린다 | ADR-034 |
| "앞으로" 라고 하면 굳힌다. 굳히기 전에 **범위를 한 줄 되묻고**, "이번에는" 은 굳히지 않는다 | 자리(ADR-032)만 있고 **무엇이 언제 거기 들어가는지**가 없었다. 지시형의 진짜 위험은 승인이 아니라 **범위**다 | ADR-035 |
| 관찰형은 **세지 않는다.** 일지의 `## 되풀이된 말` 에 쌓고 `retro` 가 읽는다 | "세 번 받으면 제안한다" 는 규칙은 카운터를 부르고 카운터는 점수를, 점수는 등급을 부른다. 일지는 이미 매일 쓰이고 있었다 | ADR-035 · 036 |
| `retro` 스킬. 보고 넷 · **항목마다 근거** · 스킬 제안에는 판별 넷이 관문 | 읽는 시점을 정하지 않으면 관찰형 입구가 닫힌 채로 있는다. 그리고 회고의 가장 큰 위험은 봇이 패턴을 지어내는 것이다 | ADR-036 · 037 |
| `report` 가 `templates/` 를 읽고 **둘 이상이면 사람이 고른다** | 봇이 고르면 틀린 양식이 검증된 것처럼 보인다. 즉석 서식에는 붙는 경계심이 `templates/` 의 파일에는 안 붙는다 | ADR-035 |
| `paper/sections/<절>.md` · `<산출물>.review.md` | 설계에 자리가 없던 둘. 통과 전 초안과 원고를 갈라야 했고, F8 이 판정 파일을 요구한다 | ADR-017 |
| 알림이 Bearer+JSON 이 아니라 쿠키+multipart | 서버가 Bearer 를 안 읽고(401) 글 올리기는 multipart 만 받는다(406). `-F` 가 아니라 `--form-string` — `-F` 는 `@TO(` 를 파일 경로로 읽는다 | ADR-018 |
| 파일 뿌리를 deny 하지 않는다 | 파일 뿌리가 과제 저장소들의 부모라, 막으면 봇이 헌장을 못 쓴다. 0층 불변은 0444 와 git 이 지킨다 | ADR-019 |
| 산출물을 방에 첨부한다 | 경로만 주면 사람이 열러 가지 않는다 | ADR-020 |
| `rooms.json` 은 방 이름표. `last_seen_id` 를 믿지 않는다 | 재생 다섯에서 그 값이 끝까지 0 이었는데 놓친 글은 서버 재배달이 다 가져왔다. ADR-006 을 뒤집었다 | ADR-021 |
| 과제 하나 = 방 둘. 확정·발송 관문의 방아쇠가 방에서 표식으로 | 재생 실측에서 갈래 방이 값을 못 했고, 방이 합쳐지면 방으로는 공지와 평범한 답을 가를 수 없다 | ADR-022 |
| 확정 어휘를 봉투 벗긴 뒤에 본다 | 사람 글은 언제나 `@TO(…)` 로 시작한다. 안 벗기면 확정이 영영 안 된다 | ADR-008 보충 |
| 봇 `settings.json` 의 env 에 `MINIDISCORD_URL` | 없으면 훅이 기본 3000 을 보고 알림을 조용히 건너뛴다 | — |
| intake 가 서버 저장명의 uuid 를 벗긴다 | 안 벗기면 같은 파일이 이름만 다른 채 둘이 된다 (`.v2` 가 안 걸린다) | — |
| 압축 알림의 방을 `rooms.json` 의 본방에서 찾는다 | PreCompact 입력에 `chat_id` 가 없고 `setup.js` 는 설치 때 방 번호를 모른다 (방은 나중에 만든다) | — |
| 알림이 둘이다 (압축 직전 · 직후) | 압축 뒤에는 사람이 말을 걸어야 이어서 한다. 사람이 그 시점을 알아야 한다 | ADR-018 보충 |

## 9. 아직 그대로인 것 (알고 두는 것)

- `rooms.json` 의 `last_seen_id` 칸은 `setup.js` 가 0 으로 쓰고 아무도 갱신하지 않는다. 읽는 코드도 없다 (ADR-021).
- cron 두 줄은 `setup.js cron` 이 내기만 한다. crontab 에 붙이는 것은 사람이 한다 (`docs/launch.md` 8절).
- `bots/` 는 git 제외다. 봇 토큰은 서버 `bots` 표에도 평문으로 있어 잃어도 거기서 꺼낼 수 있다.
- `setup.js` 의 갈래 이름은 `common/hooks/places.js` 의 `갈래들` 한 자리에서 온다 (ADR-022). 훅의 확정 조건 ② 와 같은 값이어야 하기 때문이다.
- `git init` 이 실패해도 설치는 이어 간다 (ADR-023). 못 했다는 한 줄만 남긴다 — 커밋은 나중 일이고, 여기서 멈추면 봇을 못 띄운다.
- 알림 토큰도 못 받으면 설치는 이어 간다 (ADR-024). 못 받았다는 한 줄만 남기고, 사람이 손으로 `.env` 에 넣을 수 있다.
- `analysis/methods/` 는 `setup.js` 가 만들지 않는다. **굳는 길을 타는 봇이 처음 굳힐 때 만든다** (ADR-034 · 035). `analysis/` 는 있다.
- `test/skills.test.js` 가 재는 것은 **스킬 본문의 글자**다. 봇이 실제로 그렇게 행동하는지는 대본(C 층)이 잰다. 그래도 값을 하는 까닭은 스킬 본문이 PR 이라야 고쳐지기 때문이다 — 규격이 본문에서 빠지면 그 뒤로는 아무도 그것을 요구하지 않게 된다.
- `retro` 제안의 **채택률**은 이 맥에서 못 잰다. 쌓인 일지가 없다 (T4 의 것이다).
