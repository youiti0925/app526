#!/usr/bin/env python3
"""合成画像を生成し XR20Monitor.take_snapshot() を検証する自動テスト.

実機・画面キャプチャ・pywinauto・Tk を一切使わずに、色判定と OCR の
パイプラインが既定矩形で正しく動作するかを確認する。

使い方:
    python xr20_tool/test_synthetic.py
    # IDLE 状態と CAPTURING 状態 (= 押下中 + 一部 OFF ランプ) の 2 シナリオを検証
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from PIL import Image, ImageDraw, ImageFont

import xr20_monitor as xm

WIDTH, HEIGHT = 1919, 958

# テストデータ: 行 -> (No番号 or None, ランプON/OFF, 傾値)
SCENARIO_IDLE = {
    "HR": (1, "ON", "-3420"),
    "WR": (2, "ON", "-5344"),
    "WL": (3, "ON", "-1227"),
    "HL": (4, "ON", "11880"),
}
# 測定進行中: HR/WR 済み (ON) / WL/HL 未実施 (OFF)、ボタン押下中
SCENARIO_CAPTURING = {
    "HR": (1, "ON", "-3420"),
    "WR": (2, "ON", "-5344"),
    "WL": (3, "OFF", ""),
    "HL": (4, "OFF", ""),
}


def _fill_rel(draw: ImageDraw.ImageDraw, rel: list[float], color: tuple[int, int, int]) -> None:
    x = int(rel[0] * WIDTH)
    y = int(rel[1] * HEIGHT)
    w = int(rel[2] * WIDTH)
    h = int(rel[3] * HEIGHT)
    draw.rectangle([x, y, x + w, y + h], fill=color)


def _text_rel(draw: ImageDraw.ImageDraw, rel: list[float], text: str, font: ImageFont.ImageFont) -> None:
    if not text:
        return
    x = int(rel[0] * WIDTH)
    y = int(rel[1] * HEIGHT)
    w = int(rel[2] * WIDTH)
    h = int(rel[3] * HEIGHT)
    # 白背景に黒文字（LabVIEW の表示セル風）
    draw.rectangle([x, y, x + w, y + h], fill=(255, 255, 255))
    bbox = draw.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    draw.text((x + (w - tw) // 2, y + (h - th) // 2 - 2), text, fill=(0, 0, 0), font=font)


def _find_font(size: int) -> ImageFont.ImageFont:
    for path in [
        "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf",
    ]:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def build_image(cfg: xm.MonitorConfig, rows_data: dict, button_pressed: bool) -> Image.Image:
    img = Image.new("RGB", (WIDTH, HEIGHT), (240, 240, 240))
    draw = ImageDraw.Draw(img)

    # ボタン
    btn_color = tuple(cfg.button_active_color) if button_pressed else tuple(cfg.button_idle_color)
    _fill_rel(draw, cfg.button_capture_rect, btn_color)

    no_font = _find_font(22)
    tilt_font = _find_font(20)

    for row, (no_val, lamp_state, tilt_val) in rows_data.items():
        # No 列
        rel_no = cfg.no_column_rects[row]
        if no_val is not None:
            _text_rel(draw, rel_no, str(no_val), no_font)
        else:
            _fill_rel(draw, rel_no, (255, 255, 255))

        # ランプ（矩形塗り＋内側の円）
        rel_lamp = cfg.lamp_rects[row]
        lamp_color = tuple(cfg.lamp_on_color) if lamp_state == "ON" else tuple(cfg.lamp_off_color)
        _fill_rel(draw, rel_lamp, lamp_color)

        # 傾列
        rel_tilt = cfg.tilt_rects[row]
        _text_rel(draw, rel_tilt, tilt_val, tilt_font)

    return img


def run_scenario(name: str, rows_data: dict, button_pressed: bool) -> tuple[int, int]:
    cfg = xm.MonitorConfig()
    img = build_image(cfg, rows_data, button_pressed)
    out_path = Path(__file__).parent / f"_test_{name}.png"
    img.save(out_path)

    monitor = xm.XR20Monitor(cfg, log_cb=lambda m: None)
    monitor._locator.set_fake_rect((0, 0, WIDTH, HEIGHT))
    monitor._sampler.set_fake_image(img)

    snap = monitor.take_snapshot()

    expected_active = [r for r, (n, *_rest) in rows_data.items() if n is not None]
    expected_lamps = {r: lamp for r, (_n, lamp, _t) in rows_data.items()}
    expected_tilts = {r: float(t) for r, (_n, _l, t) in rows_data.items() if t}

    passed = 0
    failed = 0

    def check(cond: bool, label: str, detail: str = "") -> None:
        nonlocal passed, failed
        if cond:
            print(f"  [OK] {label}")
            passed += 1
        else:
            print(f"  [FAIL] {label}  {detail}")
            failed += 1

    print(f"=== シナリオ: {name} (button_pressed={button_pressed}) ===")
    print(f"  window_ok = {snap.window_ok}, button_pressed = {snap.button_pressed}, "
          f"button_color = {snap.button_color}")
    print(f"  active_rows  = {snap.active_rows}")
    print(f"  lamp_states  = {snap.lamp_states}")
    print(f"  tilt_values  = {snap.tilt_values}")
    print(f"  raw_no       = {snap.raw_no}")
    print(f"  raw_tilt     = {snap.raw_tilt}")

    check(snap.window_ok, "window 検出")
    check(snap.button_pressed == button_pressed,
          f"button_pressed = {button_pressed}",
          f"got={snap.button_pressed}")
    check(sorted(snap.active_rows) == sorted(expected_active),
          f"active_rows = {expected_active}",
          f"got={snap.active_rows}")
    for r in cfg.target_rows:
        check(snap.lamp_states.get(r) == expected_lamps[r],
              f"lamp[{r}] = {expected_lamps[r]}",
              f"got={snap.lamp_states.get(r)}")
    for r, expected in expected_tilts.items():
        got = snap.tilt_values.get(r)
        if got is None:
            check(False, f"tilt[{r}] = {expected}", "OCR returned None")
        else:
            check(abs(got - expected) < 0.5,
                  f"tilt[{r}] ≈ {expected}",
                  f"got={got}")

    return passed, failed


def main() -> int:
    total_pass = 0
    total_fail = 0
    for name, data, pressed in [
        ("idle_complete", SCENARIO_IDLE, False),
        ("capturing_partial", SCENARIO_CAPTURING, True),
    ]:
        p, f = run_scenario(name, data, pressed)
        total_pass += p
        total_fail += f
        print()
    print(f"=== 合計: {total_pass} 成功 / {total_fail} 失敗 ===")
    return 0 if total_fail == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
