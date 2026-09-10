#!/usr/bin/env node
// setup.js — 사람이 돌린다. 봇은 이 파일을 쓰지 않는다.
//
//   node scripts/setup.js [--project <과제폴더>]   설치: 봇 폴더 · settings(훅 배선 · env 셋) · .env · .mcp.json
//   node scripts/setup.js rooms <과제>             방 일곱을 만들고 봇을 일곱 다 참여시킨다 (API)
//   node scripts/setup.js cron                     crontab 두 줄을 낸다 (08:00 브리핑 · 18:30 일지)
//   node scripts/setup.js archive <방>             방 하나를 보관한다
//
// crew 의 setup.js 에서 왔다. 다른 점 셋:
//   ① 봇이 다섯이 아니라 **하나**다 (prodev-<과제>-비서)
//   ② 방을 하나가 아니라 **일곱 묶음**으로 연다 (ARCHITECTURE 2절)
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

// 과제 하나 = 방 일곱. 본방은 갈래가 없고 나머지 여섯은 접두어/갈래 다 (ARCHITECTURE 2절).
const 갈래 = ['들이기', '자료', '리서치', '특허', '논문', '보고'];

// ── 허용 목록은 왜 이 꼴인가 ──────────────────────────────────────────────
// 바탕은 ../crew/common/settings.template.json 의 33건이다. 거기에 회차 5 의 승인 31회를 덮는 것을 더했다.
// 31회는 항목 목록이 아니라 원인 넷이다 (../meta/crew-eval/notes/round-5-result.md 86~91행).
// 승인이 뜨면 그 글이 마지막 to 방에 남아 자료 방이 더러워진다. 그래서 미리 연다.
//
//   원인 1  cd … && … · pwd; ls 로 이어 붙임          9회
//           → Bash(cd:*) · Bash(pwd) · Bash(echo:*)
//           주의: 이어 붙인 명령 한 줄은 통째로 하나로 보이므로 허용 목록으로 다 덮이지 않는다.
//           진짜 고침은 "이어 붙이지 않는다" 규칙이고 목록은 조각만 연다. 회차 5 도 규칙 쪽이 먹었다.
//   원인 2  python3 - <<'PY'                          6회  → Bash(python3:*)
//   원인 3  채팅 서버 업로드 폴더 읽기 (wc·ls·cp·sha)  8회
//           → additionalDirectories 에 업로드 폴더 + Bash(shasum:*) · Bash(sha256sum:*) · Bash(file:*) · Bash(stat:*)
//           봇 폴더 밖이라 목록에 있어도 물었다. 폴더를 열어 줘야 안 묻는다. 쓰기는 deny 로 막는다 (원본 불변).
//   원인 4  chmod · grep $'\r' · gh pr create · 그 밖  8회
//           → Bash(chmod:*) · Bash(tr:*) · Bash(gh:*) · Bash(grep:*)
//
// 들이기에서 실제로 쓰는 것도 같이 연다: Bash(cut:*) · Bash(basename:*) · Bash(dirname:*).
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

// ── 이름과 자리 ───────────────────────────────────────────

