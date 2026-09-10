#!/usr/bin/env node
// replay.js — 사람 역할을 API 로 재생한다. 사람이 직접 치는 것과 같은 HTTP 경로라 봇은 구분하지 못한다.
//
//   node scripts/replay.js <대본.json> <기록.jsonl> [--base http://127.0.0.1:3000]
//
// meta 가 검수에 쓴다 (VERIFICATION 4.1). 봇은 이 스크립트를 부르지 않는다.
// 판정하지 않는다 — 오간 것을 그대로 적을 뿐이고 채점은 meta 의 채점표가 한다.
//
// 대본 꼴은 meta 가 쥔다 (2026-09-10 규격):
//   { name, project, actors:{PL,member}, bot, steps:[ … ] }
//   걸음 넷 중 하나다:
//     글    { id, room, author:PL|member, text, attach:[상대경로], wait:"bot"|"none", timeout_s,
//             expect:"정규식", then:[걸음…], else:[걸음…] }
//     손    { id, manual:"사람이 할 일" }        TTY 면 Enter 를 기다리고,
//                                              아니면 <기록.jsonl>.manual-<id>.ok 가 생길 때까지 2초마다 본다
//     잠깐  { id, sleep_s: 30 }
//
// 계정: env REPLAY_TOKEN_PL · REPLAY_TOKEN_MEMBER 가 세션 토큰이다 (쿠키 md_session 에 그대로 실린다).
//       없으면 시작 전에 죽는다 — 반쯤 돌다 멈춘 대본은 다시 돌릴 수 없다.
//
// 서버와 말하는 법 (2026-09-10 시험 서버로 직접 확인한 값):
//   GET  /api/rooms                          { active:[{id,name}], archived:[…] }
//   POST /api/rooms/:id/messages             multipart 만 받는다 (JSON 본문은 406)
//   GET  /api/rooms/:id/messages?after=<id>  오름차순 최대 200
//   인증은 쿠키 md_session 하나다. Authorization: Bearer 는 받지 않는다 (401).

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const 폴링 = 2000;              // meta 규격: 폴링 2초
const 기본상한 = 300;           // 초
const 갈래 = ['본방', '들이기', '자료', '리서치', '특허', '논문', '보고'];

function 죽는다(말) { process.stderr.write(말 + '\n'); process.exit(1); }
const 잠깐 = ms => new Promise(r => setTimeout(r, ms));
const 지금 = () => new Date().toISOString();

// ── 대본 ─────────────────────────────────────────────────

function 대본읽기(경로) {
  let 원본;
  try { 원본 = JSON.parse(fs.readFileSync(경로, 'utf8')); }
  catch (e) { 죽는다(`대본을 못 읽었다: ${경로} — ${e.message}`); }
  if (!원본.project) 죽는다('대본에 project 가 없다 — 방 이름을 만들 수 없다');
  if (!Array.isArray(원본.steps) || !원본.steps.length) 죽는다('대본에 steps 가 없다');

  const 기준 = path.dirname(path.resolve(경로));
  const 본id = new Set();

  // 걸음을 재귀로 훑어 미리 어그러진 곳을 잡는다. 반쯤 돌다 멈추면 대본을 다시 돌릴 수 없다.
  const 훑는다 = (걸음들, 자리) => {
    if (!Array.isArray(걸음들)) 죽는다(`${자리}: 걸음 목록이 배열이 아니다`);
    for (const s of 걸음들) {
      const id = s.id == null ? '(id 없음)' : String(s.id);
      if (s.id == null) 죽는다(`${자리}: id 없는 걸음이 있다`);
      if (본id.has(id)) 죽는다(`걸음 id 가 겹친다: ${id}`);
      본id.add(id);

      if (s.manual != null || s.sleep_s != null) continue;   // 손 · 잠깐 걸음

      if (!갈래.includes(s.room)) 죽는다(`걸음 ${id}: room 이 ${갈래.join('·')} 중 하나가 아니다 — ${s.room}`);
      if (s.author !== 'PL' && s.author !== 'member') 죽는다(`걸음 ${id}: author 는 PL 또는 member 다 — ${s.author}`);
      if (s.wait != null && s.wait !== 'bot' && s.wait !== 'none') 죽는다(`걸음 ${id}: wait 는 "bot" 또는 "none" 이다 — ${s.wait}`);
      for (const f of (s.attach || [])) {
        if (!fs.existsSync(path.resolve(기준, f))) 죽는다(`걸음 ${id}: 첨부가 없다 — ${path.resolve(기준, f)}`);
      }
      if (s.expect != null) { try { new RegExp(s.expect); } catch (e) { 죽는다(`걸음 ${id}: expect 정규식이 어그러졌다 — ${e.message}`); } }
      if (s.then) 훑는다(s.then, `걸음 ${id} then`);
      if (s.else) 훑는다(s.else, `걸음 ${id} else`);
    }
  };
  훑는다(원본.steps, 'steps');

  return { ...원본, 기준 };
}

