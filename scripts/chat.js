#!/usr/bin/env node
// chat.js — minidiscord 대화 기록을 읽기 전용으로 직접 찾는다. 봇도 사람도 쓴다.
//
//   node scripts/chat.js rooms [--json]                       방 목록 (번호 · 이름 · 상태 · 글 수)
//   node scripts/chat.js search <말> [<말> ...] [--room <번호|이름>] [--speaker <이름>] [--since <ISO>] [--until <ISO>] [--limit N] [--full] [--json]
//   node scripts/chat.js around <message_id> [--before N] [--after N] [--full] [--json]
//   node scripts/chat.js since <방> <message_id> [--limit N] [--full] [--json]   그 번호 다음부터 순서대로
//   node scripts/chat.js tail <방> [N] [--full] [--json]                          마지막 N개
//   node scripts/chat.js show <message_id> [--json]                               한 건 전문 + 첨부 경로
//
// 왜 fetch_history 가 아니라 이것인가: fetch_history 는 최근 N 개를 자른 뒤 거른다(밀린 글이 N 을 넘으면 앞을 놓친다)
// 그리고 말로 찾지 못한다. 이 스크립트는 SQLite 를 readOnly 로 열어 전체를 본다. 서버는 켜 둔 채로 된다.
//
// search 는 낱말 여럿을 AND 로 본다: `search 샤워헤드 수율` 은 둘 다 든 글만 낸다.
// 따옴표로 묶은 하나는 그대로 한 덩이다: `search "샤워헤드 교체"` 는 붙어 있는 것만 찾는다.
// 맞대보기 전에 양쪽을 NFC 로 고르고 대소문자를 접는다 (자모가 갈라져 저장된 글도 걸리게).
// 조사 떼기와 하이픈·공백 접기는 여기가 아니라 find.js 가 한다 (ARCHITECTURE 5.3).
//
// DB 위치: MINIDISCORD_DB 환경변수 > 루트/minidiscord/server/data/minidiscord.db (루트 = 이 파일의 두 단계 위의 부모).
// 한 줄 형식: #id  YYYY-MM-DD HH:MM  [방]  이름(TO→받는이): 본문 앞 160자 [📎n]   (--full 이면 본문 전체)
// 시각은 DB 의 UTC 그대로다.

const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.resolve(__dirname, '..', '..');
const DB = process.env.MINIDISCORD_DB || path.join(ROOT, 'minidiscord', 'server', 'data', 'minidiscord.db');

function usage(code) {
  const head = fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 8);
  process.stderr.write(head.map(l => l.replace(/^\/\/ ?/, '')).join('\n') + '\n');
  process.exit(code);
}

// 맞대보기용 꼴. NFC 로 고르고 대소문자를 접는다. 이 함수 하나만이 "같다"의 뜻이다.
function norm(s) {
  return String(s == null ? '' : s).normalize('NFC').toLowerCase();
}

function parseArgs(argv) {
  const pos = []; const opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      if (k === 'full') opt.full = true;
      else if (k === 'json') opt.json = true;
      else { opt[k] = argv[++i]; }
    } else pos.push(a);
  }
  return { pos, opt };
}

function open() {
  if (!fs.existsSync(DB)) { process.stderr.write(`DB 없음: ${DB}\n`); process.exit(2); }
  return new DatabaseSync(DB, { readOnly: true });
}

// 방은 번호로도 이름으로도 받는다. 이름은 정확히 같거나, 하나만 걸리면 앞부분 일치도 받는다.
function roomId(db, key) {
  if (key == null) return null;
  if (/^\d+$/.test(String(key))) return Number(key);
  const exact = db.prepare('SELECT id FROM rooms WHERE name = ?').get(String(key));
  if (exact) return exact.id;
  const like = db.prepare('SELECT id, name FROM rooms WHERE name LIKE ?').all(String(key) + '%');
  if (like.length === 1) return like[0].id;
  process.stderr.write(like.length ? `방 이름이 여럿에 걸린다: ${like.map(r => r.name).join(', ')}\n` : `방 없음: ${key}\n`);
  process.exit(2);
}

const BASE = `
  SELECT m.id, m.room_id, r.name AS room_name, m.author_type, m.body, m.created_at,
         COALESCE(u.username, b.name, '시스템') AS author,
         (SELECT COUNT(*) FROM attachments a WHERE a.message_id = m.id) AS n_att,
         (SELECT GROUP_CONCAT(COALESCE(tb.name, '?') || ':' || t.delivery, ' ')
            FROM message_targets t LEFT JOIN bots tb ON tb.id = t.bot_id WHERE t.message_id = m.id) AS targets
  FROM messages m
  JOIN rooms r ON r.id = m.room_id
  LEFT JOIN users u ON u.id = m.author_user_id
  LEFT JOIN bots b ON b.id = m.author_bot_id`;

function fmt(row, full) {
  const t = (row.created_at || '').replace('T', ' ').slice(0, 16);
  const body = full ? row.body : row.body.replace(/\s+/g, ' ').slice(0, 160) + (row.body.length > 160 ? '…' : '');
  const to = row.targets ? ` (${row.targets})` : '';
  const att = row.n_att ? ` [📎${row.n_att}]` : '';
  return `#${row.id}  ${t}  [${row.room_name}]  ${row.author}${to}: ${body}${att}`;
}

// --json 은 사람 눈이 아니라 다른 스크립트(find.js · 검수)를 위한 것이다. 칸 이름을 바꾸지 않는다.
function json(row) {
  return {
    id: row.id,
    room_id: row.room_id,
    room: row.room_name,
    author: row.author,
    author_type: row.author_type,
    created_at: row.created_at,
    body: row.body,
    attachments: row.n_att,
    targets: row.targets || null,
  };
}

