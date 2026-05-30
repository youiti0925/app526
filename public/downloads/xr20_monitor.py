#!/usr/bin/env python3
"""XR20 / IK220分割測定KWIN 自動監視ツール（画像ベース＋状態機械版）.

pywinauto はウィンドウ検出とボタンクリックに限定し、値の読み取りは
スクリーンショット＋ピクセル色判定＋OCR で行う。LabVIEW の 2D テーブル
コントロールは Win32/UIA から直接読めないため、この方針に切り替えた。

検出対象:
    1. 取込開始ボタンの色（押下中かどうか）
    2. No 列の数字有無（空欄行は測定対象外なのでスキップ）
    3. 行ごとの緑ランプ（どこまで測定が進んだか）
    4. 傾 列の数値（OCR、NG 判定用）

状態遷移:
    IDLE → CAPTURING → DONE → JUDGING → (OK なら IDLE / NG なら NG_RETRY)
"""

from __future__ import annotations

import csv
import json
import sys
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Any, Callable


# ----------------------------------------------------------------------
# 画像から実測した既定の相対座標（ウィンドウ幅/高さに対する比率）
#   [x_frac, y_frac, w_frac, h_frac]
# 想定ウィンドウ: 1919x958（最大化）
# ----------------------------------------------------------------------
# SwitchBot Bot の BLE GATT 定義（ハブ無し直結用）
SWITCHBOT_BLE_WRITE_CHAR = "cba20002-224d-11e6-9fb9-0002a5d5c51b"
SWITCHBOT_BLE_SERVICE = "0000fd3d-0000-1000-8000-00805f9b34fb"

DEFAULT_BUTTON_CAPTURE = [0.104, 0.400, 0.069, 0.037]
DEFAULT_BUTTON_AUTOCORRECT = [0.183, 0.400, 0.069, 0.037]
DEFAULT_COMMENT_RECT = [0.183, 0.520, 0.450, 0.030]
DEFAULT_MODEL_RECT = [0.050, 0.020, 0.200, 0.030]  # 型式（品番）表示位置
DEFAULT_MACHINE_RECT = [0.260, 0.020, 0.180, 0.030]  # 機番（機械番号）表示位置

DEFAULT_NO_RECTS = {
    "HR": [0.360, 0.160, 0.015, 0.028],
    "WR": [0.360, 0.204, 0.015, 0.028],
    "WL": [0.360, 0.249, 0.015, 0.028],
    "HL": [0.360, 0.293, 0.015, 0.028],
}
DEFAULT_LAMP_RECTS = {
    "HR": [0.392, 0.170, 0.012, 0.020],
    "WR": [0.392, 0.214, 0.012, 0.020],
    "WL": [0.392, 0.259, 0.012, 0.020],
    "HL": [0.392, 0.303, 0.012, 0.020],
}
DEFAULT_TILT_RECTS = {
    "HR": [0.608, 0.160, 0.048, 0.031],
    "WR": [0.608, 0.204, 0.048, 0.031],
    "WL": [0.608, 0.249, 0.048, 0.031],
    "HL": [0.608, 0.293, 0.048, 0.031],
}


class State(Enum):
    IDLE = "IDLE"
    CAPTURING = "CAPTURING"
    DONE = "DONE"
    JUDGING = "JUDGING"
    TILT_NG_RETRY = "TILT_NG_RETRY"
    AUTO_CORRECTING = "AUTO_CORRECTING"
    PRECISION_JUDGING = "PRECISION_JUDGING"
    PRECISION_NG_RETRY = "PRECISION_NG_RETRY"
    ERROR = "ERROR"


@dataclass
class MonitorConfig:
    # SwitchBot
    switchbot_token: str = ""
    switchbot_secret: str = ""
    switchbot_device_id: str = ""
    switchbot_use_ble: bool = False        # True: PCのBluetoothから直接Botを操作（ハブ不要）
    switchbot_ble_mac: str = ""            # Bot の Bluetooth MACアドレス
    switchbot_ble_password: str = ""       # Bot にパスワード設定時のみ（通常は空欄）
    # 押下パターン: 名前→各押下後の待ち秒のリスト。例 [5.0, 0.0] = 押す→5秒待つ→押す
    switchbot_patterns: dict[str, list[float]] = field(default_factory=lambda: {
        "1回押し": [0.0],
        "2回押し（5秒間隔）": [5.0, 0.0],
        "2回押し（3秒間隔）": [3.0, 0.0],
        "3回押し（3秒間隔）": [3.0, 3.0, 0.0],
    })
    switchbot_pattern_name: str = "1回押し"  # 使用するパターン名

    # ウィンドウ特定（部分一致）
    app_title: str = "IK220分割測定"
    capture_button_text: str = "取込開始"

    # 閾値（角度秒）
    threshold_hr: float = 4.0
    threshold_wr: float = 7.0
    target_rows: list[str] = field(default_factory=lambda: ["HR", "WR", "WL", "HL"])

    # タイミング
    poll_interval_sec: float = 2.0
    idle_poll_interval_sec: float = 5.0
    judge_delay_sec: float = 1.5
    auto_correct_wait_sec: float = 3.0  # 自動補正ボタン押下後、コメント確認までの待機
    max_tilt_retries: int = 2
    max_precision_retries: int = 1

    # 再測定（リカバリ）シーケンスの待ち時間（秒）
    wait_before_capture_sec: float = 1.0   # NG検知/スクショ後 → 取込開始押下まで
    wait_after_capture_sec: float = 2.0    # 取込開始押下 → SwitchBot起動まで
    wait_after_switchbot_sec: float = 1.0  # SwitchBot起動後の待ち

    # NG時のスクリーンショット保存
    save_ng_screenshot: bool = True
    ng_screenshot_dir: str = "ng_shots"

    # 動作フラグ
    dry_run: bool = True
    auto_retry: bool = True
    auto_correction_enabled: bool = False  # 精度判定（傾OK後 自動補正→コメントOCR）。既定OFF

    # 自動補正／精度不良監視
    auto_correct_button_text: str = "自動補正"
    precision_ng_keyword: str = "精度不良"

    # 「データが保存されていません。このまま測定しますか？」ダイアログ用（任意）
    # confirm_dialog_rect: ダイアログが出てるか判定する文字位置（独自テキスト部分）
    # confirm_button_rect: 出ていた時クリックする「測定開始」ボタン位置
    confirm_dialog_rect: list[float] = field(default_factory=list)
    confirm_button_rect: list[float] = field(default_factory=list)

    # ウィンドウ相対矩形
    button_capture_rect: list[float] = field(default_factory=lambda: list(DEFAULT_BUTTON_CAPTURE))
    button_autocorrect_rect: list[float] = field(default_factory=lambda: list(DEFAULT_BUTTON_AUTOCORRECT))
    comment_rect: list[float] = field(default_factory=lambda: list(DEFAULT_COMMENT_RECT))
    model_rect: list[float] = field(default_factory=lambda: list(DEFAULT_MODEL_RECT))
    machine_rect: list[float] = field(default_factory=lambda: list(DEFAULT_MACHINE_RECT))
    no_column_rects: dict[str, list[float]] = field(default_factory=lambda: {k: list(v) for k, v in DEFAULT_NO_RECTS.items()})
    lamp_rects: dict[str, list[float]] = field(default_factory=lambda: {k: list(v) for k, v in DEFAULT_LAMP_RECTS.items()})
    tilt_rects: dict[str, list[float]] = field(default_factory=lambda: {k: list(v) for k, v in DEFAULT_TILT_RECTS.items()})

    # 位置自動補正（テンプレートマッチング）— 任意機能。OFF時は固定座標のまま
    use_template_anchor: bool = True
    anchor_a_rect: list[float] = field(default_factory=list)  # 目印A（例:「型式」ラベル）
    anchor_b_rect: list[float] = field(default_factory=list)  # 目印B（例: 表ヘッダー行）
    anchor_match_threshold: float = 0.6  # マッチ信頼度の下限

    # 色基準（RGB）／許容誤差
    # 画像からの実測値:
    #   lamp_on  : 明るい緑 / lamp_off: 暗い深緑（未点灯）
    #   button_idle: 明るいベージュ / button_active: 暗い灰緑（押下中）
    lamp_on_color: list[int] = field(default_factory=lambda: [80, 210, 90])
    lamp_off_color: list[int] = field(default_factory=lambda: [45, 110, 55])
    button_idle_color: list[int] = field(default_factory=lambda: [215, 200, 175])
    button_active_color: list[int] = field(default_factory=lambda: [115, 125, 105])
    color_tolerance: int = 55

    # 出力
    csv_log_path: str = "xr20_monitor_history.csv"
    summary_csv_path: str = "xr20_monitor_summary.csv"


def _color_distance(a: tuple[int, int, int], b: list[int]) -> float:
    return sum((int(a[i]) - int(b[i])) ** 2 for i in range(3)) ** 0.5


def _color_matches(rgb: tuple[int, int, int], target: list[int], tolerance: int) -> bool:
    return _color_distance(rgb, target) <= tolerance


def _safe_float(text: str) -> float | None:
    cleaned = text.replace(",", "").replace("＋", "+").replace("－", "-").replace(" ", "").strip()
    if not cleaned:
        return None
    try:
        return float(cleaned)
    except (TypeError, ValueError):
        return None


def _cfg_to_dict(cfg: MonitorConfig) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for f in cfg.__dataclass_fields__:
        val = getattr(cfg, f)
        if isinstance(val, dict):
            out[f] = {k: list(v) for k, v in val.items()}
        elif isinstance(val, list):
            out[f] = list(val)
        else:
            out[f] = val
    return out


def _dict_to_cfg(data: dict[str, Any]) -> MonitorConfig:
    base = MonitorConfig()
    for key, val in data.items():
        if hasattr(base, key):
            setattr(base, key, val)
    return base


def load_config(path: Path) -> MonitorConfig:
    if path.exists():
        with path.open("r", encoding="utf-8") as f:
            return _dict_to_cfg(json.load(f))
    cfg = MonitorConfig()
    save_config(path, cfg)
    return cfg


def save_config(path: Path, cfg: MonitorConfig) -> None:
    path.write_text(json.dumps(_cfg_to_dict(cfg), ensure_ascii=False, indent=2), encoding="utf-8")


# ======================================================================
# ウィンドウと画面サンプラー
# ======================================================================
class WindowLocator:
    """pywinauto でターゲットウィンドウを特定し、絶対座標を算出するヘルパー."""

    def __init__(self, title_substr: str) -> None:
        self.title_substr = title_substr
        self._rect: tuple[int, int, int, int] | None = None  # (left, top, right, bottom)
        self._pwa_window: Any = None
        self._fake_rect: tuple[int, int, int, int] | None = None
        self._anchor_corr: tuple[float, float, float, float] | None = None  # (sx, sy, ox, oy)
        self._lock = threading.Lock()  # pywinauto を複数スレッドから同時に叩かない

    def set_anchor_correction(self, corr: tuple[float, float, float, float] | None) -> None:
        """テンプレート位置補正（分数空間の sx,sy,ox,oy）。None で補正なし。"""
        self._anchor_corr = corr

    def set_fake_rect(self, rect: tuple[int, int, int, int]) -> None:
        """テスト用: pywinauto を使わずに矩形を直接指定する。"""
        self._fake_rect = rect
        self._rect = rect

    def refresh(self) -> bool:
        """ウィンドウを再検出。成功で True。"""
        if self._fake_rect is not None:
            self._rect = self._fake_rect
            return True
        if not self._lock.acquire(blocking=False):
            # 別スレッドが探索中。前回の結果を流用（同時pywinauto呼び出し回避）
            return self._rect is not None
        try:
            from pywinauto import Desktop
        except Exception:
            self._lock.release()
            return False
        try:
            for backend in ("uia", "win32"):
                try:
                    win = Desktop(backend=backend).window(title_re=f".*{self.title_substr}.*")
                    if win.exists(timeout=0.5):
                        rect = win.rectangle()
                        self._rect = (rect.left, rect.top, rect.right, rect.bottom)
                        self._pwa_window = win
                        return True
                except Exception:
                    continue
        finally:
            self._lock.release()
        return False

    def rect(self) -> tuple[int, int, int, int] | None:
        return self._rect

    def rel_to_abs(self, rel: list[float]) -> tuple[int, int, int, int] | None:
        """相対矩形 [xf, yf, wf, hf] を絶対 (left, top, width, height) に変換。

        テンプレート位置補正が設定されていれば、分数を補正してから変換する。
        """
        if not self._rect or len(rel) != 4:
            return None
        xf, yf, wf, hf = rel
        if self._anchor_corr is not None:
            sx, sy, ox, oy = self._anchor_corr
            xf = sx * xf + ox
            yf = sy * yf + oy
            wf = wf * sx
            hf = hf * sy
        left, top, right, bottom = self._rect
        w = right - left
        h = bottom - top
        return (
            left + int(xf * w),
            top + int(yf * h),
            max(1, int(wf * w)),
            max(1, int(hf * h)),
        )

    def click_button(self, button_text: str) -> bool:
        """pywinauto 経由でボタンクリック。失敗時 False。"""
        if not self._pwa_window:
            return False
        try:
            btn = self._pwa_window.child_window(title=button_text, control_type="Button")
            if btn.exists(timeout=1.0):
                btn.click_input()
                return True
        except Exception:
            pass
        try:
            self._pwa_window.child_window(title=button_text).click_input()
            return True
        except Exception:
            return False

    def click_at_rect(self, rel_rect: list[float]) -> bool:
        """ウィンドウ相対矩形の中心をマウスでクリック。LabVIEW のように
        pywinauto から直接ボタンを叩けない場合に使う（位置補正があれば適用）。"""
        abs_rect = self.rel_to_abs(rel_rect)
        if not abs_rect:
            return False
        x, y, w, h = abs_rect
        cx, cy = x + w // 2, y + h // 2
        try:
            from pywinauto.mouse import click as pwa_click
            pwa_click(button="left", coords=(cx, cy))
            return True
        except Exception:
            return False


