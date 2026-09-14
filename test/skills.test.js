// 스킬 본문이 설계와 같은가를 기계로 본다 (VERIFICATION 3절 B 층의 자동화되는 부분).
//
// 여기서 재는 것은 **글자**다. 봇이 실제로 그렇게 행동하는지는 대본이 잰다 (C 층).
// 그래도 값을 한다: 스킬 본문은 PR 이라야 고쳐지므로, 규격이 본문에서 빠지면
// 그 뒤로는 아무도 그것을 요구하지 않게 된다. 빠진 것을 여기서 잡는다.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SKILLS = path.join(ROOT, '.claude', 'skills');
const 읽는다 = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const 스킬 = 이름 => 읽는다(path.join('.claude', 'skills', 이름, 'SKILL.md'));

const 도메인 = ['charter', 'intake', 'find', 'research', 'analysis', 'schedule', 'brief', 'journal',
  'retro', 'patent', 'paper', 'report', 'review', 'close'];

// ── 있는가 ────────────────────────────────────────────────

test('스킬 — 도메인 열넷 + 오케스트레이터가 제자리에 있다 (ADR-034 · 036)', () => {
  const 있는것 = fs.readdirSync(SKILLS).filter(d => fs.statSync(path.join(SKILLS, d)).isDirectory()).sort();
  assert.deepStrictEqual(있는것, [...도메인, 'prodev-orchestrator'].sort());
  assert.strictEqual(도메인.length, 14);
});

test('스킬 — 머리말의 name 이 폴더 이름과 같고 description 이 비지 않았다', () => {
  for (const 이름 of [...도메인, 'prodev-orchestrator']) {
    const 본문 = 스킬(이름);
    const m = /^---\n([\s\S]*?)\n---/.exec(본문);
    assert.ok(m, `${이름}: 머리말이 없다`);
    assert.match(m[1], new RegExp(`^name: ${이름}$`, 'm'), `${이름}: name 이 폴더와 다르다`);
    const d = /^description: (.+)$/m.exec(m[1]);
    assert.ok(d && d[1].length > 40, `${이름}: description 이 없거나 너무 짧다`);
  }
});

// ── 분기표 (오케스트레이터) ───────────────────────────────

test('오케스트레이터 — 새 줄 셋이 있고 순서가 맞다', () => {
  const 표 = 스킬('prodev-orchestrator');
  const 자리 = k => 표.indexOf(k);

  // 굳는 길은 맨 위 가까이 — "앞으로" 는 어느 일 중에도 나오므로 다른 줄에 먼저 잡히면 안 된다
  assert.ok(자리('"앞으로"') > 0, '굳는 길 줄이 없다');
  assert.ok(자리('"앞으로"') < 자리('`intake`'), '굳는 길이 들이기보다 아래다');

  // analysis 는 find 보다 위 — "유의한가" 는 물음표가 붙어도 찾을 것이 아니라 낼 것이다
  assert.ok(자리('| `analysis` |') > 0, 'analysis 줄이 없다');
  assert.ok(자리('| `analysis` |') < 자리('| `find` |'), 'analysis 가 find 보다 아래다');

  // retro 는 brief 보다 위 — "이번 주 어땠어" 가 현황 브리핑으로 새면 회고가 안 돈다
  assert.ok(자리('| `retro` |') > 0, 'retro 줄이 없다');
  assert.ok(자리('| `retro` |') < 자리('| `brief` |'), 'retro 가 brief 보다 아래다');
});

test('오케스트레이터 — 굳는 길 절이 범위 되묻기 · "이번에는" · 머리 셋을 다 말한다 (ADR-035)', () => {
  const 표 = 스킬('prodev-orchestrator');
  assert.ok(표.includes('범위를 한 줄로 되묻는다'), '범위를 되묻는 걸음이 없다');
  assert.ok(표.includes('"이번에는" 은 굳히지 않는다'), '한 번의 예외를 막는 줄이 없다');
  for (const 자리 of ['house.md', 'templates/', 'analysis/methods/']) {
    assert.ok(표.includes(자리), `굳는 자리가 빠졌다: ${자리}`);
  }
  for (const 것 of ['언제부터', '누가', '무엇을 보고']) {
    assert.ok(표.includes(것), `되돌리기 위한 칸이 빠졌다: ${것}`);
  }
  // 관찰형은 세지 않는다
  assert.ok(표.includes('세지 않는다'), '관찰형을 세지 않는다는 줄이 없다');
});

