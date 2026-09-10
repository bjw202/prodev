// plot.py 시험 — csv 열 하나 → <과제>/tmp/*.png.
// matplotlib 이 없는 자리에서는 죽지 않고 "못 그렸다" 한 줄이면 통과다 (끝 조건은 "죽지 않는 것"이다).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PLOT = path.join(ROOT, 'scripts', 'plot.py');
const SRC = path.join(__dirname, 'fixtures', 'peek', 'sample.csv');

function run(...args) {
  try {
    return execFileSync('python3', [PLOT, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 120000 });
  } catch (e) {
    return `__못 돌았다__ ${e.message}`;
  }
}

test('plot — tmp/ 에 png 하나를 만든다 (크기 > 0)', () => {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'prodev-plot-'));
  const out = run(SRC, '--y', 'yield_pct', '--x', 'date', '--project', proj);

  if (out.includes('못 그렸다')) {
    // 도구가 없는 자리. 죽지 않고 까닭 한 줄이면 된다.
    assert.match(out, /^못 그렸다: .+/m);
    return;
  }
  const png = path.join(proj, 'tmp', 'sample-yield_pct.png');
  assert.ok(fs.existsSync(png), `png 가 없다 — ${out}`);
  assert.ok(fs.statSync(png).size > 0, 'png 가 비었다');
  assert.strictEqual(fs.readFileSync(png).toString('latin1', 1, 4), 'PNG');   // 정말 png 인가
  assert.match(out, /그림: .*sample-yield_pct\.png/);
  assert.match(out, /점 120개/);
});

test('plot — 없는 열·없는 파일에 죽지 않는다 (한 줄 내고 exit 0)', () => {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'prodev-plot-'));
  const 없는열 = run(SRC, '--y', '없는열', '--project', proj);
  assert.match(없는열, /못 그렸다: 열이 없다: 없는열/);
  assert.ok(없는열.includes('yield_pct'), '있는 열을 알려 주지 않는다');

  const 없는파일 = run(path.join(proj, '없다.csv'), '--y', 'yield_pct', '--project', proj);
  assert.match(없는파일, /못 그렸다: 파일이 없다/);
});