function projectDir(opt) {
  const p = opt.project || process.env.PRODEV_PROJECT;
  if (!p) throw new Error('과제 폴더를 모른다. --project <폴더> 를 주거나 PRODEV_PROJECT 를 설정하라');
  return path.resolve(p);
}
const 과제이름 = dir => path.basename(dir);
const 봇이름 = 과제 => `prodev-${과제}-비서`;
const pat = p => '//' + p.replace(/\\/g, '/').replace(/^\//, '');    // Claude Code 권한 패턴
const log = m => console.log('  ' + m);
const esc = s => s.replace(/\\/g, '\\\\');

function readEnv(file) {
  const out = {};
  try { for (const l of fs.readFileSync(file, 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) out[m[1]] = m[2].trim(); } } catch {}
  return out;
}
const writeEnv = (f, kv) => fs.writeFileSync(f, Object.entries(kv).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
function ensureDir(p, note) {
  if (!fs.existsSync(p)) { fs.mkdirSync(p, { recursive: true }); log(`만듦  ${p}${note ? '  (' + note + ')' : ''}`); }
  else log(`있음  ${p}`);
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

// ── 설치 ──────────────────────────────────────────────────

async function install(opt) {
  const 과제폴더 = projectDir(opt);
  const 과제 = 과제이름(과제폴더);
  const 봇 = 봇이름(과제);
  const 봇폴더 = path.join(PRODEV, 'bots', 봇);
  const DB = process.env.MINIDISCORD_DB || path.join(MINIDISCORD, 'server', 'data', 'minidiscord.db');
  const UPLOADS = process.env.MINIDISCORD_BOT_FILES_DIR || path.join(MINIDISCORD, 'server', 'data', 'uploads');

  console.log(`저장소: ${PRODEV}\n과제:   ${과제} (${과제폴더})\n봇:     ${봇}\nminidiscord: ${MINIDISCORD} (${URL_})\n`);

  console.log('① 폴더');
  ensureDir(과제폴더, '과제 저장소');
  for (const d of ['cards', 'wiki', 'inbox', 'journal', 'threads', 'research', 'patent', 'paper', 'report', 'tmp']) {
    ensureDir(path.join(과제폴더, d));
  }
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
      const j = await api('POST', '/api/bots', { name: 봇, description: `prodev ${과제} 비서`, role: 'orchestrator' });
      writeEnv(path.join(봇폴더, '.env'), { ...kv, MINIDISCORD_TOKEN: j.token });
      log(`등록  ${봇} (id ${j.id}) → bots/${봇}/.env`);
    }
  }

  console.log('\n③ 설정 파일 (훅 셋 배선 · env 셋)');
  const tpl = fs.readFileSync(path.join(PRODEV, 'common', 'settings.template.json'), 'utf8');
  const settings = JSON.parse(tpl
    .replace(/\{\{PROJECT\}\}/g, pat(과제폴더))
    .replace(/\{\{BOT\}\}/g, pat(봇폴더))
    .replace(/\{\{PRODEV\}\}/g, pat(PRODEV))
    .replace(/\{\{UPLOADS\}\}/g, pat(UPLOADS))
    .replace(/\{\{HOOKS\}\}/g, esc(path.join(PRODEV, 'common', 'hooks')))
    .replace(/\{\{PROJECT_DIR\}\}/g, esc(과제폴더))
    .replace(/\{\{UPLOADS_DIR\}\}/g, esc(UPLOADS))
    .replace(/\{\{PRODEV_DIR\}\}/g, esc(PRODEV))
    .replace(/\{\{BOT_NAME\}\}/g, 봇)
    .replace(/\{\{DB\}\}/g, esc(DB))
    .replace(/\{\{STATUSLINE\}\}/g, esc(path.join(PRODEV, 'common', 'statusline.sh')))
    .replace(/\{\{PATH\}\}/g, esc(BOT_PATH))
    .replace('"{{AUTOCOMPACT}}"', String(AUTOCOMPACT)));

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
    log(`node scripts/setup.js rooms ${과제}   → 방 일곱 만들고 봇 참여`);
    log(`cd ${JSON.stringify(봇폴더)} && claude ${CLAUDE_ARGS.join(' ')}`);
  }
  return { 봇, 봇폴더, 과제폴더, settings };
}

// ── 방 일곱 ───────────────────────────────────────────────

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

  // 봇이 "내가 어느 방을 맡나"를 아는 자리. 훅(pre-reply)도 DB 가 죽었을 때 이것으로 방 갈래를 안다.
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
  console.log(`0 8 * * 1-5 curl -sS -X POST ${URL_}/api/rooms/<본방번호>/messages -H 'Content-Type: application/json' -H "Authorization: Bearer $PRODEV_NOTIFY_TOKEN" -d '{"text":"@TO(${봇}) 오늘 브리핑"}' >/dev/null`);
  console.log(`30 18 * * 1-5 curl -sS -X POST ${URL_}/api/rooms/<본방번호>/messages -H 'Content-Type: application/json' -H "Authorization: Bearer $PRODEV_NOTIFY_TOKEN" -d '{"text":"@TO(${봇}) 오늘 일지"}' >/dev/null`);
  console.log(`\n본방: ${본방} · 알림 계정 토큰은 PRODEV_NOTIFY_TOKEN 에 둔다 (봇 글은 게이트웨이만 보낼 수 있다).`);
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

module.exports = { install, rooms, cron, archive, 봇이름, 갈래 };