class ScreenSampler:
    """mss + PIL で画面の矩形を取得し、ピクセル色／OCR を提供する."""

    def __init__(self) -> None:
        self._init_error: str | None = None
        self._fake_image: Any = None  # PIL.Image をセットすると全 grab がここから返る
        self._mss_ok = False
        self._local = threading.local()  # mss はスレッドごとに専用インスタンスが必要
        try:
            import mss  # noqa: F401  可用性チェックのみ
            self._mss_ok = True
        except Exception as exc:
            self._init_error = f"mss 未導入: {exc}"

    def _mss_instance(self) -> Any:
        """呼び出しスレッド専用の mss インスタンスを返す（並行キャプチャ対応）。"""
        inst = getattr(self._local, "mss", None)
        if inst is None:
            import mss
            try:
                inst = mss.MSS()
            except AttributeError:
                inst = mss.mss()
            except Exception:
                return None
            self._local.mss = inst
        return inst

    def set_fake_image(self, image: Any) -> None:
        """テスト用: この PIL.Image を「画面全体」として扱う。"""
        self._fake_image = image

    def available(self) -> bool:
        return self._mss_ok or self._fake_image is not None

    def init_error(self) -> str | None:
        return self._init_error

    def grab(self, abs_rect: tuple[int, int, int, int]) -> Any:
        """絶対 (left, top, width, height) をキャプチャして PIL.Image を返す。失敗時 None。"""
        if self._fake_image is not None:
            from PIL import Image as _Image  # noqa: F401
            left, top, w, h = abs_rect
            return self._fake_image.crop((left, top, left + w, top + h))
        if not self._mss_ok:
            return None
        inst = self._mss_instance()
        if inst is None:
            return None
        left, top, w, h = abs_rect
        try:
            from PIL import Image
            shot = inst.grab({"left": left, "top": top, "width": w, "height": h})
            return Image.frombytes("RGB", shot.size, shot.rgb)
        except Exception:
            return None

    def average_color(self, abs_rect: tuple[int, int, int, int]) -> tuple[int, int, int] | None:
        """矩形の平均 RGB（色判定用）。"""
        img = self.grab(abs_rect)
        if img is None:
            return None
        try:
            small = img.resize((1, 1))
            return tuple(small.getpixel((0, 0)))[:3]
        except Exception:
            return None

    def ocr_text(self, abs_rect: tuple[int, int, int, int], whitelist: str | None = None) -> str:
        """矩形を OCR。whitelist を指定すると数字記号のみに絞る。

        前処理（ボケ・小文字に強い構成を実測で選定）:
          枠線3pxトリム → グレースケール → 目標高さ約64pxへLanczos拡大 →
          コントラスト最大化 → アンシャープで輪郭強調 → 白余白付与 →
          psm7。空振り時のみ psm8 で再試行。
        """
        img = self.grab(abs_rect)
        if img is None:
            return ""
        try:
            import pytesseract
            from PIL import Image, ImageOps, ImageFilter
            trim = 3  # 枠線だけ除外（固定px。割合だと長い値の先頭を切る）
            w, h = img.width, img.height
            if w - 2 * trim >= 8 and h - 2 * trim >= 8:
                img = img.crop((trim, trim, w - trim, h - trim))
            g = img.convert("L")
            scale = max(1, min(10, round(64 / max(1, g.height))))
            g = g.resize((g.width * scale, g.height * scale), Image.LANCZOS)
            g = ImageOps.autocontrast(g)
            g = g.filter(ImageFilter.UnsharpMask(radius=2, percent=150))
            g = ImageOps.expand(g, border=16, fill=255)

            def run(psm: int) -> str:
                cfg = f"--psm {psm} --oem 1"
                if whitelist:
                    cfg += f" -c tessedit_char_whitelist={whitelist}"
                return pytesseract.image_to_string(g, config=cfg).strip()

            txt = run(7)
            if not txt:
                txt = run(8)
            return txt
        except Exception:
            return ""

    def ocr_text_jpn(self, abs_rect: tuple[int, int, int, int]) -> str:
        """日本語 OCR。tesseract-ocr-jpn が必要。未インストール時は eng にフォールバック。"""
        img = self.grab(abs_rect)
        if img is None:
            return ""
        try:
            import pytesseract
            gray = img.convert("L").resize((img.width * 2, img.height * 2))
            try:
                return pytesseract.image_to_string(gray, lang="jpn", config="--psm 7").strip()
            except pytesseract.TesseractError:
                return pytesseract.image_to_string(gray, config="--psm 7").strip()
        except Exception:
            return ""

    def close(self) -> None:
        inst = getattr(self._local, "mss", None)
        if inst is not None:
            try:
                inst.close()
            except Exception:
                pass
            self._local.mss = None


# ======================================================================
# 読み取りスナップショット
# ======================================================================
@dataclass
class Snapshot:
    window_ok: bool = False
    button_pressed: bool = False
    button_color: tuple[int, int, int] | None = None
    active_rows: list[str] = field(default_factory=list)  # No 列に数字がある行
    lamp_states: dict[str, str] = field(default_factory=dict)  # row -> ON/OFF/UNKNOWN
    lamp_colors: dict[str, tuple[int, int, int] | None] = field(default_factory=dict)  # 診断用 実RGB
    tilt_values: dict[str, float | None] = field(default_factory=dict)
    raw_no: dict[str, str] = field(default_factory=dict)
    raw_tilt: dict[str, str] = field(default_factory=dict)
    comment_text: str = ""
    precision_ng: bool = False
    model_name: str = ""
    machine_no: str = ""


