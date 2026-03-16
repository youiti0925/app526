import { TargetPoint, MeasurementRow, EvaluationStats, XR20Settings } from "./types";

export function generateTargetList(settings: XR20Settings): TargetPoint[] {
  const targets: TargetPoint[] = [];
  let no = 1;

  // Wheel division targets
  const wheelStep = 360 / settings.wheelDivisions;
  for (let i = 0; i < settings.wheelDivisions; i++) {
    targets.push({
      no: no++,
      angle: roundAngle(wheelStep * i),
      category: "wheel",
      status: "pending",
    });
  }

  // Worm division targets
  const wormOneRotationAngle =
    (360 / settings.wheelTeeth) * settings.wormLeads;
  const wormStep = wormOneRotationAngle / settings.wormDivisions;
  for (let i = 0; i < settings.wormDivisions; i++) {
    targets.push({
      no: no++,
      angle: roundAngle(settings.wormStartPosition + wormStep * i),
      category: "worm",
      status: "pending",
    });
  }

  return targets;
}

export function generateNCProgram(
  targets: TargetPoint[],
  settings: XR20Settings
): string {
  const lines: string[] = [];
  const dwellSec = settings.dwellTimeMs / 1000;
  const pValue = Math.round(settings.dwellTimeMs);

  lines.push("O1000 (XR20 WORM-WHEEL EVALUATION)");
  lines.push("");

  // Wheel section
  const wheelTargets = targets.filter((t) => t.category === "wheel");
  const wormTargets = targets.filter((t) => t.category === "worm");

  if (wheelTargets.length > 0) {
    lines.push(`(WHEEL ${settings.wheelDivisions}-DIVISION)`);
    lines.push("G90");
    for (const t of wheelTargets) {
      lines.push(`G00 A${formatAngle(t.angle)}`);
      lines.push(`G04 P${pValue}`);
    }
    lines.push("");
  }

  if (wormTargets.length > 0) {
    lines.push(`(WORM ${settings.wormDivisions}-DIVISION)`);
    for (const t of wormTargets) {
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

export function separateData(
  data: MeasurementRow[],
  targets: TargetPoint[]
): { wheel: MeasurementRow[]; worm: MeasurementRow[] } {
  const wheelCount = targets.filter((t) => t.category === "wheel").length;
  return {
    wheel: data.slice(0, wheelCount).map((r) => ({ ...r, category: "wheel" as const })),
    worm: data.slice(wheelCount).map((r) => ({ ...r, category: "worm" as const })),
  };
}

export function parseCSVData(csv: string, targets: TargetPoint[]): MeasurementRow[] {
  const lines = csv
    .trim()
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("#") && !l.startsWith("//"));

  const rows: MeasurementRow[] = [];
  const wheelCount = targets.filter((t) => t.category === "wheel").length;

  for (let i = 0; i < lines.length; i++) {
    const parts = lines[i].split(/[,\t]+/).map((s) => s.trim());
    if (parts.length >= 3) {
      const targetAngle = parseFloat(parts[0]);
      const measuredAngle = parseFloat(parts[1]);
      const errorArcSec = parseFloat(parts[2]);
      if (!isNaN(targetAngle) && !isNaN(measuredAngle) && !isNaN(errorArcSec)) {
        rows.push({
          no: i + 1,
          targetAngle,
          measuredAngle,
          errorArcSec,
          category: i < wheelCount ? "wheel" : "worm",
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
