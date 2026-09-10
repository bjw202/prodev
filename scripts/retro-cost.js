#!/usr/bin/env node
// 비용 계측 — 사람이 돌린다. 봇은 이 스크립트를 쓰지 않는다.
//
//   node scripts/retro-cost.js [--since YYYY-MM-DD] [--room <방번호>] [--record [--label S2]]
//
// --record 를 주면 잰 값을 metrics/runs.jsonl 에 한 줄 붙인다. 세대끼리 견주는 숫자는
// 기억이 아니라 이 파일에서 온다 (EVOLUTION.md 의 '숫자' 층).
//
// 봇의 세션 기록(~/.claude/projects/…)에서 턴·토큰·유휴 시간을 잰다.
// --room 을 주면 채팅 서버에서 사람이 누른 도구 승인 횟수도 센다 (MINIDISCORD_URL·MINIDISCORD_USER, 기본 observer).
// 봇에게는 이 숫자가 보이지 않는다 — 자기 실행 기록을 봇에게 주지 않으려는 것이다.
const fs = require('fs');
const path = require('path');
const os = require('os');

const CREW = path.dirname(__dirname);
const PROJECTS = path.join(os.homedir(), '.claude', 'projects');
const argv = process.argv.slice(2);
const arg = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const sinceArg = arg('--since');
const since = sinceArg ? new Date(sinceArg + 'T00:00:00') : new Date(Date.now() - 24 * 3600 * 1000);
const sinceLabel = sinceArg || '최근 24시간';
const roomId = arg('--room');
const record = argv.includes('--record');
const label = arg('--label') || '';

const BOTS = fs.readdirSync(path.join(CREW, 'bots')).filter(b => fs.existsSync(path.join(CREW, 'bots', b, 'CLAUDE.md')));
const dirs = fs.existsSync(PROJECTS) ? fs.readdirSync(PROJECTS) : [];
const n = x => x.toLocaleString('en-US');

// 표준 단가($/1M) — 같은 잣대로 견주기 위한 환산값이다. 실제 청구액이 아니다.
const P = { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 7.5 };

const rows = [];
const perBot = {};
let T = { calls: 0, input: 0, output: 0, cr: 0, cw: 0, sub: 0 };
for (const bot of BOTS) {
  const d = dirs.find(x => x.endsWith('-bots-' + bot));
  if (!d) { rows.push([bot, '세션 기록 없음']); continue; }
  const dir = path.join(PROJECTS, d);
  const sess = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl'))
    .map(f => path.join(dir, f)).filter(f => fs.statSync(f).mtime >= since);
  if (!sess.length) { rows.push([bot, `${sinceLabel} 뒤 세션 없음`]); continue; }

  let calls = 0, input = 0, output = 0, cr = 0, cw = 0, sub = 0, maxCtx = 0, sumCtx = 0;
  const ts = [];
  for (const f of sess) {
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let o; try { o = JSON.parse(line); } catch { continue; }
      if (o.timestamp) ts.push(new Date(o.timestamp).getTime());
      if (o.type !== 'assistant') continue;
      const m = o.message || {}, u = m.usage;
      if (u) {
        calls++; input += u.input_tokens || 0; output += u.output_tokens || 0;
        cr += u.cache_read_input_tokens || 0; cw += u.cache_creation_input_tokens || 0;
        const ctx = (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.input_tokens || 0);
        sumCtx += ctx; if (ctx > maxCtx) maxCtx = ctx;
      }
      for (const c of m.content || []) if (c && c.type === 'tool_use' && (c.name === 'Agent' || c.name === 'Task')) sub++;
    }
  }
  ts.sort((a, b) => a - b);
  const span = ts.length > 1 ? (ts[ts.length - 1] - ts[0]) / 60000 : 0;
  let idle = 0;
  for (let i = 0; i < ts.length - 1; i++) { const g = (ts[i + 1] - ts[i]) / 60000; if (g > 1) idle += g; }
  T.calls += calls; T.input += input; T.output += output; T.cr += cr; T.cw += cw; T.sub += sub;
  perBot[bot] = { calls, output, cache_read: cr, ctx_avg: Math.round(sumCtx / Math.max(calls, 1)), ctx_max: maxCtx,
                  span_min: Math.round(span), active_min: Math.round(span - idle), subagents: sub };
  rows.push([bot, `호출 ${String(calls).padStart(4)} · 출력 ${String(n(output)).padStart(9)} · 문맥읽기 ${String(n(cr)).padStart(11)}`
    + ` · 문맥 평균 ${String(n(Math.round(sumCtx / Math.max(calls, 1)))).padStart(8)} 최대 ${String(n(maxCtx)).padStart(8)}`
    + ` · ${span.toFixed(0)}분 중 활동 ${(span - idle).toFixed(0)}분(${span ? (100 * (span - idle) / span).toFixed(0) : 0}%)`
    + ` · 서브에이전트 ${sub}`]);
}

