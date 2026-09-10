#!/bin/bash
# crew 봇 상태줄 — 터미널 다섯을 띄워 놓고 어느 것이 누구인지 한눈에 보려는 것이다.
#
# 세 가지를 지킨다.
#  1. PATH 에 기대지 않는다. Claude Code 는 이 명령을 PATH 가 빈 환경에서 부른다(실측) —
#     그러면 basename·head·jq·git 이 전부 실패해 로봇 이모지 하나만 남는다.
#     그래서 PATH 를 손수 채우고, 이름과 방은 외부 명령 없이 bash 문법만으로 구한다.
#  2. 바깥 것에 기대지 않는다. jq 가 없어도, 사람의 ~/.claude 설정이 없어도 돈다.
#  3. 누구인지·어느 방인지는 stdin 이 아니라 파일에서 읽는다. stdin 이 비어도 틀리지 않는다.
#
# 보이는 것: 봇 이름 · 방 · 모델 · 문맥 사용률 · 브랜치
set -u
export PATH="${PATH:-}:/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:/opt/homebrew/bin"

input=$(cat 2>/dev/null || true)

# ── JSON 읽기: jq 가 있으면 jq, 없으면 sed. 둘 다 없으면 그 칸을 비운다 ──
if command -v jq >/dev/null 2>&1; then
  jstr() { printf '%s' "$input" | jq -r "$1 // empty" 2>/dev/null; }
elif command -v sed >/dev/null 2>&1; then
  jstr() {
    local key="${1##*.}"
    printf '%s' "$input" \
      | sed -n "s/.*\"${key}\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p;s/.*\"${key}\"[[:space:]]*:[[:space:]]*\([0-9][0-9.]*\).*/\1/p" \
      | head -1
  }
else
  jstr() { :; }
fi

# ── 누구인가 · 어디인가 ──
# 외부 명령 없이 구한다: basename 대신 ${var##*/}, cat 대신 read.
dir=$(jstr '.workspace.current_dir'); [ -z "$dir" ] && dir=$(jstr '.cwd'); [ -z "$dir" ] && dir="$PWD"
dir="${dir%/}"
bot="${dir##*/}"
[ -z "$bot" ] && bot="?"

room=""
if [ -r "$dir/current-room" ]; then
  read -r room < "$dir/current-room" 2>/dev/null || room=""
  room="${room%$'\r'}"
fi

segs="🤖 ${bot}"
[ -n "$room" ] && segs="${segs} · 🏠 ${room}"

# ── 모델 ──
# 못 읽으면 "Claude" 같은 엉뚱한 기본값을 보이지 않고 그 칸을 비운다.
# 대신 받은 입력을 한 벌 남겨 둔다 — 왜 없는지는 그 파일을 보면 안다 (gitignore 됨).
model=$(jstr '.model.display_name'); [ -z "$model" ] && model=$(jstr '.model.id')
if [ -n "$model" ]; then
  segs="${segs} · ${model}"
elif [ -n "$input" ] && [ -w "$dir" ]; then
  printf '%s' "$input" > "$dir/.statusline-debug.json" 2>/dev/null || true
fi

# ── 문맥 사용률 (압축 문턱이 65% 라 이 숫자가 곧 남은 여유다) ──
cw=$(jstr '.context_window.used_percentage')
if [ -n "$cw" ]; then
  pct=${cw%%.*}
  case "$pct" in ''|*[!0-9]*) pct="" ;; esac
  if [ -n "$pct" ]; then
    mark=""
    [ "$pct" -ge 55 ] && mark=" ⚠"
    [ "$pct" -ge 65 ] && mark=" 🔴"
    segs="${segs} · CW ${pct}%${mark}"
  fi
fi

# ── 브랜치 (봇은 방 저장소가 아니라 crew 저장소 안에서 뜬다) ──
if command -v git >/dev/null 2>&1 && git -C "$dir" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  br=$(git -C "$dir" branch --show-current 2>/dev/null)
  [ -n "$br" ] && segs="${segs} · 🌿 ${br}"
fi

printf '%s\n' "$segs"
exit 0