// ── 서버 ─────────────────────────────────────────────────

class 서버 {
  constructor(base, 토큰) {
    this.base = String(base).replace(/\/$/, '');
    this.토큰 = 토큰;                       // { PL, member, 보는눈 }
  }
  쿠키(누구) { return `md_session=${this.토큰[누구]}`; }

  async 부른다(방법, 길, { 누구, 폼 } = {}) {
    const r = await fetch(this.base + 길, {
      method: 방법,
      headers: { cookie: this.쿠키(누구) },
      body: 폼,
    });
    const 글 = await r.text();
    let json = null; try { json = JSON.parse(글); } catch {}
    return { ok: r.ok, status: r.status, json, text: 글 };
  }

  // 방 이름 → id. 못 찾으면 죽는다 (meta 규격: 방을 못 찾으면 exit 1).
  async 방표(project, 누구) {
    const r = await this.부른다('GET', '/api/rooms', { 누구 });
    if (r.status === 401) 죽는다(`토큰이 안 먹는다 (401) — REPLAY_TOKEN_${누구.toUpperCase()} 를 확인하라`);
    if (!r.ok) 죽는다(`방 목록을 못 읽었다: ${r.status} ${r.text.slice(0, 160)}`);
    const 있는것 = new Map([...(r.json.active || []), ...(r.json.archived || [])].map(x => [x.name, x.id]));
    const 표 = new Map();
    for (const g of 갈래) {
      const 이름 = g === '본방' ? `prodev-${project}` : `prodev-${project}/${g}`;
      if (있는것.has(이름)) 표.set(g, 있는것.get(이름));
    }
    if (!표.has('본방')) 죽는다(`방을 못 찾았다: prodev-${project}  (있는 방: ${[...있는것.keys()].join(' · ') || '없음'})`);
    return 표;
  }

  // 사람 첨부와 같은 API. 파일 이름을 바꾸지 않는다.
  async 올린다(방, 누구, 글, 파일들) {
    const fd = new FormData();
    fd.append('body', 글 == null ? '' : String(글));
    for (const f of 파일들) {
      fd.append('files', new Blob([fs.readFileSync(f)]), path.basename(f));
    }
    return this.부른다('POST', `/api/rooms/${방}/messages`, { 누구, 폼: fd });
  }

  async 글들(방, 뒤, 누구) {
    const r = await this.부른다('GET', `/api/rooms/${방}/messages?after=${뒤}`, { 누구 });
    if (!r.ok) return [];
    return (r.json && r.json.messages) || [];
  }

  async 마지막id(방, 누구) {
    const 다 = await this.글들(방, 0, 누구);
    return 다.length ? 다[다.length - 1].id : 0;
  }
}

// 그 방에 봇 글이 새로 올 때까지. 상한을 넘으면 null.
async function 봇기다리기(srv, 방, 뒤, 누구, 상한초) {
  const 끝 = Date.now() + 상한초 * 1000;
  let 커서 = 뒤;
  while (Date.now() < 끝) {
    for (const m of await srv.글들(방, 커서, 누구)) {
      커서 = m.id;
      if (m.author_type === 'bot') return m;
    }
    await 잠깐(폴링);
  }
  return null;
}

// 사람이 손으로 할 일. 두 길이 있다:
//   화면 앞에 사람이 있으면(stdin 이 TTY) Enter 를 기다린다.
//   배경에서 돌면(TTY 아님) 신호 파일이 생길 때까지 2초마다 본다 — meta 가 배경에서 돌리고
//   사람이 파일 하나를 만들어 "했다" 를 알린다. Enter 를 기다리면 배경 재생이 영영 멈춘다.
function 손기다리기(말, 신호파일) {
  if (process.stdin.isTTY) {
    return new Promise(r => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question(`\n  ✋ ${말}\n     끝나면 Enter → `, () => { rl.close(); r(); });
    });
  }
  console.log(`\n  ✋ ${말}`);
  console.log(`     끝나면 이 파일을 만들어라: ${신호파일}`);
  return (async () => {
    while (!fs.existsSync(신호파일)) await 잠깐(2000);
    console.log('     신호 받음');
  })();
}

// ── 몸통 ─────────────────────────────────────────────────

