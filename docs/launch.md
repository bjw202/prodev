# 기동 (T3.1)

시험 서버를 띄우고 비서 봇을 켜는 순서. **cwd · `--mcp-config` · `--settings` 조합을 여기서 못 박는다.**
`setup.js` 가 하는 일을 되풀이하지 않는다 — 사람이 손으로 해야 하는 자리와 확인하는 자리만 적는다.

바탕값은 2026-09-10 에 시험 서버(포트 3123 · 빈 DB)로 **직접 확인한 것**이다. 확인 못 한 자리는 그렇게 적었다.

---

## 0. 한눈에

```
① 시험 서버 (다른 포트 · 빈 DB · 봇 첨부 뿌리)      사람
② 계정 셋 (PL · 과제원 · 알림)                      사람
③ 봇 등록 · 설정 · 방 둘        node scripts/setup.js          사람이 돌린다
④ 봇 기동                       cd bots/<봇> && claude …        사람
⑤ 확인                          본방에 @TO 하나                 사람
⑥ 재생 토큰 (T3.2 용)           REPLAY_TOKEN_PL · _MEMBER      사람
```

---

## 1. 시험 서버 — 다른 포트, 빈 DB

살아 있는 방을 건드리지 않으려고 **포트와 데이터 폴더를 둘 다 바꾼다.** 포트만 바꾸면 같은 DB 를 쓴다.

```bash
cd <루트>/minidiscord
MINIDISCORD_PORT=3123 \
MINIDISCORD_DATA_DIR=<시험자리>/data \
MINIDISCORD_BOT_FILES_DIR=<과제 저장소들의 부모> \
  npx tsx server/src/index.ts
```

| 환경변수 | 무엇 | 왜 |
|---|---|---|
| `MINIDISCORD_PORT` | 3123 (본판 3000 과 다르게) | |
| `MINIDISCORD_DATA_DIR` | 시험 전용 빈 폴더 | DB(`<DATA_DIR>/minidiscord.db`)와 업로드가 여기 생긴다. 빈 폴더면 서버가 스스로 만든다 |
| `MINIDISCORD_BOT_FILES_DIR` | **과제 저장소들의 부모** | 봇이 첨부할 수 있는 뿌리다. 이 밖의 경로를 첨부하면 서버가 **조용히** 뺀다 (ARCHITECTURE 11절) |

확인: `curl -sS http://127.0.0.1:3123/api/health` → `{"ok":true}`

> 서버는 `server/dist` 를 만들지 않는다. `npx tsx server/src/index.ts` 로 띄운다 (`package.json` 의 `dev` 와 같다).

## 2. 계정 셋

비밀번호가 없다. **이름 하나가 계정**이고, 처음 보는 이름은 로그인할 때 생긴다.

| 계정 | 무엇에 쓰나 | 만드는 법 |
|---|---|---|
| PL (예: `김피엘`) | 발의 · 결재 · 보고 | 브라우저로 접속해 이름을 넣는다 |
| 과제원 (예: `김과제`) | 자료 올리기 · 문답 · 확정 | 〃 |
| `prodev-알림` | 훅이 "정리 중" 을 올릴 때 · cron 이 부를 때 | 〃 (**4절의 주의를 보라**) |

토큰이 필요하면 (T3.2 재생용):
```bash
curl -sS -i -X POST http://127.0.0.1:3123/api/auth/login \
  -H 'content-type: application/json' -d '{"username":"김피엘"}' | grep -i set-cookie
# set-cookie: md_session=<이 값이 토큰이다>; Path=/; HttpOnly; SameSite=Lax
```

## 3. 봇 등록 · 설정 · 방 둘

```bash
cd <루트>/prodev
MINIDISCORD_URL=http://127.0.0.1:3123 \
MINIDISCORD_DIR=<루트>/minidiscord \
MINIDISCORD_DB=<시험자리>/data/minidiscord.db \
MINIDISCORD_BOT_FILES_DIR=<과제 저장소들의 부모> \
  node scripts/setup.js --project <과제폴더>

# 그다음 (같은 환경변수로)
node scripts/setup.js rooms 시험
```