console.log(`\n비용 계측 · ${sinceLabel} 이후 · ${new Date().toLocaleDateString('sv-SE')}\n`);
for (const [b, line] of rows) console.log('  ' + b.padEnd(14) + line);

const cost = (T.input * P.input + T.output * P.output + T.cr * P.cacheRead + T.cw * P.cacheWrite) / 1e6;
console.log(`\n  합계          호출 ${n(T.calls)} · 출력 ${n(T.output)} · 문맥읽기 ${n(T.cr)} · 문맥쓰기 ${n(T.cw)} · 서브에이전트 ${T.sub}`);
console.log(`  표준단가 환산  약 $${cost.toFixed(2)}  (실제 청구액이 아니라 같은 잣대로 견주기 위한 값이다)`);

// ── 기록 (--record) ──
function save(extra) {
  if (!record) return;
  const dir = path.join(CREW, 'metrics');
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  const line = JSON.stringify({
    recorded_at: new Date().toISOString(), label, since: sinceLabel, room: roomId || null,
    totals: { api_calls: T.calls, output: T.output, cache_read: T.cr, cache_write: T.cw, subagents: T.sub,
              cost_usd_equiv: Number(cost.toFixed(2)) },
    per_bot: perBot, ...extra,
  });
  try {
    fs.appendFileSync(path.join(dir, 'runs.jsonl'), line + '\n');
    console.log(`  기록          metrics/runs.jsonl 에 한 줄 붙였다${label ? ` (label=${label})` : ''}`);
  } catch (e) { console.log(`  기록          못 씀: ${e.message}`); }
}

// ── 도구 승인 (채팅 서버) ──
(async () => {
  if (!roomId) { console.log('\n  (도구 승인 횟수는 --room <방번호> 를 주면 함께 센다)\n'); save({}); return; }
  const url = (process.env.MINIDISCORD_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
  const user = process.env.MINIDISCORD_USER || 'observer';
  try {
    const login = await fetch(url + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: user }) });
    const cookie = (login.headers.getSetCookie ? login.headers.getSetCookie() : [login.headers.get('set-cookie')]).filter(Boolean).map(c => c.split(';')[0]).join('; ');
    let after = 0, req = 0, total = 0, wait = 0, pending = null;
    for (;;) {
      const r = await fetch(`${url}/api/rooms/${roomId}/messages?after=${after}`, { headers: { cookie } });
      const { messages } = await r.json();
      if (!messages || !messages.length) break;
      for (const m of messages) {
        // 방의 created_at 은 표시 없는 UTC 다 — Z 를 붙이지 않으면 현지 시각으로 읽혀 9시간 어긋난다
        const t = new Date((m.created_at || '').replace(' ', 'T') + 'Z').getTime();
        if (!(t >= since.getTime())) continue;          // --since 이후만 센다 — 방 전체 누적은 세대 비교에 못 쓴다
        total++;
        const b = m.body || '';
        if (b.includes('승인을 요청')) { req++; pending = t; }
        else if (b.includes('승인 전송됨') && pending) { wait += (t - pending) / 60000; pending = null; }
      }
      after = messages[messages.length - 1].id;
    }
    console.log(`\n  도구 승인      사람이 누른 승인 요청 ${req}회 · 누적 대기 ${wait.toFixed(1)}분 · 방 메시지 ${total}건 (${sinceLabel} 이후)`);
    console.log(`                (승인 요청이 한 자릿수를 넘으면 settings.template.json 의 allow 목록과 명령 형태를 다시 본다)\n`);
    save({ approvals: req, approval_wait_min: Number(wait.toFixed(1)), room_messages: total });
  } catch (e) {
    console.log(`\n  도구 승인      못 셈 — 채팅 서버(${url})에 닿지 않는다: ${e.message}\n`);
    save({});
  }
})();