async function main() {
  const argv = process.argv.slice(2);
  const 위치 = [];
  let base = process.env.MINIDISCORD_URL || 'http://127.0.0.1:3000';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--base') base = argv[++i];
    else if (argv[i].startsWith('--')) 죽는다(`모르는 옵션: ${argv[i]}`);
    else 위치.push(argv[i]);
  }
  if (위치.length < 2) 죽는다('쓰는 법: node scripts/replay.js <대본.json> <기록.jsonl> [--base http://127.0.0.1:PORT]');
  const [대본경로, 기록경로] = 위치;

  const PL = process.env.REPLAY_TOKEN_PL;
  const MEMBER = process.env.REPLAY_TOKEN_MEMBER;
  if (!PL) 죽는다('REPLAY_TOKEN_PL 이 없다 — PL 계정의 세션 토큰을 넣어라 (docs/launch.md 5절)');
  if (!MEMBER) 죽는다('REPLAY_TOKEN_MEMBER 가 없다 — 과제원 계정의 세션 토큰을 넣어라 (docs/launch.md 5절)');

  const 대본 = 대본읽기(대본경로);
  const srv = new 서버(base, { PL, member: MEMBER });
  const 방표 = await srv.방표(대본.project, 'PL');

  const 기록 = fs.createWriteStream(기록경로, { flags: 'a' });
  const 적는다 = o => 기록.write(JSON.stringify(o) + '\n');
  const 셈 = { steps: 0, timeouts: 0, bot_msgs: 0 };

  console.log(`대본 ${대본.name || path.basename(대본경로)} · ${base}`);
  console.log(`방 ${[...방표].map(([g, id]) => `${g}=${id}`).join(' · ')}`);

  async function 걸음들돌기(걸음들) {
    for (const s of 걸음들) {
      const id = String(s.id);

      if (s.manual != null) {
        await 손기다리기(s.manual, `${기록경로}.manual-${id}.ok`);
        적는다({ id, manual: s.manual, manual_t: 지금() });
        셈.steps++;
        continue;
      }
      if (s.sleep_s != null) {
        console.log(`  ${id}  ${s.sleep_s}초 기다림`);
        await 잠깐(s.sleep_s * 1000);
        적는다({ id, sleep_s: s.sleep_s, t_sent: 지금() });
        셈.steps++;
        continue;
      }

      const 방 = 방표.get(s.room);
      if (방 == null) 죽는다(`걸음 ${id}: 방이 안 열렸다 — ${s.room} (prodev-${대본.project}/${s.room})`);

      const 첨부 = (s.attach || []).map(f => path.resolve(대본.기준, f));
      const 뒤 = await srv.마지막id(방, s.author);
      const t_sent = 지금();
      const 올린것 = await srv.올린다(방, s.author, s.text, 첨부);
      셈.steps++;

      if (!올린것.ok) {
        적는다({ id, t_sent, room_id: 방, message_id: null, bot: null, timeout: false, branch: null,
          error: `${올린것.status} ${올린것.text.slice(0, 200)}` });
        console.log(`  ${id}  못 올림 (${올린것.status}) — ${올린것.text.slice(0, 90)}`);
        continue;
      }

      const message_id = (올린것.json && 올린것.json.message && 올린것.json.message.id) || null;
      const 먹힘 = 올린것.json && 올린것.json.consumed_by === 'permission';
      const 줄 = { id, t_sent, room_id: 방, message_id, bot: null, timeout: false, branch: null };
      if (먹힘) 줄.consumed_by_permission = true;    // 승인 답으로 먹혀 글로 남지 않았다

      const 기다리나 = (s.wait === undefined ? 'bot' : s.wait) === 'bot';
      let 봇글 = null;
      if (기다리나) {
        봇글 = await 봇기다리기(srv, 방, message_id || 뒤, s.author, s.timeout_s || 기본상한);
        if (봇글) {
          셈.bot_msgs++;
          줄.bot = { message_id: 봇글.id, t: 봇글.created_at || 지금(), text: 봇글.body || '',
            attachments: (봇글.attachments || []).length };
        } else {
          셈.timeouts++;
          줄.timeout = true;
        }
      }

      let 이어서 = null;
      if (s.expect != null) {
        const 맞나 = 봇글 ? new RegExp(s.expect).test(봇글.body || '') : false;
        줄.branch = 맞나 ? 'then' : 'else';
        이어서 = 맞나 ? s.then : s.else;
      }

      적는다(줄);
      console.log(`  ${id}  ${s.author} → ${s.room}` +
        (첨부.length ? ` (첨부 ${첨부.length})` : '') +
        (먹힘 ? '  [승인 답으로 먹힘]' : '') +
        (기다리나 ? (봇글 ? `  ← 봇 #${봇글.id}` : `  ← 무응답 ${s.timeout_s || 기본상한}초`) : '') +
        (줄.branch ? `  [${줄.branch}]` : ''));

      if (이어서 && 이어서.length) await 걸음들돌기(이어서);
    }
  }

  await 걸음들돌기(대본.steps);

  적는다({ summary: 셈 });
  await new Promise(r => 기록.end(r));
  console.log(`걸음 ${셈.steps} · 봇 글 ${셈.bot_msgs} · 무응답 ${셈.timeouts}\n기록: ${기록경로}`);
}

if (require.main === module) main().catch(e => 죽는다(String((e && e.stack) || e)));
module.exports = { 대본읽기, 서버, 봇기다리기 };
