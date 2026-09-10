// 시험 뼈대가 도는지만 본다. 부품 시험은 T1.2 부터 이 폴더에 쌓인다.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

test('부품이 제자리에 있다', () => {
  for (const f of [
    'scripts/count.js',
    'scripts/chat.js',
    'scripts/retro-cost.js',
    'common/hooks/session-start.js',
    'common/settings.template.json',
    'common/statusline.sh',
  ]) {
    assert.ok(fs.existsSync(path.join(ROOT, f)), `없다: ${f}`);
  }
});

test('fixture 가 제자리에 있다', () => {
  for (const f of [
    'test/fixtures/chat/minidiscord.db',
    'test/fixtures/find/questions.json',
    'test/fixtures/hooks/fixture.db',
    'test/fixtures/hooks/pre-reply-cases.json',
    'test/fixtures/hooks/transcript-40.jsonl',
  ]) {
    assert.ok(fs.existsSync(path.join(ROOT, f)), `없다: ${f}`);
  }
});
