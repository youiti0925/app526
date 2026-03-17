#!/usr/bin/env python3
"""
XR20 自動トリガー＆軸精度評価ツール
======================================
Renishaw XR20 回転分割測定器（CARTOソフトウェア）用
回転軸・傾斜軸の割出し精度を評価するためのツール

機能:
  1. 設定管理（機械情報・評価パラメータ・監視パラメータ）
  2. ターゲットリスト自動生成（CW/CCW等分）
  3. NCプログラム自動生成（FANUC Gコード、オーバーラン付き）
  4. CARTO画面監視＋自動F9送信
  5. 測定データ評価（統計＋グラフ）
  6. 成績書出力（印刷用）

動作環境: Windows 10/11, Python 3.10+
必要ライブラリ: tkinter(標準), matplotlib(pip install matplotlib)
オプション: pywinauto, pytesseract, pillow (CARTO監視用)
"""

import tkinter as tk
from tkinter import ttk, messagebox, filedialog, scrolledtext
import json
import os
import math
import threading
import time
import csv
import io
from datetime import datetime
from dataclasses import dataclass, field, asdict
from typing import Optional

# --- matplotlib ---
try:
    import matplotlib

    matplotlib.use("TkAgg")
    from matplotlib.figure import Figure
    from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg

    HAS_MATPLOTLIB = True
except ImportError:
    HAS_MATPLOTLIB = False

# --- Windows API (optional, for CARTO monitoring) ---
HAS_WIN32 = False
try:
    import ctypes
    import ctypes.wintypes

    if os.name == "nt":
        user32 = ctypes.windll.user32
        HAS_WIN32 = True
except Exception:
    pass

# --- pywinauto (optional) ---
HAS_PYWINAUTO = False
try:
    from pywinauto import Application

    HAS_PYWINAUTO = True
except ImportError:
    pass

# ============================================================
# データクラス
# ============================================================

CONFIG_FILE = "xr20_config.json"


@dataclass
class XR20Config:
    # 機械情報
    machine_model: str = ""
    machine_serial: str = ""
    nc_model: str = "FANUC"
    # 評価パラメータ
    axis_type: str = "rotation"  # "rotation" (回転軸 360°) or "tilt" (傾斜軸 任意範囲)
    divisions: int = 36
    start_angle: float = 0.0
    end_angle: float = 360.0
    overrun_angle: float = 10.0
    # 監視パラメータ
    monitor_interval_ms: int = 150
    stability_count: int = 10
    stability_threshold: float = 0.001
    post_f9_wait_ms: int = 1000
    stability_min_time_ms: int = 1000
    # CARTO
    carto_window_title: str = "CARTO"
    # NC
    dwell_time_ms: int = 5000

    def save(self):
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(asdict(self), f, ensure_ascii=False, indent=2)

    @classmethod
    def load(cls):
        if os.path.exists(CONFIG_FILE):
            try:
                with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                    data = json.load(f)
                return cls(**{k: v for k, v in data.items() if k in cls.__dataclass_fields__})
            except Exception:
                pass
        return cls()


@dataclass
class TargetPoint:
    no: int
    angle: float
    direction: str = "cw"  # "cw" or "ccw"
    status: str = "pending"  # "pending" or "measured"


@dataclass
class MeasurementRow:
    no: int
    target_angle: float
    measured_angle: float
    error_arcsec: float
    direction: str = "cw"  # "cw" or "ccw"


@dataclass
class EvalStats:
    count: int = 0
    max_error: float = 0.0
    min_error: float = 0.0
    mean_error: float = 0.0
    sigma: float = 0.0
    index_accuracy: float = 0.0


# ============================================================
# 計算ロジック
# ============================================================


def generate_targets(cfg: XR20Config) -> list[TargetPoint]:
    targets = []
    no = 1

    if cfg.axis_type == "rotation":
        # 回転軸: 0° → step → ... → (360-step)°
        step = 360.0 / cfg.divisions
        # CW
        for i in range(cfg.divisions):
            targets.append(TargetPoint(no=no, angle=round(step * i, 4), direction="cw"))
            no += 1
        # CCW (逆順)
        for i in range(cfg.divisions - 1, -1, -1):
            targets.append(TargetPoint(no=no, angle=round(step * i, 4), direction="ccw"))
            no += 1
    else:
        # 傾斜軸: start_angle → end_angle を等分
        total_range = cfg.end_angle - cfg.start_angle
        step = total_range / cfg.divisions
        # CW (start → end)
        for i in range(cfg.divisions + 1):
            targets.append(TargetPoint(no=no, angle=round(cfg.start_angle + step * i, 4), direction="cw"))
            no += 1
        # CCW (end → start)
        for i in range(cfg.divisions, -1, -1):
            targets.append(TargetPoint(no=no, angle=round(cfg.start_angle + step * i, 4), direction="ccw"))
            no += 1

    return targets


