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
const { execFileSync, execFile } = require('child_process');
const http = require('http');

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
  for (const 칸 of ['인수인계서', '헌장 (charter.md)', '일정 (schedule.md)', '열린 실', '어제 일지', '색인 머리', '마지막 일지',
    '이 과제의 규칙 (house.md)']) {
    assert.ok(c.includes(칸), `칸이 빠졌다: ${칸}`);
  }
  // 없는 것은 "없음" 이라고 말하고 왜 없는지도 말한다
  assert.match(c, /\(없음 — 아직 발의하지 않았다\. charter 스킬부터\)/);
  assert.match(c, /\(없음 — 지금 붙들고 있는 실이 없다\)/);
  assert.match(c, /\(없음 — 일지를 한 번도 안 썼다\)/);
  assert.match(c, /\(없음 — 아직 굳은 규칙이 없다\./);
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

test('session-start — handoff-compact 만 있음: 인수인계서가 먼저 오고 나머지는 "없음" 이다', () => {
  const proj = tmp('ss-handoff');
  const 인수 = path.join(proj, 'handoff-compact.md');
  fs.writeFileSync(인수, ['# 인수인계서', '', '## 하던 일', 'E-0007 문답 · 남은 질문 1', '',
    '## 방과 마지막 message_id', '- chat_id 2 · #418', ''].join('\n'));

  const c = 문맥({ PRODEV_BOT: '시험비서', PRODEV_PROJECT: proj, PRODEV_HANDOFF: 인수 });

  // 알맹이가 실렸다
  assert.ok(c.includes('E-0007 문답 · 남은 질문 1'));
  assert.ok(c.includes('- chat_id 2 · #418'));
  // 나머지는 없다고 말한다
  assert.ok(c.includes('(없음 — 아직 발의하지 않았다. charter 스킬부터)'));
  assert.ok(c.includes('(없음 — 지금 붙들고 있는 실이 없다)'));

  // 절 순서가 6.4 대로다: 인수인계서 → 헌장 → 일정 → 열린 실 → 어제 일지 → 색인 → 마지막 일지
  const 자리 = ['인수인계서 (handoff-compact.md)', '헌장 (charter.md)', '일정 (schedule.md)',
    '열린 실 (threads/)', '어제 일지', '색인 머리 (index.md)', '마지막 일지',
    '이 과제의 규칙 (house.md)'].map(k => c.indexOf(`## ${k}`));
  for (const i of 자리) assert.ok(i >= 0, `절이 빠졌다: ${자리.indexOf(i)}`);
  assert.deepStrictEqual(자리, [...자리].sort((a, b) => a - b), '절 순서가 6.4 와 다르다');
});

// ── house.md — 여덟째 절 (ADR-032) ────────────────────────
// 앞 일곱과 다른 점 둘을 본다: 순서가 맨 끝이라는 것과, 잘렸을 때 **봇에게 말을 시킨다**는 것.

test('session-start — house.md 를 여덟째(마지막)로 싣는다', () => {
  const proj = tmp('ss-house');
  fs.writeFileSync(path.join(proj, 'house.md'), '# 이 과제에서 일하는 방식\n\n## 문체\n- 보고는 표로 시작한다 (2026-09-11 · 김피엘)\n');
  fs.writeFileSync(path.join(proj, 'charter.md'), '# 헌장\nPL: 김피엘\n');

  const c = 문맥({ PRODEV_BOT: '시험비서', PRODEV_PROJECT: proj, PRODEV_HANDOFF: path.join(proj, '없다.md') });

  assert.ok(c.includes('- 보고는 표로 시작한다 (2026-09-11 · 김피엘)'), '규칙 알맹이가 안 실렸다');
  assert.ok(c.indexOf('## 이 과제의 규칙 (house.md)') > c.indexOf('## 마지막 일지'), '여덟째가 아니다');
  assert.ok(!c.includes('잘림'), '50줄 이내인데 잘렸다고 했다');
  assert.ok(!c.includes('스스로 줄이지 마라'), '잘리지도 않았는데 줄이라는 말을 꺼냈다');
});

test('session-start — house.md 가 50줄을 넘으면 자르고, 봇에게 사람에게 말하라고 시킨다 (스스로 줄이지 않는다)', () => {
  const proj = tmp('ss-house-cut');
  fs.writeFileSync(path.join(proj, 'house.md'), Array.from({ length: 63 }, (_, i) => `- 규칙 ${i + 1}`).join('\n'));

  const c = 문맥({ PRODEV_BOT: '시험비서', PRODEV_PROJECT: proj, PRODEV_HANDOFF: path.join(proj, '없다.md') });

  assert.match(c, /## 이 과제의 규칙 \(house\.md\) \(앞부분만 · 잘림\)/);
  assert.match(c, /… \(13줄 더 있음 — 파일을 직접 읽어라\)/);
  assert.ok(c.includes('- 규칙 50'), '앞 50줄이 안 실렸다');
  assert.ok(!c.includes('- 규칙 51'), '상한을 넘겨 실었다');
  // 조용히 죽지 않는다 — 봇이 첫 답에 말한다. 그리고 줄이는 것은 사람이다
  assert.ok(c.includes('첫 답에 이것부터 사람에게 말하라'), '잘림을 사람에게 알리라는 지시가 없다');
  assert.ok(c.includes('50줄을 넘어'), '상한 값을 말하지 않는다');
  assert.ok(c.includes('스스로 줄이지 마라'), '봇이 스스로 줄여도 되는 것처럼 읽힌다');
});

test('session-start — house.md 가 딱 50줄이면 자르지 않는다 (경계)', () => {
  const proj = tmp('ss-house-50');
  fs.writeFileSync(path.join(proj, 'house.md'), Array.from({ length: 50 }, (_, i) => `- 규칙 ${i + 1}`).join('\n'));

  const c = 문맥({ PRODEV_BOT: '시험비서', PRODEV_PROJECT: proj, PRODEV_HANDOFF: path.join(proj, '없다.md') });

  assert.ok(c.includes('- 규칙 50'));
  assert.ok(!c.includes('앞부분만 · 잘림'));
  assert.ok(!c.includes('첫 답에 이것부터 사람에게 말하라'));
});

test('session-start — 60줄 넘는 일지는 앞부분만 싣고 잘렸다고 말한다', () => {
  const proj = tmp('ss-journal');
  fs.mkdirSync(path.join(proj, 'journal'), { recursive: true });
  const d = new Date(Date.now() - 86400000);
  const 어제날 = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  // 상한은 60줄. 200줄을 준다
  fs.writeFileSync(path.join(proj, 'journal', `${어제날}.md`),
    Array.from({ length: 200 }, (_, i) => `- 일지 줄 ${i + 1}`).join('\n'));

  const c = 문맥({ PRODEV_BOT: '시험비서', PRODEV_PROJECT: proj, PRODEV_HANDOFF: path.join(proj, '없다.md') });

  assert.ok(c.includes(`## 어제 일지 (journal/${어제날}.md) (앞부분만 · 잘림)`), c.slice(0, 400));
  assert.match(c, /… \(140줄 더 있음 — 파일을 직접 읽어라\)/);
  assert.ok(c.includes('- 일지 줄 60'), '앞 60줄이 안 실렸다');
  assert.ok(!c.includes('- 일지 줄 61'), '상한을 넘겨 실었다');
  // 일지가 있으므로 마지막 일지 날짜도 어제다
  assert.ok(c.includes(`## 마지막 일지\n${어제날} (1일 전) · 일지 1개`), c.slice(-200));
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

test('pre-compact — 요약이 실패해도 exit 0 이고, 빈 칸으로 채우지 않는다 (fail-open)', () => {
  const dir = tmp('pc-fail');
  const out = path.join(dir, 'handoff-compact.md');
  const r = hook('pre-compact.js', { hook_event_name: 'PreCompact', trigger: 'auto', transcript_path: TRANSCRIPT },
    { PRODEV_FAKE_CLAUDE: 'fail', PRODEV_HANDOFF: out });

  assert.strictEqual(r.code, 0, '압축을 막으면 안 된다');
  const md = fs.readFileSync(out, 'utf8');
  assert.match(md, /\*\*못 썼다: .*요약이 비었다/);
  // 칸은 남기되 알맹이가 있는 척하지 않는다
  for (const k of 칸) {
    assert.ok(md.includes(`## ${k}`), `칸이 빠졌다: ${k}`);
    const 뒤 = md.split(`## ${k}\n`)[1].split('\n## ')[0].trim();
    assert.ok(뒤.startsWith('(모름'), `${k} 칸이 아는 척한다: ${뒤.slice(0, 40)}`);
  }
  // 무엇을 보내려 했는지는 그대로 남는다 — 되짚을 자리다
  assert.ok(fs.existsSync(`${out}.input.txt`));
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

// ── pre-reply 17건 (표식이 방아쇠다 — ADR-022) ────────────

const CASES = JSON.parse(fs.readFileSync(path.join(F, 'pre-reply-cases.json'), 'utf8'));

for (const c of CASES.cases) {
  const 말 = c.want === 0 ? '통과(0)' : '막음(2)';
  test(`pre-reply — ${c.name} → ${말}`, () => {
    const r = hook('pre-reply.js',
      { hook_event_name: 'PreToolUse', tool_name: 'mcp__cockpit__reply', tool_input: c.input },
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

test('pre-reply — DB 를 못 열면 카드 공지와 발송만 막고 평소 답은 통과한다 (ADR-008 · ADR-022)', () => {
  const 없는DB = path.join(tmp('nodb'), '없다.db');
  // DB 가 죽어도 방 이름은 봇 폴더의 rooms.json 으로 안다 (setup.js 가 쓰는 파일).
  const 봇폴더 = tmp('nobot');
  fs.writeFileSync(path.join(봇폴더, 'rooms.json'), JSON.stringify({
    rooms: [{ id: 1, name: 'prodev-시험' }, { id: 2, name: 'prodev-시험/files' }],
  }));
  const env = { MINIDISCORD_DB: 없는DB, PRODEV_PROJECT: PROJECT, PRODEV_BOT_DIR: 봇폴더 };

  // 카드 공지 — 확정을 확인할 길이 없으므로 막는다 (fail-closed)
  const 공지 = hook('pre-reply.js', { tool_input: { chat_id: '2', text: '[카드] E-0001 · 훅 시험 · cards/E-0001.md' } }, env);
  assert.strictEqual(공지.code, 2);
  assert.match(공지.stderr, /확정을 확인할 수 없다|DB/);

  // 발송 — 결재를 확인할 길이 없으므로 막는다 (방을 가리지 않는다)
  const 발송 = hook('pre-reply.js', { tool_input: { chat_id: '1', text: '[발송] 주간 보고 · 결재 #5' } }, env);
  assert.strictEqual(발송.code, 2);
  assert.match(발송.stderr, /결재를 확인할 수 없다|DB/);

  // 표식이 없는 평소 답 — 통과. 여기까지 막으면 봇이 아무 말도 못 한다
  const 평소 = hook('pre-reply.js', { tool_input: { chat_id: '1', text: '안녕하세요. E-0001 에 있습니다.' } }, env);
  assert.strictEqual(평소.code, 0, `stderr: ${평소.stderr}`);
});

test('pre-reply — 방을 아예 모르면 표식 있는 글만 막고 나머지는 통과한다 (ADR-022)', () => {
  // 방아쇠가 방이 아니라 표식이라, 방을 몰라도 카드 공지는 fail-closed 다.
  // 표식이 없는 글까지 막으면 봇이 한 마디도 못 한다.
  const env = { MINIDISCORD_DB: path.join(tmp('nodb2'), '없다.db'), PRODEV_PROJECT: PROJECT, PRODEV_BOT_DIR: tmp('nobot2') };

  const 공지 = hook('pre-reply.js', { tool_input: { chat_id: '9', text: '[카드] E-0001 · 훅 시험 · cards/E-0001.md' } }, env);
  assert.strictEqual(공지.code, 2, `stderr: ${공지.stderr}`);

  const 평소 = hook('pre-reply.js', { tool_input: { chat_id: '9', text: 'E-0001 에 있습니다' } }, env);
  assert.strictEqual(평소.code, 0, `stderr: ${평소.stderr}`);
});


// ── pre-compact 의 알림 (ADR-018) ─────────────────────────
//
// 진짜 minidiscord 를 띄우지 않는다. 요청을 받아 적기만 하는 임시 서버를 세우고,
// 훅이 **무엇을 어떤 꼴로** 보내는지 본다. 서버는 쿠키 md_session 하나로만 인증하고
// 글 올리기는 multipart 만 받으므로(2026-09-10 시험 서버로 확인), 그 둘을 여기서 못 박는다.

// 진짜 md_session 은 randomBytes(32).toString('hex') 다 (server/src/auth.ts 38행).
// 시험도 같은 꼴을 쓴다 — 한글 토큰을 쓰면 HTTP 헤더가 latin1 로 읽혀 시험만 어긋난다.
const 진짜꼴토큰 = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
const env토큰 = 'ff00ee11dd22cc33bb44aa5599668877ff00ee11dd22cc33bb44aa5599668877';

function 받아적는서버() {
  const 받은것 = [];
  const srv = http.createServer((req, res) => {
    const c = [];
    req.on('data', d => c.push(d));
    req.on('end', () => {
      받은것.push({
        method: req.method, url: req.url,
        cookie: req.headers.cookie || '',
        auth: req.headers.authorization || '',
        ctype: req.headers['content-type'] || '',
        body: Buffer.concat(c).toString('utf8'),
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    });
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({ srv, 받은것, url: `http://127.0.0.1:${srv.address().port}` })));
}

// 훅을 돌리되 알림만 본다. 요약은 가짜 claude 로 건너뛴다 (PRODEV_FAKE_CLAUDE).
//
// **execFileSync 를 쓰면 안 된다.** 임시 서버가 같은 프로세스에서 도는데, 동기 실행이 이벤트 루프를
// 붙잡으면 서버가 연결을 받지 못해 curl 이 상한까지 기다리다 죽는다. 훅은 잘 보냈는데 시험만 0건이 된다.
// 한 번 밟은 자리라 적어 둔다.
function 압축훅(env, 방번호 = 7) {
  const 낼곳 = path.join(tmp('notify'), 'handoff-compact.md');
  return new Promise(r => {
    execFile(process.execPath, [path.join(HOOKS, 'pre-compact.js')], {
      encoding: 'utf8',
      env: { ...process.env, PRODEV_FAKE_CLAUDE: '1', PRODEV_HANDOFF: 낼곳,
        PRODEV_PROJECT: PROJECT, MINIDISCORD_DB: DB, PRODEV_NOTIFY_ROOM: String(방번호), ...env },
    }, e => r({ code: e ? e.code : 0, 낼곳 }))
      .stdin.end(JSON.stringify({ transcript_path: (env && env.__기록없음) ? '/없는/기록.jsonl' : TRANSCRIPT, trigger: 'auto' }));
  });
}

test('pre-compact 알림 — 쿠키 md_session + multipart 로 보낸다. Bearer 도 JSON 도 아니다 (ADR-018)', async () => {
  const S = await 받아적는서버();
  const r = await 압축훅({ MINIDISCORD_URL: S.url, PRODEV_NOTIFY_TOKEN: 진짜꼴토큰 });
  S.srv.close();

  assert.strictEqual(r.code, 0, '알림이 압축을 막지 않는다 (fail-open)');
  assert.strictEqual(S.받은것.length, 1, `요청이 ${S.받은것.length}건이다`);
  const q = S.받은것[0];

  assert.strictEqual(q.method, 'POST');
  assert.match(q.url, /^\/api\/rooms\/\d+\/messages$/);
  assert.strictEqual(q.cookie, `md_session=${진짜꼴토큰}`, `쿠키가 아니다: ${q.cookie}`);
  assert.strictEqual(q.auth, '', `Authorization 이 남아 있다: ${q.auth}`);
  assert.match(q.ctype, /^multipart\/form-data/, `multipart 가 아니다: ${q.ctype}`);
  assert.ok(!q.ctype.includes('application/json'), 'JSON 으로 보낸다');
  assert.match(q.body, /name="body"/, 'body 칸이 없다');
  assert.match(q.body, /정리 중/, '무슨 말인지 안 적혀 있다');
});

test('pre-compact 알림 — MINIDISCORD_URL 이 빈 값이면 토큰이 있어도 안 보내고 exit 0 (조종석 봇 설정, ADR-038)', async () => {
  // 조종석 판의 봇 설정은 env 에 MINIDISCORD_URL 을 빈 값으로 둔다. 압축 알림은 조종석이 system 글로 올린다.
  // 토큰이 봇 폴더 .env 에 남아 있어도(minidiscord 시절 파일) 어디로도 보내지 않아야 한다.
  const S = await 받아적는서버();
  const r = await 압축훅({ MINIDISCORD_URL: '', PRODEV_NOTIFY_TOKEN: 진짜꼴토큰 });
  S.srv.close();
  assert.strictEqual(r.code, 0);
  assert.strictEqual(S.받은것.length, 0, 'URL 이 비었는데 보냈다');
});

test('pre-compact 알림 — 토큰이 없으면 아무것도 안 보내고 그대로 exit 0', async () => {
  const S = await 받아적는서버();
  const r = await 압축훅({ MINIDISCORD_URL: S.url, PRODEV_NOTIFY_TOKEN: '', PRODEV_BOT: '', PRODEV_BOT_DIR: '' });
  S.srv.close();
  assert.strictEqual(r.code, 0);
  assert.strictEqual(S.받은것.length, 0, '토큰 없이 보냈다');
});

test('pre-compact 알림 — 토큰을 봇 폴더의 .env 에서도 읽는다 (봇 settings 에는 안 둔다)', async () => {
  const S = await 받아적는서버();
  const 봇폴더 = tmp('botdir');
  fs.writeFileSync(path.join(봇폴더, '.env'), `MINIDISCORD_TOKEN=봇것\nPRODEV_NOTIFY_TOKEN="${env토큰}"\n`);
  const r = await 압축훅({ MINIDISCORD_URL: S.url, PRODEV_NOTIFY_TOKEN: '', PRODEV_BOT_DIR: 봇폴더 });
  S.srv.close();
  assert.strictEqual(r.code, 0);
  assert.strictEqual(S.받은것.length, 1, '.env 의 토큰을 못 읽었다');
  assert.strictEqual(S.받은것[0].cookie, `md_session=${env토큰}`, '따옴표를 안 벗겼다');
});

test('pre-compact 알림 — 방 번호를 rooms.json 의 본방에서 찾는다 (env 도 chat_id 도 없을 때)', async () => {
  // R5 재측정에서 알림이 또 건너뛰었다. URL 은 고쳤는데 **방 번호**가 비어 있었다:
  // PreCompact 입력에 chat_id 가 없고, setup.js 는 env 에 방 번호를 넣지 않는다
  // (설치할 때는 방이 아직 없다). rooms.json 을 읽는 것이 그 순서에 안 기대는 길이다.
  //
  // ead4807 의 시험은 settings 의 값만 봤다. 여기서는 **모의 서버가 실제로 받은 요청**을 본다.
  const S = await 받아적는서버();
  const 봇폴더 = tmp('본방찾기');
  fs.writeFileSync(path.join(봇폴더, '.env'), `PRODEV_NOTIFY_TOKEN=${진짜꼴토큰}\n`);
  fs.writeFileSync(path.join(봇폴더, 'rooms.json'), JSON.stringify({
    과제: '시험', rooms: [
      { id: 42, name: 'prodev-시험/files', last_seen_id: 0 },
      { id: 41, name: 'prodev-시험', last_seen_id: 0 },              // 본방 — 접미어가 없다
    ],
  }));

  // 기록을 못 읽게 해 인수인계서에 chat_id 가 안 생기게 한다 → rooms.json 까지 내려간다
  const r = await 압축훅({ __기록없음: '1', MINIDISCORD_URL: S.url, PRODEV_NOTIFY_TOKEN: '', PRODEV_NOTIFY_ROOM: '', PRODEV_BOT_DIR: 봇폴더 });
  S.srv.close();

  assert.strictEqual(r.code, 0);
  assert.strictEqual(S.받은것.length, 1, '알림이 안 나갔다 (방 번호를 못 찾았다)');
  const q = S.받은것[0];
  assert.strictEqual(q.url, '/api/rooms/41/messages', `본방이 아닌 데로 갔다: ${q.url}`);
  assert.strictEqual(q.cookie, `md_session=${진짜꼴토큰}`);
  assert.match(q.ctype, /^multipart\/form-data/);
  assert.match(q.body, /정리 중/, '본문이 안 실렸다');
});

test('pre-compact 알림 — chat_id 와 env 가 rooms.json 보다 먼저다', async () => {
  const S = await 받아적는서버();
  const 봇폴더 = tmp('차례');
  fs.writeFileSync(path.join(봇폴더, '.env'), `PRODEV_NOTIFY_TOKEN=${진짜꼴토큰}\n`);
  fs.writeFileSync(path.join(봇폴더, 'rooms.json'), JSON.stringify({
    과제: '시험', rooms: [{ id: 41, name: 'prodev-시험', last_seen_id: 0 }],
  }));
  const r = await 압축훅({ MINIDISCORD_URL: S.url, PRODEV_NOTIFY_TOKEN: '', PRODEV_NOTIFY_ROOM: '77', PRODEV_BOT_DIR: 봇폴더 });
  S.srv.close();
  assert.strictEqual(r.code, 0);
  assert.strictEqual(S.받은것[0].url, '/api/rooms/77/messages', 'env 가 rooms.json 에 밀렸다');
});

test('pre-compact 알림 — rooms.json 에 본방이 없으면 아무 데도 안 보낸다', async () => {
  // files 방만 있으면 어디에 알릴지 모른다. 아무 방에나 던지지 않는다.
  const S = await 받아적는서버();
  const 봇폴더 = tmp('본방없음');
  fs.writeFileSync(path.join(봇폴더, '.env'), `PRODEV_NOTIFY_TOKEN=${진짜꼴토큰}\n`);
  fs.writeFileSync(path.join(봇폴더, 'rooms.json'), JSON.stringify({
    과제: '시험', rooms: [{ id: 42, name: 'prodev-시험/files', last_seen_id: 0 }],
  }));
  const r = await 압축훅({ __기록없음: '1', MINIDISCORD_URL: S.url, PRODEV_NOTIFY_TOKEN: '', PRODEV_NOTIFY_ROOM: '', PRODEV_BOT_DIR: 봇폴더 });
  S.srv.close();
  assert.strictEqual(r.code, 0, '알림이 압축을 막지 않는다');
  assert.strictEqual(S.받은것.length, 0, '본방이 없는데 어딘가로 보냈다');
});

test('pre-compact 알림 — 인수인계서의 첫 chat_id 가 rooms.json 본방보다 먼저다', async () => {
  // 하던 방이 있으면 거기가 맞다. 사람이 그 방에서 기다리고 있다.
  const S = await 받아적는서버();
  const 봇폴더 = tmp('하던방');
  fs.writeFileSync(path.join(봇폴더, '.env'), `PRODEV_NOTIFY_TOKEN=${진짜꼴토큰}\n`);
  fs.writeFileSync(path.join(봇폴더, 'rooms.json'), JSON.stringify({
    과제: '시험', rooms: [{ id: 41, name: 'prodev-시험', last_seen_id: 0 }],
  }));
  // 기록이 있으니 인수인계서가 채워지고, 그 안에 chat_id 2 (들이기) 가 있다
  const r = await 압축훅({ MINIDISCORD_URL: S.url, PRODEV_NOTIFY_TOKEN: '', PRODEV_NOTIFY_ROOM: '', PRODEV_BOT_DIR: 봇폴더 });
  S.srv.close();
  assert.strictEqual(r.code, 0);
  assert.strictEqual(S.받은것[0].url, '/api/rooms/2/messages', '하던 방이 아니라 본방으로 갔다');
});

// ── 압축 직후 알림 (session-start, ADR-018 보충) ──────────

function 시작훅(env, source) {
  const 낼곳 = path.join(tmp('직후'), 'handoff-compact.md');
  return new Promise(r => {
    execFile(process.execPath, [path.join(HOOKS, 'session-start.js')], {
      encoding: 'utf8',
      env: { ...process.env, PRODEV_HANDOFF: 낼곳, PRODEV_PROJECT: PROJECT, MINIDISCORD_DB: DB, ...env },
    }, (e, out) => r({ code: e ? e.code : 0, out, 낼곳 }))
      .stdin.end(JSON.stringify({ source }));
  });
}

test('session-start — 압축 직후에는 방에 "정리가 끝났습니다" 한 줄을 올린다', async () => {
  // 압축 뒤에는 사람이 말을 걸어야 봇이 이어서 한다. 사람이 그 시점을 알아야 한다.
  const S = await 받아적는서버();
  const 봇폴더 = tmp('직후봇');
  fs.writeFileSync(path.join(봇폴더, '.env'), `PRODEV_NOTIFY_TOKEN=${진짜꼴토큰}\n`);
  fs.writeFileSync(path.join(봇폴더, 'rooms.json'), JSON.stringify({
    과제: '시험', rooms: [{ id: 41, name: 'prodev-시험', last_seen_id: 0 }, { id: 42, name: 'prodev-시험/files', last_seen_id: 0 }],
  }));

  const r = await 시작훅({ MINIDISCORD_URL: S.url, PRODEV_BOT_DIR: 봇폴더 }, 'compact');
  S.srv.close();

  assert.strictEqual(r.code, 0, 'session-start 는 세션을 막지 않는다');
  assert.strictEqual(S.받은것.length, 1, `요청이 ${S.받은것.length}건이다`);
  const q = S.받은것[0];
  assert.strictEqual(q.url, '/api/rooms/41/messages', `본방이 아닌 데로 갔다: ${q.url}`);
  assert.strictEqual(q.cookie, `md_session=${진짜꼴토큰}`);
  assert.match(q.ctype, /^multipart\/form-data/);
  assert.match(q.body, /정리가 끝났습니다/);
  assert.match(q.body, /말을 걸어/);

  // 알림이 문맥 출력을 건드리지 않는다
  const 문맥 = JSON.parse(r.out).hookSpecificOutput.additionalContext;
  assert.ok(문맥.length > 0, 'additionalContext 가 비었다');
  assert.ok(!문맥.includes('정리가 끝났습니다'), '알림 문장이 문맥에 샜다');
});

test('session-start — 껐다 켠 경우(startup·resume·clear)에는 안 올린다', async () => {
  // 서버가 놓친 글을 재배달하니 사람이 따로 할 일이 없다 (R5 두 번 확인).
  const 봇폴더 = tmp('켬');
  fs.writeFileSync(path.join(봇폴더, '.env'), `PRODEV_NOTIFY_TOKEN=${진짜꼴토큰}\n`);
  fs.writeFileSync(path.join(봇폴더, 'rooms.json'), JSON.stringify({
    과제: '시험', rooms: [{ id: 41, name: 'prodev-시험', last_seen_id: 0 }],
  }));
  for (const source of ['startup', 'resume', 'clear']) {
    const S = await 받아적는서버();
    const r = await 시작훅({ MINIDISCORD_URL: S.url, PRODEV_BOT_DIR: 봇폴더 }, source);
    S.srv.close();
    assert.strictEqual(r.code, 0);
    assert.strictEqual(S.받은것.length, 0, `${source} 에서 알림이 나갔다`);
  }
});

// ── ADR-039: 확정 조건 ② 는 "같은 과제의 방" — 갈래를 보지 않는다 ────────────
// fixture.db 는 방 둘(1 본방 · 2 /files) 판이라 조건 ② 를 어기는 글이 없다. 사본에서 글 #1~#3(E-0001 의 자료 · 봇 읽음 · 확정)을 옮겨 잰다.
function 방옮긴DB(옮김) {
  const dir = tmp('adr039');
  const db = path.join(dir, 'chat.db');
  fs.copyFileSync(DB, db);
  const { DatabaseSync } = require('node:sqlite');
  const d = new DatabaseSync(db);
  try { 옮김(d); } finally { d.close(); }
  return db;
}
const E0001공지 = { hook_event_name: 'PreToolUse', tool_name: 'mcp__cockpit__reply', tool_input: { chat_id: '1', text: '[카드] E-0001 · 훅 시험 · cards/E-0001.md' } };

test('pre-reply — ADR-039 확정 조건 ② — 같은 과제의 본방에서 받은 확정도 통과한다', () => {
  const db = 방옮긴DB(d => d.prepare('UPDATE messages SET room_id = 1 WHERE id IN (1, 2, 3)').run());
  const r = hook('pre-reply.js', E0001공지, { MINIDISCORD_DB: db, PRODEV_PROJECT: PROJECT });
  assert.strictEqual(r.code, 0, `stderr: ${r.stderr.trim()}`);
});

test('pre-reply — ADR-039 확정 조건 ② — 다른 과제의 방에서 받은 확정은 막는다', () => {
  const db = 방옮긴DB(d => {
    d.prepare("INSERT INTO rooms (id, name) VALUES (3, 'prodev-남의과제')").run();
    d.prepare('UPDATE messages SET room_id = 3 WHERE id IN (1, 2, 3)').run();
  });
  const r = hook('pre-reply.js', E0001공지, { MINIDISCORD_DB: db, PRODEV_PROJECT: PROJECT });
  assert.strictEqual(r.code, 2);
  assert.match(r.stderr, /E-0001 의 확정 글 #3 이 prodev-시험 의 방이 아니다 \(prodev-남의과제\)/);
});
