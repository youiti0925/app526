#!/usr/bin/env python3
"""
IK220 分割測定 自動監視＆リトライツール
========================================
IK220分割測定KWIN10.vi (LabVIEW) の「傾」値を監視し、
NGの場合に自動で取込開始＋SwitchBotでリモコン押下してリトライする。

設定は同じフォルダの monitor_config.json から読み込む。

使い方:
  xr20_monitor.exe              # GUIモード（通常はこれ）
  xr20_monitor.exe --cli        # CLIモード
  xr20_monitor.exe --scan       # UI要素一覧（デバッグ）
  xr20_monitor.exe --dry-run    # リハーサルモード強制
  xr20_monitor.exe --test-press # SwitchBotテスト押下
"""

import time
import sys
import os
import hashlib
import hmac
import base64
import uuid
import re
import json
import threading
from datetime import datetime
from pathlib import Path

# ============================================================
# 設定読み込み
# ============================================================
DEFAULT_CONFIG = {
    "switchbot_token": "",
    "switchbot_secret": "",
    "switchbot_device_id": "",
    "app_title": "IK220分割測定KWIN10",
    "capture_button": "取込開始",
    "threshold_hr": 4,
    "threshold_wr": 7,
    "target_rows": ["HR", "WR", "WL", "HL"],
    "dry_run": True,
    "poll_interval_sec": 10,
}


def load_config():
    """monitor_config.json を読み込む。なければデフォルト設定でファイルを生成。"""
    # exe と同じフォルダ or カレントディレクトリ
    if getattr(sys, "frozen", False):
        base_dir = Path(sys.executable).parent
    else:
        base_dir = Path(__file__).parent

    config_path = base_dir / "monitor_config.json"

    if config_path.exists():
        with open(config_path, "r", encoding="utf-8") as f:
            user_cfg = json.load(f)
        # デフォルト値をマージ
        cfg = {**DEFAULT_CONFIG, **user_cfg}
        print(f"設定読み込み: {config_path}")
    else:
        cfg = DEFAULT_CONFIG.copy()
        # デフォルト設定ファイルを生成
        with open(config_path, "w", encoding="utf-8") as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)
        print(f"デフォルト設定ファイルを生成しました: {config_path}")
        print("monitor_config.json を編集してから再実行してください。")

    return cfg


CONFIG = load_config()

# 設定値をグローバルに展開
SWITCHBOT_TOKEN = CONFIG["switchbot_token"]
SWITCHBOT_SECRET = CONFIG["switchbot_secret"]
SWITCHBOT_DEVICE_ID = CONFIG["switchbot_device_id"]
APP_TITLE = CONFIG["app_title"]
CAPTURE_BUTTON = CONFIG["capture_button"]
POLL_INTERVAL = CONFIG.get("poll_interval_sec", 10)
DRY_RUN = CONFIG.get("dry_run", True)

TILT_THRESHOLDS = {
    "HR": CONFIG["threshold_hr"],
    "HL": CONFIG["threshold_hr"],
    "WR": CONFIG["threshold_wr"],
    "WL": CONFIG["threshold_wr"],
}
TARGET_ROWS = CONFIG["target_rows"]


# ============================================================
# ログ
# ============================================================
class Logger:
    def __init__(self):
        self.entries = []

    def log(self, msg):
        ts = datetime.now().strftime("%H:%M:%S")
        line = f"[{ts}] {msg}"
        print(line)
        self.entries.append(line)


logger = Logger()
log = logger.log


