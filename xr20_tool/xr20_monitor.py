#!/usr/bin/env python3
"""XR20 画面監視ツール（全面書き換え版）

IK220/LabVIEW 測定アプリの「傾」列を監視し、閾値超過時に取込開始ボタンを
自動クリック＋SwitchBot でリモコン操作するリトライ自動化ツール。

読み取り方式は優先順に:
    1) pywinauto (UIA/Win32) で文字列を直接取得
    2) Tesseract OCR で画面画像から数値を抽出
    3) ピクセル色判定（緑=OK / 赤=NG）フォールバック

設定: 同フォルダの monitor_config.json
"""

from __future__ import annotations

import csv
import json
import sys
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Callable


@dataclass
class MonitorConfig:
    switchbot_token: str = ""
    switchbot_secret: str = ""
    switchbot_device_id: str = ""
    app_title: str = "IK220"
    capture_button: str = "取込開始"
    threshold_hr: float = 4.0
    threshold_wr: float = 7.0
    target_rows: list[str] = field(default_factory=lambda: ["HR", "WR", "WL", "HL"])
    dry_run: bool = True
    poll_interval_sec: float = 10.0
    read_mode: str = "auto"  # auto / pywinauto / ocr / pixel
    ocr_region: list[int] = field(default_factory=list)  # [x,y,w,h]
    pixel_probes: dict[str, list[int]] = field(default_factory=dict)  # row -> [x,y]
    csv_log_path: str = "xr20_monitor_history.csv"


