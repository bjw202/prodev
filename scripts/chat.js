#!/usr/bin/env node
// chat.js — minidiscord 대화 기록을 읽기 전용으로 직접 찾는다. 봇도 사람도 쓴다.
//
//   node scripts/chat.js rooms                                방 목록 (번호 · 이름 · 상태 · 글 수)
//   node scripts/chat.js search <말> [--room <번호|이름>] [--speaker <이름>] [--since <ISO>] [--until <ISO>] [--limit N] [--full]
//   node scripts/chat.js around <message_id> [--before N] [--after N] [--full]
//   node scripts/chat.js since <방> <message_id> [--limit N] [--full]     그 번호 다음부터 순서대로
//   node scripts/chat.js tail <방> [N] [--full]                              마지막 N개
//   node scripts/chat.js show <message_id>                                    한 건 전문 + 첨부 경로
//
// 왜 fetch_history 가 아니라 이것인가: fetch_history 는 최근 N 개를 자른 뒤 거른다(밀린 글이 N 을 넘으면 앞을 놓친다)
// 그리고 말로 찾지 못한다. 이 스크립트는 SQLite 를 readOnly 로 열어 전체를 본다. 서버는 켜 둔 채로 된다.
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
  process.stderr.write(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 8).map(l => l.replace(/^\/\/ ?/, '')).join('\n') + '\n');
  process.exit(code);
}

function parseArgs(argv) {
  const pos = []; const opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      if (k === 'full') opt.full = true;
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

function print(rows, full) {
  if (!rows.length) { console.log('(없음)'); return; }
  for (const r of rows) console.log(fmt(r, full));
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
    for (const r of rows) console.log(`${r.id}\t${r.name}\t${r.status}\t${r.n}건\t마지막 #${r.last_id ?? '-'}`);
    return;
  }

  if (cmd === 'search') {
    const q = pos.slice(1).join(' ');
    if (!q) usage(1);
    const where = ['m.body LIKE ? ESCAPE \'\\\'']; const args = ['%' + q.replace(/[\\%_]/g, c => '\\' + c) + '%'];
    const rid = roomId(db, opt.room); if (rid != null) { where.push('m.room_id = ?'); args.push(rid); }
    if (opt.speaker) { where.push('COALESCE(u.username, b.name) = ?'); args.push(opt.speaker); }
    if (opt.since) { where.push('m.created_at >= ?'); args.push(opt.since); }
    if (opt.until) { where.push('m.created_at < ?'); args.push(opt.until); }
    const rows = db.prepare(`${BASE} WHERE ${where.join(' AND ')} ORDER BY m.id DESC LIMIT ?`).all(...args, limit).reverse();
    print(rows, opt.full);
    return;
  }

  if (cmd === 'around') {
    const id = Number(pos[1]); if (!id) usage(1);
    const before = Number(opt.before ?? 10), after = Number(opt.after ?? 10);
    const center = db.prepare(`${BASE} WHERE m.id = ?`).get(id);
    if (!center) { console.log(`#${id} 없음`); return; }
    const rows = db.prepare(`${BASE} WHERE m.room_id = ? AND m.id BETWEEN ? AND ? ORDER BY m.id`).all(center.room_id, id - before * 4, id + after * 4)
      .filter(r => r.id !== id);
    const b = rows.filter(r => r.id < id).slice(-before), a = rows.filter(r => r.id > id).slice(0, after);
    print([...b, center, ...a], opt.full);
    return;
  }

  if (cmd === 'since') {
    const rid = roomId(db, pos[1]); const id = Number(pos[2] ?? 0);
    if (rid == null) usage(1);
    const rows = db.prepare(`${BASE} WHERE m.room_id = ? AND m.id > ? ORDER BY m.id LIMIT ?`).all(rid, id, limit);
    print(rows, opt.full);
    const last = rows[rows.length - 1];
    if (last) console.log(`다음 since: ${last.id}`);
    return;
  }

  if (cmd === 'tail') {
    const rid = roomId(db, pos[1]); const n = Math.min(Number(pos[2] || 20) || 20, 500);
    if (rid == null) usage(1);
    const rows = db.prepare(`${BASE} WHERE m.room_id = ? ORDER BY m.id DESC LIMIT ?`).all(rid, n).reverse();
    print(rows, opt.full);
    return;
  }

  if (cmd === 'show') {
    const id = Number(pos[1]); if (!id) usage(1);
    const row = db.prepare(`${BASE} WHERE m.id = ?`).get(id);
    if (!row) { console.log(`#${id} 없음`); return; }
    console.log(fmt({ ...row, body: '' }, false).replace(/: $/, ''));
    console.log(row.body);
    const att = db.prepare('SELECT id, filename, stored_path, size, mime FROM attachments WHERE message_id = ?').all(id);
    for (const a of att) console.log(`📎 ${a.filename}  (${a.mime}, ${a.size}B)  ${path.resolve(path.dirname(DB), '..', a.stored_path)}`);
    return;
  }

  usage(1);
}

main();