# ============================================================
# SwitchBot API v1.1
# ============================================================
class SwitchBotAPI:
    BASE_URL = "https://api.switch-bot.com/v1.1"

    def __init__(self, token, secret):
        self.token = token
        self.secret = secret

    def _headers(self):
        nonce = str(uuid.uuid4())
        t = str(int(time.time() * 1000))
        sign = base64.b64encode(
            hmac.new(
                self.secret.encode(), f"{self.token}{t}{nonce}".encode(), hashlib.sha256
            ).digest()
        ).decode()
        return {
            "Authorization": self.token,
            "t": t,
            "sign": sign,
            "nonce": nonce,
            "Content-Type": "application/json; charset=utf-8",
        }

    def press(self, device_id):
        if DRY_RUN:
            log("SwitchBot: [リハーサル] ボタン押下をスキップ")
            return True
        import requests

        try:
            r = requests.post(
                f"{self.BASE_URL}/devices/{device_id}/commands",
                headers=self._headers(),
                json={
                    "command": "press",
                    "parameter": "default",
                    "commandType": "command",
                },
                timeout=10,
            )
            data = r.json()
            if data.get("statusCode") == 100:
                log("SwitchBot: ボタン押下成功")
                return True
            log(f"SwitchBot: エラー - {data}")
            return False
        except Exception as e:
            log(f"SwitchBot: 通信エラー - {e}")
            return False

    def list_devices(self):
        import requests

        try:
            r = requests.get(
                f"{self.BASE_URL}/devices", headers=self._headers(), timeout=10
            )
            data = r.json()
            if data.get("statusCode") == 100:
                devices = data["body"].get("deviceList", [])
                log(f"SwitchBot: {len(devices)}台のデバイスを検出")
                for d in devices:
                    log(
                        f"  - {d['deviceName']} (ID: {d['deviceId']}, Type: {d['deviceType']})"
                    )
                return devices
            log(f"SwitchBot: エラー - {data}")
        except Exception as e:
            log(f"SwitchBot: 通信エラー - {e}")
        return []


