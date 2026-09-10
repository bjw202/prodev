#!/usr/bin/env node
// index.js — 과제 폴더의 카드·위키·inbox 를 훑어 index.md 와 index.json 을 다시 쓴다.
//
//   node scripts/index.js [<과제폴더>]
//
// 과제 폴더: 인자 > PRODEV_PROJECT 환경변수 > 지금 폴더.
// 손으로 쓰지 않는다. 카드나 위키가 바뀔 때마다 다시 돌린다 (ARCHITECTURE 5 의 "색인" 줄).
//
// 머리말은 YAML 부분집합만 읽는다. 라이브러리를 들이지 않는다 (TASKS T1.3):
//   스칼라        id: E-0007          / title: 판정: 원인은 … [추정]   (첫 ": " 뒤는 전부 값이다)
//   리스트        tags: [수율, 샤워헤드]                                 ([ 로 열고 ] 로 닫힐 때만)
//   한 줄 map     conditions: {장비: CH-3B, 부품: SH2200-B-0412}         ({ 로 열고 } 로 닫힐 때만)
// 값의 따옴표는 벗긴다. 그 밖의 YAML(여러 줄 리스트 · 겹친 map · 앵커)은 읽지 않는다 — 만나면 errors 에 넣는다.
//
// 머리말이 깨진 카드는 표에서 빼고 errors 에 넣는다. errors 가 하나라도 있으면 **exit 1** 이다.
// 그래도 index.md · index.json 은 쓴다. 훅(pre-reply)이 errors 를 보고 막을 수 있어야 하기 때문이다.
//
// `next E` 는 파일 이름 E-\d{4} 의 최댓값 + 1 이다. 머리말이 깨진 파일도 이름은 센다.
// 그래야 번호가 다시 쓰이지 않는다 (fixtures/README.md).

const fs = require('fs');
const path = require('path');

const KINDS = { E: 'experiment', R: 'research', D: 'decision', N: 'note' };

function projectDir() {
  return path.resolve(process.argv[2] || process.env.PRODEV_PROJECT || process.cwd());
}

// ── 머리말 파서 ────────────────────────────────────────────

function unquote(s) {
  const t = s.trim();
  if (t.length >= 2 && ((t[0] === '"' && t.endsWith('"')) || (t[0] === "'" && t.endsWith("'")))) {
    return t.slice(1, -1);
  }
  return t;
}

// 쉼표로 가르되 따옴표 안의 쉼표는 두고 간다.
function splitTop(s) {
  const out = []; let cur = ''; let q = null;
  for (const ch of s) {
    if (q) { cur += ch; if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === ',') { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim() !== '' || out.length === 0) out.push(cur);
  return out.map(x => x.trim()).filter(x => x !== '');
}

function parseValue(raw) {
  const v = raw.trim();
  if (v === '') return '';
  if (v.startsWith('[') && v.endsWith(']')) return splitTop(v.slice(1, -1)).map(unquote);
  if (v.startsWith('{') && v.endsWith('}')) {
    const map = {};
    for (const pair of splitTop(v.slice(1, -1))) {
      const i = pair.indexOf(':');
      if (i < 0) throw new Error(`map 의 칸에 ":" 가 없다: ${pair}`);
      map[unquote(pair.slice(0, i))] = unquote(pair.slice(i + 1));
    }
    return map;
  }
  // 열기만 하고 안 닫힌 것은 우리가 안 읽는 YAML 이다. 조용히 스칼라로 삼키지 않는다.
  if (/^[[{]/.test(v)) throw new Error(`괄호가 안 닫혔다: ${v}`);
  return unquote(v);
}

// 머리말을 떼어 { data, body } 로. 못 읽으면 throw.
function parseFrontmatter(text) {
  const lines = text.split('\n');
  if (lines[0].trim() !== '---') throw new Error('머리말이 없다 (첫 줄이 "---" 가 아니다)');
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') { end = i; break; }
  }
  if (end < 0) throw new Error('머리말이 안 닫혔다 (닫는 "---" 가 없다)');

  const data = {};
  for (let i = 1; i < end; i++) {
    const line = lines[i];
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    if (/^\s/.test(line)) throw new Error(`${i + 1}줄: 들여쓴 줄은 읽지 않는다 (여러 줄 YAML 은 안 쓴다)`);
    const c = line.indexOf(':');
    if (c < 0) throw new Error(`${i + 1}줄: ":" 가 없다 — ${line.trim()}`);
    const key = line.slice(0, c).trim();
    if (!key) throw new Error(`${i + 1}줄: 키가 비었다`);
    data[key] = parseValue(line.slice(c + 1));
  }
  return { data, body: lines.slice(end + 1).join('\n') };
}

// ── 훑기 ──────────────────────────────────────────────────

function listFiles(dir, ext) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith(ext)).sort();
}

function rel(root, p) {
  return path.relative(root, p).split(path.sep).join('/');
}

