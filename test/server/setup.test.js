// setup.js 시험 — setup.js 를 **자식 프로세스로 통째로** 돌려 실제로 쓰인 파일을 본다.
// 그래서 npm test 가 아니라 npm run test:server 에 둔다 (저장소 사본을 만들고 명령을 여러 번 띄운다).
//
// 조종석 판(ADR-038)부터 setup 은 채팅 서버에 붙지 않는다. 봇 등록 · 토큰 · 방 둘은 조종석이 한다.
// 그래서 이 파일은 서버를 띄우지 않고, 임시 cockpit.json 한 장만 만들어 COCKPIT_CONFIG 로 준다.

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');

// setup.js 는 **자기 저장소의 bots/ 아래**에 봇 폴더를 만든다 (setup.js 의 PRODEV = scripts/.. ).
// 그래서 실제 저장소에서 돌리면 사람이 쓰는 봇 폴더를 덮어쓴다.
// 2026-09-10 에 실제로 그렇게 날렸다. 그 뒤로 시험은 **저장소 사본**에서만 setup 을 돌린다.
//
// 사본에는 setup.js 가 읽는 scripts/ 와 common/ 만 옮긴다. bots/ 는 옮길 목록에 아예 없다.
// **작업 트리**에서 옮긴다 — 지금 고치는 중인 setup.js 를 재야 한다.
// git 에 기대지 않는다: 이 시험 자체가 저장소 사본(.git 이 없는 자리)에서 돌 수 있어야 한다.
function 저장소사본() {
  const 사본 = fs.mkdtempSync(path.join(os.tmpdir(), 'prodev-repo-'));
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

// 조종석 설정 한 장. 자리 넷은 cockpit.example.json 과 같은 열쇠다 (조종석이 절대 경로를 요구하므로 절대 경로로).
function 조종석자리(뿌리, 덮어쓸것 = {}) {
  const c = {
    botsDir: path.join(뿌리, 'bots'), projectsDir: path.join(뿌리, 'projects'),
    uploadsDir: path.join(뿌리, 'cdata', 'uploads'), dataDir: path.join(뿌리, 'cdata'),
    ...덮어쓸것,
  };
  for (const k of ['projectsDir', 'uploadsDir', 'dataDir']) fs.mkdirSync(c[k], { recursive: true });
  const 파일 = path.join(뿌리, 'cockpit.json');
  fs.writeFileSync(파일, JSON.stringify(c, null, 2));
  return { ...c, 파일 };
}

const 과제 = '시험과제';
const 봇 = `prodev-${과제}-bot`;

const 상태 = { 뿌리: null, 조종석: null, project: null, botDir: null, repo: null, 출력: '' };
// 시험을 시작할 때의 실제 bots/ 목록. 맨 끝 시험이 이것과 견준다.
const 처음bots = (() => { try { return fs.readdirSync(path.join(ROOT, 'bots')).sort(); } catch { return []; } })();

function 돌린다(args, env) {
  const 사본 = (env && env.__repo) || 상태.repo;
  const { __repo, ...나머지 } = env || {};
  return execFileSync(process.execPath, [path.join(사본, 'scripts', 'setup.js'), ...args], {
    encoding: 'utf8', cwd: 사본, timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, COCKPIT_CONFIG: 상태.조종석.파일, ...나머지 },
  });
}
// 죽어야 하는 부름. { code, stderr } 를 돌려준다.
function 죽는다(args, env) {
  try { 돌린다(args, env); } catch (e) { return { code: e.status, stderr: String(e.stderr), stdout: String(e.stdout) }; }
  return { code: 0, stderr: '', stdout: '' };
}
const 읽는다 = (봇폴더, 파일) => JSON.parse(fs.readFileSync(path.join(봇폴더, '.claude', 파일), 'utf8'));
// Claude Code 권한 패턴 — setup.js 의 pat 과 같은 꼴
const 패턴 = p => {
  const s = p.replace(/\\/g, '/');
  return process.platform === 'win32' ? s : '//' + s.replace(/^\//, '');
};

before(() => {
  상태.뿌리 = fs.mkdtempSync(path.join(os.tmpdir(), 'prodev-cockpit-'));
  상태.조종석 = 조종석자리(상태.뿌리);
  // 과제 폴더 이름이 곧 과제 이름이다 (setup.js 가 basename 으로 읽는다)
  상태.project = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'prodev-proj-')), 과제);
  fs.mkdirSync(상태.project, { recursive: true });
  상태.repo = 저장소사본();
  상태.botDir = path.join(상태.repo, 'bots', 봇);   // 실제 저장소가 아니라 사본이다

  상태.출력 = 돌린다([], { PRODEV_PROJECT: 상태.project });
});