// ── 트리거 (말이 어느 스킬의 것인가) ──────────────────────

test('트리거 — 새 스킬 둘의 부르는 말이 description 에 있다', () => {
  const a = 스킬('analysis');
  for (const 말 of ['분석해 줘', '갈리는지', '검정', 'Cpk', '공정능력', '회귀', 'DOE']) {
    assert.ok(a.includes(말), `analysis 트리거가 빠졌다: ${말}`);
  }
  const r = 스킬('retro');
  for (const 말 of ['돌아봐', '개선할 거 없어', '이번 주 어땠어', '반복되는 거']) {
    assert.ok(r.includes(말), `retro 트리거가 빠졌다: ${말}`);
  }
});

test('트리거 — 새 스킬의 고유한 말이 다른 스킬 description 과 겹치지 않는다', () => {
  const 고유 = { analysis: ['Cpk', '공정능력', 'DOE'], retro: ['회고', '돌아봐'] };
  for (const [주인, 말들] of Object.entries(고유)) {
    for (const 이름 of [...도메인, 'prodev-orchestrator']) {
      if (이름 === 주인 || 이름 === 'prodev-orchestrator') continue;
      const d = /^description: (.+)$/m.exec(스킬(이름));
      for (const 말 of 말들) {
        assert.ok(!d[1].includes(말), `${이름} 의 description 이 ${주인} 의 말을 가로챈다: ${말}`);
      }
    }
  }
});

test('트리거 — retro 와 brief · journal 이 서로를 가리켜 갈래를 가른다', () => {
  const r = /^description: (.+)$/m.exec(스킬('retro'))[1];
  assert.ok(r.includes('journal') && r.includes('brief'), 'retro 가 이웃 스킬을 안 가린다');
});

// ── analysis 규격 (ADR-034) ───────────────────────────────

test('analysis — run.md 여섯 칸이 순서대로 다 있다', () => {
  const a = 스킬('analysis');
  const 칸 = ['## 1. 무엇을 알고 싶은가', '## 2. 어떤 가정을 깔았나', '## 3. 코드', '## 4. 숫자 + 검증치',
    '## 5. 물리적 해석', '## 6. 이 해석을 뒤집을 수 있는 것'];
  const 자리 = 칸.map(k => a.indexOf(k));
  for (let i = 0; i < 칸.length; i++) assert.ok(자리[i] >= 0, `칸이 빠졌다: ${칸[i]}`);
  assert.deepStrictEqual(자리, [...자리].sort((x, y) => x - y), '칸 순서가 설계와 다르다');
});

test('analysis — 3번 칸이 seed 와 라이브러리 판을 요구한다 (재현성 검수가 여기 기댄다)', () => {
  const a = 스킬('analysis');
  assert.ok(a.includes('seed'), 'seed 를 요구하지 않는다');
  assert.ok(/python <판>|python 판|꾸러미> <판>/.test(a), '라이브러리 판을 요구하지 않는다');
  assert.ok(a.includes('재현성'), '왜 필요한지를 말하지 않는다');
});

test('analysis — 카드가 선택이 아니고, 왜 그런지(찾기 층에 없다)를 말한다', () => {
  const a = 스킬('analysis');
  assert.ok(a.includes('선택이 아니다'), '카드가 선택이 아니라는 말이 없다');
  assert.ok(a.includes('찾기 층'), '왜 카드가 필요한지(층에 없다)를 말하지 않는다');
  assert.ok(a.includes('index.js next E'), '카드 번호를 어떻게 받는지 없다');
});

test('analysis — 관문은 모형 고르기 한 자리뿐이다', () => {
  const a = 스킬('analysis');
  assert.ok(a.includes('유일한 관문'), '유일한 관문이라는 말이 없다');
  assert.ok(a.includes('코드를 짜는 데는 관문이 없다'), '코드에 관문이 없다는 말이 없다');
  // 사람이 정하는 자리가 둘을 넘지 않는다 — 물음이 늘면 이 비서가 하려는 일의 반대다
  const 절 = a.slice(a.indexOf('## 사람이 정하는 자리'), a.indexOf('## 부르는 것'));
  assert.ok(절.split('\n').filter(l => l.startsWith('- ')).length <= 2, '사람이 정하는 자리가 셋 이상이다');
});

