#!/usr/bin/env node
// PreToolUse 훅 — 봇이 `mcp__minidiscord-channel__reply` 를 부르기 직전에 선다.
//
// 막을 때는 **exit 2 + stderr 에 이유 한 줄**. 그 한 줄을 봇이 읽고 스스로 고친다.
// 통과는 exit 0, 아무 말도 하지 않는다.
//
// 보는 차례는 ARCHITECTURE 8절 표 그대로다. 앞의 것이 걸리면 뒤는 보지 않는다:
//   1 chat_id 없음
//   2 분량 — count.js 로 센다 (900자 · 10줄)
//   3 자료 방이면 확정 다섯 조건 (ADR-008. 어휘는 봉투를 벗긴 본문의 맨 앞에서 본다)
//   4 보고 방 발송이면 결재 글 작성자 = charter 의 PL
//   5 index.json 의 errors > 0
//
// 왜 여기서 세나: 지침으로 "짧게 쓰라"는 두 세대 연속 실패했다. 세는 것과 막는 것은 기계가 한다.
// DB 를 못 열면 자료 방만 fail-closed 다 — 확정을 확인할 길이 없는데 자료 방에 쓰는 것이
// 이 저장소에서 가장 되돌리기 어려운 일이기 때문이다. 다른 방은 통과시킨다.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const P = require('./places.js');

const 상한 = { 자: 900, 줄: 10 };
const 확정어휘 = /^(확정|맞다|맞습니다|그대로|OK)(?![가-힣A-Za-z0-9])/;
// 사람 글은 언제나 봉투로 시작한다 — "@TO(비서) 확정". 어휘를 보기 전에 봉투를 벗긴다.
// 안 벗기면 확정이 영영 안 된다 (R2 재생 들이기 #19 에서 실제로 막혔다. ADR-008 보충).
const 봉투 = /^(\s*@(?:TO|CC)\([^)]*\)\s*)+/;
const 봉투벗기기 = 글 => String(글 == null ? '' : 글).trim().replace(봉투, '').trim();
const 카드번호 = /\b([ERDN]-\d{4})\b/;

function 막는다(이유) {
  process.stderr.write(이유.replace(/\s+/g, ' ').trim() + '\n');
  process.exit(2);
}

function db() {
  const { DatabaseSync } = require('node:sqlite');
  return new DatabaseSync(P.dbFile(), { readOnly: true });
}

// count.js 하나가 "몇 자인가"의 뜻이다. 여기서 다시 세지 않는다 — 두 곳에서 세면 언젠가 갈린다.
function 센다(text) {
  const out = execFileSync(process.execPath, [path.join(P.REPO, 'scripts', 'count.js')], {
    input: text, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], timeout: 20000,
  });
  const m = out.match(/\((\d+)자 · (\d+)줄/);
  if (!m) throw new Error('count.js 출력을 못 읽었다');
  return { 자: Number(m[1]), 줄: Number(m[2]) };
}

// ── 확정 다섯 조건 (ADR-008) ──────────────────────────────
// confirmed_at 글이
//   ① author_type='user'  ② 같은 과제의 /들이기 방  ③ 본문이 확정 어휘로 시작
//   ④ source_msgs 전부보다 뒤 + 직전 봇 글에 같은 카드 번호  ⑤ 카드 status: valid
function 확정검사(카드id, 과제이름) {
  const proj = P.projectDir();
  if (!proj) return '과제 폴더를 모른다 (PRODEV_PROJECT 가 없다)';

  const 카드길 = path.join(proj, 'cards', `${카드id}.md`);
  if (!fs.existsSync(카드길)) return `카드 파일이 없다: cards/${카드id}.md`;

  let 머리말;
  try {
    ({ data: 머리말 } = require(path.join(P.REPO, 'scripts', 'index.js')).parseFrontmatter(fs.readFileSync(카드길, 'utf8')));
  } catch (e) {
    return `${카드id} 의 머리말을 못 읽었다: ${e.message}`;
  }

  // ⑤ 먼저 본다 — 가장 싸고, draft 면 나머지를 볼 것도 없다
  if (String(머리말.status) !== 'valid') return `${카드id} 는 아직 status: ${머리말.status} 다. valid 여야 자료 방에 쓴다`;

  const 확정번호 = Number(머리말.confirmed_at);
  if (!머리말.confirmed_at || 머리말.confirmed_at === 'none' || !Number.isFinite(확정번호)) {
    return `${카드id} 에 confirmed_at 이 없다. 과제원이 "확정"이라 한 글 번호가 있어야 한다`;
  }

  let 글, 방, 직전봇;
  try {
    const d = db();
    글 = d.prepare('SELECT id, room_id, author_type, body FROM messages WHERE id = ?').get(확정번호);
    if (글) {
      방 = d.prepare('SELECT name FROM rooms WHERE id = ?').get(글.room_id);
      직전봇 = d.prepare("SELECT id, body FROM messages WHERE room_id = ? AND id < ? AND author_type = 'bot' ORDER BY id DESC LIMIT 1")
        .get(글.room_id, 확정번호);
    }
    d.close();
  } catch (e) {
    return `확정을 확인할 수 없다 (DB 를 못 열었다: ${e.message})`;
  }

  if (!글) return `${카드id} 의 confirmed_at #${확정번호} 글이 DB 에 없다`;

  // ①
  if (글.author_type !== 'user') return `${카드id} 의 확정 글 #${확정번호} 은 사람이 쓴 것이 아니다 (author_type: ${글.author_type})`;
  // ②
  const 갈래 = P.roomParts(방 && 방.name).갈래;
  if (갈래 !== '들이기' || P.roomParts(방.name).과제 !== 과제이름) {
    return `${카드id} 의 확정 글 #${확정번호} 이 ${과제이름}/들이기 방이 아니다 (${방 ? 방.name : '방 모름'})`;
  }
  // ③ 봉투를 벗긴 본문의 맨 앞이 확정 어휘여야 한다
  const 알맹이 = 봉투벗기기(글.body);
  if (!확정어휘.test(알맹이)) {
    return `${카드id} 의 확정 글 #${확정번호} 이 확정 어휘로 시작하지 않는다 ("${알맹이.slice(0, 20)}")`;
  }
  // ④
  const 출처 = [].concat(머리말.source_msgs || []).map(Number).filter(Number.isFinite);
  const 마지막출처 = 출처.length ? Math.max(...출처) : 0;
  if (확정번호 <= 마지막출처) return `${카드id} 의 확정 #${확정번호} 이 자료가 올라온 글 #${마지막출처} 보다 앞선다`;
  if (!직전봇 || !String(직전봇.body).includes(카드id)) {
    return `${카드id} 의 확정 #${확정번호} 직전 봇 글${직전봇 ? ` #${직전봇.id}` : ''} 에 ${카드id} 가 없다. 무엇을 확정했는지 알 수 없다`;
  }
  return null;
}

