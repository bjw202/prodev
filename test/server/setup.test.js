// setup.js 시험 — 이 시험만 서버가 필요하다. 그래서 npm test 가 아니라 npm run test:server 다.
//
// 스스로 임시 minidiscord 서버를 띄운다 (빈 DB · 안 쓰는 포트 · 끝나면 내림).
// 띄우는 법은 ../minidiscord/scripts/e2e-lib.mts 의 spawnServer 와 같다 — npx tsx server/src/index.ts 에
// MINIDISCORD_PORT · HOST · DATA_DIR · BOT_FILES_DIR 를 준다. server/src/** 를 import 하지 않고 HTTP 로만 말한다.
//
// 사람 손이 필요한 자리는 없다. 봇 등록도 POST /api/bots 로 된다.

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { spawn, execFileSync, execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const MINIDISCORD = path.resolve(ROOT, '..', 'minidiscord');
const SETUP = path.join(ROOT, 'scripts', 'setup.js');
const 과제 = '시험과제';
const 갈래 = ['들이기', '자료', '리서치', '특허', '논문', '보고'];
const 봇 = `prodev-${과제}-비서`;

const 상태 = { child: null, port: 0, dataDir: null, project: null, botDir: null, url: '' };

function 빈포트() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

const 잠깐 = ms => new Promise(r => setTimeout(r, ms));

async function 뜰때까지(url, child, 최대 = 60000) {
  const 끝 = Date.now() + 최대;
  while (Date.now() < 끝) {
    if (child.exitCode !== null) throw new Error(`서버가 뜨기 전에 죽었다 (exit ${child.exitCode})`);
    try {
      const r = await fetch(`${url}/api/health`);
      if (r.ok && (await r.json()).ok) return Date.now();
    } catch { /* 아직 */ }
    await 잠깐(300);
  }
  throw new Error(`서버가 ${최대}ms 안에 안 떴다`);
}

function 돌린다(args, env) {
  return execFileSync(process.execPath, [SETUP, ...args], {
    encoding: 'utf8', cwd: ROOT, timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, MINIDISCORD_URL: 상태.url, MINIDISCORD_DIR: MINIDISCORD, ...env },
  });
}

let 로그인쿠키 = '';

// 알림 계정(사람 계정)의 세션 쿠키 값. cron 줄의 $PRODEV_NOTIFY_TOKEN 자리에 들어간다 (ADR-018).
let 알림토큰 = '';
async function 알림계정만들기() {
  const r = await fetch(상태.url + '/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'prodev-알림' }),
  });
  const sc = r.headers.get('set-cookie') || '';
  알림토큰 = (/md_session=([^;]+)/.exec(sc) || [, ''])[1];
  assert.ok(알림토큰, '알림 계정 토큰을 못 받았다');
}

async function api(method, p, body) {
  const r = await fetch(상태.url + p, {
    method, headers: { 'content-type': 'application/json', cookie: 로그인쿠키 },
    body: body ? JSON.stringify(body) : undefined,
  });
  const sc = r.headers.get('set-cookie'); if (sc) 로그인쿠키 = sc.split(';')[0];
  const t = await r.text();
  return { status: r.status, body: (() => { try { return JSON.parse(t); } catch { return t; } })() };
}