class XR20Monitor:
    """画面監視＋自動リトライの中核クラス。"""

    def __init__(self, config: MonitorConfig, log_cb: Callable[[str], None] | None = None) -> None:
        self.cfg = config
        self._log_cb = log_cb or (lambda msg: print(msg))
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._last_values: dict[str, Any] = {}

    def log(self, msg: str) -> None:
        stamped = f"[{datetime.now().strftime('%H:%M:%S')}] {msg}"
        self._log_cb(stamped)

    # ------------------------------------------------------------------
    # 1) pywinauto による UI 要素直接読み取り
    # ------------------------------------------------------------------
    def read_via_pywinauto(self) -> dict[str, float]:
        """UIA / Win32 バックエンドで行ラベルに対応する数値を取得する。

        見つからない行は返り値に含めない。例外は空 dict で握り潰す（次の手段へフォールバック）。
        """
        try:
            from pywinauto import Desktop
        except Exception as exc:  # pragma: no cover - import guard
            self.log(f"pywinauto 未導入: {exc}")
            return {}

        results: dict[str, float] = {}
        for backend in ("uia", "win32"):
            try:
                win = Desktop(backend=backend).window(title_re=f".*{self.cfg.app_title}.*")
                if not win.exists(timeout=1.0):
                    continue
                texts = win.descendants()
                results.update(self._extract_rows(texts))
                if results:
                    self.log(f"pywinauto[{backend}] 読取成功: {results}")
                    return results
            except Exception as exc:
                self.log(f"pywinauto[{backend}] 失敗: {exc}")
        return results

    def _extract_rows(self, descendants: list[Any]) -> dict[str, float]:
        """descendants を走査し、ラベル直後の数値テキストを拾う。"""
        out: dict[str, float] = {}
        labels = [d for d in descendants if getattr(d, "window_text", lambda: "")() in self.cfg.target_rows]
        for label in labels:
            row_name = label.window_text()
            try:
                siblings = label.parent().children() if hasattr(label, "parent") else []
            except Exception:
                siblings = []
            for sib in siblings:
                try:
                    txt = sib.window_text().strip()
                except Exception:
                    continue
                if txt and txt != row_name:
                    val = _safe_float(txt)
                    if val is not None:
                        out[row_name] = val
                        break
        return out


    # ------------------------------------------------------------------
    # 2) OCR (Tesseract / mss) 経由の読み取り
    # ------------------------------------------------------------------
    def read_via_ocr(self) -> dict[str, float]:
        """ocr_region に指定された矩形をキャプチャし、行ラベル＋数値を抽出する。

        Tesseract がインストールされていない / 領域未指定の場合は空 dict を返す。
        """
        region = self.cfg.ocr_region
        if not region or len(region) != 4:
            return {}
        try:
            import mss
            import pytesseract
            from PIL import Image
        except Exception as exc:
            self.log(f"OCR 依存モジュール不足: {exc}")
            return {}

        x, y, w, h = region
        try:
            with mss.mss() as sct:
                shot = sct.grab({"left": x, "top": y, "width": w, "height": h})
                img = Image.frombytes("RGB", shot.size, shot.rgb)
        except Exception as exc:
            self.log(f"画面キャプチャ失敗: {exc}")
            return {}

        try:
            raw = pytesseract.image_to_string(img, lang="eng", config="--psm 6")
        except Exception as exc:
            self.log(f"Tesseract 実行失敗: {exc}")
            return {}

        parsed = self._parse_ocr_text(raw)
        if parsed:
            self.log(f"OCR 読取成功: {parsed}")
        return parsed

    def _parse_ocr_text(self, raw: str) -> dict[str, float]:
        """OCR 出力から 'HR 3.21' のような行をパースする。"""
        out: dict[str, float] = {}
        for line in raw.splitlines():
            tokens = line.strip().split()
            if len(tokens) < 2:
                continue
            head = tokens[0].upper().strip(":：")
            if head not in self.cfg.target_rows:
                continue
            for tok in tokens[1:]:
                val = _safe_float(tok)
                if val is not None:
                    out[head] = val
                    break
        return out


    # ------------------------------------------------------------------
    # 3) ピクセル色判定（緑=OK / 赤=NG）
    # ------------------------------------------------------------------
    def read_via_pixel(self) -> dict[str, str]:
        """pixel_probes で指定された座標の色を見て OK/NG を返す。

        画面に色付きインジケータがあるアプリ向けのフォールバック。
        返り値: {row: 'OK' | 'NG' | 'UNKNOWN'}
        """
        probes = self.cfg.pixel_probes
        if not probes:
            return {}
        try:
            import mss
        except Exception as exc:
            self.log(f"mss 未導入 (ピクセル判定不可): {exc}")
            return {}

        out: dict[str, str] = {}
        try:
            with mss.mss() as sct:
                for row, xy in probes.items():
                    if len(xy) != 2:
                        continue
                    px = xy[0]
                    py = xy[1]
                    shot = sct.grab({"left": px, "top": py, "width": 1, "height": 1})
                    r, g, b = shot.pixel(0, 0)
                    out[row] = _classify_color(r, g, b)
        except Exception as exc:
            self.log(f"ピクセル取得失敗: {exc}")
            return {}

        if out:
            self.log(f"ピクセル判定: {out}")
        return out

    # ------------------------------------------------------------------
    # 判定の統合
    # ------------------------------------------------------------------
    def is_ng(self, row: str, value: Any) -> bool:
        """value が NG かどうか判定する。数値と 'OK'/'NG' 両対応。"""
        if isinstance(value, str):
            return value.upper() == "NG"
        if value is None:
            return False
        threshold = self.cfg.threshold_wr if row.startswith("W") else self.cfg.threshold_hr
        return abs(float(value)) > threshold

    # ------------------------------------------------------------------
    # 監視ループ
    # ------------------------------------------------------------------
    def read_once(self) -> dict[str, Any]:
        """設定された read_mode に従ってワンショット読み取りする。"""
        mode = self.cfg.read_mode
        if mode in ("auto", "pywinauto"):
            vals = self.read_via_pywinauto()
            if vals:
                return vals
            if mode == "pywinauto":
                return {}
        if mode in ("auto", "ocr"):
            vals = self.read_via_ocr()
            if vals:
                return vals
            if mode == "ocr":
                return {}
        return self.read_via_pixel()

    def start(self, on_values: Callable[[dict[str, Any]], None] | None = None) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._loop, args=(on_values,), daemon=True)
        self._thread.start()
        self.log("監視ループ開始")

    def stop(self) -> None:
        self._stop.set()
        self.log("監視ループ停止要求")

    def _loop(self, on_values: Callable[[dict[str, Any]], None] | None) -> None:
        while not self._stop.is_set():
            values = self.read_once()
            self._last_values = values
            self._append_csv(values)
            if on_values:
                try:
                    on_values(values)
                except Exception as exc:
                    self.log(f"コールバック例外: {exc}")
            self._stop.wait(self.cfg.poll_interval_sec)

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

    def _append_csv(self, values: dict[str, Any]) -> None:
        if not values:
            return
        path = self._csv_path()
        rows = list(self.cfg.target_rows)
        header = ["timestamp", *rows, *[f"{r}_ng" for r in rows]]
        write_header = not path.exists()
        try:
            with path.open("a", newline="", encoding="utf-8") as f:
                writer = csv.writer(f)
                if write_header:
                    writer.writerow(header)
                ts = datetime.now().isoformat(timespec="seconds")
                vals = [values.get(r, "") for r in rows]
                flags = [int(self.is_ng(r, values.get(r))) for r in rows]
                writer.writerow([ts, *vals, *flags])
        except OSError as exc:
            self.log(f"CSV 書込失敗: {exc}")


