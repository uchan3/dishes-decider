#!/usr/bin/env python3
"""PWA のアイコン（192/512 の PNG）を生成する。

依存を増やさずにアイコンを再生成できるよう、標準ライブラリだけで PNG を書き出す
（画像処理ライブラリを入れるほどの絵ではないため）。デザインはブランド色の背景に
白い皿を描いただけの単純なもの。maskable 用に内容を中央 68% に収めている。

使い方:
    python3 apps/web/scripts/generate-icons.py
"""

from __future__ import annotations

import pathlib
import struct
import zlib

# ブランド色（apps/web/src/index.css の --primary と揃える）。
BACKGROUND = (0x2F, 0x85, 0x5A)
PLATE = (0xFF, 0xFF, 0xFF)

OUT_DIR = pathlib.Path(__file__).resolve().parent.parent / "public"
SIZES = (192, 512)


def _pixel(x: int, y: int, size: int) -> tuple[int, int, int]:
    """1 ピクセルの色を返す。中心からの距離で皿とリムを描き分ける。"""
    cx = cy = (size - 1) / 2
    # 半径は size 比で持ち、どのサイズでも同じ見た目になるようにする。
    dist = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5 / size

    if dist <= 0.34:  # 皿本体
        # 内側のリム（皿のふち）を背景色で細く抜く。
        if 0.235 <= dist <= 0.255:
            return BACKGROUND
        return PLATE
    return BACKGROUND


def _png_bytes(size: int) -> bytes:
    """RGB の PNG バイト列を組み立てる（フィルタ 0 の素直なスキャンライン）。"""
    raw = bytearray()
    for y in range(size):
        raw.append(0)  # filter type: None
        for x in range(size):
            raw.extend(_pixel(x, y, size))

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    header = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)  # 8bit RGB
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for size in SIZES:
        path = OUT_DIR / f"icon-{size}.png"
        path.write_bytes(_png_bytes(size))
        print(f"wrote {path.relative_to(OUT_DIR.parent.parent.parent)} ({size}x{size})")


if __name__ == "__main__":
    main()