def generate_nc_program(targets: list[TargetPoint], cfg: XR20Config) -> str:
    axis_label = "ROTATION" if cfg.axis_type == "rotation" else "TILT"
    lines = [f"O1000 (XR20 {axis_label} AXIS EVALUATION)", ""]
    p_val = cfg.dwell_time_ms
    ovr = cfg.overrun_angle

    cw_targets = [t for t in targets if t.direction == "cw"]
    ccw_targets = [t for t in targets if t.direction == "ccw"]

    # --- CW ---
    if cw_targets:
        lines.append(f"(CW {cfg.divisions}-DIVISION)")
        lines.append("(OVERRUN: BACKLASH ELIMINATION FOR CW)")
        lines.append("G91")
        lines.append(f"G00 A-{_fmt_angle(ovr)}")
        lines.append(f"G00 A{_fmt_angle(ovr)}")
        lines.append("G90")
        lines.append("")
        for t in cw_targets:
            lines.append(f"G00 A{_fmt_angle(t.angle)}")
            lines.append(f"G04 P{p_val}")
        lines.append("")

    # --- CCW ---
    if ccw_targets:
        lines.append(f"(CCW {cfg.divisions}-DIVISION)")
        lines.append("(OVERRUN: BACKLASH ELIMINATION FOR CCW)")
        lines.append("G91")
        lines.append(f"G00 A{_fmt_angle(ovr)}")
        lines.append(f"G00 A-{_fmt_angle(ovr)}")
        lines.append("G90")
        lines.append("")
        for t in ccw_targets:
            lines.append(f"G00 A{_fmt_angle(t.angle)}")
            lines.append(f"G04 P{p_val}")
        lines.append("")

    lines.append("M30")
    return "\n".join(lines)


def calc_stats(rows: list[MeasurementRow]) -> EvalStats:
    if not rows:
        return EvalStats()
    errors = [r.error_arcsec for r in rows]
    n = len(errors)
    mean = sum(errors) / n
    variance = sum((e - mean) ** 2 for e in errors) / n
    return EvalStats(
        count=n,
        max_error=max(errors),
        min_error=min(errors),
        mean_error=mean,
        sigma=math.sqrt(variance),
        index_accuracy=max(errors) - min(errors),
    )


def parse_csv_data(text: str, targets: list[TargetPoint]) -> list[MeasurementRow]:
    rows = []
    for i, line in enumerate(text.strip().splitlines()):
        line = line.strip()
        if not line or line.startswith("#") or line.startswith("//"):
            continue
        parts = [s.strip() for s in line.replace("\t", ",").split(",")]
        if len(parts) >= 3:
            try:
                ta = float(parts[0])
                ma = float(parts[1])
                ea = float(parts[2])
                idx = len(rows)
                direction = targets[idx].direction if idx < len(targets) else "cw"
                rows.append(MeasurementRow(no=len(rows) + 1, target_angle=ta, measured_angle=ma, error_arcsec=ea, direction=direction))
            except ValueError:
                continue
    return rows


def _fmt_angle(angle: float) -> str:
    r = round(angle, 4)
    if r == int(r):
        return f"{int(r)}."
    return str(r)


# ============================================================
# CARTO監視
# ============================================================

# Windows API定数
WM_KEYDOWN = 0x0100
WM_KEYUP = 0x0101
VK_F9 = 0x78


def find_window_by_title(title_part: str) -> int:
    """ウィンドウタイトルの部分一致検索"""
    if not HAS_WIN32:
        return 0
    results = []
    WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.wintypes.BOOL, ctypes.wintypes.HWND, ctypes.wintypes.LPARAM)

    def callback(hwnd, _):
        length = user32.GetWindowTextLengthW(hwnd)
        if length > 0:
            buf = ctypes.create_unicode_buffer(length + 1)
            user32.GetWindowTextW(hwnd, buf, length + 1)
            if title_part.lower() in buf.value.lower():
                results.append(hwnd)
        return True

    user32.EnumWindows(WNDENUMPROC(callback), 0)
    return results[0] if results else 0


def send_f9_key(hwnd: int) -> bool:
    """PostMessageでF9キーを送信"""
    if not HAS_WIN32 or not hwnd:
        return False
    try:
        user32.PostMessageW(hwnd, WM_KEYDOWN, VK_F9, 0)
        time.sleep(0.05)
        user32.PostMessageW(hwnd, WM_KEYUP, VK_F9, 0)
        return True
    except Exception:
        return False


