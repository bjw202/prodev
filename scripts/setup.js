#!/usr/bin/env node
// setup.js — 사람이 돌린다. 봇은 이 파일을 쓰지 않는다.
//
//   node scripts/setup.js [--project <이름|폴더>] [--cockpit <cockpit.json>]
//       설치: 과제 폴더(없으면 만들고 git init) · 봇 폴더 · 설정 두 장
//         .claude/settings.json        훅 셋 배선 · env · statusLine · 자동 압축
//         .claude/settings.local.json  허용 · 거부 목록 · 바깥 폴더 (ADR-038)
//
// 봇은 조종석(cockpit)이 Claude Agent SDK 세션으로 붙든다 (ADR-038). 그래서 여기서 **하지 않는 것**:
//   · 채팅 서버에 봇 등록 · 토큰 받기 · .env · .mcp.json — 도구(mcp__cockpit__*)는 조종석이 세션에 직접 준다
//   · 방 만들기(rooms) · 보관(archive) — 조종석의 `open-project` · 웹 과제 열기가 한다
//   · crontab 줄(cron) — 자동 브리핑을 두지 않기로 했다. 사람이 말을 걸 때 brief · journal 이 뜬다
//
// 자리: 조종석 설정 한 장(cockpit.json)에서 읽는다. 찾는 순서는 --cockpit > COCKPIT_CONFIG > <저장소>/../cockpit/cockpit.json.
//   dataDir     → MINIDISCORD_DB = <dataDir>/chat.db · deny 에 <dataDir>/cockpit.db (Read · Edit · Write)
//   uploadsDir  → {{UPLOADS_DIR}} (읽기로 열고 쓰기는 deny)
//   projectsDir → --project 에 이름만 줬을 때 과제 폴더를 만드는 자리
// 조종석이 쓰는 값을 사람이 두 번 적지 않게 하려는 것이다 — 두 곳에 적으면 언젠가 갈린다.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PRODEV = path.resolve(__dirname, '..');
const ROOT = path.dirname(PRODEV);
const AUTOCOMPACT = Number(process.env.PRODEV_AUTOCOMPACT || 650000);

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

// ── Git Bash — 윈도우에서 Bash 도구가 무엇을 부르는가 (ADR-033) ────────────
// 봇은 --setting-sources project,local 이라 user 범위 설정을 못 읽는다. 그래서 WINDOWS.md 126행이
// 적어 둔 길을 사람이 손으로 넣는 대신 **setup 이 봇 설정에 박는다.** 환경변수로 덮을 수 있다.
// 맥·리눅스에서도 키는 남고 값도 비지 않는다 — 그 자리에 Git Bash 가 없으면 Claude Code 가 안 볼 뿐이라 무해하다.
// (아래 PATH 도 이 값에서 Git 설치 자리를 역산하므로 PATH 보다 먼저 정한다.)
const GIT_BASH = process.env.CLAUDE_CODE_GIT_BASH_PATH || 'C:\\Program Files\\Git\\bin\\bash.exe';

