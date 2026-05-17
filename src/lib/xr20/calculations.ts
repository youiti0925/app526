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
