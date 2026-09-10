#!/usr/bin/env node
// PreCompact 훅 — 문맥이 압축되기 직전에 선다.
//
// 압축 요약은 캐시다. 캐시가 지워져도 일이 이어지려면 **파일**이 남아야 한다.
// 그래서 기록 꼬리를 한 번 읽고 인수인계서 여섯 칸을 파일로 떨군다.
//
//   기록 꼬리(마지막 40턴 · tool_result 300자 · thinking 제외)
//     → claude -p --model sonnet (빈 cwd · PRODEV_HOOK=1 · timeout 180)
//     → <봇 폴더>/handoff-compact.md 여섯 칸
//     → 방에 "정리 중" 한 줄 (알림 계정: 쿠키 md_session + multipart — ADR-018)
//
// 무슨 일이 있어도 **exit 0** 이다 (fail-open). 압축은 우리가 멈출 수 있는 것이 아니고,
// 인수인계서를 못 쓴 채 압축되는 것이 압축을 막는 것보다 낫다. 못 쓴 까닭은 파일에 적는다.
//
// thinking 을 빼는 까닭: 생각은 결론이 아니다. 다음 세션이 남의 반쯤 된 생각을 사실로 읽으면
// 되돌리기 어렵다. tool_result 를 300자로 자르는 까닭: 그 안의 "ok ok ok" 가 칸을 밀어낸다.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const P = require('./places.js');

const 턴수 = 40;
const 결과상한 = 300;
const 칸 = ['하던 일', '방과 마지막 message_id', '사람이 기다리는 것', '미해결 질문', '다음 한 걸음', '열어 둔 파일'];

// ── 기록 꼬리 ─────────────────────────────────────────────

function 꼬리(파일) {
  const 줄 = fs.readFileSync(파일, 'utf8').split('\n').filter(Boolean);
  const 조각 = [];
  for (const l of 줄.slice(-턴수)) {
    let o;
    try { o = JSON.parse(l); } catch { continue; }
    const c = o.message && o.message.content;
    const 누구 = o.type === 'assistant' ? '비서' : '사람/도구';
    if (typeof c === 'string') { 조각.push(`[${누구}] ${c}`); continue; }
    if (!Array.isArray(c)) continue;
    for (const b of c) {
      if (b.type === 'thinking') continue;                        // 생각은 넘기지 않는다
      if (b.type === 'text') 조각.push(`[${누구}] ${b.text}`);
      else if (b.type === 'tool_use') 조각.push(`[도구] ${b.name} ${JSON.stringify(b.input || {}).slice(0, 결과상한)}`);
      else if (b.type === 'tool_result') {
        const s = typeof b.content === 'string' ? b.content : JSON.stringify(b.content);
        조각.push(`[결과] ${s.slice(0, 결과상한)}${s.length > 결과상한 ? ' …(잘림)' : ''}`);
      }
    }
  }
  return 조각.join('\n');
}

function 물음글(기록) {
  return [
    '너는 채팅방 비서의 인수인계서를 쓴다. 아래는 압축 직전 기록의 꼬리다.',
    '다음 여섯 칸을 그대로 된 마크다운 제목(## )으로 쓰고, 칸마다 아는 것만 적어라.',
    '기록에 없는 것은 지어내지 말고 "(모름)" 이라고 적어라. 칸마다 세 줄을 넘기지 마라.',
    '',
    ...칸.map(k => `## ${k}`),
    '',
    '--- 기록 꼬리 ---',
    기록,
  ].join('\n');
}

// ── 요약을 맡길 곳 ────────────────────────────────────────

