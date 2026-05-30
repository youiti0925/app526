#!/usr/bin/env python3
"""実画面の状況を再現して、確認ダイアログ検出と SwitchBot パターン
を実コードで検証する自動テスト。

ユーザー提供のスクショから読み取った座標で:
  ・LabVIEW画面に確認ダイアログがオーバーレイした状態の画像を作り
  ・矩形を登録した状態を再現して _dismiss_confirm_dialog を実行
  ・ダイアログあり = True を返すこと
  ・ダイアログなし = False を返すこと（誤検知しない）
を確認する。

使い方: python xr20_tool/test_real_scenarios.py
"""
from __future__ import annotations
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from PIL import Image, ImageDraw, ImageFont
import xr20_monitor as xm

W, H = 1900, 1040  # LabVIEW 全画面想定（ユーザー画面と同等）

# ユーザースクショから読み取ったダイアログ位置（中央付近に出る）
DLG_LEFT, DLG_TOP, DLG_RIGHT, DLG_BOT = 810, 440, 1100, 600
# 「データが保存されていません」テキストの想定範囲（出現検知用）
DET_RECT = [(820 - 0) / W, 465 / H, (1080 - 820) / W, 30 / H]
# 「測定開始」ボタンの想定範囲（押下用）
BTN_RECT = [820 / W, 555 / H, (940 - 820) / W, (585 - 555) / H]


def _font(jp: bool, size: int) -> ImageFont.ImageFont:
    jp_paths = [
        "/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf",
        "/usr/share/fonts/truetype/fonts-japanese-gothic.ttf",
    ]
    en_paths = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    ]
    for p in (jp_paths if jp else en_paths):
        if Path(p).exists():
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def _draw_labview(img: Image.Image) -> None:
    """背景としての簡易LabVIEW画面（あるテキストが誤検知されないように
    『測定者』『測定日』『2026/05/30』なども入れておく）"""
    d = ImageDraw.Draw(img)
    f = _font(True, 20)
    d.rectangle([0, 0, W, 30], fill=(220, 220, 220))
    d.text((10, 5), "IK220分割測定KWIN11.vi", fill=(0, 0, 0), font=f)
    # 左サイドの項目（"測定" を含む文字列が紛らわしくないか）
    for i, (label, value) in enumerate([
        ("測定日", "2026/05/30"), ("型式", "RW-222222222"),
        ("機番", "111-----------------"), ("測定者", ""),
    ]):
        y = 150 + i * 45
        d.text((230, y), label, fill=(0, 0, 0), font=f)
        d.rectangle([290, y - 4, 530, y + 28], fill=(255, 255, 255), outline=(120, 120, 120))
        d.text((296, y), value, fill=(0, 0, 0), font=f)
    # 取込開始ボタン
    d.rectangle([200, 410, 320, 440], fill=(215, 200, 175), outline=(80, 80, 80))
    d.text((212, 415), "取込開始", fill=(0, 0, 0), font=f)


def _draw_dialog(img: Image.Image) -> None:
    """確認ダイアログを画面に重ねて描画。"""
    d = ImageDraw.Draw(img)
    f = _font(True, 18)
    fb = _font(True, 16)
    # 枠
    d.rectangle([DLG_LEFT, DLG_TOP, DLG_RIGHT, DLG_BOT], fill=(240, 240, 240),
                outline=(0, 0, 0), width=2)
    # タイトル帯
    d.rectangle([DLG_LEFT, DLG_TOP, DLG_RIGHT, DLG_TOP + 22], fill=(200, 200, 200))
    # 本文
    d.text((DLG_LEFT + 20, DLG_TOP + 35), "データが保存されていません。", fill=(0, 0, 0), font=f)
    d.text((DLG_LEFT + 20, DLG_TOP + 65), "このまま測定しますか？", fill=(0, 0, 0), font=f)
    # 測定開始ボタン
    d.rectangle([820, 555, 940, 585], fill=(220, 220, 220), outline=(0, 0, 0))
    d.text((835, 560), "測定開始", fill=(0, 0, 0), font=fb)
    # キャンセル
    d.rectangle([960, 555, 1090, 585], fill=(220, 220, 220), outline=(0, 0, 0))
    d.text((1000, 560), "Cancel", fill=(0, 0, 0), font=_font(False, 14))


def build_scene(with_dialog: bool) -> Image.Image:
    img = Image.new("RGB", (W, H), (212, 208, 200))
    _draw_labview(img)
    if with_dialog:
        _draw_dialog(img)
    return img


def make_monitor() -> tuple[xm.XR20Monitor, list[str], list[tuple]]:
    cfg = xm.MonitorConfig()
    cfg.confirm_dialog_rect = list(DET_RECT)
    cfg.confirm_button_rect = list(BTN_RECT)
    logs: list[str] = []
    clicks: list[tuple] = []
    m = xm.XR20Monitor(cfg, log_cb=lambda s: logs.append(s))
    m._locator.set_fake_rect((0, 0, W, H))
    # 物理マウスは動かさず、座標だけ記録する
    m._locator.click_at_rect = lambda rel: (clicks.append(rel), True)[1]  # type: ignore
    # ポーリング待ちをノーオペにしてテストを高速化
    m._wait = lambda s: None  # type: ignore
    return m, logs, clicks


def test_dialog_present() -> bool:
    img = build_scene(with_dialog=True)
    img.save("/tmp/_scene_with_dialog.png")
    m, logs, clicks = make_monitor()
    m._sampler.set_fake_image(img)
    result = m._dismiss_confirm_dialog()
    ok = result is True and len(clicks) == 1
    print(f"  [{'OK' if ok else 'NG'}] ダイアログあり → 検出してクリック")
    print(f"        戻り値={result}, click呼出={len(clicks)}回")
    for ln in logs:
        print("       ", ln.split("] ", 1)[-1])
    return ok


def test_dialog_absent() -> bool:
    img = build_scene(with_dialog=False)
    img.save("/tmp/_scene_no_dialog.png")
    m, logs, clicks = make_monitor()
    m._sampler.set_fake_image(img)
    result = m._dismiss_confirm_dialog()
    ok = result is False and len(clicks) == 0
    print(f"  [{'OK' if ok else 'NG'}] ダイアログなし → 何もしない（誤検知なし）")
    print(f"        戻り値={result}, click呼出={len(clicks)}回")
    for ln in logs:
        print("       ", ln.split("] ", 1)[-1])
    return ok


def test_pattern_waits_honored() -> bool:
    cfg = xm.MonitorConfig()
    cfg.dry_run = True
    cfg.switchbot_patterns = {"x": [7.0]}
    cfg.switchbot_pattern_name = "x"
    waits: list[float] = []
    m = xm.XR20Monitor(cfg, log_cb=lambda s: None)
    m._wait = lambda s: waits.append(s)  # type: ignore
    m.execute_switchbot_pattern()
    ok = waits == [7.0]
    print(f"  [{'OK' if ok else 'NG'}] パターン[7.0] → wait 7.0が呼ばれる  得={waits}")
    return ok


def main() -> int:
    print("=== 実画面シナリオ検証 ===")
    a = test_dialog_present()
    b = test_dialog_absent()
    c = test_pattern_waits_honored()
    total = sum([a, b, c])
    print(f"\n結果: {total}/3 成功")
    return 0 if total == 3 else 1


if __name__ == "__main__":
    sys.exit(main())
