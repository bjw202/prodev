// find.js 시험 — fixtures/find/questions.json 의 물음 13 + 조사 변형 3 + 없는 것 2 = 18건.
// 물음 하나가 test() 하나다. 기대(층·경로)는 meta 가 준 questions.json 에만 있고 여기 베껴 적지 않는다.
//
// 재는 법 (ADR-016 · ADR-026):
//   1~5층 — 층이 정확히 같고, 답이 기대 경로 하나여야 한다.
//   6층(대화) — 층이 정확히 같고, 기대 #id 가 결과 안에 있으면 된다 (여러 건이 나오는 층이다).
//   없는 것 — 층이 null 이고 결과가 비어야 한다. "예산 감광액" 이 여기 있다 (ADR-027 의 거짓 양성).
//
// 6층(대화)은 fixtures/chat/minidiscord.db 를 MINIDISCORD_DB 로 가리켜 chat.js 를 부른다.
// find.log 는 PRODEV_FIND_LOG 로 임시 파일에 받는다 (봇 폴더를 더럽히지 않는다).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const FIND = path.join(ROOT, 'scripts', 'find.js');
const INDEX = path.join(ROOT, 'scripts', 'index.js');
const FIXTURE = path.join(__dirname, 'fixtures', 'find');
const CHAT_DB = path.join(__dirname, 'fixtures', 'chat', 'minidiscord.db');

const QUESTIONS = JSON.parse(fs.readFileSync(path.join(FIXTURE, 'questions.json'), 'utf8'));
const CASES = [
  ...QUESTIONS['물음'].map(c => ({ ...c, 갈래: '물음' })),
  ...QUESTIONS['조사_변형'].map(c => ({ ...c, 갈래: '조사' })),
  ...QUESTIONS['없는_것'].map(c => ({ ...c, 갈래: '없는것' })),
];

// 과제 폴더를 임시로 짓고 색인을 한 번 돌린 뒤, 18건을 한 번씩 물어 답을 모은다.
function askAll() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prodev-find-'));
  fs.cpSync(FIXTURE, dir, { recursive: true });
  const log = path.join(dir, 'find.log');
  const env = { ...process.env, MINIDISCORD_DB: CHAT_DB, PRODEV_FIND_LOG: log, PRODEV_PROJECT: dir };
  try {
    execFileSync(process.execPath, [INDEX, dir], { encoding: 'utf8', stdio: 'ignore' });
  } catch { /* 깨진 카드 하나 때문에 exit 1 이다. 색인은 쓰였다 */ }

  const answers = new Map();
  for (const c of CASES) {
    const out = execFileSync(process.execPath, [FIND, ...c.q.split(/\s+/), '--json'], {
      encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'ignore'],
    });
    answers.set(c.q, JSON.parse(out));
  }
  return { dir, log, answers };
}

const R = askAll();

for (const c of CASES) {
  const 기대 = c.layer === null ? '없음' : `${c.layer}층 ${c.path}`;
  test(`find [${c.갈래}] "${c.q}" → ${기대}`, () => {
    const r = R.answers.get(c.q);
    const paths = r.hits.map(h => h.path);

    if (c.layer === null) {
      assert.strictEqual(r.layer, null, `없어야 하는데 ${r.layer}층에서 ${paths.join(', ')} 가 나왔다`);
      assert.deepStrictEqual(paths, []);
      return;
    }

    assert.strictEqual(r.layer, c.layer, `층이 다르다 — 기대 ${c.layer}, 실제 ${r.layer} (${paths.join(', ')})`);

    if (c.layer === 6) {
      // 대화 층은 여러 건이 나온다. 차례 규칙을 두지 않았으므로 "들어 있다" 로 잰다 (ADR-016).
      assert.ok(paths.includes(c.path), `${c.path} 가 결과에 없다 — ${paths.join(', ')}`);
      assert.ok(paths.length <= 10, `대화 층 상한 10을 넘었다 — ${paths.length}건`);
      return;
    }

    // 1~5층은 하나로 좁혀져야 한다
    assert.deepStrictEqual(paths, [c.path]);
  });
}

test('find — void 카드는 대체한 카드로 바뀌어 나오고, 폐기된 쪽은 결과에 없다', () => {
  for (const q of ['샤워헤드 교체 후 수율', '샤워헤드초판']) {
    const paths = R.answers.get(q).hits.map(h => h.path);
    assert.ok(paths.includes('cards/E-0007.md'), `${q}: E-0007 이 없다`);
    assert.ok(!paths.includes('cards/E-0006.md'), `${q}: 폐기된 E-0006 이 그대로 나왔다`);
  }
  // 어느 카드를 따라왔는지 자취를 남긴다
  assert.strictEqual(R.answers.get('샤워헤드초판').hits[0].via, 'E-0006');
});

test('find — find.log 에 물음마다 한 줄, 모두 18줄', () => {
  const lines = fs.readFileSync(R.log, 'utf8').split('\n').filter(Boolean);
  assert.strictEqual(lines.length, 18);
  const 이름 = new Map();
  for (const l of lines) {
    const [when, layer, name, n, top] = l.split('\t');
    assert.match(when, /^\d{4}-\d{2}-\d{2}T/);
    assert.match(layer, /^[1-6-]$/);        // 못 찾으면 "-"
    // 층 번호 옆에 층 이름 칸이 있다. 번호만 남기면 옛 로그의 "4" 와 새 로그의 "4" 가
    // 다른 뜻이 되어 주간 계측이 조용히 어긋난다 (ADR-026).
    assert.ok(name && !/^\d+$/.test(name), `층 이름 칸이 비었거나 숫자다 — ${JSON.stringify(l)}`);
    if (layer === '-') assert.strictEqual(name, '-');
    if (이름.has(layer)) assert.strictEqual(name, 이름.get(layer), `같은 층에 이름이 둘이다 — ${layer}`);
    이름.set(layer, name);
    assert.match(n, /^\d+$/);
    assert.ok(top);
  }
  assert.strictEqual(new Set(이름.values()).size, 이름.size, '층마다 이름이 달라야 한다');

  // 답한 층이 실제로 남는다 — 읽힘 지표의 바탕이다 (ARCHITECTURE 5.3)
  const 층 = lines.map(l => l.split('\t')[1]);
  // 1층 7 (물음 4 + 조사 변형 3) · 2층 2 · 3층 2 · 4층 3 · 5층 1 · 6층 1 · 못 찾음 2
  assert.deepStrictEqual(
    ['1', '2', '3', '4', '5', '6', '-'].map(n => 층.filter(x => x === n).length),
    [7, 2, 2, 3, 1, 1, 2],
  );
});
