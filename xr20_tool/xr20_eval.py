#!/usr/bin/env python3
"""
XR20 自動トリガー＆ウォームホイール評価ツール
==============================================
Renishaw XR20 回転分割測定器（CARTOソフトウェア）用
ウォームホイール駆動の回転軸を評価するためのツール

機能:
  1. 設定管理（ギヤパラメータ・監視パラメータ）
  2. ターゲットリスト自動生成（ホイール＋ウォーム等分）
  3. NCプログラム自動生成（FANUC Gコード）
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
    machine_name: str = ""
    nc_model: str = "FANUC"
    # ギヤパラメータ
    wheel_teeth: int = 60
    worm_leads: int = 1
    # 評価パラメータ
    wheel_divisions: int = 36
    worm_divisions: int = 10
    worm_start_position: float = 0.0
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
    category: str  # "wheel" or "worm"
    status: str = "pending"  # "pending" or "measured"


@dataclass
class MeasurementRow:
    no: int
    target_angle: float
    measured_angle: float
    error_arcsec: float
    category: str  # "wheel" or "worm"


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
    # ホイール等分
    wheel_step = 360.0 / cfg.wheel_divisions
    for i in range(cfg.wheel_divisions):
        targets.append(TargetPoint(no=no, angle=round(wheel_step * i, 4), category="wheel"))
        no += 1
    # ウォーム等分
    worm_rotation_angle = (360.0 / cfg.wheel_teeth) * cfg.worm_leads
    worm_step = worm_rotation_angle / cfg.worm_divisions
    for i in range(cfg.worm_divisions):
        angle = round(cfg.worm_start_position + worm_step * i, 4)
        targets.append(TargetPoint(no=no, angle=angle, category="worm"))
        no += 1
    return targets


def generate_nc_program(targets: list[TargetPoint], cfg: XR20Config) -> str:
    lines = ["O1000 (XR20 WORM-WHEEL EVALUATION)", ""]
    p_val = cfg.dwell_time_ms
    wheel = [t for t in targets if t.category == "wheel"]
    worm = [t for t in targets if t.category == "worm"]

    if wheel:
        lines.append(f"(WHEEL {cfg.wheel_divisions}-DIVISION)")
        lines.append("G90")
        for t in wheel:
            lines.append(f"G00 A{_fmt_angle(t.angle)}")
            lines.append(f"G04 P{p_val}")
        lines.append("")

    if worm:
        lines.append(f"(WORM {cfg.worm_divisions}-DIVISION)")
        for t in worm:
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


def parse_csv_data(text: str, wheel_count: int) -> list[MeasurementRow]:
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
                cat = "wheel" if len(rows) < wheel_count else "worm"
                rows.append(MeasurementRow(no=len(rows) + 1, target_angle=ta, measured_angle=ma, error_arcsec=ea, category=cat))
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
        self.root.title("XR20 自動トリガー＆ウォームホイール評価ツール")
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
        self._add_entry(sec, "machine_name", "機械名", self.cfg.machine_name)
        self._add_entry(sec, "nc_model", "NC装置型番", self.cfg.nc_model)

        # ギヤパラメータ
        sec = self._add_section(inner, "ギヤパラメータ")
        self._add_entry(sec, "wheel_teeth", "ホイール歯数", str(self.cfg.wheel_teeth))
        self._add_entry(sec, "worm_leads", "ウォーム条数", str(self.cfg.worm_leads))

        # 評価パラメータ
        sec = self._add_section(inner, "評価パラメータ")
        self._add_entry(sec, "wheel_divisions", "ホイール等分数", str(self.cfg.wheel_divisions))
        self._add_entry(sec, "worm_divisions", "ウォーム等分数", str(self.cfg.worm_divisions))
        self._add_entry(sec, "worm_start_position", "ウォーム評価開始位置 (°)", str(self.cfg.worm_start_position))

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

    def _apply_config(self):
        """GUIの入力値をcfgに反映"""
        v = self._cfg_vars
        self.cfg.machine_name = v["machine_name"].get()
        self.cfg.nc_model = v["nc_model"].get()
        self.cfg.wheel_teeth = int(v["wheel_teeth"].get() or 60)
        self.cfg.worm_leads = int(v["worm_leads"].get() or 1)
        self.cfg.wheel_divisions = int(v["wheel_divisions"].get() or 36)
        self.cfg.worm_divisions = int(v["worm_divisions"].get() or 10)
        self.cfg.worm_start_position = float(v["worm_start_position"].get() or 0)
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
        cols = ("no", "angle", "category", "status")
        self._targets_tree = ttk.Treeview(frame, columns=cols, show="headings", height=25)
        self._targets_tree.heading("no", text="No.")
        self._targets_tree.heading("angle", text="ターゲット角度 (°)")
        self._targets_tree.heading("category", text="区分")
        self._targets_tree.heading("status", text="ステータス")
        self._targets_tree.column("no", width=60, anchor="center")
        self._targets_tree.column("angle", width=200, anchor="center")
        self._targets_tree.column("category", width=150, anchor="center")
        self._targets_tree.column("status", width=150, anchor="center")

        sb = ttk.Scrollbar(frame, orient="vertical", command=self._targets_tree.yview)
        self._targets_tree.configure(yscrollcommand=sb.set)
        self._targets_tree.pack(side="left", fill="both", expand=True)
        sb.pack(side="right", fill="y")

    def _refresh_targets_tab(self):
        tree = self._targets_tree
        tree.delete(*tree.get_children())
        wc = sum(1 for t in self.targets if t.category == "wheel")
        wmc = sum(1 for t in self.targets if t.category == "worm")
        self._targets_info_label.config(text=f"合計 {len(self.targets)} 点  (ホイール: {wc},  ウォーム: {wmc})")
        for t in self.targets:
            cat = "ホイール" if t.category == "wheel" else "ウォーム"
            st = "測定済" if t.status == "measured" else "未測定"
            tree.insert("", "end", values=(t.no, f"{t.angle:.4f}", cat, st))

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
        wheel_count = sum(1 for t in self.targets if t.category == "wheel")
        self.measurements = parse_csv_data(text, wheel_count)

        if not self.measurements:
            messagebox.showwarning("データなし", "有効なデータが見つかりませんでした。形式を確認してください。")
            return

        wc = sum(1 for m in self.measurements if m.category == "wheel")
        wmc = sum(1 for m in self.measurements if m.category == "worm")
        self._data_info_label.config(text=f"解析完了: {len(self.measurements)} 点 (ホイール: {wc}, ウォーム: {wmc})")

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

        wheel = [m for m in self.measurements if m.category == "wheel"]
        worm = [m for m in self.measurements if m.category == "worm"]
        self._wheel_stats = calc_stats(wheel)
        self._worm_stats = calc_stats(worm)

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

        if wheel:
            self._add_eval_section(inner, "ホイール評価結果", wheel, self._wheel_stats, chart_type="bar")
        if worm:
            self._add_eval_section(inner, "ウォーム評価結果", worm, self._worm_stats, chart_type="line")

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
        wheel = [m for m in self.measurements if m.category == "wheel"]
        worm = [m for m in self.measurements if m.category == "worm"]
        ws = calc_stats(wheel)
        wms = calc_stats(worm)

        lines = []
        lines.append("=" * 60)
        lines.append("        回転軸 割出し精度 成績書")
        lines.append("        XR20 ウォームホイール評価")
        lines.append("=" * 60)
        lines.append("")
        lines.append("【測定条件】")
        lines.append(f"  測定日:         {today}")
        lines.append(f"  機械名:         {self.cfg.machine_name or '-'}")
        lines.append(f"  NC装置:         {self.cfg.nc_model or '-'}")
        lines.append(f"  ホイール歯数:   {self.cfg.wheel_teeth}")
        lines.append(f"  ウォーム条数:   {self.cfg.worm_leads}")
        lines.append(f"  ホイール等分数: {self.cfg.wheel_divisions}")
        lines.append(f"  ウォーム等分数: {self.cfg.worm_divisions}")
        lines.append(f"  測定器:         Renishaw XR20 + XL-80")
        lines.append("")

        if wheel:
            lines.append("-" * 60)
            lines.append(f"【ホイール評価結果】 ({self.cfg.wheel_divisions}等分)")
            lines.append("-" * 60)
            lines.append(f"  測定点数:   {ws.count}")
            lines.append(f"  最大誤差:   {ws.max_error:+.2f} arc sec")
            lines.append(f"  最小誤差:   {ws.min_error:+.2f} arc sec")
            lines.append(f"  平均誤差:   {ws.mean_error:+.2f} arc sec")
            lines.append(f"  標準偏差σ:  {ws.sigma:.2f} arc sec")
            lines.append(f"  割出し精度: {ws.index_accuracy:.2f} arc sec (Max-Min)")
            lines.append("")
            lines.append(f"  {'No.':>4}  {'ターゲット(°)':>14}  {'測定値(°)':>14}  {'誤差(″)':>10}")
            lines.append("  " + "-" * 48)
            for i, d in enumerate(wheel):
                lines.append(f"  {i+1:4d}  {d.target_angle:14.4f}  {d.measured_angle:14.4f}  {d.error_arcsec:+10.2f}")
            lines.append("")

        if worm:
            lines.append("-" * 60)
            lines.append(f"【ウォーム評価結果】 ({self.cfg.worm_divisions}等分)")
            lines.append("-" * 60)
            lines.append(f"  測定点数:   {wms.count}")
            lines.append(f"  最大誤差:   {wms.max_error:+.2f} arc sec")
            lines.append(f"  最小誤差:   {wms.min_error:+.2f} arc sec")
            lines.append(f"  平均誤差:   {wms.mean_error:+.2f} arc sec")
            lines.append(f"  標準偏差σ:  {wms.sigma:.2f} arc sec")
            lines.append(f"  割出し精度: {wms.index_accuracy:.2f} arc sec (Max-Min)")
            lines.append("")
            lines.append(f"  {'No.':>4}  {'ターゲット(°)':>14}  {'測定値(°)':>14}  {'誤差(″)':>10}")
            lines.append("  " + "-" * 48)
            for i, d in enumerate(worm):
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

        wheel = [m for m in self.measurements if m.category == "wheel"]
        worm = [m for m in self.measurements if m.category == "worm"]
        ws = calc_stats(wheel)
        wms = calc_stats(worm)
        today = datetime.now().strftime("%Y年%m月%d日")

        with PdfPages(path) as pdf:
            fig = Figure(figsize=(8.27, 11.69), dpi=100)  # A4

            # タイトル
            fig.text(0.5, 0.95, "回転軸 割出し精度 成績書", ha="center", fontsize=16, fontweight="bold")
            fig.text(0.5, 0.93, "XR20 ウォームホイール評価", ha="center", fontsize=10, color="gray")

            # 測定条件
            y = 0.89
            fig.text(0.08, y, "【測定条件】", fontsize=10, fontweight="bold")
            y -= 0.02
            for label, val in [
                ("測定日", today),
                ("機械名", self.cfg.machine_name or "-"),
                ("ホイール歯数", str(self.cfg.wheel_teeth)),
                ("ウォーム条数", str(self.cfg.worm_leads)),
            ]:
                fig.text(0.10, y, f"{label}: {val}", fontsize=8)
                y -= 0.015

            # ホイールグラフ
            if wheel:
                ax1 = fig.add_axes([0.10, 0.48, 0.82, 0.28])
                errors = [d.error_arcsec for d in wheel]
                colors = ["#3b82f6" if e >= 0 else "#60a5fa" for e in errors]
                ax1.bar(range(len(errors)), errors, color=colors, width=0.7)
                ax1.axhline(y=0, color="#94a3b8", linewidth=0.8)
                ax1.set_title(f"ホイール評価 ({self.cfg.wheel_divisions}等分)  割出し精度: {ws.index_accuracy:.2f}″", fontsize=9)
                ax1.set_ylabel("arc sec", fontsize=8)
                ax1.grid(True, alpha=0.3)

            # ウォームグラフ
            if worm:
                ax2 = fig.add_axes([0.10, 0.12, 0.82, 0.28])
                errors = [d.error_arcsec for d in worm]
                ax2.plot(range(len(errors)), errors, "o-", color="#f59e0b", markersize=4, linewidth=1.5)
                ax2.axhline(y=0, color="#94a3b8", linewidth=0.8)
                ax2.set_title(f"ウォーム評価 ({self.cfg.worm_divisions}等分)  割出し精度: {wms.index_accuracy:.2f}″", fontsize=9)
                ax2.set_ylabel("arc sec", fontsize=8)
                ax2.grid(True, alpha=0.3)

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
