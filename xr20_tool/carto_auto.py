#!/usr/bin/env python3
"""
XR20 CARTO 自動操作スクリプト（pywinauto）
==========================================
CARTOの実際のUI要素を操作して、Rotaryテストの設定→測定→保存→データ取得を自動化する。

UI要素名はCARTOの実画面スクリーンショットから取得（2026/03/26確認）。
実際のコントロール名と異なる場合は、print_control_identifiers()で確認して修正すること。

必要ライブラリ:
    pip install pywinauto

使い方:
    python carto_auto.py --config config.json
    python carto_auto.py --wheel-targets 72 --overrun 10 --dwell 5
    python carto_auto.py --dump-controls   (UI要素名の一覧出力)

確認済みCARTO UI構造（スクリーンショットより）:
    ようこそ画面:
        新規 → ロータリアイコン（左下、オレンジ丸）
        開く → フォルダアイコン
    メイン画面（データ設定モード）:
        左サイドバー: デバイスモニタ（XL-80, XR20）
        左タブ: テスト情報 / 機械 / ターゲット / 装置 / パートプログラムの作成
        下部タブ: アライメント / データ設定 / データ取得
    ターゲットタブ:
        二方向（チェックボックス）
        シーケンスの種類: 位置決め（ドロップダウン）
        最初のターゲット / 最後のターゲット / 間隔（テキスト入力）
        実行あたりのターゲット数（読取専用）
        実行回数（テキスト入力）
        オーバーラン（テキスト入力）
        ターゲットの編集（ボタン）
    装置タブ:
        平均: なし / 短時間平均 / 長時間平均（ラジオ）
        トリガータイプ: 位置（ドロップダウン）
        公差 / 安定時間 / 安定範囲（テキスト入力）
        送り速度検出: 自動 / 手動 / 位置追跡（ボタン）
    パートプログラムの作成タブ:
        プログラムID / 送り速度 / ドウェル時間（テキスト入力）
        コントローラタイプ: Fanuc 30i（ドロップダウン）
        警告を含める（チェックボックス）
        作成 / パートプログラムの保存（ボタン）
    データ取得画面:
        上部: ▶(開始) ■(停止) 💾(保存) 📊
        ステータス: 「ターゲットに移動しています」「テストを完了しました」
    Explore画面:
        タイトルバー: 「CARTO - Explore」
        上部タブ: 位置グラフプロット / 生データ / 時間グラフプロット
        右上ボタン: コピー / テスト偏差の編集(✏️) / エクスポート / 印刷
"""

import argparse
import json
import os
import sys
import time
from datetime import datetime
from typing import Optional

if os.name != "nt":
    print("エラー: このスクリプトはWindows専用です。")
    print("CARTOはWindows上でのみ動作します。")
    sys.exit(1)

try:
    from pywinauto import Application, Desktop, timings
    from pywinauto.keyboard import send_keys
except ImportError:
    print("エラー: pywinauto がインストールされていません。")
    print("  pip install pywinauto")
    sys.exit(1)


# ============================================================
# ログ
# ============================================================
def log(msg: str):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")


def log_error(msg: str):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] ❌ {msg}")


def log_ok(msg: str):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] ✅ {msg}")


# ============================================================
# CARTO接続
# ============================================================
def connect_carto() -> Optional[Application]:
    """既に起動しているCARTOに接続する。見つからなければNone。"""
    try:
        app = Application(backend="uia").connect(title_re=".*CARTO.*", timeout=5)
        log_ok("CARTOに接続しました")
        return app
    except Exception:
        return None


def launch_carto(exe_path: str) -> Optional[Application]:
    """CARTOを起動する。"""
    if not os.path.exists(exe_path):
        log_error(f"CARTOが見つかりません: {exe_path}")
        return None

    log(f"CARTO起動中: {exe_path}")
    try:
        app = Application(backend="uia").start(exe_path)
        time.sleep(8)  # CARTO起動は遅い
        log_ok("CARTO起動完了")
        return app
    except Exception as e:
        log_error(f"CARTO起動失敗: {e}")
        return None