class CartoMonitor:
    """CARTO画面監視＆自動F9送信"""

    def __init__(self, cfg: XR20Config, on_log=None, on_capture=None, on_status=None):
        self.cfg = cfg
        self.on_log = on_log or (lambda msg: None)
        self.on_capture = on_capture or (lambda n: None)
        self.on_status = on_status or (lambda s: None)
        self._running = False
        self._paused = False
        self._thread: Optional[threading.Thread] = None
        self._capture_count = 0
        self._values: list[tuple[float, float]] = []
        self._movement_detected = False
        self._stable_since: Optional[float] = None

    def start(self):
        if self._running:
            return
        self._running = True
        self._paused = False
        self._capture_count = 0
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def pause(self):
        self._paused = not self._paused
        state = "一時停止" if self._paused else "再開"
        self.on_log(f"監視{state}")
        self.on_status("paused" if self._paused else "running")

    def stop(self):
        self._running = False
        self.on_status("idle")

    def _run(self):
        self.on_status("running")
        self.on_log("CARTO監視を開始します...")

        hwnd = find_window_by_title(self.cfg.carto_window_title)
        if not hwnd:
            self.on_log(f"エラー: CARTOウィンドウが見つかりません (タイトル: '{self.cfg.carto_window_title}')")
            self.on_status("idle")
            self._running = False
            return

        self.on_log(f"CARTOウィンドウ検出: hwnd=0x{hwnd:08X}")

        # 値読み取り方法の初期化
        reader = self._init_reader()
        if not reader:
            self.on_log("エラー: 値読み取り方法が利用できません")
            self.on_status("idle")
            self._running = False
            return

        interval = self.cfg.monitor_interval_ms / 1000.0
        self._values = []
        self._movement_detected = False
        self._stable_since = None

        while self._running:
            if self._paused:
                time.sleep(0.1)
                continue

            value = reader()
            if value is None:
                time.sleep(interval)
                continue

            state = self._update_stability(value)

            if state == "moving":
                self.on_log(f"  移動中... {value:.4f}°")
            elif state == "stable":
                self._capture_count += 1
                self.on_log(f"  安定検出 {value:.4f}° → F9送信 (#{self._capture_count})")

                if send_f9_key(hwnd):
                    self.on_log(f"  キャプチャ #{self._capture_count} 完了")
                    self.on_capture(self._capture_count)
                else:
                    self.on_log("  F9送信失敗 - リトライ...")
                    time.sleep(0.5)
                    if send_f9_key(hwnd):
                        self.on_log(f"  キャプチャ #{self._capture_count} 完了(リトライ)")
                        self.on_capture(self._capture_count)
                    else:
                        self.on_log("  F9送信失敗")

                self._values = []
                self._movement_detected = False
                self._stable_since = None
                time.sleep(self.cfg.post_f9_wait_ms / 1000.0)

            time.sleep(interval)

        self.on_log(f"監視停止 (合計キャプチャ: {self._capture_count})")
        self.on_status("idle")

    def _init_reader(self):
        # UI Automation (pywinauto)
        if HAS_PYWINAUTO:
            try:
                app = Application(backend="uia").connect(title_re=f".*{self.cfg.carto_window_title}.*", timeout=5)
                dlg = app.window(title_re=f".*{self.cfg.carto_window_title}.*")
                self.on_log("UI Automation方式で接続")

                def read_uia():
                    try:
                        for ctrl in dlg.descendants():
                            try:
                                text = ctrl.window_text()
                                if text and self._is_angle_text(text):
                                    return float(text.replace("°", "").strip())
                            except Exception:
                                continue
                    except Exception:
                        pass
                    return None

                return read_uia
            except Exception as e:
                self.on_log(f"UI Automation利用不可: {e}")

        self.on_log("注意: pywinautoが未インストールのため、CARTO値の自動読み取りができません")
        self.on_log("pip install pywinauto でインストールしてください")
        return None

    @staticmethod
    def _is_angle_text(text: str) -> bool:
        t = text.replace("°", "").replace(" ", "").replace("+", "").replace("-", "")
        try:
            v = float(t)
            return -3600 < v < 3600
        except ValueError:
            return False

    def _update_stability(self, value: float) -> str:
        now = time.time()
        self._values.append((now, value))

        if len(self._values) < 2:
            return "idle"

        prev = self._values[-2][1]
        if abs(value - prev) > self.cfg.stability_threshold:
            self._movement_detected = True
            self._stable_since = None
            return "moving"

        if not self._movement_detected:
            return "idle"

        if len(self._values) >= self.cfg.stability_count:
            recent = self._values[-self.cfg.stability_count :]
            vals = [v for _, v in recent]
            if max(vals) - min(vals) <= self.cfg.stability_threshold:
                if self._stable_since is None:
                    self._stable_since = now
                if (now - self._stable_since) * 1000 >= self.cfg.stability_min_time_ms:
                    return "stable"
                return "stabilizing"
            self._stable_since = None
            return "moving"

        return "stabilizing"


# ============================================================
# メインGUI
# ============================================================


