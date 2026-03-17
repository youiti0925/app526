export interface XR20Settings {
  // Machine info
  machineModel: string;
  machineSerial: string;
  ncModel: string;

  // Evaluation parameters
  axisType: "rotation" | "tilt";
  divisions: number;
  startAngle: number;
  endAngle: number;
  overrunAngle: number;

  // Repeatability parameters
  repeatPositions: string;
  repeatCount: number;

  // Monitoring parameters
  monitorIntervalMs: number;
  stabilityCount: number;
  stabilityThreshold: number;
  postF9WaitMs: number;
  stabilityMinTimeMs: number;

  // CARTO
  cartoWindowTitle: string;

  // NC program
  dwellTimeMs: number;
}

export const DEFAULT_SETTINGS: XR20Settings = {
  machineModel: "",
  machineSerial: "",
  ncModel: "FANUC",
  axisType: "rotation",
  divisions: 36,
  startAngle: 0,
  endAngle: 360,
  overrunAngle: 10,
  repeatPositions: "0,90,180,270",
  repeatCount: 7,
  monitorIntervalMs: 150,
  stabilityCount: 10,
  stabilityThreshold: 0.001,
  postF9WaitMs: 1000,
  stabilityMinTimeMs: 1000,
  cartoWindowTitle: "CARTO",
  dwellTimeMs: 5000,
};

export interface TargetPoint {
  no: number;
  angle: number;
  direction: "cw" | "ccw";
  phase: "index" | "repeat";
  trial: number; // 0 for index, 1-N for repeat
  status: "pending" | "measured";
}

export interface MeasurementRow {
  no: number;
  targetAngle: number;
  measuredAngle: number;
  errorArcSec: number;
  direction: "cw" | "ccw";
  phase: "index" | "repeat";
  trial: number;
}

export interface EvaluationStats {
  maxError: number;
  minError: number;
  meanError: number;
  sigma: number;
  indexAccuracy: number; // max - min
  count: number;
}

export interface RepeatPositionResult {
  angle: number;
  cwErrors: number[];
  ccwErrors: number[];
  cwRange: number;
  ccwRange: number;
}

export interface RepeatabilityResult {
  positions: RepeatPositionResult[];
  repeatability: number;
}

export type XR20Tab =
  | "settings"
  | "targets"
  | "control"
  | "data"
  | "results"
  | "report"
  | "repeatability"
  | "help";
