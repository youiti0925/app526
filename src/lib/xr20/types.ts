export interface XR20Settings {
  // Machine info
  machineName: string;
  ncModel: string;

  // Gear parameters
  wheelTeeth: number;
  wormLeads: number;

  // Evaluation parameters
  wheelDivisions: number;
  wormDivisions: number;
  wormStartPosition: number;

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
  machineName: "",
  ncModel: "FANUC",
  wheelTeeth: 60,
  wormLeads: 1,
  wheelDivisions: 36,
  wormDivisions: 10,
  wormStartPosition: 0,
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
  category: "wheel" | "worm";
  status: "pending" | "measured";
}

export interface MeasurementRow {
  no: number;
  targetAngle: number;
  measuredAngle: number;
  errorArcSec: number;
  category: "wheel" | "worm";
}

export interface EvaluationStats {
  maxError: number;
  minError: number;
  meanError: number;
  sigma: number;
  indexAccuracy: number; // max - min
  count: number;
}

export type XR20Tab =
  | "settings"
  | "targets"
  | "control"
  | "data"
  | "results"
  | "report";