# ============================================================
# IK220 測定アプリ操作
# ============================================================
class IK220Monitor:
    """
    IK220分割測定KWIN10.vi (LabVIEW) の画面を監視する。

    テーブル構造:
      No | 名前 | 間隔 | 1/N | 点数 | 傾 | 精度 | ...
      1    HR     60000   1    60    -1   19.0
      3    WR     3600    1    10     0    9.5
      4    WL     3600    1    10    -1    8.0
      2    HL     60000   1    60     0   19.5
    """

    def __init__(self):
        self._app = None
        self._dlg = None

    def connect(self):
        try:
            from pywinauto import Application

            self._app = Application(backend="uia").connect(
                title_re=f".*{APP_TITLE}.*", timeout=10
            )
            self._dlg = self._app.window(title_re=f".*{APP_TITLE}.*")
            log(f"接続成功: {self._dlg.window_text()}")
            return True
        except ImportError:
            log("エラー: pywinauto が見つかりません")
            log("  exe版では同梱済みのはずです。問題が続く場合は再ビルドしてください。")
            return False
        except Exception as e:
            log(f"接続エラー: {e}")
            return False

    def scan_controls(self):
        """UI要素を一覧表示（デバッグ用）"""
        if not self._dlg and not self.connect():
            return
        log("--- UI要素一覧 ---")
        try:
            self._dlg.print_control_identifiers(depth=3)
        except Exception as e:
            log(f"scan エラー: {e}")

    def read_tilt_values(self):
        """
        各行の「傾」値を辞書で返す: {"HR": -1, "WR": 0, ...}
        方式1: UIA Table → 方式2: テキストスキャン → 方式3: OCR
        """
        if not self._dlg:
            if not self.connect():
                return None

        for method_name, method in [
            ("UIA Table", self._read_from_table),
            ("テキストスキャン", self._read_from_text_scan),
            ("OCR", self._read_from_ocr),
        ]:
            try:
                result = method()
                if result:
                    return result
            except Exception as e:
                log(f"  {method_name}エラー: {e}")

        log("警告: どの方式でも傾き値を取得できませんでした")
        return None

    def _read_from_table(self):
        """UIA Table/DataGrid/List から読み取り"""
        for ctrl_type in ["Table", "DataGrid", "List"]:
            try:
                table = self._dlg.child_window(control_type=ctrl_type)
                if not table.exists(timeout=2):
                    continue
                items = table.descendants()
                texts = [c.window_text() for c in items if c.window_text().strip()]
                if texts:
                    return self._parse_table_texts(texts)
            except Exception:
                continue
        return None

    def _read_from_text_scan(self):
        """全子要素のテキストを収集してパターンマッチ"""
        children = self._dlg.descendants()
        all_texts = []
        for child in children:
            try:
                t = child.window_text().strip()
                if t:
                    all_texts.append(t)
            except Exception:
                continue
        return self._parse_table_texts(all_texts) if all_texts else None

    def _parse_table_texts(self, texts):
        """テキストリストからHR/WR/WL/HL行を探し、傾の値を抽出"""
        result = {}
        for row_name in TARGET_ROWS:
            idx = None
            for i, t in enumerate(texts):
                if t.strip() == row_name:
                    idx = i
                    break
            if idx is None:
                continue

            nums_found = []
            for j in range(idx + 1, min(idx + 20, len(texts))):
                t = texts[j].strip()
                if t in ("HR", "WR", "WL", "HL") and t != row_name:
                    break
                try:
                    val = float(t)
                    nums_found.append(val)
                except ValueError:
                    continue
                if len(nums_found) >= 4:
                    break

            if len(nums_found) >= 4:
                tilt_val = nums_found[3]
                result[row_name] = tilt_val
                log(f"  {row_name}: 傾 = {tilt_val}")

        return result if result else None

    def _read_from_ocr(self):
        """スクリーンショット + OCR"""
        try:
            from PIL import ImageGrab
            import pytesseract
        except ImportError:
            return None

        rect = self._dlg.rectangle()
        table_h = int((rect.bottom - rect.top) * 0.30)
        img = ImageGrab.grab(
            bbox=(rect.left, rect.top, rect.right, rect.top + table_h)
        )
        text = pytesseract.image_to_string(img, lang="eng+jpn", config="--psm 6")

        result = {}
        for line in text.split("\n"):
            for row_name in TARGET_ROWS:
                if row_name in line:
                    nums = re.findall(r"-?\d+\.?\d*", line)
                    if len(nums) >= 5:
                        result[row_name] = float(nums[4])
        return result if result else None

    def click_capture_button(self):
        """「取込開始」ボタンをクリック（4方式フォールバック）— リハーサルでも実行"""
        if not self._dlg:
            if not self.connect():
                return False

        # 方式1: UIA title マッチ
        try:
            btn = self._dlg.child_window(title_re=f".*{CAPTURE_BUTTON}.*")
            if btn.exists(timeout=2):
                btn.click_input()
                log(f"方式1: 「{CAPTURE_BUTTON}」クリック (UIA)")
                return True
        except Exception as e:
            log(f"  方式1失敗: {e}")

        # 方式2: テキスト検索
        try:
            for child in self._dlg.descendants():
                try:
                    txt = child.window_text().strip()
                    if CAPTURE_BUTTON in txt:
                        child.click_input()
                        log(f"方式2: 「{txt}」クリック (テキスト検索)")
                        return True
                except Exception:
                    continue
        except Exception as e:
            log(f"  方式2失敗: {e}")

        # 方式3: 画像マッチング
        try:
            if self._click_by_image():
                return True
        except Exception as e:
            log(f"  方式3失敗: {e}")

        # 方式4: 座標クリック
        try:
            rect = self._dlg.rectangle()
            win_w = rect.right - rect.left
            win_h = rect.bottom - rect.top
            btn_x = rect.left + int(win_w * 0.14)
            btn_y = rect.top + int(win_h * 0.35)
            log(f"方式4: 座標クリック ({btn_x}, {btn_y})")
            import ctypes

            ctypes.windll.user32.SetCursorPos(btn_x, btn_y)
            time.sleep(0.1)
            ctypes.windll.user32.mouse_event(0x0002, 0, 0, 0, 0)
            time.sleep(0.05)
            ctypes.windll.user32.mouse_event(0x0004, 0, 0, 0, 0)
            return True
        except Exception as e:
            log(f"  方式4失敗: {e}")

        log("全方式でボタンクリックに失敗")
        return False

    def _click_by_image(self):
        try:
            from PIL import ImageGrab
            import pytesseract
        except ImportError:
            return False

        rect = self._dlg.rectangle()
        img = ImageGrab.grab(bbox=(rect.left, rect.top, rect.right, rect.bottom))
        data = pytesseract.image_to_data(
            img, lang="jpn+eng", output_type=pytesseract.Output.DICT
        )
        for i, text in enumerate(data["text"]):
            if CAPTURE_BUTTON in text or text in CAPTURE_BUTTON:
                x = data["left"][i] + data["width"][i] // 2
                y = data["top"][i] + data["height"][i] // 2
                abs_x, abs_y = rect.left + x, rect.top + y
                import ctypes

                ctypes.windll.user32.SetCursorPos(abs_x, abs_y)
                time.sleep(0.1)
                ctypes.windll.user32.mouse_event(0x0002, 0, 0, 0, 0)
                time.sleep(0.05)
                ctypes.windll.user32.mouse_event(0x0004, 0, 0, 0, 0)
                log(f"方式3: 画像マッチングでクリック ({abs_x}, {abs_y})")
                return True
        return False


