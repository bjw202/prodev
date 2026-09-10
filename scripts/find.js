#!/usr/bin/env node
// find.js — 물음 하나를 층 다섯에서 차례로 찾는다. 먼저 걸린 층에서 멈춘다.
//
//   node scripts/find.js <물음> [--limit N] [--json] [--project <과제폴더>]
//
// 층 순서는 ARCHITECTURE 5.3 대로 스크립트에 못 박는다. 부르는 쪽이 바꾸지 못한다.
//   1 index.json 의 title · aliases · tags   → 카드 경로
//   2 cards/*.md 본문                         → 카드 경로 + 행
//   3 wiki/*.md                               → 페이지 + 행
//   4 chat.js search (AND)                    → #message_id
//   5 inbox/*/files.md · 원본                 → 사이드카 경로 + 행
//
// 맞대보기 전에 양쪽을 고른다: NFC · 소문자 · 하이픈과 공백 접기.
// 물음의 낱말에서는 조사(을/를/이/가/은/는/의/에/에서/로/으로/와/과/도)를 뗀다.
// 뗀 것과 안 뗀 것 둘 다로 본다 — 조사처럼 생긴 끝소리가 낱말의 일부일 수 있기 때문이다 (온도의 "도").
// 남는 줄기가 한 글자면 떼지 않는다.
//
// void 카드가 걸리면 그것을 대체한 카드로 바꿔 낸다. 대체한 쪽이 supersedes 로 뒤를 가리킨다.
//
// 답한 층을 find.log 에 한 줄씩 남긴다 (읽힘 지표, ARCHITECTURE 5.3).
// 자리: PRODEV_FIND_LOG(시험·검수용 전체 경로) > <이 저장소>/bots/<PRODEV_BOT>/find.log. 둘 다 없으면 안 남긴다.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const JOSA = ['에서', '으로', '과', '와', '로', '의', '에', '은', '는', '이', '가', '을', '를', '도'];

// ── 고르기 ────────────────────────────────────────────────

// 맞대보기용 꼴. 하이픈·공백을 접으므로 "O-링" 과 "O 링" 과 "o링" 이 같아진다.
function fold(s) {
  return String(s == null ? '' : s).normalize('NFC').toLowerCase().replace(/[\s\-_·]/g, '');
}

// 낱말 하나가 걸릴 수 있는 꼴들. 조사를 뗀 것과 안 뗀 것 둘 다 본다.
function variants(word) {
  const out = new Set([fold(word)]);
  const w = String(word).normalize('NFC');
  for (const j of JOSA) {
    if (w.length > j.length && w.endsWith(j)) {
      const stem = w.slice(0, -j.length);
      if ([...stem].length >= 2) out.add(fold(stem));
      break;                                  // 조사는 하나만 뗀다
    }
  }
  return [...out].filter(Boolean);
}

function terms(question) {
  return String(question).trim().split(/\s+/).filter(Boolean).map(w => ({ word: w, forms: variants(w) }));
}

function hasAll(hay, ts) {
  const h = fold(hay);
  return ts.every(t => t.forms.some(f => h.includes(f)));
}

// 가장 많은 낱말이 든 줄을 하나 집어 낸다. 없으면 null.
function bestLine(text, ts) {
  const lines = text.split('\n');
  let best = null, bestN = 0;
  for (let i = 0; i < lines.length; i++) {
    const h = fold(lines[i]);
    const n = ts.filter(t => t.forms.some(f => h.includes(f))).length;
    if (n > bestN) { bestN = n; best = { line: i + 1, text: lines[i].trim() }; }
  }
  return best;
}

// ── 자료 ──────────────────────────────────────────────────

function projectDir(opt) {
  return path.resolve(opt.project || process.env.PRODEV_PROJECT || process.cwd());
}

