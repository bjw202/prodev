# fixtures — meta 가 prodev 1단계에 주는 시험 자료 (2026-09-10)

만든 스크립트는 meta 세션의 임시 폴더에 있었고 여기엔 결과만 있다. 다시 만들 일이 있으면 이 README 의 규격대로 만든다.
**prodev 에 주는 법**: `find/` · `hooks/` · `chat/` · 이 README 를 `prodev/test/fixtures/` 로 복사한다 (1단계에서 복사됨, 관문에서 동일 확인). **`triggers.json` 은 T2.M 정답지라 주지 않는다.** 3단계 정답지(대본 채점표)는 `../scripts/` 에 따로 둔다.

## find/ — index.js · find.js 시험 (T1.3)
| 무엇 | 내용 |
|---|---|
| `cards/` 12 | E-0001~E-0009 · R-0001 · D-0001 정상 10 (E-0006 은 `status: void`, E-0007 의 `supersedes` 가 가리킨다) + **E-0010 은 머리말이 닫히지 않은 깨진 파일** |
| `wiki/` 2 | `yield-recovery.md` · `showerhead.md` (문장마다 카드 번호) |
| `inbox/20260825-yield-by-lot/files.md` | 4층 시험용 사이드카 (2026-09-10 고침 전엔 5층) |
| `charter.md` · `schedule.md` | **2026-09-11 더함.** 4층(과제 문서) 시험용. 헌장은 절 여섯(목적·목표·일정 요약·인원·예산), 일정은 표 행 셋. 낱말이 **절마다·행마다 겹치지 않게** 짰다 — 그래야 절·행 단위 매칭이 재진다 (ADR-027) |
| `questions.json` | 물음 **13**(과제 문서 셋 더함) · 조사 변형 3 · 없는 것 **2**(거짓 양성 하나 더함) = **18칸**, 기대 층과 경로. `index_기대` 에 표 행 수 11 · errors 1 · `next E` = E-0011 |

**2026-09-11 고침 (검색 안정성, ADR-026·027)**: 과제 문서 층이 **4번**(위키 뒤 · inbox 앞)으로 들어와 inbox 가 5, 대화가 6 으로 밀렸다.
`questions.json` 의 `particle_defects` 4→5 · `출석체크` 5→6 이 그래서 바뀌었고, 새 물음 넷이 더해졌다:
`예산`(charter.md#예산) · `중간 점검`(charter.md#일정 요약) · `장비 반입`(schedule.md) · **`예산 감광액`(안 걸려야 한다)**.
마지막 것이 이 판의 핵심이다 — 헌장의 **서로 다른 두 절**에 흩어진 낱말이라, 파일을 통째로 맞대면 걸리고 절 단위로 맞대면 안 걸린다.
층 분포 기대: `1:7 · 2:2 · 3:2 · 4:3 · 5:1 · 6:1 · -:2` (합 18).

주의 셋.
- 5층(대화)은 `../chat/minidiscord.db` 를 `MINIDISCORD_DB` 로 가리켜 `chat.js search` 로 잰다. 기대는 `#2` 가 **결과 안에 든다** (본문에 "출석체크". #1·#15·#43 도 걸린다).
- **2026-09-10 고침**: 층 순서를 1 index · 2 카드 · 3 위키 · **4 inbox files.md · 5 대화** 로 바꿨다 (ADR-016). 까닭: `particle_defects` 가 대화 층에서 봇이 붙여넣은 코드 17건에 걸려 files.md 에 닿지 못했다. meta 의 참고 판별기가 대화 층을 실제 DB 로 재지 않은 것이 원인이다 (fixture 결함, 제작 세션이 T1.3 착수 전에 찾음).
- "샤워헤드 교체 후 수율"·"샤워헤드교체는 수율이" 는 1층에서 E-0006(void) 과 E-0007 이 함께 걸린다. void 는 supersedes 를 따라가므로 결과는 E-0007 하나여야 한다.
- `next E` 는 파일 이름 `E-\d{4}` 의 최댓값 + 1 이다. 머리말이 깨진 E-0010 도 이름은 센다. 그래야 번호가 재사용되지 않는다.
- meta 가 참고 판별기(NFC · 조사 떼기 · 접기 · AND)로 14건 전부를 검산했다 (2026-09-10).

## hooks/ — pre-reply.js · pre-compact.js 시험 (T1.5)
| 무엇 | 내용 |
|---|---|
| `fixture.db` | minidiscord 스키마(2026-09-10 `db.ts`) 그대로. 사람 둘(김피엘 = PL, 김과제), 봇 하나, 방 둘(1 본방 · 2 `/files`. 옛 3 자료 · 4 보고는 archived, ADR-022), 글 10, 첨부 2 |
| `project/charter.md` | `PL: 김피엘` |
| `project/cards/E-0001~E-0007` | 확정 조건을 하나씩 어긴 카드들 (E-0001 만 정상) |
| `pre-reply-cases.json` | 17건 (ADR-022 판). `chat_id` · `text` 와 기대 exit. 막을 것 12 · 통과 5. 방아쇠는 첫 줄 표식 `[카드]` · `[발송]` |
| `transcript-40.jsonl` | 합성 기록 40턴. thinking 블록과 긴 tool_result 가 섞여 있다 |
| `handoff-compact-expected.md` | pre-compact 결과의 6칸에 들어 있어야 하는 것과 금지 |

환경변수 약속: `MINIDISCORD_DB=<fixture.db>` · `PRODEV_PROJECT=<project 폴더>` · `PRODEV_FAKE_CLAUDE=1`(pre-compact 가 `claude -p` 대신 고정 출력을 쓰게).
**2026-09-10 고침(R2 재생에서 발견)**: 확정 글 #3 · #10 과 "네" #7 의 본문을 실제 사람 글처럼 `@TO(봇) 확정` · `@TO(봇) 네` 로 바꿨다. 사람 글은 언제나 봉투(@TO)로 시작하므로 훅은 봉투를 벗긴 뒤 확정 어휘를 봐야 한다 (ADR-008 규칙 ③ 보충). 옛 fixture 는 봉투 없는 "확정" 이라 이 결함을 못 잡았다 — meta 의 자료 결함.
결재 검사의 표식은 `[발송]` 글의 `결재 #<id>` 이고 (어느 방이든, ADR-022), 그 글의 작성자가 charter 의 PL 과 같아야 통과다 (#5 는 PL, #6 은 과제원).

## chat/ — chat.js 시험 (T1.2)
`minidiscord.db` 하나. 2026-09-08~09 crew 방(수율개선-2026q3)의 실제 대화 377건을 WAL 을 합쳐 파일 하나로 만든 사본이다. 서버와 무관하다. 기대 건수는 prodev 가 이 사본으로 직접 세어 시험에 적는다 (예: `search 샤워헤드 --limit 4` → 4건, `around 300 --before 2 --after 2` → 5건, `show 2` 의 첨부 0).