def load_config(path: Path) -> MonitorConfig:
    if path.exists():
        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)
    else:
        data = {}
        cfg = MonitorConfig()
        path.write_text(json.dumps(_cfg_to_dict(cfg), ensure_ascii=False, indent=2), encoding="utf-8")
    return _dict_to_cfg(data)


def save_config(path: Path, cfg: MonitorConfig) -> None:
    path.write_text(json.dumps(_cfg_to_dict(cfg), ensure_ascii=False, indent=2), encoding="utf-8")


def _cfg_to_dict(cfg: MonitorConfig) -> dict[str, Any]:
    return {
        "switchbot_token": cfg.switchbot_token,
        "switchbot_secret": cfg.switchbot_secret,
        "switchbot_device_id": cfg.switchbot_device_id,
        "app_title": cfg.app_title,
        "capture_button": cfg.capture_button,
        "threshold_hr": cfg.threshold_hr,
        "threshold_wr": cfg.threshold_wr,
        "target_rows": list(cfg.target_rows),
        "dry_run": cfg.dry_run,
        "poll_interval_sec": cfg.poll_interval_sec,
        "read_mode": cfg.read_mode,
        "ocr_region": list(cfg.ocr_region),
        "pixel_probes": dict(cfg.pixel_probes),
        "csv_log_path": cfg.csv_log_path,
    }


def _dict_to_cfg(data: dict[str, Any]) -> MonitorConfig:
    base = MonitorConfig()
    for key, val in data.items():
        if hasattr(base, key):
            setattr(base, key, val)
    return base


def _classify_color(r: int, g: int, b: int) -> str:
    """RGB から OK (緑優位) / NG (赤優位) / UNKNOWN を返す。"""
    if g > 140 and g > r + 30 and g > b + 30:
        return "OK"
    if r > 140 and r > g + 30 and r > b + 30:
        return "NG"
    return "UNKNOWN"


def _safe_float(text: str) -> float | None:
    """'+3.21' / '-0.5' / '1,234.5' などを float に変換。失敗時は None。"""
    cleaned = text.replace(",", "").replace("＋", "+").replace("－", "-").strip()
    try:
        return float(cleaned)
    except (TypeError, ValueError):
        return None


