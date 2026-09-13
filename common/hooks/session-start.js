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
//   8 house.md            이 과제에서 이 사람과 일하는 방식 (ADR-032)
//
// 여덟째만 성격이 다르다. 앞 일곱은 전부 **이 과제의 사실**이고 house.md 는 **규칙**이다.
// 사실은 자동으로 늘어도 되지만(틀리면 다음 것이 덮는다) 규칙은 한 번 들어가면 그 뒤 모든 판에
// 작용하므로 사람이 세운다. 그래서 상한이 50줄이다 — 새 규칙을 넣으려면 낡은 규칙을 빼야 한다.
// 장치를 더 만들지 않고 **숫자 하나로** 규칙의 폭주를 막는 자리다.
//
// crew 의 훅은 cwd 가 봇 폴더라는 것을 전제했다. 여기서는 뺐다 — 자리는 places.js 가 env 로 찾는다.
// 압축 직후(source: compact)에는 방에 "정리가 끝났습니다" 한 줄을 올린다 (ADR-018 보충).
// 실패해도 세션을 막지 않는다 (fail-open). 다만 **없음 · 못 읽음 · 잘림을 말로 가른다**:
// 없는 것과 못 읽은 것은 다르고, 비서가 그 둘을 같게 다루면 없는 자료를 있다고 여긴다.

const fs = require('fs');
const path = require('path');
const P = require('./places.js');

const 상한 = { handoff: 60, charter: 40, schedule: 40, thread: 25, journal: 60, index: 30, house: 50 };

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
function 절(제목, 파일, 최대, 없을때, 미리읽은) {
  const r = 미리읽은 || 읽는다(파일, 최대);
  if (r.status === 'missing') return 없을때 ? `## ${제목}\n(없음 — ${없을때})` : null;
  if (r.status === 'unreadable') return `## ${제목}\n(있으나 못 읽음: ${파일} — 직접 열어 보라)`;
  return `## ${제목}${r.status === 'truncated' ? ' (앞부분만 · 잘림)' : ''}\n${r.text}`;
}

// 일지 파일 이름의 날짜는 **로컬 달력**이다 — 봇이 `date` 로 오늘을 알고 그 이름으로 쓴다.
// 그래서 이 파일에서 날짜를 다루는 자리는 전부 로컬 달력 하나로 센다 (아래 날수차 도 같다).
const 날짜글 = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function 어제() {
  return 날짜글(new Date(Date.now() - 86400000));
}

// 'YYYY-MM-DD' 가 오늘로부터 며칠 전인가. **달력 하루는 시각의 차가 아니라 날짜의 차다.**
// 예전에는 `Date.now() - Date.parse(끝 + 'T00:00:00Z')` 를 24시간으로 나눴는데, 그것은
// UTC 자정을 기준으로 재는 셈이라 시차만큼 하루가 어긋났다 — 한국(UTC+9)에서는 자정부터
// 오전 9시 사이에 어제 일지가 '0일 전' 으로 나왔다 (2026-09-13 00:11 KST 에 시험이 붉어져 알았다).
// 양쪽을 로컬 자정으로 맞춰 놓고 날짜만 센다. round 로 나눠 DST 로 23·25시간이 된 날에도 정수가 나온다.
function 날수차(날짜문자열) {
  const 오늘0시 = new Date(); 오늘0시.setHours(0, 0, 0, 0);
  const [y, m, d] = 날짜문자열.split('-').map(Number);
  const 그날0시 = new Date(y, m - 1, d);            // 로컬 자정으로 읽는다 ('Z' 를 붙이지 않는다)
  return Math.round((오늘0시 - 그날0시) / 86400000);
}

function 일지날짜들(과제) {
  try {
    return fs.readdirSync(path.join(과제, 'journal'))
      .filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).map(f => f.slice(0, 10)).sort();
  } catch { return []; }
}

// 압축 직후 알림 하나 때문에 async 다 (places.js 의 알린다 가 fetch 를 쓴다 — 까닭은 거기 적었다).
// additionalContext 는 그 전에 이미 stdout 으로 나가므로, 알림이 늦어도 세션이 뜨는 것을 막지 않는다.
async function main() {
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
    조각.push(`## 마지막 일지\n${끝} (${날수차(끝)}일 전) · 일지 ${날짜.length}개`);
  }

  // 8 이 과제의 규칙 (house.md)
  // 잘렸을 때 **조용히 죽으면 안 된다.** 잘린 자리부터는 봇이 있는 줄도 모르는 규칙이고,
  // 봇은 모르는 것을 못 지킨다. 그래서 훅이 이미 아는 것(truncated)을 말만 시킨다 — 새 장치가 없다.
  // 줄이는 것은 사람이 한다. 봇이 스스로 줄이면 사람이 세운 규칙을 봇이 지우는 것이 된다.
  const 규칙길 = path.join(과제, 'house.md');
  const 규칙 = 읽는다(규칙길, 상한.house);
  조각.push(절('이 과제의 규칙 (house.md)', 규칙길, 상한.house,
    '아직 굳은 규칙이 없다. 사람이 "앞으로 이렇게 해" 라고 말하면 여기에 적는다', 규칙));
  if (규칙.status === 'truncated') {
    조각.push(`**첫 답에 이것부터 사람에게 말하라**: 규칙 파일(house.md)이 ${상한.house}줄을 넘어 뒷부분이 안 실렸다. ` +
      '잘린 자리부터는 지금 내가 보지 못하는 규칙이다. 무엇을 뺄지 사람에게 고르게 하고 **스스로 줄이지 마라.**');
  }

  낸다(조각);

  // 압축 **직후**에만 방에 한 줄 (ADR-018 보충). 압축 뒤에는 사람이 말을 걸어야 이어서 하므로,
  // 사람이 그 시점을 알아야 한다. 껐다 켠 경우(startup·resume·clear)에는 올리지 않는다 —
  // 서버가 놓친 글을 재배달하니 사람이 따로 할 일이 없다 (R5 에서 두 번 확인).
  //
  // additionalContext 를 낸 **뒤**에 보낸다. 알림이 늦거나 실패해도 세션이 뜨는 것을 막지 않는다.
  if (깨어남 === 'compact') {
    const 결과 = await P.알린다('정리가 끝났습니다. 이어서 하려면 말을 걸어 주세요.', P.알릴방(들어온것.chat_id));
    try { fs.appendFileSync(`${P.handoffFile()}.log`, `${new Date().toISOString()}\tsession-start\t알림:${결과}\n`); } catch {}
  }
}

function 낸다(조각) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 조각.filter(Boolean).join('\n\n') },
  }));
}

// async 가 된 뒤로는 던진 것이 unhandled rejection 이 되어 exit 1 이 된다. 이 훅이 죽으면
// 헌장·일정·일지가 안 실린 채 세션이 뜬다 — 그것을 오류로 알려야 하므로 stderr 에 한 줄 남기고
// 0 으로 끝낸다 (세션은 막지 않는다).
main().catch(e => {
  try { process.stderr.write(`session-start: ${(e && e.message) || e}\n`); } catch {}
  process.exit(0);
});