// 시험·검수용 대역. 진짜 판단은 claude 가 한다 — 이것은 규칙으로 뽑아낸 것이라 어림이다.
// 시험이 정말 재는 것은 이 출력이 아니라 위 물음글에 thinking 이 0건이고 tool_result 가 잘렸는가다.
function 모의요약(기록) {
  const 마지막 = re => { const m = [...기록.matchAll(re)]; return m.length ? m[m.length - 1] : null; };

  const 방들 = new Map();
  for (const m of 기록.matchAll(/\(chat_id (\d+)\)\s*글 #(\d+)/g)) 방들.set(m[1], m[2]);
  const 방줄 = [...방들].map(([r, id]) => `- chat_id ${r} · #${id}`).join('\n') || '- (모름)';

  const 비서말 = [...기록.matchAll(/^\[비서\] (.+)$/gm)].map(m => m[1]);
  const 사람말 = [...기록.matchAll(/^\[사람\/도구\] (\[.+?\].+)$/gm)].map(m => m[1]);
  const 끝비서 = 비서말.length ? 비서말[비서말.length - 1] : '(모름)';
  const 끝사람 = 사람말.length ? 사람말[사람말.length - 1] : '(모름)';

  const 걸음 = 마지막(/다음 한 걸음[:：]\s*([^\n]+)/g);
  const 스킬 = 마지막(/([a-z-]+) 스킬/g);
  const 실 = [...new Set([...기록.matchAll(/threads\/[^\s"'\\]+\.md/g)].map(m => m[0]))];
  const 남은 = 마지막(/남은 질문\s*(\d+)/g);
  const 대기 = 마지막(/([가-힣]{2,4})\s*답 대기/g);

  const 값 = {
    '하던 일': 끝비서,
    '방과 마지막 message_id': 방줄,
    '사람이 기다리는 것': 끝사람,
    '미해결 질문': [남은 ? `남은 질문 ${남은[1]}` : null, 대기 ? `${대기[1]}의 답 대기` : null].filter(Boolean).join(' · ') || '(모름)',
    '다음 한 걸음': [걸음 ? 걸음[1].trim() : null, 스킬 ? `${스킬[1]} 스킬` : null].filter(Boolean).join(' · ') || '(모름)',
    '열어 둔 파일': 실.length ? 실.map(f => `- ${f}`).join('\n') : '(모름)',
  };
  return 칸.map(k => `## ${k}\n${값[k]}`).join('\n\n');
}

function 요약받기(물음) {
  // 시험용: PRODEV_FAKE_CLAUDE=fail 은 요약이 죽는 자리를 만든다 (fail-open 이 정말 도는지 보려고).
  if (process.env.PRODEV_FAKE_CLAUDE === 'fail') return { 글: '', 길: '모의(일부러 실패)' };
  if (process.env.PRODEV_FAKE_CLAUDE === '1') return { 글: 모의요약(물음), 길: '모의(PRODEV_FAKE_CLAUDE=1)' };
  // 빈 cwd 에서 돌린다. 이 세션의 CLAUDE.md·설정이 딸려 들어가면 요약이 아니라 다른 일을 시작한다.
  const 빈곳 = fs.mkdtempSync(path.join(os.tmpdir(), 'prodev-compact-'));
  try {
    const 글 = execFileSync('claude', ['-p', '--model', 'sonnet'], {
      input: 물음, encoding: 'utf8', cwd: 빈곳, timeout: 180000,
      env: { ...process.env, PRODEV_HOOK: '1' },
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    return { 글, 길: 'claude -p --model sonnet' };
  } finally {
    try { fs.rmSync(빈곳, { recursive: true, force: true }); } catch {}
  }
}

// ── 알림 ──────────────────────────────────────────────────

// 방에 "정리 중" 한 줄. 서버가 없거나 토큰이 없으면 조용히 건너뛴다 — 알림 때문에 압축을 붙잡지 않는다.
//
// 보내는 꼴은 사람이 브라우저로 올릴 때와 같다 (ADR-018): 쿠키 md_session + multipart.
// 서버는 Authorization: Bearer 를 아예 읽지 않고(401), 글 올리기 라우트는 multipart 만 읽는다(406).
// 2026-09-10 에 시험 서버로 셋 다 넣어 보고 정한 꼴이다.
// -F 가 아니라 --form-string 이다: -F 는 '@' 로 시작하는 값을 파일 경로로 읽는다.
// 이 글은 '@' 로 시작하지 않지만, cron 줄(@TO…)과 같은 꼴을 쓰는 편이 나중에 베껴 쓸 때 안전하다.
//
// 토큰은 알림 계정(사람 계정)의 세션 쿠키 값이고 env PRODEV_NOTIFY_TOKEN 하나에서 온다.
// 봇 설정(settings.json)의 env 에는 넣지 않는다 — 봇 문맥에 사람 계정의 토큰을 두지 않으려는 것이다.
// 훅은 봇 폴더의 .env 또는 훅을 띄운 실행 환경에서 읽는다.
function 알린다(방번호) {
  const base = process.env.MINIDISCORD_URL;
  const token = process.env.PRODEV_NOTIFY_TOKEN || 봇폴더토큰();
  if (!base || !token || !방번호) return '건너뜀 (서버나 알림 계정이 없다)';
  try {
    execFileSync('curl', ['-sS', '-X', 'POST', `${base.replace(/\/$/, '')}/api/rooms/${방번호}/messages`,
      '-b', `md_session=${token}`,
      '--max-time', '10',
      '--form-string', 'body=문맥을 정리 중입니다. 곧 이어서 합니다.'], { stdio: 'ignore' });
    return '보냄';
  } catch (e) {
    return `못 보냄 (${String(e.message).split('\n')[0]})`;
  }
}

// 봇 폴더의 .env 에서 PRODEV_NOTIFY_TOKEN 을 읽는다. 없으면 null — 알림은 건너뛴다.
function 봇폴더토큰() {
  try {
    const 봇 = P.botDir();
    if (!봇) return null;
    const 줄들 = fs.readFileSync(path.join(봇, '.env'), 'utf8').split('\n');
    for (const l of 줄들) {
      const m = /^\s*PRODEV_NOTIFY_TOKEN\s*=\s*(.*)$/.exec(l);
      if (m) return m[1].trim().replace(/^["']|["']$/g, '') || null;
    }
  } catch {}
  return null;
}

// ── 몸통 ──────────────────────────────────────────────────

function main() {
  const 결과 = { 때: new Date().toISOString(), 까닭: null };
  let 들어온것 = {};
  try { 들어온것 = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch {}

  const 낼곳 = P.handoffFile();
  if (!낼곳) process.exit(0);                       // 어디에 쓸지 모르면 조용히 나간다
  fs.mkdirSync(path.dirname(낼곳), { recursive: true });

  const 기록길 = 들어온것.transcript_path;
  let 본문;
  try {
    if (!기록길 || !fs.existsSync(기록길)) throw new Error(`기록 파일이 없다: ${기록길 || '(안 왔다)'}`);
    const 기록 = 꼬리(기록길);
    const 물음 = 물음글(기록);
    // 무엇을 보냈는지 남긴다 — 인수인계서가 이상할 때 되짚을 자리이고, 시험이 보는 자리다.
    try { fs.writeFileSync(`${낼곳}.input.txt`, 물음); } catch {}
    const { 글, 길 } = 요약받기(물음);
    // 빈 요약은 성공이 아니다. 빈 칸으로 채운 인수인계서가 남는 것이 가장 나쁘다.
    if (!String(글).trim()) throw new Error(`요약이 비었다 (${길})`);
    본문 = [
      `# 인수인계서 (압축 직전 ${결과.때})`,
      `방아쇠: ${들어온것.trigger || '모름'} · 요약: ${길}`,
      '',
      글.trim(),
      '',
    ].join('\n');
  } catch (e) {
    // 못 썼으면 못 썼다고 파일에 적는다. 빈 파일이나 옛 파일이 남는 것이 가장 나쁘다.
    결과.까닭 = String(e.message).split('\n')[0];
    본문 = [
      `# 인수인계서 (압축 직전 ${결과.때})`,
      '',
      `**못 썼다: ${결과.까닭}**`,
      '',
      ...칸.map(k => `## ${k}\n(모름 — 인수인계서를 못 만들었다. 방의 최근 글부터 다시 읽어라)`),
      '',
    ].join('\n');
  }

  try { fs.writeFileSync(낼곳, 본문); } catch {}

  const 방번호 = 들어온것.chat_id || process.env.PRODEV_NOTIFY_ROOM;
  const 알림 = 알린다(방번호);
  try { fs.appendFileSync(`${낼곳}.log`, `${결과.때}\t${결과.까닭 || 'ok'}\t알림:${알림}\n`); } catch {}

  process.exit(0);
}

main();
