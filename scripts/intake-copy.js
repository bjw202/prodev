#!/usr/bin/env node
// intake-copy.js — 올라온 첨부를 과제의 inbox 로 들인다. 원본은 두 번 다시 손대지 않는다.
//
//   node scripts/intake-copy.js <slug> <파일...> [--project <과제폴더>] [--date YYYYMMDD]
//
// 하는 일 (ARCHITECTURE 5 의 0층 · 6.1 들이기):
//   1 inbox/<날짜>-<slug>/ 를 만든다
//   2 파일을 베낀다. 서버 저장명(`<uuid>-<원래이름>`)이면 uuid 를 벗겨 원래 이름으로 둔다.
//     이름이 이미 있으면 .v2 · .v3 … 로 늘린다 (덮어쓰지 않는다)
//   3 SHA-256 을 잰다
//   4 files.md(사이드카) 에 파일마다 한 절을 더한다 — 열·행·SHA-256 은 채우고, 뜻과 단위는 비워 둔다
//
// 왜 덮어쓰지 않나: 0층은 불변이다. 같은 이름의 새 판이 와도 앞 판이 남아 있어야
// "그때 그 숫자가 어느 파일에서 나왔나"를 되짚을 수 있다. 뜻·단위는 문답으로 채운다 (비서가 묻는다).
//
// 어디서 들이나: 허용 뿌리 안의 파일만 들인다. 뿌리는 PRODEV_INTAKE_ROOTS(구분자로 여럿) 또는
// MINIDISCORD_BOT_FILES_DIR 이다. 뿌리를 안 정했으면 아무 데서나 들인다 (혼자 손으로 돌릴 때).
// 왜 막나: 첨부로 온 것만 들여야 한다. 봇이 아무 경로나 받아 베끼면 과제 저장소가 남의 파일로 채워지고,
// 그 파일은 0444 로 잠긴 채 커밋된다 — 되돌리기 어려운 쪽이다.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');

// 허용 뿌리 목록. 없으면 null (막지 않는다).
function 뿌리들() {
  const raw = process.env.PRODEV_INTAKE_ROOTS || process.env.MINIDISCORD_BOT_FILES_DIR || '';
  const list = raw.split(path.delimiter).map(x => x.trim()).filter(Boolean).map(x => path.resolve(x));
  return list.length ? list : null;
}