// ── PATH — crew 에서 그대로 가져온다. 까닭도 그대로다 ──────────────────────
// 봇은 --setting-sources project,local 로 떠서 user 범위를 읽지 않는다. ~/.claude.json 의 env.PATH 가
// "$PATH:..." 처럼 글자 그대로 들어 있으면 /usr/bin 과 /bin 이 통째로 빠져 git·ls·grep 이 전부 죽는다.
// 설정의 env 값은 셸을 거치지 않는다. 그래서 변수 참조가 든 조각을 버리고 실제로 있는 폴더만 남긴다.
const 윈도우 = process.platform === 'win32';
const GIT_DIR = 윈도우 ? path.dirname(path.dirname(GIT_BASH)) : null;   // <Git>/bin/bash.exe → <Git>
// 윈도우에서 **PATH 앞에** 붙일 자리. Git 이 주는 유닉스 도구 둘이다 (bash · sh · ls · mkdir · date …).
//
// 왜 뒤가 아니라 앞인가: 이름이 겹치는 자리가 있다. System32 에도 `find.exe` 와 `sort.exe` 가
// 있는데 **전혀 다른 프로그램**이다. 뒤에 붙이면 그쪽이 먼저 잡혀, 있는데도 엉뚱하게 동작한다
// — 없는 것보다 나쁘다 (오류가 아니라 틀린 결과로 나온다).
//
// 왜 넣는가: setup 은 **자기가 도는 창의 PATH 를 그대로 봇 설정(env.PATH)에 박고**, 봇은
// --setting-sources project,local 로 떠서 사용자 설정을 안 읽는다 — 그 값이 봇의 전부다.
// 그런데 PowerShell 기본 PATH 에는 Git\bin · Git\usr\bin · Git\mingw64\bin 이 하나도 없다
// (2026-09-12 윈도우 11 실측). 그대로 setup 을 돌리면 봇이 ls · mkdir · date 를 잃고,
// 그것은 오류가 아니라 **승인 창**으로 나타나 방을 더럽힌다. 사람이 창마다 PATH 를 손으로
// 고치는 일을 setup 이 대신한다 (WINDOWS.md 5.1 의 3 이 적어 둔 자리를 코드로 옮긴 것이다).
const FIRST_DIRS = 윈도우 ? [path.join(GIT_DIR, 'bin'), path.join(GIT_DIR, 'usr', 'bin')] : [];
const STD_DIRS = 윈도우
  ? [path.join(process.env.SystemRoot || 'C:\\Windows', 'System32'), process.env.SystemRoot || 'C:\\Windows',
    path.join(GIT_DIR, 'mingw64', 'bin')]     // pdftotext 가 여기 산다 (peek.js 의 pdf 층)
  : ['/usr/bin', '/bin', '/usr/sbin', '/sbin', '/usr/local/bin', '/opt/homebrew/bin'];
// 점검 목록은 **플랫폼을 가르지 않는다.** 윈도우에서 git·node 둘만 보던 탓에 grep 이 없어도
// "명령 2개 모두 풀림" 이라고 초록으로 지나갔다 (WINDOWS.md 5.1 의 2). 재는 것이 다르면
// 같은 작업판이라고 할 수 없다 — 이름은 같고, `.exe` 를 붙여 찾는 일은 probe() 가 한다.
const NEEDED = ['git', 'node', 'ls', 'cat', 'head', 'tail', 'grep', 'sed', 'awk', 'wc', 'find', 'sort', 'date', 'mkdir', 'python3'];

