export interface XR20Settings {
  // Machine info
  machineModel: string;
  machineSerial: string;
  ncModel: string;

  // Gear parameters (worm wheel)
  wheelTeeth: number;    // ホイール歯数
  wormStarts: number;    // ウォーム条数（1条=1, 2条=2...）

  // Evaluation parameters
  axisType: "rotation" | "tilt";
  divisions: number;       // ホイール等分数（通常 = wheelTeeth）
  wormDivisions: number;   // ウォーム等分数（1ピッチ内の分割数）
  startAngle: number;
  endAngle: number;
  overrunAngle: number;

  // Repeatability parameters
  repeatPositions: string;
  repeatCount: number;

  // NC program
  dwellTimeMs: number;
  controlAxis: string;
  feedMode: "rapid" | "feed";
  feedRate: number;
  useClamp: boolean;
}

export const DEFAULT_SETTINGS: XR20Settings = {
  machineModel: "",
  machineSerial: "",
  ncModel: "FANUC",
  wheelTeeth: 72,
  wormStarts: 1,
  axisType: "rotation",
  divisions: 72,
  wormDivisions: 8,
  startAngle: 0,
  endAngle: 360,
  overrunAngle: 10,
  repeatPositions: "0,90,180,270",
  repeatCount: 7,
  dwellTimeMs: 5000,
  controlAxis: "A",
  feedMode: "rapid",
  feedRate: 1000,
  useClamp: false,
};

export interface TargetPoint {
  no: number;
  angle: number;
  direction: "cw" | "ccw";
  phase: "wheel" | "worm" | "repeat";
  trial: number; // 0 for wheel/worm, 1-N for repeat
  status: "pending" | "measured";
}

export interface MeasurementRow {
  no: number;
  targetAngle: number;
  measuredAngle: number;
  errorArcSec: number;
  direction: "cw" | "ccw";
  phase: "wheel" | "worm" | "repeat";
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
  | "auto"
  | "settings"
  | "targets"
  | "data"
  | "results"
  | "report"
  | "repeatability"
  | "help";