function loadIndex(root) {
  const p = path.join(root, 'index.json');
  if (!fs.existsSync(p)) {
    process.stderr.write(`index.json 이 없다: ${p}\n먼저 node scripts/index.js 를 돌린다.\n`);
    process.exit(2);
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// void 는 그것을 대체한 카드로 바꾼다. 대체가 없으면 void 인 채로 둔다(있다고 말은 해야 한다).
function resolveVoid(card, idx) {
  let cur = card;
  const seen = new Set();
  while (cur && cur.status === 'void' && !seen.has(cur.id)) {
    seen.add(cur.id);
    const heir = idx.cards.find(c => c.supersedes === cur.path);
    if (!heir) break;
    cur = heir;
  }
  return cur;
}

function dedupe(hits) {
  const seen = new Set();
  return hits.filter(h => (seen.has(h.path) ? false : (seen.add(h.path), true)));
}

function cardHit(c, extra) {
  return { path: c.path, id: c.id, title: c.title, status: c.status, ...extra };
}

// ── 층 다섯 ───────────────────────────────────────────────

function layer1(idx, ts) {
  const hits = [];
  for (const c of idx.cards) {
    if (hasAll([c.title, ...c.aliases, ...c.tags].join(' '), ts)) {
      const r = resolveVoid(c, idx);
      hits.push(cardHit(r, r.id === c.id ? {} : { via: c.id }));
    }
  }
  return dedupe(hits);
}

function layer2(root, idx, ts) {
  const hits = [];
  for (const c of idx.cards) {
    const p = path.join(root, c.path);
    if (!fs.existsSync(p)) continue;
    const text = fs.readFileSync(p, 'utf8');
    const body = text.split(/\n---\n/).slice(1).join('\n---\n') || text;   // 머리말 뒤가 본문이다
    if (!hasAll(body, ts)) continue;
    const r = resolveVoid(c, idx);
    const b = bestLine(body, ts);
    hits.push(cardHit(r, { ...(r.id === c.id ? {} : { via: c.id }), ...(b || {}) }));
  }
  return dedupe(hits);
}

function layer3(root, idx, ts) {
  const hits = [];
  for (const w of idx.wiki) {
    const p = path.join(root, w.path);
    if (!fs.existsSync(p)) continue;
    const text = fs.readFileSync(p, 'utf8');
    if (!hasAll(text, ts)) continue;
    hits.push({ path: w.path, title: w.title, ...(bestLine(text, ts) || {}) });
  }
  return hits;
}

function layer4(ts, limit) {
  // chat.js 에 낱말을 그대로 넘긴다. AND 와 NFC 는 거기가 맡는다 (층마다 두 번 하지 않는다).
  const args = [path.join(REPO, 'scripts', 'chat.js'), 'search', ...ts.map(t => t.word), '--limit', String(limit), '--json'];
  let out;
  try {
    out = execFileSync(process.execPath, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (e) {
    return [];                                  // DB 가 없으면 이 층은 없는 셈 친다 (fail-open)
  }
  return JSON.parse(out).map(m => ({
    path: `#${m.id}`,
    id: m.id,
    room: m.room,
    author: m.author,
    created_at: m.created_at,
    text: m.body.replace(/\s+/g, ' ').slice(0, 160),
  }));
}

function layer5(root, idx, ts) {
  const hits = [];
  for (const b of idx.inbox) {
    if (b.sidecar) {
      const p = path.join(root, b.sidecar);
      if (fs.existsSync(p)) {
        const text = fs.readFileSync(p, 'utf8');
        if (hasAll(text, ts)) { hits.push({ path: b.sidecar, ...(bestLine(text, ts) || {}) }); continue; }
      }
    }
    // 사이드카에 없으면 원본 파일 이름으로도 본다
    for (const f of b.files) {
      if (hasAll(`${b.dir}/${f}`, ts)) hits.push({ path: `${b.dir}/${f}` });
    }
  }
  return dedupe(hits);
}

// ── 기록 ──────────────────────────────────────────────────

function logLine(q, layer, hits) {
  const explicit = process.env.PRODEV_FIND_LOG;
  const bot = process.env.PRODEV_BOT;
  const file = explicit || (bot ? path.join(REPO, 'bots', bot, 'find.log') : null);
  if (!file) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const top = hits.length ? hits[0].path : '-';
    fs.appendFileSync(file, `${new Date().toISOString()}\t${layer ?? '-'}\t${hits.length}\t${top}\t${q.replace(/\s+/g, ' ')}\n`);
  } catch { /* 기록을 못 남긴다고 답을 못 주지는 않는다 */ }
}

// ── 몸통 ──────────────────────────────────────────────────

const LAYER_NAME = {
  1: 'index (title·aliases·tags)',
  2: '카드 본문',
  3: '위키',
  4: '대화',
  5: 'inbox 사이드카 · 원본',
};

function find(question, opt) {
  const root = projectDir(opt);
  const idx = loadIndex(root);
  const ts = terms(question);
  const limit = Math.min(Number(opt.limit || 10) || 10, 200);
  if (!ts.length) return { q: question, layer: null, hits: [], project: root };

  const run = [
    [1, () => layer1(idx, ts)],
    [2, () => layer2(root, idx, ts)],
    [3, () => layer3(root, idx, ts)],
    [4, () => layer4(ts, limit)],
    [5, () => layer5(root, idx, ts)],
  ];
  for (const [n, fn] of run) {
    const hits = fn();
    if (hits.length) return { q: question, layer: n, hits: hits.slice(0, limit), project: root };
  }
  return { q: question, layer: null, hits: [], project: root };
}

function parseArgs(argv) {
  const pos = []; const opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      if (k === 'json') opt.json = true;
      else opt[k] = argv[++i];
    } else pos.push(a);
  }
  return { pos, opt };
}

function main() {
  const { pos, opt } = parseArgs(process.argv.slice(2));
  const q = pos.join(' ');
  if (!q) {
    process.stderr.write('쓰는 법: node scripts/find.js <물음> [--limit N] [--json] [--project <과제폴더>]\n');
    process.exit(1);
  }
  const r = find(q, opt);
  logLine(q, r.layer, r.hits);

  if (opt.json) { console.log(JSON.stringify(r, null, 2)); return; }
  if (!r.layer) { console.log('(없음)'); return; }
  console.log(`${r.layer}층 ${LAYER_NAME[r.layer]}`);
  for (const h of r.hits) {
    const via = h.via ? `  (${h.via} 폐기 → 대체)` : '';
    const at = h.line ? `:${h.line}` : '';
    const tail = h.title ? `  ${h.title}` : (h.text ? `  ${h.text}` : '');
    console.log(`${h.path}${at}${via}${tail}`);
    if (h.text && h.title) console.log(`    ${h.text}`);
  }
  console.log(`— ${r.hits.length}건 (${r.layer}층)`);
}

if (require.main === module) main();

module.exports = { find, fold, variants, terms };
