// setup.js — 과제 폴더의 자리(ADR-032)와 봇 설정의 허용 목록·Git Bash 길(ADR-033).
//
// install() 통째가 아니라 그것이 부르는 둘을 직접 본다: 과제폴더세우기 · 설정빚기.
// 까닭은 install() 이 서버에 붙고 bots/ 아래에 진짜 봇 폴더를 만들기 때문이다 —
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

// ── 봇 설정 (ADR-033) ─────────────────────────────────────

function 설정(proj) {
  const 봇폴더 = tmp('setup-bot');
  const DB = path.join(tmp('setup-md'), 'minidiscord.db');
  return 조용히(() => S.설정빚기({ 과제폴더: proj, 봇폴더, 봇: 'prodev-시험-bot', DB, UPLOADS: tmp('setup-up') }));
}

test('setup — 봇 설정 env 에 CLAUDE_CODE_GIT_BASH_PATH 가 있고 값이 비지 않는다 (맥에서도)', () => {
  const s = 설정(tmp('setup-env'));

  assert.ok('CLAUDE_CODE_GIT_BASH_PATH' in s.env, '키가 없다 — 봇은 user 범위 설정을 못 읽는다');
  assert.ok(s.env.CLAUDE_CODE_GIT_BASH_PATH.length > 0, '값이 비었다. 비면 안 둔 것과 같다');
  assert.ok(/bash/i.test(s.env.CLAUDE_CODE_GIT_BASH_PATH), `bash 를 가리키지 않는다: ${s.env.CLAUDE_CODE_GIT_BASH_PATH}`);
  // 틀의 {{…}} 가 안 바뀐 채 남으면 안 된다
  assert.ok(!/\{\{/.test(JSON.stringify(s)), '치환되지 않은 {{자리}} 가 남았다');
  // 전에 있던 것들은 그대로다
  for (const k of ['CLAUDE_CODE_DISABLE_AUTO_MEMORY', 'PATH', 'PRODEV_BOT', 'PRODEV_PROJECT', 'MINIDISCORD_DB', 'MINIDISCORD_URL']) {
    assert.ok(k in s.env, `env 가 빠졌다: ${k}`);
  }
});

// 내장 도구가 덮으므로 뺀 것들. 여기 한 줄이 되살아나면 셸로 새어 나갈 자리가 다시 열린다.
const 뺀것 = ['grep', 'find', 'sed', 'awk', 'sort', 'uniq', 'wc', 'head', 'tail', 'cat', 'diff', 'tr', 'cut',
  'stat', 'file', 'shasum', 'sha256sum', 'cp', 'chmod', 'basename', 'dirname'];

test('setup — 허용 목록에 셸 도구 스물하나가 없다 (내장 도구가 덮는다)', () => {
  const allow = 설정(tmp('setup-allow')).permissions.allow;

  for (const 이름 of 뺀것) {
    assert.ok(!allow.includes(`Bash(${이름}:*)`) && !allow.includes(`Bash(${이름})`),
      `허용 목록에 아직 있다: ${이름}`);
  }
  assert.strictEqual(뺀것.length, 21);
});

test('setup — 그 대신 Grep · Glob · Read 가 이름으로 허용된다 (안 열면 찾기가 승인 창으로 샌다)', () => {
  const allow = 설정(tmp('setup-builtin')).permissions.allow;

  for (const 도구 of ['Read', 'Grep', 'Glob']) {
    assert.ok(allow.includes(도구), `내장 도구가 안 열렸다: ${도구}`);
  }
});

test('setup — 스킬과 에이전트가 부르는 명령은 전부 남아 있다 (봇이 할 수 있는 일이 줄지 않았다)', () => {
  const allow = 설정(tmp('setup-keep')).permissions.allow;

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
  const allow = 설정(tmp('setup-rm')).permissions.allow;
  for (const 이름 of ['rm', 'mv', 'pip', 'curl']) {
    assert.ok(!allow.some(a => a.startsWith(`Bash(${이름}`)), `열려 있다: ${이름}`);
  }
});

test('setup — deny 는 그대로고, 서버 업로드 폴더 둘이 더해진다 (ADR-019)', () => {
  const proj = tmp('setup-deny');
  const s = 설정(proj);

  assert.strictEqual(s.permissions.deny.length, 7, '틀 5 + 업로드 2 가 아니다');
  assert.ok(s.permissions.deny.some(d => d.includes('.env')));
  // 어떤 deny 도 과제 폴더를 덮지 않는다 — 덮으면 봇이 아무것도 못 남긴다
  for (const d of s.permissions.deny) {
    const m = /^(?:Write|Edit)\((.*?)\/\*\*\)$/.exec(d);
    if (m) assert.ok(!path.resolve(proj).startsWith(path.resolve(m[1].replace(/^\/\//, '/'))),
      `deny 가 과제 폴더를 덮는다: ${d}`);
  }
});