test('analysis — 다시 시키면 새 폴더를 만들지 않는다 (v3 의 한 줄 목표)', () => {
  const a = 스킬('analysis');
  assert.ok(a.includes('새 폴더를 만들지 않는다'), '앞 것을 다시 쓰라는 말이 없다');
  assert.ok(a.includes('그대로 다시 돌린다'), '있는 run.py 를 다시 돌리라는 말이 없다');
});

test('analysis — 이미지 계측은 겹친 그림을 같이 내고, 꾸러미가 없으면 지어내지 않는다', () => {
  const a = 스킬('analysis');
  assert.ok(a.includes('겹친 그림'), '이미지 계측의 겹친 그림 요구가 없다');
  assert.ok(a.includes('지어내지 않는다'), '꾸러미가 없을 때의 규칙이 없다');
});

test('analysis — 측정법마다 템플릿을 만들지 않는다 (스킬은 고정 · 방법은 데이터)', () => {
  const a = 스킬('analysis');
  assert.ok(a.includes('측정법마다 템플릿을 미리 만들지도 않는다') || a.includes('측정법마다 템플릿'),
    '템플릿을 안 만든다는 줄이 없다');
  assert.ok(a.includes('analysis/methods/'), '굳는 자리를 안 가리킨다');
});

// ── retro 규격 (ADR-036 · 037) ────────────────────────────

test('retro — 보고 넷이 다 있다', () => {
  const r = 스킬('retro');
  for (const 것 of ['되풀이된 것', '막힌 것', '굳힐 후보', '스킬이나 에이전트가 필요해 보이는 것']) {
    assert.ok(r.includes(것), `보고가 빠졌다: ${것}`);
  }
});

test('retro — 근거 없는 항목은 쓰지 않는다. 봇이 패턴을 지어내는 것이 가장 큰 위험이다', () => {
  const r = 스킬('retro');
  assert.ok(r.includes('근거 없는 항목은 쓰지 않는다'), '근거 규칙이 없다');
  assert.ok(r.includes('지어내는 것'), '왜 그런지를 말하지 않는다');
  for (const 근거 of ['일지 날짜', 'find.log', '카드 번호']) {
    assert.ok(r.includes(근거), `근거 갈래가 빠졌다: ${근거}`);
  }
});

test('retro — 넷째에 판별 넷이 관문으로 걸려 있다 (ADR-037)', () => {
  const r = 스킬('retro');
  for (const 물음 of ['숫자', '타이밍', '문맥 격리', '만들지 않는다']) {
    assert.ok(r.includes(물음), `판별이 빠졌다: ${물음}`);
  }
  assert.ok(r.includes('데이터로는 왜 안 되는가'), '데이터로 안 되는 까닭을 요구하지 않는다');
  assert.ok(r.includes('없으면') || r.includes('"없음"'), '통과한 것이 없을 때의 답이 없다');
});

test('retro — 제안 글에 원본 경로 · 바꿀 문장 · 까닭 셋을 요구한다', () => {
  const r = 스킬('retro');
  for (const 것 of ['원본 경로', '바꿀 문장', '까닭']) {
    assert.ok(r.includes(것), `제안의 칸이 빠졌다: ${것}`);
  }
});

test('retro — 봇은 제안까지고 만드는 것은 사람이다. 대화 DB 없이도 돈다', () => {
  const r = 스킬('retro');
  assert.ok(r.includes('제안까지만'), '봇이 어디까지 하는지 안 적혔다');
  assert.ok(r.includes('대화 DB 가 없어도 돈다'), '대화 층 없이 도는지 안 적혔다');
  assert.ok(/cron 은 없다/.test(r), 'cron 이 없다는 것을 말하지 않는다 — 사람이 부르는 스킬이다');
});

// ── 명령 꼴 (조종석 W2r — 승인 카드 31건이 전부 Bash 묶음이었다) ─────

