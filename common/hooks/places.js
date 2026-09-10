// places.js — 훅 셋이 "어디를 보나"를 한 자리에서 정한다.
//
// crew 의 훅은 cwd 가 봇 폴더라는 것을 전제했다 (`path.resolve(cwd,'..','..','..')`).
// prodev 는 그 전제를 뺀다. 봇이 어디서 켜지든 env 로 자리를 찾는다:
//   PRODEV_BOT      봇 이름 → <저장소>/bots/<이름>/
//   PRODEV_PROJECT  과제 폴더 (charter.md · cards/ · wiki/ · journal/ · threads/ 가 있는 자리)
// 시험·검수는 아래 덮어쓰기로 임시 폴더를 가리킨다: PRODEV_BOT_DIR · PRODEV_FIND_LOG · PRODEV_HANDOFF.

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');

function botDir() {
  if (process.env.PRODEV_BOT_DIR) return path.resolve(process.env.PRODEV_BOT_DIR);
  if (process.env.PRODEV_BOT) return path.join(REPO, 'bots', process.env.PRODEV_BOT);
  return null;
}

function projectDir() {
  return process.env.PRODEV_PROJECT ? path.resolve(process.env.PRODEV_PROJECT) : null;
}

function handoffFile() {
  if (process.env.PRODEV_HANDOFF) return path.resolve(process.env.PRODEV_HANDOFF);
  const b = botDir();
  return b ? path.join(b, 'handoff-compact.md') : null;
}

function dbFile() {
  if (process.env.MINIDISCORD_DB) return path.resolve(process.env.MINIDISCORD_DB);
  return path.join(REPO, '..', 'minidiscord', 'server', 'data', 'minidiscord.db');
}

// 방 번호 → 방 이름. DB 가 먼저, 못 열면 봇 폴더의 rooms.json (setup.js 가 쓴다).
// 둘 다 없으면 null — 부르는 쪽이 "모른다" 를 어떻게 다룰지 정한다.
function roomName(chatId) {
  const id = Number(chatId);
  try {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(dbFile(), { readOnly: true });
    const r = db.prepare('SELECT name FROM rooms WHERE id = ?').get(id);
    db.close();
    if (r) return { name: r.name, 출처: 'db' };
  } catch { /* 아래 rooms.json 으로 */ }
  try {
    const b = botDir();
    const j = JSON.parse(fs.readFileSync(path.join(b, 'rooms.json'), 'utf8'));
    const 목록 = Array.isArray(j) ? j : (Array.isArray(j.rooms) ? j.rooms : []);
    const hit = 목록.find(r => Number(r.id) === id);
    if (hit && hit.name) return { name: hit.name, 출처: 'rooms.json' };
  } catch { /* 모른다 */ }
  return null;
}

// "prodev-시험/자료" → { 과제: "prodev-시험", 갈래: "자료" }. 본방은 갈래가 null.
function roomParts(name) {
  const i = String(name || '').indexOf('/');
  if (i < 0) return { 과제: String(name || ''), 갈래: null };
  return { 과제: name.slice(0, i), 갈래: name.slice(i + 1) };
}

module.exports = { REPO, botDir, projectDir, handoffFile, dbFile, roomName, roomParts };