// ── 보고 방 결재 ──────────────────────────────────────────
function 결재검사(text) {
  const proj = P.projectDir();
  const 헌장 = proj && path.join(proj, 'charter.md');
  if (!헌장 || !fs.existsSync(헌장)) return '헌장(charter.md)이 없어 결재자를 대조할 수 없다';
  const m = fs.readFileSync(헌장, 'utf8').match(/^PL:\s*(.+)$/m);
  if (!m) return 'charter.md 에 PL 이 없다';
  const PL = m[1].trim();

  const 표식 = text.match(/결재\s*#(\d+)/);
  if (!표식) return `발송인데 결재 글 번호가 없다. "결재 #<번호>" 로 ${PL} 의 결재 글을 가리켜야 한다`;

  let 글;
  try {
    const d = db();
    글 = d.prepare(`SELECT m.id, m.author_type, COALESCE(u.username, b.name) AS 이름
                    FROM messages m LEFT JOIN users u ON u.id = m.author_user_id
                    LEFT JOIN bots b ON b.id = m.author_bot_id WHERE m.id = ?`).get(Number(표식[1]));
    d.close();
  } catch (e) {
    return `결재를 확인할 수 없다 (DB 를 못 열었다: ${e.message})`;
  }
  if (!글) return `결재 글 #${표식[1]} 이 DB 에 없다`;
  if (글.author_type !== 'user') return `결재 글 #${표식[1]} 은 사람이 쓴 것이 아니다`;
  if (글.이름 !== PL) return `결재 글 #${표식[1]} 의 작성자는 ${글.이름} 인데 헌장의 PL 은 ${PL} 이다`;
  return null;
}

// ── 몸통 ──────────────────────────────────────────────────

function main() {
  let 들어온것 = {};
  try { 들어온것 = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { process.exit(0); }
  const 입력 = 들어온것.tool_input || {};
  const chatId = 입력.chat_id;
  const text = String(입력.text ?? '');

  // 1 chat_id
  if (chatId === undefined || chatId === null || String(chatId).trim() === '') {
    막는다('chat_id 가 없다. reply 에는 언제나 chat_id 를 붙인다 — 어느 방에 쓰는지 봉투에만 있다');
  }

  // 2 분량
  try {
    const { 자, 줄 } = 센다(text);
    if (자 > 상한.자 || 줄 > 상한.줄) {
      막는다(`분량이 넘는다 (${자}자 · ${줄}줄, 상한 ${상한.자}자 · ${상한.줄}줄). 파일로 옮기고 경로를 줘라`);
    }
  } catch (e) {
    // 세지 못하면 막지 않는다. 세는 도구가 고장 났다고 답을 못 하게 하지는 않는다.
  }

  const 방 = P.roomName(chatId);
  const 갈래 = 방 ? P.roomParts(방.name).갈래 : null;
  const 과제 = 방 ? P.roomParts(방.name).과제 : null;

  // 3 자료 방
  if (갈래 === '자료') {
    const m = text.match(카드번호);
    if (!m) 막는다('자료 방 글에 카드 번호가 없다. 무엇을 올리는지 E-0001 처럼 밝혀야 한다');
    const 이유 = 확정검사(m[1], 과제);
    if (이유) 막는다(이유);
  } else if (!방) {
    // 방을 모르는데 DB 도 rooms.json 도 없다. 자료 방일 수 있으나 가려낼 길이 없다 —
    // 여기서 전부 막으면 봇이 아무 말도 못 하므로 통과시키고, 자료 방만 fail-closed 로 둔다 (ADR-008).
  }

  // 4 보고 방 발송
  if (갈래 === '보고' && /\[발송\]|발송합니다|발송한다/.test(text)) {
    const 이유 = 결재검사(text);
    if (이유) 막는다(이유);
  }

  // 5 색인 오류
  const proj = P.projectDir();
  if (proj) {
    const idx = path.join(proj, 'index.json');
    if (fs.existsSync(idx)) {
      try {
        const j = JSON.parse(fs.readFileSync(idx, 'utf8'));
        if ((j.errors || []).length) {
          막는다(`색인에 오류가 ${j.errors.length}건 있다 (${j.errors[0].path}). index.js 를 고쳐 돌린 뒤에 쓴다`);
        }
      } catch { /* 색인을 못 읽는 것으로 답을 막지는 않는다 */ }
    }
  }

  process.exit(0);
}

main();
