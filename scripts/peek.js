#!/usr/bin/env node
// peek.js — 들어온 파일을 열어 "몇 행 · 어떤 열 · 앞 5행 · 무슨 형식" 을 낸다.
//
//   node scripts/peek.js <파일> [--rows N] [--json]
//
// 들이기(6.1)의 첫 걸음이다. 비서는 이 출력으로 "이렇게 읽었습니다" 표를 만든다.
// 전수 읽기는 여기가 아니라 data-reader 가 reading.md 에 한다.
//
// 읽는 법:
//   csv · tsv   node 가 직접 (구분자 · 따옴표 · BOM · 빈칸 수)
//   xlsx        python3 + openpyxl
//   pdf         쪽 수는 node 가 직접. 글은 pdfplumber > pdftotext 차례로, 둘 다 없으면 쪽 수만
//   jpg · png   크기는 node 가 직접 (JPEG SOF · PNG IHDR). 그 밖은 python3 + Pillow 가 있을 때만
//   그 밖       크기와 앞머리 바이트만
//
// 도우미가 없으면 **죽지 않는다**. "못 읽었다: <까닭>" 한 줄을 내고 exit 0 이다.
// 들이기가 파일 하나 때문에 멈추면 안 되기 때문이다. 필요한 꾸러미는 README 에 적었다.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// ── 도우미 ────────────────────────────────────────────────

function human(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// python3 도우미를 부른다. 없거나 죽으면 null 을 돌려준다 (부른 쪽이 "못 읽었다" 로 잇는다).
//
// stdout 을 UTF-8 로 못 박는다 (PYTHONIOENCODING). 윈도우 파이썬은 그러지 않으면 stdout 을
// **콘솔 코드페이지**로 인코딩하는데(한국어 기계면 cp949) 노드는 UTF-8 로 읽어, 자료 요약과
// 그림 경로의 한글이 `?????` 로 깨진 채 카드에 들어간다 — 오류는 안 난다 (2026-09-12 실측).
// 사람의 PYTHONUTF8 환경변수에 기대지 않는다: 봇은 --setting-sources project,local 로 떠서
// 사용자 설정을 안 읽고, 그 값 하나가 빠지면 조용히 틀린 글자가 파일에 남는다.
// 이미 UTF-8 인 맥·리눅스에서는 같은 값을 다시 못 박는 것이라 아무것도 바뀌지 않는다.
// 사람이 일부러 정한 값이 있으면 그것을 존중한다.
function python(code, args) {
  try {
    const out = execFileSync('python3', ['-c', code, ...args], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000,
      env: { PYTHONIOENCODING: 'utf-8', ...process.env },
    });
    return JSON.parse(out);
  } catch (e) {
    const msg = (e.stderr || e.message || '').toString().trim().split('\n').pop();
    return { _못읽음: msg || 'python3 를 못 불렀다' };
  }
}

// ── csv · tsv ─────────────────────────────────────────────

// 따옴표 안의 구분자와 줄바꿈을 지킨다. 우리가 받는 성적서에 실제로 들어온다.
function parseDelimited(text, delim) {
  const rows = []; let row = []; let cur = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += ch;
      continue;
    }
    if (ch === '"') { q = true; continue; }
    if (ch === delim) { row.push(cur); cur = ''; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; continue; }
    cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

function peekDelimited(file, nRows) {
  let text = fs.readFileSync(file, 'utf8');
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);          // BOM 을 떼지 않으면 첫 열 이름이 더러워진다
  const head = text.split('\n')[0] || '';
  const delim = path.extname(file).toLowerCase() === '.tsv' ? '\t'
    : ((head.split('\t').length > head.split(',').length) ? '\t' : ',');
  const rows = parseDelimited(text, delim).filter(r => r.length > 1 || (r[0] || '').trim() !== '');
  if (!rows.length) return { 형식: 'CSV', 못읽음: '빈 파일이다' };
  const cols = rows[0].map(c => c.trim());
  const body = rows.slice(1);
  const ragged = body.filter(r => r.length !== cols.length).length;
  let blank = 0;
  for (const r of body) for (const c of r) if (String(c).trim() === '') blank++;
  return {
    형식: delim === '\t' ? 'TSV (탭)' : 'CSV (쉼표)',
    행: body.length,
    열: cols.length,
    열이름: cols,
    앞행: body.slice(0, nRows),
    빈칸: blank,
    열수가다른행: ragged,
  };
}

// ── xlsx ──────────────────────────────────────────────────