test('명령 꼴 — analysis · research · intake 는 python 을 run.py 로, reviewer 는 WebFetch 로', () => {
  const 문장 = 'python 은 `run.py` 파일에 쓰고 `python3 run.py` 로 돌린다. 히어독 · `-c` 인라인 · `for` 반복문 · 세미콜론 묶음은 쓰지 않는다(승인 카드가 뜬다).';
  for (const 이름 of ['analysis', 'research', 'intake']) {
    assert.ok(스킬(이름).includes(문장), `${이름}: 명령 꼴 문장이 없다`);
  }
  const r = 읽는다(path.join('.claude', 'agents', 'reviewer.md'));
  assert.match(/^tools: (.+)$/m.exec(r)[1], /\bWebFetch\b/, 'reviewer 도구에 WebFetch 가 없다');
  assert.ok(r.includes('`curl` 은 쓰지 않는다'), 'reviewer 가 curl 을 막지 않는다');
});

// ── intake 확정 청하기 (확정 조건 ④ — T3M · W2r · M5.M 에서 세 번 막혔다) ─────

test('intake — 카드 번호를 밝힌 뒤 확정을 청한다 (조건 ④ 는 직전 봇 글의 카드 번호를 본다)', () => {
  const i = 스킬('intake');
  const 문장 = i.indexOf('카드 번호를 밝힌 뒤 확정을 청한다');
  assert.ok(문장 >= 0, '번호를 먼저 밝히라는 문장이 없다');
  assert.ok(i.includes('같은 글'), '번호와 청하는 말을 한 글에 두라는 말이 없다');
  assert.ok(i.indexOf('index.js next E') < 문장 + 200, '번호를 어디서 받는지 청하는 자리 곁에 없다');
});

// ── report · journal 고리 ─────────────────────────────────

test('report — templates/ 를 넷의 순서로 보고, 둘 이상이면 사람이 고른다 (ADR-035)', () => {
  const r = 스킬('report');
  assert.ok(r.includes('ls templates/'), 'templates/ 를 보지 않는다');
  assert.ok(r.includes('사람이 고른다. 봇이 고르지 않는다'), '둘 이상일 때 봇이 고를 수 있다');
  assert.ok(r.indexOf('사람이 이번에 준 포맷 파일') < r.indexOf('`templates/` 에 **하나**'),
    '이번 첨부가 templates/ 보다 뒤다');
  assert.ok(r.includes('청한다'), '아무것도 없을 때 청하는 길이 사라졌다');
});

test('journal — 되풀이된 말 절이 있고, 세지 않는다고 못 박는다 (관찰형의 입구)', () => {
  const j = 스킬('journal');
  assert.ok(j.includes('## 되풀이된 말'), '일지 골격에 자리가 없다');
  assert.ok(j.includes('다섯 갈래'), '갈래 수가 안 맞다');
  assert.ok(j.includes('세지 않는다'), '세지 않는다는 말이 없다');
  assert.ok(j.includes('retro'), '누가 읽는지 안 적혔다');
  assert.ok(j.includes('지어내지 않는다'), '없을 때 채우지 말라는 말이 없다');
});

test('journal — 방 하나 판에서도 계측이 읽는 두 절을 남긴다 (ADR-021 · ADR-039)', () => {
  const j = 스킬('journal');
  for (const 절 of ['## 방마다 마지막 글', '## 카드 없는 첨부']) {
    assert.ok(j.includes(절), `일지 골격에 절이 없다: ${절}`);
  }
  assert.ok(j.includes('방이 하나여도 두 절은 남긴다'), '방 하나일 때 절을 빼지 말라는 말이 없다');
});

// ── CLAUDE.md (ADR-035) ───────────────────────────────────

test('CLAUDE.md — 굳는 길 한 줄이 있고 40줄 안이다 (N5)', () => {
  const c = 읽는다('CLAUDE.md');
  const 줄 = c.replace(/\s+$/, '').split(/\r?\n/);
  assert.ok(줄.length <= 40, `비서 지침이 ${줄.length}줄이다 (N5: 40줄 안)`);

  const 한줄 = 줄.find(l => l.startsWith('- 사람이 "앞으로"'));
  assert.ok(한줄, '굳는 길 줄이 없다');
  for (const 자리 of ['house.md', 'templates/', 'analysis/methods/']) {
    assert.ok(한줄.includes(자리), `굳는 자리가 빠졌다: ${자리}`);
  }
  assert.ok(한줄.includes('범위를 한 줄 되묻고'), '범위 되묻기가 빠졌다');
  assert.ok(한줄.includes('"이번에는" 은 굳히지 않는다'), '한 번의 예외를 막는 말이 빠졌다');
});
