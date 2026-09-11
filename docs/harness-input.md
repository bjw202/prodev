# 하네스 입력 (T2.1)

`/harness:harness` 에 무엇을 주고, 나온 것을 무엇으로 확인하나. 이 파일은 **사람이 붙여넣는 대본**이다.

T2.2 는 **사람이** prodev 세션에서 `/harness:harness` 를 직접 돌린다. prodev 세션이 스스로 부르지 않는다
(TASKS 의 "하지 않는 것": 1단계 관문 전에 하네스를 돌리는 것 — 관문은 2026-09-10 에 통과했다).

---

## 1. 하네스에 줄 문장 (한 줄, 그대로)

```
minidiscord 채팅방에서 PL 과 과제원의 공정개발 과제를 비서 하나가 잇는다. 스킬 열둘(charter·intake·find·research·schedule·brief·journal·patent·paper·report·review·close)과 서브에이전트 여섯(data-reader·researcher·reviewer·patent-analyst·paper-writer·report-writer). 팀 모드 없음. 훅·settings 는 만들지 않는다.
```

## 2. 하네스가 읽을 문서 (경로 셋)

| 문서 | 어디를 | 무엇이 거기 있나 |
|---|---|---|
| `design/v1/PRD.md` | 전체 | 무엇을 왜 만드나. 시나리오 S0~S7 · 요구 F1~F13 · N1~N7 · 범위 밖 |
| `design/v1/ARCHITECTURE.md` | **6절 · 9절 · 10절** | 6절 흐름 넷(들이기 · 물음 · 리서치 · 켜기/압축) · 9절 에이전트 여섯 표 · 10절 스킬 열둘 이름 |
| `../meta/prodev-review/plans/2026-09-10-prodev-design.md` | **B 표 · C 표** | B(150~166행) 스킬 열둘의 트리거 말 · 입력 · 하는 일 · 남기는 것 · 사람 관문 · 부르는 것 / C(169~187행) 에이전트 여섯과 공통 규칙 셋 |

### 사람이 세션에 붙여넣을 한 줄

```
/harness:harness minidiscord 채팅방에서 PL 과 과제원의 공정개발 과제를 비서 하나가 잇는다. 스킬 열둘(charter·intake·find·research·schedule·brief·journal·patent·paper·report·review·close)과 서브에이전트 여섯(data-reader·researcher·reviewer·patent-analyst·paper-writer·report-writer). 팀 모드 없음. 훅·settings 는 만들지 않는다. 읽을 것: design/v1/PRD.md · design/v1/ARCHITECTURE.md (6절 흐름 · 9절 에이전트 · 10절 스킬) · ../meta/prodev-review/plans/2026-09-10-prodev-design.md 의 B 표(스킬 열둘: 트리거 말·입력·산출·관문·부르는 것)와 C 표(에이전트 여섯).
```

## 3. 이름 하나를 못 박는다 — 오케스트레이터 스킬

설계 문서 두 곳의 이름이 다르다. **`prodev-orchestrator` 가 맞다.**

| 어디 | 뭐라고 적혀 있나 |
|---|---|
| `design/v1/ARCHITECTURE.md` 10절 | `prodev-orchestrator` ← **이것을 쓴다** |
| `design/v1/TASKS.md` T2.2 · meta 의 T2.1 지시 | `prodev-orchestrator` |
| `prodev-design.md` B 표 끝줄 | `secretary-orchestrator` (옛 이름. 따르지 않는다) |

하네스가 `secretary-orchestrator` 를 만들었으면 이름을 고친다. 스킬은 열둘 + 이것 하나 = **열셋**이다.

## 4. 하네스가 만들 것

```
.claude/agents/    6개   data-reader · researcher · reviewer · patent-analyst · paper-writer · report-writer
.claude/skills/   13개   charter · intake · find · research · schedule · brief · journal
                         patent · paper · report · review · close · prodev-orchestrator
CLAUDE.md                하네스 포인터 절 + 비서 지침 열 줄 (ARCHITECTURE 7절)
```

## 5. 하네스가 **만들지 않을** 것 (있으면 지운다)

이미 1단계에서 손으로 만들었다. 하네스가 덮어쓰면 시험이 깨진다.

- `common/hooks/*` — 훅 셋 (session-start · pre-compact · pre-reply · places)
- `common/settings.template.json` — 봇 설정 틀
- `scripts/*` — 부품 아홉
- `.mcp.json` · MCP 배선 — `setup.js` 가 봇 폴더에 쓴다
- 팀 모드 · 팀원 정의 — 비서는 하나다

## 6. 하네스 뒤에 사람이 손으로 확인할 것 (T2.2 끝 조건)

| 확인 | 어떻게 |
|---|---|
| 에이전트 6 · 스킬 13 | `ls .claude/agents/ .claude/skills/` |
| CLAUDE.md ≤ 40줄, 포인터 + 지침 열 줄 | `wc -l CLAUDE.md` |
| 점검 모드 불일치 0 | 하네스 점검 모드(6-1 구조 · 6-4 트리거) 출력 |
| 스킬 본문이 **훅이 하는 일을 되풀이하지 않는다** | `grep -rn '세[어라]\|글자 수\|900자\|확정 다섯\|결재자' .claude/skills` → 걸리면 그 줄을 지운다 |
| 훅·settings·MCP 를 안 만들었다 | `git status` 에 `common/` `scripts/` 변경 없음 |

**왜 되풀이를 지우나**: 세는 것(count.js)과 막는 것(pre-reply)은 이미 기계가 한다.
지침에 같은 말을 또 적으면 두 곳이 언젠가 갈리고, 갈리면 봇은 지침 쪽을 믿는다.
crew 에서 "짧게 쓰라"가 두 세대 연속 실패한 자리가 이것이다 (ADR · VERIFICATION 예측표).

## 7. 하네스가 끝나면 meta 에 보낼 것

- 산출물 목록 (파일 경로 전부)
- `CLAUDE.md` 줄 수
- 점검 모드 출력 그대로

트리거 검증용 문장 20(should 10 · should-not 10)은 **meta 가 만든다**. prodev 는 만들지 않는다 (T2.M 관문에서 쓴다).