after(() => {
  // 전부 임시 폴더다. 실제 저장소의 bots/ 는 이 파일 어디에서도 지우지 않는다.
  for (const d of [상태.뿌리, 상태.repo, path.dirname(상태.project)]) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch {}
  }
});

test('setup — bots/<이름>/.claude/settings.json 에 훅 셋과 env 가 있고 권한은 없다 (ADR-038)', () => {
  const s = 읽는다(상태.botDir, 'settings.json');

  assert.deepStrictEqual(Object.keys(s.hooks).sort(), ['PreCompact', 'PreToolUse', 'SessionStart']);
  assert.strictEqual(s.hooks.SessionStart[0].matcher, 'startup|resume|clear|compact');
  assert.strictEqual(s.hooks.PreToolUse[0].matcher, 'mcp__cockpit__reply');
  for (const [사건, 파일] of [['SessionStart', 'session-start.js'], ['PreCompact', 'pre-compact.js'], ['PreToolUse', 'pre-reply.js']]) {
    const cmd = s.hooks[사건][0].hooks[0].command;
    // 구분자를 맞춰 놓고 본다. 윈도우에서는 이 명령이 섞여 나온다 (`C:\…\hooks/session-start.js`).
    const 슬래시 = p => p.replace(/\\/g, '/');
    assert.ok(슬래시(cmd).includes(`common/hooks/${파일}`), `${사건} 이 ${파일} 을 안 가리킨다: ${cmd}`);
    assert.ok(path.isAbsolute(cmd.replace(/^node /, '')), `훅 경로가 절대 경로가 아니다: ${cmd}`);
  }
  assert.strictEqual(s.hooks.PreCompact[0].hooks[0].timeout, 180);

  // env — 훅이 자리를 찾는 데 쓰는 것 (PRODEV_HOOK 은 여기 없다. 그것은 pre-compact 가 자식에게만 붙인다)
  assert.strictEqual(s.env.PRODEV_BOT, 봇);
  assert.strictEqual(s.env.PRODEV_PROJECT, 상태.project);
  assert.strictEqual(s.env.MINIDISCORD_DB, path.join(상태.조종석.dataDir, 'chat.db'), 'MINIDISCORD_DB 가 조종석 chat.db 가 아니다');
  assert.strictEqual(s.env.MINIDISCORD_URL, '', 'MINIDISCORD_URL 이 빈 값이 아니다 — 훅이 어딘가로 알림을 보낸다');
  assert.ok(!('PRODEV_HOOK' in s.env), 'PRODEV_HOOK 이 봇 env 에 들어갔다');
  assert.ok(!s.env.PATH.includes('$') && !s.env.PATH.includes('%'), 'PATH 에 안 펼쳐진 변수 참조가 있다');
  assert.ok(s.env.CLAUDE_CODE_GIT_BASH_PATH && s.env.CLAUDE_CODE_GIT_BASH_PATH.length > 0,
    'env 에 CLAUDE_CODE_GIT_BASH_PATH 가 없거나 비었다');

  // headless 세션은 이 파일의 allow 를 안 읽는다 — 여기 두면 "있는데 안 먹는" 목록이 된다
  assert.ok(!('permissions' in s), 'settings.json 에 permissions 가 남았다');
  assert.ok(!JSON.stringify(s).includes('cockpit.db'), 'cockpit.db 경로가 봇 env 에 새었다');
});

