# -*- coding: utf-8 -*-
"""스프라이트 시트 품질 검사. 생성 모델이 만든 프레임에서 눈에 띄는 결함을 숫자로 잡는다.

걷기는 프레임 간 일관성이 생명이라 정면 샷보다 까다롭다. 지금까지 얼룩 픽셀·화면 패닝·
몸 흔들림·옷 색 변질을 모두 겪었다. 통과한 것만 리포에 넣는다.

사용법:  python check.py ../../public/sprites/commute/m1
"""
import json
import os
import sys

from PIL import Image

MAX_DRIFT = 6  # 프레임 간 바운딩박스 이동 허용치(px) — 걷기 보폭
PALETTE_TOL = 2  # 기준에 없던 색 허용 개수


def frames(sheet, n):
    w = sheet.width // n
    return [sheet.crop((i * w, 0, (i + 1) * w, sheet.height)) for i in range(n)]


def bbox_drift(ims):
    """프레임 간 바운딩박스가 얼마나 흔들리는지.

    같은 엣지끼리 비교해야 '이동량'이 된다. 네 엣지를 한데 모아 max-min을 하면
    캐릭터의 폭·높이가 나와 버린다."""
    bbs = [im.getbbox() for im in ims if im.getbbox()]
    if not bbs:
        return None
    span = lambda i: max(b[i] for b in bbs) - min(b[i] for b in bbs)
    return max(span(0), span(2)), max(span(1), span(3))


def lone_pixels(im):
    """사방이 투명한 1px 점 — 생성 노이즈"""
    px = im.load()
    w, h = im.size
    n = 0
    for y in range(h):
        for x in range(w):
            if px[x, y][3] == 0:
                continue
            near = 0
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                a, b = x + dx, y + dy
                if 0 <= a < w and 0 <= b < h and px[a, b][3] > 0:
                    near += 1
            if near == 0:
                n += 1
    return n


def palette(im):
    px = im.load()
    return {px[x, y][:3] for y in range(im.height) for x in range(im.width) if px[x, y][3] > 0}


def check(folder):
    man = json.load(open(os.path.join(folder, "manifest.json"), encoding="utf-8"))
    base_pal = None
    bad = []
    for key, v in sorted(man.items()):
        sheet = Image.open(os.path.join(folder, v["file"])).convert("RGBA")
        n = v["frames"]
        if sheet.width != v["w"] * n or sheet.height != v["h"]:
            bad.append(f"{key}: 시트 크기 {sheet.size}가 manifest({v['w']}x{v['h']} x{n})와 다름")
            continue
        ims = frames(sheet, n)
        drift = bbox_drift(ims)
        if drift and (drift[0] > MAX_DRIFT or drift[1] > MAX_DRIFT):
            bad.append(f"{key}: 캐릭터 흔들림 가로 {drift[0]}px 세로 {drift[1]}px (허용 {MAX_DRIFT})")
        lone = sum(lone_pixels(im) for im in ims)
        if lone:
            bad.append(f"{key}: 고립 픽셀 {lone}개")
        pal = set().union(*(palette(im) for im in ims))
        if base_pal is None:
            base_pal = pal
        else:
            extra = pal - base_pal
            if len(extra) > PALETTE_TOL:
                bad.append(f"{key}: 기준에 없던 색 {len(extra)}종")
        print(f"  {key:16} {n:2}프레임  흔들림 {drift}  고립 {lone}  색 {len(pal)}")
    return bad


if __name__ == "__main__":
    folder = sys.argv[1]
    print(f"검사: {folder}")
    problems = check(folder)
    if problems:
        print("\n문제:")
        for b in problems:
            print("  -", b)
        sys.exit(1)
    print("\n전부 통과")
