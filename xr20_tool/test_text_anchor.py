#!/usr/bin/env python3
"""テキストアンカー（画面OCRによる位置ズレ補正）の検証テスト。

シナリオ:
  1. 基準画面（ラベル 型式/機番/測定日 + 傾セル）でアンカーを登録
  2. 内容を右下に大きくズラした画面を作る（『画面の位置が変更される』を模擬）
  3. 補正なし → 傾セルが読めない（ズレの実害を確認）
  4. 補正あり → ラベル位置からズレ量を検出し、傾セルが正しく読める

使い方: python xr20_tool/test_text_anchor.py
必要: pillow, pytesseract(+jpn), IPAゴシック等の日本語フォント
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from PIL import Image, ImageDraw, ImageFont
import xr20_monitor as xm

W, H = 1900, 1040

# 設計フラクション（基準時のレイアウト）
LABELS = {"型式": (0.12, 0.19), "機番": (0.12, 0.23), "測定日": (0.12, 0.15)}
TILT_RECT = {"HR": [0.610, 0.155, 0.045, 0.030]}
NO_RECT = {"HR": [0.362, 0.155, 0.022, 0.030]}
LAMP_RECT = {"HR": [0.395, 0.155, 0.022, 0.030]}
TILT_VAL = "-7"


def _font(jp: bool, size: int) -> ImageFont.ImageFont:
    paths = (["/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf",
              "/usr/share/fonts/truetype/fonts-japanese-gothic.ttf"] if jp else
             ["/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf"])
    for p in paths:
        if Path(p).exists():
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def build_screen(shift: tuple[float, float]) -> Image.Image:
    """shift=(dxf, dyf) だけ内容を平行移動した画面を生成。"""
    dx, dy = shift
    img = Image.new("RGB", (W, H), (212, 208, 200))
    d = ImageDraw.Draw(img)
    fj = _font(True, 24)
    fn = _font(False, 22)

    for label, (xf, yf) in LABELS.items():
        d.text((int((xf + dx) * W), int((yf + dy) * H)), label, fill=(0, 0, 0), font=fj)

    def cell(rel, text, align="right"):
        x0 = int((rel[0] + dx) * W); y0 = int((rel[1] + dy) * H)
        x1 = int((rel[0] + rel[2] + dx) * W); y1 = int((rel[1] + rel[3] + dy) * H)
        d.rectangle([x0, y0, x1, y1], fill=(255, 255, 255), outline=(120, 120, 120))
        bb = d.textbbox((0, 0), text, font=fn)
        tw, th = bb[2] - bb[0], bb[3] - bb[1]
        tx = x1 - tw - 4 if align == "right" else x0 + 4
        d.text((tx, y0 + (y1 - y0 - th) // 2 - bb[1]), text, fill=(0, 0, 0), font=fn)

    cell(TILT_RECT["HR"], TILT_VAL)
    cell(NO_RECT["HR"], "1", align="left")
    lr = LAMP_RECT["HR"]
    d.ellipse([int((lr[0] + dx) * W), int((lr[1] + dy) * H),
               int((lr[0] + lr[2] + dx) * W), int((lr[1] + lr[3] + dy) * H)],
              fill=tuple(xm.MonitorConfig().lamp_on_color))
    return img


def make_monitor(use_anchor: bool) -> xm.XR20Monitor:
    cfg = xm.MonitorConfig()
    cfg.use_text_anchor = use_anchor
    cfg.use_template_anchor = False  # テンプレ照合は使わない（テキストのみ検証）
    cfg.target_rows = ["HR"]
    cfg.tilt_rects = {k: list(v) for k, v in TILT_RECT.items()}
    cfg.no_column_rects = {k: list(v) for k, v in NO_RECT.items()}
    cfg.lamp_rects = {k: list(v) for k, v in LAMP_RECT.items()}
    m = xm.XR20Monitor(cfg, log_cb=lambda s: print("   ", s.split("] ", 1)[-1]))
    m._locator.set_fake_rect((0, 0, W, H))
    return m


def read_tilt(m: xm.XR20Monitor, img: Image.Image) -> float | None:
    m._sampler.set_fake_image(img)
    snap = m.take_snapshot(read_no=True, read_tilt=True,
                           read_comment=False, read_meta=False, do_anchor=True)
    return snap.tilt_values.get("HR")


def main() -> int:
    base = build_screen((0.0, 0.0))
    shifted = build_screen((0.06, 0.05))  # 内容が右へ6%・下へ5%動いた状態
    base.save("/tmp/_ta_base.png")
    shifted.save("/tmp/_ta_shifted.png")
    expected = float(TILT_VAL)
    ok_all = True

    print("=== 1) 基準画面で登録＋読取 ===")
    m = make_monitor(use_anchor=True)
    n = m.register_text_anchors(base)
    got = read_tilt(m, base)
    ok = n >= 2 and got == expected
    ok_all &= ok
    print(f"  [{'OK' if ok else 'NG'}] アンカー登録 {n}個 / 傾={got} (期待 {expected})")

    print("=== 2) 内容がズレた画面・補正なし（ズレの実害を確認） ===")
    m2 = make_monitor(use_anchor=False)
    m2.cfg.text_anchor_refs = dict(m.cfg.text_anchor_refs)
    got2 = read_tilt(m2, shifted)
    ok2 = got2 != expected  # ズレてるので正しく読めないはず
    ok_all &= ok2
    print(f"  [{'OK' if ok2 else 'NG'}] 補正なしでは読めない: 傾={got2}")

    print("=== 3) 内容がズレた画面・テキストアンカー補正あり ===")
    m3 = make_monitor(use_anchor=True)
    m3.cfg.text_anchor_refs = dict(m.cfg.text_anchor_refs)
    got3 = read_tilt(m3, shifted)
    ok3 = got3 == expected
    ok_all &= ok3
    print(f"  [{'OK' if ok3 else 'NG'}] 補正ありで正しく読める: 傾={got3} (期待 {expected})")

    print(f"\n結果: {'全部OK' if ok_all else 'NGあり'}")
    return 0 if ok_all else 1


if __name__ == "__main__":
    sys.exit(main())
