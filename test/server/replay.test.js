// replay.js 시험 — 진짜 minidiscord 를 띄우지 않는다. 재생에 필요한 라우트 셋만 흉내 내는
// 임시 서버를 세우고, **가짜 봇**(replay 가 사람 글을 올리면 이 시험이 봇 글을 올린다)을 붙여 돌린다.
//
// npm test 에는 섞이지 않는다 — 이 파일은 test/server/ 에 있고 `npm run test:server` 로만 돈다.
// 까닭: 시험이 상한을 기다리는 자리(timeout 1초)가 있어 다른 단위 시험과 도는 결이 다르다.
//
// 흉내 내는 것 (진짜 서버의 계약 그대로. 2026-09-10 시험 서버로 확인):
//   GET  /api/rooms                        { active:[{id,name}], archived:[] }
//   POST /api/rooms/:id/messages           multipart 만 (JSON 이면 406) · 쿠키 md_session 없으면 401
//   GET  /api/rooms/:id/messages?after=N   오름차순
// 가짜 봇은 시험 쪽 함수(봇이답한다)로 글을 넣는다 — replay 가 그 답을 폴링으로 본다.

const { test } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const REPLAY = path.join(ROOT, 'scripts', 'replay.js');
const 토큰 = { PL: 'tok-pl', member: 'tok-member' };

// ── 임시 서버 ────────────────────────────────────────────
function 띄운다(project = '시험') {
  const 방들 = [
    { id: 11, name: `prodev-${project}` },
    { id: 12, name: `prodev-${project}/files` },
  ];
  const 글들 = [];
  const 세션 = new Map([[토큰.PL, '김피엘'], [토큰.member, '김과제']]);
  let 다음 = 100;

  const 몸 = req => new Promise(r => { const c = []; req.on('data', d => c.push(d)); req.on('end', () => r(Buffer.concat(c))); });

  const srv = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    const 낸다 = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    const tok = (/md_session=([^;]+)/.exec(req.headers.cookie || '') || [])[1];
    if (!세션.has(tok)) { await 몸(req); return 낸다(401, { error: '로그인이 필요합니다' }); }
    const 나 = 세션.get(tok);

    if (req.method === 'GET' && u.pathname === '/api/rooms') return 낸다(200, { active: 방들, archived: [] });

    const m = /^\/api\/rooms\/(\d+)\/messages$/.exec(u.pathname);
    if (m && req.method === 'GET') {
      const after = Number(u.searchParams.get('after') || 0);
      return 낸다(200, { messages: 글들.filter(g => g.room_id === Number(m[1]) && g.id > after) });
    }
    if (m && req.method === 'POST') {
      const ct = req.headers['content-type'] || '';
      if (!ct.startsWith('multipart/form-data')) { await 몸(req); return 낸다(406, { message: 'the request is not multipart' }); }
      const raw = (await 몸(req)).toString('utf8');
      const body = (/name="body"\r?\n\r?\n([\s\S]*?)\r?\n--/.exec(raw) || [, ''])[1];
      const 첨부 = [...raw.matchAll(/filename="([^"]*)"/g)].map((x, i) => ({ id: i + 1, filename: x[1] }));
      const 글 = { id: ++다음, room_id: Number(m[1]), author_type: 'user', author_name: 나, body, attachments: 첨부,
        created_at: new Date().toISOString() };
      글들.push(글);
      return 낸다(200, { ok: true, message: 글 });
    }
    낸다(404, { error: 'no' });
  });

  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({
    srv, 글들, base: `http://127.0.0.1:${srv.address().port}`,
    // 가짜 봇 — 사람 글이 그 방에 오면 봇 계정으로 답을 넣는다
    봇이답한다: (room_id, text) => {
      글들.push({ id: ++다음, room_id, author_type: 'bot', author_name: 'prodev-시험-bot', body: text,
        attachments: [], created_at: new Date().toISOString() });
    },
    사람글수: room_id => 글들.filter(g => g.room_id === room_id && g.author_type === 'user').length,
  })));
}