`setup.js` 가 만드는 것: `bots/prodev-<과제>-비서/` 아래 `.env`(토큰) · `.claude/settings.json`(훅 셋 배선 · env 셋 · 허용 목록) · `.mcp.json` · `rooms.json`.
방 둘은 `prodev-<과제>` (본방) 와 `prodev-<과제>/files` 다 (ADR-022).

> **지금 상태 (2026-09-10)**: ADR-022 는 설계 문서에서만 정해졌다. `setup.js` 는 아직 옛 방 묶음을 만든다 — 뒤따르는 코드 PR 이 들어간 뒤에 이 절대로 된다.

확인할 것: 출력 ④ "명령 N/N 풀림" 에 못 찾은 명령이 없어야 한다. 있으면 그 명령을 쓰는 일이 통째로 막힌다.

## 4. 봇 기동 — cwd · 옵션 조합 (여기가 이 문서의 핵심)

```bash
cd <루트>/prodev/bots/prodev-<과제>-비서        # ← cwd 는 봇 폴더다
claude \
  --setting-sources project,local \
  --strict-mcp-config \
  --mcp-config .mcp.json \
  --dangerously-load-development-channels server:minidiscord-channel
```

| 조각 | 왜 이래야 하나 |
|---|---|
| **cwd = 봇 폴더** | `.claude/settings.json` 과 `.mcp.json` 이 여기 있다. 훅·허용 목록·env 셋이 전부 이 설정에서 온다 |
| `--setting-sources project,local` | user 범위(`~/.claude.json`)를 읽지 않는다. 사람 PC 의 설정이 봇에 새지 않는다. **그래서 PATH 를 settings 의 `env` 에 박는다** (`setup.js` 가 한다) |
| `--strict-mcp-config` + `--mcp-config .mcp.json` | 이 파일에 적힌 MCP 서버 하나만 붙인다 |
| `--dangerously-load-development-channels server:minidiscord-channel` | 채널 플러그인을 개발 빌드로 붙인다 |
| `--settings` 는 **쓰지 않는다** | cwd 의 `.claude/settings.json` 이 이미 project 범위로 읽힌다. `--settings` 로 또 주면 어느 쪽이 이겼는지 나중에 못 가린다 |

스킬·에이전트는 **prodev 저장소 뿌리**(`bots/<봇>/` 의 두 단계 위)의 `.claude/skills` · `.claude/agents` 에 있다.
`CLAUDE.md` 도 거기 있다. 기동 뒤 세션에서 스킬 열셋이 보이는지 확인한다.

## 5. 확인 (T3.1 끝 조건)

1. 본방에 사람 계정으로 `@TO(prodev-<과제>-비서) 안녕` 을 올린다.
2. 봇이 그 방에 답한다.
3. 봇 세션에 스킬 열셋과 에이전트 여섯이 보인다.

## 6. T3.2 재생 토큰

```bash
export REPLAY_TOKEN_PL=<김피엘의 md_session 값>
export REPLAY_TOKEN_MEMBER=<김과제의 md_session 값>
node scripts/replay.js <대본.json> <기록.jsonl> --base http://127.0.0.1:3123
```
토큰이 없으면 재생은 **시작 전에** 죽는다. 반쯤 돌다 멈춘 대본은 다시 돌릴 수 없기 때문이다.

---

## 7. 알림 경로 — 쿠키 + multipart (ADR-018)

08:00 브리핑 · 18:30 일지 · 압축 직전 "정리 중" 은 전부 **알림 계정(사람 계정)** 이 올린다.
봇 글은 게이트웨이만 보낼 수 있기 때문이다.

서버에 글을 올리는 길은 하나뿐이다 — **쿠키 `md_session` + multipart.**
2026-09-10 에 시험 서버로 셋 다 넣어 보고 정했다:

