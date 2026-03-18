import {
  TargetPoint,
  MeasurementRow,
  EvaluationStats,
  XR20Settings,
  RepeatPositionResult,
  RepeatabilityResult,
} from "./types";

export function generateTargetList(settings: XR20Settings): TargetPoint[] {
  const targets: TargetPoint[] = [];
  let no = 1;

  if (settings.axisType === "rotation") {
    const step = 360 / settings.divisions;
    for (let i = 0; i < settings.divisions; i++) {
      targets.push({ no: no++, angle: roundAngle(step * i), direction: "cw", phase: "index", trial: 0, status: "pending" });
    }
    for (let i = settings.divisions - 1; i >= 0; i--) {
      targets.push({ no: no++, angle: roundAngle(step * i), direction: "ccw", phase: "index", trial: 0, status: "pending" });
    }
  } else {
    const totalRange = settings.endAngle - settings.startAngle;
    const step = totalRange / settings.divisions;
    for (let i = 0; i <= settings.divisions; i++) {
      targets.push({ no: no++, angle: roundAngle(settings.startAngle + step * i), direction: "cw", phase: "index", trial: 0, status: "pending" });
    }
    for (let i = settings.divisions; i >= 0; i--) {
      targets.push({ no: no++, angle: roundAngle(settings.startAngle + step * i), direction: "ccw", phase: "index", trial: 0, status: "pending"
      });
    }
  }

  return targets;
}

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
  const axisLabel = settings.axisType === "rotation" ? "ROTATION" : "TILT";
  const ax = settings.controlAxis || "A";
  const clamp = settings.useClamp;

  lines.push(`O1000 (XR20 ${axisLabel} AXIS[${ax}] EVALUATION)`);
  if (clamp) lines.push(`(CLAMP: M10=CLAMP M11=UNCLAMP)`);
  lines.push("");

  const cwTargets = targets.filter((t) => t.direction === "cw");
  const ccwTargets = targets.filter((t) => t.direction === "ccw");

  // --- CW ---
  if (cwTargets.length > 0) {
    lines.push(`(CW ${settings.divisions}-DIVISION)`);
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

  // --- CCW ---
  if (ccwTargets.length > 0) {
    lines.push(`(CCW ${settings.divisions}-DIVISION)`);
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

  lines.push("M30");
  return lines.join("\n");
}

export function generateCombinedTargets(settings: XR20Settings): TargetPoint[] {
  const targets = generateTargetList(settings);
  let no = targets.length + 1;

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

export function generateCombinedNCProgram(
  targets: TargetPoint[],
  settings: XR20Settings
): string {
  const lines: string[] = [];
  const pValue = Math.round(settings.dwellTimeMs);
  const ovr = settings.overrunAngle;
  const axisLabel = settings.axisType === "rotation" ? "ROTATION" : "TILT";
  const ax = settings.controlAxis || "A";
  const clamp = settings.useClamp;

  lines.push(`O3000 (XR20 ${axisLabel} AXIS[${ax}] COMBINED: INDEX + REPEAT)`);
  if (clamp) lines.push(`(CLAMP: M10=CLAMP M11=UNCLAMP)`);
  lines.push("");

  // 割出し精度パート
  const indexTargets = targets.filter((t) => t.phase === "index");
  const indexCW = indexTargets.filter((t) => t.direction === "cw");
  const indexCCW = indexTargets.filter((t) => t.direction === "ccw");

  lines.push("(===== PART 1: INDEXING ACCURACY =====)");
  lines.push("");

  if (indexCW.length > 0) {
    lines.push(`(INDEX CW ${settings.divisions}-DIVISION)`);
    lines.push("(OVERRUN: BACKLASH ELIMINATION FOR CW)");
    lines.push("G91");
    lines.push(`G00 ${ax}-${formatAngle(ovr)}`);
    lines.push(`G00 ${ax}${formatAngle(ovr)}`);
    lines.push("G90");
    lines.push("");
    for (const t of indexCW) {
      if (clamp) lines.push("M11");
      lines.push(buildMoveCmd(ax, t.angle, settings.feedMode, settings.feedRate));
      if (clamp) lines.push("M10");
      lines.push(`G04 P${pValue}`);
    }
    lines.push("");
  }

  if (indexCCW.length > 0) {
    lines.push(`(INDEX CCW ${settings.divisions}-DIVISION)`);
    lines.push("(OVERRUN: BACKLASH ELIMINATION FOR CCW)");
    lines.push("G91");
    lines.push(`G00 ${ax}${formatAngle(ovr)}`);
    lines.push(`G00 ${ax}-${formatAngle(ovr)}`);
    lines.push("G90");
    lines.push("");
    for (const t of indexCCW) {
      if (clamp) lines.push("M11");
      lines.push(buildMoveCmd(ax, t.angle, settings.feedMode, settings.feedRate));
      if (clamp) lines.push("M10");
      lines.push(`G04 P${pValue}`);
    }
    lines.push("");
  }

  // 再現性パート
  const repeatTargets = targets.filter((t) => t.phase === "repeat");
  if (repeatTargets.length > 0) {
    lines.push("(===== PART 2: REPEATABILITY =====)");
    lines.push("");

    const positions = [...new Set(repeatTargets.map((t) => t.angle))].sort(
      (a, b) => a - b
    );
    for (const pos of positions) {
      const posCW = repeatTargets.filter(
        (t) => t.angle === pos && t.direction === "cw"
      );
      const posCCW = repeatTargets.filter(
        (t) => t.angle === pos && t.direction === "ccw"
      );

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

export function generateCartoTargetCSV(targets: TargetPoint[]): string {
  const lines = ["Target Position"];
  for (const t of targets) {
    lines.push(t.angle.toFixed(4));
  }
  return lines.join("\n");
}

export function calculateStats(rows: MeasurementRow[]): EvaluationStats {
  if (rows.length === 0) {
    return {
      maxError: 0,
      minError: 0,
      meanError: 0,
      sigma: 0,
      indexAccuracy: 0,
      count: 0,
    };
  }

  const errors = rows.map((r) => r.errorArcSec);
  const maxError = Math.max(...errors);
  const minError = Math.min(...errors);
  const meanError = errors.reduce((a, b) => a + b, 0) / errors.length;
  const variance =
    errors.reduce((sum, e) => sum + (e - meanError) ** 2, 0) / errors.length;
  const sigma = Math.sqrt(variance);

  return {
    maxError,
    minError,
    meanError,
    sigma,
    indexAccuracy: maxError - minError,
    count: errors.length,
  };
}

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
        const phase = idx < targets.length ? targets[idx].phase : "index";
        const trial = idx < targets.length ? targets[idx].trial : 0;
        rows.push({
          no: i + 1,
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
// 再現性測定
// ============================================================

export function generateRepeatTargets(
  settings: XR20Settings
): TargetPoint[] {
  const positions = settings.repeatPositions
    .split(",")
    .map((s) => parseFloat(s.trim()))
    .filter((n) => !isNaN(n));
  const targets: TargetPoint[] = [];
  let no = 1;

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

export function generateRepeatNCProgram(settings: XR20Settings): string {
  const positions = settings.repeatPositions
    .split(",")
    .map((s) => parseFloat(s.trim()))
    .filter((n) => !isNaN(n));
  const lines: string[] = [];
  const pValue = Math.round(settings.dwellTimeMs);
  const ovr = settings.overrunAngle;
  const ax = settings.controlAxis || "A";
  const clamp = settings.useClamp;

  lines.push(`O2000 (XR20 AXIS[${ax}] REPEATABILITY EVALUATION)`);
  if (clamp) lines.push(`(CLAMP: M10=CLAMP M11=UNCLAMP)`);
  lines.push("");

  for (const pos of positions) {
    lines.push(`(POSITION ${pos} DEG - CW x${settings.repeatCount})`);
    for (let trial = 1; trial <= settings.repeatCount; trial++) {
      lines.push(`(CW TRIAL ${trial})`);
      lines.push("G91");
      lines.push(`G00 ${ax}-${formatAngle(ovr)}`);
      lines.push("G90");
      if (clamp) lines.push("M11");
      lines.push(buildMoveCmd(ax, pos, settings.feedMode, settings.feedRate));
      if (clamp) lines.push("M10");
      lines.push(`G04 P${pValue}`);
    }
    lines.push("");

    lines.push(`(POSITION ${pos} DEG - CCW x${settings.repeatCount})`);
    for (let trial = 1; trial <= settings.repeatCount; trial++) {
      lines.push(`(CCW TRIAL ${trial})`);
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

  lines.push("M30");
  return lines.join("\n");
}

export function parseRepeatCSVData(
  csv: string,
  targets: TargetPoint[]
): MeasurementRow[] {
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
      if (
        !isNaN(targetAngle) &&
        !isNaN(measuredAngle) &&
        !isNaN(errorArcSec)
      ) {
        const idx = rows.length;
        const direction =
          idx < targets.length ? targets[idx].direction : ("cw" as const);
        const trial = idx < targets.length ? targets[idx].trial : 1;
        rows.push({
          no: rows.length + 1,
          targetAngle,
          measuredAngle,
          errorArcSec,
          direction,
          phase: "repeat",
          trial,
        });
      }
    }
  }
  return rows;
}

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
    const cwRange =
      cwErrors.length >= 2
        ? Math.max(...cwErrors) - Math.min(...cwErrors)
        : 0;
    const ccwRange =
      ccwErrors.length >= 2
        ? Math.max(...ccwErrors) - Math.min(...ccwErrors)
        : 0;
    return { angle: pos, cwErrors, ccwErrors, cwRange, ccwRange };
  });

  const allRanges = results.flatMap((r) => [r.cwRange, r.ccwRange]);
  const repeatability = allRanges.length > 0 ? Math.max(...allRanges) : 0;

  return { positions: results, repeatability };
}

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
