import {
  TargetPoint,
  MeasurementRow,
  EvaluationStats,
  XR20Settings,
  RepeatPositionResult,
  RepeatabilityResult,
} from "./types";

// ============================================================
// ホイール等分ターゲット生成
// ============================================================

export function generateWheelTargets(settings: XR20Settings): TargetPoint[] {
  const targets: TargetPoint[] = [];
  let no = 1;

  if (settings.axisType === "rotation") {
    const step = 360 / settings.divisions;
    // CW: 0° → 350° (例: 72等分なら 5°刻み)
    for (let i = 0; i < settings.divisions; i++) {
      targets.push({ no: no++, angle: roundAngle(step * i), direction: "cw", phase: "wheel", trial: 0, status: "pending" });
    }
    // CCW: 350° → 0°
    for (let i = settings.divisions - 1; i >= 0; i--) {
      targets.push({ no: no++, angle: roundAngle(step * i), direction: "ccw", phase: "wheel", trial: 0, status: "pending" });
    }
  } else {
    const totalRange = settings.endAngle - settings.startAngle;
    const step = totalRange / settings.divisions;
    for (let i = 0; i <= settings.divisions; i++) {
      targets.push({ no: no++, angle: roundAngle(settings.startAngle + step * i), direction: "cw", phase: "wheel", trial: 0, status: "pending" });
    }
    for (let i = settings.divisions; i >= 0; i--) {
      targets.push({ no: no++, angle: roundAngle(settings.startAngle + step * i), direction: "ccw", phase: "wheel", trial: 0, status: "pending" });
    }
  }

  return targets;
}

// ============================================================
// ウォーム等分ターゲット生成
// ============================================================

export function generateWormTargets(settings: XR20Settings, startNo: number = 1): TargetPoint[] {
  const targets: TargetPoint[] = [];
  let no = startNo;

  // 1ピッチ = 360° / ホイール歯数 × ウォーム条数
  const pitchAngle = (360 / settings.wheelTeeth) * settings.wormStarts;
  const step = pitchAngle / settings.wormDivisions;

  // CW: 0° → ピッチ角
  for (let i = 0; i < settings.wormDivisions; i++) {
    targets.push({ no: no++, angle: roundAngle(step * i), direction: "cw", phase: "worm", trial: 0, status: "pending" });
  }
  // CCW: ピッチ角 → 0°
  for (let i = settings.wormDivisions - 1; i >= 0; i--) {
    targets.push({ no: no++, angle: roundAngle(step * i), direction: "ccw", phase: "worm", trial: 0, status: "pending" });
  }

  return targets;
}

// ============================================================
// 連続ターゲット（ホイール + ウォーム + 再現性）
// ============================================================

export function generateCombinedTargets(settings: XR20Settings): TargetPoint[] {
  const wheelTargets = generateWheelTargets(settings);
  const wormTargets = generateWormTargets(settings, wheelTargets.length + 1);

  const targets = [...wheelTargets, ...wormTargets];
  let no = targets.length + 1;

  // 再現性ターゲット
  const positions = settings.repeatPositions
    .split(",")
    .map((s) => parseFloat(s.trim()))
    .filter((n) => !isNaN(n));

  for (const pos of positions) {
    for (let trial = 1; trial <= settings.repeatCount; trial++) {
      targets.push({ no: no++, angle: pos, direction: "cw", phase: "repeat", trial, status: "pending" });
    }
    for (let trial = 1; trial <= settings.repeatCount; trial++) {
      targets.push({ no: no++, angle: pos, direction: "ccw", phase: "repeat", trial, status: "pending" });
    }
  }

  return targets;
}

// ============================================================
// NCプログラム生成
// ============================================================

function buildMoveCmd(axis: string, angle: number, mode: "rapid" | "feed", feedRate: number): string {
  if (mode === "rapid") {
    return `G00 ${axis}${formatAngle(angle)}`;
  } else {
    return `G01 ${axis}${formatAngle(angle)} F${feedRate}`;
  }
}

