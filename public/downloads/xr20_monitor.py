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
DEFAULT_BUTTON_CAPTURE = [0.104, 0.400, 0.069, 0.037]

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
    NG_RETRY = "NG_RETRY"
    ERROR = "ERROR"


@dataclass
class MonitorConfig:
    # SwitchBot
    switchbot_token: str = ""
    switchbot_secret: str = ""
    switchbot_device_id: str = ""

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
    max_retries: int = 3

    # 動作フラグ
    dry_run: bool = True
    auto_retry: bool = True

    # ウィンドウ相対矩形
    button_capture_rect: list[float] = field(default_factory=lambda: list(DEFAULT_BUTTON_CAPTURE))
    no_column_rects: dict[str, list[float]] = field(default_factory=lambda: {k: list(v) for k, v in DEFAULT_NO_RECTS.items()})
    lamp_rects: dict[str, list[float]] = field(default_factory=lambda: {k: list(v) for k, v in DEFAULT_LAMP_RECTS.items()})
    tilt_rects: dict[str, list[float]] = field(default_factory=lambda: {k: list(v) for k, v in DEFAULT_TILT_RECTS.items()})

    # 色基準（RGB）／許容誤差
    lamp_on_color: list[int] = field(default_factory=lambda: [60, 200, 80])
    lamp_off_color: list[int] = field(default_factory=lambda: [40, 90, 40])
    button_idle_color: list[int] = field(default_factory=lambda: [210, 210, 210])
    button_active_color: list[int] = field(default_factory=lambda: [240, 240, 120])
    color_tolerance: int = 60

    # 出力
    csv_log_path: str = "xr20_monitor_history.csv"


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

    def refresh(self) -> bool:
        """ウィンドウを再検出。成功で True。"""
        try:
            from pywinauto import Desktop
        except Exception:
            return False
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
        return False

    def rect(self) -> tuple[int, int, int, int] | None:
        return self._rect

    def rel_to_abs(self, rel: list[float]) -> tuple[int, int, int, int] | None:
        """相対矩形 [xf, yf, wf, hf] を絶対 (left, top, width, height) に変換。"""
        if not self._rect or len(rel) != 4:
            return None
        left, top, right, bottom = self._rect
        w = right - left
        h = bottom - top
        return (
            left + int(rel[0] * w),
            top + int(rel[1] * h),
            max(1, int(rel[2] * w)),
            max(1, int(rel[3] * h)),
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


class ScreenSampler:
    """mss + PIL で画面の矩形を取得し、ピクセル色／OCR を提供する."""

    def __init__(self) -> None:
        self._mss = None
        self._init_error: str | None = None
        try:
            import mss
            self._mss = mss.mss()
        except Exception as exc:
            self._init_error = f"mss 未導入: {exc}"

    def available(self) -> bool:
        return self._mss is not None

    def init_error(self) -> str | None:
        return self._init_error

    def grab(self, abs_rect: tuple[int, int, int, int]) -> Any:
        """絶対 (left, top, width, height) をキャプチャして PIL.Image を返す。失敗時 None。"""
        if not self._mss:
            return None
        left, top, w, h = abs_rect
        try:
            from PIL import Image
            shot = self._mss.grab({"left": left, "top": top, "width": w, "height": h})
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
        """矩形を OCR。whitelist を指定すると数字記号のみに絞る。"""
        img = self.grab(abs_rect)
        if img is None:
            return ""
        try:
            import pytesseract
            # 数値読み取り精度向上: グレースケール→3倍拡大→2値化
            gray = img.convert("L").resize((img.width * 3, img.height * 3))
            config = "--psm 7"
            if whitelist:
                config += f" -c tessedit_char_whitelist={whitelist}"
            return pytesseract.image_to_string(gray, config=config).strip()
        except Exception:
            return ""

    def close(self) -> None:
        if self._mss:
            try:
                self._mss.close()
            except Exception:
                pass


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
    tilt_values: dict[str, float | None] = field(default_factory=dict)
    raw_no: dict[str, str] = field(default_factory=dict)
    raw_tilt: dict[str, str] = field(default_factory=dict)


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
        self._retry_count: int = 0
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._last_snapshot: Snapshot | None = None
        self._state_cb: Callable[[State, Snapshot], None] | None = None

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
    def take_snapshot(self) -> Snapshot:
        snap = Snapshot()
        if not self._locator.refresh():
            self.log("ウィンドウ未検出")
            return snap
        snap.window_ok = True

        # 1) 取込開始ボタンの色
        btn_abs = self._locator.rel_to_abs(self.cfg.button_capture_rect)
        if btn_abs:
            color = self._sampler.average_color(btn_abs)
            snap.button_color = color
            if color is not None:
                snap.button_pressed = self._is_button_pressed(color)

        # 2) No 列の数字有無 → 有効行
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

        # 3) 行ごとの緑ランプ
        for row in self.cfg.target_rows:
            rel = self.cfg.lamp_rects.get(row)
            rect = self._locator.rel_to_abs(rel) if rel else None
            if not rect:
                snap.lamp_states[row] = "UNKNOWN"
                continue
            color = self._sampler.average_color(rect)
            snap.lamp_states[row] = self._classify_lamp(color) if color else "UNKNOWN"

        # 4) 傾列 OCR（有効行のみ）
        for row in snap.active_rows:
            rel = self.cfg.tilt_rects.get(row)
            rect = self._locator.rel_to_abs(rel) if rel else None
            if not rect:
                snap.tilt_values[row] = None
                continue
            text = self._sampler.ocr_text(rect, whitelist="0123456789.-+,")
            snap.raw_tilt[row] = text
            snap.tilt_values[row] = _safe_float(text)

        return snap

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
        self._retry_count = 0
        self._thread = threading.Thread(target=self._run_loop, daemon=True)
        self._thread.start()
        self.log("監視開始")

    def stop(self) -> None:
        self._stop.set()
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
        while not self._stop.is_set():
            snap = self.take_snapshot()
            self._emit(snap)

            if not snap.window_ok:
                self._wait(self.cfg.idle_poll_interval_sec)
                continue

            all_done = bool(snap.active_rows) and all(
                snap.lamp_states.get(r) == "ON" for r in snap.active_rows
            )

            if self._state == State.IDLE:
                if snap.button_pressed and not prev_pressed:
                    self.log(f"取込開始検知 / 有効行={snap.active_rows}")
                    self._state = State.CAPTURING

            elif self._state == State.CAPTURING:
                if not snap.button_pressed and all_done and not prev_all_done:
                    self.log("取込完了検知 → 判定待機")
                    self._wait(self.cfg.judge_delay_sec)  # 表示が安定するまで少し待つ
                    self._state = State.JUDGING
                elif snap.active_rows:
                    progress = [f"{r}:{snap.lamp_states.get(r, '?')}" for r in snap.active_rows]
                    self.log("測定中 " + " ".join(progress))

            elif self._state == State.JUDGING:
                snap = self.take_snapshot()
                self._emit(snap)
                ng_rows = [r for r in snap.active_rows if self.is_ng(r, snap.tilt_values.get(r))]
                self._append_csv(snap, ng_rows)
                if ng_rows:
                    self.log(f"NG 行: {ng_rows} / 値={snap.tilt_values}")
                    self._state = State.NG_RETRY
                else:
                    self.log(f"OK / 値={snap.tilt_values}")
                    self._retry_count = 0
                    self._state = State.IDLE

            elif self._state == State.NG_RETRY:
                if not self.cfg.auto_retry or self._retry_count >= self.cfg.max_retries:
                    self.log(f"リトライ上限({self._retry_count})到達 → 停止")
                    self._state = State.ERROR
                else:
                    self._retry_count += 1
                    self.log(f"リトライ {self._retry_count}/{self.cfg.max_retries}")
                    self._do_retry()
                    self._state = State.IDLE

            prev_pressed = snap.button_pressed
            prev_all_done = all_done

            interval = self.cfg.idle_poll_interval_sec if self._state == State.IDLE else self.cfg.poll_interval_sec
            self._wait(interval)

    def _wait(self, seconds: float) -> None:
        self._stop.wait(max(0.1, seconds))

    def _do_retry(self) -> None:
        """SwitchBot でリモコン押下し、取込開始ボタンを再押下。"""
        if self.cfg.dry_run:
            self.log("[リハーサル] SwitchBot送信スキップ / 取込開始クリック実行")
        else:
            ok = self._send_switchbot()
            self.log(f"SwitchBot 送信: {'成功' if ok else '失敗'}")
            self._wait(1.0)
        clicked = self._locator.click_button(self.cfg.capture_button_text)
        self.log(f"取込開始クリック: {'成功' if clicked else '失敗'}")

    def _send_switchbot(self) -> bool:
        if not (self.cfg.switchbot_token and self.cfg.switchbot_secret and self.cfg.switchbot_device_id):
            self.log("SwitchBot 認証情報が未設定です")
            return False
        try:
            import base64
            import hashlib
            import hmac
            import time as _t
            import urllib.request
            import uuid
            token = self.cfg.switchbot_token
            secret = self.cfg.switchbot_secret
            device_id = self.cfg.switchbot_device_id
            nonce = str(uuid.uuid4())
            t = str(int(round(_t.time() * 1000)))
            string_to_sign = f"{token}{t}{nonce}".encode()
            sign = base64.b64encode(
                hmac.new(secret.encode(), string_to_sign, hashlib.sha256).digest()
            ).decode()
            url = f"https://api.switch-bot.com/v1.1/devices/{device_id}/commands"
            body = json.dumps({"command": "press", "parameter": "default", "commandType": "command"}).encode()
            req = urllib.request.Request(
                url, data=body, method="POST",
                headers={
                    "Authorization": token, "sign": sign, "t": t, "nonce": nonce,
                    "Content-Type": "application/json",
                },
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                return resp.status == 200
        except Exception as exc:
            self.log(f"SwitchBot 例外: {exc}")
            return False

    # ------------------------------------------------------------------
    # CSV 履歴
    # ------------------------------------------------------------------
    def _csv_path(self) -> Path:
        raw = self.cfg.csv_log_path or "xr20_monitor_history.csv"
        p = Path(raw)
        if not p.is_absolute():
            base = Path(sys.executable).parent if getattr(sys, "frozen", False) else Path(__file__).resolve().parent
            p = base / p
        return p

    def _append_csv(self, snap: Snapshot, ng_rows: list[str]) -> None:
        path = self._csv_path()
        rows = list(self.cfg.target_rows)
        header = ["timestamp", "active_rows", "ng_rows",
                  *[f"{r}_tilt" for r in rows], *[f"{r}_lamp" for r in rows]]
        write_header = not path.exists()
        try:
            with path.open("a", newline="", encoding="utf-8") as f:
                w = csv.writer(f)
                if write_header:
                    w.writerow(header)
                w.writerow([
                    datetime.now().isoformat(timespec="seconds"),
                    "|".join(snap.active_rows),
                    "|".join(ng_rows),
                    *[snap.tilt_values.get(r, "") for r in rows],
                    *[snap.lamp_states.get(r, "") for r in rows],
                ])
        except OSError as exc:
            self.log(f"CSV 書込失敗: {exc}")


# ======================================================================
# GUI
# ======================================================================
class MonitorGUI:
    def __init__(self, monitor: XR20Monitor, config_path: Path) -> None:
        import tkinter as tk
        from tkinter import ttk
        self._tk = tk
        self._ttk = ttk
        self.monitor = monitor
        self.config_path = config_path

        self.root = tk.Tk()
        self.root.title("IK220 自動監視モニター")
        self.root.geometry("720x620")

        c = monitor.cfg
        self.hr_var = tk.DoubleVar(value=c.threshold_hr)
        self.wr_var = tk.DoubleVar(value=c.threshold_wr)
        self.poll_var = tk.DoubleVar(value=c.poll_interval_sec)
        self.idle_poll_var = tk.DoubleVar(value=c.idle_poll_interval_sec)
        self.retries_var = tk.IntVar(value=c.max_retries)
        self.dry_var = tk.BooleanVar(value=c.dry_run)
        self.auto_retry_var = tk.BooleanVar(value=c.auto_retry)
        self.state_var = tk.StringVar(value="IDLE")
        self.values_var = tk.StringVar(value="(未取得)")
        self.lamps_var = tk.StringVar(value="(未取得)")
        self.active_var = tk.StringVar(value="(未取得)")
        self.button_var = tk.StringVar(value="(未取得)")

        self._build()
        monitor._log_cb = self._append_log
        monitor.set_state_callback(self._on_state)

    def _build(self) -> None:
        tk, ttk = self._tk, self._ttk
        frm = ttk.Frame(self.root, padding=8)
        frm.pack(fill="both", expand=True)

        # 閾値スライダー
        self._slider(frm, 0, "HR/HL 閾値 (秒)", self.hr_var, 0.5, 20)
        self._slider(frm, 1, "WR/WL 閾値 (秒)", self.wr_var, 0.5, 30)
        self._slider(frm, 2, "監視中ポーリング(秒)", self.poll_var, 0.5, 30)
        self._slider(frm, 3, "待機中ポーリング(秒)", self.idle_poll_var, 1, 60)
        self._slider(frm, 4, "最大リトライ回数", self.retries_var, 0, 10, is_int=True)

        flags = ttk.Frame(frm)
        flags.grid(row=5, column=0, columnspan=3, sticky="w", pady=4)
        ttk.Checkbutton(flags, text="リハーサル (SwitchBot送信なし)", variable=self.dry_var,
                        command=self._apply).pack(side="left", padx=4)
        ttk.Checkbutton(flags, text="NG自動リトライ", variable=self.auto_retry_var,
                        command=self._apply).pack(side="left", padx=4)

        # 状態表示
        status = ttk.LabelFrame(frm, text="現在状態", padding=6)
        status.grid(row=6, column=0, columnspan=3, sticky="ew", pady=6)
        for i, (lbl, var) in enumerate([
            ("状態", self.state_var), ("ボタン", self.button_var),
            ("有効行", self.active_var), ("ランプ", self.lamps_var),
            ("傾値", self.values_var),
        ]):
            ttk.Label(status, text=lbl + ":").grid(row=i, column=0, sticky="w", padx=2)
            ttk.Label(status, textvariable=var, foreground="#0060a0").grid(row=i, column=1, sticky="w", padx=4)

        btns = ttk.Frame(frm)
        btns.grid(row=7, column=0, columnspan=3, sticky="ew", pady=4)
        ttk.Button(btns, text="監視ON", command=self._start).pack(side="left", padx=2)
        ttk.Button(btns, text="監視OFF", command=self.monitor.stop).pack(side="left", padx=2)
        ttk.Button(btns, text="キャリブレーション表示", command=self._show_calibration).pack(side="left", padx=2)
        ttk.Button(btns, text="設定保存", command=self._save).pack(side="left", padx=2)
        ttk.Button(btns, text="1回だけ読み取り", command=self._read_once).pack(side="left", padx=2)

        self.log_box = tk.Text(frm, height=15, wrap="none")
        self.log_box.grid(row=8, column=0, columnspan=3, sticky="nsew", pady=4)
        frm.columnconfigure(1, weight=1)
        frm.rowconfigure(8, weight=1)

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
        c.max_retries = int(self.retries_var.get())
        c.dry_run = bool(self.dry_var.get())
        c.auto_retry = bool(self.auto_retry_var.get())

    def _start(self) -> None:
        self._apply()
        self.monitor.start()

    def _save(self) -> None:
        self._apply()
        save_config(self.config_path, self.monitor.cfg)
        self.monitor.log(f"設定保存: {self.config_path}")

    def _read_once(self) -> None:
        snap = self.monitor.take_snapshot()
        self._on_state(self.monitor._state, snap)
        self.monitor.log(f"手動読取: tilt={snap.tilt_values} lamps={snap.lamp_states} active={snap.active_rows}")

    def _on_state(self, state: State, snap: Snapshot) -> None:
        def update():
            self.state_var.set(state.value)
            self.button_var.set(
                f"{'PRESSED' if snap.button_pressed else 'IDLE'} RGB={snap.button_color}"
            )
            self.active_var.set(", ".join(snap.active_rows) if snap.active_rows else "(なし)")
            self.lamps_var.set(", ".join(f"{k}={v}" for k, v in snap.lamp_states.items()))
            self.values_var.set(
                ", ".join(f"{k}={v}" for k, v in snap.tilt_values.items()) or "(未取得)"
            )
        self.root.after(0, update)

    def _show_calibration(self) -> None:
        """半透明オーバーレイで OCR/色判定矩形を表示する。"""
        tk = self._tk
        self.monitor._locator.refresh()
        rect = self.monitor._locator.rect()
        if not rect:
            self.monitor.log("[キャリブレーション] ウィンドウ未検出")
            return
        left, top, right, bottom = rect
        overlay = tk.Toplevel(self.root)
        overlay.overrideredirect(True)
        overlay.attributes("-topmost", True)
        overlay.attributes("-alpha", 0.35)
        overlay.geometry(f"{right-left}x{bottom-top}+{left}+{top}")
        canvas = tk.Canvas(overlay, highlightthickness=0, bg="black")
        canvas.pack(fill="both", expand=True)

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
        for row in c.target_rows:
            draw(c.no_column_rects.get(row, []), "#40c0ff", f"No[{row}]")
            draw(c.lamp_rects.get(row, []), "#40ff40", f"Lamp[{row}]")
            draw(c.tilt_rects.get(row, []), "#ffff40", f"傾[{row}]")
        overlay.after(3500, overlay.destroy)

    def _append_log(self, msg: str) -> None:
        self.root.after(0, lambda: self._do_append(msg))

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