| 보낸 꼴 | 결과 |
|---|---|
| JSON + `Authorization: Bearer` | **401** `{"error":"로그인이 필요합니다"}` |
| JSON + 쿠키 `md_session` | **406** `FST_INVALID_MULTIPART_CONTENT_TYPE` |
| **multipart + 쿠키 `md_session`** | **200** — 글이 남는다 |

### 7.1 토큰을 어디에 두나

```bash
# 알림 계정으로 한 번 로그인해 md_session 값을 받는다
curl -sS -i -X POST http://127.0.0.1:3123/api/auth/login \
  -H 'content-type: application/json' -d '{"username":"prodev-알림"}' | grep -i set-cookie
```

그 값을 **`PRODEV_NOTIFY_TOKEN`** 하나에 둔다. 이름이 하나인 까닭: 두 이름이면 한쪽만 넣었을 때
다른 쪽이 조용히 건너뛴다.

| 누가 읽나 | 어디서 읽나 |
|---|---|
| cron 두 줄 | crontab 을 띄운 셸의 환경변수 (`crontab -e` 위쪽에 `PRODEV_NOTIFY_TOKEN=…`) |
| `pre-compact` 훅 | ① 훅을 띄운 실행 환경의 `PRODEV_NOTIFY_TOKEN`, 없으면 ② **봇 폴더의 `.env`** (`bots/<봇>/.env`) |

**봇 설정(`settings.json`)의 `env` 에는 넣지 않는다.** 사람 계정의 토큰이 봇 문맥에 실리면
봇이 사람인 척 글을 쓸 수 있다. `setup.js` 도 넣지 않는다.

봇 폴더 `.env` 에 둘 때:
```
PRODEV_NOTIFY_TOKEN=<알림 계정의 md_session 값>
```

### 7.2 `-F` 가 아니라 `--form-string`

`curl -F 'body=@TO(…) 오늘 브리핑'` 은 **깨진다.** `-F` 는 `@` 로 시작하는 값을 파일 경로로 읽어
`curl: (26) Failed to open/read local data` 로 죽는다. 멘션은 언제나 `@TO(` 로 시작한다.
그래서 `--form-string` 을 쓴다. `--form-string` 은 `@` 도 `<` 도 해석하지 않는다.

시험이 이 자리를 지킨다 (`test/server/setup.test.js`): cron 두 줄에 `--form-string` 이 있고
`-F` 와 `Bearer` 가 없음을 보고, **낸 줄을 그대로 서버에 쏴 200 과 남은 글**을 확인한다.

---

## 8. 사람 손이 필요한 자리

| # | 사람이 하는 것 | 자동으로 안 되는 까닭 |
|---|---|---|
| 1 | 시험 서버를 띄운다 (1절) | 이 세션은 사람 PC 의 프로세스를 오래 붙잡지 않는다 |
| 2 | 브라우저로 계정 셋을 만든다 (2절) | 이름 로그인이라 사람이 한 번 들어와야 자연스럽다 |
| 3 | `setup.js` 를 돌린다 (3절) | 봇 토큰이 생기고 `.env` 에 적힌다. 사람이 값을 봐야 한다 |
| 4 | **봇을 켠다** (4절) | `claude` 세션은 사람이 띄운다. 승인이 뜨면 사람이 누른다 |
| 5 | 본방에 `@TO … 안녕` 을 올려 확인한다 (5절) | T3.1 의 끝 조건이다 |
| 6 | 토큰 셋을 넘긴다 (6·7절) | PL · 과제원 토큰은 meta 의 재생용, 알림 토큰은 훅·cron 용이다 |
| 8 | `MINIDISCORD_BOT_FILES_DIR` 을 어디로 할지 정한다 | 과제 저장소들의 부모여야 한다. 자리는 사람이 정한다 |

정해져서 빠진 둘:

