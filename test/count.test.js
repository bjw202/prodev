// count.js 시험 — VERIFICATION 2절의 네 갈래.
// 기대는 손으로 센 값이다. count.js 의 출력을 그대로 옮겨 적으면 시험이 아무것도 재지 않는다.
//
// 세는 법 (common 규칙 · count.js 머리말):
//   글자 = 문자 수(공백·줄바꿈 넣고). 맨 끝의 계측 줄과 첫머리의 @TO(...)는 뺀다.
//   줄   = 줄바꿈으로 가른 뒤 빈 줄을 뺀 수.
//   어절 = 문장 안 공백으로 갈린 토막. 문장 = 줄바꿈이나 . ! ? 로 갈린 토막.

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { execFileSync } = require('child_process');

const COUNT = path.join(__dirname, '..', 'scripts', 'count.js');

// 첫 줄만 본다. 그 줄이 봇이 글 끝에 붙이는 값이다.
function 첫줄(text) {
  return execFileSync(process.execPath, [COUNT], {
    input: text, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'],
  }).split('\n')[0];
}

test('count — 600자 글: 상한 안이라 "든다"', () => {
  const 글 = '가'.repeat(600);                     // 한 줄 · 공백 없음 → 1어절
  assert.strictEqual(첫줄(글), '(600자 · 1줄 · 최장 1어절)');

  const 전체 = execFileSync(process.execPath, [COUNT], { input: 글, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
  assert.ok(전체.includes('사람에게 보내는 글 상한 900자 · 10줄 → 든다'));
});

test('count — 901자 글: 900자 상한을 하나 넘긴다', () => {
  const 글 = '가'.repeat(901);
  assert.strictEqual(첫줄(글), '(901자 · 1줄 · 최장 1어절)');

  const 전체 = execFileSync(process.execPath, [COUNT], { input: 글, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
  assert.ok(전체.includes('사람에게 보내는 글 상한 900자 · 10줄 → 넘는다'));
  // 딱 900 은 안 넘는다 — 경계가 어디인지 못 박는다
  const 구백 = execFileSync(process.execPath, [COUNT], { input: '가'.repeat(900), encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
  assert.ok(구백.includes('사람에게 보내는 글 상한 900자 · 10줄 → 든다'));
});

test('count — @TO(x) 는 봉투지 글이 아니다. 세지 않는다', () => {
  // "안녕하세요" 다섯 자만 남는다
  assert.strictEqual(첫줄('@TO(prodev-시험-bot) 안녕하세요'), '(5자 · 1줄 · 최장 1어절)');
  // 멘션이 없을 때와 같은 값이어야 한다
  assert.strictEqual(첫줄('안녕하세요'), '(5자 · 1줄 · 최장 1어절)');
  // 글 가운데의 @TO 는 글이다. 첫머리의 것만 봉투다
  // "물어본다 @TO(비서) 봐라" = 4 + 1 + 7 + 1 + 2 = 15자
  assert.strictEqual(첫줄('물어본다 @TO(비서) 봐라'), '(15자 · 1줄 · 최장 3어절)');
});

test('count — 맨 끝의 계측 줄은 세지 않는다 (넣고 세면 되돌이가 된다)', () => {
  const 글 = '안녕하세요\n(5자 · 1줄 · 최장 1어절)';
  assert.strictEqual(첫줄(글), '(5자 · 1줄 · 최장 1어절)');
  // 계측 줄을 붙였다 떼었다 해도 값이 흔들리지 않는다 — 이것이 계측 줄을 빼는 까닭이다
  assert.strictEqual(첫줄(글), 첫줄('안녕하세요'));

  // 여러 줄에서도 줄 수와 최장 어절이 손으로 센 값과 같다
  const 여러줄 = '첫 줄이다.\n둘째 줄은 조금 더 길게 쓴 문장이다.\n\n셋째 줄.';
  assert.strictEqual(첫줄(여러줄), '(35자 · 3줄 · 최장 7어절)');   // 빈 줄은 줄로 안 센다
});
