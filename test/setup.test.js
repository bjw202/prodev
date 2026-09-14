// setup.js — 과제 폴더의 자리(ADR-032) · 봇 설정의 허용 목록·Git Bash 길(ADR-033) · 설정 두 장과 조종석 자리(ADR-038).
//
// install() 통째가 아니라 그것이 부르는 둘을 직접 본다: 과제폴더세우기 · 설정빚기.
// 까닭은 install() 이 bots/ 아래에 진짜 봇 폴더를 만들기 때문이다 —
// 시험이 그 자리를 만지면 안 된다 (as-built 1절: "이 저장소의 어떤 시험도 여기를 만지지 않는다").
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const S = require(path.join(ROOT, 'scripts', 'setup.js'));

const tmp = p => fs.mkdtempSync(path.join(os.tmpdir(), `prodev-${p}-`));

// setup 은 사람에게 무엇을 만들었는지 줄마다 말한다. 시험에서는 그 말이 판정을 덮으므로 막는다.
function 조용히(fn) {
  const 원래 = console.log;
  console.log = () => {};
  try { return fn(); } finally { console.log = 원래; }
}
const 세운다 = proj => 조용히(() => S.과제폴더세우기(proj));

// ── 과제 폴더의 자리 (ADR-032) ────────────────────────────

test('setup — 새 과제 폴더에 analysis · templates · house.md · .gitignore 를 만든다', () => {
  const proj = tmp('setup-dirs');
  세운다(proj);

  // 전에도 있던 열
  for (const d of ['cards', 'wiki', 'inbox', 'journal', 'threads', 'research', 'patent', 'paper', 'report', 'tmp']) {
    assert.ok(fs.statSync(path.join(proj, d)).isDirectory(), `폴더가 없다: ${d}`);
  }
  // 이번에 더한 넷
  assert.ok(fs.statSync(path.join(proj, 'analysis')).isDirectory(), 'analysis/ 가 없다');
  assert.ok(fs.statSync(path.join(proj, 'templates')).isDirectory(), 'templates/ 가 없다');
  assert.ok(fs.existsSync(path.join(proj, 'house.md')), 'house.md 가 없다');
  assert.ok(fs.existsSync(path.join(proj, '.gitignore')), '.gitignore 가 없다');
  // 과제 폴더 하나 = git 저장소 하나 (ADR-003)
  assert.ok(fs.existsSync(path.join(proj, '.git')), 'git init 이 안 됐다');
});

test('setup — .gitignore 는 tmp/ 한 줄이다 (ARCHITECTURE 4.2 가 적어 둔 그것)', () => {
  const proj = tmp('setup-ignore');
  세운다(proj);

  const 줄 = fs.readFileSync(path.join(proj, '.gitignore'), 'utf8').trim().split(/\r?\n/);
  assert.deepStrictEqual(줄, ['tmp/']);
});

test('setup — house.md 는 빈 파일이 아니다. 상한 50줄 안에서 무엇을 적는지 말한다', () => {
  const proj = tmp('setup-house');
  세운다(proj);

  const house = fs.readFileSync(path.join(proj, 'house.md'), 'utf8');
  const 줄수 = house.replace(/\s+$/, '').split(/\r?\n/).length;

  // 골격 자신이 상한을 넘으면 태어나자마자 잘린다
  assert.ok(줄수 <= 50, `골격이 상한을 넘는다: ${줄수}줄`);
  assert.ok(줄수 >= 10, `골격이 너무 얇다: ${줄수}줄`);
  // 머리에 있어야 하는 것 — 무엇을 적는 자리인가 · 상한 · 되돌리기 위한 셋
  assert.ok(house.includes('규칙'), '여기가 규칙 자리라는 말이 없다');
  assert.ok(house.includes('50줄'), '상한을 말하지 않는다');
  assert.ok(house.includes('스스로 줄이지 않는다'), '넘쳤을 때 누가 줄이는지 말하지 않는다');
  for (const 것 of ['언제부터', '누가', '무엇을 보고']) {
    assert.ok(house.includes(것), `되돌리기 위한 칸이 빠졌다: ${것}`);
  }
});

test('setup — 이미 있는 house.md 와 .gitignore 는 덮지 않는다 (다시 돌려도 안 지운다)', () => {
  const proj = tmp('setup-again');
  세운다(proj);
  fs.writeFileSync(path.join(proj, 'house.md'), '# 사람이 적은 규칙\n- 건드리지 마라\n');
  fs.writeFileSync(path.join(proj, '.gitignore'), 'tmp/\n*.xlsx\n');

  세운다(proj);   // 두 번째

  assert.ok(fs.readFileSync(path.join(proj, 'house.md'), 'utf8').includes('건드리지 마라'), 'house.md 를 덮었다');
  assert.ok(fs.readFileSync(path.join(proj, '.gitignore'), 'utf8').includes('*.xlsx'), '.gitignore 를 덮었다');
});