# ============================================================
# 判定ロジック
# ============================================================
def check_tilt_results(tilt_values):
    """各行の傾き値を閾値と比較、NG行リストを返す"""
    ng_rows = []
    for row_name, value in tilt_values.items():
        threshold = TILT_THRESHOLDS.get(row_name)
        if threshold is None:
            continue
        if abs(value) >= threshold:
            ng_rows.append((row_name, value, threshold))
            log(f"  NG: {row_name} 傾={value} (閾値: {threshold})")
        else:
            log(f"  OK: {row_name} 傾={value} (閾値: {threshold})")
    return ng_rows


# ============================================================
# メイン監視ループ
# ============================================================
class AutoRetryMonitor:
    def __init__(self):
        self.running = False
        self.retry_count = 0
        self.success_count = 0
        self.switchbot = (
            SwitchBotAPI(SWITCHBOT_TOKEN, SWITCHBOT_SECRET)
            if SWITCHBOT_TOKEN
            else None
        )
        self.ik220 = IK220Monitor()

    def start(self):
        self.running = True
        self.retry_count = 0

        log("=" * 60)
        if DRY_RUN:
            log("*** リハーサルモード ***")
            log("  画面監視＋取込開始ボタンは実行、SwitchBot操作のみスキップ")
        log("IK220 自動監視を開始します")
        log(f"  対象アプリ: {APP_TITLE}")
        log(f"  監視行: {', '.join(TARGET_ROWS)}")
        for name in TARGET_ROWS:
            th = TILT_THRESHOLDS.get(name, "?")
            log(f"    {name}: 傾 >= {th}秒 でNG")
        log(
            f"  SwitchBot: {'設定済み' if self.switchbot else '未設定'}"
            + (" (リハーサル: 操作スキップ)" if DRY_RUN else "")
        )
        log(f"  ポーリング間隔: {POLL_INTERVAL}秒")
        log("=" * 60)

        if not self.ik220.connect():
            log("エラー: IK220アプリに接続できません。起動しているか確認してください。")
            self.running = False
            return

        while self.running:
            log(f"\n--- 傾き値が全行揃うまで監視中... ---")

            tilt_values = self._wait_for_all_tilt_values()
            if tilt_values is None:
                break

            ng_rows = check_tilt_results(tilt_values)

            if not ng_rows:
                self.success_count += 1
                log(f"\n*** 全行OK！ 測定成功 ***")
                log(f"統計: 成功 {self.success_count}回, リトライ {self.retry_count}回")
                log("次の測定を待ちます... (監視OFFで停止)")
            else:
                self.retry_count += 1
                log(f"\n!!! {len(ng_rows)}行でNG検出 !!!")
                for name, val, th in ng_rows:
                    log(f"  {name}: 傾={val} >= 閾値{th}")
                log(f"リトライ #{self.retry_count} を実行...")

                log('Step 1: 「取込開始」ボタンをクリック...')
                if self.ik220.click_capture_button():
                    time.sleep(3)
                else:
                    log("警告: ボタンクリック失敗。手動で押してください。")
                    time.sleep(5)

                log("Step 2: SwitchBotでリモコン測定開始...")
                if self.switchbot:
                    time.sleep(1)
                    if not self.switchbot.press(SWITCHBOT_DEVICE_ID):
                        log("警告: SwitchBot操作失敗。手動で押してください。")
                else:
                    log("警告: SwitchBot未設定。手動でリモコンを押してください。")

                log("リトライ完了。再度傾き値を監視します。")

        log(f"\n監視終了: 成功 {self.success_count}回, リトライ {self.retry_count}回")

    def _wait_for_all_tilt_values(self):
        """全監視行の傾き値が揃うまでポーリング"""
        log(f"  監視対象: {', '.join(TARGET_ROWS)}")
        while self.running:
            tilt_values = self.ik220.read_tilt_values()
            if tilt_values:
                missing = [r for r in TARGET_ROWS if r not in tilt_values]
                if not missing:
                    log(f"  全行取得完了: {tilt_values}")
                    return tilt_values
                found = {k: v for k, v in tilt_values.items() if k in TARGET_ROWS}
                log(f"  取得中... {found} / 未取得: {missing}")
            else:
                log("  読み取り待ち...")
            time.sleep(POLL_INTERVAL)
        return None

    def stop(self):
        self.running = False
        log("監視停止中...")