// replay 가 그 방에 사람 글을 올리기를 기다렸다가 가짜 봇이 답한다.
function 봇을붙인다(서버, room_id, 답, { 몇번째 = 1 } = {}) {
  const 시작 = 서버.사람글수(room_id);
  const t = setInterval(() => {
    if (서버.사람글수(room_id) >= 시작 + 몇번째) { clearInterval(t); 서버.봇이답한다(room_id, 답); }
  }, 100);
  return () => clearInterval(t);
}

const 임시폴더 = () => fs.mkdtempSync(path.join(os.tmpdir(), 'replay-'));
const 줄들 = 기록 => fs.readFileSync(기록, 'utf8').trim().split('\n').map(l => JSON.parse(l));

function 돌린다(대본, 기록, base, env = {}) {
  return new Promise((r, j) => {
    execFile(process.execPath, [REPLAY, 대본, 기록, '--base', base],
      { encoding: 'utf8', env: { ...process.env, REPLAY_TOKEN_PL: 토큰.PL, REPLAY_TOKEN_MEMBER: 토큰.member, ...env } },
      (e, out, err) => (e ? j(Object.assign(e, { out, err })) : r({ out, err })));
  });
}

// ── 시험 ─────────────────────────────────────────────────

test('걸음 셋 — wait bot · expect then/else · 상한 1초 무응답 이 기록 JSONL 로 남는다', async () => {
  const S = await 띄운다();
  const d = 임시폴더();
  const 대본 = path.join(d, 'r.json'), 기록 = path.join(d, 'r.jsonl');
  fs.writeFileSync(대본, JSON.stringify({
    name: 'R-시험', project: '시험',
    actors: { PL: '김피엘', member: '김과제' }, bot: 'prodev-시험-bot',
    steps: [
      // s1 봇이 답한다 → expect 에 걸려 then 으로
      { id: 's1', room: 'files', author: 'member', text: '@TO(prodev-시험-bot) 자료입니다', wait: 'bot', timeout_s: 20,
        expect: '확정',
        then: [{ id: 's1a', room: 'files', author: 'member', text: '확정', wait: 'none' }],
        else: [{ id: 's1b', room: 'files', author: 'member', text: '여기는 안 와야 한다', wait: 'none' }] },
      // s2 봇이 잠자코 있다 → 상한 1초 뒤 timeout
      { id: 's2', room: '본방', author: 'PL', text: '아무도 안 받는 글', wait: 'bot', timeout_s: 1 },
      // s3 안 기다린다
      { id: 's3', room: '본방', author: 'PL', text: '마지막', wait: 'none' },
    ],
  }));

  const 끈다 = 봇을붙인다(S, 12, '읽었습니다. 맞으면 확정이라고 답해 주세요');
  const t0 = Date.now();
  await 돌린다(대본, 기록, S.base);
  const 걸린 = (Date.now() - t0) / 1000;
  끈다(); S.srv.close();

  const r = 줄들(기록);
  const 줄 = id => r.find(x => x.id === id);

  // 한 걸음 = 한 줄, 끝에 요약 한 줄
  assert.deepEqual(r.filter(x => x.id).map(x => x.id), ['s1', 's1a', 's2', 's3'], 's1b 는 안 돈다');
  assert.deepEqual(r.at(-1).summary, { steps: 4, timeouts: 1, bot_msgs: 1 });

  // s1 — 봇 답이 붙고 branch 가 then
  assert.equal(줄('s1').room_id, 12);
  assert.ok(줄('s1').message_id > 0);
  assert.match(줄('s1').bot.text, /확정/);
  assert.equal(줄('s1').bot.attachments, 0);
  assert.equal(줄('s1').branch, 'then');
  assert.equal(줄('s1').timeout, false);
  assert.ok(줄('s1').t_sent && 줄('s1').bot.t, 't_sent 와 봇 t 가 있다');

  // s2 — 무응답
  assert.equal(줄('s2').timeout, true);
  assert.equal(줄('s2').bot, null);
  assert.equal(줄('s2').room_id, 11);

  // s3 — 안 기다렸으니 timeout 도 bot 도 없다
  assert.equal(줄('s3').timeout, false);
  assert.equal(줄('s3').bot, null);

  assert.ok(걸린 < 20, `상한만큼만 기다린다 (${걸린.toFixed(1)}초)`);
});