function buildPath() {
  const seen = new Set(); const out = [];
  const push = d => {
    if (!d || d.includes('$') || d.includes('%') || !path.isAbsolute(d)) return;
    const k = 윈도우 ? d.toLowerCase() : d;
    if (seen.has(k) || !fs.existsSync(d)) return;
    seen.add(k); out.push(d);
  };
  for (const d of FIRST_DIRS) push(d);         // posix 에서는 빈 목록이다
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


// ── 이름과 자리 ───────────────────────────────────────────

// 조종석 설정 한 장에서 자리 넷을 읽는다 (ADR-038). 조종석이 스스로 검사하는 값이라 여기서는 있는지만 본다.
function 조종석설정(opt = {}) {
  const 파일 = path.resolve(opt.cockpit || process.env.COCKPIT_CONFIG || path.join(ROOT, 'cockpit', 'cockpit.json'));
  if (!fs.existsSync(파일)) {
    throw new Error(`조종석 설정이 없다: ${파일} — --cockpit <cockpit.json> 을 주거나 COCKPIT_CONFIG 를 설정하라 (cockpit 저장소의 cockpit.example.json 을 베껴 채운다)`);
  }
  let j;
  try { j = JSON.parse(fs.readFileSync(파일, 'utf8')); }
  catch (e) { throw new Error(`조종석 설정을 못 읽는다: ${파일} (${String(e.message).split('\n')[0]})`); }
  const 빠진것 = ['dataDir', 'uploadsDir', 'projectsDir'].filter(k => typeof j[k] !== 'string' || !j[k]);
  if (빠진것.length) throw new Error(`조종석 설정에 ${빠진것.join(' · ')} 이 없다: ${파일}`);
  const dataDir = path.resolve(j.dataDir);
  return {
    파일,
    dataDir,
    uploadsDir: path.resolve(j.uploadsDir),
    projectsDir: path.resolve(j.projectsDir),
    botsDir: j.botsDir ? path.resolve(j.botsDir) : null,
    chatDb: path.join(dataDir, 'chat.db'),
    cockpitDb: path.join(dataDir, 'cockpit.db'),
  };
}

// --project 는 **이름**일 수도 **경로**일 수도 있다 (ADR-023).
//   경로   '/' 가 들어 있거나 이미 있는 자리 → 그대로 쓴다 (지금까지와 같다)
//   이름만 → <조종석 projectsDir>/<이름>. 조종석이 과제 폴더를 찾는 자리와 같아야 한다 (ADR-038).
// 사람이 "과제 하나 = projects 아래 폴더 하나" 로 정했으므로, 자리를 외우는 것은 사람이 아니라 setup 이다.
function projectDir(opt, 조종석) {
  const p = opt.project || process.env.PRODEV_PROJECT;
  if (!p) throw new Error('과제 폴더를 모른다. --project <이름 또는 폴더> 를 주거나 PRODEV_PROJECT 를 설정하라');
  if (p.includes('/') || p.includes(path.sep) || fs.existsSync(p)) return path.resolve(p);
  return path.join(조종석.projectsDir, p);
}
const 과제이름 = dir => path.basename(dir);
const 봇이름 = 과제 => `prodev-${과제}-bot`;
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

// ── 봇 설정 두 장 (ADR-038) ───────────────────────────────
//
// 왜 둘인가: 조종석은 봇을 headless(Agent SDK) 세션으로 띄운다. 그 세션은 프로젝트 `.claude/settings.json` 의
// `permissions.allow` 를 읽지 않는다 — `Write(**)` 까지 넣어도 승인을 물었다 (meta 실측, 2026-09-14).
// 같은 규칙을 `.claude/settings.local.json` 에 두면 먹는다. 그래서 **권한만** 그쪽으로 옮기고,
// 훅 · env · statusLine · 자동 압축은 지금까지처럼 settings.json 에 둔다 (그쪽은 headless 에서도 먹는다).
//
// 틀의 {{…}} 를 이 기계의 값으로 바꾼다. 두 틀이 같은 자리표시자를 쓴다.
//   UPLOADS_DIR  조종석이 받은 첨부를 쌓는 자리. 남의 원본이라 읽기만 한다 (쓰기는 deny)
//   DB           조종석의 chat.db — 대화 원본. chat.js · 훅이 읽기 전용으로 연다
//   COCKPIT_DB   조종석의 cockpit.db — 계정 · 승인 기록. 봇이 **읽지도** 못하게 deny 에 넣는다 (벽은 아니다, ADR-038)
function 설정빚기({ 과제폴더, 봇폴더, 봇, DB, COCKPIT_DB, UPLOADS_DIR }) {
  const 채운다 = 파일 => JSON.parse(fs.readFileSync(path.join(PRODEV, 'common', 파일), 'utf8')
    .replace(/\{\{PROJECT\}\}/g, pat(과제폴더))
    .replace(/\{\{BOT\}\}/g, pat(봇폴더))
    .replace(/\{\{PRODEV\}\}/g, pat(PRODEV))
    .replace(/\{\{HOOKS\}\}/g, esc(셸경로(path.join(PRODEV, 'common', 'hooks'))))
    .replace(/\{\{PROJECT_DIR\}\}/g, esc(과제폴더))
    .replace(/\{\{UPLOADS_DIR\}\}/g, esc(UPLOADS_DIR))
    .replace(/\{\{PRODEV_DIR\}\}/g, esc(PRODEV))
    .replace(/\{\{BOT_NAME\}\}/g, 봇)
    .replace(/\{\{DB\}\}/g, esc(DB))
    .replace(/\{\{GIT_BASH\}\}/g, esc(GIT_BASH))
    .replace(/\{\{STATUSLINE\}\}/g, esc(셸경로(path.join(PRODEV, 'common', 'statusline.sh'))))
    .replace(/\{\{PATH\}\}/g, esc(BOT_PATH))
    .replace('"{{AUTOCOMPACT}}"', String(AUTOCOMPACT)));

  const settings = 채운다('settings.template.json');
  const local = 채운다('settings.local.template.json');
  const deny = local.permissions.deny;

  // 조종석 업로드 폴더는 읽기만 한다 — 단, 그 폴더가 과제 폴더를 덮으면 넣지 않는다.
  // 덮으면 봇이 헌장·카드·일지를 못 쓴다 (R1 재생에서 실제로 그랬다. ADR-019).
  // 0층 불변은 이 목록이 아니라 intake-copy.js 의 0444 잠금과 git 이 지킨다.
  if (!덮는다(UPLOADS_DIR, 과제폴더)) {
    deny.push(`Write(${pat(UPLOADS_DIR)}/**)`, `Edit(${pat(UPLOADS_DIR)}/**)`);
  } else {
    log(`!! 조종석 업로드 폴더가 과제 폴더를 덮는다 (${UPLOADS_DIR}) — 읽기 전용 deny 를 넣지 않는다`);
  }

  // cockpit.db 는 봇이 볼 일이 없다 (ADR-038 · cockpit ARCHITECTURE 3.3).
  deny.push(`Read(${pat(COCKPIT_DB)})`, `Edit(${pat(COCKPIT_DB)})`, `Write(${pat(COCKPIT_DB)})`);

  // 어떤 deny 도 과제 폴더를 덮어서는 안 된다. 덮으면 봇이 아무것도 못 남긴다.
  const 덮는것 = deny.filter(d => {
    const m = /^(?:Write|Edit)\((.*?)\/\*\*\)$/.exec(d);
    return m && 덮는다(m[1].replace(/^\/\//, '/'), 과제폴더);
  });
  if (덮는것.length) throw new Error(`deny 가 과제 폴더를 덮는다: ${덮는것.join(' · ')}`);

  return { settings, local };
}

// ── 설치 ──────────────────────────────────────────────────

async function install(opt) {
  const 조종석 = 조종석설정(opt);
  const 과제폴더 = projectDir(opt, 조종석);
  const 과제 = 과제이름(과제폴더);
  const 봇 = 봇이름(과제);
  const 봇폴더 = path.join(PRODEV, 'bots', 봇);

  console.log(`저장소: ${PRODEV}\n과제:   ${과제} (${과제폴더})\n봇:     ${봇}\n조종석: ${조종석.파일}\n`);

  console.log('① 폴더');
  과제폴더세우기(과제폴더);
  ensureDir(봇폴더, '설정 · 자기 상태');
  if (조종석.botsDir && path.resolve(조종석.botsDir) !== path.resolve(path.dirname(봇폴더))) {
    log(`!! 조종석 botsDir(${조종석.botsDir}) 이 이 저장소의 bots/ 가 아니다 — open-project 에 --bot-dir ${JSON.stringify(봇폴더)} 를 준다`);
  }

  console.log('\n② 설정 파일 두 장 (ADR-038)');
  const { settings, local } = 설정빚기({
    과제폴더, 봇폴더, 봇, DB: 조종석.chatDb, COCKPIT_DB: 조종석.cockpitDb, UPLOADS_DIR: 조종석.uploadsDir,
  });
  fs.mkdirSync(path.join(봇폴더, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(봇폴더, '.claude', 'settings.json'), JSON.stringify(settings, null, 2) + '\n');
  fs.writeFileSync(path.join(봇폴더, '.claude', 'settings.local.json'), JSON.stringify(local, null, 2) + '\n');
  log(`씀  bots/${봇}/.claude/settings.json  (훅 · env · statusLine · 자동 압축)`);
  log(`씀  bots/${봇}/.claude/settings.local.json  (허용 ${local.permissions.allow.length}건 · 거부 ${local.permissions.deny.length}건 · 바깥 폴더 ${local.permissions.additionalDirectories.length}개)`);
  for (const 옛것 of ['.mcp.json', '.env']) {
    if (fs.existsSync(path.join(봇폴더, 옛것))) log(`남음  bots/${봇}/${옛것}  (minidiscord 시절 파일. 조종석은 안 읽는다 — 지워도 된다)`);
  }
  log(`훅  ${Object.keys(settings.hooks).join(' · ')}`);
  log(`env  ${Object.keys(settings.env).filter(k => k.startsWith('PRODEV') || k === 'MINIDISCORD_DB').join(' · ')}  (MINIDISCORD_DB = ${settings.env.MINIDISCORD_DB})`);
  log(`Git Bash  ${settings.env.CLAUDE_CODE_GIT_BASH_PATH}${process.platform === 'win32' ? '' : '  (맥·리눅스에서는 안 쓰인다 — 윈도우로 옮길 때를 위해 박아 둔다)'}`);

  console.log('\n③ 환경 점검 (봇 설정에 박은 PATH 로)');
  const 찾음 = probe(BOT_PATH);
  const 없음 = 찾음.filter(x => !x.dir);
  log(`PATH  ${BOT_PATH.split(path.delimiter).length}개 폴더 · 변수 참조 없음`);
  if (!없음.length) log(`명령  ${찾음.length}개 모두 풀림`);
  else {
    log(`명령  ${찾음.length - 없음.length}/${찾음.length} 풀림`);
    log(`!! 못 찾음: ${없음.map(x => x.name).join(', ')} — 이대로 띄우면 그 명령을 쓰는 일이 전부 막힌다`);
  }
  log(`압축 문턱  ${AUTOCOMPACT.toLocaleString()} 토큰 (PRODEV_AUTOCOMPACT=<값>)`);

  console.log('\n④ 다음 — 조종석에서 과제를 연다 (docs/launch.md 4절)');
  log(`cd <cockpit> && node bin/cockpit.js open-project ${과제} --bot-dir ${JSON.stringify(봇폴더)} --config ${JSON.stringify(조종석.파일)}`);
  log(`node bin/cockpit.js serve --config ${JSON.stringify(조종석.파일)}   (또는 웹의 과제 열기)`);
  return { 봇, 봇폴더, 과제폴더, settings, local };
}

// ── 옮겨 간 명령 ──────────────────────────────────────────
// 방은 조종석이 만든다 (open-project · POST /api/projects). 옛 걸음을 밟은 사람이 조용히 지나치지 않게
// 무엇이 대신하는지 말하고 1 로 끝낸다 — 방이 안 생겼는데 0 으로 끝나면 생긴 줄 안다.
const 옮겨감 = {
  rooms: '방은 조종석에서 방을 만들 때 봇 · 과제 폴더와 함께 생긴다 (ADR-039): 웹의 새 방 · POST /api/rooms · cd <cockpit> && node bin/cockpit.js open-project <과제>',
  archive: '방 보관은 조종석으로 옮겨 갔다. setup.js 는 방을 만지지 않는다',
};

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
  const [cmd] = pos;
  (async () => {
    try {
      if (!cmd) await install(opt);
      else if (옮겨감[cmd]) { console.error(`${cmd}: ${옮겨감[cmd]}`); process.exit(1); }
      else throw new Error(`모르는 명령: ${cmd}  (명령 없이 돌리면 설치다)`);
    } catch (e) { console.error('오류: ' + e.message); process.exit(1); }
  })();
}

module.exports = { install, 조종석설정, 봇이름, 과제폴더세우기, 설정빚기, 과제폴더들, GIT_BASH };