# ============================================================
# GUI
# ============================================================
def run_gui():
    import tkinter as tk
    from tkinter import scrolledtext

    monitor = AutoRetryMonitor()
    thread = None

    root = tk.Tk()
    title = "IK220 自動監視モニター"
    if DRY_RUN:
        title += " [リハーサル]"
    root.title(title)
    root.geometry("750x550")
    root.configure(bg="#1e293b")

    # ヘッダー
    hdr = tk.Frame(root, bg="#1e293b", pady=10)
    hdr.pack(fill="x", padx=15)
    tk.Label(
        hdr, text=title, font=("", 16, "bold"), fg="white", bg="#1e293b"
    ).pack(side="left")

    # リハーサルモード表示
    if DRY_RUN:
        dry_frame = tk.Frame(root, bg="#f59e0b", pady=4, padx=15)
        dry_frame.pack(fill="x", padx=15, pady=(0, 5))
        tk.Label(
            dry_frame,
            text="リハーサル: 画面監視＋取込開始ボタンは実行 / SwitchBot操作のみスキップ",
            font=("", 9),
            fg="#1e293b",
            bg="#f59e0b",
        ).pack()

    # 閾値表示
    th_frame = tk.Frame(root, bg="#334155", pady=6, padx=15)
    th_frame.pack(fill="x", padx=15, pady=(0, 5))
    for name in TARGET_ROWS:
        th = TILT_THRESHOLDS.get(name, "?")
        color = "#f87171" if th <= 4 else "#fbbf24"
        tk.Label(
            th_frame,
            text=f"{name}: <{th}秒",
            font=("", 10, "bold"),
            fg=color,
            bg="#334155",
        ).pack(side="left", padx=10)

    # ステータス
    st_frame = tk.Frame(root, bg="#334155", pady=8, padx=15)
    st_frame.pack(fill="x", padx=15, pady=(0, 5))
    status_lbl = tk.Label(
        st_frame, text="停止中", font=("", 12, "bold"), fg="#94a3b8", bg="#334155"
    )
    status_lbl.pack(side="left")
    retry_lbl = tk.Label(
        st_frame,
        text="リトライ: 0 / 成功: 0",
        font=("", 10),
        fg="#94a3b8",
        bg="#334155",
    )
    retry_lbl.pack(side="right")

    # ログ
    log_area = scrolledtext.ScrolledText(
        root,
        height=18,
        bg="#0f172a",
        fg="#e2e8f0",
        font=("Consolas", 10),
        insertbackground="white",
    )
    log_area.pack(fill="both", expand=True, padx=15, pady=(0, 10))

    # ボタン
    btn_f = tk.Frame(root, bg="#1e293b", pady=10)
    btn_f.pack(fill="x", padx=15)

    def tick():
        if logger.entries:
            for e in logger.entries:
                log_area.insert("end", e + "\n")
                log_area.see("end")
            logger.entries.clear()
        retry_lbl.config(
            text=f"リトライ: {monitor.retry_count} / 成功: {monitor.success_count}"
        )
        root.after(500, tick)

    def on_start():
        nonlocal thread
        if not monitor.running:
            thread = threading.Thread(target=monitor.start, daemon=True)
            thread.start()
            status_lbl.config(text="監視中", fg="#4ade80")
            start_btn.config(state="disabled")
            stop_btn.config(state="normal")

    def on_stop():
        monitor.stop()
        status_lbl.config(text="停止中", fg="#94a3b8")
        start_btn.config(state="normal")
        stop_btn.config(state="disabled")

    def on_scan():
        log("UI要素をスキャン中...")
        threading.Thread(target=monitor.ik220.scan_controls, daemon=True).start()

    def on_test():
        log("SwitchBotテスト...")
        if monitor.switchbot:
            threading.Thread(
                target=monitor.switchbot.list_devices, daemon=True
            ).start()
        else:
            log("SwitchBot未設定")

    start_btn = tk.Button(
        btn_f,
        text="監視 ON",
        command=on_start,
        bg="#22c55e",
        fg="white",
        font=("", 12, "bold"),
        width=12,
        relief="flat",
    )
    start_btn.pack(side="left", padx=5)
    stop_btn = tk.Button(
        btn_f,
        text="監視 OFF",
        command=on_stop,
        bg="#ef4444",
        fg="white",
        font=("", 12, "bold"),
        width=12,
        relief="flat",
        state="disabled",
    )
    stop_btn.pack(side="left", padx=5)
    tk.Button(
        btn_f,
        text="UI要素スキャン",
        command=on_scan,
        bg="#8b5cf6",
        fg="white",
        font=("", 10),
        width=14,
        relief="flat",
    ).pack(side="right", padx=5)
    tk.Button(
        btn_f,
        text="SwitchBot テスト",
        command=on_test,
        bg="#3b82f6",
        fg="white",
        font=("", 10),
        width=14,
        relief="flat",
    ).pack(side="right", padx=5)

    tick()
    root.protocol("WM_DELETE_WINDOW", lambda: (on_stop(), root.destroy()))
    root.mainloop()


# ============================================================
# エントリーポイント
# ============================================================
if __name__ == "__main__":
    if "--dry-run" in sys.argv:
        DRY_RUN = True

    print("IK220 自動監視＆リトライツール")
    if DRY_RUN:
        print("*** リハーサルモード ***")
    print("=" * 40)

    if "--scan" in sys.argv:
        m = IK220Monitor()
        if m.connect():
            m.scan_controls()
    elif "--cli" in sys.argv:
        mon = AutoRetryMonitor()
        try:
            mon.start()
        except KeyboardInterrupt:
            mon.stop()
    elif "--list-devices" in sys.argv:
        SwitchBotAPI(SWITCHBOT_TOKEN, SWITCHBOT_SECRET).list_devices()
    elif "--test-press" in sys.argv:
        SwitchBotAPI(SWITCHBOT_TOKEN, SWITCHBOT_SECRET).press(SWITCHBOT_DEVICE_ID)
    else:
        run_gui()
