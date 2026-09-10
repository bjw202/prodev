# prodev — 만드는 순서 (TASKS)

이 문서는 "다음에 무엇을 하나"의 유일한 자리다. 한 작업에 한 절. 절마다 **누가**(meta 지시 / prodev 직접 / 사람) · 입력 · 산출물 · **끝 조건**(검수 가능한 것만) · 크기.

## 0. 자리 규칙 — 누가 무엇을 하나

| 자리 | 하는 것 | 하지 않는 것 |
|---|---|---|
| **meta** (`../meta/`, 검수 세션) | 예측을 숫자로 먼저 적는다 · 검수표를 채운다 · 시험 자료와 정답지를 준다 · 대본(replay)을 쓴다 · minidiscord 요청을 적는다 · EVOLUTION 식으로 결과를 남긴다 | 관문 중에는 prodev 를 고치지 않는다 (관문 사이에 예측을 적고 worktree + PR 로) · 본 체크아웃을 손대지 않는다 · 봇에게 판정을 맡기지 않는다 |
| **prodev** (이 저장소, 제작 세션) | 스크립트·훅·설정·setup 을 만든다 · `/harness:harness` 를 돌려 스킬·에이전트를 만든다 · 단위 시험을 쓴다 · 봇을 띄운다 | 예측을 정하지 않는다 · 자기 검수표를 스스로 채우지 않는다 · 검수 자료의 정답지를 읽지 않는다 |
| **사람** | 결정 · 결재 · 저장소 만들기 · 봇 등록 토큰 · 사람 역할 시험 참여 | |

**순서의 원칙**: 가장 모르는 것부터. 단위 시험이 되는 것(스크립트·훅)을 먼저 굳히고, 판단이 드는 것(스킬·에이전트)은 그 위에 얹고, 사람이 드는 시험(시나리오)은 마지막에.

각 단계의 끝에 **meta 검수 관문**이 있다. 통과 전에 다음 단계로 가지 않는다.

---

## 1단계 — 뼈대와 부품 (판단 없는 것부터)