class XR20App:
    def __init__(self):
        self.root = tk.Tk()
        self.root.title("XR20 自動トリガー＆軸精度評価ツール")
        self.root.geometry("1100x750")
        self.root.minsize(900, 600)

        self.cfg = XR20Config.load()
        self.targets: list[TargetPoint] = []
        self.measurements: list[MeasurementRow] = []
        self.monitor: Optional[CartoMonitor] = None

        # スタイル
        style = ttk.Style()
        style.configure("Title.TLabel", font=("", 11, "bold"))
        style.configure("Header.TLabel", font=("", 10, "bold"))
        style.configure("Stat.TLabel", font=("Consolas", 12, "bold"))

        self._build_ui()

    def _build_ui(self):
        # メインのNotebook(タブ)
        self.notebook = ttk.Notebook(self.root)
        self.notebook.pack(fill=tk.BOTH, expand=True, padx=8, pady=8)

        self._build_settings_tab()
        self._build_targets_tab()
        self._build_control_tab()
        self._build_data_tab()
        self._build_results_tab()
        self._build_report_tab()

    # -------------------------------------------------------
    # タブ1: 設定
    # -------------------------------------------------------
    def _build_settings_tab(self):
        frame = ttk.Frame(self.notebook, padding=10)
        self.notebook.add(frame, text=" 設定 ")

        canvas = tk.Canvas(frame)
        scrollbar = ttk.Scrollbar(frame, orient="vertical", command=canvas.yview)
        inner = ttk.Frame(canvas, padding=10)

        inner.bind("<Configure>", lambda e: canvas.configure(scrollregion=canvas.bbox("all")))
        canvas.create_window((0, 0), window=inner, anchor="nw")
        canvas.configure(yscrollcommand=scrollbar.set)

        canvas.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")

        self._cfg_vars = {}

        # 機械情報
        sec = self._add_section(inner, "機械情報")
        self._add_entry(sec, "machine_model", "型式", self.cfg.machine_model)
        self._add_entry(sec, "machine_serial", "機番", self.cfg.machine_serial)
        self._add_entry(sec, "nc_model", "NC装置型番", self.cfg.nc_model)

        # 評価パラメータ
        sec = self._add_section(inner, "評価パラメータ")

        # 軸タイプ選択（ラジオボタン）
        axis_row = ttk.Frame(sec)
        axis_row.pack(fill="x", pady=2)
        ttk.Label(axis_row, text="軸タイプ", width=30, anchor="e").pack(side="left", padx=(0, 10))
        self._axis_type_var = tk.StringVar(value=self.cfg.axis_type)
        ttk.Radiobutton(axis_row, text="回転軸 (360°)", variable=self._axis_type_var, value="rotation", command=self._on_axis_type_change).pack(side="left", padx=5)
        ttk.Radiobutton(axis_row, text="傾斜軸 (任意範囲)", variable=self._axis_type_var, value="tilt", command=self._on_axis_type_change).pack(side="left", padx=5)

        self._add_entry(sec, "divisions", "等分数", str(self.cfg.divisions))

        # 傾斜軸用の範囲入力（回転軸では非表示にはしないが、回転軸時は使わない旨表示）
        self._tilt_frame = ttk.Frame(sec)
        self._tilt_frame.pack(fill="x")
        self._add_entry_in(self._tilt_frame, "start_angle", "開始角度 (°)", str(self.cfg.start_angle))
        self._add_entry_in(self._tilt_frame, "end_angle", "終了角度 (°)", str(self.cfg.end_angle))
        self._on_axis_type_change()

        self._add_entry(sec, "overrun_angle", "オーバーラン角度 (°)", str(self.cfg.overrun_angle))

        # 監視パラメータ
        sec = self._add_section(inner, "監視パラメータ")
        self._add_entry(sec, "monitor_interval_ms", "監視間隔 (ms)", str(self.cfg.monitor_interval_ms))
        self._add_entry(sec, "stability_count", "安定判定回数", str(self.cfg.stability_count))
        self._add_entry(sec, "stability_threshold", "安定閾値 (°)", str(self.cfg.stability_threshold))
        self._add_entry(sec, "post_f9_wait_ms", "F9送信後待機 (ms)", str(self.cfg.post_f9_wait_ms))
        self._add_entry(sec, "stability_min_time_ms", "安定最小時間 (ms)", str(self.cfg.stability_min_time_ms))

        # CARTO設定
        sec = self._add_section(inner, "CARTO設定")
        self._add_entry(sec, "carto_window_title", "CARTOウィンドウタイトル（部分一致）", self.cfg.carto_window_title)
        self._add_entry(sec, "dwell_time_ms", "NCドウェル時間 (ms)", str(self.cfg.dwell_time_ms))

        # ボタン
        btn_frame = ttk.Frame(inner)
        btn_frame.pack(fill="x", pady=(15, 5))
        ttk.Button(btn_frame, text="設定を保存", command=self._save_config).pack(side="left", padx=5)
        ttk.Button(btn_frame, text="ターゲットリスト生成 →", command=self._generate_targets).pack(side="left", padx=5)
        ttk.Button(btn_frame, text="NCプログラム生成・保存", command=self._save_nc_program).pack(side="left", padx=5)

    def _add_section(self, parent, title):
        lf = ttk.LabelFrame(parent, text=f"  {title}  ", padding=10)
        lf.pack(fill="x", pady=(10, 0))
        return lf

    def _add_entry(self, parent, key, label, default):
        row = ttk.Frame(parent)
        row.pack(fill="x", pady=2)
        ttk.Label(row, text=label, width=30, anchor="e").pack(side="left", padx=(0, 10))
        var = tk.StringVar(value=default)
        ttk.Entry(row, textvariable=var, width=30).pack(side="left")
        self._cfg_vars[key] = var

    def _add_entry_in(self, parent, key, label, default):
        """指定フレーム内にエントリを追加"""
        row = ttk.Frame(parent)
        row.pack(fill="x", pady=2)
        ttk.Label(row, text=label, width=30, anchor="e").pack(side="left", padx=(0, 10))
        var = tk.StringVar(value=default)
        ttk.Entry(row, textvariable=var, width=30).pack(side="left")
        self._cfg_vars[key] = var

    def _on_axis_type_change(self):
        """軸タイプ変更時に傾斜軸用フィールドの表示切替"""
        if self._axis_type_var.get() == "tilt":
            self._tilt_frame.pack(fill="x")
        else:
            self._tilt_frame.pack_forget()

    def _apply_config(self):
        """GUIの入力値をcfgに反映"""
        v = self._cfg_vars
        self.cfg.machine_model = v["machine_model"].get()
        self.cfg.machine_serial = v["machine_serial"].get()
        self.cfg.nc_model = v["nc_model"].get()
        self.cfg.axis_type = self._axis_type_var.get()
        self.cfg.divisions = int(v["divisions"].get() or 36)
        self.cfg.start_angle = float(v["start_angle"].get() or 0)
        self.cfg.end_angle = float(v["end_angle"].get() or 360)
        self.cfg.overrun_angle = float(v["overrun_angle"].get() or 10.0)
        self.cfg.monitor_interval_ms = int(v["monitor_interval_ms"].get() or 150)
        self.cfg.stability_count = int(v["stability_count"].get() or 10)
        self.cfg.stability_threshold = float(v["stability_threshold"].get() or 0.001)
        self.cfg.post_f9_wait_ms = int(v["post_f9_wait_ms"].get() or 1000)
        self.cfg.stability_min_time_ms = int(v["stability_min_time_ms"].get() or 1000)
        self.cfg.carto_window_title = v["carto_window_title"].get()
        self.cfg.dwell_time_ms = int(v["dwell_time_ms"].get() or 5000)

    def _save_config(self):
        self._apply_config()
        self.cfg.save()
        messagebox.showinfo("保存完了", "設定を保存しました。")

    def _generate_targets(self):
        self._apply_config()
        self.targets = generate_targets(self.cfg)
        self._refresh_targets_tab()
        self.notebook.select(1)  # ターゲットリストタブへ

    def _save_nc_program(self):
        self._apply_config()
        if not self.targets:
            self.targets = generate_targets(self.cfg)
        nc = generate_nc_program(self.targets, self.cfg)
        path = filedialog.asksaveasfilename(
            defaultextension=".nc",
            filetypes=[("NCプログラム", "*.nc"), ("テキスト", "*.txt")],
            initialfile="O1000_XR20_EVAL.nc",
        )
        if path:
            with open(path, "w", encoding="utf-8") as f:
                f.write(nc)
            messagebox.showinfo("保存完了", f"NCプログラムを保存しました:\n{path}")

    # -------------------------------------------------------
    # タブ2: ターゲットリスト
    # -------------------------------------------------------
    def _build_targets_tab(self):
        frame = ttk.Frame(self.notebook, padding=10)
        self.notebook.add(frame, text=" ターゲットリスト ")

        info = ttk.Frame(frame)
        info.pack(fill="x", pady=(0, 5))
        self._targets_info_label = ttk.Label(info, text="ターゲットリストが未生成です。設定タブから生成してください。")
        self._targets_info_label.pack(side="left")

        # Treeview
        cols = ("no", "angle", "direction", "status")
        self._targets_tree = ttk.Treeview(frame, columns=cols, show="headings", height=25)
        self._targets_tree.heading("no", text="No.")
        self._targets_tree.heading("angle", text="ターゲット角度 (°)")
        self._targets_tree.heading("direction", text="方向")
        self._targets_tree.heading("status", text="ステータス")
        self._targets_tree.column("no", width=60, anchor="center")
        self._targets_tree.column("angle", width=220, anchor="center")
        self._targets_tree.column("direction", width=100, anchor="center")
        self._targets_tree.column("status", width=150, anchor="center")

        sb = ttk.Scrollbar(frame, orient="vertical", command=self._targets_tree.yview)
        self._targets_tree.configure(yscrollcommand=sb.set)
        self._targets_tree.pack(side="left", fill="both", expand=True)
        sb.pack(side="right", fill="y")

    def _refresh_targets_tab(self):
        tree = self._targets_tree
        tree.delete(*tree.get_children())
        cw_count = sum(1 for t in self.targets if t.direction == "cw")
        ccw_count = sum(1 for t in self.targets if t.direction == "ccw")
        axis_label = "回転軸" if self.cfg.axis_type == "rotation" else "傾斜軸"
        self._targets_info_label.config(
            text=f"合計 {len(self.targets)} 点  ({axis_label}  CW: {cw_count}, CCW: {ccw_count})"
        )
        for t in self.targets:
            d = "CW" if t.direction == "cw" else "CCW"
            st = "測定済" if t.status == "measured" else "未測定"
            tree.insert("", "end", values=(t.no, f"{t.angle:.4f}", d, st))

    # -------------------------------------------------------
    # タブ3: 測定制御
    # -------------------------------------------------------
    def _build_control_tab(self):
        frame = ttk.Frame(self.notebook, padding=10)
        self.notebook.add(frame, text=" 測定制御 ")

        # ステータス表示
        status_frame = ttk.LabelFrame(frame, text="  ステータス  ", padding=10)
        status_frame.pack(fill="x", pady=(0, 10))

        row = ttk.Frame(status_frame)
        row.pack(fill="x")
        self._ctrl_status_var = tk.StringVar(value="待機中")
        self._ctrl_point_var = tk.StringVar(value="0 / 0")
        self._ctrl_remain_var = tk.StringVar(value="0")
        self._ctrl_angle_var = tk.StringVar(value="-")

        for label_text, var in [
            ("ステータス", self._ctrl_status_var),
            ("測定点", self._ctrl_point_var),
            ("残り", self._ctrl_remain_var),
            ("読み取り値", self._ctrl_angle_var),
        ]:
            col = ttk.Frame(row)
            col.pack(side="left", expand=True, padx=10)
            ttk.Label(col, text=label_text, style="Header.TLabel").pack()
            ttk.Label(col, textvariable=var, style="Stat.TLabel").pack()

        # ボタン
        btn_frame = ttk.Frame(frame)
        btn_frame.pack(fill="x", pady=10)
        self._btn_start = ttk.Button(btn_frame, text="▶ 監視開始", command=self._start_monitor)
        self._btn_start.pack(side="left", padx=5)
        self._btn_pause = ttk.Button(btn_frame, text="⏸ 一時停止", command=self._pause_monitor, state="disabled")
        self._btn_pause.pack(side="left", padx=5)
        self._btn_stop = ttk.Button(btn_frame, text="⏹ 停止", command=self._stop_monitor, state="disabled")
        self._btn_stop.pack(side="left", padx=5)

        if not HAS_WIN32:
            warn = ttk.Label(frame, text="※ Windows環境でないため、CARTO監視機能は利用できません。", foreground="red")
            warn.pack(pady=5)

        # 状態遷移図
        state_frame = ttk.LabelFrame(frame, text="  状態遷移  ", padding=10)
        state_frame.pack(fill="x", pady=(0, 10))
        ttk.Label(state_frame, text="[待機中] → 数値変化検出 → [移動中] → 数値安定検出 → [安定] → F9送信 → [キャプチャ完了] → [待機中]", wraplength=800).pack()

        # ログ
        log_frame = ttk.LabelFrame(frame, text="  動作ログ  ", padding=5)
        log_frame.pack(fill="both", expand=True)
        self._log_text = scrolledtext.ScrolledText(log_frame, height=12, font=("Consolas", 9), state="disabled", bg="#1e1e1e", fg="#4ec9b0")
        self._log_text.pack(fill="both", expand=True)

    def _log(self, msg):
        ts = datetime.now().strftime("%H:%M:%S.%f")[:-3]
        self._log_text.configure(state="normal")
        self._log_text.insert("end", f"[{ts}] {msg}\n")
        self._log_text.see("end")
        self._log_text.configure(state="disabled")

    def _start_monitor(self):
        self._apply_config()
        if not self.targets:
            self.targets = generate_targets(self.cfg)
            self._refresh_targets_tab()

        self._ctrl_point_var.set(f"0 / {len(self.targets)}")
        self._ctrl_remain_var.set(str(len(self.targets)))

        self.monitor = CartoMonitor(
            self.cfg,
            on_log=lambda msg: self.root.after(0, self._log, msg),
            on_capture=lambda n: self.root.after(0, self._on_capture, n),
            on_status=lambda s: self.root.after(0, self._on_monitor_status, s),
        )
        self.monitor.start()
        self._btn_start.config(state="disabled")
        self._btn_pause.config(state="normal")
        self._btn_stop.config(state="normal")

    def _pause_monitor(self):
        if self.monitor:
            self.monitor.pause()

    def _stop_monitor(self):
        if self.monitor:
            self.monitor.stop()
        self._btn_start.config(state="normal")
        self._btn_pause.config(state="disabled")
        self._btn_stop.config(state="disabled")

    def _on_capture(self, n):
        total = len(self.targets)
        self._ctrl_point_var.set(f"{n} / {total}")
        self._ctrl_remain_var.set(str(max(0, total - n)))
        if n <= len(self.targets):
            self.targets[n - 1].status = "measured"
            self._refresh_targets_tab()

    def _on_monitor_status(self, status):
        labels = {"idle": "待機中", "running": "監視中", "paused": "一時停止"}
        self._ctrl_status_var.set(labels.get(status, status))
        if status == "idle":
            self._btn_start.config(state="normal")
            self._btn_pause.config(state="disabled")
            self._btn_stop.config(state="disabled")

    # -------------------------------------------------------
    # タブ4: 測定データ
    # -------------------------------------------------------
    def _build_data_tab(self):
        frame = ttk.Frame(self.notebook, padding=10)
        self.notebook.add(frame, text=" 測定データ ")

        ttk.Label(frame, text="CARTOからエクスポートしたCSVデータを貼り付けてください", style="Header.TLabel").pack(anchor="w")
        ttk.Label(frame, text="形式: ターゲット角度, 測定角度, 誤差(arc sec)  （カンマまたはタブ区切り）").pack(anchor="w", pady=(0, 5))

        self._data_text = scrolledtext.ScrolledText(frame, height=15, font=("Consolas", 10))
        self._data_text.pack(fill="both", expand=True, pady=(0, 5))

        btn_frame = ttk.Frame(frame)
        btn_frame.pack(fill="x")
        ttk.Button(btn_frame, text="CSVファイル読込", command=self._load_csv_file).pack(side="left", padx=5)
        ttk.Button(btn_frame, text="データ解析 → 評価結果へ", command=self._parse_and_evaluate).pack(side="left", padx=5)

        self._data_info_label = ttk.Label(frame, text="")
        self._data_info_label.pack(anchor="w", pady=5)

    def _load_csv_file(self):
        path = filedialog.askopenfilename(filetypes=[("CSV", "*.csv"), ("テキスト", "*.txt"), ("すべて", "*.*")])
        if path:
            with open(path, "r", encoding="utf-8") as f:
                self._data_text.delete("1.0", "end")
                self._data_text.insert("1.0", f.read())

    def _parse_and_evaluate(self):
        self._apply_config()
        if not self.targets:
            self.targets = generate_targets(self.cfg)
            self._refresh_targets_tab()

        text = self._data_text.get("1.0", "end")
        self.measurements = parse_csv_data(text, self.targets)

        if not self.measurements:
            messagebox.showwarning("データなし", "有効なデータが見つかりませんでした。形式を確認してください。")
            return

        cw_count = sum(1 for m in self.measurements if m.direction == "cw")
        ccw_count = sum(1 for m in self.measurements if m.direction == "ccw")
        self._data_info_label.config(
            text=f"解析完了: {len(self.measurements)} 点 (CW: {cw_count}, CCW: {ccw_count})"
        )

        self._refresh_results_tab()
        self._refresh_report_tab()
        self.notebook.select(4)  # 評価結果タブへ

    # -------------------------------------------------------
    # タブ5: 評価結果
    # -------------------------------------------------------
    def _build_results_tab(self):
        frame = ttk.Frame(self.notebook, padding=10)
        self.notebook.add(frame, text=" 評価結果 ")
        self._results_frame = frame
        ttk.Label(frame, text="データを入力して評価を実行してください。").pack(pady=30)

    def _refresh_results_tab(self):
        # 既存ウィジェットを削除
        for w in self._results_frame.winfo_children():
            w.destroy()

        cw_data = [m for m in self.measurements if m.direction == "cw"]
        ccw_data = [m for m in self.measurements if m.direction == "ccw"]

        self._cw_stats = calc_stats(cw_data)
        self._ccw_stats = calc_stats(ccw_data)

        if not HAS_MATPLOTLIB:
            ttk.Label(self._results_frame, text="※ matplotlib未インストール: pip install matplotlib でグラフ表示可能", foreground="orange").pack(pady=5)

        canvas = tk.Canvas(self._results_frame)
        scrollbar = ttk.Scrollbar(self._results_frame, orient="vertical", command=canvas.yview)
        inner = ttk.Frame(canvas, padding=5)
        inner.bind("<Configure>", lambda e: canvas.configure(scrollregion=canvas.bbox("all")))
        canvas.create_window((0, 0), window=inner, anchor="nw")
        canvas.configure(yscrollcommand=scrollbar.set)
        canvas.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")

        if cw_data:
            self._add_eval_section(inner, "CW 評価結果", cw_data, self._cw_stats, chart_type="bar")
        if ccw_data:
            self._add_eval_section(inner, "CCW 評価結果", ccw_data, self._ccw_stats, chart_type="bar")

    def _add_eval_section(self, parent, title, data, stats, chart_type="bar"):
        lf = ttk.LabelFrame(parent, text=f"  {title}  ", padding=10)
        lf.pack(fill="x", pady=5)

        # 統計値
        stat_frame = ttk.Frame(lf)
        stat_frame.pack(fill="x", pady=(0, 10))
        for label_text, val in [
            ("測定点数", f"{stats.count}"),
            ("最大誤差", f"{stats.max_error:.2f}″"),
            ("最小誤差", f"{stats.min_error:.2f}″"),
            ("平均誤差", f"{stats.mean_error:.2f}″"),
            ("σ", f"{stats.sigma:.2f}″"),
            ("割出し精度", f"{stats.index_accuracy:.2f}″"),
        ]:
            col = ttk.Frame(stat_frame, relief="groove", borderwidth=1, padding=5)
            col.pack(side="left", expand=True, fill="x", padx=2)
            ttk.Label(col, text=label_text, anchor="center").pack(fill="x")
            ttk.Label(col, text=val, style="Stat.TLabel", anchor="center").pack(fill="x")

        # グラフ
        if HAS_MATPLOTLIB:
            fig = Figure(figsize=(9, 3), dpi=96)
            ax = fig.add_subplot(111)
            angles = [d.target_angle for d in data]
            errors = [d.error_arcsec for d in data]

            if chart_type == "bar":
                colors = ["#3b82f6" if e >= 0 else "#60a5fa" for e in errors]
                ax.bar(range(len(errors)), errors, color=colors, width=0.7)
                ax.set_xticks(range(0, len(angles), max(1, len(angles) // 12)))
                ax.set_xticklabels([f"{angles[i]:.1f}°" for i in range(0, len(angles), max(1, len(angles) // 12))], fontsize=7)
            else:
                ax.plot(range(len(errors)), errors, "o-", color="#f59e0b", markersize=4, linewidth=1.5)
                ax.set_xticks(range(len(angles)))
                ax.set_xticklabels([f"{a:.2f}°" for a in angles], fontsize=7, rotation=45)

            ax.axhline(y=0, color="#94a3b8", linewidth=0.8)
            ax.set_ylabel("arc sec", fontsize=8)
            ax.set_title(title, fontsize=9)
            ax.grid(True, alpha=0.3)
            fig.tight_layout()

            chart_canvas = FigureCanvasTkAgg(fig, lf)
            chart_canvas.draw()
            chart_canvas.get_tk_widget().pack(fill="x")

        # データテーブル
        cols = ("no", "target", "measured", "error")
        tree = ttk.Treeview(lf, columns=cols, show="headings", height=min(8, len(data)))
        tree.heading("no", text="No.")
        tree.heading("target", text="ターゲット角度 (°)")
        tree.heading("measured", text="測定角度 (°)")
        tree.heading("error", text="誤差 (arc sec)")
        tree.column("no", width=50, anchor="center")
        tree.column("target", width=180, anchor="center")
        tree.column("measured", width=180, anchor="center")
        tree.column("error", width=180, anchor="center")
        for i, d in enumerate(data):
            tree.insert("", "end", values=(i + 1, f"{d.target_angle:.4f}", f"{d.measured_angle:.4f}", f"{d.error_arcsec:.2f}"))
        tree.pack(fill="x", pady=(10, 0))

    # -------------------------------------------------------
    # タブ6: 成績書
    # -------------------------------------------------------
    def _build_report_tab(self):
        frame = ttk.Frame(self.notebook, padding=10)
        self.notebook.add(frame, text=" 成績書 ")
        self._report_frame = frame
        ttk.Label(frame, text="評価実行後に成績書が生成されます。").pack(pady=30)

    def _refresh_report_tab(self):
        for w in self._report_frame.winfo_children():
            w.destroy()

        btn_frame = ttk.Frame(self._report_frame)
        btn_frame.pack(fill="x", pady=(0, 10))
        ttk.Button(btn_frame, text="テキスト保存", command=self._save_report_text).pack(side="left", padx=5)
        if HAS_MATPLOTLIB:
            ttk.Button(btn_frame, text="PDF保存 (グラフ付き)", command=self._save_report_pdf).pack(side="left", padx=5)

        # プレビュー
        text = scrolledtext.ScrolledText(self._report_frame, font=("Consolas", 10), state="normal")
        text.pack(fill="both", expand=True)

        report = self._generate_report_text()
        text.insert("1.0", report)
        text.configure(state="disabled")
        self._report_text_content = report

    def _generate_report_text(self) -> str:
        today = datetime.now().strftime("%Y年%m月%d日")
        cw_data = [m for m in self.measurements if m.direction == "cw"]
        ccw_data = [m for m in self.measurements if m.direction == "ccw"]

        axis_label = "回転軸" if self.cfg.axis_type == "rotation" else "傾斜軸"
        range_info = "0° ～ 360°" if self.cfg.axis_type == "rotation" else f"{self.cfg.start_angle}° ～ {self.cfg.end_angle}°"

        lines = []
        lines.append("=" * 60)
        lines.append("        割出し精度 成績書")
        lines.append(f"        XR20 {axis_label}評価")
        lines.append("=" * 60)
        lines.append("")
        lines.append("【測定条件】")
        lines.append(f"  測定日:           {today}")
        lines.append(f"  型式:             {self.cfg.machine_model or '-'}")
        lines.append(f"  機番:             {self.cfg.machine_serial or '-'}")
        lines.append(f"  NC装置:           {self.cfg.nc_model or '-'}")
        lines.append(f"  軸タイプ:         {axis_label}")
        lines.append(f"  測定範囲:         {range_info}")
        lines.append(f"  等分数:           {self.cfg.divisions}")
        lines.append(f"  オーバーラン角度: {self.cfg.overrun_angle}°")
        lines.append(f"  測定器:           Renishaw XR20 + XL-80")
        lines.append("")

        for label, data in [
            (f"CW 評価結果 ({self.cfg.divisions}等分)", cw_data),
            (f"CCW 評価結果 ({self.cfg.divisions}等分)", ccw_data),
        ]:
            if not data:
                continue
            stats = calc_stats(data)
            lines.append("-" * 60)
            lines.append(f"【{label}】")
            lines.append("-" * 60)
            lines.append(f"  測定点数:   {stats.count}")
            lines.append(f"  最大誤差:   {stats.max_error:+.2f} arc sec")
            lines.append(f"  最小誤差:   {stats.min_error:+.2f} arc sec")
            lines.append(f"  平均誤差:   {stats.mean_error:+.2f} arc sec")
            lines.append(f"  標準偏差σ:  {stats.sigma:.2f} arc sec")
            lines.append(f"  割出し精度: {stats.index_accuracy:.2f} arc sec (Max-Min)")
            lines.append("")
            lines.append(f"  {'No.':>4}  {'ターゲット(°)':>14}  {'測定値(°)':>14}  {'誤差(″)':>10}")
            lines.append("  " + "-" * 48)
            for i, d in enumerate(data):
                lines.append(f"  {i+1:4d}  {d.target_angle:14.4f}  {d.measured_angle:14.4f}  {d.error_arcsec:+10.2f}")
            lines.append("")

        lines.append("=" * 60)
        lines.append("")
        lines.append("  測定者: _____________  確認者: _____________  承認者: _____________")
        lines.append("")
        return "\n".join(lines)

    def _save_report_text(self):
        path = filedialog.asksaveasfilename(
            defaultextension=".txt",
            filetypes=[("テキスト", "*.txt")],
            initialfile=f"XR20_成績書_{datetime.now():%Y%m%d}.txt",
        )
        if path:
            with open(path, "w", encoding="utf-8") as f:
                f.write(self._report_text_content)
            messagebox.showinfo("保存完了", f"成績書を保存しました:\n{path}")

    def _save_report_pdf(self):
        if not HAS_MATPLOTLIB:
            return
        from matplotlib.backends.backend_pdf import PdfPages

        path = filedialog.asksaveasfilename(
            defaultextension=".pdf",
            filetypes=[("PDF", "*.pdf")],
            initialfile=f"XR20_成績書_{datetime.now():%Y%m%d}.pdf",
        )
        if not path:
            return

        cw_data = [m for m in self.measurements if m.direction == "cw"]
        ccw_data = [m for m in self.measurements if m.direction == "ccw"]
        today = datetime.now().strftime("%Y年%m月%d日")

        sections = []
        if cw_data:
            sections.append((f"CW ({self.cfg.divisions}div)", cw_data, "bar"))
        if ccw_data:
            sections.append((f"CCW ({self.cfg.divisions}div)", ccw_data, "bar"))

        with PdfPages(path) as pdf:
            fig = Figure(figsize=(8.27, 11.69), dpi=100)  # A4

            # タイトル
            axis_label = "回転軸" if self.cfg.axis_type == "rotation" else "傾斜軸"
            fig.text(0.5, 0.95, "割出し精度 成績書", ha="center", fontsize=16, fontweight="bold")
            fig.text(0.5, 0.93, f"XR20 {axis_label}評価 (CW/CCW)", ha="center", fontsize=10, color="gray")

            # 測定条件
            y = 0.89
            fig.text(0.08, y, "【測定条件】", fontsize=10, fontweight="bold")
            y -= 0.02
            for label, val in [
                ("測定日", today),
                ("型式", self.cfg.machine_model or "-"),
                ("機番", self.cfg.machine_serial or "-"),
                ("等分数", str(self.cfg.divisions)),
                ("オーバーラン", f"{self.cfg.overrun_angle}°"),
            ]:
                fig.text(0.10, y, f"{label}: {val}", fontsize=8)
                y -= 0.015

            # グラフ配置（最大4セクション）
            n = len(sections)
            if n > 0:
                h = min(0.18, 0.72 / n)
                gap = 0.02
                start_y = 0.78 - (n * (h + gap))
                for i, (title, data, chart_type) in enumerate(sections):
                    stats = calc_stats(data)
                    ax_y = start_y + (n - 1 - i) * (h + gap)
                    ax = fig.add_axes([0.10, ax_y, 0.82, h])
                    errors = [d.error_arcsec for d in data]

                    if chart_type == "bar":
                        colors = ["#3b82f6" if e >= 0 else "#60a5fa" for e in errors]
                        ax.bar(range(len(errors)), errors, color=colors, width=0.7)
                    else:
                        ax.plot(range(len(errors)), errors, "o-", color="#f59e0b", markersize=3, linewidth=1.2)

                    ax.axhline(y=0, color="#94a3b8", linewidth=0.8)
                    ax.set_title(f"{title}  Index: {stats.index_accuracy:.2f}\"", fontsize=8)
                    ax.set_ylabel("arc sec", fontsize=7)
                    ax.grid(True, alpha=0.3)
                    ax.tick_params(labelsize=6)

            pdf.savefig(fig)

        messagebox.showinfo("保存完了", f"PDF成績書を保存しました:\n{path}")

    # -------------------------------------------------------
    # メインループ
    # -------------------------------------------------------
    def run(self):
        self.root.mainloop()


# ============================================================
# エントリポイント
# ============================================================

if __name__ == "__main__":
    app = XR20App()
    app.run()
