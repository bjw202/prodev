#!/usr/bin/env node
// setup.js — 사람이 돌린다. 봇은 이 파일을 쓰지 않는다.
//
//   node scripts/setup.js [--project <이름|폴더>]  설치: 과제 폴더(없으면 만들고 git init) · 봇 폴더 · settings(훅 배선 · env 셋) · .env · .mcp.json
//   node scripts/setup.js rooms <과제>             방 둘을 만들고 봇을 둘 다 참여시킨다 (API)
//   node scripts/setup.js cron                     crontab 두 줄을 낸다 (08:00 브리핑 · 18:30 일지, 쿠키 + multipart — ADR-018)
//   node scripts/setup.js archive <방>             방 하나를 보관한다
//
// crew 의 setup.js 에서 왔다. 다른 점 셋:
//   ① 봇이 다섯이 아니라 **하나**다 (prodev-<과제>-bot)
//   ② 방을 하나가 아니라 **둘**로 연다 — 본방과 <과제>/files (ARCHITECTURE 2절 · ADR-022)
//   ③ 훅이 하나가 아니라 셋이다 (session-start · pre-compact · pre-reply)
//
// 자리: minidiscord 는 기본 <저장소>/../minidiscord. 다른 곳이면 MINIDISCORD_DIR.
//       서버 주소는 MINIDISCORD_URL (기본 http://127.0.0.1:3000).

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PRODEV = path.resolve(__dirname, '..');
const ROOT = path.dirname(PRODEV);
const MINIDISCORD = process.env.MINIDISCORD_DIR || path.join(ROOT, 'minidiscord');
const CHANNEL = path.join(MINIDISCORD, 'channel', 'dist', 'index.js');
const URL_ = (process.env.MINIDISCORD_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const WS = process.env.MINIDISCORD_SERVER || URL_.replace(/^http/, 'ws') + '/bot';
const AUTOCOMPACT = Number(process.env.PRODEV_AUTOCOMPACT || 650000);
const CLAUDE_ARGS = ['--setting-sources', 'project,local', '--strict-mcp-config', '--mcp-config', '.mcp.json',
  '--dangerously-load-development-channels', 'server:minidiscord-channel'];

// 과제 하나 = 방 둘. 본방은 접미어가 없고 나머지 하나가 <접두어>/files 다 (ARCHITECTURE 2절 · ADR-022).
// 이름은 places.js 한 자리에서 온다 — 훅(pre-reply)의 확정 조건 ② 와 같은 값이어야 한다.
const { 갈래들: 갈래 } = require('../common/hooks/places.js');

// ── 허용 목록은 왜 이 꼴인가 ──────────────────────────────────────────────
// 바탕은 ../crew/common/settings.template.json 의 33건이었고, 거기에 회차 5 의 승인 31회를 덮는 것을
// 더해 41건이었다. 31회는 항목 목록이 아니라 원인 넷이다 (../meta/crew-eval/notes/round-5-result.md 86~91행).
// 승인이 뜨면 그 글이 마지막 to 방에 남아 방이 더러워진다. 그래서 미리 연다.
//
// **거기서 셸 도구 스물하나를 뺐다** (ADR-033). 지금은 22건이고 그중 Bash 는 열이다.
// 뺀 까닭은 하나다 — 내장 도구가 이미 덮으므로 **봇이 할 수 있는 일이 줄지 않는다.**
//   grep · find                                                  → Grep · Glob (allow 에 이름으로 넣었다)
//   cat · head · tail · sed · awk · sort · uniq · wc · cut · tr
//   · diff · stat · file                                         → Read
//   cp · chmod · shasum · sha256sum                              → intake-copy.js 가 node 로 한다
//                                                                  (복사 · 0444 잠금 · SHA-256)
//   basename · dirname                                           → 경로는 봇이 그냥 안다
// 스킬 열셋과 에이전트 여섯의 본문이 부르는 바깥 명령은 node · python3 · git 뿐이라 하나도 안 막힌다.
//
// 남은 열은 회차 5 의 원인 넷 가운데 아직 사는 것을 덮는다:
//   원인 1  cd … && … · pwd; ls 로 이어 붙임          9회
//           → Bash(cd:*) · Bash(pwd) · Bash(ls:*) · Bash(echo:*)
//           주의: 이어 붙인 명령 한 줄은 통째로 하나로 보이므로 허용 목록으로 다 덮이지 않는다.
//           진짜 고침은 "이어 붙이지 않는다" 규칙이고 목록은 조각만 연다. 회차 5 도 규칙 쪽이 먹었다.
//   원인 2  python3 - <<'PY'                          6회  → Bash(python3:*)
//   원인 3  채팅 서버 업로드 폴더 읽기 (wc·ls·cp·sha)  8회
//           → additionalDirectories 에 업로드 폴더 + Read · Grep · Glob
//           봇 폴더 밖이라 목록에 있어도 물었다. 폴더를 열어 줘야 안 묻는다. 쓰기는 deny 로 막는다 (원본 불변).
//   원인 4  gh pr create · git · 그 밖                 8회  → Bash(gh:*) · Bash(git:*) · Bash(node:*)
//                                                            · Bash(mkdir:*) · Bash(date:*)
// 지우는 명령(rm · mv)은 열지 않는다 — 0층은 불변이고, 지우지 않고 void 로 남긴다.

// ── PATH — crew 에서 그대로 가져온다. 까닭도 그대로다 ──────────────────────
// 봇은 --setting-sources project,local 로 떠서 user 범위를 읽지 않는다. ~/.claude.json 의 env.PATH 가
// "$PATH:..." 처럼 글자 그대로 들어 있으면 /usr/bin 과 /bin 이 통째로 빠져 git·ls·grep 이 전부 죽는다.
// 설정의 env 값은 셸을 거치지 않는다. 그래서 변수 참조가 든 조각을 버리고 실제로 있는 폴더만 남긴다.
const STD_DIRS = process.platform === 'win32'
  ? [path.join(process.env.SystemRoot || 'C:\\Windows', 'System32'), process.env.SystemRoot || 'C:\\Windows']
  : ['/usr/bin', '/bin', '/usr/sbin', '/sbin', '/usr/local/bin', '/opt/homebrew/bin'];
const NEEDED = process.platform === 'win32'
  ? ['git.exe', 'node.exe']
  : ['git', 'node', 'ls', 'cat', 'head', 'tail', 'grep', 'sed', 'awk', 'wc', 'find', 'sort', 'date', 'python3'];

function buildPath() {
  const seen = new Set(); const out = [];
  const push = d => {
    if (!d || d.includes('$') || d.includes('%') || !path.isAbsolute(d)) return;
    const k = process.platform === 'win32' ? d.toLowerCase() : d;
    if (seen.has(k) || !fs.existsSync(d)) return;
    seen.add(k); out.push(d);
  };
  for (const d of (process.env.PATH || '').split(path.delimiter)) push(d);
  for (const d of STD_DIRS) push(d);
  return out.join(path.delimiter);
}

function probe(pathValue) {
  const dirs = pathValue.split(path.delimiter);
  const exts = process.platform === 'win32' ? ['', '.exe', '.cmd'] : [''];
  return NEEDED.map(name => {
    for (const d of dirs) for (const e of exts) {
      try { fs.accessSync(path.join(d, name + e), fs.constants.X_OK); return { name, dir: d }; } catch {}
    }
    return { name, dir: null };
  });
}

const BOT_PATH = buildPath();
process.env.PATH = BOT_PATH;

// ── Git Bash — 윈도우에서 Bash 도구가 무엇을 부르는가 (ADR-033) ────────────
// 봇은 --setting-sources project,local 이라 user 범위 설정을 못 읽는다. 그래서 WINDOWS.md 126행이
// 적어 둔 길을 사람이 손으로 넣는 대신 **setup 이 봇 설정에 박는다.** 환경변수로 덮을 수 있다.
// 맥·리눅스에서도 키는 남고 값도 비지 않는다 — 그 자리에 Git Bash 가 없으면 Claude Code 가 안 볼 뿐이라 무해하다.
const GIT_BASH = process.env.CLAUDE_CODE_GIT_BASH_PATH || 'C:\\Program Files\\Git\\bin\\bash.exe';

// ── 이름과 자리 ───────────────────────────────────────────

// --project 는 **이름**일 수도 **경로**일 수도 있다 (ADR-023).
//   경로   '/' 가 들어 있거나 이미 있는 자리 → 그대로 쓴다 (지금까지와 같다)
//   이름만 → <파일 뿌리>/<이름>. 과제 저장소는 언제나 파일 뿌리 안이어야 봇이 첨부할 수 있다 (ADR-019).
// 사람이 "과제 하나 = projects 아래 폴더 하나" 로 정했으므로, 자리를 외우는 것은 사람이 아니라 setup 이다.
function projectDir(opt) {
  const p = opt.project || process.env.PRODEV_PROJECT;
  if (!p) throw new Error('과제 폴더를 모른다. --project <이름 또는 폴더> 를 주거나 PRODEV_PROJECT 를 설정하라');
  if (p.includes('/') || p.includes(path.sep) || fs.existsSync(p)) return path.resolve(p);
  const 뿌리 = process.env.MINIDISCORD_BOT_FILES_DIR;
  if (!뿌리) {
    throw new Error(`--project 에 이름만("${p}") 주려면 MINIDISCORD_BOT_FILES_DIR 이 있어야 한다 (과제 저장소들의 부모). 없으면 폴더 경로를 그대로 줘라`);
  }
  return path.join(path.resolve(뿌리), p);
}
const 과제이름 = dir => path.basename(dir);
const 봇이름 = 과제 => `prodev-${과제}-bot`;
// 훅과 cron 이 방에 알림 글을 올릴 때 쓰는 **사람 계정** (ADR-018). 봇 글은 게이트웨이만 보낼 수 있다.
// 이름을 영어로 둔다 — 사람이 코드와 채팅에서 마주치는 이름이기 때문이다 (ADR-024).
const 알림계정 = 'prodev-notify';
// Claude Code 권한 패턴. 맥·리눅스는 절대 경로 앞에 '//' 를 붙인다.
// 윈도우에서는 붙이지 않는다 — 붙이면 한 건도 안 맞아 봇이 과제 폴더에 아무것도 못 쓴다.
// 2026-09-12 실측(윈도우 11 · Claude Code 2.1.269): 같은 경로를 세 꼴로 넣고 봇에게 쓰게 시켜 보니
//   Edit(//C:/…/**) 거부 · Edit(C:/…/**) 통과 · Edit(C:\…\**) 통과.
const pat = p => {
  const s = p.replace(/\\/g, '/');
  return process.platform === 'win32' ? s : '//' + s.replace(/^\//, '');
};
// 윗자리가 아랫자리를 품는가 (같은 자리도 품는 것으로 본다). deny 가 과제 폴더를 덮는지 볼 때 쓴다.
const 덮는다 = (윗자리, 아랫자리) => {
  const a = path.resolve(윗자리), b = path.resolve(아랫자리);
  return a === b || b.startsWith(a + path.sep);
};
const log = m => console.log('  ' + m);
const esc = s => s.replace(/\\/g, '\\\\');
// **셸이 읽는 값**(훅 명령 셋 · statusLine)은 슬래시로 쓴다. Claude Code 는 윈도우에서 이것들을
// bash 로 돌리는데, bash 가 역슬래시를 escape 로 먹어 `C:\a\b` 가 `C:ab` 로 뭉개진다.
// 그러면 훅 셋이 `Cannot find module` 로 통째로 죽는다 — 그런데 훅은 non-blocking 이라
// 세션은 그대로 떠서 **밖에서는 봇이 멀쩡해 보인다** (2026-09-12 실측).
// 노드도 윈도우 API 도 슬래시를 받으므로 플랫폼을 가르지 않는다. posix 에서는 값이 그대로다.
// env 와 additionalDirectories 는 셸을 안 거치므로 여기에 넣지 않는다 — 그쪽은 실제 경로여야 한다.
const 셸경로 = s => s.replace(/\\/g, '/');

function readEnv(file) {
  const out = {};
  try { for (const l of fs.readFileSync(file, 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) out[m[1]] = m[2].trim(); } } catch {}
  return out;
}
// .env 는 사람도 연다. 무엇인지 모를 값에는 한 줄 풀이를 붙인다 (ADR-024).
const 토큰풀이 = `# PRODEV_NOTIFY_TOKEN: ${알림계정} 계정의 세션 쿠키. 훅과 cron 이 본방에 알림 글을 올릴 때 쓴다 (봇 글은 게이트웨이만 보낼 수 있어서 사람 계정이 필요하다)`;
const writeEnv = (f, kv) => {
  const 줄 = [];
  for (const [k, v] of Object.entries(kv)) {
    if (k === 'PRODEV_NOTIFY_TOKEN') 줄.push(토큰풀이);
    줄.push(`${k}=${v}`);
  }
  fs.writeFileSync(f, 줄.join('\n') + '\n');
};
function ensureDir(p, note) {
  if (!fs.existsSync(p)) { fs.mkdirSync(p, { recursive: true }); log(`만듦  ${p}${note ? '  (' + note + ')' : ''}`); }
  else log(`있음  ${p}`);
}

// 과제 폴더 하나 = git 저장소 하나 (ADR-003). 이미 git 이면 손대지 않는다 — 안의 것을 건드리지 않는다.
// git 이 없거나 실패해도 설치를 멈추지 않는다: 커밋은 나중 일이고, 못 했다는 것만 말하면 된다.
function ensureGit(dir) {
  if (fs.existsSync(path.join(dir, '.git'))) { log(`있음  ${path.join(dir, '.git')}  (git)`); return; }
  try {
    execSync('git init -q', { cwd: dir, stdio: 'ignore' });
    log(`만듦  ${path.join(dir, '.git')}  (git)`);
  } catch (e) {
    log(`!! git init 못 했다 (${String(e.message).split('\n')[0]}) — 손으로 \`git init\` 하라`);
  }
}

// ── 과제 폴더 채우기 ──────────────────────────────────────

// 사실이 쌓이는 자리(카드 · 위키 · 일지)는 처음부터 있었다. 여기 더한 넷은 **봇이 만들어 낸 것이
// 굳는 자리**다 (ADR-032). 자리가 없으면 분석은 tmp/ 로 가고 규칙은 꽂힐 데가 없다.
//   analysis/   분석 한 건 = 폴더 하나 (run.py · run.md). inbox/ 와 같은 꼴로 날짜와 이름을 묶는다
//   templates/  가르친 양식. report 스킬이 여기서 읽는다
//   house.md    이 과제에서 이 사람과 일하는 방식. session-start 훅이 여덟째로 싣는다 (상한 50줄)
//   .gitignore  tmp/ 한 줄. 그림과 임시는 커밋하지 않는다 (ARCHITECTURE 4.2)
const 과제폴더들 = ['cards', 'wiki', 'inbox', 'journal', 'threads', 'research', 'patent', 'paper', 'report', 'tmp',
  'analysis', 'templates'];

// house.md 를 빈 파일로 두지 않는다. 비어 있으면 봇도 사람도 여기에 무엇을 적는지 모르고,
// 모르면 아무도 안 적어서 자리만 있고 쓰이지 않는다. 골격이 곧 사용법이다.
// 소제목을 ### 로 두는 까닭: 훅이 이 파일을 "## 이 과제의 규칙" 절 안에 싣는다. ## 로 두면
// 훅 자신의 절과 같은 높이로 보여 봇이 규칙을 훅의 절로 잘못 읽는다.
// 머리에 "언제부터 · 누가 · 무엇을 보고" 를 못 박는 까닭은 되돌릴 수 있어야 하기 때문이다 —
// 석 달 뒤 "왜 이렇게 됐지" 라는 물음이 반드시 온다. 정신은 ADR 과 같다.
const HOUSE = `# 이 과제에서 일하는 방식

여기 적힌 것은 **규칙**이다. 사실(헌장 · 일정 · 카드 · 일지)은 다른 파일에 있다.
봇이 켜질 때마다 session-start 훅이 이 파일을 싣는다.

**상한 50줄이다.** 넘으면 뒷부분이 안 실린다. 새 규칙을 넣을 때 낡은 규칙을 뺀다.
넘쳤을 때 봇은 사람에게 말하고 **스스로 줄이지 않는다.**

규칙 하나는 제목 한 줄과 내용 한두 줄로 적고, 머리에 셋을 단다 —
**언제부터**(날짜) · **누가**(이름) · **무엇을 보고**(원본 경로나 대화 날짜).

사람이 "앞으로 이렇게 해" 라고 말했을 때만 여기 들어온다. "이번에는" 은 들어오지 않는다.

### 문체와 어휘
(아직 없다)

### 보고와 문서
(아직 없다)

### 하지 말 것
(아직 없다)
`;

// 이미 있으면 덮지 않는다. 사람이 적어 둔 규칙과 사람이 늘린 gitignore 를 지우면 안 된다 —
// setup 은 다시 돌릴 수 있어야 하고, 다시 돌려서 무엇이 사라지면 아무도 다시 안 돌린다.
function 없으면쓴다(파일, 내용, note) {
  if (fs.existsSync(파일)) { log(`있음  ${파일}`); return false; }
  fs.writeFileSync(파일, 내용);
  log(`만듦  ${파일}${note ? '  (' + note + ')' : ''}`);
  return true;
}

function 과제폴더세우기(과제폴더) {
  ensureDir(과제폴더, '과제 저장소');
  for (const d of 과제폴더들) ensureDir(path.join(과제폴더, d));
  없으면쓴다(path.join(과제폴더, 'house.md'), HOUSE, '규칙 — 훅이 여덟째로 싣는다 · 상한 50줄');
  없으면쓴다(path.join(과제폴더, '.gitignore'), 'tmp/\n', '그림과 임시는 커밋하지 않는다');
  ensureGit(과제폴더);
}

// ── 봇 설정 ───────────────────────────────────────────────

// 틀의 {{…}} 를 이 기계의 값으로 바꾼다. 자리 둘을 가른다 (ADR-019).
//   파일 뿌리(UPLOADS)      봇이 첨부할 수 있는 뿌리. 과제 저장소들의 부모다 (ARCHITECTURE 11절).
//                           **여기를 deny 하면 안 된다** — 과제 폴더가 그 안에 있다.
//   서버 업로드(SRV_UPLOADS) 서버가 받은 첨부를 쌓는 자리. 남의 원본이라 읽기만 한다.
function 설정빚기({ 과제폴더, 봇폴더, 봇, DB, UPLOADS }) {
  const SRV_UPLOADS = path.join(path.dirname(DB), 'uploads');
  const tpl = fs.readFileSync(path.join(PRODEV, 'common', 'settings.template.json'), 'utf8');
  const settings = JSON.parse(tpl
    .replace(/\{\{PROJECT\}\}/g, pat(과제폴더))
    .replace(/\{\{BOT\}\}/g, pat(봇폴더))
    .replace(/\{\{PRODEV\}\}/g, pat(PRODEV))
    .replace(/\{\{UPLOADS\}\}/g, pat(UPLOADS))
    .replace(/\{\{HOOKS\}\}/g, esc(셸경로(path.join(PRODEV, 'common', 'hooks'))))
    .replace(/\{\{PROJECT_DIR\}\}/g, esc(과제폴더))
    .replace(/\{\{UPLOADS_DIR\}\}/g, esc(UPLOADS))
    .replace(/\{\{PRODEV_DIR\}\}/g, esc(PRODEV))
    .replace(/\{\{BOT_NAME\}\}/g, 봇)
    .replace(/\{\{DB\}\}/g, esc(DB))
    .replace(/\{\{GIT_BASH\}\}/g, esc(GIT_BASH))
    // 훅이 방에 알릴 때 쓴다. 없으면 기본 3000 을 보고, 시험 서버가 딴 포트면 조용히 건너뛴다
    // (T3.M 재생에서 훅 로그가 "서버나 알림 계정이 없다" 였다).
    .replace(/\{\{URL\}\}/g, esc(URL_))
    .replace(/\{\{STATUSLINE\}\}/g, esc(셸경로(path.join(PRODEV, 'common', 'statusline.sh'))))
    .replace(/\{\{PATH\}\}/g, esc(BOT_PATH))
    .replace('"{{AUTOCOMPACT}}"', String(AUTOCOMPACT)));

  // 서버 업로드 폴더는 읽기만 한다 — 단, 그 폴더가 과제 폴더를 덮으면 넣지 않는다.
  // 덮으면 봇이 헌장·카드·일지를 못 쓴다 (R1 재생에서 실제로 그랬다. ADR-019).
  // 0층 불변은 이 목록이 아니라 intake-copy.js 의 0444 잠금과 git 이 지킨다.
  if (!덮는다(SRV_UPLOADS, 과제폴더)) {
    settings.permissions.deny.push(`Write(${pat(SRV_UPLOADS)}/**)`, `Edit(${pat(SRV_UPLOADS)}/**)`);
  } else {
    log(`!! 서버 업로드 폴더가 과제 폴더를 덮는다 (${SRV_UPLOADS}) — 읽기 전용 deny 를 넣지 않는다`);
  }

  // 어떤 deny 도 과제 폴더를 덮어서는 안 된다. 덮으면 봇이 아무것도 못 남긴다.
  const 덮는것 = settings.permissions.deny.filter(d => {
    const m = /^(?:Write|Edit)\((.*?)\/\*\*\)$/.exec(d);
    return m && 덮는다(m[1].replace(/^\/\//, '/'), 과제폴더);
  });
  if (덮는것.length) throw new Error(`deny 가 과제 폴더를 덮는다: ${덮는것.join(' · ')}`);

  return settings;
}

// ── minidiscord API ───────────────────────────────────────
let cookie = '';
async function api(method, p, body) {
  // 몸이 없으면 content-type 을 붙이지 않는다. 붙이면 fastify 가 "빈 JSON 몸" 이라고 400 을 낸다
  // (POST /api/rooms/:id/archive 처럼 몸이 없는 자리가 있다).
  const headers = body ? { 'content-type': 'application/json', cookie } : { cookie };
  const r = await fetch(URL_ + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  if (!r.ok) throw new Error(`${method} ${p} → ${r.status} ${text.slice(0, 160)}`);
  return json;
}
async function serverUp() { try { const j = await api('GET', '/api/health'); return !!(j && j.ok); } catch { return false; } }
const login = () => api('POST', '/api/auth/login', { username: process.env.MINIDISCORD_USER || 'prodev-setup' });

// 알림 계정의 세션 쿠키를 받아 온다 (ADR-024). 이름 하나로 로그인하면 계정이 없을 때 생긴다.
// 공용 api() 를 쓰지 않는 까닭: 그것은 모듈 쿠키를 덮어, 뒤따르는 부름이 알림 계정으로 나간다.
async function 알림토큰받기() {
  const r = await fetch(URL_ + '/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 알림계정 }),
  });
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 120)}`);
  const m = /md_session=([^;]+)/.exec(r.headers.get('set-cookie') || '');
  return m ? m[1] : null;
}

// ── 설치 ──────────────────────────────────────────────────

async function install(opt) {
  const 과제폴더 = projectDir(opt);
  const 과제 = 과제이름(과제폴더);
  const 봇 = 봇이름(과제);
  const 봇폴더 = path.join(PRODEV, 'bots', 봇);
  const DB = process.env.MINIDISCORD_DB || path.join(MINIDISCORD, 'server', 'data', 'minidiscord.db');
  // 봇이 첨부할 수 있는 뿌리. 과제 저장소들의 부모다 (ADR-019 · ARCHITECTURE 11절).
  const UPLOADS = process.env.MINIDISCORD_BOT_FILES_DIR || path.join(MINIDISCORD, 'server', 'data', 'uploads');

  console.log(`저장소: ${PRODEV}\n과제:   ${과제} (${과제폴더})\n봇:     ${봇}\nminidiscord: ${MINIDISCORD} (${URL_})\n`);

  console.log('① 폴더');
  과제폴더세우기(과제폴더);
  ensureDir(봇폴더, '토큰 · 설정 · 자기 상태');
  if (!fs.existsSync(CHANNEL)) log(`없음  ${CHANNEL}  ← minidiscord 에서 npm install && npm run build -w channel`);

  console.log('\n② 봇 등록 (서버가 떠 있을 때만)');
  const up = await serverUp();
  const kv = readEnv(path.join(봇폴더, '.env'));
  if (!up) log(`서버 없음 (${URL_}) — 건너뜀. 서버를 띄우고 다시 돌리면 등록한다.`);
  else if (kv.MINIDISCORD_TOKEN) log(`있음  ${봇} (토큰 있음)`);
  else {
    await login();
    const 있는것 = new Map((await api('GET', '/api/bots')).map(b => [b.name, b]));
    if (있는것.has(봇)) log(`주의  ${봇} 은 서버에 있는데 .env 에 토큰이 없다 — 웹에서 봇을 지우고 다시 돌려라`);
    else {
      const j = await api('POST', '/api/bots', { name: 봇, description: `prodev ${과제} bot`, role: 'orchestrator' });
      writeEnv(path.join(봇폴더, '.env'), { ...kv, MINIDISCORD_TOKEN: j.token });
      log(`등록  ${봇} (id ${j.id}) → bots/${봇}/.env`);
    }
  }

  // 알림 계정의 세션 쿠키 (ADR-024). 사람이 브라우저에서 쿠키를 복사하던 걸음을 여기서 없앤다.
  // 이미 값이 있으면 덮지 않는다 — 사람이 손으로 넣어 둔 것을 지우면 안 된다.
  const env길 = path.join(봇폴더, '.env');
  if (!up) log(`알림 토큰  건너뜀 (서버 없음) — 서버를 켜고 다시 돌리면 받는다`);
  else if (readEnv(env길).PRODEV_NOTIFY_TOKEN) log(`있음  ${알림계정} 세션 쿠키 (덮지 않는다)`);
  else {
    try {
      const t = await 알림토큰받기();
      if (t) { writeEnv(env길, { ...readEnv(env길), PRODEV_NOTIFY_TOKEN: t }); log(`받음  ${알림계정} 세션 쿠키 → bots/${봇}/.env`); }
      else log(`!! ${알림계정} 로그인 응답에 md_session 이 없다 — 손으로 .env 에 넣어라`);
    } catch (e) {
      log(`!! ${알림계정} 토큰을 못 받았다 (${e.message}) — 손으로 .env 에 넣어라`);
    }
  }

  console.log('\n③ 설정 파일 (훅 셋 배선 · env 넷)');
  const settings = 설정빚기({ 과제폴더, 봇폴더, 봇, DB, UPLOADS });

  fs.mkdirSync(path.join(봇폴더, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(봇폴더, '.claude', 'settings.json'), JSON.stringify(settings, null, 2) + '\n');
  if (!fs.existsSync(path.join(봇폴더, '.env'))) writeEnv(path.join(봇폴더, '.env'), { MINIDISCORD_TOKEN: '' });
  const token = readEnv(path.join(봇폴더, '.env')).MINIDISCORD_TOKEN;
  if (token) {
    fs.writeFileSync(path.join(봇폴더, '.mcp.json'), JSON.stringify({
      mcpServers: { 'minidiscord-channel': { command: 'node', args: [CHANNEL], env: { MINIDISCORD_TOKEN: token, MINIDISCORD_SERVER: WS } } },
    }, null, 2) + '\n');
  }
  log(`씀  bots/${봇}/.claude/settings.json${token ? ' · .mcp.json' : '  (.mcp.json 은 토큰이 없어 건너뜀)'}`);
  log(`훅  ${Object.keys(settings.hooks).join(' · ')}`);
  log(`env  ${Object.keys(settings.env).filter(k => k.startsWith('PRODEV') || k === 'MINIDISCORD_DB').join(' · ')}`);
  log(`Git Bash  ${settings.env.CLAUDE_CODE_GIT_BASH_PATH}${process.platform === 'win32' ? '' : '  (맥·리눅스에서는 안 쓰인다 — 윈도우로 옮길 때를 위해 박아 둔다)'}`);
  log(`허용 ${settings.permissions.allow.length}건 · 거부 ${settings.permissions.deny.length}건 · 바깥 폴더 ${settings.permissions.additionalDirectories.length}개`);

  console.log('\n④ 환경 점검 (봇 설정에 박은 PATH 로)');
  const 찾음 = probe(BOT_PATH);
  const 없음 = 찾음.filter(x => !x.dir);
  log(`PATH  ${BOT_PATH.split(path.delimiter).length}개 폴더 · 변수 참조 없음`);
  if (!없음.length) log(`명령  ${찾음.length}개 모두 풀림`);
  else {
    log(`명령  ${찾음.length - 없음.length}/${찾음.length} 풀림`);
    log(`!! 못 찾음: ${없음.map(x => x.name).join(', ')} — 이대로 띄우면 그 명령을 쓰는 일이 전부 막힌다`);
  }
  log(`압축 문턱  ${AUTOCOMPACT.toLocaleString()} 토큰 (PRODEV_AUTOCOMPACT=<값>)`);

  console.log('\n⑤ 다음');
  if (!up) log(`서버를 켜고 다시 돌려라: cd ${JSON.stringify(MINIDISCORD)} && MINIDISCORD_BOT_FILES_DIR=${JSON.stringify(UPLOADS)} npm run dev -w server`);
  else if (!token) log('위 ② 의 주의를 처리한 뒤 다시 돌려라');
  else {
    log(`node scripts/setup.js rooms ${과제}   → 방 둘 만들고 봇 참여`);
    log(`cd ${JSON.stringify(봇폴더)} && claude ${CLAUDE_ARGS.join(' ')}`);
  }
  return { 봇, 봇폴더, 과제폴더, settings };
}

// ── 방 둘 (본방 · files) ──────────────────────────────────

async function rooms(과제) {
  if (!과제) throw new Error('과제 이름을 주세요: node scripts/setup.js rooms <과제>');
  if (!(await serverUp())) throw new Error(`서버 없음 (${URL_})`);
  await login();

  const 봇 = 봇이름(과제);
  const bots = new Map((await api('GET', '/api/bots')).map(b => [b.name, b]));
  const b = bots.get(봇);
  if (!b) throw new Error(`봇이 없다: ${봇} — 먼저 node scripts/setup.js 를 돌려 등록하라`);

  const 이름들 = [`prodev-${과제}`, ...갈래.map(g => `prodev-${과제}/${g}`)];
  const 있는방 = new Map(((await api('GET', '/api/rooms')).active || []).map(r => [r.name, r]));

  const 만든것 = [];
  for (const name of 이름들) {
    let room = 있는방.get(name);
    if (room) log(`방 있음  ${name} (id ${room.id})`);
    else { room = await api('POST', '/api/rooms', { name }); log(`방 만듦  ${name} (id ${room.id})`); }
    // 참여는 여러 번 넣어도 되게 — 이미 있으면 서버가 거절해도 넘어간다
    try { await api('POST', `/api/rooms/${room.id}/bots`, { bot_id: b.id }); log(`  참여  ${봇}`); }
    catch (e) { log(`  참여  ${봇} (이미 있음)`); }
    만든것.push({ id: room.id, name });
  }

  // 봇이 "내가 어느 방을 맡나"를 아는 자리. 훅도 DB 가 죽었을 때 이것으로 방 이름을 안다 (ADR-021).
  const 봇폴더 = path.join(PRODEV, 'bots', 봇);
  fs.mkdirSync(봇폴더, { recursive: true });
  fs.writeFileSync(path.join(봇폴더, 'rooms.json'),
    JSON.stringify({ 과제, rooms: 만든것.map(r => ({ ...r, last_seen_id: 0 })) }, null, 2) + '\n');
  log(`씀  bots/${봇}/rooms.json  (방 ${만든것.length}개 · 처리한 마지막 id 는 봇이 갱신한다)`);
  return 만든것;
}

// ── cron 두 줄 ────────────────────────────────────────────

function cron(과제) {
  const 이름 = 과제 || '<과제>';
  const 봇 = 봇이름(이름);
  const 본방 = `prodev-${이름}`;
  console.log('crontab -e 에 아래 두 줄을 붙인다 (PL PC). 방 번호는 setup.js rooms 출력에서 본다.');
  console.log(`# prodev ${이름} — 08:00 브리핑 · 18:30 일지`);
  console.log(`0 8 * * 1-5 curl -sS -X POST ${URL_}/api/rooms/<본방번호>/messages -b "md_session=$PRODEV_NOTIFY_TOKEN" --form-string 'body=@TO(${봇}) 오늘 브리핑' >/dev/null`);
  console.log(`30 18 * * 1-5 curl -sS -X POST ${URL_}/api/rooms/<본방번호>/messages -b "md_session=$PRODEV_NOTIFY_TOKEN" --form-string 'body=@TO(${봇}) 오늘 일지' >/dev/null`);
  console.log(`\n본방: ${본방} · 알림 계정의 세션 쿠키 값을 PRODEV_NOTIFY_TOKEN 에 둔다 (봇 글은 게이트웨이만 보낼 수 있다).`);
  console.log('서버는 쿠키 md_session 하나로만 인증하고 글 올리기는 multipart 만 받는다 (ADR-018).');
  console.log("-F 가 아니라 --form-string 이다 — -F 는 '@' 로 시작하는 값을 파일 경로로 읽고, 멘션은 언제나 @TO( 로 시작한다.");
}

// ── 보관 ──────────────────────────────────────────────────

async function archive(방이름) {
  if (!방이름) throw new Error('방 이름을 주세요: node scripts/setup.js archive <방>');
  if (!(await serverUp())) throw new Error(`서버 없음 (${URL_})`);
  await login();
  const 목록 = await api('GET', '/api/rooms');
  const room = (목록.active || []).find(r => r.name === 방이름);
  if (!room) {
    const 이미 = (목록.archived || []).find(r => r.name === 방이름);
    if (이미) { log(`이미 보관됨  ${방이름} (id ${이미.id})`); return 이미; }
    throw new Error(`활성 방에 없다: ${방이름}`);
  }
  await api('POST', `/api/rooms/${room.id}/archive`);
  log(`보관  ${방이름} (id ${room.id}) — 접속은 유지되고 welcome 에서 빠진다`);
  return room;
}

// ── 몸통 ──────────────────────────────────────────────────

function parseArgs(argv) {
  const pos = []; const opt = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) opt[argv[i].slice(2)] = argv[++i];
    else pos.push(argv[i]);
  }
  return { pos, opt };
}

if (require.main === module) {
  const { pos, opt } = parseArgs(process.argv.slice(2));
  const [cmd, arg] = pos;
  (async () => {
    try {
      if (!cmd) await install(opt);
      else if (cmd === 'rooms') await rooms(arg);
      else if (cmd === 'cron') cron(arg);
      else if (cmd === 'archive') await archive(arg);
      else throw new Error(`모르는 명령: ${cmd}  (없음 | rooms | cron | archive)`);
    } catch (e) { console.error('오류: ' + e.message); process.exit(1); }
  })();
}

module.exports = { install, rooms, cron, archive, 봇이름, 알림계정, 갈래, 과제폴더세우기, 설정빚기, 과제폴더들, GIT_BASH };
