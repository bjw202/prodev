#!/usr/bin/env node
// SessionStart 훅 (startup | resume | clear | compact).
// 봇이 깨어날 때 "현재 방"의 내 상태 파일을 문맥에 다시 싣는다.
// 방은 봇 폴더의 `current-room` 파일(한 줄)이 정한다 — 공통 규칙 "상태 파일" 참조.
// 실패해도 세션을 막지 않는다 (fail-open): 없음·못 읽음·잘림을 구분해 알린다.

const fs = require('fs');
const path = require('path');

// 루트 = crew 의 부모. 봇의 cwd 는 루트/crew/bots/<봇>/ 이므로 세 단계 위. (시험용 덮어쓰기: CREW_ROOMS)
const rootOf = cwd => path.resolve(cwd, '..', '..', '..');
const LIMITS = { handoff: 20, notes: 60, state: 200, prior: 40, memory: 50 };

// 파일 한 개를 상한 줄 수까지 읽는다. 결과: { text, status: ok|missing|unreadable|truncated }
function readLines(file, max) {
  if (!fs.existsSync(file)) return { text: null, status: 'missing' };
  let lines;
  try { lines = fs.readFileSync(file, 'utf8').replace(/\s+$/, '').split(/\r?\n/); }
  catch { return { text: null, status: 'unreadable' }; }
  if (lines.length <= max) return { text: lines.join('\n'), status: 'ok' };
  return { text: lines.slice(0, max).join('\n') + `\n… (${lines.length - max}줄 더 있음 — 파일을 직접 읽어라)`, status: 'truncated' };
}

// 절 하나를 만든다. 없으면 이유를 적는다 — 빈 절과 없는 절을 구분하기 위해.
function section(title, file, max, whenMissing) {
  const r = readLines(file, max);
  if (r.status === 'missing') return whenMissing ? `## ${title}\n(없음 — ${whenMissing})` : null;
  if (r.status === 'unreadable') return `## ${title}\n(있으나 못 읽음: ${file} — 직접 열어 보라)`;
  return `## ${title}${r.status === 'truncated' ? ' (앞부분만)' : ''}\n${r.text}`;
}

function main() {
  let input = {};
  try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch {}
  const cwd = input.cwd || process.cwd();
  const bot = path.basename(cwd);
  const ROOMS = process.env.CREW_ROOMS || path.join(rootOf(cwd), 'rooms');
  const source = input.source || 'startup';

  const parts = [`[깨어남: ${source}] 나는 ${bot}이다. 앞 문맥과 요약은 캐시다 — 아래 파일이 진실이다.`];

  let room = '';
  try { room = fs.readFileSync(path.join(cwd, 'current-room'), 'utf8').split(/\r?\n/)[0].trim(); } catch {}
  if (!room) {
    parts.push('현재 방 기록이 없다. 다음 메시지의 방(meta.room_name)을 확인해 current-room 파일에 쓰고, 그 방의 내 상태 파일부터 읽어라.');
  } else {
    const roomDir = path.join(ROOMS, room);
    parts.push(`현재 방(잠정): ${room} — 들어온 메시지의 방과 다르면 메시지 쪽을 따르고 current-room 을 고쳐라.`);
    if (bot === 'orchestrator') {
      parts.push(section('state.md', path.join(roomDir, 'orchestrator', 'state.md'), LIMITS.state, '이 방에서 첫 사건이거나 open-room 전이다'));
    } else {
      const handoffFile = path.join(roomDir, bot, 'handoff.md');
      parts.push(section('handoff.md', handoffFile, LIMITS.handoff, '이 방에서 첫 작업이다'));
      // handoff 의 "task: N" 으로 작업 노트를 찾아 싣는다 — 압축 뒤 진행을 잇는 파일이다.
      const h = readLines(handoffFile, LIMITS.handoff);
      const m = h.text && h.text.match(/^task:\s*(\d+)/m);
      if (m) parts.push(section(`task-${m[1]}-notes.md`, path.join(roomDir, bot, `task-${m[1]}-notes.md`), LIMITS.notes, '아직 노트가 없다 — 배분 원문부터'));
    }
    const k = section('00-prior-knowledge.md', path.join(roomDir, 'archivist', '00-prior-knowledge.md'), LIMITS.prior, null);
    if (k) parts.push(k);
  }

  const mem = section('memory.md', path.join(cwd, 'memory.md'), LIMITS.memory, null);
  if (mem) parts.push(mem);

  // 환경 점검 — 명령이 안 풀리면 봇이 원인을 모른 채 "command not found" 만 보고 헤맨다.
  // setup.js 가 PATH 를 못 박지만 다른 PC·다른 기동 방법에서는 어긋날 수 있어 깨어날 때마다 본다.
  // 멀쩡하면 아무 말도 하지 않는다 — 문맥을 축내지 않기 위해서다.
  const env = envWarning();
  if (env) parts.push(env);

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: parts.filter(Boolean).join('\n\n') }
  }));
}

// PATH 에서 꼭 필요한 명령이 풀리는지 본다. 멀쩡하면 null.
function envWarning() {
  const need = process.platform === 'win32' ? ['git.exe', 'node.exe'] : ['git', 'ls', 'cat', 'grep', 'sed'];
  const exts = process.platform === 'win32' ? ['', '.exe', '.cmd'] : [''];
  const dirs = (process.env.PATH || '').split(path.delimiter);
  const missing = need.filter(n => !dirs.some(d => exts.some(e => {
    try { fs.accessSync(path.join(d, n + e), fs.constants.X_OK); return true; } catch { return false; }
  })));
  if (!missing.length) return null;
  const lit = dirs.filter(d => d.includes('$') || d.includes('%'));
  return [
    `## 환경 경고 — 명령을 찾을 수 없다: ${missing.join(', ')}`,
    `PATH 폴더 ${dirs.length}개에 이 명령들이 없다. 그대로 부르면 "command not found" 로 끝난다.`,
    lit.length ? `PATH 에 펼쳐지지 않은 변수 참조가 있다: ${lit.join(', ')} — 설정의 env 값은 셸을 거치지 않는다.` : '',
    '이것은 네가 고칠 수 있는 자리가 아니다. 일을 멈추지 말고, 지금 회차의 보고 "못 확인한 것"에 이 줄을 적고',
    '사람에게 권한 요청으로 올려라: crew/setup.js 를 다시 돌리면 봇 설정의 PATH 가 다시 계산된다.',
  ].filter(Boolean).join('\n');
}

main();