def get_or_launch_carto(exe_path: str) -> Application:
    """CARTOに接続、なければ起動。"""
    app = connect_carto()
    if app:
        return app

    app = launch_carto(exe_path)
    if app:
        return app

    log("CARTOを手動で起動してください。Enterで続行...")
    input()
    app = connect_carto()
    if not app:
        log_error("CARTOに接続できません。終了します。")
        sys.exit(1)
    return app


# ============================================================
# UI操作ヘルパー
# ============================================================
def safe_click(win, **kwargs):
    """
    UI要素を探してクリック。見つからなければエラーメッセージを出す。
    kwargs: pywinautoのchild_window引数（title, control_type, auto_id等）
    """
    try:
        ctrl = win.child_window(**kwargs)
        ctrl.wait("visible", timeout=10)
        ctrl.click_input()
        time.sleep(0.5)
        return True
    except Exception as e:
        log_error(f"UI要素が見つかりません: {kwargs} → {e}")
        log("  → print_control_identifiers()で実際の名前を確認してください")
        return False


def safe_set_text(win, value: str, **kwargs):
    """UI入力欄にテキストをセット。"""
    try:
        ctrl = win.child_window(**kwargs)
        ctrl.wait("visible", timeout=10)
        ctrl.click_input()
        time.sleep(0.2)
        send_keys("^a")  # 全選択
        time.sleep(0.1)
        send_keys(value, with_spaces=True)
        time.sleep(0.3)
        return True
    except Exception as e:
        log_error(f"テキスト入力失敗: {kwargs} → {e}")
        return False


# ============================================================
# CARTO操作: ようこそ画面 → ロータリテスト新規作成
# ============================================================
def select_rotary_test(app: Application):
    """ようこそ画面からロータリテストを選択。"""
    log("ロータリテスト選択中...")
    win = app.top_window()

    # ようこそ画面の「新規」セクションからロータリアイコンをクリック
    # 注意: 実際のコントロール名は要確認
    # スクリーンショットでは左下2段目の左アイコン（オレンジ丸+十字）
    if not safe_click(win, title="ロータリ", control_type="Button"):
        # 別名を試行
        if not safe_click(win, title="Rotary", control_type="Button"):
            log_error("ロータリテストの選択に失敗。手動で選択してください。")
            log("選択したらEnterで続行...")
            input()

    time.sleep(3)  # テスト画面の読み込み待ち
    log_ok("ロータリテスト画面に遷移")


# ============================================================
# CARTO操作: ターゲット設定
# ============================================================
def setup_targets(
    app: Application,
    first_target: float,
    last_target: float,
    interval: float,
    overrun: float,
    bidirectional: bool = True,
    runs: int = 1,
):
    """ターゲットタブの設定。"""
    log("ターゲット設定中...")
    win = app.top_window()

    # ターゲットタブをクリック
    safe_click(win, title="ターゲット", control_type="Button")
    time.sleep(1)

    # 二方向チェックボックス
    if bidirectional:
        try:
            cb = win.child_window(title="二方向", control_type="CheckBox")
            if not cb.get_toggle_state():
                cb.click_input()
                time.sleep(0.3)
        except Exception:
            log("「二方向」チェックボックスが見つかりません — 手動で確認してください")

    # 値を入力
    safe_set_text(win, f"{first_target:.5f}", title="最初のターゲット")
    safe_set_text(win, f"{last_target:.5f}", title="最後のターゲット")
    safe_set_text(win, f"{interval:.5f}", title="間隔")
    safe_set_text(win, str(runs), title="実行回数")
    safe_set_text(win, f"{overrun:.5f}", title="オーバーラン")

    log_ok(f"ターゲット設定完了: {first_target}°〜{last_target}° / 間隔{interval}° / オーバーラン{overrun}° / {runs}回")


