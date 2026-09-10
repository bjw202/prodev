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
// 저장소 사본에서 이 시험을 돌릴 수 있어야 한다 (실제 bots/ 를 만지지 않으려고 사본에서 돈다).
// 사본에는 형제 폴더 minidiscord 가 없으므로 MINIDISCORD_DIR 로 실제 자리를 준다.
const MINIDISCORD = process.env.MINIDISCORD_DIR || path.resolve(ROOT, '..', 'minidiscord');

// setup.js 는 **자기 저장소의 bots/ 아래**에 봇 폴더를 만든다 (setup.js 의 PRODEV = scripts/.. ).
// 그래서 실제 저장소에서 돌리면 사람이 쓰는 봇 폴더를 덮어쓰고, 뒤처리하다 토큰까지 지운다.
// 2026-09-10 에 실제로 그렇게 날렸다. 그 뒤로 시험은 **저장소 사본**에서만 setup 을 돌린다.
//
// 사본에는 setup.js 가 읽는 scripts/ 와 common/ 만 옮긴다. bots/ 는 옮길 목록에 아예 없다.
// **작업 트리**에서 옮긴다 — 지금 고치는 중인 setup.js 를 재야 한다.
// git 에 기대지 않는다: 이 시험 자체가 저장소 사본(.git 이 없는 자리)에서 돌 수 있어야 한다.
function 저장소사본() {
  const 사본 = fs.mkdtempSync(path.join(os.tmpdir(), 'prodev-repo-'));
  // setup.js 가 읽는 것은 이 둘뿐이다: scripts/ (자기 자신) 과 common/ (settings 틀 · 훅 · statusline).
  // 통째로 옮기지 않는다 — bots/ 를 옮길 일이 아예 없어야 한다.
  for (const d of ['scripts', 'common']) 통째로베낀다(path.join(ROOT, d), path.join(사본, d));
  return 사본;
}

function 통째로베낀다(부터, 까지) {
  fs.mkdirSync(까지, { recursive: true });
  for (const e of fs.readdirSync(부터, { withFileTypes: true })) {
    const a = path.join(부터, e.name), b = path.join(까지, e.name);
    if (e.isDirectory()) 통째로베낀다(a, b);
    else if (e.isFile()) { fs.copyFileSync(a, b); fs.chmodSync(b, fs.statSync(a).mode & 0o777); }
  }
}
const 과제 = '시험과제';
// 갈래 이름은 한 자리(places.js)에서 온다. 여기서 다시 적으면 언젠가 갈린다.
const { 갈래 } = require('../../scripts/setup.js');
const 봇 = `prodev-${과제}-비서`;

const 상태 = { child: null, port: 0, dataDir: null, project: null, botDir: null, url: '', repo: null };
// 시험을 시작할 때의 실제 bots/ 목록. 맨 끝 시험이 이것과 견준다.
const 처음bots = (() => { try { return fs.readdirSync(path.join(ROOT, 'bots')).sort(); } catch { return []; } })();

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
  const 사본 = (env && env.__repo) || 상태.repo;
  const { __repo, ...나머지 } = env || {};
  return execFileSync(process.execPath, [path.join(사본, 'scripts', 'setup.js'), ...args], {
    encoding: 'utf8', cwd: 사본, timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, MINIDISCORD_URL: 상태.url, MINIDISCORD_DIR: MINIDISCORD, ...나머지 },
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
  상태.repo = 저장소사본();
  상태.botDir = path.join(상태.repo, 'bots', 봇);   // 실제 저장소가 아니라 사본이다

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
  // 전부 임시 폴더다. 실제 저장소의 bots/ 는 이 파일 어디에서도 지우지 않는다.
  for (const d of [상태.dataDir, 상태.repo]) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch {}
  }
});

test('setup rooms — GET /api/rooms 에 방이 둘이다 (본방 · files, ADR-022)', async () => {
  const r = await api('GET', '/api/rooms');
  assert.strictEqual(r.status, 200);
  const 이름 = r.body.active.map(x => x.name).sort();
  const 기대 = [`prodev-${과제}`, ...갈래.map(g => `prodev-${과제}/${g}`)].sort();
  assert.strictEqual(이름.length, 2, `방이 ${이름.length}개다: ${이름.join(', ')}`);
  assert.deepStrictEqual(이름, 기대);
  assert.deepStrictEqual(갈래, ['files'], '갈래는 files 하나다');
});