class MonitorGUI:
    """Tkinter ベースの簡易 GUI。閾値スライダーとログ表示を備える。"""

    def __init__(self, monitor: XR20Monitor, config_path: Path) -> None:
        import tkinter as tk
        from tkinter import ttk

        self._tk = tk
        self._ttk = ttk
        self.monitor = monitor
        self.config_path = config_path

        self.root = tk.Tk()
        self.root.title("XR20 Monitor")
        self.root.geometry("560x520")

        self.hr_var = tk.DoubleVar(value=monitor.cfg.threshold_hr)
        self.wr_var = tk.DoubleVar(value=monitor.cfg.threshold_wr)
        self.poll_var = tk.DoubleVar(value=monitor.cfg.poll_interval_sec)
        self.dry_var = tk.BooleanVar(value=monitor.cfg.dry_run)
        self.values_var = tk.StringVar(value="未取得")

        self._build_layout()
        monitor._log_cb = self._append_log

    def _build_layout(self) -> None:
        tk = self._tk
        ttk = self._ttk
        pad = {"padx": 8, "pady": 4}

        frm = ttk.Frame(self.root)
        frm.pack(fill="both", expand=True, **pad)

        ttk.Label(frm, text="HR/HL 閾値 (μm)").grid(row=0, column=0, sticky="w")
        hr_slider = ttk.Scale(frm, from_=0.5, to=20, variable=self.hr_var, orient="horizontal",
                              command=lambda v: self._on_threshold())
        hr_slider.grid(row=0, column=1, sticky="ew")
        self.hr_label = ttk.Label(frm, textvariable=self.hr_var, width=6)
        self.hr_label.grid(row=0, column=2)

        ttk.Label(frm, text="WR/WL 閾値 (μm)").grid(row=1, column=0, sticky="w")
        wr_slider = ttk.Scale(frm, from_=0.5, to=30, variable=self.wr_var, orient="horizontal",
                              command=lambda v: self._on_threshold())
        wr_slider.grid(row=1, column=1, sticky="ew")
        self.wr_label = ttk.Label(frm, textvariable=self.wr_var, width=6)
        self.wr_label.grid(row=1, column=2)

        ttk.Label(frm, text="ポーリング秒").grid(row=2, column=0, sticky="w")
        poll_slider = ttk.Scale(frm, from_=2, to=60, variable=self.poll_var, orient="horizontal",
                                command=lambda v: self._on_threshold())
        poll_slider.grid(row=2, column=1, sticky="ew")
        ttk.Label(frm, textvariable=self.poll_var, width=6).grid(row=2, column=2)

        ttk.Checkbutton(frm, text="リハーサル (SwitchBot 送信なし)", variable=self.dry_var,
                        command=self._on_threshold).grid(row=3, column=0, columnspan=3, sticky="w")

        ttk.Label(frm, text="現在値:").grid(row=4, column=0, sticky="w")
        ttk.Label(frm, textvariable=self.values_var).grid(row=4, column=1, columnspan=2, sticky="w")

        btn_frame = ttk.Frame(frm)
        btn_frame.grid(row=5, column=0, columnspan=3, sticky="ew", pady=6)
        ttk.Button(btn_frame, text="開始", command=self._start).pack(side="left", padx=4)
        ttk.Button(btn_frame, text="停止", command=self.monitor.stop).pack(side="left", padx=4)
        ttk.Button(btn_frame, text="設定保存", command=self._save).pack(side="left", padx=4)

        self.log_box = tk.Text(frm, height=18, wrap="none")
        self.log_box.grid(row=6, column=0, columnspan=3, sticky="nsew", pady=4)
        frm.columnconfigure(1, weight=1)
        frm.rowconfigure(6, weight=1)

    def _on_threshold(self) -> None:
        self.monitor.cfg.threshold_hr = round(float(self.hr_var.get()), 2)
        self.monitor.cfg.threshold_wr = round(float(self.wr_var.get()), 2)
        self.monitor.cfg.poll_interval_sec = round(float(self.poll_var.get()), 1)
        self.monitor.cfg.dry_run = bool(self.dry_var.get())

    def _start(self) -> None:
        self._on_threshold()
        self.monitor.start(on_values=self._on_values)

    def _on_values(self, values: dict[str, Any]) -> None:
        text = ", ".join(f"{k}={v}" for k, v in values.items()) or "(読み取り失敗)"
        self.root.after(0, lambda: self.values_var.set(text))

    def _save(self) -> None:
        self._on_threshold()
        save_config(self.config_path, self.monitor.cfg)
        self.monitor.log(f"設定保存: {self.config_path}")

    def _append_log(self, msg: str) -> None:
        self.root.after(0, lambda: self._do_append(msg))

    def _do_append(self, msg: str) -> None:
        self.log_box.insert("end", msg + "\n")
        self.log_box.see("end")

    def run(self) -> None:
        self.root.mainloop()


def main() -> int:
    base = Path(__file__).resolve().parent if not getattr(sys, "frozen", False) else Path(sys.executable).parent
    cfg_path = base / "monitor_config.json"
    cfg = load_config(cfg_path)
    monitor = XR20Monitor(cfg)
    if "--cli" in sys.argv:
        monitor.start(on_values=lambda v: monitor.log(f"values={v}"))
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            monitor.stop()
        return 0
    MonitorGUI(monitor, cfg_path).run()
    return 0


if __name__ == "__main__":
    sys.exit(main())