# ============================================================
# CARTO操作: 装置タブ（トリガー設定）
# ============================================================
def setup_trigger(
    app: Application,
    tolerance: float = 0.25,
    stability_time: float = 1.0,
    stability_range: float = 0.001,
):
    """装置タブのトリガー設定。"""
    log("トリガー設定中...")
    win = app.top_window()

    # 装置タブをクリック
    safe_click(win, title="装置", control_type="Button")
    time.sleep(1)

    # トリガータイプを「位置」に設定（ドロップダウン）
    try:
        combo = win.child_window(title="トリガータイプ", control_type="ComboBox")
        combo.select("位置")
        time.sleep(0.3)
    except Exception:
        log("トリガータイプのドロップダウンが見つかりません — 「位置」が選択されているか手動で確認してください")

    # 公差・安定時間・安定範囲
    safe_set_text(win, f"{tolerance:.5f}", title="公差")
    safe_set_text(win, str(stability_time), title="安定時間")
    safe_set_text(win, f"{stability_range:.5f}", title="安定範囲")

    # 送り速度検出を「自動」に
    safe_click(win, title="自動", control_type="Button")

    log_ok(f"トリガー設定完了: 公差={tolerance} / 安定時間={stability_time}s / 安定範囲={stability_range}")


# ============================================================
# CARTO操作: テスト開始
# ============================================================
def start_test(app: Application):
    """データ取得タブに切り替えてテスト開始。"""
    log("テスト開始...")
    win = app.top_window()

    # データ取得タブをクリック
    safe_click(win, title="データ取得", control_type="Button")
    time.sleep(2)

    # テスト開始ボタン（▶）をクリック
    # 注意: 実際のコントロール名は要確認
    if not safe_click(win, title="テスト開始", control_type="Button"):
        if not safe_click(win, title="Start", control_type="Button"):
            # 緑三角ボタンを探す
            log("テスト開始ボタンが見つかりません。手動で「テスト開始」を押してください。")
            log("押したらEnterで続行...")
            input()

    time.sleep(3)  # キャリブレーションサイクル待ち
    log_ok("テスト開始しました")
    log("")
    log("=" * 50)
    log(">>> 機械コントローラの サイクルスタート を押してください <<<")
    log("=" * 50)
    log("")


# ============================================================
# CARTO操作: テスト完了待ち
# ============================================================
def wait_for_test_complete(app: Application, poll_interval: float = 2.0):
    """
    「テストを完了しました」テキストが表示されるまで待つ。
    CARTOのデータ取得画面右上にステータステキストが表示される。
    """
    log("測定完了を待機中...")

    while True:
        try:
            win = app.top_window()
            # ウィンドウ内のテキストを検索
            texts = win.texts()
            all_text = " ".join(str(t) for t in texts if t)

            if "テストを完了しました" in all_text or "Test complete" in all_text:
                log_ok("テスト完了を検知しました！")
                return True

            if "ターゲットに移動しています" in all_text:
                # 測定中 — 何もしない
                pass

        except Exception:
            pass  # CARTOが応答しない場合はリトライ

        time.sleep(poll_interval)


# ============================================================
# CARTO操作: テスト保存
# ============================================================
def save_test(app: Application):
    """テスト結果を保存。"""
    log("テスト結果を保存中...")
    win = app.top_window()

    # 保存ボタン（💾）をクリック
    if not safe_click(win, title="保存", control_type="Button"):
        if not safe_click(win, title="Save", control_type="Button"):
            # Ctrl+S を試行
            send_keys("^s")

    # 保存処理待ち（画面が暗くなって戻る）
    time.sleep(5)
    log_ok("保存完了")