function print(rows, opt) {
  if (opt.json) { console.log(JSON.stringify(rows.map(json), null, 2)); return; }
  if (!rows.length) { console.log('(없음)'); return; }
  for (const r of rows) console.log(fmt(r, opt.full));
  console.log(`— ${rows.length}건`);
}

function main() {
  const { pos, opt } = parseArgs(process.argv.slice(2));
  const cmd = pos[0];
  if (!cmd || cmd === 'help' || cmd === '-h' || cmd === '--help') usage(cmd ? 0 : 1);
  const db = open();
  const limit = Math.min(Number(opt.limit || 50) || 50, 500);

  if (cmd === 'rooms') {
    const rows = db.prepare(`SELECT r.id, r.name, r.status, (SELECT COUNT(*) FROM messages m WHERE m.room_id = r.id) AS n,
      (SELECT MAX(id) FROM messages m WHERE m.room_id = r.id) AS last_id FROM rooms r ORDER BY r.id`).all();
    if (opt.json) {
      console.log(JSON.stringify(rows.map(r => ({ id: r.id, name: r.name, status: r.status, messages: r.n, last_id: r.last_id ?? null })), null, 2));
      return;
    }
    for (const r of rows) console.log(`${r.id}\t${r.name}\t${r.status}\t${r.n}건\t마지막 #${r.last_id ?? '-'}`);
    return;
  }

  if (cmd === 'search') {
    const terms = pos.slice(1).filter(t => t !== '');
    if (!terms.length) usage(1);
    const needles = terms.map(norm);
    // 방·말한이·때는 SQL 이 거르고, 낱말 AND 는 여기서 NFC 로 맞대본다.
    // LIKE 로는 자모가 갈라진 글을 놓치므로 본문 맞대보기를 SQL 에 맡기지 않는다.
    const where = ['1=1']; const args = [];
    const rid = roomId(db, opt.room); if (rid != null) { where.push('m.room_id = ?'); args.push(rid); }
    if (opt.speaker) { where.push('COALESCE(u.username, b.name) = ?'); args.push(opt.speaker); }
    if (opt.since) { where.push('m.created_at >= ?'); args.push(opt.since); }
    if (opt.until) { where.push('m.created_at < ?'); args.push(opt.until); }
    const hits = [];
    // 최근 것부터 훑다가 limit 만큼 차면 멈춘다. 전체를 메모리에 올리지 않는다.
    for (const row of db.prepare(`${BASE} WHERE ${where.join(' AND ')} ORDER BY m.id DESC`).iterate(...args)) {
      const hay = norm(row.body);
      if (needles.every(n => hay.includes(n))) { hits.push(row); if (hits.length >= limit) break; }
    }
    print(hits.reverse(), opt);
    return;
  }

  if (cmd === 'around') {
    const id = Number(pos[1]); if (!id) usage(1);
    const before = Number(opt.before ?? 10), after = Number(opt.after ?? 10);
    const center = db.prepare(`${BASE} WHERE m.id = ?`).get(id);
    if (!center) {
      if (opt.json) { console.log('[]'); return; }
      console.log(`#${id} 없음`); return;
    }
    const rows = db.prepare(`${BASE} WHERE m.room_id = ? AND m.id BETWEEN ? AND ? ORDER BY m.id`).all(center.room_id, id - before * 4, id + after * 4)
      .filter(r => r.id !== id);
    const b = rows.filter(r => r.id < id).slice(-before), a = rows.filter(r => r.id > id).slice(0, after);
    print([...b, center, ...a], opt);
    return;
  }

  if (cmd === 'since') {
    const rid = roomId(db, pos[1]); const id = Number(pos[2] ?? 0);
    if (rid == null) usage(1);
    const rows = db.prepare(`${BASE} WHERE m.room_id = ? AND m.id > ? ORDER BY m.id LIMIT ?`).all(rid, id, limit);
    print(rows, opt);
    const last = rows[rows.length - 1];
    if (last && !opt.json) console.log(`다음 since: ${last.id}`);
    return;
  }

  if (cmd === 'tail') {
    const rid = roomId(db, pos[1]); const n = Math.min(Number(pos[2] || 20) || 20, 500);
    if (rid == null) usage(1);
    const rows = db.prepare(`${BASE} WHERE m.room_id = ? ORDER BY m.id DESC LIMIT ?`).all(rid, n).reverse();
    print(rows, opt);
    return;
  }

  if (cmd === 'show') {
    const id = Number(pos[1]); if (!id) usage(1);
    const row = db.prepare(`${BASE} WHERE m.id = ?`).get(id);
    if (!row) {
      if (opt.json) { console.log('null'); return; }
      console.log(`#${id} 없음`); return;
    }
    const att = db.prepare('SELECT id, filename, stored_path, size, mime FROM attachments WHERE message_id = ?').all(id);
    const paths = att.map(a => ({ id: a.id, filename: a.filename, mime: a.mime, size: a.size, path: path.resolve(path.dirname(DB), '..', a.stored_path) }));
    if (opt.json) { console.log(JSON.stringify({ ...json(row), attachments: paths }, null, 2)); return; }
    console.log(fmt({ ...row, body: '' }, false).replace(/: $/, ''));
    console.log(row.body);
    for (const a of paths) console.log(`📎 ${a.filename}  (${a.mime}, ${a.size}B)  ${a.path}`);
    return;
  }

  usage(1);
}

main();
