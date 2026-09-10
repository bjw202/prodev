# 기동 (T3.1)

시험 서버를 띄우고 비서 봇을 켜는 순서. **cwd · `--mcp-config` · `--settings` 조합을 여기서 못 박는다.**
`setup.js` 가 하는 일을 되풀이하지 않는다 — 사람이 손으로 해야 하는 자리와 확인하는 자리만 적는다.

바탕값은 2026-09-10 에 시험 서버(포트 3123 · 빈 DB)로 **직접 확인한 것**이다. 확인 못 한 자리는 그렇게 적었다.

---

## 0. 한눈에

```
① 시험 서버 (다른 포트 · 빈 DB · 봇 첨부 뿌리)      사람
② 계정 셋 (PL · 과제원 · 알림)                      사람
③ 봇 등록 · 설정 · 방 일곱      node scripts/setup.js          사람이 돌린다
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

## 3. 봇 등록 · 설정 · 방 일곱

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
방 일곱은 `prodev-<과제>` 와 `prodev-<과제>/{들이기,자료,리서치,특허,논문,보고}` 다.

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

## 7. 확인하다 걸린 것 — 사람이 정해야 하는 자리

### 7.1 cron 과 훅의 알림이 이 서버에 글을 못 올린다 (막힘)

`scripts/setup.js cron` 이 내는 crontab 두 줄과 `common/hooks/pre-compact.js` 의 알림은 이렇게 보낸다:

```
-H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" -d '{"text":"…"}'
```

시험 서버에 그대로 넣어 본 결과(2026-09-10):

| 보낸 꼴 | 결과 |
|---|---|
| JSON + `Authorization: Bearer` | **401** `{"error":"로그인이 필요합니다"}` |
| JSON + 쿠키 `md_session` | **406** `FST_INVALID_MULTIPART_CONTENT_TYPE` |
| **multipart + 쿠키 `md_session`** | **200** — 글이 올라간다 |

서버는 인증을 쿠키 `md_session` 하나로만 받고(`server/src/auth.ts` 의 `requireAuth`),
글 올리기 라우트는 multipart 만 읽는다(`routes-messages.ts` 의 `req.parts()`).
그래서 지금 꼴로는 **08:00 브리핑도 18:30 일지도 오지 않고**, 압축 직전 "정리 중" 알림도 안 나간다.
(훅은 fail-open 이라 압축 자체는 되고, 알림만 조용히 빠진다.)

고칠 자리는 셋 중 하나다 — **어느 쪽인지는 사람·meta 가 정한다:**

| 갈래 | 무엇을 고치나 | 값 |
|---|---|---|
| ① 부르는 쪽을 고친다 | cron 줄과 훅의 알림을 `-b "md_session=<토큰>" -F 'body=…'` 로 | prodev 안에서 끝난다. 서버를 안 건드린다 |
| ② 서버가 Bearer + JSON 을 받게 | minidiscord 서버 수정 | 범위 밖이다 (PRD 6절 · ARCHITECTURE 11절) |
| ③ 알림을 없앤다 | cron 을 사람이 직접 치는 것으로, "정리 중" 은 안 올림 | S0 의 08:00 · 18:30 이 사라진다 |

권하는 것은 ①이다. 서버를 안 건드리고, 확인한 대로 200 이 나온다.

### 7.2 알림 토큰의 환경변수 이름이 두 곳에서 다르다

| 어디 | 이름 |
|---|---|
| `scripts/setup.js` 262~264행 (crontab 줄) | `PRODEV_NOTIFY_TOKEN` |
| `common/hooks/pre-compact.js` 121행 | `MINIDISCORD_NOTIFY_TOKEN` |

하나만 넣으면 다른 쪽이 조용히 건너뛴다. 7.1 을 고칠 때 이름도 하나로 맞춰야 한다.

> 7.1 · 7.2 는 **훅과 스크립트**의 자리라 이 세션이 손대지 않았다 (1단계 관문을 통과한 산출물이다).
> meta 의 지시를 받아 고친다.

---

## 8. 사람 손이 필요한 자리 (목록)

| # | 사람이 하는 것 | 자동으로 안 되는 까닭 |
|---|---|---|
| 1 | 시험 서버를 띄운다 (1절) | 이 세션은 사람 PC 의 프로세스를 오래 붙잡지 않는다 |
| 2 | 브라우저로 계정 셋을 만든다 (2절) | 이름 로그인이라 사람이 한 번 들어와야 자연스럽다 (API 로도 되지만 사람 계정임을 사람이 확인해야 한다) |
| 3 | `setup.js` 를 돌린다 (3절) | 봇 토큰이 생기고 `.env` 에 적힌다. 사람이 값을 봐야 한다 |
| 4 | **봇을 켠다** (4절) | `claude` 세션은 사람이 띄운다. 승인이 뜨면 사람이 누른다 |
| 5 | 본방에 `@TO … 안녕` 을 올려 확인한다 (5절) | T3.1 의 끝 조건이다 |
| 6 | 토큰 둘을 `REPLAY_TOKEN_*` 에 넣는다 (6절) | 사람 계정의 세션 토큰이다 |
| 7 | **7.1 을 어느 갈래로 고칠지 정한다** | 설계 결정이다. 이 세션이 혼자 정하지 않는다 |
| 8 | `MINIDISCORD_BOT_FILES_DIR` 을 어디로 할지 정한다 | 과제 저장소들의 부모여야 한다. 자리는 사람이 정한다 |
| 9 | cron 두 줄을 crontab 에 붙인다 (7.1 을 고친 뒤) | PL PC 의 crontab 이다 |
