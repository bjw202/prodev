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

// ── 알림 (ADR-018) ────────────────────────────────────────
//
// 훅 둘이 방에 한 줄을 올린다: 압축 **직전**(pre-compact)과 압축 **직후**(session-start).
// 두 곳이 같은 계정 · 같은 꼴 · 같은 방을 써야 하므로 여기 한 자리에 둔다.
// 두 곳에 따로 적으면 언젠가 갈리고, 갈리면 한쪽만 조용히 안 나간다 (이미 두 번 겪었다).

const { execFileSync } = require('child_process');

// 어느 방에 알리나. 앞의 것이 있으면 뒤는 안 본다.
//   1 PRODEV_NOTIFY_ROOM        사람이 못 박은 자리
//   2 힌트                       봉투의 chat_id 같은 것 (PreCompact 입력에는 없다)
//   3 인수인계서의 "방과 마지막 message_id" 절 첫 chat_id   하던 방이 있으면 거기가 맞다
//   4 rooms.json 의 본방          이름에 갈래(/…)가 없는 방 하나
// 못 찾으면 null — 부르는 쪽이 알림을 건너뛴다. 아무 방에나 던지지 않는다.
function 알릴방(힌트) {
  if (process.env.PRODEV_NOTIFY_ROOM) return String(process.env.PRODEV_NOTIFY_ROOM);
  if (힌트 !== undefined && 힌트 !== null && String(힌트).trim() !== '') return String(힌트);

  try {
    const h = handoffFile();
    if (h && fs.existsSync(h)) {
      const 절 = /##\s*방과 마지막 message_id([\s\S]*?)(?:\n##|$)/.exec(fs.readFileSync(h, 'utf8'));
      if (절) {
        const m = /chat_id\s*[:=]?\s*(\d+)/.exec(절[1]);
        if (m) return m[1];
      }
    }
  } catch { /* 인수인계서가 없거나 못 읽는다. 다음 자리로 */ }

  try {
    const b = botDir();
    if (b) {
      const j = JSON.parse(fs.readFileSync(path.join(b, 'rooms.json'), 'utf8'));
      const 본방 = (j.rooms || []).find(r => r && r.name && roomParts(r.name).갈래 === null);
      if (본방 && 본방.id != null) return String(본방.id);
    }
  } catch { /* 없으면 null */ }

  return null;
}

// 알림 계정의 세션 쿠키. env 가 먼저, 없으면 봇 폴더의 .env.
// 봇 설정(settings.json)의 env 에는 두지 않는다 — 사람 계정의 토큰을 봇 문맥에 두지 않으려는 것이다.
function 알림토큰() {
  if (process.env.PRODEV_NOTIFY_TOKEN) return process.env.PRODEV_NOTIFY_TOKEN;
  try {
    const b = botDir();
    if (!b) return null;
    for (const l of fs.readFileSync(path.join(b, '.env'), 'utf8').split('\n')) {
      const m = /^\s*PRODEV_NOTIFY_TOKEN\s*=\s*(.*)$/.exec(l);
      if (m) return m[1].trim().replace(/^["']|["']$/g, '') || null;
    }
  } catch { /* 없다 */ }
  return null;
}

// 방에 한 줄. 서버가 받는 꼴은 쿠키 md_session + multipart 뿐이다 (ADR-018).
// -F 가 아니라 --form-string 이다: -F 는 '@' 로 시작하는 값을 파일 경로로 읽는다.
// 알림 때문에 훅을 붙잡지 않는다 — 못 보내면 까닭 한 줄을 돌려주고 끝낸다 (fail-open).
function 알린다(글, 방번호) {
  const base = process.env.MINIDISCORD_URL;
  const token = 알림토큰();
  if (!base) return '건너뜀 (MINIDISCORD_URL 이 없다)';
  if (!token) return '건너뜀 (알림 계정 토큰이 없다)';
  if (!방번호) return '건너뜀 (어느 방인지 모른다)';
  try {
    execFileSync('curl', ['-sS', '-X', 'POST', `${base.replace(/\/$/, '')}/api/rooms/${방번호}/messages`,
      '-b', `md_session=${token}`, '--max-time', '10', '--form-string', `body=${글}`], { stdio: 'ignore' });
    return '보냄';
  } catch (e) {
    return `못 보냄 (${String(e.message).split('\n')[0]})`;
  }
}

module.exports = { REPO, botDir, projectDir, handoffFile, dbFile, roomName, roomParts, 알릴방, 알림토큰, 알린다 };
