// 훅 셋 시험 — 전부 stdin JSON 을 주고 나온 것을 잰다 (진짜 훅이 도는 길과 같다).
//
// session-start  없음 · 있음 · 잘림 셋을 말로 가르는가
// pre-compact    여섯 칸을 채우는가 · claude 에 보낸 입력에 thinking 이 없고 tool_result 가 잘렸는가
// pre-reply      fixtures/hooks/pre-reply-cases.json 의 13건 (막을 것 10 · 통과 3)
//
// pre-reply 의 기대는 fixture 에만 있고 여기 베껴 적지 않는다. 자료가 바뀌면 시험이 따라 바뀐다.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const HOOKS = path.join(ROOT, 'common', 'hooks');
const F = path.join(__dirname, 'fixtures', 'hooks');
const DB = path.join(F, 'fixture.db');
const PROJECT = path.join(F, 'project');
const TRANSCRIPT = path.join(F, 'transcript-40.jsonl');

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `prodev-${prefix}-`));
}

// 훅 하나를 돌린다. 막는 훅도 있으므로 exit code 와 stderr 를 같이 돌려준다.
function hook(name, payload, env) {
  try {
    const stdout = execFileSync(process.execPath, [path.join(HOOKS, name)], {
      input: JSON.stringify(payload), encoding: 'utf8',
      env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return { code: e.status, stdout: e.stdout || '', stderr: (e.stderr || '').toString() };
  }
}

// ── session-start 셋 ──────────────────────────────────────

function 문맥(env, payload = { source: 'startup' }) {
  const r = hook('session-start.js', payload, env);
  assert.strictEqual(r.code, 0, 'session-start 는 세션을 막지 않는다');
  return JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
}

test('session-start — 없음: 파일이 하나도 없으면 칸마다 "없음"과 까닭을 말한다', () => {
  const proj = tmp('ss-none');
  const c = 문맥({ PRODEV_BOT: '시험비서', PRODEV_PROJECT: proj, PRODEV_HANDOFF: path.join(proj, '없다.md') });

  assert.match(c, /^\[깨어남: startup\] 나는 시험비서다\./);
  for (const 칸 of ['인수인계서', '헌장 (charter.md)', '일정 (schedule.md)', '열린 실', '어제 일지', '색인 머리', '마지막 일지']) {
    assert.ok(c.includes(칸), `칸이 빠졌다: ${칸}`);
  }
  // 없는 것은 "없음" 이라고 말하고 왜 없는지도 말한다
  assert.match(c, /\(없음 — 아직 발의하지 않았다\. charter 스킬부터\)/);
  assert.match(c, /\(없음 — 지금 붙들고 있는 실이 없다\)/);
  assert.match(c, /\(없음 — 일지를 한 번도 안 썼다\)/);
  assert.ok(!c.includes('잘림'));
});

test('session-start — 있음: 헌장 · 열린 실 전부 · 마지막 일지 날짜를 싣는다', () => {
  const proj = tmp('ss-some');
  fs.mkdirSync(path.join(proj, 'threads'), { recursive: true });
  fs.mkdirSync(path.join(proj, 'journal'), { recursive: true });
  fs.copyFileSync(path.join(PROJECT, 'charter.md'), path.join(proj, 'charter.md'));
  fs.writeFileSync(path.join(proj, 'schedule.md'), '| 항목 | 기한 |\n|---|---|\n| 보고 | 2026-09-20 |\n');
  // 열린 실 셋 — 하나라도 빠지면 그 실은 잊힌다
  for (const [n, body] of [['a-E-0001', 'room: 2\ncard: E-0001\nlast_id: 401\n'],
                           ['b-E-0002', 'room: 2\ncard: E-0002\nlast_id: 402\n'],
                           ['c-E-0003', 'room: 3\ncard: E-0003\nlast_id: 403\n']]) {
    fs.writeFileSync(path.join(proj, 'threads', `${n}.md`), body);
  }
  fs.writeFileSync(path.join(proj, 'journal', '2026-09-01.md'), '# 일지\n- 첫날\n');
  fs.writeFileSync(path.join(proj, 'journal', '2026-09-08.md'), '# 일지\n- 여덟째\n');
  fs.writeFileSync(path.join(proj, 'index.md'), '# 색인\n\n## 카드 2\n');

  const c = 문맥({ PRODEV_BOT: '시험비서', PRODEV_PROJECT: proj, PRODEV_HANDOFF: path.join(proj, '없다.md') });

  assert.ok(c.includes('PL: 김피엘'), '헌장의 PL 이 안 실렸다');
  assert.ok(c.includes('## 열린 실 (threads/) 3개'));
  for (const n of ['a-E-0001', 'b-E-0002', 'c-E-0003']) {
    assert.ok(c.includes(`threads/${n}.md`), `실이 빠졌다: ${n}`);
  }
  assert.ok(c.includes('last_id: 403'), '실의 알맹이가 안 실렸다');
  assert.match(c, /## 마지막 일지\n2026-09-08 \(\d+일 전\) · 일지 2개/);
  assert.ok(c.includes('## 카드 2'), '색인 머리가 안 실렸다');
});

test('session-start — 잘림: 긴 파일은 앞부분만 싣고 "잘림"과 남은 줄 수를 말한다', () => {
  const proj = tmp('ss-cut');
  fs.mkdirSync(path.join(proj, 'journal'), { recursive: true });
  // 상한(40줄)을 넘기는 헌장
  fs.writeFileSync(path.join(proj, 'charter.md'), Array.from({ length: 120 }, (_, i) => `줄 ${i + 1}`).join('\n'));
  const c = 문맥({ PRODEV_BOT: '시험비서', PRODEV_PROJECT: proj, PRODEV_HANDOFF: path.join(proj, '없다.md') });

  assert.match(c, /## 헌장 \(charter\.md\) \(앞부분만 · 잘림\)/);
  assert.match(c, /… \(80줄 더 있음 — 파일을 직접 읽어라\)/);
  assert.ok(c.includes('줄 40'), '앞 40줄이 안 실렸다');
  assert.ok(!c.includes('줄 41'), '상한을 넘겨 실었다');
  // 없음과 잘림은 다른 말이다
  assert.ok(c.includes('(없음 — 아직 일정이 없다)'));
});

// ── pre-compact 셋 ────────────────────────────────────────

const 칸 = ['하던 일', '방과 마지막 message_id', '사람이 기다리는 것', '미해결 질문', '다음 한 걸음', '열어 둔 파일'];

function 압축한다() {
  const dir = tmp('pc');
  const out = path.join(dir, 'handoff-compact.md');
  const r = hook('pre-compact.js', { hook_event_name: 'PreCompact', trigger: 'auto', transcript_path: TRANSCRIPT },
    { PRODEV_FAKE_CLAUDE: '1', PRODEV_HANDOFF: out });
  return { r, out, input: `${out}.input.txt` };
}

test('pre-compact — 여섯 칸을 채운 인수인계서를 쓴다 (exit 0)', () => {
  const { r, out } = 압축한다();
  assert.strictEqual(r.code, 0);
  const md = fs.readFileSync(out, 'utf8');
  for (const k of 칸) assert.ok(md.includes(`## ${k}`), `칸이 빠졌다: ${k}`);
  assert.ok(!md.includes('못 썼다'), md.slice(0, 200));

  // 칸이 제목만 있고 비어 있으면 채운 것이 아니다
  for (const k of 칸) {
    const 뒤 = md.split(`## ${k}\n`)[1].split('\n## ')[0].trim();
    assert.ok(뒤.length > 0 && 뒤 !== '(모름)', `${k} 칸이 비었다`);
  }
  // 기록에 실제로 있던 것이 옮겨졌는가
  assert.ok(md.includes('E-0007'), '하던 일에 카드 번호가 없다');
  assert.ok(md.includes('#430') && md.includes('#418'), '방마다 마지막 글 번호가 없다');
  assert.ok(md.includes('threads/prodev-시험-들이기-E-0007.md'), '열어 둔 파일이 없다');
});

test('pre-compact — claude 에 보내는 입력에 thinking 이 0건이다', () => {
  const { input } = 압축한다();
  const 보낸것 = fs.readFileSync(input, 'utf8');

  assert.ok(보낸것.length > 0);
  assert.strictEqual((보낸것.match(/thinking/g) || []).length, 0);
  // 기록 fixture 의 thinking 문장이 그대로 새어 나가지 않았는가
  assert.strictEqual((보낸것.match(/생각은 인수인계서에/g) || []).length, 0);
  // 그런데 기록에는 정말 thinking 이 있었다 — 시험이 헛돈 것이 아님을 못 박는다
  const 원본 = fs.readFileSync(TRANSCRIPT, 'utf8');
  assert.ok((원본.match(/"thinking"/g) || []).length >= 18, '기록 fixture 에 thinking 이 없다');
});

test('pre-compact — 보내는 입력의 tool_result 는 300자로 잘린다', () => {
  const { input } = 압축한다();
  const 줄들 = fs.readFileSync(input, 'utf8').split('\n').filter(l => l.startsWith('[결과] '));

  assert.ok(줄들.length > 0, '[결과] 줄이 하나도 없다');
  for (const l of 줄들) {
    const 알맹이 = l.replace(/^\[결과\] /, '').replace(/ …\(잘림\)$/, '');
    assert.ok([...알맹이].length <= 300, `300자를 넘었다: ${[...알맹이].length}자`);
  }
  // 원본에는 300자를 넘는 tool_result 가 있었다
  const 원본 = fs.readFileSync(TRANSCRIPT, 'utf8');
  assert.ok(원본.includes('ok ok ok'), '기록 fixture 에 긴 tool_result 가 없다');
  assert.ok(줄들.some(l => l.endsWith('…(잘림)')), '잘린 줄이 하나도 없다');
});

test('pre-compact — 기록을 못 읽어도 exit 0 이고, 못 썼다고 파일에 적는다', () => {
  const dir = tmp('pc-bad');
  const out = path.join(dir, 'handoff-compact.md');
  const r = hook('pre-compact.js', { hook_event_name: 'PreCompact', trigger: 'manual', transcript_path: path.join(dir, '없다.jsonl') },
    { PRODEV_FAKE_CLAUDE: '1', PRODEV_HANDOFF: out });

  assert.strictEqual(r.code, 0, '압축을 막으면 안 된다');
  const md = fs.readFileSync(out, 'utf8');
  assert.match(md, /\*\*못 썼다: .*기록 파일이 없다/);
  // 못 썼어도 칸은 남긴다 — 다음 세션이 무엇을 잃었는지 알아야 한다
  for (const k of 칸) assert.ok(md.includes(`## ${k}`), `칸이 빠졌다: ${k}`);
});

// ── pre-reply 13건 ────────────────────────────────────────

const CASES = JSON.parse(fs.readFileSync(path.join(F, 'pre-reply-cases.json'), 'utf8'));

for (const c of CASES.cases) {
  const 말 = c.want === 0 ? '통과(0)' : '막음(2)';
  test(`pre-reply — ${c.name} → ${말}`, () => {
    const r = hook('pre-reply.js',
      { hook_event_name: 'PreToolUse', tool_name: 'mcp__minidiscord-channel__reply', tool_input: c.input },
      { MINIDISCORD_DB: DB, PRODEV_PROJECT: PROJECT });

    assert.strictEqual(r.code, c.want, `stderr: ${r.stderr.trim()}`);
    if (c.want === 2) {
      // 막을 때는 이유 한 줄. 봇이 그것을 읽고 고친다.
      const 줄 = r.stderr.trim().split('\n');
      assert.strictEqual(줄.length, 1, `이유는 한 줄이어야 한다 — ${줄.length}줄`);
      assert.ok(줄[0].length > 0);
    } else {
      assert.strictEqual(r.stderr.trim(), '', '통과할 때는 아무 말도 하지 않는다');
    }
  });
}

test('pre-reply — DB 를 못 열면 자료 방만 막고 나머지 방은 통과한다 (ADR-008)', () => {
  const 없는DB = path.join(tmp('nodb'), '없다.db');
  // DB 가 죽어도 방 이름은 봇 폴더의 rooms.json 으로 안다 (setup.js 가 쓰는 파일).
  const 봇폴더 = tmp('nobot');
  fs.writeFileSync(path.join(봇폴더, 'rooms.json'), JSON.stringify({
    rooms: [{ id: 1, name: 'prodev-시험' }, { id: 3, name: 'prodev-시험/자료' }],
  }));
  const env = { MINIDISCORD_DB: 없는DB, PRODEV_PROJECT: PROJECT, PRODEV_BOT_DIR: 봇폴더 };

  // 자료 방(3) — 확정을 확인할 길이 없으므로 막는다
  const 자료 = hook('pre-reply.js', { tool_input: { chat_id: '3', text: 'E-0001 · 훅 시험' } }, env);
  assert.strictEqual(자료.code, 2);
  assert.match(자료.stderr, /확정을 확인할 수 없다|DB/);

  // 본방(1) — 통과. 여기까지 막으면 봇이 아무 말도 못 한다
  const 본방 = hook('pre-reply.js', { tool_input: { chat_id: '1', text: '안녕하세요' } }, env);
  assert.strictEqual(본방.code, 0, `stderr: ${본방.stderr}`);
});

test('pre-reply — 방을 아예 모르면(DB 도 rooms.json 도 없다) 막지 않는다', () => {
  // 자료 방일 수도 있으나 가려낼 길이 없다. 여기서 전부 막으면 봇이 한 마디도 못 한다.
  // 자료 방만 fail-closed 라는 규칙은 "자료 방인 줄 알 때" 의 규칙이다.
  const r = hook('pre-reply.js', { tool_input: { chat_id: '3', text: 'E-0001 · 훅 시험' } },
    { MINIDISCORD_DB: path.join(tmp('nodb2'), '없다.db'), PRODEV_PROJECT: PROJECT, PRODEV_BOT_DIR: tmp('nobot2') });
  assert.strictEqual(r.code, 0, `stderr: ${r.stderr}`);
});