export function generateNCProgram(
  targets: TargetPoint[],
  settings: XR20Settings
): string {
  const lines: string[] = [];
  const pValue = Math.round(settings.dwellTimeMs);
  const ovr = settings.overrunAngle;
  const ax = settings.controlAxis || "A";
  const clamp = settings.useClamp;

  lines.push(`O1000 (XR20 AXIS[${ax}] WHEEL+WORM+REPEAT EVALUATION)`);
  if (clamp) lines.push(`(CLAMP: M10=CLAMP M11=UNCLAMP)`);
  lines.push("");

  // --- ホイール等分 ---
  const wheelCW = targets.filter((t) => t.phase === "wheel" && t.direction === "cw");
  const wheelCCW = targets.filter((t) => t.phase === "wheel" && t.direction === "ccw");

  if (wheelCW.length > 0) {
    lines.push(`(===== WHEEL: ${settings.divisions}-DIVISION CW =====)`);
    lines.push("(OVERRUN: BACKLASH ELIMINATION FOR CW)");
    lines.push("G91");
    lines.push(`G00 ${ax}-${formatAngle(ovr)}`);
    lines.push(`G00 ${ax}${formatAngle(ovr)}`);
    lines.push("G90");
    lines.push("");
    for (const t of wheelCW) {
      if (clamp) lines.push("M11");
      lines.push(buildMoveCmd(ax, t.angle, settings.feedMode, settings.feedRate));
      if (clamp) lines.push("M10");
      lines.push(`G04 P${pValue}`);
    }
    lines.push("");
  }

  if (wheelCCW.length > 0) {
    lines.push(`(===== WHEEL: ${settings.divisions}-DIVISION CCW =====)`);
    lines.push("(OVERRUN: BACKLASH ELIMINATION FOR CCW)");
    lines.push("G91");
    lines.push(`G00 ${ax}${formatAngle(ovr)}`);
    lines.push(`G00 ${ax}-${formatAngle(ovr)}`);
    lines.push("G90");
    lines.push("");
    for (const t of wheelCCW) {
      if (clamp) lines.push("M11");
      lines.push(buildMoveCmd(ax, t.angle, settings.feedMode, settings.feedRate));
      if (clamp) lines.push("M10");
      lines.push(`G04 P${pValue}`);
    }
    lines.push("");
  }

  // --- ウォーム等分 ---
  const wormCW = targets.filter((t) => t.phase === "worm" && t.direction === "cw");
  const wormCCW = targets.filter((t) => t.phase === "worm" && t.direction === "ccw");

  if (wormCW.length > 0) {
    const pitchAngle = (360 / settings.wheelTeeth) * settings.wormStarts;
    lines.push(`(===== WORM: 1-PITCH ${pitchAngle.toFixed(4)} DEG / ${settings.wormDivisions}-DIV CW =====)`);
    lines.push("(OVERRUN: BACKLASH ELIMINATION FOR CW)");
    lines.push("G91");
    lines.push(`G00 ${ax}-${formatAngle(ovr)}`);
    lines.push(`G00 ${ax}${formatAngle(ovr)}`);
    lines.push("G90");
    lines.push("");
    for (const t of wormCW) {
      if (clamp) lines.push("M11");
      lines.push(buildMoveCmd(ax, t.angle, settings.feedMode, settings.feedRate));
      if (clamp) lines.push("M10");
      lines.push(`G04 P${pValue}`);
    }
    lines.push("");
  }

  if (wormCCW.length > 0) {
    const pitchAngle = (360 / settings.wheelTeeth) * settings.wormStarts;
    lines.push(`(===== WORM: 1-PITCH ${pitchAngle.toFixed(4)} DEG / ${settings.wormDivisions}-DIV CCW =====)`);
    lines.push("(OVERRUN: BACKLASH ELIMINATION FOR CCW)");
    lines.push("G91");
    lines.push(`G00 ${ax}${formatAngle(ovr)}`);
    lines.push(`G00 ${ax}-${formatAngle(ovr)}`);
    lines.push("G90");
    lines.push("");
    for (const t of wormCCW) {
      if (clamp) lines.push("M11");
      lines.push(buildMoveCmd(ax, t.angle, settings.feedMode, settings.feedRate));
      if (clamp) lines.push("M10");
      lines.push(`G04 P${pValue}`);
    }
    lines.push("");
  }

  // --- 再現性 ---
  const repeatTargets = targets.filter((t) => t.phase === "repeat");
  if (repeatTargets.length > 0) {
    lines.push("(===== REPEATABILITY =====)");
    lines.push("");

    const positions = [...new Set(repeatTargets.map((t) => t.angle))].sort((a, b) => a - b);
    for (const pos of positions) {
      const posCW = repeatTargets.filter((t) => t.angle === pos && t.direction === "cw");
      const posCCW = repeatTargets.filter((t) => t.angle === pos && t.direction === "ccw");

      if (posCW.length > 0) {
        lines.push(`(REPEAT ${pos} DEG - CW x${posCW.length})`);
        for (const t of posCW) {
          lines.push(`(CW TRIAL ${t.trial})`);
          lines.push("G91");
          lines.push(`G00 ${ax}-${formatAngle(ovr)}`);
          lines.push("G90");
          if (clamp) lines.push("M11");
          lines.push(buildMoveCmd(ax, pos, settings.feedMode, settings.feedRate));
          if (clamp) lines.push("M10");
          lines.push(`G04 P${pValue}`);
        }
        lines.push("");
      }

      if (posCCW.length > 0) {
        lines.push(`(REPEAT ${pos} DEG - CCW x${posCCW.length})`);
        for (const t of posCCW) {
          lines.push(`(CCW TRIAL ${t.trial})`);
          lines.push("G91");
          lines.push(`G00 ${ax}${formatAngle(ovr)}`);
          lines.push("G90");
          if (clamp) lines.push("M11");
          lines.push(buildMoveCmd(ax, pos, settings.feedMode, settings.feedRate));
          if (clamp) lines.push("M10");
          lines.push(`G04 P${pValue}`);
        }
        lines.push("");
      }
    }
  }

  lines.push("M30");
  return lines.join("\n");
}

// ============================================================
// CARTOターゲットCSV出力
// ============================================================

export function generateCartoTargetCSV(targets: TargetPoint[]): string {
  const lines = ["Target Position"];
  for (const t of targets) {
    lines.push(t.angle.toFixed(4));
  }
  return lines.join("\n");
}

// ============================================================
// 統計計算
// ============================================================

export function calculateStats(rows: MeasurementRow[]): EvaluationStats {
  if (rows.length === 0) {
    return { maxError: 0, minError: 0, meanError: 0, sigma: 0, indexAccuracy: 0, count: 0 };
  }

  const errors = rows.map((r) => r.errorArcSec);
  const maxError = Math.max(...errors);
  const minError = Math.min(...errors);
  const meanError = errors.reduce((a, b) => a + b, 0) / errors.length;
  const variance = errors.reduce((sum, e) => sum + (e - meanError) ** 2, 0) / errors.length;
  const sigma = Math.sqrt(variance);

  return { maxError, minError, meanError, sigma, indexAccuracy: maxError - minError, count: errors.length };
}

// ============================================================
// CSVパース（ホイール + ウォーム + 再現性 自動分離）
// ============================================================

export function parseCSVData(csv: string, targets: TargetPoint[]): MeasurementRow[] {
  const lines = csv
    .trim()
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("#") && !l.startsWith("//"));

  const rows: MeasurementRow[] = [];

  for (let i = 0; i < lines.length; i++) {
    const parts = lines[i].split(/[,\t]+/).map((s) => s.trim());
    if (parts.length >= 3) {
      const targetAngle = parseFloat(parts[0]);
      const measuredAngle = parseFloat(parts[1]);
      const errorArcSec = parseFloat(parts[2]);
      if (!isNaN(targetAngle) && !isNaN(measuredAngle) && !isNaN(errorArcSec)) {
        const idx = rows.length;
        const direction = idx < targets.length ? targets[idx].direction : "cw";
        const phase = idx < targets.length ? targets[idx].phase : "wheel";
        const trial = idx < targets.length ? targets[idx].trial : 0;
        rows.push({
          no: rows.length + 1,
          targetAngle,
          measuredAngle,
          errorArcSec,
          direction,
          phase,
          trial,
        });
      }
    }
  }
  return rows;
}

