// peek.js 시험 — csv · xlsx · pdf · jpg 각 1건. 표본은 test/fixtures/peek/ 에 있다 (prodev 가 작게 만든 것).
// 규격은 ARCHITECTURE 6.1 의 "행 · 열 · 5행".
// 도우미(openpyxl · pdfplumber · pdftotext)가 없는 자리에서도 죽지 않는 것이 끝 조건이라
// 마지막 두 건은 "못 읽었다" 길이 실제로 나오는지를 잰다.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PEEK = path.join(ROOT, 'scripts', 'peek.js');
const S = f => path.join(__dirname, 'fixtures', 'peek', f);

function run(file, ...args) {
  return execFileSync(process.execPath, [PEEK, file, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}
const look = file => JSON.parse(run(file, '--json'));

test('peek csv — 형식 · 120행 · 열 7 · 앞 5행', () => {
  const r = look(S('sample.csv'));
  assert.strictEqual(r.형식, 'CSV (쉼표)');
  assert.strictEqual(r.행, 120);
  assert.strictEqual(r.열, 7);
  assert.deepStrictEqual(r.열이름, ['lot_id', 'date', 'line', 'chamber', 'yield_pct', 'defect_count', 'particle_defects']);
  assert.strictEqual(r.앞행.length, 5);
  assert.strictEqual(r.앞행[0].length, 7);
  assert.strictEqual(r.빈칸, 0);

  const out = run(S('sample.csv'));
  assert.match(out, /행 수: 120/);
  assert.match(out, /열 7: lot_id · date/);
  assert.match(out, /앞 5행:/);
});

test('peek xlsx — 시트 둘 · 첫 시트 60행 · 열 7 · 앞 5행', () => {
  const r = look(S('sample.xlsx'));
  assert.match(r.형식, /^XLSX \(시트 2\)/);
  assert.deepStrictEqual(r.시트.map(s => s.이름), ['수율', '설비이력']);
  assert.strictEqual(r.행, 60);
  assert.strictEqual(r.열, 7);
  assert.strictEqual(r.앞행.length, 5);
  assert.strictEqual(r.시트[1].행, 12);
  assert.match(run(S('sample.xlsx')), /시트 "설비이력": 12행/);
});

test('peek pdf — 쪽 수를 낸다 (글은 있는 도구로, 없으면 쪽 수만)', () => {
  const r = look(S('sample.pdf'));
  assert.strictEqual(r.형식, 'PDF');
  assert.strictEqual(r.쪽, 1);                       // 쪽 수는 라이브러리 없이 센다
  // 글은 pdfplumber > pdftotext 차례. 둘 다 없으면 못 읽었다고 말하되 죽지 않는다.
  if (r.글) assert.ok(['pdfplumber', 'pdftotext'].includes(r.길));
  else assert.match(r.못읽은것, /글은 못 읽었다/);
  assert.match(run(S('sample.pdf')), /쪽 수: 1/);
});

test('peek jpg — 320 × 240', () => {
  const r = look(S('sample.jpg'));
  assert.strictEqual(r.형식, 'JPEG 그림');
  assert.strictEqual(r.너비, 320);
  assert.strictEqual(r.높이, 240);
  assert.match(run(S('sample.jpg')), /크기: 320 × 240/);
});

test('peek — 모르는 형식과 없는 파일에 죽지 않는다 (한 줄 내고 exit 0)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prodev-peek-'));
  const bin = path.join(dir, 'x.bin');
  fs.writeFileSync(bin, Buffer.from([0, 1, 2, 3]));

  const out = run(bin);
  assert.match(out, /못 읽었다: 읽는 법을 모르는 형식이다/);

  const missing = run(path.join(dir, '없다.csv'));
  assert.match(missing, /못 읽었다: 파일이 없다/);

  // exit 0 인지 — execFileSync 는 0 이 아니면 던진다. 위 두 줄이 던지지 않은 것이 그 증거다.
  assert.doesNotThrow(() => run(bin));
});