const PY_XLSX = `
import json, sys
try:
    from openpyxl import load_workbook
except Exception as e:
    print(json.dumps({"_못읽음": "openpyxl 이 없다 (pip install openpyxl)"})); sys.exit(0)
p, n = sys.argv[1], int(sys.argv[2])
wb = load_workbook(p, read_only=True, data_only=True)
sheets = []
for ws in wb.worksheets:
    it = ws.iter_rows(values_only=True)
    head = next(it, None) or ()
    rows = []
    for i, r in enumerate(it):
        if i >= n: break
        rows.append(["" if v is None else str(v) for v in r])
    sheets.append({
        "이름": ws.title,
        "행": (ws.max_row or 1) - 1,
        "열": ws.max_column or len(head),
        "열이름": ["" if v is None else str(v) for v in head],
        "앞행": rows,
    })
wb.close()
print(json.dumps({"시트": sheets}, ensure_ascii=False))
`;

function peekXlsx(file, nRows) {
  const r = python(PY_XLSX, [file, String(nRows)]);
  if (r._못읽음) return { 형식: 'XLSX', 못읽음: r._못읽음 };
  const first = r.시트[0] || {};
  return {
    형식: `XLSX (시트 ${r.시트.length})`,
    시트: r.시트,
    행: first.행, 열: first.열, 열이름: first.열이름, 앞행: first.앞행,
  };
}

// ── pdf ───────────────────────────────────────────────────

// 쪽 수는 라이브러리 없이 센다. /Type /Pages 의 /Count 를 먼저 보고, 없으면 /Type /Page 를 센다.
function pdfPages(buf) {
  const s = buf.toString('latin1');
  const counts = [...s.matchAll(/\/Type\s*\/Pages[^>]*?\/Count\s+(\d+)/g)].map(m => Number(m[1]));
  if (counts.length) return Math.max(...counts);
  const n = (s.match(/\/Type\s*\/Page[^s]/g) || []).length;
  return n || null;
}

const PY_PDF = `
import json, sys
try:
    import pdfplumber
except Exception:
    print(json.dumps({"_못읽음": "pdfplumber 가 없다 (pip install pdfplumber)"})); sys.exit(0)
with pdfplumber.open(sys.argv[1]) as pdf:
    pages = len(pdf.pages)
    first = (pdf.pages[0].extract_text() or "") if pages else ""
    tables = len(pdf.pages[0].extract_tables()) if pages else 0
print(json.dumps({"쪽": pages, "첫쪽글": first[:800], "첫쪽표": tables}, ensure_ascii=False))
`;

// 글을 뽑는 길 둘. pdfplumber 가 있으면 그것(표까지 센다), 없으면 pdftotext, 둘 다 없으면 쪽 수만 낸다.
function pdfText(file) {
  const r = python(PY_PDF, [file]);
  if (!r._못읽음) return { 글: r.첫쪽글, 첫쪽표: r.첫쪽표, 쪽: r.쪽, 길: 'pdfplumber' };
  try {
    const out = execFileSync('pdftotext', ['-f', '1', '-l', '1', '-q', file, '-'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 30000,
    });
    return { 글: out.slice(0, 800), 길: 'pdftotext' };
  } catch {
    return { 못읽은것: `글은 못 읽었다: ${r._못읽음}, pdftotext 도 없다` };
  }
}

function peekPdf(file) {
  const buf = fs.readFileSync(file);
  const pages = pdfPages(buf);
  const t = pdfText(file);
  return { 형식: 'PDF', 쪽: t.쪽 ?? pages, ...t };
}

// ── 그림 ──────────────────────────────────────────────────

// JPEG 는 SOF 표시(0xFFC0~0xFFCF, C4·C8·CC 빼고)에 세로·가로가 있다.
function jpegSize(buf) {
  if (buf.length < 4 || buf[0] !== 0xFF || buf[1] !== 0xD8) return null;
  let i = 2;
  while (i < buf.length - 9) {
    if (buf[i] !== 0xFF) { i++; continue; }
    const m = buf[i + 1];
    if (m === 0xD8 || m === 0x01 || (m >= 0xD0 && m <= 0xD7)) { i += 2; continue; }
    const len = buf.readUInt16BE(i + 2);
    if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) {
      return { 높이: buf.readUInt16BE(i + 5), 너비: buf.readUInt16BE(i + 7), 채널: buf[i + 9] };
    }
    i += 2 + len;
  }
  return null;
}

function pngSize(buf) {
  if (buf.length < 24 || buf.toString('latin1', 1, 4) !== 'PNG') return null;
  return { 너비: buf.readUInt32BE(16), 높이: buf.readUInt32BE(20), 비트: buf[24] };
}