test('expect 가 안 걸리면 else 를 돈다', async () => {
  const S = await 띄운다();
  const d = 임시폴더();
  const 대본 = path.join(d, 'e.json'), 기록 = path.join(d, 'e.jsonl');
  fs.writeFileSync(대본, JSON.stringify({
    name: 'else', project: '시험', steps: [
      { id: 's1', room: 'files', author: 'member', text: '자료', wait: 'bot', timeout_s: 20,
        expect: '확정',
        then: [{ id: 't1', room: 'files', author: 'member', text: 'then', wait: 'none' }],
        else: [{ id: 'e1', room: 'files', author: 'member', text: 'else', wait: 'none' }] },
    ],
  }));
  const 끈다 = 봇을붙인다(S, 12, '아직 모르겠습니다. 하나만 여쭙습니다');
  await 돌린다(대본, 기록, S.base);
  끈다(); S.srv.close();

  const r = 줄들(기록);
  assert.deepEqual(r.filter(x => x.id).map(x => x.id), ['s1', 'e1']);
  assert.equal(r.find(x => x.id === 's1').branch, 'else');
});

test('첨부가 이름 그대로 올라간다', async () => {
  const S = await 띄운다();
  const d = 임시폴더();
  fs.mkdirSync(path.join(d, 'data'));
  fs.writeFileSync(path.join(d, 'data', 'yield.csv'), 'a,b\n1,2\n');
  const 대본 = path.join(d, 'a.json'), 기록 = path.join(d, 'a.jsonl');
  fs.writeFileSync(대본, JSON.stringify({
    name: '첨부', project: '시험', steps: [
      { id: 's1', room: 'files', author: 'member', text: '자료', attach: ['data/yield.csv'], wait: 'none' },
    ],
  }));
  await 돌린다(대본, 기록, S.base);
  const 올라간것 = S.글들.find(g => g.author_type === 'user');
  S.srv.close();
  assert.deepEqual(올라간것.attachments.map(a => a.filename), ['yield.csv'], '대본 기준 상대 경로가 풀리고 이름이 그대로다');
  assert.equal(올라간것.author_name, '김과제', 'member 토큰으로 올라간다');
});

test('sleep_s 걸음은 기다리고 기록에 남는다', async () => {
  const S = await 띄운다();
  const d = 임시폴더();
  const 대본 = path.join(d, 's.json'), 기록 = path.join(d, 's.jsonl');
  fs.writeFileSync(대본, JSON.stringify({ name: '잠깐', project: '시험', steps: [{ id: 'z1', sleep_s: 1 }] }));
  const t0 = Date.now();
  await 돌린다(대본, 기록, S.base);
  const 걸린 = Date.now() - t0;
  S.srv.close();
  const r = 줄들(기록);
  assert.equal(r[0].sleep_s, 1);
  assert.ok(걸린 >= 1000, `정말 기다린다 (${걸린}ms)`);
});

test('토큰이 없으면 시작 전에 죽는다 (exit 1)', async () => {
  const S = await 띄운다();
  const d = 임시폴더();
  const 대본 = path.join(d, 'x.json'), 기록 = path.join(d, 'x.jsonl');
  fs.writeFileSync(대본, JSON.stringify({ name: 'x', project: '시험', steps: [{ id: 's1', room: '본방', author: 'PL', text: 'ㄱ', wait: 'none' }] }));
  await assert.rejects(() => 돌린다(대본, 기록, S.base, { REPLAY_TOKEN_PL: '' }),
    e => { assert.equal(e.code, 1); assert.match(e.err, /REPLAY_TOKEN_PL/); return true; });
  assert.equal(fs.existsSync(기록), false, '기록 파일을 만들지 않는다');
  S.srv.close();
});