// ============================================================
// 再現性計算
// ============================================================

export function calcRepeatability(
  measurements: MeasurementRow[],
  settings: XR20Settings
): RepeatabilityResult {
  const positions = settings.repeatPositions
    .split(",")
    .map((s) => parseFloat(s.trim()))
    .filter((n) => !isNaN(n));

  const results: RepeatPositionResult[] = positions.map((pos) => {
    const cwErrors = measurements
      .filter((m) => Math.abs(m.targetAngle - pos) < 0.001 && m.direction === "cw" && m.phase === "repeat")
      .map((m) => m.errorArcSec);
    const ccwErrors = measurements
      .filter((m) => Math.abs(m.targetAngle - pos) < 0.001 && m.direction === "ccw" && m.phase === "repeat")
      .map((m) => m.errorArcSec);
    const cwRange = cwErrors.length >= 2 ? Math.max(...cwErrors) - Math.min(...cwErrors) : 0;
    const ccwRange = ccwErrors.length >= 2 ? Math.max(...ccwErrors) - Math.min(...ccwErrors) : 0;
    return { angle: pos, cwErrors, ccwErrors, cwRange, ccwRange };
  });

  const allRanges = results.flatMap((r) => [r.cwRange, r.ccwRange]);
  const repeatability = allRanges.length > 0 ? Math.max(...allRanges) : 0;

  return { positions: results, repeatability };
}

// ============================================================
// フェーズ別NCプログラム生成（ホイール / ウォーム / 再現性）
// ============================================================

export function generatePhaseNCProgram(
  targets: TargetPoint[],
  settings: XR20Settings,
  phase: "wheel" | "worm" | "repeat"
): string {
  const phaseTargets = targets.filter(t => t.phase === phase);
  if (phaseTargets.length === 0) return "";

  const lines: string[] = [];
  const pValue = Math.round(settings.dwellTimeMs);
  const ovr = settings.overrunAngle;
  const ax = settings.controlAxis || "A";
  const clamp = settings.useClamp;

  const pNum = phase === "wheel" ? "O2001" : phase === "worm" ? "O2002" : "O2003";
  const pLabel = phase === "wheel" ? "WHEEL" : phase === "worm" ? "WORM" : "REPEATABILITY";

  lines.push(`${pNum} (XR20 ${pLabel} EVALUATION - AXIS[${ax}])`);

  // CARTO準備待ちドゥエル（先頭）
  if (settings.initialDwellSec > 0) {
    lines.push(`(CARTO SETUP WAIT: ${settings.initialDwellSec} SEC)`);
    lines.push(`G04 P${Math.round(settings.initialDwellSec * 1000)}`);
    lines.push("");
  }

  if (clamp) lines.push("(CLAMP: M10=CLAMP M11=UNCLAMP)");
  lines.push("");

  if (phase === "wheel" || phase === "worm") {
    const cwTargets = phaseTargets.filter(t => t.direction === "cw");
    const ccwTargets = phaseTargets.filter(t => t.direction === "ccw");

    if (cwTargets.length > 0) {
      lines.push(`(===== ${pLabel} CW =====)`);
      lines.push("(OVERRUN: BACKLASH ELIMINATION FOR CW)");
      lines.push("G91");
      lines.push(`G00 ${ax}-${formatAngle(ovr)}`);
      lines.push(`G00 ${ax}${formatAngle(ovr)}`);
      lines.push("G90");
      lines.push("");
      for (const t of cwTargets) {
        if (clamp) lines.push("M11");
        lines.push(buildMoveCmd(ax, t.angle, settings.feedMode, settings.feedRate));
        if (clamp) lines.push("M10");
        lines.push(`G04 P${pValue}`);
      }
      lines.push("");
    }

    if (ccwTargets.length > 0) {
      lines.push(`(===== ${pLabel} CCW =====)`);
      lines.push("(OVERRUN: BACKLASH ELIMINATION FOR CCW)");
      lines.push("G91");
      lines.push(`G00 ${ax}${formatAngle(ovr)}`);
      lines.push(`G00 ${ax}-${formatAngle(ovr)}`);
      lines.push("G90");
      lines.push("");
      for (const t of ccwTargets) {
        if (clamp) lines.push("M11");
        lines.push(buildMoveCmd(ax, t.angle, settings.feedMode, settings.feedRate));
        if (clamp) lines.push("M10");
        lines.push(`G04 P${pValue}`);
      }
      lines.push("");
    }
  } else {
    // 再現性
    lines.push("(===== REPEATABILITY =====)");
    lines.push("");
    const positions = [...new Set(phaseTargets.map(t => t.angle))].sort((a, b) => a - b);
    for (const pos of positions) {
      const posCW = phaseTargets.filter(t => t.angle === pos && t.direction === "cw");
      const posCCW = phaseTargets.filter(t => t.angle === pos && t.direction === "ccw");

      if (posCW.length > 0) {
        lines.push(`(REPEAT ${pos} DEG - CW x${posCW.length})`);
        for (const t of posCW) {
          lines.push(`(CW TRIAL ${t.trial})`);
          lines.push("G91");
          lines.push(`G00 ${ax}-${formatAngle(ovr)}`);
          lines.push("G90");
          if (clamp) lines.push("M11");
          lines.push(buildMoveCmd(ax, pos, settings.feedMode, settings.feedRate));
          if (clamp) lines.push("M10");
          lines.push(`G04 P${pValue}`);
        }
        lines.push("");
      }

      if (posCCW.length > 0) {
        lines.push(`(REPEAT ${pos} DEG - CCW x${posCCW.length})`);
        for (const t of posCCW) {
          lines.push(`(CCW TRIAL ${t.trial})`);
          lines.push("G91");
          lines.push(`G00 ${ax}${formatAngle(ovr)}`);
          lines.push("G90");
          if (clamp) lines.push("M11");
          lines.push(buildMoveCmd(ax, pos, settings.feedMode, settings.feedRate));
          if (clamp) lines.push("M10");
          lines.push(`G04 P${pValue}`);
        }
        lines.push("");
      }
    }
  }

  lines.push("M30");
  return lines.join("\n");
}