- **7 (알림 경로를 어느 갈래로 고칠까)** — meta 가 ① 부르는 쪽 고치기로 정했다 (ADR-018). 고침은 끝났다.
- **9 (crontab 에 두 줄 붙이기)** — 3단계 시험에서는 붙이지 않는다. cron 글은 **대본에 있고 replay 가 대신 올린다.**
  실제 운영에 들어갈 때 붙인다.

## 9. 재생은 meta 가 돌린다

대본과 정답지는 meta 에 있다. prodev 가 내놓는 것은 `scripts/replay.js` 와 **켜진 봇** 둘뿐이다.
사람이 4·5 까지 끝내고 토큰 둘(`REPLAY_TOKEN_PL` · `REPLAY_TOKEN_MEMBER`)을 meta 에 주면 meta 가 R1 부터 돈다.

`manual` 걸음(사람이 봇 세션에서 `/compact` 를 치는 것 같은 자리)은 두 길로 기다린다:

| 어디서 도나 | 어떻게 알리나 |
|---|---|
| 사람 앞(터미널, stdin 이 TTY) | 화면에 할 일이 뜨고 Enter 를 누른다 |
| 배경(meta 가 돌림) | `<기록.jsonl>.manual-<걸음 id>.ok` 파일을 만든다. 재생이 2초마다 본다 |

---

## 10. 다른 기계로 옮길 때 (실전 이전)

이 절만 읽고 끝까지 갈 수 있게 적는다. 앞 절들은 시험 서버 기준이고, 여기는 **실전**이다.

### 10.1 무엇을 가져가나

`crew-workspace` 를 통째로 옮긴다. 그 안에서 **꼭 가져가야 하는 것**은 넷이다:

| 무엇 | 왜 |
|---|---|
| `prodev/` (이 저장소) | 부품 · 훅 · 스킬 · 에이전트 |
| `minidiscord/` | 서버와 채널 플러그인 |
| **과제 저장소들** (`<루트>/projects/<과제>/`) | 헌장 · 카드 · 위키 · 일지. **일한 것이 전부 여기 있다**. 이 경로는 **예시다** — 자리는 사람이 회사에서 정한다. 어디로 정하든 `MINIDISCORD_BOT_FILES_DIR` 은 **그 부모**여야 한다 (10.5) |
| `knowledge/` | 회사 지식 (있으면) |

**가져가지 않아도 되는 것:**

| 무엇 | 까닭 |
|---|---|
| `prodev/bots/` | `setup.js` 가 새 경로로 다시 만든다. **단, 10.2 를 먼저 읽어라 — 토큰 때문에 한 자리가 걸린다** |
| `prodev/node_modules/` · `minidiscord/node_modules/` | 새 기계에서 `npm install` |
| 시험용 minidiscord DB (`<시험 DATA_DIR>/`) | 시험 자료다. 실전은 빈 DB 로 시작한다 |
| `prodev/tmp/` · 과제 저장소의 `tmp/` | gitignore. 그림·임시다 |

### 10.2 봇 토큰 — 여기가 걸리는 자리다

봇 토큰은 **minidiscord 서버의 `bots` 표**와 **봇 폴더의 `.env`** 양쪽에 있다. 둘이 맞아야 봇이 붙는다.

| 어떻게 옮기나 | 무슨 일이 생기나 | 어떻게 하나 |
|---|---|---|
| **서버 DB 도 새로, `bots/` 도 안 가져감** (실전 첫 기동은 대개 이것) | 서버에 봇이 없다 | `setup.js` 가 새로 등록하고 `.env` 에 토큰을 쓴다. **할 일 없음** |
| **서버 DB 를 가져가고 `bots/` 는 안 가져감** | 서버에는 봇이 있는데 `.env` 에 토큰이 없다. `setup.js` 가 `주의 … 웹에서 봇을 지우고 다시 돌려라` 를 낸다. `.mcp.json` 이 안 만들어져 **봇이 안 뜬다** | 셋 중 하나. ① `bots/<봇>/.env` 만 따로 가져온다 (가장 쉽다) ② DB 에서 토큰을 꺼낸다 (아래) ③ 웹에서 봇을 지우고 `setup.js` 를 다시 돌린다 |
| **둘 다 가져감** | 그대로 맞는다 | `setup.js` 를 다시 돌려 경로만 새로 쓴다 |

