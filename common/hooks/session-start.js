#!/usr/bin/env node
// SessionStart 훅 (startup | resume | clear | compact).
//
// 켜질 때마다 "파일이 진실이다" 를 다시 싣는다. 앞 문맥과 압축 요약은 캐시다.
// 순서는 ARCHITECTURE 6.4 그대로 — 급한 것부터다:
//   1 handoff-compact.md (압축 직후면 이것이 가장 최신이다)
//   2 charter.md          누가 PL 인가
//   3 schedule.md         언제까지인가
//   4 threads/*           열린 실 전부. 하던 말이 어디서 끊겼나
//   5 어제 일지
//   6 index.md 머리 30줄  무엇이 쌓여 있나
//   7 마지막 일지 날짜    며칠 비었나
//
// crew 의 훅은 cwd 가 봇 폴더라는 것을 전제했다. 여기서는 뺐다 — 자리는 places.js 가 env 로 찾는다.
// 실패해도 세션을 막지 않는다 (fail-open). 다만 **없음 · 못 읽음 · 잘림을 말로 가른다**:
// 없는 것과 못 읽은 것은 다르고, 비서가 그 둘을 같게 다루면 없는 자료를 있다고 여긴다.

const fs = require('fs');
const path = require('path');
const P = require('./places.js');

const 상한 = { handoff: 60, charter: 40, schedule: 40, thread: 25, journal: 60, index: 30 };

// 파일 하나를 상한 줄까지. { text, status: ok|missing|unreadable|truncated }
function 읽는다(파일, 최대) {
  if (!파일 || !fs.existsSync(파일)) return { text: null, status: 'missing' };
  let 줄;
  try { 줄 = fs.readFileSync(파일, 'utf8').replace(/\s+$/, '').split(/\r?\n/); }
  catch { return { text: null, status: 'unreadable' }; }
  if (줄.length <= 최대) return { text: 줄.join('\n'), status: 'ok' };
  return { text: 줄.slice(0, 최대).join('\n') + `\n… (${줄.length - 최대}줄 더 있음 — 파일을 직접 읽어라)`, status: 'truncated' };
}

// 절 하나. 없으면 왜 없는지 적는다 — 빈 절과 없는 절을 가르기 위해서다.
function 절(제목, 파일, 최대, 없을때) {
  const r = 읽는다(파일, 최대);
  if (r.status === 'missing') return 없을때 ? `## ${제목}\n(없음 — ${없을때})` : null;
  if (r.status === 'unreadable') return `## ${제목}\n(있으나 못 읽음: ${파일} — 직접 열어 보라)`;
  return `## ${제목}${r.status === 'truncated' ? ' (앞부분만 · 잘림)' : ''}\n${r.text}`;
}

function 어제() {
  const d = new Date(Date.now() - 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function 일지날짜들(과제) {
  try {
    return fs.readdirSync(path.join(과제, 'journal'))
      .filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).map(f => f.slice(0, 10)).sort();
  } catch { return []; }
}

function main() {
  let 들어온것 = {};
  try { 들어온것 = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch {}
  const 깨어남 = 들어온것.source || 'startup';
  const 봇 = process.env.PRODEV_BOT || '(이름 모름)';
  const 과제 = P.projectDir();

  const 조각 = [`[깨어남: ${깨어남}] 나는 ${봇}다. 앞 문맥과 요약은 캐시다 — 아래 파일이 진실이다.`];

  if (!과제) {
    조각.push('과제 폴더를 모른다 (PRODEV_PROJECT 가 비었다). 봉투의 방 이름 앞머리가 과제 이름이다 — 사람에게 자리를 물어라.');
    낸다(조각);
    return;
  }
  조각.push(`과제 폴더: ${과제}`);

  // 1 인수인계서 — 압축 직후면 이것이 가장 최신이다
  조각.push(절('인수인계서 (handoff-compact.md)', P.handoffFile(), 상한.handoff,
    '압축된 적이 없거나 봇 폴더를 모른다'));

  // 2 헌장 · 3 일정
  조각.push(절('헌장 (charter.md)', path.join(과제, 'charter.md'), 상한.charter,
    '아직 발의하지 않았다. charter 스킬부터'));
  조각.push(절('일정 (schedule.md)', path.join(과제, 'schedule.md'), 상한.schedule,
    '아직 일정이 없다'));

  // 4 열린 실 전부 — 하나라도 빠지면 그 실은 잊힌다
  const 실폴더 = path.join(과제, 'threads');
  let 실 = [];
  try { 실 = fs.readdirSync(실폴더).filter(f => f.endsWith('.md')).sort(); } catch {}
  if (!실.length) {
    조각.push('## 열린 실 (threads/)\n(없음 — 지금 붙들고 있는 실이 없다)');
  } else {
    조각.push(`## 열린 실 (threads/) ${실.length}개`);
    for (const f of 실) 조각.push(절(`threads/${f}`, path.join(실폴더, f), 상한.thread, null));
  }

  // 5 어제 일지
  조각.push(절(`어제 일지 (journal/${어제()}.md)`, path.join(과제, 'journal', `${어제()}.md`), 상한.journal,
    '어제는 안 썼거나 어제 일한 적이 없다'));

  // 6 색인 머리
  조각.push(절('색인 머리 (index.md)', path.join(과제, 'index.md'), 상한.index,
    'index.js 를 아직 안 돌렸다'));

  // 7 마지막 일지 날짜 — 며칠 비었는지가 "무엇을 놓쳤나" 의 첫 실마리다
  const 날짜 = 일지날짜들(과제);
  if (!날짜.length) {
    조각.push('## 마지막 일지\n(없음 — 일지를 한 번도 안 썼다)');
  } else {
    const 끝 = 날짜[날짜.length - 1];
    const 빈날 = Math.floor((Date.now() - Date.parse(`${끝}T00:00:00Z`)) / 86400000);
    조각.push(`## 마지막 일지\n${끝} (${빈날}일 전) · 일지 ${날짜.length}개`);
  }

  낸다(조각);
}

function 낸다(조각) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 조각.filter(Boolean).join('\n\n') },
  }));
}

main();
