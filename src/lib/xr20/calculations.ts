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
  return `#!/usr/bin/env python3
"""
XR20 自動監視＆リトライスクリプト
==================================
測定アプリの「傾き」値を監視し、閾値を超えた場合に
自動で測定をリトライします。

動作フロー:
  1. 測定アプリの画面から「傾き」の数値を読み取る
  2. 傾き >= ${settings.monitorThresholdSec}秒 → 測定失敗と判定
  3. 失敗時:
     a. 測定アプリの「${settings.monitorCaptureButtonName}」ボタンをクリック
     b. SwitchBot経由でリモコンの測定開始ボタンを押す
  4. ${settings.monitorWaitMin}分待って再度結果を確認
  5. 成功するまで繰り返す

必要ライブラリ:
  pip install pywinauto requests pillow pytesseract

使い方:
  python xr20_monitor.py
"""

import time
import sys
import os
import hashlib
import hmac
import base64
import uuid
import json
import re
import threading
from datetime import datetime

# ============================================================
# 設定
# ============================================================
SWITCHBOT_TOKEN = ${JSON.stringify(settings.switchbotToken)}
SWITCHBOT_SECRET = ${JSON.stringify(settings.switchbotSecret)}
SWITCHBOT_DEVICE_ID = ${JSON.stringify(settings.switchbotDeviceId)}

MONITOR_APP_TITLE = ${JSON.stringify(settings.monitorAppTitle)}
CAPTURE_BUTTON_NAME = ${JSON.stringify(settings.monitorCaptureButtonName)}
THRESHOLD_SEC = ${settings.monitorThresholdSec}
WAIT_MINUTES = ${settings.monitorWaitMin}

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
# SwitchBot API
# ============================================================
class SwitchBotAPI:
    """SwitchBot Cloud API v1.1 クライアント"""
    BASE_URL = "https://api.switch-bot.com/v1.1"

    def __init__(self, token, secret):
        self.token = token
        self.secret = secret

    def _make_headers(self):
        nonce = str(uuid.uuid4())
        t = str(int(time.time() * 1000))
        string_to_sign = f"{self.token}{t}{nonce}"
        sign = base64.b64encode(
            hmac.new(
                self.secret.encode("utf-8"),
                string_to_sign.encode("utf-8"),
                hashlib.sha256
            ).digest()
        ).decode("utf-8")
        return {
            "Authorization": self.token,
            "t": t,
            "sign": sign,
            "nonce": nonce,
            "Content-Type": "application/json; charset=utf-8",
        }

    def press(self, device_id):
        """SwitchBot Botのボタンを押す"""
        import requests
        url = f"{self.BASE_URL}/devices/{device_id}/commands"
        payload = {
            "command": "press",
            "parameter": "default",
            "commandType": "command"
        }
        headers = self._make_headers()
        try:
            resp = requests.post(url, headers=headers, json=payload, timeout=10)
            data = resp.json()
            if data.get("statusCode") == 100:
                log("SwitchBot: ボタン押下成功")
                return True
            else:
                log(f"SwitchBot: エラー - {data}")
                return False
        except Exception as e:
            log(f"SwitchBot: 通信エラー - {e}")
            return False

    def list_devices(self):
        """デバイス一覧を取得（セットアップ確認用）"""
        import requests
        url = f"{self.BASE_URL}/devices"
        headers = self._make_headers()
        try:
            resp = requests.get(url, headers=headers, timeout=10)
            data = resp.json()
            if data.get("statusCode") == 100:
                devices = data.get("body", {}).get("deviceList", [])
                log(f"SwitchBot: {len(devices)}台のデバイスを検出")
                for d in devices:
                    log(f"  - {d.get('deviceName')} (ID: {d.get('deviceId')}, Type: {d.get('deviceType')})")
                return devices
            else:
                log(f"SwitchBot: デバイス取得エラー - {data}")
                return []
        except Exception as e:
            log(f"SwitchBot: 通信エラー - {e}")
            return []


# ============================================================
# 測定アプリ画面監視
# ============================================================
class MeasurementMonitor:
    """測定アプリの画面を監視し、傾きの値を読み取る"""

    def __init__(self, app_title, threshold_sec, capture_button_name):
        self.app_title = app_title
        self.threshold_sec = threshold_sec
        self.capture_button_name = capture_button_name
        self._app = None
        self._dlg = None

    def connect(self):
        """測定アプリに接続"""
        try:
            from pywinauto import Application
            self._app = Application(backend="uia").connect(
                title_re=f".*{self.app_title}.*", timeout=10
            )
            self._dlg = self._app.window(title_re=f".*{self.app_title}.*")
            log(f"測定アプリに接続: {self.app_title}")
            return True
        except ImportError:
            log("エラー: pywinauto が必要です。 pip install pywinauto")
            return False
        except Exception as e:
            log(f"測定アプリ接続エラー: {e}")
            return False

    def read_tilt_value(self):
        """
        測定アプリから「傾き」の数値を読み取る。

        方式1: pywinauto UI Automation で直接テキスト要素を取得
        方式2: スクリーンショット + OCR (pytesseract)

        ※ 測定アプリのUI構造に合わせてカスタマイズが必要です。
        """
        if self._dlg is None:
            if not self.connect():
                return None

        # --- 方式1: UI Automationで直接読み取り ---
        try:
            # 「傾き」ラベルの近くにある数値要素を探す
            # ※ 実際のコントロール名はアプリにより異なります
            # self._dlg.print_control_identifiers() で確認してください
            children = self._dlg.descendants()
            for child in children:
                try:
                    text = child.window_text()
                    if "傾き" in text:
                        # 「傾き」の後ろにある数値を抽出
                        match = re.search(r'[\\d]+\\.?[\\d]*', text)
                        if match:
                            value = float(match.group())
                            log(f"  UI読取り: 傾き = {value}秒")
                            return value
                except Exception:
                    continue

            # 数値を持つ要素を探索（傾きフィールドの特定が必要）
            for child in children:
                try:
                    name = child.element_info.name or ""
                    if "傾き" in name or "tilt" in name.lower():
                        # 隣接要素から数値を取得
                        val_text = child.window_text()
                        match = re.search(r'[\\d]+\\.?[\\d]*', val_text)
                        if match:
                            value = float(match.group())
                            log(f"  UI読取り: 傾き = {value}秒")
                            return value
                except Exception:
                    continue
        except Exception as e:
            log(f"  UI読取りエラー: {e}")

        # --- 方式2: スクリーンショット + OCR ---
        try:
            return self._read_by_ocr()
        except Exception as e:
            log(f"  OCR読取りエラー: {e}")

        return None

    def _read_by_ocr(self):
        """スクリーンショットからOCRで数値を読み取る"""
        try:
            from PIL import ImageGrab
            import pytesseract
        except ImportError:
            log("  OCR未対応: pip install pillow pytesseract")
            return None

        try:
            if self._dlg:
                rect = self._dlg.rectangle()
                img = ImageGrab.grab(bbox=(rect.left, rect.top, rect.right, rect.bottom))
            else:
                img = ImageGrab.grab()

            text = pytesseract.image_to_string(img, lang="jpn+eng")
            # 「傾き」の近くの数値を探す
            lines = text.split("\\n")
            for i, line in enumerate(lines):
                if "傾き" in line:
                    match = re.search(r'[\\d]+\\.?[\\d]*', line)
                    if match:
                        value = float(match.group())
                        log(f"  OCR読取り: 傾き = {value}秒")
                        return value
                    # 次の行も確認
                    if i + 1 < len(lines):
                        match = re.search(r'[\\d]+\\.?[\\d]*', lines[i + 1])
                        if match:
                            value = float(match.group())
                            log(f"  OCR読取り: 傾き = {value}秒")
                            return value
        except Exception as e:
            log(f"  OCRエラー: {e}")

        return None

    def click_capture_button(self):
        """測定アプリの「取り込み開始」ボタンをクリック"""
        if self._dlg is None:
            if not self.connect():
                return False

        try:
            btn = self._dlg.child_window(title_re=f".*{self.capture_button_name}.*", control_type="Button")
            btn.click_input()
            log(f"「{self.capture_button_name}」ボタンをクリック")
            return True
        except Exception as e:
            log(f"ボタンクリックエラー: {e}")
            # フォールバック: キーボードショートカットがあれば使用
            try:
                from pywinauto.keyboard import send_keys
                # ※ アプリ固有のショートカットキーがあれば設定
                log("フォールバック: 手動でボタンを押してください")
            except Exception:
                pass
            return False


# ============================================================
# メイン監視ループ
# ============================================================
class AutoRetryMonitor:
    """自動監視＆リトライの制御クラス"""

    def __init__(self):
        self.running = False
        self.retry_count = 0
        self.success_count = 0
        self.switchbot = SwitchBotAPI(SWITCHBOT_TOKEN, SWITCHBOT_SECRET) if SWITCHBOT_TOKEN else None
        self.monitor = MeasurementMonitor(MONITOR_APP_TITLE, THRESHOLD_SEC, CAPTURE_BUTTON_NAME)

    def start(self):
        """監視開始"""
        self.running = True
        self.retry_count = 0
        log("=" * 50)
        log("自動監視を開始します")
        log(f"  監視対象: {MONITOR_APP_TITLE}")
        log(f"  傾き閾値: {THRESHOLD_SEC}秒以上で失敗判定")
        log(f"  測定待ち: {WAIT_MINUTES}分")
        log(f"  SwitchBot: {'設定済み' if self.switchbot else '未設定'}")
        log("=" * 50)

        if not self.monitor.connect():
            log("エラー: 測定アプリに接続できません。アプリが起動しているか確認してください。")
            self.running = False
            return

        # メインループ
        while self.running:
            log(f"\\n--- 測定結果待ち ({WAIT_MINUTES}分) ---")

            # 測定完了を待つ
            waited = 0
            check_interval = 30  # 30秒ごとに確認
            while waited < WAIT_MINUTES * 60 and self.running:
                time.sleep(check_interval)
                waited += check_interval
                remaining = WAIT_MINUTES * 60 - waited
                if remaining > 0:
                    log(f"  待機中... 残り{remaining // 60}分{remaining % 60}秒")

            if not self.running:
                break

            # 傾きの値を読み取り
            log("測定結果を確認中...")
            tilt_value = self.monitor.read_tilt_value()

            if tilt_value is None:
                log("警告: 傾きの値を読み取れませんでした。再試行します...")
                time.sleep(5)
                tilt_value = self.monitor.read_tilt_value()

            if tilt_value is None:
                log("エラー: 値の読み取りに失敗。手動確認が必要です。")
                log("Enterキーで続行、'q'で終了:")
                user_input = input().strip().lower()
                if user_input == 'q':
                    break
                continue

            log(f"傾き = {tilt_value}秒")

            if tilt_value < THRESHOLD_SEC:
                # 成功
                self.success_count += 1
                log(f"*** 測定成功！ (傾き {tilt_value}秒 < 閾値 {THRESHOLD_SEC}秒) ***")
                log(f"統計: 成功 {self.success_count}回, リトライ {self.retry_count}回")
                log("次の測定を待ちます... (Ctrl+Cで終了)")
                continue
            else:
                # 失敗 → リトライ
                self.retry_count += 1
                log(f"!!! 測定失敗 (傾き {tilt_value}秒 >= 閾値 {THRESHOLD_SEC}秒) !!!")
                log(f"リトライ #{self.retry_count} を実行します...")

                # Step 1: 取り込み開始ボタンをクリック
                log("Step 1: 取り込み開始ボタンをクリック...")
                if self.monitor.click_capture_button():
                    time.sleep(2)  # ボタン反応待ち
                else:
                    log("警告: ボタンクリックに失敗。手動で押してください。")
                    time.sleep(5)

                # Step 2: SwitchBotでリモコンのボタンを押す
                log("Step 2: SwitchBotでリモコン測定開始ボタンを押す...")
                if self.switchbot:
                    time.sleep(1)
                    if not self.switchbot.press(SWITCHBOT_DEVICE_ID):
                        log("警告: SwitchBotの操作に失敗。手動で押してください。")
                else:
                    log("警告: SwitchBot未設定。手動でリモコンのボタンを押してください。")

                log(f"リトライ完了。{WAIT_MINUTES}分後に再確認します。")

        log("\\n監視を終了しました。")
        log(f"最終統計: 成功 {self.success_count}回, リトライ {self.retry_count}回")

    def stop(self):
        """監視停止"""
        self.running = False
        log("監視停止を要求しました...")


# ============================================================
# GUI (tkinter)
# ============================================================
def run_gui():
    """シンプルな監視GUIを起動"""
    import tkinter as tk
    from tkinter import ttk, scrolledtext

    monitor_instance = AutoRetryMonitor()
    monitor_thread = None

    root = tk.Tk()
    root.title("XR20 自動監視モニター")
    root.geometry("700x500")
    root.configure(bg="#1e293b")

    # ヘッダー
    header = tk.Frame(root, bg="#1e293b", pady=10)
    header.pack(fill="x", padx=15)
    tk.Label(header, text="XR20 自動監視モニター",
             font=("", 16, "bold"), fg="white", bg="#1e293b").pack(side="left")

    # ステータス
    status_frame = tk.Frame(root, bg="#334155", pady=8, padx=15)
    status_frame.pack(fill="x", padx=15, pady=(0, 10))

    status_label = tk.Label(status_frame, text="停止中",
                           font=("", 12, "bold"), fg="#94a3b8", bg="#334155")
    status_label.pack(side="left")

    retry_label = tk.Label(status_frame, text="リトライ: 0回",
                          font=("", 10), fg="#94a3b8", bg="#334155")
    retry_label.pack(side="right")

    # ログ表示
    log_area = scrolledtext.ScrolledText(root, height=18, bg="#0f172a", fg="#e2e8f0",
                                         font=("Consolas", 10), insertbackground="white")
    log_area.pack(fill="both", expand=True, padx=15, pady=(0, 10))

    # ボタン
    btn_frame = tk.Frame(root, bg="#1e293b", pady=10)
    btn_frame.pack(fill="x", padx=15)

    def update_log():
        if logger.entries:
            for entry in logger.entries:
                log_area.insert("end", entry + "\\n")
                log_area.see("end")
            logger.entries.clear()
        retry_label.config(text=f"リトライ: {monitor_instance.retry_count}回 / 成功: {monitor_instance.success_count}回")
        root.after(500, update_log)

    def on_start():
        nonlocal monitor_thread
        if not monitor_instance.running:
            monitor_thread = threading.Thread(target=monitor_instance.start, daemon=True)
            monitor_thread.start()
            status_label.config(text="監視中", fg="#4ade80")
            start_btn.config(state="disabled")
            stop_btn.config(state="normal")

    def on_stop():
        monitor_instance.stop()
        status_label.config(text="停止中", fg="#94a3b8")
        start_btn.config(state="normal")
        stop_btn.config(state="disabled")

    def on_test_switchbot():
        log("SwitchBot接続テスト...")
        if monitor_instance.switchbot:
            threading.Thread(target=monitor_instance.switchbot.list_devices, daemon=True).start()
        else:
            log("SwitchBotが設定されていません。")

    start_btn = tk.Button(btn_frame, text="監視 ON", command=on_start,
                          bg="#22c55e", fg="white", font=("", 12, "bold"),
                          width=12, relief="flat")
    start_btn.pack(side="left", padx=5)

    stop_btn = tk.Button(btn_frame, text="監視 OFF", command=on_stop,
                         bg="#ef4444", fg="white", font=("", 12, "bold"),
                         width=12, relief="flat", state="disabled")
    stop_btn.pack(side="left", padx=5)

    test_btn = tk.Button(btn_frame, text="SwitchBot テスト", command=on_test_switchbot,
                         bg="#3b82f6", fg="white", font=("", 10),
                         width=16, relief="flat")
    test_btn.pack(side="right", padx=5)

    update_log()
    root.protocol("WM_DELETE_WINDOW", lambda: (on_stop(), root.destroy()))
    root.mainloop()


# ============================================================
# エントリーポイント
# ============================================================
if __name__ == "__main__":
    print("XR20 自動監視＆リトライスクリプト")
    print("=" * 40)

    if "--cli" in sys.argv:
        # CLIモード
        monitor = AutoRetryMonitor()
        try:
            monitor.start()
        except KeyboardInterrupt:
            monitor.stop()
            print("\\nCtrl+C で終了しました。")
    elif "--list-devices" in sys.argv:
        # デバイス一覧
        api = SwitchBotAPI(SWITCHBOT_TOKEN, SWITCHBOT_SECRET)
        api.list_devices()
    elif "--test-press" in sys.argv:
        # テスト押下
        api = SwitchBotAPI(SWITCHBOT_TOKEN, SWITCHBOT_SECRET)
        api.press(SWITCHBOT_DEVICE_ID)
    else:
        # GUIモード（デフォルト）
        run_gui()
`;
}