DB 에서 토큰 꺼내기 (봇을 지우지 않아도 된다):
```bash
sqlite3 <DATA_DIR>/minidiscord.db "SELECT name, token FROM bots;"
```
그 값을 `prodev/bots/<봇>/.env` 에 `MINIDISCORD_TOKEN=<값>` 으로 넣고 `setup.js` 를 돌린다.

### 10.3 절대 경로는 어떻게 다시 생기나

옮기면 절대 경로가 든 파일 셋이 전부 옛 기계를 가리킨다. **`setup.js` 를 한 번 돌리면 셋 다 다시 쓰인다.**

| 파일 | 무엇이 절대 경로인가 | 다시 쓰이나 |
|---|---|---|
| `bots/<봇>/.claude/settings.json` | `PATH` · `PRODEV_PROJECT` · `MINIDISCORD_DB` · `MINIDISCORD_URL` · 훅 셋 명령 · statusline · 허용/거부 패턴 · `additionalDirectories` | **전부 다시 쓴다** (`setup.js`) |
| `bots/<봇>/.mcp.json` | 채널 플러그인 경로 · 서버 주소 | **다시 쓴다** — 단 `.env` 에 토큰이 있을 때만 (10.2) |
| `bots/<봇>/rooms.json` | (절대 경로 없음. 방 번호·이름) | `setup.js rooms <과제>` 가 다시 쓴다 |
| `bots/<봇>/.env` | (경로 없음. 토큰) | **다시 안 쓴다.** 10.2 대로 챙긴다 |

**손으로 고칠 것은 없다** — 셋 다 `setup.js` 와 `setup.js rooms` 가 만든다.
다만 `setup.js` 는 **환경변수를 보고** 값을 채우므로, 돌릴 때 새 기계의 값을 줘야 한다 (10.4).

과제 저장소 안(`charter.md` · 카드 · 일지)에는 절대 경로가 없다. 전부 과제 폴더 기준 상대 경로다.

### 10.4 새 기계에 있어야 하는 것

| 무엇 | 확인 | 없으면 |
|---|---|---|
| **Node ≥ 22** | `node -v` | `node:sqlite` 가 없어 `chat.js` · 훅이 전부 죽는다 |
| git | `git --version` | 커밋이 안 된다 |
| python3 | `python3 -V` | `peek.js` 의 xlsx·pdf 와 `plot.py` 가 죽는다 |
| python: `openpyxl` | `python3 -c "import openpyxl"` | xlsx 를 못 연다 (csv 는 된다) |
| python: `matplotlib` | `python3 -c "import matplotlib"` | 그림을 못 그린다. **죽지는 않는다** — "못 그렸다" 한 줄을 내고 넘어간다 |
| python: `pdfplumber` (선택) | `python3 -c "import pdfplumber"` | pdf 글을 못 읽는다. `pdftotext` 가 있으면 그것을 쓰고, 둘 다 없으면 쪽 수만 |
| `pdftotext` (선택) | `which pdftotext` | 위와 같다 |
| **Claude Code** | `claude --version` | 봇을 못 띄운다 |
| minidiscord 채널 플러그인 빌드 | `ls minidiscord/channel/dist/index.js` | `cd minidiscord && npm install && npm run build -w channel` |

**하네스 플러그인은 필요 없다.** 스킬 열셋과 에이전트 여섯은 이미 `prodev/.claude/` 안에 파일로 있다.
`/harness:harness` 는 그것을 **만들 때** 쓴 도구이고, 돌리는 데는 쓰지 않는다.

`npm install` 은 `prodev/` 와 `minidiscord/` 양쪽에서 한 번씩.