before(async () => {
  assert.ok(fs.existsSync(path.join(MINIDISCORD, 'server', 'src', 'index.ts')), `minidiscord 가 없다: ${MINIDISCORD}`);

  상태.port = await 빈포트();
  상태.url = `http://127.0.0.1:${상태.port}`;
  상태.dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prodev-md-data-'));
  const botFiles = fs.mkdtempSync(path.join(os.tmpdir(), 'prodev-md-files-'));
  // 과제 폴더 이름이 곧 과제 이름이다 (setup.js 가 basename 으로 읽는다)
  상태.project = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'prodev-proj-')), 과제);
  fs.mkdirSync(상태.project, { recursive: true });
  상태.botDir = path.join(ROOT, 'bots', 봇);

  console.log(`  임시 서버: ${상태.url} · DB 폴더 ${상태.dataDir}`);
  상태.child = spawn('npx', ['tsx', 'server/src/index.ts'], {
    cwd: MINIDISCORD, stdio: ['ignore', 'ignore', 'pipe'],
    env: {
      ...process.env,
      MINIDISCORD_PORT: String(상태.port),
      MINIDISCORD_HOST: '127.0.0.1',
      MINIDISCORD_DATA_DIR: 상태.dataDir,
      MINIDISCORD_BOT_FILES_DIR: botFiles,
    },
  });
  상태.child.stderr.on('data', () => {});          // 서버 로그는 삼킨다. 판정은 HTTP 로만 한다
  await 뜰때까지(상태.url, 상태.child);
  console.log(`  서버 떴다 (포트 ${상태.port})`);

  // 빈 DB 인지 못 박는다 — 남의 서버에 붙어 도는 것이 아님을 여기서 가른다
  await api('POST', '/api/auth/login', { username: 'prodev-test' });
  const 처음 = await api('GET', '/api/rooms');
  assert.deepStrictEqual(처음.body.active, [], '빈 DB 가 아니다');

  돌린다([], { PRODEV_PROJECT: 상태.project });
  돌린다(['rooms', 과제], {});

  await 알림계정만들기();
  await api('POST', '/api/auth/login', { username: 'prodev-test' });   // 로그인쿠키를 시험 계정으로 되돌린다
});

after(async () => {
  if (상태.child && 상태.child.exitCode === null) {
    상태.child.kill('SIGTERM');
    for (let i = 0; i < 40 && 상태.child.exitCode === null; i++) await 잠깐(100);
    if (상태.child.exitCode === null) 상태.child.kill('SIGKILL');
  }
  console.log(`  서버 내렸다 (포트 ${상태.port})`);
  for (const d of [상태.dataDir, 상태.botDir]) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch {}
  }
});

test('setup rooms — GET /api/rooms 에 방이 일곱이다', async () => {
  const r = await api('GET', '/api/rooms');
  assert.strictEqual(r.status, 200);
  const 이름 = r.body.active.map(x => x.name).sort();
  const 기대 = [`prodev-${과제}`, ...갈래.map(g => `prodev-${과제}/${g}`)].sort();
  assert.strictEqual(이름.length, 7, `방이 ${이름.length}개다: ${이름.join(', ')}`);
  assert.deepStrictEqual(이름, 기대);
});

test('setup rooms — 일곱 방 전부에 봇이 참여했다', async () => {
  const rooms = (await api('GET', '/api/rooms')).body.active;
  assert.strictEqual(rooms.length, 7);
  for (const room of rooms) {
    const r = await api('GET', `/api/rooms/${room.id}/bots`);
    assert.strictEqual(r.status, 200);
    const 이름 = r.body.map(x => x.name ?? x.bot_name);
    assert.ok(이름.includes(봇), `${room.name} 에 ${봇} 가 없다 — ${JSON.stringify(r.body)}`);
  }
});

test('setup rooms — 다시 돌려도 방이 늘지 않는다 (있으면 그대로 쓴다)', async () => {
  const 전 = (await api('GET', '/api/rooms')).body.active.map(r => r.id).sort();
  const out = 돌린다(['rooms', 과제], {});
  assert.match(out, /방 있음/);
  const 후 = (await api('GET', '/api/rooms')).body.active.map(r => r.id).sort();
  assert.deepStrictEqual(후, 전, '방이 새로 생겼다');
});