### T1.1 저장소 · 부품 옮기기 — prodev 직접
- 입력: `../crew/scripts/count.js` · `../crew/common/{hooks/session-start.js,settings.template.json,statusline.sh}` · `../crew/scripts/retro-cost.js` · `../meta/prodev-review/plans/proto/chat.js`
- 산출: `scripts/` `common/` 에 그대로 복사 + `test/` 뼈대 (`node --test`) + `.gitignore`(bots/*/, tmp/, *.log)
- 끝 조건: `node scripts/count.js` 와 `node scripts/chat.js rooms` 가 사본 DB 로 돈다. `npm test` 가 빈 초록.
- 크기: 반나절

### T1.2 chat.js 손질 — prodev 직접
- 할 일: `search` 를 여러 낱말 AND 로 · `--json` 출력 · NFC
- 끝 조건: `test/chat.test.js` — fixture DB(사본)로 여섯 명령 + AND 2건 + NFC 1건 초록
- 크기: 반나절

### T1.3 index.js · find.js — prodev 직접
- 할 일: 머리말 파서(YAML 부분집합: 스칼라·리스트·`{k: v}`) → `index.md`·`index.json` (`errors[]`, `next E`) · find.js 다섯 층 + 조사 떼기 + 접기 + void 따라가기 + `find.log`
- 끝 조건: `test/index.test.js` — fixture 카드 12(정상 10 · 깨진 머리말 1 · void 1): 표 행 수 = 11, errors = 1, exit 1. `test/find.test.js` — 물음 10 개 → 기대 층·경로 전부 일치 (fixture 는 meta 가 준다, T1.M)
- 크기: 1일

### T1.4 peek.js · intake-copy.js · plot.py — prodev 직접
- 끝 조건: csv/xlsx/pdf/jpg 각 1건 peek 출력 · 같은 이름 두 번 → `.v2` 와 SHA-256 두 줄 · plot 이 `tmp/` 에 png
- 크기: 반나절

### T1.5 훅 셋 — prodev 직접
- session-start: cwd 전제 제거(`PRODEV_BOT` · `PRODEV_PROJECT` env) · 6.4 순서 · 열린 실 전부 · 마지막 일지 날짜
- pre-compact: 기록 꼬리(마지막 40턴, tool_result 300자, thinking 제외) → `claude -p --model sonnet` (빈 cwd, `PRODEV_HOOK=1`) → `handoff-compact.md` 6칸 · 알림 계정으로 방에 한 줄 · timeout 180 · fail-open
- pre-reply: ARCHITECTURE 8절 표 그대로. exit 2 + 이유 한 줄
- 끝 조건: `test/hooks.test.js` — stdin JSON fixture 로 ① session-start 가 파일 없음/있음/잘림 셋을 구분 ② pre-compact 가 기록 fixture 로 6칸 인수인계서를 만든다(모의 claude: env `PRODEV_FAKE_CLAUDE=1` 로 고정 출력) ③ pre-reply 가 **막아야 할 다섯**(chat_id 없음 · 901자 · 확정 없음 · 봇 글 확정 · 결재자 불일치)과 **통과할 셋**을 정확히 가른다
- 크기: 1.5일

### T1.6 setup.js — prodev 직접
- 할 일: crew 것에서 봇 하나 · `bots/<이름>/` 생성(settings.json 에 env 셋 · 훅 배선 · 허용 목록 = crew 목록 + python3 + 회차 5 의 31건) · `rooms <과제>` (방 일곱 + 봇 참여, API) · `cron` (crontab 두 줄 출력) · `archive <방>`
- 끝 조건: 서버를 띄운 시험 환경에서 `setup.js` → `setup.js rooms 시험과제` → `GET /api/rooms` 에 방 일곱, 봇 참여 일곱
- 크기: 1일

### T1.M 1단계 관문 — meta 지시
- meta 가 준다 (제작 전에): find.js fixture(카드 12 + 물음 10 + 기대 답), 훅 fixture(기록 JSONL 사본 1 · DB 사본 1)
- meta 가 확인한다: `npm test` 초록 개수 ≥ 25 · `VERIFICATION.md` 2절 표의 스크립트·훅 줄 전부 "확인" · 예측 `../meta/prodev-review/predictions/prodev-prediction.md` 가 **이 단계 전에** 적혀 있다
- 통과 못 하면: 해당 T 로 돌아간다. 다음 단계로 가지 않는다

---

## 2단계 — 하네스 (판단이 드는 것)

### T2.1 하네스 입력 준비 — meta 지시, prodev 직접
- 할 일: `/harness:harness` 에 줄 **문장 하나** + 이 저장소의 `PRD.md`·`ARCHITECTURE.md`·`../meta/prodev-review/plans/2026-09-10-prodev-design.md`(B·C 표) 경로. 문장(안): "minidiscord 채팅방에서 PL 과 과제원의 공정개발 과제를 비서 하나가 잇는다. 스킬 열둘(charter·intake·find·research·schedule·brief·journal·patent·paper·report·review·close)과 서브에이전트 여섯(data-reader·researcher·reviewer·patent-analyst·paper-writer·report-writer). 팀 모드 없음. 훅·settings 는 만들지 않는다."
- 끝 조건: 문장과 경로가 `docs/harness-input.md` 에 있다

### T2.2 하네스 실행 — prodev 직접 (사람이 세션에서 `/harness:harness`)
- 산출: `.claude/agents/` 6 · `.claude/skills/` 13 · CLAUDE.md 포인터 절
- 끝 조건: 하네스 점검 모드(6-1 구조 · 6-4 트리거)가 불일치 0 · 트리거 should 10 / should-not 10 전부 맞음. CLAUDE.md ≤ 40줄 (포인터 + 지침 열 줄)
- 주의: 하네스가 만든 스킬 본문에 **훅이 하는 일을 지침으로 되풀이하지 않는다** (세기·확정 판별). 있으면 지운다
- 크기: 1일

### T2.3 스킬 본문 대조 — prodev 직접
- 할 일: 스킬 열둘의 본문이 `ARCHITECTURE.md` 6절 흐름과 `prodev-design.md` B 표의 입력·산출·관문·부르는 것과 일치하는지 표로 대조. 다르면 스킬을 고친다 (설계를 고치지 않는다. 설계를 고칠 이유가 있으면 ADR 에 절을 더하고 meta 에 알린다)
- 끝 조건: `docs/skill-matrix.md` — 스킬 × (입력·산출·관문·에이전트·스크립트) 12행 전부 ✓

### T2.M 2단계 관문 — meta 지시
- meta 가 확인한다: 점검 모드 출력 · skill-matrix · CLAUDE.md 줄 수 · 스킬 본문에 "세라/센다" 문장 0 (`grep -n '세[어라]' .claude/skills -r`)

---

## 3단계 — 첫 기동과 시나리오 시험 (사람이 드는 것)

### T3.1 시험 환경 — 사람 + prodev 직접
- 할 일: minidiscord 시험 서버(포트 다르게, 빈 DB) · `MINIDISCORD_BOT_FILES_DIR` · 알림 계정 · 봇 등록 · `setup.js rooms prodev-시험` · 봇 기동 · 칩 🟢
- 끝 조건: 본방 `@TO(비서) 안녕` 에 답 · 스킬 목록이 세션에 보임 (cwd·`--mcp-config`·`--settings` 조합을 `docs/launch.md` 에 못 박는다)

### T3.2 대본 재생 (replay) — meta 지시, prodev 가 `replay.js` 제공
- meta 가 준다: 대본 JSON 다섯 (`VERIFICATION.md` 4절): 발의 · 들이기(회차 4 성적서 34행, 함정 넷) · 물음 20 · 리서치 · 압축/재기동
- prodev 가 준다: `scripts/replay.js` — 대본의 사람 글을 API 로 순서대로 올리고 봇 답을 기다려(SSE 또는 폴링, 상한 5분) 기록 JSONL 로
- 끝 조건: 대본 다섯의 기록 파일이 `../meta/prodev-review/runs/` 에 있다. **prodev 는 정답지를 읽지 않는다**

### T3.3 사람 시험 — 사람 (PL 역할 1 · 과제원 역할 1, 반나절)
- 할 일: 실제처럼 파일을 올리고, 고치고, 묻고, 리서치를 시키고, 세션을 껐다 켠다
- 끝 조건: 기록이 남는다. 느낌 메모 열 줄 (검수표에는 안 들어간다. 참고만)

### T3.M 3단계 관문 — meta 지시
- meta 가 채운다: `VERIFICATION.md` 3·4·5절 표 전부 · 예측 대 실측 · `retro-cost.js --record`
- 판정: 예측 열 중 여덟 이상 맞으면 통과. 아니면 빗나간 열마다 원인을 적고 해당 T 로

---

## 4단계 — 실전 과제 하나 (2주)

### T4.1 과제 하나에 붙인다 — 사람
- 실제 과제 · 실제 과제원 둘 · 2주. 비서는 주간에 필요할 때 켠다
- meta 는 주 1회 `retro-cost.js --record` · find.log · 카드 수 · 카드 없는 첨부 수를 적는다

### T4.M 4단계 관문 — meta 지시
- 2주 뒤 예측표 재판정 · ADR-004(위키 즉시 갱신)의 재는 조건 확인 · EVOLUTION 절 하나 · 다음 회차 결정은 사람

---

## 크기 합계 (제작만)
1단계 4.5일 · 2단계 2일 · 3단계 1.5일 + 사람 반나절 · 4단계 2주 운영. 예측이 맞는지는 3단계 관문에서 처음 안다.

## 하지 않는 것
- 1단계 관문 전에 하네스를 돌리는 것 (훅 없이 스킬을 시험하면 지침이 세기 시작한다)
- prodev 세션이 자기 검수표를 채우는 것
- 시험 중 규칙을 고치는 것 (관문에서만 고친다)
