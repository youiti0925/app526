#!/usr/bin/env python3
"""実画面を模した2サイズの画像で、位置自動補正(テンプレート)が
ウィンドウのサイズ変化を吸収できるかを実コードで検証する。

シナリオ:
  画像A = 設計サイズ（最大化想定）。ここで矩形と目印を登録。
  画像B = 内容が縮小＋移動した状態（最大化解除を模擬）。
          固定座標だと読めない／位置補正ONなら読める ことを確認。

使い方: python xr20_tool/test_anchor_real.py
必要: pillow, pytesseract(+eng), opencv-python(cv2), numpy
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from PIL import Image, ImageDraw, ImageFont
import xr20_monitor as xm

LAB_GRAY = (212, 208, 200)
CELL_BG = (255, 255, 255)

# 設計レイアウト（フラクション）: 実画面の配置を踏襲
MODEL_LABEL = (0.118, 0.185, 0.045, 0.030)   # 「型式」ラベル → 目印A
HEADER = (0.455, 0.115, 0.230, 0.030)        # ヘッダー帯 → 目印B
MODEL_VAL = (0.160, 0.183, 0.150, 0.032, "RWA-320R")
MACHINE_VAL = (0.160, 0.225, 0.120, 0.032, "260177DRY")
ROW_Y = {"HR": 0.150, "WR": 0.193, "WL": 0.236, "HL": 0.279}
NO_VALS = {"HR": "1", "WR": "3", "WL": "4", "HL": "2"}
TILT_VALS = {"HR": "1", "WR": "-1", "WL": "-2", "HL": "-0"}
NO_X, LAMP_X, TILT_X = 0.362, 0.395, 0.610
CELL_W, CELL_H = 0.022, 0.030
TILT_W = 0.045


def _font(jp: bool, size: int) -> ImageFont.ImageFont:
    paths = (["/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf",
              "/usr/share/fonts/truetype/fonts-japanese-gothic.ttf"] if jp else
             ["/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf",
              "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"])
    for p in paths:
        if Path(p).exists():
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def draw_screen(W: int, H: int, tf: tuple[float, float, float, float]) -> Image.Image:
    """tf=(sx,sy,ox,oy) を設計フラクションに掛けて描画（内容の縮小/移動を模擬）。"""
    sx, sy, ox, oy = tf
    img = Image.new("RGB", (W, H), LAB_GRAY)
    d = ImageDraw.Draw(img)
    fj = _font(True, max(12, int(0.020 * H * sy)))
    fn = _font(False, max(12, int(0.020 * H * sy)))

    def rect(xf, yf, wf, hf):
        x = (sx * xf + ox) * W
        y = (sy * yf + oy) * H
        return [x, y, x + wf * sx * W, y + hf * sy * H]

    def cell(xf, yf, wf, hf, text, font, bg=CELL_BG, align="center"):
        box = rect(xf, yf, wf, hf)
        d.rectangle(box, fill=bg, outline=(120, 120, 120))
        if text:
            bb = d.textbbox((0, 0), text, font=font)
            tw, th = bb[2] - bb[0], bb[3] - bb[1]
            if align == "left":
                tx = box[0] + 4
            elif align == "right":
                tx = box[2] - tw - 4
            else:
                tx = box[0] + (box[2] - box[0] - tw) / 2
            d.text((tx, box[1] + (box[3] - box[1] - th) / 2 - bb[1]), text, fill=(0, 0, 0), font=font)

    # 目印A: 「型式」ラベル（グレー地に黒文字）
    box = rect(*MODEL_LABEL)
    d.text((box[0], box[1]), "型式", fill=(0, 0, 0), font=fj)
    # 目印B: ヘッダー帯
    box = rect(*HEADER)
    d.text((box[0], box[1]), "間隔 1/N 点数 傾 精度 精度", fill=(0, 0, 0), font=fj)

    # 実画面に合わせ、型式・機番は左寄せ、傾は右寄せ
    cell(*MODEL_VAL[:4], MODEL_VAL[4], fn, align="left")
    cell(*MACHINE_VAL[:4], MACHINE_VAL[4], fn, align="left")
    for r, yf in ROW_Y.items():
        cell(NO_X, yf, CELL_W, CELL_H, NO_VALS[r], fn, align="center")
        # ランプ（緑丸）
        lb = rect(LAMP_X, yf, CELL_W, CELL_H)
        d.ellipse(lb, fill=tuple(xm.MonitorConfig().lamp_on_color))
        cell(TILT_X, yf, TILT_W, CELL_H, TILT_VALS[r], fn, align="right")
    return img


def make_cfg(base_dir: Path, anchor: bool) -> xm.MonitorConfig:
    c = xm.MonitorConfig()
    c.use_template_anchor = anchor
    c.model_rect = list(MODEL_VAL[:4])
    c.machine_rect = list(MACHINE_VAL[:4])
    c.anchor_a_rect = list(MODEL_LABEL)
    c.anchor_b_rect = list(HEADER)
    c.no_column_rects = {r: [NO_X, y, CELL_W, CELL_H] for r, y in ROW_Y.items()}
    c.lamp_rects = {r: [LAMP_X, y, CELL_W, CELL_H] for r, y in ROW_Y.items()}
    c.tilt_rects = {r: [TILT_X, y, TILT_W, CELL_H] for r, y in ROW_Y.items()}
    c.csv_log_path = str(base_dir / "_d.csv")
    c.summary_csv_path = str(base_dir / "_s.csv")
    return c


def snapshot_on(img: Image.Image, cfg: xm.MonitorConfig, base_dir: Path) -> xm.Snapshot:
    m = xm.XR20Monitor(cfg, log_cb=lambda s: None)
    m._template_path = lambda name: base_dir / name  # type: ignore
    m._locator.set_fake_rect((0, 0, img.width, img.height))
    m._sampler.set_fake_image(img)
    return m.take_snapshot()


def check(snap: xm.Snapshot, label: str) -> bool:
    exp_tilt = {"HR": 1.0, "WR": -1.0, "WL": -2.0, "HL": 0.0}
    ok = True
    reasons = []
    if snap.model_name != "RWA-320R":
        ok = False; reasons.append(f"型式={snap.model_name!r}")
    if snap.machine_no != "260177DRY":
        ok = False; reasons.append(f"機番={snap.machine_no!r}")
    for r, e in exp_tilt.items():
        got = snap.tilt_values.get(r)
        if got is None or abs(got - e) > 0.5:
            ok = False; reasons.append(f"傾[{r}]={got}(期待{e})")
    for r in ("HR", "WR", "WL", "HL"):
        if snap.lamp_states.get(r) != "ON":
            ok = False; reasons.append(f"ランプ[{r}]={snap.lamp_states.get(r)}")
    print(f"  [{'OK' if ok else 'NG'}] {label}")
    if not ok:
        print(f"        理由: {', '.join(reasons)}")
    return ok


def main() -> int:
    base = Path("/tmp")
    # 画像A（設計サイズ）で目印テンプレを作成
    imgA = draw_screen(1900, 1040, (1.0, 1.0, 0.0, 0.0))
    imgA.save(base / "_screenA.png")
    W, H = imgA.size
    for key, rel in [("anchor_a.png", MODEL_LABEL), ("anchor_b.png", HEADER)]:
        x0, y0 = int(rel[0] * W), int(rel[1] * H)
        x1, y1 = int((rel[0] + rel[2]) * W), int((rel[1] + rel[3]) * H)
        imgA.crop((x0, y0, x1, y1)).save(base / key)

    # 画像B: 内容を縮小0.92＋右3%/下2.5%移動（最大化解除の模擬）
    imgB = draw_screen(1900, 1040, (0.92, 0.92, 0.03, 0.025))
    imgB.save(base / "_screenB.png")

    print("=== 画像A（登録時と同じサイズ）===")
    a_ok = check(snapshot_on(imgA, make_cfg(base, anchor=True), base), "画像A / 補正ON")

    print("=== 画像B（縮小・移動後）===")
    b_off = check(snapshot_on(imgB, make_cfg(base, anchor=False), base), "画像B / 補正OFF（固定座標）")
    b_on = check(snapshot_on(imgB, make_cfg(base, anchor=True), base), "画像B / 補正ON（テンプレート）")

    print("\n=== 判定 ===")
    print(f"  画像A 補正ON         : {'OK' if a_ok else 'NG'}")
    print(f"  画像B 補正OFF(固定)  : {'読めない想定' if not b_off else '読めた(=ズレ無し?)'}")
    print(f"  画像B 補正ON(目的)   : {'OK 補正が効いた' if b_on else 'NG 補正が効かない'}")
    # 期待: A=OK, B補正ON=OK。B補正OFFは崩れて当然（補正の必要性を示す）
    return 0 if (a_ok and b_on) else 1


if __name__ == "__main__":
    sys.exit(main())