# ============================================================
# CARTO操作: Explore起動 → データコピー
# ============================================================
def open_explore_and_copy_data(app: Application) -> Optional[str]:
    """
    Explore画面を開き、「テスト偏差の編集」からデータをコピー。
    """
    log("Explore起動中...")
    win = app.top_window()

    # 解析ボタンをクリック（Capture画面にある場合）
    if not safe_click(win, title="解析", control_type="Button"):
        if not safe_click(win, title="Explore", control_type="Button"):
            log("解析ボタンが見つかりません。手動でExploreを起動してください。")
            log("起動したらEnterで続行...")
            input()

    time.sleep(5)  # Explore起動待ち

    # Exploreウィンドウに接続
    try:
        explore_app = Application(backend="uia").connect(title_re=".*CARTO.*Explore.*", timeout=10)
        explore_win = explore_app.top_window()
    except Exception:
        log_error("Explore画面に接続できません")
        return None

    # 生データタブをクリック
    safe_click(explore_win, title="生データ", control_type="Button")
    time.sleep(2)

    # テスト偏差の編集ボタン（✏️）をクリック
    safe_click(explore_win, title="テスト偏差の編集", control_type="Button")
    time.sleep(2)

    # ダイアログが開いたら全データを選択してコピー
    try:
        dialog = explore_app.top_window()
        # テーブル全体を選択
        send_keys("^a")  # Ctrl+A
        time.sleep(0.5)
        send_keys("^c")  # Ctrl+C
        time.sleep(0.5)

        # クリップボードからデータ取得
        import subprocess
        result = subprocess.run(
            ["powershell", "-command", "Get-Clipboard"],
            capture_output=True, text=True, timeout=5
        )
        clipboard_data = result.stdout.strip()

        if clipboard_data:
            log_ok(f"データコピー成功（{len(clipboard_data)}文字）")
            # ダイアログを閉じる
            safe_click(dialog, title="キャンセル", control_type="Button")
            return clipboard_data
        else:
            log_error("クリップボードが空です")
            return None

    except Exception as e:
        log_error(f"データコピー失敗: {e}")
        return None


# ============================================================
# ホームに戻る
# ============================================================
def go_home(app: Application):
    """CARTOのホーム画面に戻る。"""
    log("ホーム画面に戻ります...")
    win = app.top_window()
    # ホームボタン（🏠）をクリック
    if not safe_click(win, title="ホーム", control_type="Button"):
        safe_click(win, title="Home", control_type="Button")
    time.sleep(2)


# ============================================================
# UI要素ダンプ（デバッグ用）
# ============================================================
def dump_controls(app: Application):
    """現在のウィンドウのUI要素一覧を出力。"""
    win = app.top_window()
    log(f"ウィンドウタイトル: {win.window_text()}")
    log("=" * 60)
    win.print_control_identifiers()


# ============================================================
# メイン処理
# ============================================================
def run_phase(
    app: Application,
    phase_name: str,
    first_target: float,
    last_target: float,
    interval: float,
    overrun: float,
    runs: int = 1,
    output_dir: str = "results",
) -> Optional[str]:
    """1フェーズ分の測定を実行し、データを返す。"""
    log("")
    log("=" * 60)
    log(f"フェーズ: {phase_name}")
    log(f"  ターゲット: {first_target}°〜{last_target}° / 間隔 {interval}°")
    log(f"  オーバーラン: {overrun}° / 実行回数: {runs}")
    log("=" * 60)

    # 1. ロータリテスト新規作成
    select_rotary_test(app)

    # 2. ターゲット設定
    setup_targets(app, first_target, last_target, interval, overrun, bidirectional=True, runs=runs)

    # 3. トリガー設定
    setup_trigger(app)

    # 4. テスト開始
    start_test(app)

    # 5. 測定完了待ち
    wait_for_test_complete(app)

    # 6. 保存
    save_test(app)

    # 7. Exploreでデータコピー
    data = open_explore_and_copy_data(app)

    # 8. データ保存
    if data:
        os.makedirs(output_dir, exist_ok=True)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"XR20_{phase_name}_{timestamp}.txt"
        filepath = os.path.join(output_dir, filename)
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(data)
        log_ok(f"データ保存: {filepath}")

    # 9. ホームに戻る
    go_home(app)

    return data


