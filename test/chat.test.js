// chat.js 시험 — fixture 사본 DB(test/fixtures/chat/minidiscord.db) 하나로만 돈다. 서버가 필요 없다.
//
// 기대 건수는 짐작이 아니라 이 사본을 직접 세어 박은 값이다 (2026-09-10 확인):
//   방 1개 · 글 377건 · 마지막 #377
//   search 샤워헤드 → 28 · search 수율 → 141 · 둘 AND → 17 · "샤워헤드 교체" 한 덩이 → 14
// 사본이 바뀌면 이 숫자부터 다시 센다.

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CHAT = path.join(ROOT, 'scripts', 'chat.js');
const DB = path.join(__dirname, 'fixtures', 'chat', 'minidiscord.db');

function run(...args) {
  return execFileSync(process.execPath, [CHAT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, MINIDISCORD_DB: DB },
    stdio: ['ignore', 'pipe', 'ignore'],   // node:sqlite 실험 경고는 stderr 로만 나온다
  });
}

// --json 은 사람 눈이 아니라 다른 스크립트를 위한 것이다. 세는 시험은 전부 이쪽으로 한다.
function rows(...args) {
  return JSON.parse(run(...args, '--json'));
}

function count(...terms) {
  return rows('search', ...terms, '--limit', '500').length;
}

// ── 여섯 명령 ───────────────────────────────────────────────

test('명령 1/6 rooms — 방 하나 · 377건 · 마지막 #377', () => {
  const r = rows('rooms');
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].name, '수율개선-2026q3');
  assert.strictEqual(r[0].messages, 377);
  assert.strictEqual(r[0].last_id, 377);
  assert.match(run('rooms'), /^1\t수율개선-2026q3\tactive\t377건\t마지막 #377$/m);
});

test('명령 2/6 search — 샤워헤드 --limit 4 는 4건, 전부 그 말을 담는다', () => {
  const r = rows('search', '샤워헤드', '--limit', '4');
  assert.strictEqual(r.length, 4);
  for (const m of r) assert.ok(m.body.includes('샤워헤드'), `#${m.id} 에 없다`);
  // limit 은 최근 것부터 자르고, 낼 때는 다시 오래된 것부터다.
  assert.deepStrictEqual(r.map(m => m.id), [...r.map(m => m.id)].sort((a, b) => a - b));
  assert.match(run('search', '샤워헤드', '--limit', '4'), /— 4건$/m);
});

test('명령 3/6 around — #300 앞뒤 2씩이면 자기까지 5건, 가운데가 #300', () => {
  const r = rows('around', '300', '--before', '2', '--after', '2');
  assert.strictEqual(r.length, 5);
  assert.deepStrictEqual(r.map(m => m.id), [298, 299, 300, 301, 302]);
});

test('명령 4/6 since — 방 1 의 #370 다음은 371..377 7 건', () => {
  const r = rows('since', '1', '370');
  assert.strictEqual(r.length, 7);
  assert.strictEqual(r[0].id, 371);
  assert.strictEqual(r[r.length - 1].id, 377);
  assert.match(run('since', '1', '370'), /다음 since: 377/);
});

test('명령 5/6 tail — 방 1 의 마지막 3건은 375·376·377', () => {
  const r = rows('tail', '1', '3');
  assert.deepStrictEqual(r.map(m => m.id), [375, 376, 377]);
});

test('명령 6/6 show — #2 는 본문에 "출석체크" 가 있고 첨부 0', () => {
  const r = rows('show', '2');
  assert.strictEqual(r.id, 2);
  assert.ok(r.body.includes('출석체크'));
  assert.deepStrictEqual(r.attachments, []);
  assert.ok(run('show', '2').includes('출석체크'));
});

test('명령 곁 — --speaker 는 말한이 하나로 거른다', () => {
  // 거르지 않으면 141건에 말한이 7, 거르면 29건에 orchestrator 하나다.
  const 전부 = rows('search', '수율', '--limit', '500');
  assert.strictEqual(전부.length, 141);
  assert.ok(new Set(전부.map(m => m.author)).size > 1);

  const 하나 = rows('search', '수율', '--speaker', 'orchestrator', '--limit', '500');
  assert.strictEqual(하나.length, 29);
  assert.deepStrictEqual([...new Set(하나.map(m => m.author))], ['orchestrator']);
  // 거른 것은 안 거른 것의 부분집합이다
  const 전부id = new Set(전부.map(m => m.id));
  for (const m of 하나) assert.ok(전부id.has(m.id), `#${m.id} 가 안 거른 결과에 없다`);

  // 없는 말한이면 빈 결과 (죽지 않는다)
  assert.strictEqual(rows('search', '수율', '--speaker', '없는사람', '--limit', '500').length, 0);
});

// ── AND 두 건 ───────────────────────────────────────────────

test('AND 1/2 — 낱말 둘은 둘 다 든 글만. 순서를 바꿔도 같다', () => {
  assert.strictEqual(count('샤워헤드'), 28);
  assert.strictEqual(count('수율'), 141);
  const both = rows('search', '샤워헤드', '수율', '--limit', '500');
  assert.strictEqual(both.length, 17);
  for (const m of both) {
    assert.ok(m.body.includes('샤워헤드') && m.body.includes('수율'), `#${m.id} 에 둘 다 있지 않다`);
  }
  // 순서는 뜻을 바꾸지 않는다
  assert.deepStrictEqual(
    rows('search', '수율', '샤워헤드', '--limit', '500').map(m => m.id),
    both.map(m => m.id),
  );
});

test('AND 2/2 — 따옴표로 묶은 한 덩이는 떨어진 것을 안 센다 · 없는 낱말 하나면 전부 없다', () => {
  // 낱말 둘(AND) 17 ⊃ 붙어 있는 한 덩이 14. 이 차이가 AND 와 덩이를 가른다.
  assert.strictEqual(count('샤워헤드', '교체'), 17);
  assert.strictEqual(count('샤워헤드 교체'), 14);
  const and = new Set(rows('search', '샤워헤드', '교체', '--limit', '500').map(m => m.id));
  for (const m of rows('search', '샤워헤드 교체', '--limit', '500')) {
    assert.ok(and.has(m.id), `덩이 결과 #${m.id} 가 AND 결과에 없다`);
  }
  // AND 이므로 없는 낱말이 하나만 섞여도 0 이다
  assert.strictEqual(count('없는낱말xyz'), 0);
  assert.strictEqual(count('샤워헤드', '없는낱말xyz'), 0);
});

// ── NFC 한 건 ───────────────────────────────────────────────

test('NFC — 자모가 갈라진(NFD) 질의도 NFC 로 저장된 본문을 찾는다', () => {
  const nfd = '샤워헤드'.normalize('NFD');
  assert.notStrictEqual(nfd, '샤워헤드');            // 정말 다른 바이트인지 먼저 못 박는다
  assert.strictEqual(nfd.normalize('NFC'), '샤워헤드');
  const a = rows('search', '샤워헤드', '--limit', '500').map(m => m.id);
  const b = rows('search', nfd, '--limit', '500').map(m => m.id);
  assert.strictEqual(b.length, 28);
  assert.deepStrictEqual(b, a);
  // 대소문자도 접는다 (같은 norm() 하나가 "같다"의 뜻이다)
  assert.strictEqual(count('SHA-256'), 9);
  assert.strictEqual(count('sha-256'), 9);
});