### 10.5 실전 서버 값

```bash
cd <루트>/minidiscord
MINIDISCORD_PORT=3000 \
MINIDISCORD_DATA_DIR=<루트>/minidiscord/server/data \
MINIDISCORD_BOT_FILES_DIR=<루트>/projects \
  npx tsx server/src/index.ts
```
포트 `3000` 과 경로 `<루트>/projects` 는 **예시다.** 회사에서 값이 정해지면 이 절의 예시를
실제 값으로 바꿔 두면 다음 사람이 그대로 쓸 수 있다.

| 값 | 실전에서 무엇으로 | 왜 |
|---|---|---|
| `MINIDISCORD_PORT` | 기본 3000. **회사 기계에서 그 포트를 이미 쓰면 사람이 정한다** | 과제원이 사내망 브라우저로 붙는 자리 |
| `MINIDISCORD_DATA_DIR` | 실전 전용 폴더 | DB 와 업로드가 여기 쌓인다. **시험 DB 를 재사용하지 않는다** |
| `MINIDISCORD_BOT_FILES_DIR` | **과제 저장소들의 부모** | 봇 첨부의 뿌리다. 이 밖의 경로를 첨부하면 서버가 **조용히** 뺀다. 과제 폴더가 그 안에 있어야 한다 (ADR-019). 10.1 에서 과제 자리를 어디로 정하든 여기는 그 부모다 |

**포트를 바꾸면 세 자리가 같아야 한다.** 하나만 어긋나면 조용히 안 된다:

| 어디 | 무엇을 |
|---|---|
| 서버를 띄울 때 | `MINIDISCORD_PORT=<포트>` |
| `setup.js` 를 돌릴 때 | `MINIDISCORD_URL=http://127.0.0.1:<포트>` — 이 값이 봇 `settings.json` 의 `env` 와 `.mcp.json` 의 서버 주소로 들어간다 |
| cron 두 줄 | `setup.js cron` 이 위의 `MINIDISCORD_URL` 로 줄을 만든다. **setup 을 옳은 포트로 돌린 뒤에** 그 출력을 붙인다 |

어긋났을 때 보이는 것: 봇은 뜨는데 방에 답이 없다(`.mcp.json` 이 딴 데를 본다) · 압축 알림이 `.log` 에 `못 보냄` 으로 남는다 · cron 시각에 브리핑이 안 온다.

서버는 사람이 껐다 켜는 것이므로, 실전에서는 부팅 때 자동으로 뜨게 하거나 켜는 절차를 사람이 정한다.

### 10.6 계정 셋과 토큰 넣는 자리

브라우저로 접속해 이름을 넣으면 계정이 생긴다 (비밀번호 없음).

| 계정 | 누구 | 토큰이 필요한가 |
|---|---|---|
| PL 이름 | 결재·발의·보고 | 아니오 (브라우저로 쓴다) |
| 과제원 이름들 | 자료·문답·확정 | 아니오 |
| `prodev-알림` | 훅과 cron 이 방에 글을 올릴 때 | **예** — 아래 |

알림 토큰 꺼내기:
```bash
curl -sS -i -X POST http://127.0.0.1:3000/api/auth/login \
  -H 'content-type: application/json' -d '{"username":"prodev-알림"}' | grep -i set-cookie
# set-cookie: md_session=<이 값>; Path=/; HttpOnly; SameSite=Lax
```

넣는 자리 **둘**. 이름은 `PRODEV_NOTIFY_TOKEN` 하나다 (ADR-018):

| 어디 | 무엇이 읽나 |
|---|---|
| `prodev/bots/<봇>/.env` 에 `PRODEV_NOTIFY_TOKEN=<값>` | 훅 둘 (압축 직전·직후 알림) |
| crontab 위쪽에 `PRODEV_NOTIFY_TOKEN=<값>` | cron 두 줄 (08:00 브리핑 · 18:30 일지) |