def main():
    parser = argparse.ArgumentParser(description="XR20 CARTO自動操作")
    parser.add_argument("--carto-exe", default=r"C:\Program Files\Renishaw\CARTO\CARTO.exe")
    parser.add_argument("--config", help="設定JSONファイル")
    parser.add_argument("--dump-controls", action="store_true", help="UI要素一覧を出力して終了")

    # ホイール
    parser.add_argument("--wheel-teeth", type=int, default=72, help="ホイール歯数")
    parser.add_argument("--overrun", type=float, default=10.0, help="オーバーラン角度")
    parser.add_argument("--dwell", type=float, default=5.0, help="ドウェル時間(秒)")

    # ウォーム
    parser.add_argument("--worm-starts", type=int, default=1, help="ウォーム条数")
    parser.add_argument("--worm-divisions", type=int, default=8, help="ウォーム等分数")

    # 再現性
    parser.add_argument("--repeat-positions", default="0,90,180,270", help="再現性測定位置(カンマ区切り)")
    parser.add_argument("--repeat-count", type=int, default=7, help="再現性繰り返し回数")

    # 出力
    parser.add_argument("--output-dir", default="results", help="結果保存先")

    args = parser.parse_args()

    # 設定ファイルから読み込み
    if args.config:
        with open(args.config, "r", encoding="utf-8") as f:
            config = json.load(f)
            for k, v in config.items():
                if hasattr(args, k):
                    setattr(args, k, v)

    # CARTO接続
    app = get_or_launch_carto(args.carto_exe)

    # UI要素ダンプモード
    if args.dump_controls:
        dump_controls(app)
        return

    log("=" * 60)
    log("XR20 CARTO自動操作")
    log(f"  ホイール: {args.wheel_teeth}等分")
    log(f"  ウォーム: 条数{args.worm_starts} / {args.worm_divisions}等分")
    log(f"  再現性: {args.repeat_positions} × {args.repeat_count}回")
    log("=" * 60)

    results = {}

    # --- フェーズ1: ホイール ---
    wheel_step = 360.0 / args.wheel_teeth
    data = run_phase(
        app,
        phase_name="wheel",
        first_target=0.0,
        last_target=360.0 - wheel_step,
        interval=wheel_step,
        overrun=args.overrun,
        runs=1,
        output_dir=args.output_dir,
    )
    if data:
        results["wheel"] = data

    # --- フェーズ2: ウォーム ---
    pitch = (360.0 / args.wheel_teeth) * args.worm_starts
    worm_step = pitch / args.worm_divisions
    data = run_phase(
        app,
        phase_name="worm",
        first_target=0.0,
        last_target=pitch - worm_step,
        interval=worm_step,
        overrun=args.overrun,
        runs=1,
        output_dir=args.output_dir,
    )
    if data:
        results["worm"] = data

    # --- フェーズ3: 再現性 ---
    # 再現性はCARTOの「ターゲットの編集」で個別位置を設定する必要がある
    # 等間隔ではないため、別の操作が必要
    positions = [float(p.strip()) for p in args.repeat_positions.split(",")]
    log("")
    log("=" * 60)
    log("フェーズ: 再現性")
    log(f"  位置: {positions}")
    log(f"  繰り返し: {args.repeat_count}回")
    log("=" * 60)
    log("")
    log("注意: 再現性測定はターゲットが等間隔でないため、")
    log("CARTOの「ターゲットの編集」で個別に角度を設定する必要があります。")
    log("")
    log("以下の手順で手動設定してください:")
    log(f"  1. ロータリテスト新規作成")
    log(f"  2. 「ターゲットの編集」ボタンをクリック")
    log(f"  3. ターゲット角度を入力: {positions}")
    log(f"  4. 実行回数: {args.repeat_count}")
    log(f"  5. オーバーラン: {args.overrun}")
    log(f"  6. テスト開始 → NC実行")
    log("")
    log("再現性テストの設定が完了したらEnterで続行...")
    input()

    # 再現性の測定完了待ち＆データ取得は自動
    wait_for_test_complete(app)
    save_test(app)
    data = open_explore_and_copy_data(app)
    if data:
        results["repeat"] = data
        os.makedirs(args.output_dir, exist_ok=True)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filepath = os.path.join(args.output_dir, f"XR20_repeat_{timestamp}.txt")
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(data)
        log_ok(f"データ保存: {filepath}")

    # --- 完了 ---
    log("")
    log("=" * 60)
    log("全フェーズ完了！")
    log("=" * 60)
    for phase, data in results.items():
        lines = data.strip().split("\n")
        log(f"  {phase}: {len(lines)}行")
    log("")
    log("結果データをWebアプリの「測定データ」タブに貼り付けて解析してください。")
    log(f"保存先: {os.path.abspath(args.output_dir)}")


if __name__ == "__main__":
    main()