# ======================================================================
# 本体
# ======================================================================
class XR20Monitor:
    def __init__(self, cfg: MonitorConfig, log_cb: Callable[[str], None] | None = None) -> None:
        self.cfg = cfg
        self._log_cb = log_cb or (lambda m: print(m))
        self._locator = WindowLocator(cfg.app_title)
        self._sampler = ScreenSampler()

        self._state: State = State.IDLE
        self._tilt_retry: int = 0
        self._precision_retry: int = 0
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._last_snapshot: Snapshot | None = None
        self._state_cb: Callable[[State, Snapshot], None] | None = None

        # 集計用
        self._current_model: str = ""
        self._current_machine: str = ""
        self._session_active: bool = False
        self._total_recaptures: int = 0
        self._ok_count: int = 0
        self._ng_giveup_count: int = 0
        self._activity: str = "停止中"  # 現在の動作（ミニ表示用）
        self._active_rows: list[str] = []  # 直近の有効行（軽い周期で流用）
        self._anchor_warned: bool = False  # アンカー未検出ログを1回だけにする
        self._confirm_warned: bool = False  # 確認ダイアログ未登録ヒントを1回だけ
        self._saw_lamp_on: bool = False  # CAPTURING中に一度でもランプ点灯を観測したか

        if err := self._sampler.init_error():
            self.log(f"[警告] {err}（OCR/色判定が機能しません）")

    # ------------------------------------------------------------------
    # ログ
    # ------------------------------------------------------------------
    def log(self, msg: str) -> None:
        self._log_cb(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")

    def set_state_callback(self, cb: Callable[[State, Snapshot], None]) -> None:
        self._state_cb = cb

    def last_snapshot(self) -> Snapshot | None:
        return self._last_snapshot

    # ------------------------------------------------------------------
    # 1 サイクル分の画面読み取り
    # ------------------------------------------------------------------
    def take_snapshot(self, *, read_no: bool = True, read_tilt: bool = True,
                      read_comment: bool = True, read_meta: bool = True,
                      do_anchor: bool = True) -> Snapshot:
        """画面を1回読む。フラグで重いOCR/位置補正を省ける（測定中の高速化用）。

        色判定（ボタン・ランプ）は常に実行（軽い）。OCR系は必要な時だけ。
        """
        snap = Snapshot()
        if not self._locator.refresh():
            self.log("ウィンドウ未検出")
            return snap
        snap.window_ok = True

        # 0) 位置自動補正（重いので必要な時だけ。色判定は多少のズレに強い）
        if do_anchor:
            self._update_anchor_correction()

        # 1) 取込開始ボタンの色（常時・軽い）
        btn_abs = self._locator.rel_to_abs(self.cfg.button_capture_rect)
        if btn_abs:
            color = self._sampler.average_color(btn_abs)
            snap.button_color = color
            if color is not None:
                snap.button_pressed = self._is_button_pressed(color)

        # 2) No 列の数字有無 → 有効行（OCR）。省略時は前回の有効行を流用
        if read_no:
            for row in self.cfg.target_rows:
                rel = self.cfg.no_column_rects.get(row)
                if not rel:
                    continue
                rect = self._locator.rel_to_abs(rel)
                if not rect:
                    continue
                text = self._sampler.ocr_text(rect, whitelist="0123456789")
                snap.raw_no[row] = text
                if any(ch.isdigit() for ch in text):
                    snap.active_rows.append(row)
            self._active_rows = list(snap.active_rows)
        else:
            snap.active_rows = list(self._active_rows)

        # 3) 行ごとの緑ランプ（常時・軽い色判定）。実RGBも残して診断に使う
        for row in self.cfg.target_rows:
            rel = self.cfg.lamp_rects.get(row)
            rect = self._locator.rel_to_abs(rel) if rel else None
            if not rect:
                snap.lamp_states[row] = "UNKNOWN"
                snap.lamp_colors[row] = None
                continue
            color = self._sampler.average_color(rect)
            snap.lamp_colors[row] = color
            snap.lamp_states[row] = self._classify_lamp(color) if color else "UNKNOWN"

        # 4) 傾列 OCR（必要時のみ・有効行）
        if read_tilt:
            for row in snap.active_rows:
                rel = self.cfg.tilt_rects.get(row)
                rect = self._locator.rel_to_abs(rel) if rel else None
                if not rect:
                    snap.tilt_values[row] = None
                    continue
                text = self._sampler.ocr_text(rect, whitelist="0123456789.-+,")
                snap.raw_tilt[row] = text
                snap.tilt_values[row] = _safe_float(text)

        # 5) コメント欄 OCR（精度NG検出用・必要時のみ・日本語OCR）
        if read_comment:
            comment_rel = self.cfg.comment_rect
            comment_abs = self._locator.rel_to_abs(comment_rel) if comment_rel else None
            if comment_abs:
                snap.comment_text = self._sampler.ocr_text_jpn(comment_abs)
                snap.precision_ng = self.cfg.precision_ng_keyword in snap.comment_text

        # 6) 型式・機番 OCR（必要時のみ・英数字なので英語OCR）
        if read_meta:
            model_abs = self._locator.rel_to_abs(self.cfg.model_rect) if self.cfg.model_rect else None
            if model_abs:
                snap.model_name = "".join(self._sampler.ocr_text(model_abs).split())
                if snap.model_name:
                    self._current_model = snap.model_name
            machine_abs = self._locator.rel_to_abs(self.cfg.machine_rect) if self.cfg.machine_rect else None
            if machine_abs:
                snap.machine_no = "".join(self._sampler.ocr_text(machine_abs).split())
                if snap.machine_no:
                    self._current_machine = snap.machine_no
        # 表示用に現在値を引き継ぐ（軽い周期でも型式/機番が消えないように）
        if not snap.model_name:
            snap.model_name = self._current_model
        if not snap.machine_no:
            snap.machine_no = self._current_machine

        return snap

    # ------------------------------------------------------------------
    # 位置自動補正（テンプレートマッチング）
    # ------------------------------------------------------------------
    def _template_path(self, name: str) -> Path:
        return self._resolve_path(name, name)

    def _match_template(self, win_img: Any, fname: str) -> tuple[tuple[float, float] | None, float, bool]:
        """目印テンプレを探す。戻り値 (中心分数 or None, 最良スコア, ファイル有無)。"""
        path = self._template_path(fname)
        if not path.exists():
            return None, 0.0, False
        try:
            import cv2
            import numpy as np
        except Exception:
            self.log("[位置補正] opencv 未導入（start.bat 再実行で導入）")
            return None, 0.0, True
        try:
            templ0 = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)
            if templ0 is None:
                return None, 0.0, True
            hay = cv2.cvtColor(np.array(win_img), cv2.COLOR_RGB2GRAY)
            best = None  # (score, cx, cy)
            # マルチスケール: ウィンドウ拡大縮小に追従するため複数倍率で探索
            for scale in [s / 100.0 for s in range(50, 156, 5)]:
                tw = max(8, int(templ0.shape[1] * scale))
                th = max(8, int(templ0.shape[0] * scale))
                if hay.shape[0] < th or hay.shape[1] < tw:
                    continue
                templ = cv2.resize(templ0, (tw, th), interpolation=cv2.INTER_AREA)
                res = cv2.matchTemplate(hay, templ, cv2.TM_CCOEFF_NORMED)
                _minv, maxv, _minl, maxl = cv2.minMaxLoc(res)
                if best is None or maxv > best[0]:
                    best = (maxv, maxl[0] + tw / 2.0, maxl[1] + th / 2.0)
            score = best[0] if best else 0.0
            if best is None or score < self.cfg.anchor_match_threshold:
                return None, score, True
            return (best[1] / win_img.width, best[2] / win_img.height), score, True
        except Exception as exc:
            self.log(f"[位置補正] 照合例外: {exc}")
            return None, 0.0, True

    def _update_anchor_correction(self) -> None:
        if not self.cfg.use_template_anchor:
            self._locator.set_anchor_correction(None)
            return
        if len(self.cfg.anchor_a_rect) != 4 or len(self.cfg.anchor_b_rect) != 4:
            self._locator.set_anchor_correction(None)
            if not self._anchor_warned:
                self.log("[位置補正] 目印が未登録のため固定座標で動作（詳細設定→矩形設定で目印A/Bを登録すると有効）")
                self._anchor_warned = True
            return
        rect = self._locator.rect()
        if not rect:
            return
        left, top, right, bottom = rect
        win_img = self._sampler.grab((left, top, right - left, bottom - top))
        if win_img is None:
            self._locator.set_anchor_correction(None)
            return
        a_cur, a_sc, a_exist = self._match_template(win_img, "anchor_a.png")
        b_cur, b_sc, b_exist = self._match_template(win_img, "anchor_b.png")
        if not a_exist or not b_exist:
            self._locator.set_anchor_correction(None)
            if not self._anchor_warned:
                self.log("[位置補正] 目印テンプレ未保存。矩形設定で目印A/Bを"
                         "スキップせずドラッグ登録してください（チェックON状態で）")
                self._anchor_warned = True
            return
        if a_cur is None or b_cur is None:
            self._locator.set_anchor_correction(None)
            if not self._anchor_warned:
                self.log(f"[位置補正] 目印の一致度が低く固定座標で継続 "
                         f"(A={a_sc:.2f} B={b_sc:.2f} / 必要{self.cfg.anchor_match_threshold:.2f})。"
                         f"目印領域が登録時と違う可能性（値が変わる欄を避け、終了ボタンやCW/CCW凡例を囲む）")
                self._anchor_warned = True
            return
        self._anchor_warned = False  # 見つかったら警告フラグを戻す
        # 参照位置（登録時の目印中心、分数）
        ar = self.cfg.anchor_a_rect
        br = self.cfg.anchor_b_rect
        arx, ary = ar[0] + ar[2] / 2.0, ar[1] + ar[3] / 2.0
        brx, bry = br[0] + br[2] / 2.0, br[1] + br[3] / 2.0
        dx_ref, dy_ref = brx - arx, bry - ary
        sx = (b_cur[0] - a_cur[0]) / dx_ref if abs(dx_ref) > 0.02 else 1.0
        sy = (b_cur[1] - a_cur[1]) / dy_ref if abs(dy_ref) > 0.02 else sx
        # 倍率が異常なら補正を捨てる（誤マッチ保険）
        if not (0.5 <= sx <= 2.0 and 0.5 <= sy <= 2.0):
            self._locator.set_anchor_correction(None)
            self.log(f"[位置補正] 倍率異常(sx={sx:.2f}, sy={sy:.2f})→固定座標で継続")
            return
        ox = a_cur[0] - sx * arx
        oy = a_cur[1] - sy * ary
        self._locator.set_anchor_correction((sx, sy, ox, oy))

    # ------------------------------------------------------------------
    # 判定ヘルパー
    # ------------------------------------------------------------------
    def _is_button_pressed(self, color: tuple[int, int, int]) -> bool:
        d_idle = _color_distance(color, self.cfg.button_idle_color)
        d_active = _color_distance(color, self.cfg.button_active_color)
        return d_active < d_idle

    def _classify_lamp(self, color: tuple[int, int, int]) -> str:
        if _color_matches(color, self.cfg.lamp_on_color, self.cfg.color_tolerance):
            return "ON"
        if _color_matches(color, self.cfg.lamp_off_color, self.cfg.color_tolerance):
            return "OFF"
        r, g, b = color
        if g > r + 30 and g > b + 30 and g > 120:
            return "ON"
        return "OFF"

    def threshold_for(self, row: str) -> float:
        return self.cfg.threshold_wr if row.startswith("W") else self.cfg.threshold_hr

    def is_ng(self, row: str, value: float | None) -> bool:
        if value is None:
            return False
        return abs(value) > self.threshold_for(row)

    # ------------------------------------------------------------------
    # 状態機械ループ
    # ------------------------------------------------------------------
    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._state = State.IDLE
        self._tilt_retry = 0
        self._precision_retry = 0
        self._activity = "起動中…"
        self._thread = threading.Thread(target=self._run_loop, daemon=True)
        self._thread.start()
        self.log("監視開始")

    def stop(self) -> None:
        self._stop.set()
        self._activity = "停止中"
        self.log("監視停止要求")

    def _emit(self, snap: Snapshot) -> None:
        self._last_snapshot = snap
        if self._state_cb:
            try:
                self._state_cb(self._state, snap)
            except Exception as exc:
                self.log(f"[GUI更新例外] {exc}")

    def _run_loop(self) -> None:
        prev_pressed = False
        prev_all_done = False
        prev_window_ok = None
        while not self._stop.is_set():
            # フェーズ別に必要な処理だけ実行（測定中は色判定のみで高速・表示が追従）
            if self._state == State.CAPTURING:
                # 測定中も型式/機番は読み直す（古い化け値で固定されないように）。
                # 重い傾OCR・コメント・位置補正は判定時のみ。
                snap = self.take_snapshot(read_no=False, read_tilt=False,
                                          read_comment=False, read_meta=True, do_anchor=False)
            else:  # IDLE 等: 型式/機番/有効行も読む（傾・コメントは判定時のみ）
                snap = self.take_snapshot(read_tilt=False, read_comment=False, do_anchor=False)
            self._emit(snap)

            if snap.window_ok != prev_window_ok:
                if snap.window_ok:
                    self.log(f"画面認識OK / 型式={snap.model_name or '(未取得)'} "
                             f"機番={snap.machine_no or '(未取得)'}")
                else:
                    self.log("画面認識NG（対象ウィンドウが見つからない）")
                prev_window_ok = snap.window_ok

            if not snap.window_ok:
                self._wait(self.cfg.idle_poll_interval_sec)
                continue

            # 測定完了の検出: 「測定中に一度ランプが点いた」→「全ランプ消えた」瞬間。
            # このアプリのランプは測定中の行を順次点灯し、完了で全部消える挙動なので。
            any_lamp_on = bool(snap.active_rows) and any(
                snap.lamp_states.get(r) == "ON" for r in snap.active_rows
            )
            if self._state == State.CAPTURING and any_lamp_on:
                self._saw_lamp_on = True
            all_done = (
                self._state == State.CAPTURING
                and self._saw_lamp_on
                and bool(snap.active_rows)
                and not any_lamp_on  # 一度ONを見てから全てOFFに戻った
            )

            if self._state == State.IDLE:
                self._activity = f"取込開始の押下を待機中（{self.cfg.idle_poll_interval_sec:g}秒ごと確認）"
                if snap.button_pressed and not prev_pressed:
                    if not self._session_active:
                        self._session_active = True
                        self.log(f"測定セッション開始 / 型式={self._current_model or '(未取得)'}")
                    self.log(f"取込開始検知 / 有効行={snap.active_rows}")
                    self._saw_lamp_on = False  # 新測定の開始: ランプ観測フラグをリセット
                    self._state = State.CAPTURING

            elif self._state == State.CAPTURING:
                if all_done and not prev_all_done:
                    self.log("測定完了検知（ランプ点灯→消灯）→ 判定待機")
                    self._activity = "測定完了 → 判定待機中"
                    self._wait(self.cfg.judge_delay_sec)  # 表示が安定するまで少し待つ
                    self._state = State.JUDGING
                elif snap.active_rows:
                    progress = [f"{r}:{snap.lamp_states.get(r, '?')}" for r in snap.active_rows]
                    on_n = sum(1 for r in snap.active_rows if snap.lamp_states.get(r) == "ON")
                    if not self._saw_lamp_on:
                        self._activity = "測定開始待ち（ランプ点灯を監視）"
                    elif on_n > 0:
                        self._activity = f"測定中… ランプ {on_n}/{len(snap.active_rows)} 点灯"
                    else:
                        self._activity = "測定終了確認中（ランプ全消灯→判定へ）"
                    self.log("測定中 " + " ".join(progress))

            elif self._state == State.JUDGING:
                self._activity = "傾の数値を判定中"
                # 判定時はフル（位置補正＋傾OCR＋型式機番）
                snap = self.take_snapshot(read_no=True, read_tilt=True,
                                          read_comment=False, read_meta=True, do_anchor=True)
                self._emit(snap)
                # 各行の傾値・閾値・OK/NGを明示ログ（実験中の可視化）
                detail = []
                for r in snap.active_rows:
                    v = snap.tilt_values.get(r)
                    th = self.threshold_for(r)
                    mark = "NG" if self.is_ng(r, v) else ("?" if v is None else "OK")
                    detail.append(f"{r}={v}(閾値±{th}/{mark})")
                self.log("傾判定: " + "  ".join(detail))
                ng_rows = [r for r in snap.active_rows if self.is_ng(r, snap.tilt_values.get(r))]
                self._append_csv(snap, ng_rows, phase="tilt")
                if ng_rows:
                    self.log(f"傾NG検知: {ng_rows} → スクショ保存して再測定準備")
                    if self.cfg.save_ng_screenshot:
                        self._save_screenshot("tiltNG")
                    self._state = State.TILT_NG_RETRY
                elif self.cfg.auto_correction_enabled:
                    self.log(f"傾OK / 値={snap.tilt_values} → 自動補正へ")
                    self._state = State.AUTO_CORRECTING
                else:
                    self.log(f"OK / 値={snap.tilt_values}（自動補正モードOFF）")
                    self._finish_session(snap, "OK")
                    self._state = State.IDLE

            elif self._state == State.TILT_NG_RETRY:
                if not self.cfg.auto_retry or self._tilt_retry >= self.cfg.max_tilt_retries:
                    self.log(f"傾リトライ上限({self._tilt_retry}/{self.cfg.max_tilt_retries})到達")
                    self._finish_session(snap, "NG_GIVEUP")
                    self._activity = "停止: 傾NG上限到達（監視OFF→ONで再開）"
                    self._state = State.ERROR
                else:
                    self._tilt_retry += 1
                    self.log(f"傾リトライ {self._tilt_retry}/{self.cfg.max_tilt_retries}")
                    self._trigger_recapture()
                    self._state = State.IDLE

            elif self._state == State.AUTO_CORRECTING:
                self._activity = "自動補正を実行中"
                # LabVIEW ボタンは pywinauto から叩けないので座標クリック
                clicked = self._locator.click_at_rect(self.cfg.button_autocorrect_rect)
                self.log(f"自動補正クリック: {'成功' if clicked else '失敗'}")
                self._wait(self.cfg.auto_correct_wait_sec)
                self._state = State.PRECISION_JUDGING

            elif self._state == State.PRECISION_JUDGING:
                self._activity = "精度（コメント欄）を判定中"
                snap = self.take_snapshot(read_no=False, read_tilt=False,
                                          read_comment=True, read_meta=False, do_anchor=True)
                self._emit(snap)
                self._append_csv(snap, [], phase="precision")
                if snap.precision_ng:
                    self.log(f"精度不良検出: '{snap.comment_text}' → スクショ保存して再測定準備")
                    if self.cfg.save_ng_screenshot:
                        self._save_screenshot("precisionNG")
                    self._state = State.PRECISION_NG_RETRY
                else:
                    self.log(f"精度OK / コメント='{snap.comment_text}' → 完了")
                    self._finish_session(snap, "OK")
                    self._state = State.IDLE

            elif self._state == State.PRECISION_NG_RETRY:
                if not self.cfg.auto_retry or self._precision_retry >= self.cfg.max_precision_retries:
                    self.log(f"精度リトライ上限({self._precision_retry}/{self.cfg.max_precision_retries})到達")
                    self._finish_session(snap, "NG_GIVEUP")
                    self._activity = "停止: 精度NG上限到達（監視OFF→ONで再開）"
                    self._state = State.ERROR
                else:
                    self._precision_retry += 1
                    self.log(f"精度リトライ {self._precision_retry}/{self.cfg.max_precision_retries}")
                    self._trigger_recapture()
                    self._state = State.IDLE

            prev_pressed = snap.button_pressed
            prev_all_done = all_done

            interval = self.cfg.idle_poll_interval_sec if self._state == State.IDLE else self.cfg.poll_interval_sec
            self._wait(interval)

    def _wait(self, seconds: float) -> None:
        self._stop.wait(max(0.1, seconds))

    def _save_screenshot(self, tag: str) -> str | None:
        """現在のウィンドウ全体をスクショ保存。保存先パスを返す。"""
        rect = self._locator.rect()
        if not rect:
            return None
        left, top, right, bottom = rect
        img = self._sampler.grab((left, top, right - left, bottom - top))
        if img is None:
            return None
        out_dir = self._resolve_path(self.cfg.ng_screenshot_dir, "ng_shots")
        try:
            out_dir.mkdir(parents=True, exist_ok=True)
            ts = datetime.now().strftime("%Y%m%d_%H%M%S")
            model = (self._current_model or "NA").replace("/", "_").replace("\\", "_")
            mach = (self._current_machine or "NA").replace("/", "_").replace("\\", "_")
            path = out_dir / f"{ts}_{model}_{mach}_{tag}.png"
            img.save(path)
            self.log(f"スクショ保存: {path.name}")
            return str(path)
        except Exception as exc:
            self.log(f"スクショ保存失敗: {exc}")
            return None

    def _trigger_recapture(self) -> None:
        """再測定の準備: 取込開始ボタンを押し、その後 SwitchBot を起動。
        各ステップ間に設定した待ち時間を挟む。"""
        self._total_recaptures += 1
        # 1) NG画面のスクショ後、取込開始押下まで待つ
        self._activity = f"再測定準備: 待機中 ({self.cfg.wait_before_capture_sec}秒)"
        self._wait(self.cfg.wait_before_capture_sec)
        # 2) 取込開始ボタンを押す（LabVIEWボタンは pywinauto から
        #   叩けないため、矩形の中心を座標クリック）
        self._activity = "再測定: 取込開始ボタンを押下"
        clicked = self._locator.click_at_rect(self.cfg.button_capture_rect)
        self.log(f"取込開始クリック: {'成功' if clicked else '失敗'}")
        # 2.5) 確認ダイアログが出たら「測定開始」を押す（最大3秒ポーリング）
        if self._dismiss_confirm_dialog():
            self._wait(0.6)
        # 3) SwitchBot起動まで待つ
        self._activity = f"再測定: SwitchBot起動待ち ({self.cfg.wait_after_capture_sec}秒)"
        self._wait(self.cfg.wait_after_capture_sec)
        # 4) SwitchBotを起動（選択パターンに従い複数押し対応・dry_runならスキップ）
        self.execute_switchbot_pattern()
        # 5) 起動後の待ち
        self._activity = f"再測定: 起動後待ち ({self.cfg.wait_after_switchbot_sec}秒)"
        self._wait(self.cfg.wait_after_switchbot_sec)

    def _dismiss_confirm_dialog(self) -> bool:
        """「データが保存されていません。このまま測定しますか？」確認ダイアログが
        出ていれば「測定開始」を押す。出ない/未登録なら何もしない。

        2段階構成（推奨）:
          confirm_dialog_rect = ダイアログ本文の独自テキストを囲む（出現検知用）
          confirm_button_rect = 押す「測定開始」ボタン位置
        最大3秒、0.5秒間隔でポーリング。
        """
        btn_rel = self.cfg.confirm_button_rect
        det_rel = self.cfg.confirm_dialog_rect
        if not btn_rel or len(btn_rel) != 4:
            if not self._confirm_warned:
                self.log("[ヒント] 確認ダイアログの位置が未登録です。"
                         "矩形設定で『確認ダイアログ本文』と『測定開始ボタン』の2つを登録すると自動で押せます")
                self._confirm_warned = True
            return False

        # 出現検知に使う矩形を選ぶ: 本文側があればそちらを優先（誤検知が少ない）
        if det_rel and len(det_rel) == 4:
            check_rel = det_rel
            keywords = ("データ", "保存", "このまま", "測定")
        else:
            # フォールバック: ボタン位置の文字「測定開始」で判定
            check_rel = btn_rel
            keywords = ("測定開始",)

        import time as _t
        deadline = _t.monotonic() + 3.0
        attempts = 0
        last_text = ""
        while _t.monotonic() < deadline and not self._stop.is_set():
            attempts += 1
            abs_r = self._locator.rel_to_abs(check_rel)
            if abs_r:
                text = self._sampler.ocr_text_jpn(abs_r)
                last_text = "".join(text.split()) if text else ""
                if last_text and any(k in last_text for k in keywords):
                    self.log(f"[確認ダイアログ] 検出: '{last_text}' → 測定開始 押下")
                    return self._locator.click_at_rect(btn_rel)
            self._wait(0.5)
        self.log(f"[確認ダイアログ] 出現せず（{attempts}回確認・直近OCR='{last_text}'）")
        return False

    def _finish_session(self, snap: Snapshot, outcome: str) -> None:
        """1測定セッションの終端処理。集計カウンタ更新＋サマリCSV記録。"""
        attempts = self._tilt_retry + 1  # 初回測定 + 傾リトライ回数
        if outcome == "OK":
            self._ok_count += 1
            self.log(f"セッション完了[OK] 型式={self._current_model or '(未取得)'} "
                     f"傾リトライ={self._tilt_retry} 精度リトライ={self._precision_retry} "
                     f"（{attempts}回目で合格）")
        else:
            self._ng_giveup_count += 1
            self.log(f"セッション完了[NG断念] 型式={self._current_model or '(未取得)'} "
                     f"傾リトライ={self._tilt_retry} 精度リトライ={self._precision_retry}")
        self._append_summary(snap, outcome, attempts)
        self._session_active = False
        self._tilt_retry = 0
        self._precision_retry = 0

    def counters(self) -> dict[str, Any]:
        """ミニ表示用の現在カウンタ。"""
        return {
            "running": bool(self._thread and self._thread.is_alive()),
            "state": self._state.value,
            "activity": self._activity,
            "model": self._current_model,
            "machine": self._current_machine,
            "tilt_retry": self._tilt_retry,
            "precision_retry": self._precision_retry,
            "max_tilt": self.cfg.max_tilt_retries,
            "max_precision": self.cfg.max_precision_retries,
            "ok": self._ok_count,
            "ng": self._ng_giveup_count,
            "recaptures": self._total_recaptures,
        }

    def _send_switchbot(self) -> bool:
        ok, msg = self.send_switchbot_press()
        if not ok:
            self.log(f"SwitchBot エラー: {msg}")
        return ok

    def send_switchbot_press(self) -> tuple[bool, str]:
        """設定に応じて BLE直結 または クラウドAPI で press を送る。(成功, メッセージ)"""
        if self.cfg.switchbot_use_ble:
            return self.send_switchbot_ble_press()
        return self._send_switchbot_cloud()

    def execute_switchbot_pattern(self) -> bool:
        """選択中のパターンに従って SwitchBot を複数回押す。
        パターン = 各押下の後ろに置く待ち秒のリスト。例 [5.0, 0.0] = 押→5秒→押。"""
        name = self.cfg.switchbot_pattern_name
        pattern = self.cfg.switchbot_patterns.get(name) or [0.0]
        n = len(pattern)
        success = True
        for i, wait_after in enumerate(pattern, start=1):
            self._activity = f"再測定: SwitchBot押下 {i}/{n}"
            if self.cfg.dry_run:
                self.log(f"[リハーサル] SwitchBot送信スキップ ({i}/{n} - パターン『{name}』)")
            else:
                ok, msg = self.send_switchbot_press()
                self.log(f"SwitchBot 起動 {i}/{n}（パターン『{name}』）: "
                         f"{'成功' if ok else '失敗'} {msg}")
                success = success and ok
            if wait_after > 0 and i < n:
                self._activity = f"再測定: 次の押下まで待機 ({wait_after}秒) [{i}/{n}]"
                self._wait(wait_after)
        return success

    # ---- BLE 直結（ハブ不要） -------------------------------------------
    @staticmethod
    def _run_async(coro: Any) -> Any:
        """専用スレッドで asyncio コルーチンを実行して結果を返す。

        Windows では GUI(Tk) スレッド上で bleak を動かすと WinRT の
        コールバックが届かない（STAアパートメント問題）。別スレッドで
        独自イベントループを回すことで回避する。
        """
        import asyncio
        import threading
        box: dict[str, Any] = {}

        def worker() -> None:
            loop = asyncio.new_event_loop()
            try:
                box["value"] = loop.run_until_complete(coro)
            except BaseException as exc:  # noqa: BLE001
                box["error"] = exc
            finally:
                loop.close()

        t = threading.Thread(target=worker, daemon=True)
        t.start()
        t.join()
        if "error" in box:
            raise box["error"]
        return box.get("value")

    def _ble_press_payload(self) -> bytes:
        pw = self.cfg.switchbot_ble_password.strip()
        if not pw:
            return bytes([0x57, 0x01, 0x00])  # press（パスワード無し）
        import binascii
        crc = binascii.crc32(pw.encode()) & 0xFFFFFFFF
        return bytes([0x57, 0x11]) + crc.to_bytes(4, "big") + bytes([0x00])

    def send_switchbot_ble_press(self) -> tuple[bool, str]:
        """PC の Bluetooth から Bot に直接 press を送る。(成功, メッセージ)"""
        mac = self.cfg.switchbot_ble_mac.strip()
        if not mac:
            return False, "BLE MACアドレスが未設定"
        try:
            from bleak import BleakClient
        except Exception as exc:
            return False, f"bleak 未導入: {exc}（start.bat 再実行で導入）"
        payload = self._ble_press_payload()

        async def _run() -> str:
            async with BleakClient(mac, timeout=15.0) as client:
                char = self._find_write_char(client)
                if char is None:
                    avail = [c.uuid for s in client.services for c in s.characteristics]
                    raise RuntimeError(
                        "書込可能なSwitchBot特性が見つかりません。"
                        "選んだ機器がBotでない可能性。検出特性=" + ", ".join(avail)
                    )
                await client.write_gatt_char(char, payload, response=True)
                return char.uuid

        try:
            used = self._run_async(_run())
            return True, f"BLE press 送信OK ({mac} / {used})"
        except Exception as exc:
            return False, f"BLE例外: {exc}"

    @staticmethod
    def _find_write_char(client: Any) -> Any:
        """接続済みクライアントから書込先特性を探す。既知UUID優先、無ければ
        SwitchBotベンダ(cba2...)の書込可能特性をフォールバックで選ぶ。"""
        for s in client.services:
            for c in s.characteristics:
                if c.uuid.lower() == SWITCHBOT_BLE_WRITE_CHAR:
                    return c
        for s in client.services:
            for c in s.characteristics:
                props = [p.lower() for p in c.properties]
                writable = any("write" in p for p in props)
                if writable and c.uuid.lower().startswith("cba2"):
                    return c
        return None

    def inspect_switchbot_ble(self) -> tuple[bool, str]:
        """指定MACに接続し、GATTサービス/特性の一覧を文字列で返す（診断用）。"""
        mac = self.cfg.switchbot_ble_mac.strip()
        if not mac:
            return False, "BLE MACアドレスが未設定"
        try:
            from bleak import BleakClient
        except Exception as exc:
            return False, f"bleak 未導入: {exc}"

        async def _run() -> str:
            lines: list[str] = []
            async with BleakClient(mac, timeout=15.0) as client:
                for s in client.services:
                    lines.append(f"Service {s.uuid}")
                    for c in s.characteristics:
                        props = ",".join(c.properties)
                        lines.append(f"  Char {c.uuid} [{props}]")
            return "\n".join(lines) or "(特性なし)"

        try:
            return True, self._run_async(_run())
        except Exception as exc:
            return False, f"BLE例外: {exc}"

    def scan_switchbot_ble(self, timeout: float = 6.0) -> tuple[bool, list[dict], str]:
        """近くの BLE 機器をスキャン。SwitchBot を優先表示。(成功, list, メッセージ)"""
        try:
            from bleak import BleakScanner
        except Exception as exc:
            return False, [], f"bleak 未導入: {exc}（start.bat 再実行で導入）"

        async def _run() -> list[dict]:
            out: list[dict] = []
            results = await BleakScanner.discover(timeout=timeout, return_adv=True)
            for dev, adv in results.values():
                sd = adv.service_data or {}
                is_sb = any(str(k).lower().startswith("0000fd3d") for k in sd)
                model = ""
                for k, v in sd.items():
                    if str(k).lower().startswith("0000fd3d") and v:
                        model = chr(v[0] & 0x7F)
                out.append({
                    "mac": dev.address,
                    "name": adv.local_name or (dev.name or ""),
                    "rssi": adv.rssi if adv.rssi is not None else -999,
                    "switchbot": is_sb,
                    "model": model,
                })
            return out

        try:
            devs = self._run_async(_run())
            devs.sort(key=lambda d: (not d["switchbot"], -d["rssi"]))
            sb = sum(1 for d in devs if d["switchbot"])
            return True, devs, f"{len(devs)} 件検出 (SwitchBot {sb} 件)"
        except Exception as exc:
            return False, [], f"BLE例外: {exc}"

    # ---- クラウド API ---------------------------------------------------
    def _send_switchbot_cloud(self) -> tuple[bool, str]:
        """SwitchBot v1.1 API で press コマンドを送信。(成功フラグ, メッセージ)"""
        if not (self.cfg.switchbot_token and self.cfg.switchbot_secret and self.cfg.switchbot_device_id):
            return False, "Token / Secret / DeviceID が未設定"
        try:
            import base64, hashlib, hmac, time as _t, urllib.request, uuid
            token = self.cfg.switchbot_token
            secret = self.cfg.switchbot_secret
            device_id = self.cfg.switchbot_device_id
            nonce = str(uuid.uuid4())
            t = str(int(round(_t.time() * 1000)))
            sign = base64.b64encode(
                hmac.new(secret.encode(), f"{token}{t}{nonce}".encode(), hashlib.sha256).digest()
            ).decode()
            url = f"https://api.switch-bot.com/v1.1/devices/{device_id}/commands"
            body = json.dumps({"command": "press", "parameter": "default", "commandType": "command"}).encode()
            req = urllib.request.Request(
                url, data=body, method="POST",
                headers={"Authorization": token, "sign": sign, "t": t, "nonce": nonce,
                         "Content-Type": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode() or "{}")
            code = data.get("statusCode", -1)
            if code == 100:
                return True, data.get("message", "OK")
            return False, f"statusCode={code} message={data.get('message')}"
        except Exception as exc:
            return False, f"例外: {exc}"

    def fetch_switchbot_devices(self) -> tuple[bool, list[dict], str]:
        """GET /v1.1/devices で登録デバイス一覧を取得。(成功フラグ, devices, メッセージ)"""
        if not (self.cfg.switchbot_token and self.cfg.switchbot_secret):
            return False, [], "Token / Secret が未設定"
        try:
            import base64, hashlib, hmac, time as _t, urllib.request, uuid
            token = self.cfg.switchbot_token
            nonce = str(uuid.uuid4())
            t = str(int(round(_t.time() * 1000)))
            sign = base64.b64encode(
                hmac.new(self.cfg.switchbot_secret.encode(),
                         f"{token}{t}{nonce}".encode(), hashlib.sha256).digest()
            ).decode()
            req = urllib.request.Request(
                "https://api.switch-bot.com/v1.1/devices", method="GET",
                headers={"Authorization": token, "sign": sign, "t": t, "nonce": nonce,
                         "Content-Type": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode() or "{}")
            if data.get("statusCode") != 100:
                return False, [], f"statusCode={data.get('statusCode')} message={data.get('message')}"
            body = data.get("body", {}) or {}
            devs = list(body.get("deviceList", [])) + list(body.get("infraredRemoteList", []))
            return True, devs, f"{len(devs)} 件"
        except Exception as exc:
            return False, [], f"例外: {exc}"

    # ------------------------------------------------------------------
    # CSV 履歴
    # ------------------------------------------------------------------
    def _resolve_path(self, raw: str, default: str) -> Path:
        p = Path(raw or default)
        if not p.is_absolute():
            base = Path(sys.executable).parent if getattr(sys, "frozen", False) else Path(__file__).resolve().parent
            p = base / p
        return p

    def _csv_path(self) -> Path:
        return self._resolve_path(self.cfg.csv_log_path, "xr20_monitor_history.csv")

    def _summary_path(self) -> Path:
        return self._resolve_path(self.cfg.summary_csv_path, "xr20_monitor_summary.csv")

    def _append_csv(self, snap: Snapshot, ng_rows: list[str], phase: str = "tilt") -> None:
        path = self._csv_path()
        rows = list(self.cfg.target_rows)
        header = ["date", "timestamp", "model", "machine_no", "phase", "active_rows",
                  "ng_rows", "comment", "precision_ng",
                  *[f"{r}_tilt" for r in rows], *[f"{r}_lamp" for r in rows]]
        write_header = not path.exists()
        now = datetime.now()
        try:
            with path.open("a", newline="", encoding="utf-8") as f:
                w = csv.writer(f)
                if write_header:
                    w.writerow(header)
                w.writerow([
                    now.strftime("%Y-%m-%d"),
                    now.isoformat(timespec="seconds"),
                    self._current_model,
                    self._current_machine,
                    phase,
                    "|".join(snap.active_rows),
                    "|".join(ng_rows),
                    snap.comment_text,
                    int(snap.precision_ng),
                    *[snap.tilt_values.get(r, "") for r in rows],
                    *[snap.lamp_states.get(r, "") for r in rows],
                ])
        except OSError as exc:
            self.log(f"CSV 書込失敗: {exc}")

    def _append_summary(self, snap: Snapshot, outcome: str, attempts: int) -> None:
        """測定セッション単位のサマリ。型式・機番別の再測定回数集計に使う。"""
        path = self._summary_path()
        rows = list(self.cfg.target_rows)
        header = ["date", "timestamp", "model", "machine_no", "outcome", "tilt_retries",
                  "precision_retries", "total_attempts", "comment", *[f"{r}_tilt" for r in rows]]
        write_header = not path.exists()
        now = datetime.now()
        try:
            with path.open("a", newline="", encoding="utf-8") as f:
                w = csv.writer(f)
                if write_header:
                    w.writerow(header)
                w.writerow([
                    now.strftime("%Y-%m-%d"),
                    now.isoformat(timespec="seconds"),
                    self._current_model,
                    self._current_machine,
                    outcome,
                    self._tilt_retry,
                    self._precision_retry,
                    attempts,
                    snap.comment_text,
                    *[snap.tilt_values.get(r, "") for r in rows],
                ])
        except OSError as exc:
            self.log(f"サマリCSV 書込失敗: {exc}")


# ======================================================================
# クリックピッカー（矩形ドラッグ設定）
# ======================================================================
class RectPicker:
    """画面キャプチャを表示し、ユーザーにドラッグで矩形を順次指定させるダイアログ。

    指定完了でコールバックに (name -> [x_frac, y_frac, w_frac, h_frac]) dict を返す。
    保存するのは比率のみ。キャプチャ画像はピッカー終了時に破棄。
    """

    def __init__(self, parent, monitor: "XR20Monitor",
                 on_done: Callable[[dict[str, list[float]]], None],
                 prefetched: tuple | None = None) -> None:
        import tkinter as tk
        from PIL import ImageTk
        self._tk = tk
        self._ImageTk = ImageTk
        self.monitor = monitor
        self.on_done = on_done

        # 対象の順序（key, 説明ラベル）
        self.targets: list[tuple[str, str]] = []
        if monitor.cfg.use_template_anchor:
            self.targets.append(("anchor_a", "【位置補正 目印A】「終了」赤ボタン（左上・特徴的で動かない）"))
            self.targets.append(("anchor_b", "【位置補正 目印B】「CW/CCW」凡例（右下・特徴的で動かない）"))
        self.targets.append(("model", "型式（品番）の表示セル"))
        self.targets.append(("machine", "機番（機械番号）の表示セル"))
        self.targets.append(("button_capture", "取込開始 ボタン"))
        self.targets.append(("button_autocorrect", "自動補正 ボタン"))
        self.targets.append(("comment", "コメント欄（精度不良が出る場所）"))
        self.targets.append(("confirm_dialog", "[任意・スキップ可] 確認ダイアログの本文"
                              "（『データが保存されていません』の文字部分・出現検知用）"))
        self.targets.append(("confirm_button", "[任意・スキップ可] 確認ダイアログの「測定開始」ボタン位置"))
        for row in monitor.cfg.target_rows:
            self.targets.append((f"no:{row}", f"No 列 [{row}]（番号が表示されるセル）"))
            self.targets.append((f"lamp:{row}", f"緑ランプ [{row}]"))
            self.targets.append((f"tilt:{row}", f"傾 列 [{row}]（数値セル）"))

        self.results: dict[str, list[float]] = {}
        self.index = 0

        # ウィンドウ位置と全体画像（事前取得済みなら再取得しない＝GUI固まり防止）
        if prefetched is not None:
            self.window_rect, self.full_image = prefetched
        else:
            if not monitor._locator.refresh():
                self.monitor.log("[ピッカー] ウィンドウ未検出 → 中止")
                return
            self.window_rect = monitor._locator.rect()
            if not self.window_rect:
                return
            left, top, right, bottom = self.window_rect
            self.full_image = monitor._sampler.grab((left, top, right - left, bottom - top))
        if not self.window_rect or self.full_image is None:
            self.monitor.log("[ピッカー] ウィンドウ未検出または画面キャプチャ失敗 → 中止")
            return

        left, top, right, bottom = self.window_rect
        ww = right - left
        wh = bottom - top
        self.top = tk.Toplevel(parent)
        self.top.title("矩形設定（ドラッグで指定）")
        # 画面に収まるよう最大 1280x720 にリサイズ
        self.scale = min(1280 / ww, 720 / wh, 1.0)
        disp_w = int(ww * self.scale)
        disp_h = int(wh * self.scale)
        disp_img = self.full_image.resize((disp_w, disp_h))
        self.tk_image = ImageTk.PhotoImage(disp_img)

        self.status = tk.StringVar()
        tk.Label(self.top, textvariable=self.status, fg="#202080",
                 font=("Arial", 12, "bold")).pack(fill="x", padx=4, pady=4)
        self.canvas = tk.Canvas(self.top, width=disp_w, height=disp_h,
                                cursor="cross", highlightthickness=0)
        self.canvas.pack()
        self.canvas.create_image(0, 0, anchor="nw", image=self.tk_image)

        btns = tk.Frame(self.top)
        btns.pack(fill="x", pady=4)
        tk.Button(btns, text="スキップ（この要素を変更しない）",
                  command=self._skip).pack(side="left", padx=4)
        tk.Button(btns, text="中止", command=self._cancel).pack(side="right", padx=4)

        self.canvas.bind("<ButtonPress-1>", self._press)
        self.canvas.bind("<B1-Motion>", self._drag)
        self.canvas.bind("<ButtonRelease-1>", self._release)
        self._drag_start: tuple[int, int] | None = None
        self._rect_id: int | None = None
        self._update_status()

    def _update_status(self) -> None:
        if self.index >= len(self.targets):
            self._finish()
            return
        key, label = self.targets[self.index]
        self.status.set(
            f"[{self.index + 1}/{len(self.targets)}] {label} をドラッグで囲んでください"
        )

    def _press(self, event) -> None:
        self._drag_start = (event.x, event.y)
        if self._rect_id:
            self.canvas.delete(self._rect_id)
        self._rect_id = self.canvas.create_rectangle(
            event.x, event.y, event.x, event.y, outline="red", width=2
        )

    def _drag(self, event) -> None:
        if not self._drag_start or not self._rect_id:
            return
        x0, y0 = self._drag_start
        self.canvas.coords(self._rect_id, x0, y0, event.x, event.y)

    def _release(self, event) -> None:
        if not self._drag_start:
            return
        x0, y0 = self._drag_start
        x1, y1 = event.x, event.y
        self._drag_start = None
        if abs(x1 - x0) < 3 or abs(y1 - y0) < 3:
            self.status.set("矩形が小さすぎます。もう一度ドラッグしてください。")
            return
        # ウィンドウ幅/高さに対する比率に変換
        left, top, right, bottom = self.window_rect
        ww = right - left
        wh = bottom - top
        x = min(x0, x1) / self.scale
        y = min(y0, y1) / self.scale
        w = abs(x1 - x0) / self.scale
        h = abs(y1 - y0) / self.scale
        rel = [round(x / ww, 4), round(y / wh, 4),
               round(w / ww, 4), round(h / wh, 4)]
        key, _label = self.targets[self.index]
        self.results[key] = rel
        self.index += 1
        if self._rect_id:
            self.canvas.delete(self._rect_id)
            self._rect_id = None
        self._update_status()

    def _skip(self) -> None:
        self.index += 1
        self._update_status()

    def _cancel(self) -> None:
        self.top.destroy()

    def _finish(self) -> None:
        self.on_done(self.results, self.full_image)
        self.top.destroy()


def apply_picker_results(cfg: MonitorConfig, results: dict[str, list[float]]) -> int:
    """ピッカーの結果を cfg に反映。書き換えた項目数を返す。"""
    count = 0
    for key, rel in results.items():
        if key == "button_capture":
            cfg.button_capture_rect = rel
        elif key == "button_autocorrect":
            cfg.button_autocorrect_rect = rel
        elif key == "comment":
            cfg.comment_rect = rel
        elif key == "confirm_dialog":
            cfg.confirm_dialog_rect = rel
        elif key == "confirm_button":
            cfg.confirm_button_rect = rel
        elif key == "model":
            cfg.model_rect = rel
        elif key == "machine":
            cfg.machine_rect = rel
        elif key == "anchor_a":
            cfg.anchor_a_rect = rel
        elif key == "anchor_b":
            cfg.anchor_b_rect = rel
        elif key.startswith("no:"):
            cfg.no_column_rects[key[3:]] = rel
        elif key.startswith("lamp:"):
            cfg.lamp_rects[key[5:]] = rel
        elif key.startswith("tilt:"):
            cfg.tilt_rects[key[5:]] = rel
        else:
            continue
        count += 1
    return count


def save_anchor_templates(results: dict[str, list[float]], full_image: Any, base_dir: Path) -> int:
    """目印A/Bの矩形からテンプレ画像を切り出して保存。保存数を返す。"""
    saved = 0
    if full_image is None:
        return 0
    W, H = full_image.size
    for key, fname in [("anchor_a", "anchor_a.png"), ("anchor_b", "anchor_b.png")]:
        rel = results.get(key)
        if not rel or len(rel) != 4:
            continue
        x0 = int(rel[0] * W)
        y0 = int(rel[1] * H)
        x1 = int((rel[0] + rel[2]) * W)
        y1 = int((rel[1] + rel[3]) * H)
        try:
            full_image.crop((x0, y0, x1, y1)).save(base_dir / fname)
            saved += 1
        except Exception:
            pass
    return saved


# ======================================================================
# GUI
# ======================================================================
class MonitorGUI:
    def __init__(self, monitor: XR20Monitor, config_path: Path) -> None:
        import queue
        import tkinter as tk
        from tkinter import ttk
        self._tk = tk
        self._ttk = ttk
        self.monitor = monitor
        self.config_path = config_path
        self._log_q: "queue.Queue[str]" = queue.Queue()

        self.root = tk.Tk()
        self.root.title("IK220 自動監視モニター")
        self.root.geometry("720x620")

        c = monitor.cfg
        self.hr_var = tk.DoubleVar(value=c.threshold_hr)
        self.wr_var = tk.DoubleVar(value=c.threshold_wr)
        self.poll_var = tk.DoubleVar(value=c.poll_interval_sec)
        self.idle_poll_var = tk.DoubleVar(value=c.idle_poll_interval_sec)
        self.tilt_retries_var = tk.IntVar(value=c.max_tilt_retries)
        self.precision_retries_var = tk.IntVar(value=c.max_precision_retries)
        self.dry_var = tk.BooleanVar(value=c.dry_run)
        self.auto_retry_var = tk.BooleanVar(value=c.auto_retry)
        self.auto_correct_var = tk.BooleanVar(value=c.auto_correction_enabled)
        self.anchor_var = tk.BooleanVar(value=c.use_template_anchor)
        self.state_var = tk.StringVar(value="IDLE")
        self.values_var = tk.StringVar(value="(未取得)")
        self.lamps_var = tk.StringVar(value="(未取得)")
        self.active_var = tk.StringVar(value="(未取得)")
        self.button_var = tk.StringVar(value="(未取得)")

        self._build()
        # GUIはメインスレッドからのみ更新する。監視スレッドはログをキューに積み、
        # スナップショットは monitor._last_snapshot に置くだけ。GUIが定期的に読みに行く。
        monitor._log_cb = self._log_q.put  # スレッドセーフ（Tkを触らない）
        self.root.after(200, self._gui_tick)

    def _gui_tick(self) -> None:
        # 1) ログをキューから取り出して反映
        drained = 0
        try:
            while drained < 200:
                msg = self._log_q.get_nowait()
                self._do_append(msg)
                drained += 1
        except Exception:
            pass
        # 2) 最新スナップショットで状態パネルを更新
        snap = self.monitor.last_snapshot()
        if snap is not None:
            self._apply_snapshot_to_panel(snap)
        # 3) ミニ表示も更新
        self._refresh_mini()
        self.root.after(250, self._gui_tick)

    def _apply_snapshot_to_panel(self, snap: "Snapshot") -> None:
        # 項目ごとに「判明している値」を保持する。データが無い周期で空に戻さない
        # （測定中の軽いスナップショットには傾値等が無いため）。
        c = self.monitor.counters()
        self.state_var.set(c.get("state", ""))
        self.button_var.set(
            f"{'PRESSED' if snap.button_pressed else 'IDLE'} RGB={snap.button_color}"
        )
        if snap.active_rows:
            self.active_var.set(", ".join(snap.active_rows))
        if snap.lamp_states:
            self.lamps_var.set(", ".join(f"{k}={v}" for k, v in snap.lamp_states.items()))
        if snap.tilt_values:  # 傾は判定時のみ取得 → 取れた時だけ更新し以降保持
            self.values_var.set(", ".join(f"{k}={v}" for k, v in snap.tilt_values.items()))
        if snap.comment_text:
            mark = " ⚠精度不良" if snap.precision_ng else ""
            self.comment_var.set(f"{snap.comment_text}{mark}")
        model = snap.model_name or self.monitor._current_model
        if model:
            self.model_var.set(model)
        machine = snap.machine_no or self.monitor._current_machine
        if machine:
            self.machine_var.set(machine)

    def _build(self) -> None:
        tk, ttk = self._tk, self._ttk
        frm = ttk.Frame(self.root, padding=8)
        frm.pack(fill="both", expand=True)

        # 閾値スライダー
        self._slider(frm, 0, "HR/HL 閾値 (秒)", self.hr_var, 0.5, 20)
        self._slider(frm, 1, "WR/WL 閾値 (秒)", self.wr_var, 0.5, 30)
        self._slider(frm, 2, "監視中ポーリング(秒)", self.poll_var, 0.5, 30)
        self._slider(frm, 3, "待機中ポーリング(秒)", self.idle_poll_var, 1, 60)
        self._slider(frm, 4, "傾NG 最大リトライ回数", self.tilt_retries_var, 0, 10, is_int=True)
        self._slider(frm, 5, "精度NG 最大リトライ回数", self.precision_retries_var, 0, 10, is_int=True)

        flags = ttk.Frame(frm)
        flags.grid(row=6, column=0, columnspan=3, sticky="w", pady=4)
        ttk.Checkbutton(flags, text="リハーサル (SwitchBot送信なし)", variable=self.dry_var,
                        command=self._apply).pack(side="left", padx=4)
        ttk.Checkbutton(flags, text="NG自動リトライ", variable=self.auto_retry_var,
                        command=self._apply).pack(side="left", padx=4)
        ttk.Checkbutton(flags, text="精度判定する（傾OK後 自動補正→コメント確認）", variable=self.auto_correct_var,
                        command=self._apply).pack(side="left", padx=4)

        flags2 = ttk.Frame(frm)
        flags2.grid(row=7, column=0, columnspan=3, sticky="w")
        ttk.Checkbutton(flags2, text="位置自動補正（テンプレート・保険機能 / 要 目印登録）",
                        variable=self.anchor_var, command=self._apply).pack(side="left", padx=4)

        # 状態表示
        status = ttk.LabelFrame(frm, text="現在状態", padding=6)
        status.grid(row=8, column=0, columnspan=3, sticky="ew", pady=6)
        self.comment_var = tk.StringVar(value="(未取得)")
        self.model_var = tk.StringVar(value="(未取得)")
        self.machine_var = tk.StringVar(value="(未取得)")
        for i, (lbl, var) in enumerate([
            ("型式", self.model_var), ("機番", self.machine_var),
            ("状態", self.state_var), ("ボタン", self.button_var),
            ("有効行", self.active_var), ("ランプ", self.lamps_var),
            ("傾値", self.values_var), ("コメント", self.comment_var),
        ]):
            ttk.Label(status, text=lbl + ":").grid(row=i, column=0, sticky="w", padx=2)
            ttk.Label(status, textvariable=var, foreground="#0060a0").grid(row=i, column=1, sticky="w", padx=4)

        btns = ttk.Frame(frm)
        btns.grid(row=9, column=0, columnspan=3, sticky="ew", pady=4)
        ttk.Button(btns, text="監視ON", command=self._start).pack(side="left", padx=2)
        ttk.Button(btns, text="監視OFF", command=self.monitor.stop).pack(side="left", padx=2)
        ttk.Button(btns, text="ミニ表示", command=self._open_mini).pack(side="left", padx=2)
        ttk.Button(btns, text="詳細設定…", command=self._open_settings).pack(side="left", padx=2)

        self.log_box = tk.Text(frm, height=15, wrap="none")
        self.log_box.grid(row=10, column=0, columnspan=3, sticky="nsew", pady=4)
        frm.columnconfigure(1, weight=1)
        frm.rowconfigure(10, weight=1)

    def _slider(self, parent, row, label, var, lo, hi, is_int=False):
        ttk, tk = self._ttk, self._tk
        ttk.Label(parent, text=label).grid(row=row, column=0, sticky="w")
        s = ttk.Scale(parent, from_=lo, to=hi, variable=var, orient="horizontal",
                      command=lambda _v: self._apply())
        s.grid(row=row, column=1, sticky="ew", padx=4)
        fmt = (lambda: str(int(var.get()))) if is_int else (lambda: f"{var.get():.1f}")
        val_lbl = ttk.Label(parent, width=7)
        val_lbl.grid(row=row, column=2)
        def refresh(*_):
            val_lbl.config(text=fmt())
        var.trace_add("write", refresh)
        refresh()

    def _apply(self) -> None:
        c = self.monitor.cfg
        c.threshold_hr = round(float(self.hr_var.get()), 2)
        c.threshold_wr = round(float(self.wr_var.get()), 2)
        c.poll_interval_sec = round(float(self.poll_var.get()), 1)
        c.idle_poll_interval_sec = round(float(self.idle_poll_var.get()), 1)
        c.max_tilt_retries = int(self.tilt_retries_var.get())
        c.max_precision_retries = int(self.precision_retries_var.get())
        c.dry_run = bool(self.dry_var.get())
        c.auto_retry = bool(self.auto_retry_var.get())
        c.auto_correction_enabled = bool(self.auto_correct_var.get())
        c.use_template_anchor = bool(self.anchor_var.get())

    def _open_settings(self) -> None:
        tk, ttk = self._tk, self._ttk
        win = tk.Toplevel(self.root)
        win.title("詳細設定 / 調整")
        win.transient(self.root)
        frm = ttk.Frame(win, padding=12)
        frm.pack(fill="both", expand=True)
        ttk.Label(frm, text="調整・診断ツール", font=("", 11, "bold")).pack(anchor="w", pady=(0, 8))
        for text, cmd in [
            ("SwitchBot設定", self._open_switchbot_dialog),
            ("SwitchBot押下パターン編集", self._open_switchbot_pattern_dialog),
            ("矩形設定（ドラッグで位置合わせ）", self._open_picker),
            ("キャリブ表示（認識枠の確認）", self._show_calibration),
            ("1回だけ読み取り（動作確認）", self._read_once),
            ("NG画像フォルダを開く", self._open_ng_folder),
            ("設定を保存", self._save),
        ]:
            ttk.Button(frm, text=text, width=34, command=cmd).pack(fill="x", pady=2)

        # 再測定シーケンスの待ち時間
        c = self.monitor.cfg
        seq = ttk.LabelFrame(frm, text="再測定シーケンスの待ち時間 (秒)", padding=8)
        seq.pack(fill="x", pady=(10, 0))
        self._wait_vars = {
            "wait_before_capture_sec": tk.DoubleVar(value=c.wait_before_capture_sec),
            "wait_after_capture_sec": tk.DoubleVar(value=c.wait_after_capture_sec),
            "wait_after_switchbot_sec": tk.DoubleVar(value=c.wait_after_switchbot_sec),
        }
        labels = {
            "wait_before_capture_sec": "NG検知/スクショ後→取込開始押下まで",
            "wait_after_capture_sec": "取込開始押下→SwitchBot起動まで",
            "wait_after_switchbot_sec": "SwitchBot起動後の待ち",
        }
        for i, (k, var) in enumerate(self._wait_vars.items()):
            ttk.Label(seq, text=labels[k]).grid(row=i, column=0, sticky="w", padx=2, pady=1)
            ttk.Spinbox(seq, from_=0, to=60, increment=0.5, textvariable=var,
                        width=6).grid(row=i, column=1, padx=4)
        self._screenshot_var = tk.BooleanVar(value=c.save_ng_screenshot)
        ttk.Checkbutton(seq, text="NG時に画面スクショを保存", variable=self._screenshot_var)\
            .grid(row=len(self._wait_vars), column=0, columnspan=2, sticky="w", pady=(4, 0))

        def apply_seq():
            for k, var in self._wait_vars.items():
                setattr(self.monitor.cfg, k, round(float(var.get()), 1))
            self.monitor.cfg.save_ng_screenshot = bool(self._screenshot_var.get())
            save_config(self.config_path, self.monitor.cfg)
            self.monitor.log("再測定タイミングを保存")
        ttk.Button(seq, text="この待ち時間を適用・保存", command=apply_seq)\
            .grid(row=len(self._wait_vars) + 1, column=0, columnspan=2, sticky="ew", pady=(6, 0))

        ttk.Button(frm, text="閉じる", command=win.destroy).pack(fill="x", pady=(10, 0))

    def _open_switchbot_pattern_dialog(self) -> None:
        """SwitchBot押下パターンの選択・編集ダイアログ。
        パターンは「名前」と「各押下後の待ち秒(カンマ区切り)」のテキストで管理。"""
        tk, ttk = self._tk, self._ttk
        c = self.monitor.cfg
        win = tk.Toplevel(self.root)
        win.title("SwitchBot 押下パターン")
        win.geometry("560x460")
        win.transient(self.root)

        frm = ttk.Frame(win, padding=10)
        frm.pack(fill="both", expand=True)
        ttk.Label(frm, text="使用するパターン:").pack(anchor="w")
        sel_var = tk.StringVar(value=c.switchbot_pattern_name)
        combo = ttk.Combobox(frm, textvariable=sel_var, state="readonly", values=[])
        combo.pack(fill="x", pady=(0, 8))

        ttk.Label(frm, text=(
            "パターン定義（1行1パターン、形式『名前: 各押下後の待ち秒(カンマ区切り)』）\n"
            "例:  2回押し（5秒間隔）: 5, 0   →  押す → 5秒待つ → 押す（最後の0は最終押下後）"
        ), foreground="#444").pack(anchor="w")
        text = tk.Text(frm, height=10, wrap="none")
        text.pack(fill="both", expand=True, pady=4)

        status_var = tk.StringVar(value="")
        ttk.Label(frm, textvariable=status_var, foreground="#0060a0").pack(anchor="w")

        def render():
            text.delete("1.0", "end")
            for name, waits in c.switchbot_patterns.items():
                text.insert("end", f"{name}: {', '.join(str(w) for w in waits)}\n")
            combo["values"] = list(c.switchbot_patterns.keys())
            if c.switchbot_pattern_name not in c.switchbot_patterns:
                if c.switchbot_patterns:
                    c.switchbot_pattern_name = next(iter(c.switchbot_patterns))
                    sel_var.set(c.switchbot_pattern_name)

        def parse_and_apply() -> str | None:
            new_patterns: dict[str, list[float]] = {}
            for ln in text.get("1.0", "end").splitlines():
                ln = ln.strip()
                if not ln or ":" not in ln:
                    continue
                name, rest = ln.split(":", 1)
                name = name.strip()
                if not name:
                    continue
                try:
                    waits = [float(x.strip()) for x in rest.split(",") if x.strip() != ""]
                except ValueError:
                    return f"数値解析エラー: {ln!r}"
                if not waits:
                    return f"待ち秒が空: {ln!r}"
                new_patterns[name] = waits
            if not new_patterns:
                return "パターンが1つもありません"
            c.switchbot_patterns = new_patterns
            chosen = sel_var.get().strip()
            c.switchbot_pattern_name = chosen if chosen in new_patterns else next(iter(new_patterns))
            return None

        def do_save():
            err = parse_and_apply()
            if err:
                status_var.set(f"[エラー] {err}")
                return
            save_config(self.config_path, c)
            status_var.set(f"保存しました（選択中: {c.switchbot_pattern_name}）")
            self.monitor.log(f"SwitchBotパターン保存: 選択中『{c.switchbot_pattern_name}』")
            render()

        def do_test():
            err = parse_and_apply()
            if err:
                status_var.set(f"[エラー] {err}")
                return
            status_var.set(f"テスト実行中（{c.switchbot_pattern_name}）…")
            win.update_idletasks()
            # GUIスレッドを長く止めないようバックグラウンドで実行
            self._run_bg(self.monitor.execute_switchbot_pattern,
                         lambda ok: status_var.set(f"テスト完了（成功={ok}）"))

        btns = ttk.Frame(frm)
        btns.pack(fill="x", pady=(6, 0))
        ttk.Button(btns, text="保存", command=do_save).pack(side="left", padx=2)
        ttk.Button(btns, text="このパターンでテスト送信", command=do_test).pack(side="left", padx=2)
        ttk.Button(btns, text="閉じる", command=win.destroy).pack(side="right", padx=2)

        render()

    def _open_ng_folder(self) -> None:
        import os
        import subprocess
        d = self.monitor._resolve_path(self.monitor.cfg.ng_screenshot_dir, "ng_shots")
        d.mkdir(parents=True, exist_ok=True)
        try:
            if sys.platform == "win32":
                os.startfile(str(d))  # type: ignore[attr-defined]
            elif sys.platform == "darwin":
                subprocess.Popen(["open", str(d)])
            else:
                subprocess.Popen(["xdg-open", str(d)])
            self.monitor.log(f"NG画像フォルダ: {d}")
        except Exception as exc:
            self.monitor.log(f"フォルダを開けません: {d} ({exc})")

    def _open_mini(self) -> None:
        tk, ttk = self._tk, self._ttk
        if getattr(self, "_mini", None) is not None:
            try:
                self._mini.deiconify()
                self._mini.lift()
                return
            except Exception:
                self._mini = None
        mini = tk.Toplevel(self.root)
        mini.title("IK220 ミニ")
        mini.attributes("-topmost", True)
        mini.resizable(False, False)
        mini.configure(bg="#1e1e1e")
        sw = mini.winfo_screenwidth()
        sh = mini.winfo_screenheight()
        w, h = 360, 340
        mini.geometry(f"{w}x{h}+{sw - w - 20}+{sh - h - 60}")
        self._mini = mini

        self._mini_run = tk.StringVar()
        self._mini_activity = tk.StringVar()
        self._mini_state = tk.StringVar()
        self._mini_model = tk.StringVar()
        self._mini_machine = tk.StringVar()
        self._mini_retry = tk.StringVar()
        self._mini_total = tk.StringVar()

        # ボタンを先に下端固定で配置（はみ出して隠れないように）
        btnbar = tk.Frame(mini, bg="#1e1e1e")
        btnbar.pack(side="bottom", fill="x", padx=10, pady=8)
        tk.Button(btnbar, text="監視開始", command=self._start,
                  bg="#2d7d33", fg="white", relief="flat",
                  font=("Meiryo", 11, "bold"), height=1).pack(side="left", fill="x", expand=True, padx=3)
        tk.Button(btnbar, text="停止", command=self.monitor.stop,
                  bg="#9c3030", fg="white", relief="flat",
                  font=("Meiryo", 11, "bold"), height=1).pack(side="left", fill="x", expand=True, padx=3)

        def row(var, size, color):
            lab = tk.Label(mini, textvariable=var, bg="#1e1e1e", fg=color,
                           font=("Meiryo", size, "bold"), anchor="w", justify="left")
            lab.pack(fill="x", padx=12, pady=1)
            return lab

        self._mini_run_lbl = row(self._mini_run, 14, "#33dd55")
        row(self._mini_activity, 12, "#ffe27a")  # 今の動作（強調）
        row(self._mini_state, 10, "#aaaaaa")
        row(self._mini_model, 11, "#9cdcfe")
        row(self._mini_machine, 11, "#9cdcfe")
        row(self._mini_retry, 11, "#ffcc66")
        row(self._mini_total, 11, "#dddddd")

        mini.protocol("WM_DELETE_WINDOW", self._close_mini)
        self._refresh_mini()  # 以降は _gui_tick が定期更新する

    def _close_mini(self) -> None:
        if getattr(self, "_mini", None) is not None:
            self._mini.destroy()
            self._mini = None

    def _refresh_mini(self) -> None:
        mini = getattr(self, "_mini", None)
        if mini is None:
            return
        c = self.monitor.counters()
        self._mini_run.set("●  監視中" if c["running"] else "■  停止中")
        self._mini_activity.set(f"動作　 : {c.get('activity', '')}")
        self._mini_state.set(f"状態　 : {c['state']}")
        self._mini_model.set(f"型式　 : {c['model'] or '(未取得)'}")
        self._mini_machine.set(f"機番　 : {c['machine'] or '(未取得)'}")
        self._mini_retry.set(
            f"再測定 : 傾 {c['tilt_retry']}/{c['max_tilt']}　精度 {c['precision_retry']}/{c['max_precision']}"
        )
        self._mini_total.set(f"累計　 : OK {c['ok']} ／ NG {c['ng']} ／ 再測定 {c['recaptures']}")
        try:
            self._mini_run_lbl.configure(fg="#33dd55" if c["running"] else "#aaaaaa")
        except Exception:
            pass

    def _start(self) -> None:
        self._apply()
        self.monitor.start()

    def _save(self) -> None:
        self._apply()
        save_config(self.config_path, self.monitor.cfg)
        self.monitor.log(f"設定保存: {self.config_path}")

    def _run_bg(self, fn, on_done=None) -> None:
        """重い処理(pywinauto/OCR)を別スレッドで実行しGUIの固まりを防ぐ。"""
        import threading

        def worker():
            try:
                result = fn()
                err = None
            except Exception as exc:  # noqa: BLE001
                result, err = None, exc
            def finish():
                if err is not None:
                    self.monitor.log(f"[エラー] {err}")
                elif on_done is not None:
                    on_done(result)
            self.root.after(0, finish)

        threading.Thread(target=worker, daemon=True).start()

    def _read_once(self) -> None:
        self.monitor.log("手動読取中…")

        def done(snap):
            # done は _run_bg によりメインスレッドで呼ばれる
            self.monitor._last_snapshot = snap  # ポーリングに上書きされず残るように
            self._apply_snapshot_to_panel(snap)
            self.monitor.log(f"手動読取: 型式={snap.model_name or '(未取得)'} 機番={snap.machine_no or '(未取得)'} "
                             f"tilt={snap.tilt_values} lamps={snap.lamp_states} active={snap.active_rows}")
        self._run_bg(self.monitor.take_snapshot, done)

    def _open_picker(self) -> None:
        def on_done(results: dict[str, list[float]], full_image=None) -> None:
            n = apply_picker_results(self.monitor.cfg, results)
            self.monitor.log(f"ピッカー: {n} 要素を更新")
            saved = save_anchor_templates(results, full_image, self.config_path.parent)
            if saved:
                self.monitor.log(f"位置補正の目印テンプレを {saved} 個保存")
            save_config(self.config_path, self.monitor.cfg)
            self.monitor.log(f"設定保存: {self.config_path}")

        # 既に検出済みのウィンドウ矩形があれば pywinauto を再実行しない
        # （監視スレッドとの同時 pywinauto 呼び出しでハングするのを防ぐ）。
        cached = self.monitor._locator.rect()
        if cached:
            left, top, right, bottom = cached
            img = self.monitor._sampler.grab((left, top, right - left, bottom - top))
            if img is not None:
                RectPicker(self.root, self.monitor, on_done, prefetched=(cached, img))
                return
            self.monitor.log("[ピッカー] 画面キャプチャ失敗")
            return

        # 未検出時のみウィンドウ探索（重いので別スレッド）
        self.monitor.log("ウィンドウ検出中…")

        def fetch():
            if not self.monitor._locator.refresh():
                return None
            rect = self.monitor._locator.rect()
            if not rect:
                return None
            left, top, right, bottom = rect
            img = self.monitor._sampler.grab((left, top, right - left, bottom - top))
            return (rect, img) if img is not None else None

        def build(prefetched):
            if prefetched is None:
                self.monitor.log("[ピッカー] ウィンドウ未検出（対象アプリは起動してる？）")
                return
            RectPicker(self.root, self.monitor, on_done, prefetched=prefetched)
        self._run_bg(fetch, build)

    def _open_switchbot_dialog(self) -> None:
        tk, ttk = self._tk, self._ttk
        c = self.monitor.cfg
        top = tk.Toplevel(self.root)
        top.title("SwitchBot 設定")
        top.geometry("660x560")
        top.transient(self.root)

        use_ble_var = tk.BooleanVar(value=c.switchbot_use_ble)
        token_var = tk.StringVar(value=c.switchbot_token)
        secret_var = tk.StringVar(value=c.switchbot_secret)
        device_var = tk.StringVar(value=c.switchbot_device_id)
        mac_var = tk.StringVar(value=c.switchbot_ble_mac)
        blepw_var = tk.StringVar(value=c.switchbot_ble_password)
        status_var = tk.StringVar(value="")
        scan_mode = ["cloud"]  # 直近のスキャン種別（cloud / ble）

        frm = ttk.Frame(top, padding=8)
        frm.pack(fill="both", expand=True)
        frm.columnconfigure(1, weight=1)

        ttk.Checkbutton(
            frm, text="Bluetooth直結モード（ハブ不要・PCのBluetoothで直接操作）",
            variable=use_ble_var,
        ).grid(row=0, column=0, columnspan=3, sticky="w", pady=(0, 6))

        rows = [
            ("Token (クラウド用)", token_var, ""),
            ("Secret (クラウド用)", secret_var, "*"),
            ("Device ID (クラウド用)", device_var, ""),
            ("BLE MACアドレス (直結用)", mac_var, ""),
            ("BLEパスワード (通常空欄)", blepw_var, "*"),
        ]
        for i, (lbl, var, show) in enumerate(rows, start=1):
            ttk.Label(frm, text=lbl + ":").grid(row=i, column=0, sticky="w", padx=2, pady=2)
            e = ttk.Entry(frm, textvariable=var, width=52)
            if show:
                e.config(show=show)
            e.grid(row=i, column=1, columnspan=2, sticky="ew", padx=4, pady=2)

        ttk.Label(frm, text="検出デバイス (ダブルクリックで反映):")\
            .grid(row=6, column=0, columnspan=3, sticky="w", pady=(8, 2))
        listbox = tk.Listbox(frm, height=9)
        listbox.grid(row=7, column=0, columnspan=3, sticky="nsew", padx=2)
        frm.rowconfigure(7, weight=1)

        items: list[dict] = []

        def pull():
            c.switchbot_use_ble = bool(use_ble_var.get())
            c.switchbot_token = token_var.get().strip()
            c.switchbot_secret = secret_var.get().strip()
            c.switchbot_device_id = device_var.get().strip()
            c.switchbot_ble_mac = mac_var.get().strip()
            c.switchbot_ble_password = blepw_var.get().strip()

        def do_list():
            pull()
            status_var.set("クラウドからデバイス取得中…")
            top.update_idletasks()
            ok, devs, msg = self.monitor.fetch_switchbot_devices()
            scan_mode[0] = "cloud"
            listbox.delete(0, "end")
            items.clear()
            items.extend(devs)
            for d in devs:
                did = d.get("deviceId") or d.get("deviceID") or ""
                typ = d.get("deviceType") or d.get("remoteType") or "?"
                name = d.get("deviceName") or "(名称なし)"
                listbox.insert("end", f"{typ:>16}  {did}  {name}")
            status_var.set(("[成功] " if ok else "[失敗] ") + msg)

        def do_scan():
            pull()
            status_var.set("Bluetoothスキャン中…（数秒）")
            top.update_idletasks()
            ok, devs, msg = self.monitor.scan_switchbot_ble()
            scan_mode[0] = "ble"
            listbox.delete(0, "end")
            items.clear()
            items.extend(devs)
            for d in devs:
                tag = "★SwitchBot" if d["switchbot"] else "          "
                model = f"({d['model']})" if d["model"] else ""
                listbox.insert("end", f"{tag}{model:>5} {d['mac']}  RSSI={d['rssi']}  {d['name']}")
            status_var.set(("[成功] " if ok else "[失敗] ") + msg)

        def on_pick(_evt=None):
            sel = listbox.curselection()
            if not sel:
                return
            d = items[sel[0]]
            if scan_mode[0] == "ble":
                mac_var.set(d.get("mac", ""))
                use_ble_var.set(True)
            else:
                device_var.set(d.get("deviceId") or d.get("deviceID") or "")

        listbox.bind("<Double-Button-1>", on_pick)

        def do_test():
            pull()
            mode = "BLE直結" if c.switchbot_use_ble else "クラウド"
            status_var.set(f"テスト送信中…（{mode}）")
            top.update_idletasks()
            ok, msg = self.monitor.send_switchbot_press()
            status_var.set(("[送信成功] " if ok else "[送信失敗] ") + msg)
            self.monitor.log(f"SwitchBot テスト({mode}): {'OK' if ok else 'NG'} {msg}")

        def do_inspect():
            pull()
            status_var.set("BLE機器に接続して特性を取得中…")
            top.update_idletasks()
            ok, text = self.monitor.inspect_switchbot_ble()
            status_var.set("[BLE詳細] " + ("取得OK（ログ参照）" if ok else text))
            self.monitor.log("[BLE詳細]\n" + text)

        def do_save():
            pull()
            save_config(self.config_path, self.monitor.cfg)
            status_var.set(f"保存: {self.config_path}")
            tgt = c.switchbot_ble_mac if c.switchbot_use_ble else c.switchbot_device_id
            self.monitor.log(f"SwitchBot 設定保存: mode={'BLE' if c.switchbot_use_ble else 'Cloud'} target={tgt or '(未設定)'}")

        btns = ttk.Frame(frm)
        btns.grid(row=8, column=0, columnspan=3, sticky="ew", pady=6)
        ttk.Button(btns, text="クラウド一覧取得", command=do_list).pack(side="left", padx=2)
        ttk.Button(btns, text="Bluetoothスキャン", command=do_scan).pack(side="left", padx=2)
        ttk.Button(btns, text="テスト送信 (press)", command=do_test).pack(side="left", padx=2)
        ttk.Button(btns, text="BLE詳細", command=do_inspect).pack(side="left", padx=2)
        ttk.Button(btns, text="保存", command=do_save).pack(side="left", padx=2)
        ttk.Button(btns, text="閉じる", command=top.destroy).pack(side="right", padx=2)

        ttk.Label(frm, textvariable=status_var, foreground="#0060a0", wraplength=620)\
            .grid(row=9, column=0, columnspan=3, sticky="w", padx=2, pady=(4, 0))

    def _show_calibration(self) -> None:
        """半透明オーバーレイで OCR/色判定矩形を表示する。"""
        cached = self.monitor._locator.rect()
        if cached:
            self._build_calibration_overlay(cached)
            return
        self.monitor.log("ウィンドウ検出中…")

        def detect():
            self.monitor._locator.refresh()
            return self.monitor._locator.rect()
        self._run_bg(detect, self._build_calibration_overlay)

    def _build_calibration_overlay(self, rect) -> None:
        tk = self._tk
        if not rect:
            self.monitor.log("[キャリブレーション] ウィンドウ未検出（対象アプリは起動してる？）")
            return
        left, top, right, bottom = rect
        # 位置自動補正がONなら、補正を計算してから枠を描く（補正後の位置を可視化）
        self.monitor._update_anchor_correction()
        corr = self.monitor._locator._anchor_corr
        overlay = tk.Toplevel(self.root)
        overlay.overrideredirect(True)
        overlay.attributes("-topmost", True)
        overlay.attributes("-alpha", 0.35)
        overlay.geometry(f"{right-left}x{bottom-top}+{left}+{top}")
        canvas = tk.Canvas(overlay, highlightthickness=0, bg="black")
        canvas.pack(fill="both", expand=True)

        mode = "位置補正ON" if (self.monitor.cfg.use_template_anchor and corr) else \
               ("位置補正ON(目印未検出→固定)" if self.monitor.cfg.use_template_anchor else "固定座標")
        canvas.create_text(8, 8, text=mode, fill="#ffffff", anchor="nw", font=("Arial", 11, "bold"))

        def draw(rel, color, label):
            abs_rect = self.monitor._locator.rel_to_abs(rel)
            if not abs_rect:
                return
            x, y, w, h = abs_rect
            canvas.create_rectangle(x - left, y - top, x - left + w, y - top + h,
                                    outline=color, width=2)
            canvas.create_text(x - left + 2, y - top - 10, text=label, fill=color, anchor="w")

        c = self.monitor.cfg
        draw(c.button_capture_rect, "#ff4040", "取込開始")
        draw(c.button_autocorrect_rect, "#ff80ff", "自動補正")
        draw(c.comment_rect, "#ffa040", "コメント")
        draw(c.model_rect, "#ffffff", "型式")
        draw(c.machine_rect, "#80ffff", "機番")
        for row in c.target_rows:
            draw(c.no_column_rects.get(row, []), "#40c0ff", f"No[{row}]")
            draw(c.lamp_rects.get(row, []), "#40ff40", f"Lamp[{row}]")
            draw(c.tilt_rects.get(row, []), "#ffff40", f"傾[{row}]")
        overlay.after(4000, overlay.destroy)

    def _do_append(self, msg: str) -> None:
        self.log_box.insert("end", msg + "\n")
        self.log_box.see("end")
        if int(self.log_box.index("end-1c").split(".")[0]) > 2000:
            self.log_box.delete("1.0", "500.0")

    def run(self) -> None:
        self.root.mainloop()


# ======================================================================
# エントリポイント
# ======================================================================
def _base_dir() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).parent
    return Path(__file__).resolve().parent


def main(argv: list[str]) -> int:
    cfg_path = _base_dir() / "monitor_config.json"
    cfg = load_config(cfg_path)
    monitor = XR20Monitor(cfg)

    if "--scan" in argv:
        monitor._locator.refresh()
        snap = monitor.take_snapshot()
        print(json.dumps({
            "window_rect": monitor._locator.rect(),
            "button_pressed": snap.button_pressed,
            "button_color": snap.button_color,
            "active_rows": snap.active_rows,
            "lamp_states": snap.lamp_states,
            "tilt_values": snap.tilt_values,
            "raw_no": snap.raw_no,
            "raw_tilt": snap.raw_tilt,
        }, ensure_ascii=False, indent=2, default=str))
        return 0

    if "--cli" in argv:
        monitor.start()
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            monitor.stop()
        return 0

    MonitorGUI(monitor, cfg_path).run()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