test('setup rooms — 방 둘 다에 봇이 참여했다', async () => {
  const rooms = (await api('GET', '/api/rooms')).body.active;
  assert.strictEqual(rooms.length, 2);
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

test('setup — bots/<이름>/rooms.json 에 방 둘이 id·name 으로 있다', () => {
  const j = JSON.parse(fs.readFileSync(path.join(상태.botDir, 'rooms.json'), 'utf8'));
  assert.strictEqual(j.과제, 과제);
  assert.strictEqual(j.rooms.length, 2);
  for (const r of j.rooms) {
    assert.ok(Number.isInteger(r.id) && r.id > 0, `id 가 이상하다: ${JSON.stringify(r)}`);
    assert.ok(typeof r.name === 'string' && r.name.startsWith(`prodev-${과제}`));
  }
  // places.js 가 읽는 꼴 그대로여야 훅이 DB 없이도 방을 안다
  const P = require('../../common/hooks/places.js');
  const 파일방 = j.rooms.find(r => r.name.endsWith('/files'));
  assert.ok(파일방, 'rooms.json 에 files 방이 없다');
  process.env.PRODEV_BOT_DIR = 상태.botDir;
  process.env.MINIDISCORD_DB = path.join(상태.dataDir, '없다.db');
  const 찾음 = P.roomName(파일방.id);
  assert.ok(찾음, 'places.js 가 rooms.json 에서 방을 못 찾았다');
  assert.strictEqual(찾음.name, 파일방.name);
  assert.strictEqual(찾음.출처, 'rooms.json');
  assert.strictEqual(P.roomParts(찾음.name).갈래, P.파일방);

  // 본방은 접미어가 없다
  const 본방 = j.rooms.find(r => r.name === `prodev-${과제}`);
  assert.ok(본방, 'rooms.json 에 본방이 없다');
  assert.strictEqual(P.roomParts(본방.name).갈래, null);
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
  // 파일 뿌리는 읽게 열어 둔다 (첨부가 거기 있다)
  assert.ok(s.permissions.additionalDirectories.length >= 2);
});

test('setup settings — env 에 MINIDISCORD_URL 이 있다 (훅이 방에 알릴 수 있게)', () => {
  // T3.M 재생에서 pre-compact 훅 로그가 "서버나 알림 계정이 없다" 였다.
  // 훅은 process.env.MINIDISCORD_URL 을 보는데 봇 설정에 그것이 없어 기본 3000 을 봤고,
  // 시험 서버는 딴 포트였다. 알림은 fail-open 이라 조용히 건너뛴다 — 그래서 시험으로 못을 박는다.
  const s = JSON.parse(fs.readFileSync(path.join(상태.botDir, '.claude', 'settings.json'), 'utf8'));
  assert.strictEqual(s.env.MINIDISCORD_URL, 상태.url, 'env 의 서버 주소가 실제와 다르다');
  assert.ok(!/\{\{|\}\}/.test(s.env.MINIDISCORD_URL), '틀의 자리표시자가 안 바뀌었다');
});

test('setup settings — deny 가 과제 폴더를 덮지 않는다 (ADR-019)', () => {
  // R1 재생에서 실제로 겪은 것: 파일 뿌리(MINIDISCORD_BOT_FILES_DIR)가 과제 저장소들의 부모인데
  // 그것을 통째로 deny 하는 바람에 봇이 charter.md 를 못 썼다. 헌장을 다 만들고도 남기지 못했다.
  const s = JSON.parse(fs.readFileSync(path.join(상태.botDir, '.claude', 'settings.json'), 'utf8'));
  const 덮는다 = (윗자리, 아랫자리) => {
    const a = path.resolve(윗자리), b = path.resolve(아랫자리);
    return a === b || b.startsWith(a + path.sep);
  };
  const 덮는것 = s.permissions.deny.filter(d => {
    const m = /^(?:Write|Edit)\((.*?)\/\*\*\)$/.exec(d);
    return m && 덮는다(m[1].replace(/^\/\//, '/'), 상태.project);
  });
  assert.deepStrictEqual(덮는것, [], `deny 가 과제 폴더를 덮는다: ${덮는것.join(' · ')}`);

  // 파일 뿌리 자체도 deny 에 없어야 한다 — 과제 폴더가 그 안에 있다
  const 뿌리 = path.dirname(상태.project);
  assert.ok(!s.permissions.deny.some(d => d.includes(뿌리.replace(/^\//, ''))),
    `파일 뿌리가 deny 에 있다: ${뿌리}`);

  // 0층 불변은 deny 가 아니라 intake-copy.js 의 0444 와 git 이 지킨다 (ADR-019)
  assert.ok(s.permissions.additionalDirectories.some(d => path.resolve(d) === path.resolve(상태.project)),
    '과제 폴더가 열려 있지 않다');
});

test('setup settings — 파일 뿌리가 과제 폴더의 부모일 때도 deny 가 안 덮는다 (ADR-019 되돌이 시험)', () => {
  // 위 시험만으로는 모자라다. 시험 하네스는 과제 폴더를 파일 뿌리 **밖**에 두므로,
  // 고치기 전 코드로도 통과한다. 결함이 난 배치는 이것이다:
  //   MINIDISCORD_BOT_FILES_DIR=<루트>/projects  ·  --project <루트>/projects/<과제>
  // ARCHITECTURE 11절이 파일 뿌리를 "과제 저장소들의 부모" 로 정했으니 이것이 정상 배치다.
  const 뿌리 = fs.mkdtempSync(path.join(os.tmpdir(), 'prodev-root-'));
  const 과제이름 = '되돌이시험';
  const 과제폴더 = path.join(뿌리, 'projects', 과제이름);
  fs.mkdirSync(과제폴더, { recursive: true });
  const 사본 = 저장소사본();
  const 봇폴더 = path.join(사본, 'bots', `prodev-${과제이름}-비서`);   // 사본 아래다

  try {
    돌린다([], {
      __repo: 사본,
      PRODEV_PROJECT: 과제폴더,
      MINIDISCORD_BOT_FILES_DIR: path.join(뿌리, 'projects'),
      MINIDISCORD_DB: path.join(뿌리, 'mddata', 'minidiscord.db'),
    });

    const s = JSON.parse(fs.readFileSync(path.join(봇폴더, '.claude', 'settings.json'), 'utf8'));
    const 덮는것 = s.permissions.deny.filter(d => {
      const m = /^(?:Write|Edit)\((.*?)\/\*\*\)$/.exec(d);
      if (!m) return false;
      const 자리 = path.resolve(m[1].replace(/^\/\//, '/'));
      return 과제폴더 === 자리 || 과제폴더.startsWith(자리 + path.sep);
    });
    assert.deepStrictEqual(덮는것, [], `deny 가 과제 폴더를 덮는다 — 봇이 charter.md 를 못 쓴다: ${덮는것.join(' · ')}`);

    // 서버 업로드 폴더는 그대로 읽기 전용이어야 한다 (그 자리는 남의 원본이다)
    const 서버업로드 = path.join(뿌리, 'mddata', 'uploads');
    assert.ok(s.permissions.deny.some(d => d.includes(서버업로드.replace(/^\//, ''))),
      '서버 업로드 폴더까지 열어 버렸다');
  } finally {
    fs.rmSync(사본, { recursive: true, force: true });
    fs.rmSync(뿌리, { recursive: true, force: true });
  }
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
  const 방 = `prodev-${과제}/files`;
  const out = 돌린다(['archive', 방], {});
  assert.match(out, /보관/);

  const r = await api('GET', '/api/rooms');
  assert.ok(!r.body.active.some(x => x.name === 방), 'active 에 그대로 있다');
  assert.ok(r.body.archived.some(x => x.name === 방), 'archived 에 없다');
  assert.strictEqual(r.body.active.length, 1, '본방만 남아야 한다');
});

// 이 파일의 마지막 시험이다. 앞의 시험들이 실제 저장소를 만졌는지 여기서 본다.
test('시험은 실제 bots/ 를 만지지 않는다 (시험 전후 목록이 같다)', () => {
  // 2026-09-10 에 setup.js 를 실제 저장소에서 돌려 사람이 쓰던 봇 폴더를 덮어쓰고,
  // 뒤처리한다며 지워 토큰까지 날렸다. 그 사고를 다시는 못 내게 하는 못이다.
  const 지금bots = (() => { try { return fs.readdirSync(path.join(ROOT, 'bots')).sort(); } catch { return []; } })();
  assert.deepStrictEqual(지금bots, 처음bots,
    `시험이 실제 bots/ 를 바꿨다 — 전: [${처음bots}] 후: [${지금bots}]`);
});