test('setup — bots/<이름>/rooms.json 에 방 일곱이 id·name 으로 있다', () => {
  const j = JSON.parse(fs.readFileSync(path.join(상태.botDir, 'rooms.json'), 'utf8'));
  assert.strictEqual(j.과제, 과제);
  assert.strictEqual(j.rooms.length, 7);
  for (const r of j.rooms) {
    assert.ok(Number.isInteger(r.id) && r.id > 0, `id 가 이상하다: ${JSON.stringify(r)}`);
    assert.ok(typeof r.name === 'string' && r.name.startsWith(`prodev-${과제}`));
  }
  // places.js 가 읽는 꼴 그대로여야 훅이 DB 없이도 방 갈래를 안다
  const P = require('../../common/hooks/places.js');
  const 자료 = j.rooms.find(r => r.name.endsWith('/자료'));
  process.env.PRODEV_BOT_DIR = 상태.botDir;
  process.env.MINIDISCORD_DB = path.join(상태.dataDir, '없다.db');
  const 찾음 = P.roomName(자료.id);
  assert.ok(찾음, 'places.js 가 rooms.json 에서 방을 못 찾았다');
  assert.strictEqual(찾음.name, 자료.name);
  assert.strictEqual(찾음.출처, 'rooms.json');
  assert.strictEqual(P.roomParts(찾음.name).갈래, '자료');
});

test('setup — bots/<이름>/.claude/settings.json 에 훅 셋과 env 셋이 있다', () => {
  const s = JSON.parse(fs.readFileSync(path.join(상태.botDir, '.claude', 'settings.json'), 'utf8'));

  assert.deepStrictEqual(Object.keys(s.hooks).sort(), ['PreCompact', 'PreToolUse', 'SessionStart']);
  assert.strictEqual(s.hooks.SessionStart[0].matcher, 'startup|resume|clear|compact');
  assert.strictEqual(s.hooks.PreToolUse[0].matcher, 'mcp__minidiscord-channel__reply');
  for (const [사건, 파일] of [['SessionStart', 'session-start.js'], ['PreCompact', 'pre-compact.js'], ['PreToolUse', 'pre-reply.js']]) {
    const cmd = s.hooks[사건][0].hooks[0].command;
    assert.ok(cmd.includes(path.join('common', 'hooks', 파일)), `${사건} 이 ${파일} 을 안 가리킨다: ${cmd}`);
    assert.ok(path.isAbsolute(cmd.replace(/^node /, '')), `훅 경로가 절대 경로가 아니다: ${cmd}`);
  }
  assert.strictEqual(s.hooks.PreCompact[0].hooks[0].timeout, 180);

  // env 셋 — 훅이 자리를 찾는 데 쓰는 것 (PRODEV_HOOK 은 여기 없다. 그것은 pre-compact 가 자식에게만 붙인다)
  assert.strictEqual(s.env.PRODEV_BOT, 봇);
  assert.strictEqual(s.env.PRODEV_PROJECT, 상태.project);
  assert.ok(s.env.MINIDISCORD_DB.endsWith('.db'));
  assert.ok(!('PRODEV_HOOK' in s.env), 'PRODEV_HOOK 이 봇 env 에 들어갔다');
  assert.ok(!s.env.PATH.includes('$') && !s.env.PATH.includes('%'), 'PATH 에 안 펼쳐진 변수 참조가 있다');

  // 허용 목록 — crew 33건 + 회차 5 원인 넷을 덮는 것
  assert.ok(s.permissions.allow.length >= 38, `허용이 ${s.permissions.allow.length}건이다`);
  for (const 항목 of ['Bash(python3:*)', 'Bash(chmod:*)', 'Bash(shasum:*)', 'Bash(cd:*)', 'Bash(gh:*)', 'Bash(grep:*)']) {
    assert.ok(s.permissions.allow.includes(항목), `허용에 ${항목} 이 없다`);
  }
  // 업로드 폴더는 읽게 열되 쓰지는 못하게 한다 (원본 불변)
  assert.ok(s.permissions.additionalDirectories.length >= 2);
  assert.ok(s.permissions.deny.some(d => d.startsWith('Write(')), '업로드 폴더 쓰기를 안 막았다');
});