// ── 봇 설정 두 장 (ADR-033 · ADR-038) ──────────────────────
//
// 조종석은 봇을 headless(Agent SDK) 세션으로 띄운다. 그 세션은 settings.json 의 permissions.allow 를 읽지 않고
// settings.local.json 의 것은 읽는다 (ADR-038). 그래서 허용 · 거부 · 바깥 폴더는 **local** 에서 본다.

function 빚는다(proj) {
  const 봇폴더 = tmp('setup-bot');
  const data = tmp('setup-cockpit');
  const 자리 = {
    DB: path.join(data, 'chat.db'), COCKPIT_DB: path.join(data, 'cockpit.db'), UPLOADS_DIR: tmp('setup-up'),
  };
  const 빚음 = 조용히(() => S.설정빚기({ 과제폴더: proj, 봇폴더, 봇: 'prodev-시험-bot', ...자리 }));
  return { ...빚음, 자리 };
}
// Claude Code 권한 패턴 — setup.js 의 pat 과 같은 꼴 (맥·리눅스는 앞에 //, 윈도우는 그대로)
const 패턴 = p => {
  const s = p.replace(/\\/g, '/');
  return process.platform === 'win32' ? s : '//' + s.replace(/^\//, '');
};

test('setup — 봇 설정 env 에 CLAUDE_CODE_GIT_BASH_PATH 가 있고 값이 비지 않는다 (맥에서도)', () => {
  const { settings: s, local } = 빚는다(tmp('setup-env'));

  assert.ok('CLAUDE_CODE_GIT_BASH_PATH' in s.env, '키가 없다 — 봇은 user 범위 설정을 못 읽는다');
  assert.ok(s.env.CLAUDE_CODE_GIT_BASH_PATH.length > 0, '값이 비었다. 비면 안 둔 것과 같다');
  assert.ok(/bash/i.test(s.env.CLAUDE_CODE_GIT_BASH_PATH), `bash 를 가리키지 않는다: ${s.env.CLAUDE_CODE_GIT_BASH_PATH}`);
  // 틀의 {{…}} 가 안 바뀐 채 남으면 안 된다 — 두 장 다
  assert.ok(!/\{\{/.test(JSON.stringify(s)), 'settings.json 에 치환되지 않은 {{자리}} 가 남았다');
  assert.ok(!/\{\{/.test(JSON.stringify(local)), 'settings.local.json 에 치환되지 않은 {{자리}} 가 남았다');
  // 전에 있던 것들은 그대로다
  for (const k of ['CLAUDE_CODE_DISABLE_AUTO_MEMORY', 'PATH', 'PRODEV_BOT', 'PRODEV_PROJECT', 'MINIDISCORD_DB', 'MINIDISCORD_URL']) {
    assert.ok(k in s.env, `env 가 빠졌다: ${k}`);
  }
  // 알림 서버는 없다 — 훅은 빈 값이면 조용히 건너뛴다 (ADR-038)
  assert.strictEqual(s.env.MINIDISCORD_URL, '', 'MINIDISCORD_URL 이 빈 값이 아니다');
});

test('setup — 권한은 settings.local.json 에만, 훅 · env 는 settings.json 에만 있다 (ADR-038)', () => {
  const { settings, local } = 빚는다(tmp('setup-two'));

  assert.ok(!('permissions' in settings), 'settings.json 에 permissions 가 남았다 — headless 세션은 그 allow 를 안 읽는다');
  assert.deepStrictEqual(Object.keys(local), ['permissions'], `settings.local.json 에 권한 말고 다른 것이 있다: ${Object.keys(local)}`);
  assert.deepStrictEqual(Object.keys(local.permissions).sort(), ['additionalDirectories', 'allow', 'deny']);
  for (const k of ['env', 'hooks', 'statusLine', 'autoCompactEnabled', 'autoCompactWindow']) {
    assert.ok(k in settings, `settings.json 에 ${k} 가 없다`);
    assert.ok(!(k in local), `settings.local.json 에 ${k} 가 들어갔다`);
  }
});

test('setup — 틀 두 장의 꼴: local 틀은 { permissions } 하나뿐이고 settings 틀에는 permissions 가 없다 (조종석이 기대는 꼴)', () => {
  const 틀 = f => JSON.parse(fs.readFileSync(path.join(ROOT, 'common', f), 'utf8').replace('"{{AUTOCOMPACT}}"', '1'));
  const settings = 틀('settings.template.json');
  const local = 틀('settings.local.template.json');
  assert.deepStrictEqual(Object.keys(local), ['permissions']);
  assert.ok(!('permissions' in settings));
  // 자리표시자 이름은 그대로다 — 조종석 스모크가 같은 이름으로 채운다
  const 자리표시자 = [...new Set(JSON.stringify(local).match(/\{\{[A-Z_]+\}\}/g))].sort();
  assert.deepStrictEqual(자리표시자, ['{{BOT}}', '{{PRODEV_DIR}}', '{{PRODEV}}', '{{PROJECT_DIR}}', '{{PROJECT}}', '{{UPLOADS_DIR}}'].sort());
});

test('setup — 도구 이름은 mcp__cockpit__ 이다. minidiscord 채널 이름이 두 장 어디에도 없다 (ADR-038)', () => {
  const { settings, local } = 빚는다(tmp('setup-names'));
  assert.ok(local.permissions.allow.includes('mcp__cockpit__reply'));
  assert.ok(local.permissions.allow.includes('mcp__cockpit__fetch_history'));
  assert.strictEqual(settings.hooks.PreToolUse[0].matcher, 'mcp__cockpit__reply', 'pre-reply 훅이 cockpit 의 reply 에 안 걸린다');
  assert.ok(!/minidiscord-channel/.test(JSON.stringify(settings) + JSON.stringify(local)), '옛 채널 도구 이름이 남았다');
});

// 내장 도구가 덮으므로 뺀 것들. 여기 한 줄이 되살아나면 셸로 새어 나갈 자리가 다시 열린다.
const 뺀것 = ['grep', 'find', 'sed', 'awk', 'sort', 'uniq', 'wc', 'head', 'tail', 'cat', 'diff', 'tr', 'cut',
  'stat', 'file', 'shasum', 'sha256sum', 'cp', 'chmod', 'basename', 'dirname'];

test('setup — 허용 목록에 셸 도구 스물하나가 없다 (내장 도구가 덮는다)', () => {
  const allow = 빚는다(tmp('setup-allow')).local.permissions.allow;

  for (const 이름 of 뺀것) {
    assert.ok(!allow.includes(`Bash(${이름}:*)`) && !allow.includes(`Bash(${이름})`),
      `허용 목록에 아직 있다: ${이름}`);
  }
  assert.strictEqual(뺀것.length, 21);
});

test('setup — 그 대신 Grep · Glob · Read 가 이름으로 허용된다 (안 열면 찾기가 승인 창으로 샌다)', () => {
  const allow = 빚는다(tmp('setup-builtin')).local.permissions.allow;

  for (const 도구 of ['Read', 'Grep', 'Glob']) {
    assert.ok(allow.includes(도구), `내장 도구가 안 열렸다: ${도구}`);
  }
});

test('setup — 스킬과 에이전트가 부르는 명령은 전부 남아 있다 (봇이 할 수 있는 일이 줄지 않았다)', () => {
  const allow = 빚는다(tmp('setup-keep')).local.permissions.allow;

  // 스킬 열셋과 에이전트 여섯의 본문이 부르는 바깥 명령은 이 셋뿐이다 (ADR-033 맥락)
  for (const 이름 of ['node', 'python3', 'git']) {
    assert.ok(allow.includes(`Bash(${이름}:*)`), `규정된 길이 막혔다: ${이름}`);
  }
  // 승인 원인 넷을 덮던 나머지
  for (const 이름 of ['gh', 'mkdir', 'ls', 'date', 'echo', 'cd']) {
    assert.ok(allow.includes(`Bash(${이름}:*)`), `허용이 빠졌다: ${이름}`);
  }
  assert.ok(allow.includes('Bash(pwd)'));

  const bash = allow.filter(a => a.startsWith('Bash('));
  assert.strictEqual(bash.length, 10, `Bash 항목이 열이 아니다: ${bash.join(' · ')}`);
  assert.strictEqual(allow.length, 22, `허용 목록이 22건이 아니다: ${allow.length}건`);
});

test('setup — 지우는 명령(rm · mv)은 열지 않는다', () => {
  const allow = 빚는다(tmp('setup-rm')).local.permissions.allow;
  for (const 이름 of ['rm', 'mv', 'pip', 'curl']) {
    assert.ok(!allow.some(a => a.startsWith(`Bash(${이름}`)), `열려 있다: ${이름}`);
  }
});

test('setup — deny 는 틀 5 + 조종석 업로드 2 + cockpit.db 셋이고, 과제 폴더를 덮지 않는다 (ADR-019 · ADR-038)', () => {
  const proj = tmp('setup-deny');
  const { local, 자리 } = 빚는다(proj);
  const deny = local.permissions.deny;

  assert.strictEqual(deny.length, 10, `틀 5 + 업로드 2 + cockpit.db 3 이 아니다: ${deny.length}건`);
  assert.ok(deny.some(d => d.includes('.env')));
  // 봇이 제 권한 파일을 못 고친다 — 두 장 다
  assert.ok(deny.some(d => d.endsWith('/.claude/settings.json)')), 'settings.json 을 고칠 수 있다');
  assert.ok(deny.some(d => d.endsWith('/.claude/settings.local.json)')), 'settings.local.json 을 고칠 수 있다 — 허용 목록을 스스로 늘린다');
  // cockpit.db — 읽기 · 고치기 · 쓰기 셋 다 (조종석 ARCHITECTURE 3.3)
  for (const 동사 of ['Read', 'Edit', 'Write']) {
    assert.ok(deny.includes(`${동사}(${패턴(자리.COCKPIT_DB)})`), `deny 에 ${동사}(cockpit.db) 가 없다`);
  }
  // chat.db 는 막지 않는다 — chat.js 가 읽는 대화 원본이다
  assert.ok(!deny.some(d => d.includes('chat.db')), 'chat.db 를 막았다 — find.js 의 대화 층이 죽는다');
  // 조종석 업로드 폴더는 쓰기만 막는다
  assert.ok(deny.includes(`Write(${패턴(자리.UPLOADS_DIR)}/**)`) && deny.includes(`Edit(${패턴(자리.UPLOADS_DIR)}/**)`));
  // 어떤 deny 도 과제 폴더를 덮지 않는다 — 덮으면 봇이 아무것도 못 남긴다
  for (const d of deny) {
    const m = /^(?:Write|Edit)\((.*?)\/\*\*\)$/.exec(d);
    if (m) assert.ok(!path.resolve(proj).startsWith(path.resolve(m[1].replace(/^\/\//, '/'))),
      `deny 가 과제 폴더를 덮는다: ${d}`);
  }
});

test('setup — MINIDISCORD_DB 는 조종석 chat.db, 바깥 폴더에 조종석 업로드 폴더가 있다 (ADR-038)', () => {
  const proj = tmp('setup-places');
  const { settings, local, 자리 } = 빚는다(proj);
  assert.strictEqual(settings.env.MINIDISCORD_DB, 자리.DB);
  assert.ok(!JSON.stringify(settings).includes('cockpit.db'), 'cockpit.db 경로가 봇 env 에 새었다');
  assert.deepStrictEqual(local.permissions.additionalDirectories, [proj, 자리.UPLOADS_DIR, ROOT]);
});

// ── 조종석 설정 한 장에서 자리를 읽는다 (ADR-038) ─────────

test('setup — cockpit.json 에서 chat.db · cockpit.db · 업로드 · 과제 뿌리를 읽는다', () => {
  const d = tmp('setup-cfg');
  const 파일 = path.join(d, 'cockpit.json');
  fs.writeFileSync(파일, JSON.stringify({
    botsDir: path.join(d, 'bots'), projectsDir: path.join(d, 'projects'),
    uploadsDir: path.join(d, 'uploads'), dataDir: path.join(d, 'data'), port: 3000,
  }));
  const c = S.조종석설정({ cockpit: 파일 });
  assert.strictEqual(c.chatDb, path.join(d, 'data', 'chat.db'));
  assert.strictEqual(c.cockpitDb, path.join(d, 'data', 'cockpit.db'));
  assert.strictEqual(c.uploadsDir, path.join(d, 'uploads'));
  assert.strictEqual(c.projectsDir, path.join(d, 'projects'));
});

test('setup — cockpit.json 이 없거나 자리가 빠지면 까닭을 대고 죽는다', () => {
  const d = tmp('setup-cfg-bad');
  assert.throws(() => S.조종석설정({ cockpit: path.join(d, '없다.json') }), /조종석 설정이 없다.*--cockpit/);
  const 파일 = path.join(d, 'cockpit.json');
  fs.writeFileSync(파일, JSON.stringify({ dataDir: d }));
  assert.throws(() => S.조종석설정({ cockpit: 파일 }), /uploadsDir · projectsDir/);
});