**봇 설정(`settings.json`)의 `env` 에는 넣지 않는다.** 사람 계정의 토큰이 봇 문맥에 실리면
봇이 사람인 척 글을 쓸 수 있다. `setup.js` 도 넣지 않는다.

### 10.7 cron 두 줄 — 실전에서는 붙인다

3단계 시험에서는 붙이지 않았다 (대본이 그 글을 대신 올렸다). **실전에서는 붙인다.**

```bash
node scripts/setup.js cron <과제>      # 두 줄을 화면에 낸다
crontab -e                             # 그 두 줄을 붙인다
```

붙일 때 고칠 것 둘:
- `<본방번호>` 를 실제 방 번호로 (`setup.js rooms` 출력이나 `node scripts/chat.js rooms` 에서 본다)
- crontab 위쪽에 `PRODEV_NOTIFY_TOKEN=<값>` 한 줄 (cron 은 로그인 셸의 환경변수를 물려받지 않는다)

붙인 뒤 확인: 다음 날 08:00 에 본방에 브리핑이 오는가. 안 오면 `curl` 줄을 손으로 쳐 본다 —
`-b "md_session=…"` 와 `--form-string` 이 맞는지 (ADR-018).

### 10.8 옮긴 뒤 확인 순서

위에서부터. 앞이 안 되면 뒤로 가지 않는다.

| # | 하는 것 | 되면 |
|---|---|---|
| 1 | `cd prodev && npm install` · `cd ../minidiscord && npm install && npm run build -w channel` | `ls minidiscord/channel/dist/index.js` |
| 2 | **저장소 사본에서** `npm test` | `pass 90 · fail 0` |
| 3 | 사본에서 `MINIDISCORD_DIR=<실제> npm run test:server` | `pass 20 · fail 0` |
| 4 | 서버를 띄운다 (10.5) | `curl -sS http://127.0.0.1:3000/api/health` → `{"ok":true}` |
| 5 | 브라우저로 계정 셋을 만든다 (10.6) | 방 화면이 보인다 |
| 6 | `node scripts/setup.js --project <루트>/projects/<과제>` | 출력 ④ 에 "명령 N/N 풀림" · 못 찾은 명령 0 · `bots/<봇>/.mcp.json` 이 생김 |
| 7 | `node scripts/setup.js rooms <과제>` | 방 둘 · `rooms.json` |
| 8 | 알림 토큰을 `.env` 에 넣는다 (10.6) | |
| 9 | 봇을 켠다 (4절 그대로) | 세션에 스킬 열셋과 에이전트 여섯이 보인다 |
| 10 | 본방에 `@TO(prodev-<과제>-비서) 안녕` | 봇이 그 방에 답한다 |
| 11 | 봇 세션에서 `/compact` 한 번 | 본방에 **글 둘**: "문맥을 정리 중입니다" → (압축) → "정리가 끝났습니다. 이어서 하려면 말을 걸어 주세요" |
| 12 | cron 두 줄을 붙인다 (10.7) | 다음 날 08:00 브리핑 |

**11 번 주의**: 대화가 얼마 없는 새 세션에서 `/compact` 를 치면 압축이 실제로 안 일어난다
("Not enough messages to compact"). 그러면 앞 글만 나가고 뒤 글이 안 온다 — 결함이 아니다.
봇과 몇 마디 주고받은 뒤에 쳐야 둘 다 본다. `bots/<봇>/handoff-compact.md.log` 에
`알림:보냄` 이 두 줄 찍히는지가 진짜 확인이다.

**2·3 번을 사본에서 돌리는 까닭**: `test:server` 는 `setup.js` 를 돌리는데, 그것은 저장소의
`bots/` 아래에 봇 폴더를 만든다. 실제 저장소에서 돌리면 사람이 쓰는 봇 폴더를 덮어쓴다
(2026-09-10 에 그렇게 날렸다). 사본에서 돌리는 법은 `docs/as-built.md` 7절에 있다.
