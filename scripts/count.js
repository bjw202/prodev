#!/usr/bin/env node
// 보낼 글의 분량을 센다 — 봇이 보내기 전에 돌린다.
//
//   node 루트/crew/scripts/count.js <파일>
//   node 루트/crew/scripts/count.js            (글을 stdin 으로 준다)
//
// 세는 법은 common/CLAUDE-common.md 의 "분량" 절에 적힌 것 하나뿐이다. 여기가 그 구현이다.
// 눈으로 센 값은 무효다. 두 세대 연속으로 "짧게 쓰라"가 실패한 자리가 여기다.
//
//   글자 = 문자 수. 공백과 줄바꿈을 넣고, 맨 끝의 계측 줄은 뺀다.
//   줄   = 줄바꿈으로 가른 뒤 빈 줄을 뺀 수. 계측 줄은 뺀다.
//   어절 = 공백으로 갈린 토막. 문장 = 줄바꿈이나 . ! ? 로 갈린 토막.
//
// 계측 줄을 빼는 까닭: 그 줄의 길이가 그 줄에 적을 숫자에 딸린다. 넣고 세면 되돌이가 된다.

const fs = require('fs');

const METER = /\n?\(\s*\d+\s*자\s*·[^)\n]*\)\s*$/;   // 맨 끝의 (N자 · N줄 · 최장 N어절)
const TO = /^@TO\([^)\n]*\)\s*/;                     // 첫머리의 멘션 — 봉투지 글이 아니다

function count(raw) {
  const s = raw.replace(/\s+$/, '').replace(TO, '').replace(METER, '');
  const chars = [...s].length;
  const lines = s.split('\n').filter(l => l.trim()).length;
  const sentences = s.split(/(?<=[.!?])\s+|\n/).map(x => x.trim()).filter(Boolean);
  const eojeol = sentences.map(x => x.split(/\s+/).filter(Boolean).length);
  const longest = eojeol.length ? Math.max(...eojeol) : 0;
  const worst = sentences[eojeol.indexOf(longest)] || '';
  return { chars, lines, longest, worst };
}

function report(raw) {
  const { chars, lines, longest, worst } = count(raw);
  console.log(`(${chars}자 · ${lines}줄 · 최장 ${longest}어절)`);
  console.log();
  console.log(`  봇에게 보내는 글 상한 600자 · 6줄   → ${chars > 600 || lines > 6 ? '넘는다' : '든다'}`);
  console.log(`  사람에게 보내는 글 상한 900자 · 10줄 → ${chars > 900 || lines > 10 ? '넘는다' : '든다'}`);
  if (longest > 25) {
    console.log(`\n  ! 가장 긴 문장이 ${longest}어절이다. 25를 넘으면 그 글은 아직 안 끝난 것이다.`);
    console.log(`    ${worst.slice(0, 100)}${worst.length > 100 ? '…' : ''}`);
  }
  console.log(`\n  맨 윗줄을 글 끝에 그대로 붙인다. 손으로 고쳐 적지 않는다.`);
}

const file = process.argv[2];
if (file) {
  if (!fs.existsSync(file)) { console.error(`파일이 없다: ${file}`); process.exit(1); }
  report(fs.readFileSync(file, 'utf8'));
} else if (!process.stdin.isTTY) {
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => { buf += d; });
  process.stdin.on('end', () => report(buf));
} else {
  console.error('쓰는 법: node scripts/count.js <파일>   또는   글을 stdin 으로 준다');
  process.exit(1);
}