test('setup cron — crontab 두 줄을 stdout 으로만 낸다', () => {
  const out = 돌린다(['cron', 과제], {});
  const 줄 = out.split('\n').filter(l => /^[\d*]/.test(l.trim()) && l.includes('curl'));
  assert.strictEqual(줄.length, 2, `crontab 줄이 ${줄.length}개다`);
  assert.ok(줄[0].startsWith('0 8 '), `아침 줄이 아니다: ${줄[0]}`);
  assert.ok(줄[1].startsWith('30 18 '), `저녁 줄이 아니다: ${줄[1]}`);
  for (const l of 줄) {
    assert.ok(l.includes('/api/rooms/') && l.includes('/messages'), 'API 를 안 친다');
    assert.ok(l.includes(`@TO(${봇})`), '봇을 안 부른다');
  }
  assert.ok(줄[0].includes('브리핑') && 줄[1].includes('일지'));

  // ADR-018 — 서버는 쿠키 md_session 하나로만 인증하고 글 올리기는 multipart 만 받는다.
  // Bearer + JSON 으로 보내면 401/406 이라 브리핑도 일지도 오지 않는다.
  for (const l of 줄) {
    assert.ok(l.includes('-b "md_session=$PRODEV_NOTIFY_TOKEN"'), `쿠키로 안 보낸다: ${l}`);
    assert.ok(l.includes('--form-string '), `multipart 로 안 보낸다: ${l}`);
    // -F 였다면 '@TO(' 를 파일 경로로 읽어 curl 이 26 으로 죽는다. 한 번 밟은 자리다.
    assert.ok(!/(^|\s)-F\s/.test(l), `-F 는 '@' 를 파일로 읽는다: ${l}`);
    assert.ok(!l.includes('Bearer'), `Bearer 가 남아 있다: ${l}`);
    assert.ok(!l.includes('application/json'), `JSON 으로 보낸다: ${l}`);
  }
});

test('setup cron — 낸 줄을 그대로 서버에 보내면 200 이고 글이 방에 남는다 (ADR-018)', async () => {
  // 낸 줄을 눈으로 읽고 "되겠지" 하지 않는다. 진짜 서버에 그대로 쏴 본다.
  const 본방 = (await api('GET', '/api/rooms')).body.active.find(r => r.name === `prodev-${과제}`);
  assert.ok(본방, '본방이 없다');

  const out = 돌린다(['cron', 과제], {});
  const 아침 = out.split('\n').find(l => l.trim().startsWith('0 8 ') && l.includes('curl'));
  assert.ok(아침, '아침 줄이 없다');

  // crontab 줄에서 curl 부터 리디렉션 앞까지를 떼어, 자리표시자와 셸 변수를 실제 값으로 바꾼다
  const 명령 = 아침.slice(아침.indexOf('curl')).replace(/\s*>\/dev\/null\s*$/, '')
    .replace('<본방번호>', String(본방.id))
    .replace('$PRODEV_NOTIFY_TOKEN', 알림토큰);

  const 전 = (await api('GET', `/api/rooms/${본방.id}/messages?after=0`)).body.messages.length;
  const 답 = execSync(`${명령} -o /dev/null -w '%{http_code}'`, { encoding: 'utf8' }).trim();
  assert.strictEqual(답, '200', `cron 줄이 ${답} 을 받았다`);

  const 글들 = (await api('GET', `/api/rooms/${본방.id}/messages?after=0`)).body.messages;
  assert.strictEqual(글들.length, 전 + 1, '글이 안 남았다');
  const 마지막 = 글들[글들.length - 1];
  assert.match(마지막.body, /오늘 브리핑/);
  assert.strictEqual(마지막.author_type, 'user', '알림 계정은 사람 계정이다');
  console.log(`      cron 글 message_id=${마지막.id} · author=${마지막.author_name}`);
});

test('setup archive — 방 하나를 보관하면 active 에서 빠지고 archived 로 간다', async () => {
  const 방 = `prodev-${과제}/특허`;
  const out = 돌린다(['archive', 방], {});
  assert.match(out, /보관/);

  const r = await api('GET', '/api/rooms');
  assert.ok(!r.body.active.some(x => x.name === 방), 'active 에 그대로 있다');
  assert.ok(r.body.archived.some(x => x.name === 방), 'archived 에 없다');
  assert.strictEqual(r.body.active.length, 6);
});
