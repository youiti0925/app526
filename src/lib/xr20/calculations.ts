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