function peekImage(file) {
  const buf = fs.readFileSync(file);
  const ext = path.extname(file).toLowerCase();
  const size = ext === '.png' ? pngSize(buf) : jpegSize(buf);
  if (!size) return { 형식: ext.slice(1).toUpperCase(), 못읽음: '그림 머리말을 못 읽었다 (깨졌거나 다른 형식이다)' };
  return { 형식: `${ext === '.png' ? 'PNG' : 'JPEG'} 그림`, 너비: size.너비, 높이: size.높이, 채널: size.채널 ?? size.비트 };
}

// ── 몸통 ──────────────────────────────────────────────────

function peek(file, nRows) {
  const ext = path.extname(file).toLowerCase();
  const base = { 파일: file, 크기: fs.statSync(file).size };
  let r;
  try {
    if (ext === '.csv' || ext === '.tsv' || ext === '.txt') r = peekDelimited(file, nRows);
    else if (ext === '.xlsx' || ext === '.xlsm') r = peekXlsx(file, nRows);
    else if (ext === '.pdf') r = peekPdf(file);
    else if (['.jpg', '.jpeg', '.png'].includes(ext)) r = peekImage(file);
    else r = { 형식: ext ? ext.slice(1).toUpperCase() : '모름', 못읽음: '읽는 법을 모르는 형식이다' };
  } catch (e) {
    r = { 형식: ext.slice(1).toUpperCase() || '모름', 못읽음: e.message };
  }
  return { ...base, ...r };
}

function table(cols, rows) {
  const w = cols.map((c, i) => Math.max([...String(c)].length, ...rows.map(r => [...String(r[i] ?? '')].length)));
  const line = a => '  | ' + a.map((v, i) => String(v ?? '').padEnd(w[i])).join(' | ') + ' |';
  return [line(cols), '  |' + w.map(x => '-'.repeat(x + 2)).join('|') + '|', ...rows.map(line)].join('\n');
}

function report(r) {
  console.log(`파일: ${r.파일}`);
  console.log(`형식: ${r.형식} · ${human(r.크기)}`);
  if (r.못읽음) { console.log(`못 읽었다: ${r.못읽음}`); return; }   // 파일 전체를 못 읽은 때

  if (r.시트) {
    for (const s of r.시트) console.log(`시트 "${s.이름}": ${s.행}행 · 열 ${s.열}`);
  }
  if (r.행 != null) console.log(`행 수: ${r.행} (머리줄 뺀 자료 행)`);
  if (r.열이름) console.log(`열 ${r.열}: ${r.열이름.join(' · ')}`);
  if (r.빈칸 != null) console.log(`빈칸: ${r.빈칸}${r.열수가다른행 ? ` · 열 수가 다른 행: ${r.열수가다른행}` : ''}`);
  if (r.쪽 != null) console.log(`쪽 수: ${r.쪽}`);
  if (r.너비) console.log(`크기: ${r.너비} × ${r.높이}`);
  if (r.첫쪽표 != null) console.log(`첫 쪽의 표: ${r.첫쪽표}`);

  if (r.앞행 && r.앞행.length) {
    console.log(`앞 ${r.앞행.length}행:`);
    console.log(table(r.열이름, r.앞행));
  }
  if (r.글) {
    console.log(`첫 쪽 글머리 (${r.길}):`);
    for (const l of String(r.글).split('\n').filter(x => x.trim()).slice(0, 5)) console.log(`  ${l}`);
  }
  // 파일은 열었으나 일부를 못 읽은 때. 아는 것을 낸 뒤에 말한다.
  if (r.못읽은것) console.log(`못 읽었다: ${r.못읽은것}`);
}

function main() {
  const args = process.argv.slice(2);
  const opt = { rows: 5, json: false };
  const pos = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--json') opt.json = true;
    else if (args[i] === '--rows') opt.rows = Number(args[++i]) || 5;
    else pos.push(args[i]);
  }
  const file = pos[0];
  if (!file) { process.stderr.write('쓰는 법: node scripts/peek.js <파일> [--rows N] [--json]\n'); process.exit(1); }
  if (!fs.existsSync(file)) { console.log(`못 읽었다: 파일이 없다 — ${file}`); process.exit(0); }

  const r = peek(file, opt.rows);
  if (opt.json) console.log(JSON.stringify(r, null, 2));
  else report(r);
}

if (require.main === module) main();

module.exports = { peek, jpegSize, pngSize, pdfPages, parseDelimited };