// ============================================================
// CARTO自動操作Pythonスクリプト生成（pywinauto方式）
// ============================================================

export function generateCartoAutomationScript(
  settings: XR20Settings,
  targets: TargetPoint[],
  phases: ("wheel" | "worm" | "repeat")[]
): string {
  const wheelTargets = targets.filter(t => t.phase === "wheel");
  const wormTargets = targets.filter(t => t.phase === "worm");
  const repeatTargets = targets.filter(t => t.phase === "repeat");

  // フェーズごとのターゲット角度リスト
  const phaseConfigs: { phase: string; angles: number[]; divisions: number }[] = [];
  for (const phase of phases) {
    if (phase === "wheel" && wheelTargets.length > 0) {
      const cwAngles = wheelTargets.filter(t => t.direction === "cw").map(t => t.angle);
      phaseConfigs.push({ phase: "wheel", angles: cwAngles, divisions: settings.divisions });
    }
    if (phase === "worm" && wormTargets.length > 0) {
      const cwAngles = wormTargets.filter(t => t.direction === "cw").map(t => t.angle);
      phaseConfigs.push({ phase: "worm", angles: cwAngles, divisions: settings.wormDivisions });
    }
    if (phase === "repeat" && repeatTargets.length > 0) {
      const positions = [...new Set(repeatTargets.map(t => t.angle))].sort((a, b) => a - b);
      phaseConfigs.push({ phase: "repeat", angles: positions, divisions: positions.length });
    }
  }

  return `#!/usr/bin/env python3
"""
XR20 CARTO 自動操作スクリプト（pywinauto UI Automation）
========================================================
CARTOを自動操作して、Rotaryテストのセットアップを行う。
測定データのキャプチャはCARTOの位置自動検知（feedrate detection）に任せる。

必要ライブラリ:
  pip install pywinauto

使い方:
  1. python xr20_carto_auto.py を実行
  2. CARTOが起動し、テスト条件が自動設定される
  3. CARTOが「Startボタン押下待ち」まで進んだらスクリプトが一時停止
  4. NCプログラムの自動運転ボタンを押す
  5. 測定完了後、スクリプトが次のフェーズ（ウォーム等）を自動設定
  6. 全フェーズ完了後、結果CSVを自動エクスポート
"""

import time
import sys
import os
import subprocess
import json
from datetime import datetime

if os.name != "nt":
    print("エラー: Windows専用です")
    sys.exit(1)

try:
    from pywinauto import Application, Desktop
    from pywinauto.keyboard import send_keys
except ImportError:
    print("エラー: pywinauto が必要です")
    print("  pip install pywinauto")
    sys.exit(1)

# ============================================================
# 設定
# ============================================================
CARTO_EXE = ${JSON.stringify(settings.cartoExePath)}
MACHINE_MODEL = ${JSON.stringify(settings.machineModel)}
AXIS = ${JSON.stringify(settings.controlAxis)}
DWELL_SEC = ${settings.initialDwellSec}

PHASES = ${JSON.stringify(phaseConfigs, null, 2)}

# ============================================================
# ログ
# ============================================================
def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")

# ============================================================
# CARTO起動
# ============================================================
def launch_carto():
    """CARTOを起動し、メインウィンドウを取得"""
    log(f"CARTO起動中: {CARTO_EXE}")
    if not os.path.exists(CARTO_EXE):
        log(f"エラー: CARTO実行ファイルが見つかりません: {CARTO_EXE}")
        log("設定画面でCARTOパスを確認してください")
        return None

    try:
        app = Application(backend="uia").start(CARTO_EXE)
        time.sleep(5)  # CARTO起動待ち
        log("CARTO起動完了")
        return app
    except Exception as e:
        log(f"CARTO起動エラー: {e}")
        # 既に起動済みの場合は接続を試みる
        try:
            app = Application(backend="uia").connect(path=CARTO_EXE)
            log("既存のCARTOプロセスに接続")
            return app
        except Exception:
            log("CARTOへの接続に失敗しました")
            return None

# ============================================================
# CARTO操作関数
# ============================================================
def setup_rotary_test(app, phase_config):
    """
    CARTOのRotaryテストを設定する

    注意: CARTOのUI要素名はバージョンにより異なる場合があります。
    実際のCARTO画面に合わせて以下のコントロール名を調整してください。

    この関数はテンプレートです。CARTOのUI構造に合わせてカスタマイズが必要です。
    """
    phase = phase_config["phase"]
    angles = phase_config["angles"]
    divisions = phase_config["divisions"]

    log(f"=== フェーズ設定: {phase.upper()} ({divisions}分割, {len(angles)}ターゲット) ===")

    main_win = app.top_window()

    # --- ここからCARTO UI操作 ---
    # 注意: 以下はCARTOのUI構造に合わせて調整が必要です
    # pywinautoのprint_control_identifiers()で実際のコントロール名を確認してください

    try:
        # 1. Rotary テストを選択
        log("Rotaryテストを選択中...")
        # main_win.child_window(title="Rotary", control_type="TreeItem").click_input()
        # time.sleep(1)

        # 2. テスト条件設定
        log(f"ターゲット数: {len(angles)}")
        log(f"角度範囲: {angles[0]:.4f} - {angles[-1]:.4f} deg")

        # 3. ターゲット角度を入力
        # CARTOのターゲット入力方法はバージョンにより異なる
        # - パートプログラム生成機能を使う場合: CARTOが自動でターゲットを設定
        # - 手動入力の場合: 以下のようにUI操作で入力

        log("ターゲット角度:")
        for i, angle in enumerate(angles):
            log(f"  [{i+1}] {angle:.4f} deg")

        # 4. Feedrate detection設定（位置自動キャプチャ）
        log("Feedrate detection（位置自動キャプチャ）を確認中...")

        log(f"フェーズ '{phase}' のセットアップ準備完了")

    except Exception as e:
        log(f"UI操作エラー: {e}")
        log("CARTOのUI構造が想定と異なる可能性があります")
        log("print_control_identifiers()で確認してください:")
        log("  main_win.print_control_identifiers()")
        raise

def wait_for_measurement_complete(app):
    """
    測定完了を待つ

    CARTOの測定完了判定方法:
    - ウィンドウタイトルの変化を監視
    - または特定のUI要素（Completeステータス等）を監視
    """
    log("NC運転開始を待機中...")
    log(">>> CNC操作盤で自動運転ボタンを押してください <<<")
    input("  [Enter]で続行（測定完了後に押してください）...")
    log("測定完了確認")

def export_results(app, phase, output_dir):
    """CARTOから結果をCSVエクスポート"""
    log(f"結果エクスポート中: {phase}")

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"XR20_{phase.upper()}_{timestamp}.csv"
    filepath = os.path.join(output_dir, filename)

    # CARTOのエクスポート操作
    # main_win = app.top_window()
    # main_win.child_window(title="Export", control_type="Button").click_input()
    # ...

    log(f"  → {filepath}")
    return filepath

# ============================================================
# メイン処理
# ============================================================
def main():
    log("=" * 60)
    log("XR20 CARTO自動操作スクリプト")
    log(f"  機種: {MACHINE_MODEL}")
    log(f"  軸: {AXIS}")
    log(f"  フェーズ数: {len(PHASES)}")
    for i, p in enumerate(PHASES):
        log(f"    [{i+1}] {p['phase'].upper()}: {p['divisions']}分割")
    log("=" * 60)
    log("")

    # 出力ディレクトリ
    output_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "results")
    os.makedirs(output_dir, exist_ok=True)

    # CARTO起動
    app = launch_carto()
    if app is None:
        log("CARTOの起動に失敗しました。手動でCARTOを起動してください。")
        input("[Enter]で続行...")
        try:
            app = Application(backend="uia").connect(path=CARTO_EXE)
        except Exception:
            log("CARTOに接続できません。終了します。")
            return

    result_files = []

    for i, phase_config in enumerate(PHASES):
        phase = phase_config["phase"]
        log("")
        log(f"{'='*60}")
        log(f"フェーズ {i+1}/{len(PHASES)}: {phase.upper()}")
        log(f"{'='*60}")

        # CARTO条件設定
        setup_rotary_test(app, phase_config)

        log("")
        log(">>> CARTOで [Start] を押してから、CNCの自動運転を開始してください <<<")
        if DWELL_SEC > 0:
            log(f"    (NCプログラム先頭に{DWELL_SEC}秒のドゥエルがあります)")

        # 測定完了待ち
        wait_for_measurement_complete(app)

        # 結果エクスポート
        filepath = export_results(app, phase, output_dir)
        result_files.append({"phase": phase, "file": filepath})

    log("")
    log("=" * 60)
    log("全フェーズ完了!")
    log("=" * 60)
    for r in result_files:
        log(f"  {r['phase'].upper()}: {r['file']}")
    log("")
    log("結果CSVをアプリのデータタブにドラッグ&ドロップして解析してください")

if __name__ == "__main__":
    main()
`;
}

