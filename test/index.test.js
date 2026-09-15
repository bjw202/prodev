// index.js 시험 — fixtures/find 의 카드 12(정상 10 + void 1 + 깨진 머리말 1)로 잰다.
// 기대는 fixtures/README.md 의 index_기대: 표 행 수 11 · errors 1 · next E = E-0011 · exit 1.
//
// index.js 는 과제 폴더에 index.md·index.json 을 쓰므로 fixture 를 그대로 두고
// 임시 폴더에 복사해 거기서 돌린다. fixture 는 읽기만 한다.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { parseFrontmatter } = require('../scripts/index.js');

const ROOT = path.resolve(__dirname, '..');
const INDEX = path.join(ROOT, 'scripts', 'index.js');
const FIXTURE = path.join(__dirname, 'fixtures', 'find');

// fixture 를 임시 폴더로 옮겨 index.js 를 한 번 돌린다. 결과를 여러 시험이 나눠 쓴다.
function build() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prodev-index-'));
  fs.cpSync(FIXTURE, dir, { recursive: true });
  let status = 0, stdout = '';
  try {
    stdout = execFileSync(process.execPath, [INDEX, dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    status = e.status;
    stdout = e.stdout;
  }
  return {
    dir, status, stdout,
    json: JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8')),
    md: fs.readFileSync(path.join(dir, 'index.md'), 'utf8'),
  };
}

const R = build();

// 카드 절의 표에서 머리줄·구분줄을 뺀 진짜 행만 센다.
function cardRows(md) {
  const sec = md.split('\n## 위키')[0];
  return sec.split('\n').filter(l => l.startsWith('| ') && !l.startsWith('| id |'));
}

test('index — 표 행 수가 11 이다 (카드 12 중 깨진 하나를 뺀다)', () => {
  assert.strictEqual(cardRows(R.md).length, 11);
  assert.strictEqual(R.json.cards.length, 11);
  assert.ok(R.md.includes('## 카드 11'));
  // 깨진 카드는 표에 없다
  assert.ok(!R.json.cards.some(c => c.path === 'cards/E-0010.md'));
});

test('index — errors 는 1건이고 그것은 머리말이 안 닫힌 E-0010 이다', () => {
  assert.strictEqual(R.json.errors.length, 1);
  assert.strictEqual(R.json.errors[0].path, 'cards/E-0010.md');
  assert.match(R.json.errors[0].reason, /머리말이 안 닫혔다/);
  assert.ok(R.stdout.includes('cards/E-0010.md'));
});

test('index — errors 가 있으면 exit 1 이다 (그래도 index.md·index.json 은 쓴다)', () => {
  assert.strictEqual(R.status, 1);
  assert.ok(fs.existsSync(path.join(R.dir, 'index.md')));
  assert.ok(fs.existsSync(path.join(R.dir, 'index.json')));
});

test('index — next E 는 E-0011 이다 (깨진 E-0010 도 이름은 센다)', () => {
  assert.strictEqual(R.json.next.E, 'E-0011');
  assert.match(R.stdout, /next E: E-0011/);
  // 이름으로 세므로 머리말을 못 읽은 E-0010 이 번호를 잡아먹지 않는다
  assert.ok(!R.json.cards.some(c => c.id === 'E-0010'));
  assert.strictEqual(R.json.next.R, 'R-0002');
  assert.strictEqual(R.json.next.D, 'D-0002');
  assert.strictEqual(R.json.next.N, 'N-0001');
});

test('index — 머리말 파서: 스칼라 · 리스트 · {k: v} 셋만 읽는다', () => {
  const e7 = R.json.cards.find(c => c.id === 'E-0007');
  // 리스트
  assert.deepStrictEqual(e7.tags, ['수율', '샤워헤드', 'CH-3B']);
  assert.deepStrictEqual(e7.source_msgs, ['405', '409']);
  // 한 줄 map
  assert.deepStrictEqual(e7.conditions, { 장비: 'CH-3B', 부품: 'SH2200-B-0412', 레시피: 'R-12', 로트: '14' });
  // 값의 따옴표는 벗긴다
  assert.strictEqual(R.json.cards.find(c => c.id === 'E-0002').results['단위'], '%');
  // 스칼라 안의 ":" 와 "[]" 는 갈라지지 않는다 — 첫 ": " 뒤는 전부 값이다
  assert.strictEqual(R.json.cards.find(c => c.id === 'D-0001').title, '판정: 원인은 샤워헤드 낱개로 좁힌다 [추정]');
});

test('index — void 카드와 supersedes 를 그대로 싣는다 (find.js 가 따라갈 자리다)', () => {
  const e6 = R.json.cards.find(c => c.id === 'E-0006');
  const e7 = R.json.cards.find(c => c.id === 'E-0007');
  assert.strictEqual(e6.status, 'void');
  assert.strictEqual(e6.supersedes, null);        // 폐기된 쪽은 앞을 가리키지 않는다
  assert.strictEqual(e7.supersedes, 'cards/E-0006.md');   // 대체한 쪽이 뒤를 가리킨다
});

test('index — 위키 2 · inbox 사이드카를 싣는다', () => {
  assert.strictEqual(R.json.wiki.length, 2);
  const y = R.json.wiki.find(w => w.path === 'wiki/yield-recovery.md');
  assert.strictEqual(y.title, '수율 회복');
  assert.ok(y.cards.includes('E-0007'));
  assert.strictEqual(R.json.inbox.length, 1);
  assert.strictEqual(R.json.inbox[0].sidecar, 'inbox/20260825-yield-by-lot/files.md');
});

test('index — next E 하위 명령은 다음 번호 한 줄만 낸다 (과제 폴더는 PRODEV_PROJECT)', () => {
  const run = (dir, args) => execFileSync(process.execPath, [INDEX, 'next', ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PRODEV_PROJECT: dir },
  });
  const three = fs.mkdtempSync(path.join(os.tmpdir(), 'prodev-next-'));
  fs.mkdirSync(path.join(three, 'cards'));
  for (const n of ['E-0001', 'E-0002', 'E-0003']) {
    fs.writeFileSync(path.join(three, 'cards', `${n}.md`), `---\nid: ${n}\nkind: experiment\ntitle: t\nstatus: confirmed\n---\n`);
  }
  assert.strictEqual(run(three, ['E']), 'E-0004\n');
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'prodev-next-'));
  assert.strictEqual(run(empty, ['E']), 'E-0001\n');
  // 색인은 쓰지 않는다
  assert.ok(!fs.existsSync(path.join(three, 'index.json')));
  // 모르는 글자는 쓰는 법을 알리고 exit 1
  assert.throws(() => run(empty, ['X']), e => e.status === 1 && /쓰는 법/.test(e.stderr));
});

test('index — 파서가 안 읽는 YAML 은 조용히 삼키지 않고 알린다', () => {
  assert.throws(() => parseFrontmatter('---\nid: E-1\ntags: [수율, 샤워헤드\n---\n'), /괄호가 안 닫혔다/);
  assert.throws(() => parseFrontmatter('---\nid: E-1\ntags:\n  - 수율\n---\n'), /들여쓴 줄은 읽지 않는다/);
  assert.throws(() => parseFrontmatter('# 머리말 없음\n'), /머리말이 없다/);
  assert.throws(() => parseFrontmatter('---\nid: E-1\n'), /머리말이 안 닫혔다/);
});
