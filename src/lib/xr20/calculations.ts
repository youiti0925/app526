import { TargetPoint, MeasurementRow, EvaluationStats, XR20Settings } from "./types";

export function generateTargetList(settings: XR20Settings): TargetPoint[] {
  const targets: TargetPoint[] = [];
  let no = 1;

  if (settings.axisType === "rotation") {
    // 回転軸: 0° → step → ... → (360-step)°
    const step = 360 / settings.divisions;

    // CW
    for (let i = 0; i < settings.divisions; i++) {
      targets.push({
        no: no++,
        angle: roundAngle(step * i),
        direction: "cw",
        status: "pending",
      });
    }

    // CCW (逆順)
    for (let i = settings.divisions - 1; i >= 0; i--) {
      targets.push({
        no: no++,
        angle: roundAngle(step * i),
        direction: "ccw",
        status: "pending",
      });
    }
  } else {
    // 傾斜軸: startAngle → endAngle を等分
    const totalRange = settings.endAngle - settings.startAngle;
    const step = totalRange / settings.divisions;

    // CW (start → end)
    for (let i = 0; i <= settings.divisions; i++) {
      targets.push({
        no: no++,
        angle: roundAngle(settings.startAngle + step * i),
        direction: "cw",
        status: "pending",
      });
    }

    // CCW (end → start)
    for (let i = settings.divisions; i >= 0; i--) {
      targets.push({
        no: no++,
        angle: roundAngle(settings.startAngle + step * i),
        direction: "ccw",
        status: "pending",
      });
    }
  }

  return targets;
}

export function generateNCProgram(
  targets: TargetPoint[],
  settings: XR20Settings
): string {
  const lines: string[] = [];
  const pValue = Math.round(settings.dwellTimeMs);
  const ovr = settings.overrunAngle;
  const axisLabel = settings.axisType === "rotation" ? "ROTATION" : "TILT";

  lines.push(`O1000 (XR20 ${axisLabel} AXIS EVALUATION)`);
  lines.push("");

  const cwTargets = targets.filter((t) => t.direction === "cw");
  const ccwTargets = targets.filter((t) => t.direction === "ccw");

  // --- CW ---
  if (cwTargets.length > 0) {
    lines.push(`(CW ${settings.divisions}-DIVISION)`);
    lines.push("(OVERRUN: BACKLASH ELIMINATION FOR CW)");
    lines.push("G91");
    lines.push(`G00 A-${formatAngle(ovr)}`);
    lines.push(`G00 A${formatAngle(ovr)}`);
    lines.push("G90");
    lines.push("");
    for (const t of cwTargets) {
      lines.push(`G00 A${formatAngle(t.angle)}`);
      lines.push(`G04 P${pValue}`);
    }
    lines.push("");
  }

  // --- CCW ---
  if (ccwTargets.length > 0) {
    lines.push(`(CCW ${settings.divisions}-DIVISION)`);
    lines.push("(OVERRUN: BACKLASH ELIMINATION FOR CCW)");
    lines.push("G91");
    lines.push(`G00 A${formatAngle(ovr)}`);
    lines.push(`G00 A-${formatAngle(ovr)}`);
    lines.push("G90");
    lines.push("");
    for (const t of ccwTargets) {
      lines.push(`G00 A${formatAngle(t.angle)}`);
      lines.push(`G04 P${pValue}`);
    }
    lines.push("");
  }

  lines.push("M30");
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
        rows.push({
          no: i + 1,
          targetAngle,
          measuredAngle,
          errorArcSec,
          direction,
        });
      }
    }
  }
  return rows;
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