// src 가 뿌리 안인가. 심볼릭 링크로 빠져나가는 것을 막으려고 realpath 로 편다.
function 안에있나(src, 뿌리) {
  let 실제;
  try { 실제 = fs.realpathSync(src); } catch { 실제 = path.resolve(src); }
  return 뿌리.some(r => {
    let R;
    try { R = fs.realpathSync(r); } catch { R = path.resolve(r); }
    const rel = path.relative(R, 실제);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  });
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

// 서버가 저장한 이름에서 원래 이름을 되찾는다.
//
// minidiscord 는 첨부를 `${randomUUID()}-${원래이름}` 으로 쌓는다 (server routes-messages.ts).
// 그 이름을 그대로 inbox 에 들이면 같은 파일을 다시 올려도 앞에 붙은 uuid 가 달라
// **.v2 규칙이 걸리지 않는다** — 같은 파일이 이름만 다른 채 둘이 된다 (T3.M R2 에서 실제로 그랬다).
//
// 앞머리가 uuid 꼴일 때만 벗긴다. 사람이 손으로 놓은 파일 이름은 건드리지 않는다.
const UUID앞머리 = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i;
function 원래이름(src) {
  const base = path.basename(src);
  const 벗긴것 = base.replace(UUID앞머리, '');
  // 벗기고 나서 빈 이름이 되면 벗기지 않는다 (uuid 뿐인 파일)
  return 벗긴것 ? 벗긴것 : base;
}

// 이름이 이미 있으면 .v2 · .v3 … 로. 확장자 앞에 붙여야 무슨 파일인지 그대로 보인다.
function freeName(dir, base) {
  if (!fs.existsSync(path.join(dir, base))) return base;
  const ext = path.extname(base);
  const stem = base.slice(0, base.length - ext.length);
  for (let v = 2; v < 1000; v++) {
    const cand = `${stem}.v${v}${ext}`;
    if (!fs.existsSync(path.join(dir, cand))) return cand;
  }
  throw new Error(`판이 너무 많다: ${base}`);
}

// peek.js 로 열·행을 본다. 못 봐도 들이기를 멈추지 않는다 — 사이드카의 그 칸만 빈다.
function look(file) {
  try {
    const out = execFileSync(process.execPath, [path.join(REPO, 'scripts', 'peek.js'), file, '--json'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 60000,
    });
    return JSON.parse(out);
  } catch {
    return null;
  }
}

function section(name, p, hash, 앞판) {
  const L = [`## ${name}`];
  const 요약 = [];
  if (p && !p.못읽음) {
    if (p.행 != null) 요약.push(`${p.행}행`);
    if (p.열 != null) 요약.push(`열 ${p.열}개`);
    if (p.쪽 != null) 요약.push(`${p.쪽}쪽`);
    if (p.너비) 요약.push(`${p.너비} × ${p.높이}`);
    if (p.빈칸 != null) 요약.push(`빈칸 ${p.빈칸}`);
  }
  요약.push(p && p.형식 ? p.형식 : '형식 모름');
  L.push(요약.join(' · '));

  if (p && p.열이름 && p.열이름.length) {
    L.push('');
    L.push('| 열 | 뜻 | 단위 |');
    L.push('|---|---|---|');
    // 뜻과 단위는 비워 둔다. 문답으로 채우는 자리다 — 비서가 지어내면 안 된다.
    for (const c of p.열이름) L.push(`| ${c} |  |  |`);
  }
  if (p && (p.못읽음 || p.못읽은것)) {
    L.push('');
    L.push(`못 읽었다: ${p.못읽음 || p.못읽은것}`);
  }
  L.push('');
  L.push(`SHA-256: ${hash}`);
  // 새 판인데 바이트가 앞 판과 같으면 그렇다고 적는다. 사람이 "왜 둘인가"를 묻지 않게.
  if (앞판 && 앞판 === hash) L.push(`(앞 판과 내용이 같다)`);
  L.push('');
  L.push('');
  return L.join('\n');
}

function intake(slug, files, opt) {
  const root = path.resolve(opt.project || process.env.PRODEV_PROJECT || process.cwd());
  const date = opt.date || today();
  const dir = path.join(root, 'inbox', `${date}-${slug}`);
  fs.mkdirSync(dir, { recursive: true });

  const side = path.join(dir, 'files.md');
  if (!fs.existsSync(side)) fs.writeFileSync(side, '# 파일\n\n');

  const 뿌리 = 뿌리들();
  const done = [];
  for (const src of files) {
    if (!fs.existsSync(src)) { done.push({ src, error: '파일이 없다' }); continue; }
    if (뿌리 && !안에있나(src, 뿌리)) {
      done.push({ src, error: `허용 뿌리 밖이다 (${뿌리.join(' · ')})` });
      continue;
    }
    const 본이름 = 원래이름(src);            // 서버 저장명이면 uuid 를 벗긴 이름
    const name = freeName(dir, 본이름);
    const dest = path.join(dir, name);
    fs.copyFileSync(src, dest);
    fs.chmodSync(dest, 0o444);                 // 0층은 불변이다. 실수로 고치지 못하게 잠근다
    const hash = sha256(dest);
    const 앞판 = name === 본이름 ? null : sha256(path.join(dir, 본이름));
    const p = look(dest);
    fs.appendFileSync(side, section(name, p, hash, 앞판));
    done.push({ src, name, path: path.relative(root, dest).split(path.sep).join('/'), sha256: hash, 판: /\.v\d+\./.test(name) });
  }
  return { dir: path.relative(root, dir).split(path.sep).join('/'), sidecar: path.relative(root, side).split(path.sep).join('/'), files: done };
}

function main() {
  const args = process.argv.slice(2);
  const opt = {}; const pos = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--json') opt.json = true;
    else if (args[i].startsWith('--')) opt[args[i].slice(2)] = args[++i];
    else pos.push(args[i]);
  }
  const [slug, ...files] = pos;
  if (!slug || !files.length) {
    process.stderr.write('쓰는 법: node scripts/intake-copy.js <slug> <파일...> [--project <과제폴더>] [--date YYYYMMDD]\n');
    process.exit(1);
  }
  const r = intake(slug, files, opt);
  const 거절 = r.files.filter(f => f.error);
  if (opt.json) { console.log(JSON.stringify(r, null, 2)); if (거절.length) process.exit(1); return; }
  console.log(`들임: ${r.dir}`);
  for (const f of r.files) {
    if (f.error) { console.log(`  ! ${f.src} — ${f.error}`); continue; }
    console.log(`  ${f.path}${f.판 ? '  (같은 이름이 있어 새 판으로)' : ''}`);
    console.log(`  SHA-256: ${f.sha256}`);
  }
  console.log(`사이드카: ${r.sidecar}  (뜻·단위는 문답으로 채운다)`);
  if (거절.length) process.exit(1);   // 한 건이라도 못 들였으면 조용히 끝내지 않는다
}

if (require.main === module) main();

module.exports = { intake, sha256, freeName };
