# prodev — 과제 비서

minidiscord 채팅방에서 PL 과 과제원의 공정개발 과제를 **비서 봇 하나**가 잇는다. 발의 · 자료 정리(2nd brain) · 리서치 · 일정 · 특허 · 논문 · 보고까지 한 자리에서. 세션이 꺼지거나 압축돼도 파일에서 되살아난다.

이 폴더는 2026-09-10 에 문서로 먼저 세웠다. 지금은 1단계(뼈대와 부품)를 만드는 중이다.

## 읽는 순서

| 문서 | 무엇 | 언제 읽나 |
|---|---|---|
| `PRD.md` | 무엇을 왜 만드나. 시나리오 S0~S7 · 요구 F1~F13 · N1~N7 · 범위 밖 | 처음 |
| `ARCHITECTURE.md` | 어떻게 생겼나. 방 둘 · 저장소 둘 · 2nd brain 층 다섯 · 흐름 넷 · 훅 셋 · 스크립트 · 에이전트 · 스킬 | 만들기 전 |
| `docs/as-built.md` | **지금 코드가 어떻게 생겼나.** 부품마다 한 줄 · 훅 · env 전부 · 시험 수 · 설계와 달라진 자리 | 고치기 전 |
| `docs/log.md` | **제작 일지.** 단계마다 한 일 · 커밋 범위 · 관문 결과 · 관문 밖에서 고친 것 | 흐름을 알고 싶을 때 |
| `ADR.md` | 왜 그렇게 정했나. 결정 스물넷과 근거 | "왜 이렇게 했지" 싶을 때 |
| `TASKS.md` | 누가 언제 무엇을. 단계 넷 · 관문 넷 · meta 와 prodev 의 경계 | 일을 고를 때 |
| `VERIFICATION.md` | 어떻게 검수하나. 층 A~D · 단위 시험 · 대본 다섯 · 예측표 | 관문마다 |

상세 설계(스킬 표 · 에이전트 표 · 검토에서 나온 수정 열)는 `../meta/prodev-review/plans/2026-09-10-prodev-design.md` 에 있고, 그 앞의 기획은 `../meta/prodev-review/plans/2026-09-10-pl-assistant.md` 다.

## 자리

| 자리 | 하는 것 |
|---|---|
| **prodev** (여기) | 만든다. `/harness:harness` 로 스킬·에이전트, 손으로 훅·스크립트·설정 |
| **meta** (`../meta/`) | 예측을 먼저 적고 검수한다. 고칠 때는 관문 사이에만 worktree + PR 로. 본 체크아웃은 손대지 않는다 |
| `../minidiscord/` | 채팅 서버. 여기서 고치지 않는다. 설정 한 줄만 |
| `../crew/` | 앞선 실험. 부품(count.js · 훅 · settings · retro-cost)을 가져온다 |

## 돌리는 법

```
node scripts/setup.js --project <과제이름>   과제 폴더(없으면 만들고 git init) · 봇 폴더 · 설정
npm test              서버 없이 도는 시험 (스크립트 · 훅)
npm run test:server   임시 minidiscord 서버를 띄우는 시험 (setup.js)
```

과제 폴더 자리는 `MINIDISCORD_BOT_FILES_DIR` 아래다 (ADR-023). 이름만 주면 setup 이 만든다.

## 있어야 하는 것

| 무엇 | 판 | 없으면 |
|---|---|---|
| node | ≥ 22 (`node:sqlite` · `node --test`) | 안 돈다 |
| python3 | 3.9+ | peek 의 xlsx 와 plot.py 만 안 된다 |

python 꾸러미는 **있으면 쓰고 없으면 그 부분만 건너뛴다**. 스크립트는 죽지 않고 "못 읽었다: <까닭>" 한 줄을 낸다.

| 꾸러미 · 도구 | 쓰는 곳 | 없을 때 | 들이는 법 |
|---|---|---|---|
| `openpyxl` | `peek.js` 의 xlsx | "못 읽었다: openpyxl 이 없다" | `pip install openpyxl` |
| `matplotlib` | `plot.py` | "못 그렸다: matplotlib 이 없다" | `pip install matplotlib` |
| `pdfplumber` | `peek.js` 의 pdf 글·표 | `pdftotext` 로 넘어간다 | `pip install pdfplumber` |
| `pdftotext` (poppler) | pdfplumber 가 없을 때의 pdf 글 | 쪽 수만 낸다 | `brew install poppler` |

csv · tsv · jpg · png 와 pdf 쪽 수는 node 가 직접 읽는다. 도우미가 하나도 없어도 이것들은 된다.

## 한 줄 규칙 셋
- 세는 것과 막는 것은 기계, 정하는 것은 지침.
- 목표는 밖에(예측 먼저), 결과는 안에.
- 봇에게 판정을 맡기지 않는다.