test('setup — bots/<이름>/.claude/settings.local.json 에 허용 22 · deny 10 · 바깥 폴더 셋 (ADR-033 · ADR-038)', () => {
  const l = 읽는다(상태.botDir, 'settings.local.json');
  assert.deepStrictEqual(Object.keys(l), ['permissions']);
  const { allow, deny, additionalDirectories } = l.permissions;

  // 허용 목록 — 22건. 실제로 쓰인 파일에서 확인한다 (틀만 보면 setup.js 의 치환이 빠져도 안 걸린다)
  assert.strictEqual(allow.length, 22, `허용이 ${allow.length}건이다`);
  for (const 항목 of ['mcp__cockpit__reply', 'mcp__cockpit__fetch_history', 'Bash(python3:*)', 'Bash(node:*)', 'Bash(git:*)', 'Bash(cd:*)', 'Bash(gh:*)', 'Read', 'Grep', 'Glob']) {
    assert.ok(allow.includes(항목), `허용에 ${항목} 이 없다`);
  }
  for (const 항목 of ['Bash(grep:*)', 'Bash(chmod:*)', 'Bash(shasum:*)', 'Bash(sed:*)', 'Bash(cat:*)']) {
    assert.ok(!allow.includes(항목), `뺀 것이 되살아났다: ${항목}`);
  }
  assert.ok(!/minidiscord-channel|\{\{/.test(JSON.stringify(l)), '옛 도구 이름이나 안 바뀐 자리표시자가 남았다');

  // deny — 틀 5 + 조종석 업로드 2 + cockpit.db 3
  assert.strictEqual(deny.length, 10, `deny 가 ${deny.length}건이다: ${deny.join(' · ')}`);
  const cockpitDb = path.join(상태.조종석.dataDir, 'cockpit.db');
  for (const 동사 of ['Read', 'Edit', 'Write']) {
    assert.ok(deny.includes(`${동사}(${패턴(cockpitDb)})`), `deny 에 ${동사}(cockpit.db) 가 없다`);
  }
  assert.ok(deny.includes(`Write(${패턴(상태.조종석.uploadsDir)}/**)`), '조종석 업로드 폴더에 쓸 수 있다');

  // 바깥 폴더 — 과제 · 조종석 업로드 · prodev
  assert.strictEqual(additionalDirectories.length, 3);
  assert.strictEqual(path.resolve(additionalDirectories[0]), path.resolve(상태.project));
  assert.strictEqual(path.resolve(additionalDirectories[1]), path.resolve(상태.조종석.uploadsDir));
});

test('setup settings — deny 가 과제 폴더를 덮지 않는다 (ADR-019)', () => {
  // R1 재생에서 실제로 겪은 것: 과제 저장소들의 부모를 통째로 deny 하는 바람에 봇이 charter.md 를 못 썼다.
  const { permissions: p } = 읽는다(상태.botDir, 'settings.local.json');
  const 덮는다 = (윗자리, 아랫자리) => {
    const a = path.resolve(윗자리), b = path.resolve(아랫자리);
    return a === b || b.startsWith(a + path.sep);
  };
  const 덮는것 = p.deny.filter(d => {
    const m = /^(?:Write|Edit)\((.*?)\/\*\*\)$/.exec(d);
    return m && 덮는다(m[1].replace(/^\/\//, '/'), 상태.project);
  });
  assert.deepStrictEqual(덮는것, [], `deny 가 과제 폴더를 덮는다: ${덮는것.join(' · ')}`);
  assert.ok(p.additionalDirectories.some(d => path.resolve(d) === path.resolve(상태.project)), '과제 폴더가 열려 있지 않다');
});

test('setup settings — 조종석 업로드 폴더가 과제 폴더를 덮으면 그 deny 를 빼고 설치는 된다 (ADR-019 되돌이 시험)', () => {
  // 위 시험은 과제 폴더를 업로드 폴더 **밖**에 두므로 덮는 배치를 못 본다. 여기서 일부러 덮는다:
  //   uploadsDir=<뿌리>  ·  --project <뿌리>/projects/<과제>
  const 뿌리 = fs.mkdtempSync(path.join(os.tmpdir(), 'prodev-root-'));
  const 조종석 = 조종석자리(뿌리, { uploadsDir: 뿌리 });
  const 과제이름 = '되돌이시험';
  const 과제폴더 = path.join(뿌리, 'projects', 과제이름);
  fs.mkdirSync(과제폴더, { recursive: true });
  const 사본 = 저장소사본();
  const 봇폴더 = path.join(사본, 'bots', `prodev-${과제이름}-bot`);   // 사본 아래다

  try {
    const out = 돌린다([], { __repo: 사본, PRODEV_PROJECT: 과제폴더, COCKPIT_CONFIG: 조종석.파일 });
    const { deny } = 읽는다(봇폴더, 'settings.local.json').permissions;
    const 덮는것 = deny.filter(d => {
      const m = /^(?:Write|Edit)\((.*?)\/\*\*\)$/.exec(d);
      if (!m) return false;
      const 자리 = path.resolve(m[1].replace(/^\/\//, '/'));
      return 과제폴더 === 자리 || 과제폴더.startsWith(자리 + path.sep);
    });
    assert.deepStrictEqual(덮는것, [], `deny 가 과제 폴더를 덮는다 — 봇이 charter.md 를 못 쓴다: ${덮는것.join(' · ')}`);
    assert.match(out, /덮는다/, '업로드 deny 를 뺐다고 말하지 않았다');
    // cockpit.db 셋은 그대로 남는다
    assert.strictEqual(deny.filter(d => d.includes('cockpit.db')).length, 3);
  } finally {
    fs.rmSync(사본, { recursive: true, force: true });
    fs.rmSync(뿌리, { recursive: true, force: true });
  }
});

test('setup — .env · .mcp.json · rooms.json 을 만들지 않는다 (토큰도 방도 조종석 몫, ADR-038)', () => {
  for (const 파일 of ['.env', '.mcp.json', 'rooms.json']) {
    assert.ok(!fs.existsSync(path.join(상태.botDir, 파일)), `${파일} 이 생겼다`);
  }
  // ('압축 문턱 650,000 토큰' 줄이 있으므로 '토큰' 한 낱말로는 가르지 않는다)
  assert.doesNotMatch(상태.출력, /봇 등록|세션 쿠키|서버 없음|MINIDISCORD_TOKEN/, '채팅 서버나 토큰을 찾는다');
  assert.match(상태.출력, /open-project 시험과제/, '다음 걸음(조종석 open-project)을 말하지 않는다');
});

test('setup rooms · archive — 조종석으로 안내하고 1 로 끝난다. cron 은 없는 명령이다', () => {
  const 전 = fs.readdirSync(상태.botDir).sort();
  for (const 명령 of [['rooms', 과제], ['archive', `prodev-${과제}/files`]]) {
    const r = 죽는다(명령);
    assert.strictEqual(r.code, 1, `${명령[0]} 이 0 으로 끝났다 — 방이 생긴 줄 안다`);
    assert.match(r.stderr, /조종석/, `${명령[0]} 이 무엇이 대신하는지 말하지 않는다: ${r.stderr}`);
  }
  const cron = 죽는다(['cron', 과제]);
  assert.strictEqual(cron.code, 1);
  assert.match(cron.stderr, /모르는 명령: cron/);
  assert.deepStrictEqual(fs.readdirSync(상태.botDir).sort(), 전, '안내만 해야 하는데 봇 폴더를 바꿨다');
});

// ── ADR-023: setup 이 과제 폴더를 스스로 만든다 ────────────
//
// 사람이 "과제 하나 = projects 아래 폴더 하나, 만드는 것은 setup" 으로 정했다.
// 그래서 --project 에 **이름만** 줘도 된다. 그 뿌리는 조종석 projectsDir 이다 (ADR-038).

// 과제 폴더 안을 통째로 찍는다 (.git 안은 빼고 — 우리가 재는 것은 "사람의 것을 건드렸나" 다).
function 나무(뿌리) {
  const 목록 = [];
  (function 돈다(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (e.name === '.git') continue;
      const 길 = path.join(d, e.name);
      if (e.isDirectory()) { 목록.push(path.relative(뿌리, 길) + '/'); 돈다(길); }
      else {
        const h = require('crypto').createHash('sha256').update(fs.readFileSync(길)).digest('hex').slice(0, 12);
        목록.push(path.relative(뿌리, 길) + ' ' + h);
      }
    }
  })(뿌리);
  return 목록;
}

test('setup --project 이름만 — 조종석 projectsDir 아래에 과제 폴더 · git · 봇 폴더 셋이 생긴다 (ADR-023 · ADR-038)', () => {
  const 사본 = 저장소사본();
  const 이름 = '새과제';
  const 폴더 = path.join(상태.조종석.projectsDir, 이름);
  assert.ok(!fs.existsSync(폴더), '시작할 때는 없어야 한다');

  const out = 돌린다(['--project', 이름], { __repo: 사본, PRODEV_PROJECT: '' });

  assert.ok(fs.existsSync(폴더), `① 과제 폴더가 안 생겼다: ${폴더}\n${out}`);
  assert.ok(fs.existsSync(path.join(폴더, '.git')), '② git 이 안 생겼다');
  assert.ok(fs.existsSync(path.join(사본, 'bots', `prodev-${이름}-bot`)), '③ 봇 폴더가 안 생겼다');
  for (const d of ['cards', 'wiki', 'inbox', 'journal', 'threads', 'tmp']) {
    assert.ok(fs.existsSync(path.join(폴더, d)), `하위 폴더가 없다: ${d}`);
  }
  fs.rmSync(사본, { recursive: true, force: true });
});

test('setup --project — 있는 폴더에 다시 돌려도 안의 것을 건드리지 않는다 (ADR-023)', () => {
  const 사본 = 저장소사본();
  const 이름 = '다시과제';
  const 폴더 = path.join(상태.조종석.projectsDir, 이름);
  const env = { __repo: 사본, PRODEV_PROJECT: '' };

  돌린다(['--project', 이름], env);
  // 사람이 일한 것처럼 파일 둘을 둔다. 두 번째 실행이 이것을 건드리면 안 된다.
  fs.writeFileSync(path.join(폴더, 'charter.md'), '---\nPL: 김피엘\n---\n# 목적\n수율을 올린다\n');
  fs.writeFileSync(path.join(폴더, 'cards', 'E-0001.md'), '---\nid: E-0001\n---\n# 카드 하나\n');
  const 전 = 나무(폴더);

  const out = 돌린다(['--project', 이름], env);

  assert.deepStrictEqual(나무(폴더), 전, '두 번째 실행이 과제 폴더 안을 바꿨다');
  assert.match(out, /있음/, '두 번째 실행이 "있음" 이라 말하지 않았다');
  fs.rmSync(사본, { recursive: true, force: true });
});

test('setup — 조종석 설정을 못 찾으면 까닭을 대고 죽는다 (조용히 엉뚱한 자리에 만들지 않는다)', () => {
  const 사본 = 저장소사본();
  const 없는설정 = path.join(사본, '없다', 'cockpit.json');
  const r = 죽는다(['--project', '설정없음'], { __repo: 사본, PRODEV_PROJECT: '', COCKPIT_CONFIG: 없는설정 });

  assert.strictEqual(r.code, 1, '죽어야 한다');
  assert.match(r.stderr, /조종석 설정이 없다/, `까닭이 안 보인다: ${r.stderr}`);
  assert.match(r.stderr, /--cockpit|COCKPIT_CONFIG/, '어떻게 고치는지 말하지 않는다');
  assert.ok(!fs.existsSync(path.join(사본, 'bots')), '죽기 전에 봇 폴더를 만들었다');
  fs.rmSync(사본, { recursive: true, force: true });
});

// 이 파일의 마지막 시험이다. 앞의 시험들이 실제 저장소를 만졌는지 여기서 본다.
test('시험은 실제 bots/ 를 만지지 않는다 (시험 전후 목록이 같다)', () => {
  // 2026-09-10 에 setup.js 를 실제 저장소에서 돌려 사람이 쓰던 봇 폴더를 덮어쓰고,
  // 뒤처리한다며 지워 토큰까지 날렸다. 그 사고를 다시는 못 내게 하는 못이다.
  const 지금bots = (() => { try { return fs.readdirSync(path.join(ROOT, 'bots')).sort(); } catch { return []; } })();
  assert.deepStrictEqual(지금bots, 처음bots,
    `시험이 실제 bots/ 를 바꿨다 — 전: [${처음bots}] 후: [${지금bots}]`);
});