function readCards(root, errors) {
  const dir = path.join(root, 'cards');
  const cards = [];
  const names = [];
  for (const f of listFiles(dir, '.md')) {
    names.push(f);
    const p = path.join(dir, f);
    const where = rel(root, p);
    try {
      const { data, body } = parseFrontmatter(fs.readFileSync(p, 'utf8'));
      for (const need of ['id', 'kind', 'title', 'status']) {
        if (!data[need]) throw new Error(`머리말에 ${need} 가 없다`);
      }
      cards.push({
        id: String(data.id),
        kind: String(data.kind),
        title: String(data.title),
        date: data.date ? String(data.date) : '',
        who: data.who ? String(data.who) : '',
        status: String(data.status),
        supersedes: data.supersedes && data.supersedes !== 'none' ? String(data.supersedes) : null,
        aliases: [].concat(data.aliases || []),
        tags: [].concat(data.tags || []),
        related: [].concat(data.related || []),
        files: [].concat(data.files || []),
        conditions: (data.conditions && typeof data.conditions === 'object') ? data.conditions : {},
        results: (data.results && typeof data.results === 'object') ? data.results : {},
        source_msgs: [].concat(data.source_msgs || []),
        confirmed_at: data.confirmed_at != null && data.confirmed_at !== '' ? String(data.confirmed_at) : null,
        path: where,
      });
    } catch (e) {
      errors.push({ path: where, reason: e.message });
    }
  }
  return { cards, names };
}

function readWiki(root) {
  const dir = path.join(root, 'wiki');
  return listFiles(dir, '.md').map(f => {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    const first = text.split('\n').find(l => l.startsWith('# '));
    // 위키 문장은 [E-0007] 로 카드를 가리킨다 (ARCHITECTURE 5.2). 그 번호를 모아 둔다.
    const cards = [...new Set((text.match(/\[([END]-\d{4}|R-\d{4})\]/g) || []).map(x => x.slice(1, -1)))];
    return { path: `wiki/${f}`, title: first ? first.slice(2).trim() : f.replace(/\.md$/, ''), cards };
  });
}

function readInbox(root) {
  const dir = path.join(root, 'inbox');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(d => fs.statSync(path.join(dir, d)).isDirectory())
    .sort()
    .map(d => {
      const side = path.join(dir, d, 'files.md');
      const has = fs.existsSync(side);
      const originals = fs.readdirSync(path.join(dir, d)).filter(f => f !== 'files.md' && f !== 'reading.md').sort();
      return { dir: `inbox/${d}`, sidecar: has ? `inbox/${d}/files.md` : null, files: originals };
    });
}

// 이름으로만 센다. 머리말이 깨져도 그 번호는 쓴 것이다.
function nextNumbers(names) {
  const next = {};
  for (const letter of Object.keys(KINDS)) {
    const re = new RegExp(`^${letter}-(\\d{4})\\.md$`);
    let max = 0;
    for (const n of names) {
      const m = n.match(re);
      if (m) max = Math.max(max, Number(m[1]));
    }
    next[letter] = `${letter}-${String(max + 1).padStart(4, '0')}`;
  }
  return next;
}

// ── 내기 ──────────────────────────────────────────────────

function cell(s) {
  return String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function renderMd(idx) {
  const L = [];
  L.push('# 색인');
  L.push('');
  L.push('index.js 가 쓴다. 손으로 고치지 않는다.');
  L.push('');
  L.push(`## 카드 ${idx.cards.length}`);
  L.push('');
  L.push('| id | kind | title | date | status | aliases | tags | path |');
  L.push('|---|---|---|---|---|---|---|---|');
  for (const c of idx.cards) {
    L.push(`| ${cell(c.id)} | ${cell(c.kind)} | ${cell(c.title)} | ${cell(c.date)} | ${cell(c.status)} | ${cell(c.aliases.join(' · '))} | ${cell(c.tags.join(' · '))} | ${cell(c.path)} |`);
  }
  L.push('');
  L.push(`## 위키 ${idx.wiki.length}`);
  L.push('');
  L.push('| page | title | 근거 카드 |');
  L.push('|---|---|---|');
  for (const w of idx.wiki) L.push(`| ${cell(w.path)} | ${cell(w.title)} | ${cell(w.cards.join(' · '))} |`);
  L.push('');
  L.push(`## inbox ${idx.inbox.length}`);
  L.push('');
  L.push('| 묶음 | 사이드카 | 원본 |');
  L.push('|---|---|---|');
  for (const b of idx.inbox) L.push(`| ${cell(b.dir)} | ${cell(b.sidecar || '없음')} | ${cell(b.files.join(' · '))} |`);
  L.push('');
  L.push('## 다음 번호');
  L.push('');
  L.push(Object.entries(idx.next).map(([k, v]) => `- ${k}: ${v}`).join('\n'));
  L.push('');
  L.push(`## errors ${idx.errors.length}`);
  L.push('');
  if (!idx.errors.length) L.push('- 없음');
  else for (const e of idx.errors) L.push(`- ${e.path} — ${e.reason}`);
  L.push('');
  return L.join('\n');
}

function main() {
  const root = projectDir();
  if (!fs.existsSync(root)) { process.stderr.write(`과제 폴더가 없다: ${root}\n`); process.exit(2); }

  const errors = [];
  const { cards, names } = readCards(root, errors);
  const idx = {
    generated_at: new Date().toISOString(),
    project: root,
    next: nextNumbers(names),
    cards,
    wiki: readWiki(root),
    inbox: readInbox(root),
    errors,
  };

  fs.writeFileSync(path.join(root, 'index.json'), JSON.stringify(idx, null, 2) + '\n');
  fs.writeFileSync(path.join(root, 'index.md'), renderMd(idx));

  console.log(`카드 ${cards.length} · 위키 ${idx.wiki.length} · inbox ${idx.inbox.length} · errors ${errors.length}`);
  for (const e of errors) console.log(`  ! ${e.path} — ${e.reason}`);
  console.log(`next E: ${idx.next.E}`);
  console.log(`next R: ${idx.next.R} · next D: ${idx.next.D} · next N: ${idx.next.N}`);
  process.exit(errors.length ? 1 : 0);
}

if (require.main === module) main();

module.exports = { parseFrontmatter, parseValue, nextNumbers };