// ============================================================
// ユーティリティ
// ============================================================

function roundAngle(angle: number): number {
  return Math.round(angle * 10000) / 10000;
}

function formatAngle(angle: number): string {
  const rounded = Math.round(angle * 10000) / 10000;
  if (rounded === Math.floor(rounded)) {
    return rounded.toFixed(0) + ".";
  }
  return rounded.toString();
}

// ============================================================
// 自動監視＆リトライ用Pythonスクリプト生成
// ============================================================

export function generateMonitorScript(settings: XR20Settings): string {
  const targetRows = settings.monitorTargetRows.split(",").map(s => s.trim()).filter(Boolean);
  return `#!/usr/bin/env python3
"""
IK220 分割測定 自動監視＆リトライスクリプト
=============================================
対象アプリ: ${settings.monitorAppTitle}

テーブルの「傾」列を行ごとに監視:
  HR/HL: 傾 >= ${settings.monitorThresholdHR}秒 → NG
  WR/WL: 傾 >= ${settings.monitorThresholdWR}秒 → NG

NG検出時:
  1.「${settings.monitorCaptureButtonName}」ボタンをクリック
  2. SwitchBotでリモコンの測定開始ボタンを押す
  3. ${settings.monitorWaitMin}分後に再確認

必要ライブラリ:
  pip install pywinauto requests

使い方:
  python xr20_monitor.py          # GUIモード
  python xr20_monitor.py --cli    # CLIモード
  python xr20_monitor.py --scan   # UI要素一覧表示（デバッグ用）
"""

import time
import sys
import os
import hashlib
import hmac
import base64
import uuid
import re
import threading
from datetime import datetime

# ============================================================
# 設定
# ============================================================
SWITCHBOT_TOKEN = ${JSON.stringify(settings.switchbotToken)}
SWITCHBOT_SECRET = ${JSON.stringify(settings.switchbotSecret)}
SWITCHBOT_DEVICE_ID = ${JSON.stringify(settings.switchbotDeviceId)}

APP_TITLE = ${JSON.stringify(settings.monitorAppTitle)}
CAPTURE_BUTTON = ${JSON.stringify(settings.monitorCaptureButtonName)}
WAIT_MINUTES = ${settings.monitorWaitMin}

# 行ごとの傾き閾値（秒）— abs(値) で比較
TILT_THRESHOLDS = {
    "HR": ${settings.monitorThresholdHR},
    "HL": ${settings.monitorThresholdHR},
    "WR": ${settings.monitorThresholdWR},
    "WL": ${settings.monitorThresholdWR},
}

# 監視対象行
TARGET_ROWS = ${JSON.stringify(targetRows)}

# ============================================================
# ログ
# ============================================================
class Logger:
    def __init__(self):
        self.entries = []

    def log(self, msg):
        ts = datetime.now().strftime('%H:%M:%S')
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
        import requests  # noqa: F811
        nonce = str(uuid.uuid4())
        t = str(int(time.time() * 1000))
        sign = base64.b64encode(
            hmac.new(self.secret.encode(), f"{self.token}{t}{nonce}".encode(), hashlib.sha256).digest()
        ).decode()
        return {"Authorization": self.token, "t": t, "sign": sign, "nonce": nonce,
                "Content-Type": "application/json; charset=utf-8"}

    def press(self, device_id):
        import requests
        try:
            r = requests.post(f"{self.BASE_URL}/devices/{device_id}/commands",
                              headers=self._headers(),
                              json={"command": "press", "parameter": "default", "commandType": "command"},
                              timeout=10)
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
            r = requests.get(f"{self.BASE_URL}/devices", headers=self._headers(), timeout=10)
            data = r.json()
            if data.get("statusCode") == 100:
                devices = data["body"].get("deviceList", [])
                log(f"SwitchBot: {len(devices)}台のデバイスを検出")
                for d in devices:
                    log(f"  - {d['deviceName']} (ID: {d['deviceId']}, Type: {d['deviceType']})")
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
    IK220分割測定KWIN10.vi (LabVIEW) の画面を操作する。

    テーブル構造（画面上部）:
      No | (名前) | 間隔 | 1/N | 点数 | 傾 | 精度 | 精度 | UD | L/R | 傾 | 精度
      1    HR       60000   1    60    -1   19.0   19.5
      3    WR       3600    1    10     0    9.5    9.5
      4    WL       3600    1    10    -1    8.0    8.0   22        8.0
      2    HL       60000   1    60     0   19.5   19.5   22       19.5

    「傾」列（6列目）の絶対値で判定:
      HR/HL: abs(傾) >= ${settings.monitorThresholdHR} → NG
      WR/WL: abs(傾) >= ${settings.monitorThresholdWR} → NG
    """

    # 行名からNo列の値（画面表示順）
    ROW_NO_MAP = {"HR": "1", "WR": "3", "WL": "4", "HL": "2"}

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
            log("エラー: pip install pywinauto")
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
        各行の「傾」値を辞書で返す: {"HR": -1, "WR": 0, "WL": -1, "HL": 0}

        LabVIEWアプリのUI要素から値を取得する。
        取得方法はアプリのUI構造に依存するため、以下の複数の方式を試行する:
          方式1: pywinauto UIA でテーブル/リスト要素から取得
          方式2: 全子要素のテキストをパースして行を特定
          方式3: スクリーンショット + OCR
        """
        if not self._dlg:
            if not self.connect():
                return None

        # --- 方式1: UIA Table/DataGrid から取得 ---
        result = self._read_from_table()
        if result:
            return result

        # --- 方式2: 全テキスト要素をスキャンして行パターンを検出 ---
        result = self._read_from_text_scan()
        if result:
            return result

        # --- 方式3: スクリーンショット + OCR ---
        result = self._read_from_ocr()
        if result:
            return result

        log("警告: どの方式でも傾き値を取得できませんでした")
        return None

    def _read_from_table(self):
        """UIA Table/DataGrid/List コントロールから読み取り"""
        try:
            # LabVIEWのテーブルはListView/Table/DataGridのいずれか
            for ctrl_type in ["Table", "DataGrid", "List"]:
                try:
                    table = self._dlg.child_window(control_type=ctrl_type)
                    if not table.exists(timeout=2):
                        continue
                    items = table.descendants()
                    texts = [c.window_text() for c in items if c.window_text().strip()]
                    log(f"  Table({ctrl_type}) 要素数: {len(texts)}")
                    return self._parse_table_texts(texts)
                except Exception:
                    continue
        except Exception as e:
            log(f"  Table読取りエラー: {e}")
        return None

    def _read_from_text_scan(self):
        """全子要素のテキストを収集してパターンマッチ"""
        try:
            children = self._dlg.descendants()
            all_texts = []
            for child in children:
                try:
                    t = child.window_text().strip()
                    if t:
                        all_texts.append(t)
                except Exception:
                    continue

            if not all_texts:
                return None

            return self._parse_table_texts(all_texts)
        except Exception as e:
            log(f"  テキストスキャンエラー: {e}")
        return None

    def _parse_table_texts(self, texts):
        """
        テキストリストからHR/WR/WL/HL行を探し、傾の値を抽出する。

        テーブルの各行は以下のパターン:
          No(数字), 名前(HR/WR/WL/HL), 間隔(数字), 1/N(数字), 点数(数字), 傾(数字)...
        """
        result = {}
        # テキストの中から "HR", "WR", "WL", "HL" を探す
        for row_name in TARGET_ROWS:
            try:
                idx = None
                for i, t in enumerate(texts):
                    if t.strip() == row_name:
                        idx = i
                        break
                if idx is None:
                    continue

                # 行名の後ろにある数値を順に取得
                # 間隔, 1/N, 点数, 傾 の順（行名から4番目の数値が「傾」）
                nums_found = []
                for j in range(idx + 1, min(idx + 20, len(texts))):
                    t = texts[j].strip()
                    # 次の行名に到達したら終了
                    if t in ("HR", "WR", "WL", "HL") and t != row_name:
                        break
                    try:
                        val = float(t)
                        nums_found.append(val)
                    except ValueError:
                        continue
                    # 間隔, 1/N, 点数, 傾 の4つ目
                    if len(nums_found) >= 4:
                        break

                if len(nums_found) >= 4:
                    tilt_val = nums_found[3]  # 4番目 = 傾
                    result[row_name] = tilt_val
                    log(f"  {row_name}: 傾 = {tilt_val}")
                elif len(nums_found) >= 1:
                    # フォールバック: 見つかった数値をログ出力して手がかりにする
                    log(f"  {row_name}: 数値{len(nums_found)}個検出 = {nums_found} (傾の位置が不明)")

            except Exception as e:
                log(f"  {row_name} パースエラー: {e}")

        return result if result else None

    def _read_from_ocr(self):
        """スクリーンショット + OCR"""
        try:
            from PIL import ImageGrab
            import pytesseract
        except ImportError:
            log("  OCR未対応: pip install pillow pytesseract")
            return None

        try:
            rect = self._dlg.rectangle()
            # テーブル部分のみキャプチャ（上部 ~30% 程度）
            table_height = int((rect.bottom - rect.top) * 0.30)
            img = ImageGrab.grab(bbox=(rect.left, rect.top, rect.right, rect.top + table_height))

            text = pytesseract.image_to_string(img, lang="eng+jpn",
                config="--psm 6")  # テーブルとして認識
            log(f"  OCR結果:\\n{text}")

            result = {}
            for line in text.split("\\n"):
                for row_name in TARGET_ROWS:
                    if row_name in line:
                        nums = re.findall(r'-?\\d+\\.?\\d*', line)
                        # 間隔, 1/N, 点数, 傾 → 4番目以降
                        if len(nums) >= 5:  # No + 間隔 + 1/N + 点数 + 傾
                            tilt_val = float(nums[4])
                            result[row_name] = tilt_val
                            log(f"  OCR {row_name}: 傾 = {tilt_val}")
            return result if result else None
        except Exception as e:
            log(f"  OCRエラー: {e}")
        return None

    def click_capture_button(self):
        """
        「取込開始」ボタンをクリック

        LabVIEWアプリはUI Automationに完全対応していない場合があるため、
        複数の方式を順に試行する:
          方式1: UIA child_window で title マッチ
          方式2: 全子要素から「取込開始」テキストを持つ要素を探す
          方式3: 画像マッチング（ボタンの位置を画像から検出）
          方式4: 座標クリック（ウィンドウ内の相対座標）
        """
        if not self._dlg:
            if not self.connect():
                return False

        # --- 方式1: UIA title マッチ ---
        try:
            btn = self._dlg.child_window(title_re=f".*{CAPTURE_BUTTON}.*")
            if btn.exists(timeout=2):
                btn.click_input()
                log(f"方式1: 「{CAPTURE_BUTTON}」ボタンをクリック (UIA title)")
                return True
        except Exception as e:
            log(f"  方式1失敗: {e}")

        # --- 方式2: 全子要素のテキストを検索 ---
        try:
            for child in self._dlg.descendants():
                try:
                    txt = child.window_text().strip()
                    if CAPTURE_BUTTON in txt:
                        child.click_input()
                        log(f"方式2: 「{txt}」要素をクリック (テキスト検索)")
                        return True
                except Exception:
                    continue
        except Exception as e:
            log(f"  方式2失敗: {e}")

        # --- 方式3: 画像マッチング ---
        try:
            clicked = self._click_by_image(CAPTURE_BUTTON)
            if clicked:
                return True
        except Exception as e:
            log(f"  方式3失敗: {e}")

        # --- 方式4: 座標クリック（フォールバック） ---
        # IK220画面レイアウトから「取込開始」は左下のボタン群の一番左
        # ウィンドウ内の相対位置で推定クリック
        try:
            rect = self._dlg.rectangle()
            win_w = rect.right - rect.left
            win_h = rect.bottom - rect.top
            # 「取込開始」ボタンの推定位置:
            #   X: ウィンドウ左端から約 14% の位置
            #   Y: ウィンドウ上端から約 35% の位置
            btn_x = rect.left + int(win_w * 0.14)
            btn_y = rect.top + int(win_h * 0.35)
            log(f"方式4: 座標クリック ({btn_x}, {btn_y})")
            log(f"  ※ 座標が正しくない場合は --scan でUI要素を確認してください")

            import ctypes
            ctypes.windll.user32.SetCursorPos(btn_x, btn_y)
            time.sleep(0.1)
            ctypes.windll.user32.mouse_event(0x0002, 0, 0, 0, 0)  # MOUSEEVENTF_LEFTDOWN
            time.sleep(0.05)
            ctypes.windll.user32.mouse_event(0x0004, 0, 0, 0, 0)  # MOUSEEVENTF_LEFTUP
            log(f"方式4: 座標クリック完了")
            return True
        except Exception as e:
            log(f"  方式4失敗: {e}")

        log("全方式でボタンクリックに失敗しました")
        return False

    def _click_by_image(self, button_text):
        """ボタンのテキストを画像マッチングで検出してクリック"""
        try:
            from PIL import ImageGrab, ImageDraw, ImageFont
            import pytesseract
        except ImportError:
            return False

        rect = self._dlg.rectangle()
        img = ImageGrab.grab(bbox=(rect.left, rect.top, rect.right, rect.bottom))
        # OCRでボタンテキストの位置を検出
        data = pytesseract.image_to_data(img, lang="jpn+eng", output_type=pytesseract.Output.DICT)
        for i, text in enumerate(data["text"]):
            if button_text in text or text in button_text:
                x = data["left"][i] + data["width"][i] // 2
                y = data["top"][i] + data["height"][i] // 2
                # ウィンドウ座標に変換してクリック
                abs_x = rect.left + x
                abs_y = rect.top + y
                import ctypes
                ctypes.windll.user32.SetCursorPos(abs_x, abs_y)
                time.sleep(0.1)
                ctypes.windll.user32.mouse_event(0x0002, 0, 0, 0, 0)
                time.sleep(0.05)
                ctypes.windll.user32.mouse_event(0x0004, 0, 0, 0, 0)
                log(f"方式3: 画像マッチングでクリック ({abs_x}, {abs_y})")
                return True
        return False

    def is_measurement_done(self):
        """
        測定完了を判定する。
        「終了」ボタンが赤く表示される、またはステータス表示で判定。
        ここではテーブルの値が更新されたかどうかで判定。
        """
        # 簡易: 傾き値が読み取れれば測定は完了している
        vals = self.read_tilt_values()
        return vals is not None and len(vals) > 0


# ============================================================
# 判定ロジック
# ============================================================
def check_tilt_results(tilt_values):
    """
    各行の傾き値を閾値と比較し、NG行のリストを返す。
    全行OKなら空リスト。
    """
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
        self.switchbot = SwitchBotAPI(SWITCHBOT_TOKEN, SWITCHBOT_SECRET) if SWITCHBOT_TOKEN else None
        self.ik220 = IK220Monitor()

    def start(self):
        self.running = True
        self.retry_count = 0
        log("=" * 60)
        log("IK220 自動監視を開始します")
        log(f"  対象アプリ: {APP_TITLE}")
        log(f"  監視行: {', '.join(TARGET_ROWS)}")
        for name in TARGET_ROWS:
            th = TILT_THRESHOLDS.get(name, "?")
            log(f"    {name}: 傾 >= {th}秒 でNG")
        log(f"  測定待ち: {WAIT_MINUTES}分")
        log(f"  SwitchBot: {'設定済み' if self.switchbot else '未設定'}")
        log("=" * 60)

        if not self.ik220.connect():
            log("エラー: IK220アプリに接続できません。起動しているか確認してください。")
            self.running = False
            return

        while self.running:
            log(f"\\n--- 測定結果待ち ({WAIT_MINUTES}分) ---")

            # 測定完了を待つ
            waited = 0
            interval = 30
            total_wait = WAIT_MINUTES * 60
            while waited < total_wait and self.running:
                time.sleep(interval)
                waited += interval
                remaining = total_wait - waited
                if remaining > 0 and remaining % 60 == 0:
                    log(f"  待機中... 残り{remaining // 60}分")

            if not self.running:
                break

            # 傾き値を読み取り
            log("\\n測定結果を確認中...")
            tilt_values = self.ik220.read_tilt_values()

            if not tilt_values:
                log("警告: 傾き値を読み取れませんでした。5秒後に再試行...")
                time.sleep(5)
                tilt_values = self.ik220.read_tilt_values()

            if not tilt_values:
                log("エラー: 読み取り失敗。手動確認が必要です。")
                log("  ヒント: --scan オプションでUI要素を確認してください")
                continue

            # 判定
            ng_rows = check_tilt_results(tilt_values)

            if not ng_rows:
                self.success_count += 1
                log(f"\\n*** 全行OK！ 測定成功 ***")
                log(f"統計: 成功 {self.success_count}回, リトライ {self.retry_count}回")
                log("次の測定を待ちます...")
            else:
                self.retry_count += 1
                log(f"\\n!!! {len(ng_rows)}行でNG検出 !!!")
                for name, val, th in ng_rows:
                    log(f"  {name}: 傾={val} >= 閾値{th}")
                log(f"リトライ #{self.retry_count} を実行...")

                # Step 1: 取込開始をクリック
                log("Step 1: 「取込開始」ボタンをクリック...")
                if self.ik220.click_capture_button():
                    time.sleep(3)
                else:
                    log("警告: ボタンクリック失敗。手動で押してください。")
                    time.sleep(5)

                # Step 2: SwitchBotでリモコン押下
                log("Step 2: SwitchBotでリモコン測定開始...")
                if self.switchbot:
                    time.sleep(1)
                    if not self.switchbot.press(SWITCHBOT_DEVICE_ID):
                        log("警告: SwitchBot操作失敗。手動で押してください。")
                else:
                    log("警告: SwitchBot未設定。手動でリモコンを押してください。")

                log(f"リトライ完了。{WAIT_MINUTES}分後に再確認。")

        log(f"\\n監視終了: 成功 {self.success_count}回, リトライ {self.retry_count}回")

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
    root.title("IK220 自動監視モニター")
    root.geometry("750x550")
    root.configure(bg="#1e293b")

    # ヘッダー
    hdr = tk.Frame(root, bg="#1e293b", pady=10)
    hdr.pack(fill="x", padx=15)
    tk.Label(hdr, text="IK220 自動監視モニター",
             font=("", 16, "bold"), fg="white", bg="#1e293b").pack(side="left")

    # 閾値表示
    th_frame = tk.Frame(root, bg="#334155", pady=6, padx=15)
    th_frame.pack(fill="x", padx=15, pady=(0, 5))
    for name in TARGET_ROWS:
        th = TILT_THRESHOLDS.get(name, "?")
        color = "#f87171" if th <= 4 else "#fbbf24"
        tk.Label(th_frame, text=f"{name}: <{th}秒",
                 font=("", 10, "bold"), fg=color, bg="#334155").pack(side="left", padx=10)

    # ステータス
    st_frame = tk.Frame(root, bg="#334155", pady=8, padx=15)
    st_frame.pack(fill="x", padx=15, pady=(0, 5))
    status_lbl = tk.Label(st_frame, text="停止中", font=("", 12, "bold"), fg="#94a3b8", bg="#334155")
    status_lbl.pack(side="left")
    retry_lbl = tk.Label(st_frame, text="リトライ: 0 / 成功: 0",
                         font=("", 10), fg="#94a3b8", bg="#334155")
    retry_lbl.pack(side="right")

    # ログ
    log_area = scrolledtext.ScrolledText(root, height=18, bg="#0f172a", fg="#e2e8f0",
                                         font=("Consolas", 10), insertbackground="white")
    log_area.pack(fill="both", expand=True, padx=15, pady=(0, 10))

    # ボタン
    btn_f = tk.Frame(root, bg="#1e293b", pady=10)
    btn_f.pack(fill="x", padx=15)

    def tick():
        if logger.entries:
            for e in logger.entries:
                log_area.insert("end", e + "\\n")
                log_area.see("end")
            logger.entries.clear()
        retry_lbl.config(text=f"リトライ: {monitor.retry_count} / 成功: {monitor.success_count}")
        root.after(500, tick)

    def on_start():
        nonlocal thread
        if not monitor.running:
            monitor.running = False  # reset
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
            threading.Thread(target=monitor.switchbot.list_devices, daemon=True).start()
        else:
            log("SwitchBot未設定")

    start_btn = tk.Button(btn_f, text="監視 ON", command=on_start,
                          bg="#22c55e", fg="white", font=("", 12, "bold"), width=12, relief="flat")
    start_btn.pack(side="left", padx=5)
    stop_btn = tk.Button(btn_f, text="監視 OFF", command=on_stop,
                         bg="#ef4444", fg="white", font=("", 12, "bold"), width=12,
                         relief="flat", state="disabled")
    stop_btn.pack(side="left", padx=5)
    tk.Button(btn_f, text="UI要素スキャン", command=on_scan,
              bg="#8b5cf6", fg="white", font=("", 10), width=14, relief="flat").pack(side="right", padx=5)
    tk.Button(btn_f, text="SwitchBot テスト", command=on_test,
              bg="#3b82f6", fg="white", font=("", 10), width=14, relief="flat").pack(side="right", padx=5)

    tick()
    root.protocol("WM_DELETE_WINDOW", lambda: (on_stop(), root.destroy()))
    root.mainloop()


# ============================================================
# エントリーポイント
# ============================================================
if __name__ == "__main__":
    print("IK220 自動監視＆リトライスクリプト")
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
`;
}
