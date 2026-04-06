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

  // CARTO自動操作
  cartoExePath: string;          // CARTO実行ファイルパス
  cartoAutoSetup: boolean;       // CARTO自動セットアップ有効
  initialDwellSec: number;       // NCプログラム先頭のCARTO準備待ちドゥエル（秒）

  // SwitchBot連携（自動リトライ用）
  switchbotToken: string;        // SwitchBot APIトークン
  switchbotSecret: string;       // SwitchBot APIシークレット
  switchbotDeviceId: string;     // SwitchBotデバイスID（ボタン押下用）

  // 自動監視設定
  monitorThresholdHR: number;    // HR/HL 傾き閾値（秒）— これ以上で失敗
  monitorThresholdWR: number;    // WR/WL 傾き閾値（秒）— これ以上で失敗
  monitorWaitMin: number;        // 測定待ち時間（分）
  monitorAppTitle: string;       // 監視対象アプリのウィンドウタイトル
  monitorCaptureButtonName: string; // 取込開始ボタンの名前
  monitorTargetRows: string;     // 監視対象行（カンマ区切り: "HR,WR,WL,HL"）
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
  cartoExePath: "C:\\Program Files\\Renishaw\\CARTO\\CARTO.exe",
  cartoAutoSetup: true,
  initialDwellSec: 60,

  switchbotToken: "",
  switchbotSecret: "",
  switchbotDeviceId: "",

  monitorThresholdHR: 4,
  monitorThresholdWR: 7,
  monitorWaitMin: 5,
  monitorAppTitle: "IK220分割測定KWIN10",
  monitorCaptureButtonName: "取込開始",
  monitorTargetRows: "HR,WR,WL,HL",
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
  | "monitor"
  | "settings"
  | "targets"
  | "data"
  | "results"
  | "report"
  | "repeatability"
  | "help";
