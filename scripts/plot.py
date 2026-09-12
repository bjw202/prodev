#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""plot.py — csv 의 열 하나를 그림 한 장으로. 들이기(6.1)에서 "그림이 낫다" 싶을 때만 쓴다.

  python3 scripts/plot.py <csv> --y <열> [--x <열>] [--kind line|bar|scatter]
                          [--project <과제폴더>] [--out <경로>] [--title <제목>]

그림은 <과제폴더>/tmp/ 에 둔다. tmp/ 는 gitignore 이고, 봇 첨부 뿌리 안이라 그대로 첨부된다.
matplotlib 이 없으면 죽지 않는다. "못 그렸다: <까닭>" 한 줄을 내고 exit 0 이다 — 들이기가 멈추면 안 된다.

읽는 법은 csv 표준 모듈만 쓴다. 숫자로 못 바꾸는 칸은 빈칸으로 보고 세어서 알린다.
"""

import argparse
import csv
import os
import sys

# 내는 글은 언제나 UTF-8 이다. 윈도우 파이썬은 stdout 을 **콘솔 코드페이지**로 인코딩하는데
# (한국어 기계면 cp949) 이 글을 읽는 쪽 — 노드(peek·intake)와 봇의 Bash 도구 — 은 UTF-8 로 읽는다.
# 그러면 "그림: <경로>" 와 "못 그렸다: <까닭>" 이 `?????` 로 깨진 채 카드에 들어간다. 오류는 안 난다
# (2026-09-12 윈도우 실측). 부르는 쪽의 환경변수에 기대지 않고 이 파일이 스스로 못 박는다 —
# 봇이 Bash 로 직접 부르는 자리도 있어서다. 맥·리눅스는 이미 UTF-8 이라 아무것도 바뀌지 않는다.
for _스트림 in (sys.stdout, sys.stderr):
    try:
        _스트림.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):     # 파이썬 3.6 이하거나 다시 설정할 수 없는 스트림
        pass


def die_soft(msg):
    print("못 그렸다: %s" % msg)
    sys.exit(0)


def read_csv(path):
    with open(path, newline="", encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))
    if not rows:
        die_soft("빈 파일이다: %s" % path)
    return rows


def as_number(v):
    try:
        return float(str(v).replace(",", "").strip())
    except (TypeError, ValueError):
        return None


def main():
    ap = argparse.ArgumentParser(add_help=True)
    ap.add_argument("csv_path")
    ap.add_argument("--y", required=True, help="세로축 열 이름")
    ap.add_argument("--x", default=None, help="가로축 열 이름 (없으면 행 번호)")
    ap.add_argument("--kind", default="line", choices=["line", "bar", "scatter"])
    ap.add_argument("--project", default=os.environ.get("PRODEV_PROJECT") or os.getcwd())
    ap.add_argument("--out", default=None)
    ap.add_argument("--title", default=None)
    a = ap.parse_args()

    if not os.path.exists(a.csv_path):
        die_soft("파일이 없다: %s" % a.csv_path)

    rows = read_csv(a.csv_path)
    cols = list(rows[0].keys())
    if a.y not in cols:
        die_soft("열이 없다: %s (있는 열: %s)" % (a.y, " · ".join(cols)))
    if a.x is not None and a.x not in cols:
        die_soft("열이 없다: %s (있는 열: %s)" % (a.x, " · ".join(cols)))

    ys, xs, dropped = [], [], 0
    for i, r in enumerate(rows):
        v = as_number(r.get(a.y))
        if v is None:
            dropped += 1
            continue
        ys.append(v)
        xs.append(r.get(a.x) if a.x else i + 1)
    if not ys:
        die_soft("%s 에 숫자가 하나도 없다" % a.y)

    try:
        import matplotlib
        matplotlib.use("Agg")          # 화면이 없는 자리에서 돈다
        import matplotlib.pyplot as plt
    except Exception as e:
        die_soft("matplotlib 이 없다 (pip install matplotlib) — %s" % e)

    out = a.out
    if not out:
        stem = os.path.splitext(os.path.basename(a.csv_path))[0]
        out = os.path.join(a.project, "tmp", "%s-%s.png" % (stem, a.y))
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)

    fig, ax = plt.subplots(figsize=(8, 4))
    if a.kind == "bar":
        ax.bar(range(len(ys)), ys)
        ax.set_xticks(range(len(ys)))
        ax.set_xticklabels([str(x) for x in xs], rotation=90, fontsize=6)
    elif a.kind == "scatter":
        ax.scatter(range(len(ys)), ys, s=12)
        ax.set_xticks(range(len(ys)))
        ax.set_xticklabels([str(x) for x in xs], rotation=90, fontsize=6)
    else:
        ax.plot(range(len(ys)), ys, marker="o", markersize=3, linewidth=1)
        step = max(1, len(xs) // 20)
        ax.set_xticks(range(0, len(xs), step))
        ax.set_xticklabels([str(xs[i]) for i in range(0, len(xs), step)], rotation=90, fontsize=6)

    # 제목·축 이름은 열 이름 그대로 둔다. 뜻을 지어내지 않는다 (뜻은 files.md 가 갖는다).
    ax.set_title(a.title or "%s (%s)" % (a.y, os.path.basename(a.csv_path)))
    ax.set_xlabel(a.x or "행")
    ax.set_ylabel(a.y)
    ax.grid(True, alpha=0.3)
    fig.tight_layout()
    fig.savefig(out, dpi=110)
    plt.close(fig)

    print("그림: %s" % out)
    print("점 %d개%s" % (len(ys), (" · 숫자가 아니라 뺀 행 %d" % dropped) if dropped else ""))


if __name__ == "__main__":
    main()