test('방을 못 찾으면 죽는다 (exit 1)', async () => {
  const S = await 띄운다();
  const d = 임시폴더();
  const 대본 = path.join(d, 'y.json'), 기록 = path.join(d, 'y.jsonl');
  fs.writeFileSync(대본, JSON.stringify({ name: 'y', project: '없는과제', steps: [{ id: 's1', room: '본방', author: 'PL', text: 'ㄱ', wait: 'none' }] }));
  await assert.rejects(() => 돌린다(대본, 기록, S.base),
    e => { assert.equal(e.code, 1); assert.match(e.err, /방을 못 찾았다/); return true; });
  S.srv.close();
});

test('대본이 어그러지면 재생 전에 죽는다 — room · author · wait · 첨부 · id 겹침', async () => {
  const S = await 띄운다();
  const d = 임시폴더();
  const 안된다 = async (steps, 걸릴말, 더 = {}) => {
    const p = path.join(d, `b${Math.random()}.json`);
    fs.writeFileSync(p, JSON.stringify({ name: 'b', project: '시험', steps, ...더 }));
    await assert.rejects(() => 돌린다(p, path.join(d, 'b.jsonl'), S.base),
      e => { assert.equal(e.code, 1); assert.match(e.err, 걸릴말); return true; });
  };
  await 안된다([{ id: 's1', room: '창고', author: 'PL', text: 'ㄱ' }], /room/);
  await 안된다([{ id: 's1', room: '본방', author: '김피엘', text: 'ㄱ' }], /author/);
  await 안된다([{ id: 's1', room: '본방', author: 'PL', text: 'ㄱ', wait: '조금' }], /wait/);
  await 안된다([{ id: 's1', room: '본방', author: 'PL', text: 'ㄱ', attach: ['없는파일.csv'] }], /첨부가 없다/);
  await 안된다([{ id: 's1', room: '본방', author: 'PL', text: 'ㄱ' }, { id: 's1', room: '본방', author: 'PL', text: 'ㄴ' }], /겹친다/);
  await 안된다([{ id: 's1', room: '본방', author: 'PL', text: 'ㄱ', expect: '(' }], /expect/);
  // then 안쪽의 어그러짐도 미리 잡는다 — 반쯤 돌다 멈추면 대본을 다시 돌릴 수 없다
  await 안된다([{ id: 's1', room: '본방', author: 'PL', text: 'ㄱ', expect: 'x', then: [{ id: 't1', room: '창고', author: 'PL', text: 'ㄴ' }] }], /room/);
  S.srv.close();
});

test('manual 걸음 — TTY 가 아니면 신호 파일이 생길 때까지 기다린다', async () => {
  // meta 가 배경에서 재생을 돌리고 사람이 파일 하나를 만들어 "했다" 를 알린다.
  // 배경에서 Enter 를 기다리면 재생이 영영 멈춘다 — 그래서 TTY 가 아닐 때는 파일을 본다.
  const S = await 띄운다();
  const d = 임시폴더();
  const 대본 = path.join(d, 'm.json'), 기록 = path.join(d, 'm.jsonl');
  fs.writeFileSync(대본, JSON.stringify({
    name: '손', project: '시험', steps: [
      { id: 'm1', manual: '봇 세션에서 /compact 를 친다' },
      { id: 's1', room: '본방', author: 'PL', text: '압축 뒤 첫 글', wait: 'none' },
    ],
  }));

  const 신호 = `${기록}.manual-m1.ok`;
  const 도는중 = 돌린다(대본, 기록, S.base);

  // 신호를 주기 전에는 다음 걸음이 안 나가야 한다
  await new Promise(r => setTimeout(r, 2500));
  assert.equal(S.사람글수(11), 0, '신호도 없이 다음 걸음을 올렸다');

  fs.writeFileSync(신호, '');
  await 도는중;
  S.srv.close();

  const r = 줄들(기록);
  assert.equal(r[0].id, 'm1');
  assert.equal(r[0].manual, '봇 세션에서 /compact 를 친다');
  assert.ok(r[0].manual_t, '언제 끝났는지 안 적혔다');
  assert.equal(r[1].id, 's1', '신호 뒤에 다음 걸음이 돈다');
  assert.deepEqual(r.at(-1).summary, { steps: 2, timeouts: 0, bot_msgs: 0 });
});
