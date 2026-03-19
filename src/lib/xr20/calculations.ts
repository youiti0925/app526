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
// Python自動F9監視スクリプト生成
// ============================================================

export function generatePythonScript(settings: XR20Settings, targets: TargetPoint[]): string {
  const dwellSec = settings.dwellTimeMs / 1000;
  const overrunSec = 2;
  const moveSec = 1.5;
  const marginSec = 0.5;

  const timings: { sec: number; angle: number; dir: string; phase: string; no: number }[] = [];
  let elapsed = 0;

  const phaseGroups: { targets: TargetPoint[]; hasOverrun: boolean }[] = [];
  const wheelCW = targets.filter(t => t.phase === "wheel" && t.direction === "cw");
  const wheelCCW = targets.filter(t => t.phase === "wheel" && t.direction === "ccw");
  const wormCW = targets.filter(t => t.phase === "worm" && t.direction === "cw");
  const wormCCW = targets.filter(t => t.phase === "worm" && t.direction === "ccw");
  const repeatTgts = targets.filter(t => t.phase === "repeat");

  if (wheelCW.length) phaseGroups.push({ targets: wheelCW, hasOverrun: true });
  if (wheelCCW.length) phaseGroups.push({ targets: wheelCCW, hasOverrun: true });
  if (wormCW.length) phaseGroups.push({ targets: wormCW, hasOverrun: true });
  if (wormCCW.length) phaseGroups.push({ targets: wormCCW, hasOverrun: true });

  const repeatPositions = [...new Set(repeatTgts.map(t => t.angle))].sort((a, b) => a - b);
  for (const pos of repeatPositions) {
    const cwTrials = repeatTgts.filter(t => t.angle === pos && t.direction === "cw");
    const ccwTrials = repeatTgts.filter(t => t.angle === pos && t.direction === "ccw");
    if (cwTrials.length) phaseGroups.push({ targets: cwTrials, hasOverrun: false });
    if (ccwTrials.length) phaseGroups.push({ targets: ccwTrials, hasOverrun: false });
  }

  for (const pg of phaseGroups) {
    if (pg.hasOverrun) elapsed += overrunSec;
    for (const t of pg.targets) {
      if (t.phase === "repeat") elapsed += overrunSec;
      elapsed += moveSec;
      timings.push({
        sec: Math.round((elapsed + marginSec) * 10) / 10,
        angle: t.angle, dir: t.direction, phase: t.phase, no: t.no,
      });
      elapsed += dwellSec;
    }
  }

  const timingsJson = JSON.stringify(timings.map(t => ({
    sec: t.sec, angle: t.angle, dir: t.dir, phase: t.phase, no: t.no,
  })));

  const lines: string[] = [];
  lines.push("#!/usr/bin/env python3");
  lines.push('"""');
  lines.push("XR20 CARTO 自動F9キャプチャスクリプト（タイマー方式）");
  lines.push("====================================================");
  lines.push("NCプログラムのドウェルタイミングに合わせてF9キーを自動送信。");
  lines.push("CARTOの画面読み取り不要。pywinauto不要。");
  lines.push("");
  lines.push("使い方:");
  lines.push("  1. CARTOを起動 → Rotaryテスト → ターゲット入力 → Start");
  lines.push("  2. python xr20_auto_f9.py を実行");
  lines.push("  3. NCプログラムをサイクルスタートすると同時にEnterキー");
  lines.push("  → 全" + targets.length + "点のF9が自動送信される");
  lines.push('"""');
  lines.push("");
  lines.push("import time, sys, os, ctypes, ctypes.wintypes");
  lines.push("from datetime import datetime");
  lines.push("");
  lines.push('if os.name != "nt":');
  lines.push('    print("エラー: Windows専用です"); sys.exit(1)');
  lines.push("");
  lines.push("# 設定");
  lines.push("CARTO_WINDOW_TITLE = " + JSON.stringify(settings.cartoWindowTitle));
  lines.push("TOTAL_TARGETS = " + targets.length);
  lines.push("TIMINGS = " + timingsJson);
  lines.push("");
  lines.push("# Windows API");
  lines.push("user32 = ctypes.windll.user32");
  lines.push("WM_KEYDOWN, WM_KEYUP, VK_F9 = 0x0100, 0x0101, 0x78");
  lines.push("WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.wintypes.BOOL, ctypes.wintypes.HWND, ctypes.wintypes.LPARAM)");
  lines.push("");
  lines.push("def find_window(title_part):");
  lines.push("    results = []");
  lines.push("    def callback(hwnd, _):");
  lines.push("        if user32.IsWindowVisible(hwnd):");
  lines.push("            buf = ctypes.create_unicode_buffer(256)");
  lines.push("            user32.GetWindowTextW(hwnd, buf, 256)");
  lines.push("            if title_part.lower() in buf.value.lower(): results.append(hwnd)");
  lines.push("        return True");
  lines.push("    user32.EnumWindows(WNDENUMPROC(callback), 0)");
  lines.push("    return results[0] if results else 0");
  lines.push("");
  lines.push("def send_f9(hwnd):");
  lines.push("    user32.PostMessageW(hwnd, WM_KEYDOWN, VK_F9, 0)");
  lines.push("    time.sleep(0.05)");
  lines.push("    user32.PostMessageW(hwnd, WM_KEYUP, VK_F9, 0)");
  lines.push("");
  lines.push("def log(msg):");
  lines.push('    print(f"[{datetime.now().strftime(\'%H:%M:%S\')}] {msg}")');
  lines.push("");
  lines.push("def main():");
  lines.push('    log(f"XR20 自動F9 (全{TOTAL_TARGETS}点)")');
  lines.push('    log(f"CARTOウィンドウ検索: \'{CARTO_WINDOW_TITLE}\'")');
  lines.push("    hwnd = find_window(CARTO_WINDOW_TITLE)");
  lines.push("    if not hwnd:");
  lines.push('        log("エラー: CARTOウィンドウが見つかりません"); return');
  lines.push('    log(f"CARTO検出: hwnd=0x{hwnd:08X}")');
  lines.push('    log("")');
  lines.push('    log("=" * 50)');
  lines.push('    log("CARTOでStartを押した後、NCサイクルスタートと同時にEnterを押してください")');
  lines.push('    log("=" * 50)');
  lines.push("    input()");
  lines.push("    start_time = time.time()");
  lines.push('    log("タイマー開始!")');
  lines.push("    for i, t in enumerate(TIMINGS):");
  lines.push('        wait = start_time + t["sec"] - time.time()');
  lines.push("        if wait > 0: time.sleep(wait)");
  lines.push("        send_f9(hwnd)");
  lines.push('        log(f"  F9 #{i+1}/{TOTAL_TARGETS}  {t[\'angle\']:.4f} {t[\'dir\'].upper()} [{t[\'phase\']}]")');
  lines.push('    log(f"\\n全{TOTAL_TARGETS}点完了! CARTOからCSVエクスポートしてください")');
  lines.push("");
  lines.push('if __name__ == "__main__": main()');

  return lines.join("\n");
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
