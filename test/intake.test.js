// intake-copy.js 시험 — 0층은 불변이다. 같은 이름이 다시 오면 덮지 않고 새 판(.v2)이 된다.
// 사이드카 files.md 의 꼴은 fixture find/inbox/20260825-yield-by-lot/files.md 와 같다:
// "# 파일" · 파일마다 "## <이름>" · 요약 줄 · 열/뜻/단위 표 · "SHA-256: …".

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const INTAKE = path.join(ROOT, 'scripts', 'intake-copy.js');
const SRC = path.join(__dirname, 'fixtures', 'peek', 'sample.csv');

function project() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'prodev-intake-'));
}
function take(proj, ...files) {
  const out = execFileSync(process.execPath, [INTAKE, 'yield-by-lot', ...files, '--project', proj, '--date', '20260825', '--json'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return JSON.parse(out);
}
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

test('intake — 같은 이름을 두 번 들이면 .v2 가 되고 앞 판이 그대로 남는다', () => {
  const proj = project();
  const first = take(proj, SRC);
  assert.strictEqual(first.files[0].name, 'sample.csv');
  assert.strictEqual(first.files[0].판, false);

  const second = take(proj, SRC);
  assert.strictEqual(second.files[0].name, 'sample.v2.csv');
  assert.strictEqual(second.files[0].판, true);

  const dir = path.join(proj, 'inbox', '20260825-yield-by-lot');
  assert.ok(fs.existsSync(path.join(dir, 'sample.csv')), '앞 판이 사라졌다');
  assert.ok(fs.existsSync(path.join(dir, 'sample.v2.csv')));
  // 베낀 것은 원본과 바이트가 같다
  assert.strictEqual(sha(path.join(dir, 'sample.csv')), sha(SRC));
});

test('intake — files.md 에 SHA-256 줄이 둘이고 두 파일 이름을 다 적는다', () => {
  const proj = project();
  take(proj, SRC);
  take(proj, SRC);
  const side = fs.readFileSync(path.join(proj, 'inbox', '20260825-yield-by-lot', 'files.md'), 'utf8');

  const shas = side.split('\n').filter(l => l.startsWith('SHA-256: '));
  assert.strictEqual(shas.length, 2);
  for (const l of shas) assert.match(l, /^SHA-256: [0-9a-f]{64}$/);
  assert.strictEqual(shas[0], `SHA-256: ${sha(SRC)}`);

  assert.ok(side.startsWith('# 파일'));
  assert.ok(side.includes('## sample.csv'));
  assert.ok(side.includes('## sample.v2.csv'));
  // 같은 바이트면 그렇다고 적어 사람이 "왜 둘인가"를 묻지 않게 한다
  assert.ok(side.includes('(앞 판과 내용이 같다)'));
});

test('intake — 사이드카가 fixture 와 같은 꼴이다 (열 표 · 뜻·단위는 비워 둔다)', () => {
  const proj = project();
  take(proj, SRC);
  const side = fs.readFileSync(path.join(proj, 'inbox', '20260825-yield-by-lot', 'files.md'), 'utf8');

  assert.match(side, /^\| 열 \| 뜻 \| 단위 \|$/m);
  assert.match(side, /^\|---\|---\|---\|$/m);
  assert.match(side, /^\| lot_id \|  \|  \|$/m);          // 뜻·단위는 문답으로 채우는 자리라 비어 있다
  assert.match(side, /^\| particle_defects \|  \|  \|$/m);
  assert.match(side, /120행 · 열 7개 · 빈칸 0 · CSV \(쉼표\)/);

  // 4층(find.js)이 읽는 자리와 같은 꼴인지 — fixture 사이드카와 머리·표 머리가 같다
  const 본 = fs.readFileSync(path.join(__dirname, 'fixtures', 'find', 'inbox', '20260825-yield-by-lot', 'files.md'), 'utf8');
  assert.strictEqual(본.split('\n')[0], side.split('\n')[0]);
  assert.ok(본.includes('| 열 | 뜻 | 단위 |') && side.includes('| 열 | 뜻 | 단위 |'));
});

test('intake — 들인 원본은 잠긴다 (0층 불변)', () => {
  const proj = project();
  take(proj, SRC);
  const f = path.join(proj, 'inbox', '20260825-yield-by-lot', 'sample.csv');
  assert.strictEqual(fs.statSync(f).mode & 0o222, 0, '쓰기 권한이 남아 있다');
});
