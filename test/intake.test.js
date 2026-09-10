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
  // 뿌리를 안 정한 채로 부른다 — 이 시험들은 뿌리 검사가 아니라 판·SHA 를 본다
  const env = { ...process.env };
  delete env.PRODEV_INTAKE_ROOTS;
  delete env.MINIDISCORD_BOT_FILES_DIR;
  const out = execFileSync(process.execPath, [INTAKE, 'yield-by-lot', ...files, '--project', proj, '--date', '20260825', '--json'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env });
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

test('intake — 허용 뿌리 밖의 파일은 거절한다 (첨부로 온 것만 들인다)', () => {
  const proj = project();
  const 뿌리 = fs.mkdtempSync(path.join(os.tmpdir(), 'prodev-uploads-'));
  const 안 = path.join(뿌리, 'ok.csv');
  fs.copyFileSync(SRC, 안);
  const 밖 = SRC;                                   // 저장소 안이지만 업로드 뿌리 밖이다

  let code = 0, out = '';
  try {
    out = execFileSync(process.execPath,
      [INTAKE, 'yield-by-lot', 안, 밖, '--project', proj, '--date', '20260825', '--json'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, PRODEV_INTAKE_ROOTS: 뿌리 } });
  } catch (e) { code = e.status; out = e.stdout; }

  const r = JSON.parse(out);
  const 들인것 = r.files.filter(f => !f.error);
  const 거절 = r.files.filter(f => f.error);
  assert.strictEqual(들인것.length, 1);
  assert.strictEqual(들인것[0].name, 'ok.csv');
  assert.strictEqual(거절.length, 1);
  assert.match(거절[0].error, /허용 뿌리 밖이다/);
  assert.strictEqual(code, 1, '한 건이라도 못 들이면 조용히 끝내지 않는다');

  // 거절한 것은 정말 안 베꼈다
  const dir = path.join(proj, 'inbox', '20260825-yield-by-lot');
  assert.deepStrictEqual(fs.readdirSync(dir).sort(), ['files.md', 'ok.csv']);
  // 사이드카에도 거절한 파일의 절이 없다
  const side = fs.readFileSync(path.join(dir, 'files.md'), 'utf8');
  assert.ok(!side.includes('sample.csv'), '거절한 파일이 사이드카에 적혔다');
});

test('intake — 뿌리를 안 정하면 막지 않는다 (혼자 손으로 돌릴 때)', () => {
  const proj = project();
  const r = take(proj, SRC);                        // PRODEV_INTAKE_ROOTS 도 BOT_FILES_DIR 도 없다
  assert.strictEqual(r.files.length, 1);
  assert.ok(!r.files[0].error, JSON.stringify(r.files[0]));
});

test('intake — 들인 원본은 잠긴다 (0층 불변)', () => {
  const proj = project();
  take(proj, SRC);
  const f = path.join(proj, 'inbox', '20260825-yield-by-lot', 'sample.csv');
  assert.strictEqual(fs.statSync(f).mode & 0o222, 0, '쓰기 권한이 남아 있다');
});

// ── 서버 저장명 (T3.M R2 발견 4) ──────────────────────────
// minidiscord 는 첨부를 `<uuid>-<원래이름>` 으로 쌓는다 (server routes-messages.ts).
// 그 이름을 그대로 들이면 같은 파일을 다시 올려도 uuid 가 달라 .v2 규칙이 안 걸린다.

function 들인다(proj, slug, ...files) {
  const env = { ...process.env };
  delete env.PRODEV_INTAKE_ROOTS;
  delete env.MINIDISCORD_BOT_FILES_DIR;
  const out = execFileSync(process.execPath, [INTAKE, slug, ...files, '--project', proj, '--date', '20260910', '--json'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env });
  return JSON.parse(out);
}
function 놓는다(dir, name, body) {
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, name);
  fs.writeFileSync(p, body);
  return p;
}

test('서버 저장명 — uuid 를 벗겨 원래 이름으로 들이고, 다시 오면 .v2 가 된다', () => {
  const proj = project();
  const 업로드 = path.join(proj, '..', `uploads-${Date.now()}`);
  const 첫판 = 놓는다(업로드, '3f2504e0-4f89-11d3-9a0c-0305e82c3301-part_incoming_inspection.csv', 'a,b\n1,2\n');
  const 둘째판 = 놓는다(업로드, 'a1b2c3d4-1111-2222-3333-444455556666-part_incoming_inspection.csv', 'a,b\n1,3\n');

  const r1 = 들인다(proj, '부품입고', 첫판);
  assert.strictEqual(r1.files[0].name, 'part_incoming_inspection.csv', 'uuid 를 안 벗겼다');
  assert.strictEqual(r1.files[0].판, false);

  // uuid 는 다르지만 원래 이름이 같다 — 같은 파일의 새 판으로 봐야 한다
  const r2 = 들인다(proj, '부품입고', 둘째판);
  assert.strictEqual(r2.files[0].name, 'part_incoming_inspection.v2.csv', '.v2 가 안 걸렸다');
  assert.strictEqual(r2.files[0].판, true);

  const 남은것 = fs.readdirSync(path.join(proj, 'inbox', '20260910-부품입고')).sort();
  assert.ok(남은것.includes('part_incoming_inspection.csv'), '앞 판이 사라졌다 (0층은 불변)');
  assert.ok(남은것.includes('part_incoming_inspection.v2.csv'));
});

test('사람이 손으로 놓은 이름은 건드리지 않는다', () => {
  const proj = project();
  const 자리 = path.join(proj, '..', `손-${Date.now()}`);
  const f = 놓는다(자리, '2026-09-수율-메모.csv', 'a\n1\n');
  const r = 들인다(proj, '메모', f);
  assert.strictEqual(r.files[0].name, '2026-09-수율-메모.csv', '이름을 건드렸다');
});

test('uuid 처럼 생겼지만 uuid 가 아닌 앞머리는 벗기지 않는다', () => {
  const proj = project();
  const 자리 = path.join(proj, '..', `닮은꼴-${Date.now()}`);
  // 토막이 넷뿐 · 길이가 틀림 · 16진수가 아닌 글자 — 셋 다 uuid 가 아니다
  const 닮은것 = [
    '3f2504e0-4f89-11d3-9a0c-report.csv',                       // 토막 넷
    '3f2504e0-4f89-11d3-9a0c-0305e82c33-report.csv',            // 마지막 토막이 짧다
    '3f2504e0-4f89-11d3-9a0c-0305e82c330z-report.csv',          // z 는 16진수가 아니다
  ];
  for (const 이름 of 닮은것) {
    const f = 놓는다(자리, 이름, 'a\n1\n');
    const r = 들인다(proj, `닮은-${닮은것.indexOf(이름)}`, f);
    assert.strictEqual(r.files[0].name, 이름, `벗기면 안 되는 이름을 벗겼다: ${이름}`);
  }
});
