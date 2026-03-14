export interface Project {
  id: string;
  name: string;
  description: string;
  category: ProjectCategory;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
  videoFile?: VideoFile;
  workStandard?: WorkStandard;
  tags: string[];
  assignee?: string;
  department?: string;
  machineModel?: string;
  inspectionType?: string;
}

export type ProjectCategory =
  | "inspection"
  | "assembly"
  | "maintenance"
  | "setup"
  | "quality-check"
  | "other";

export type ProjectStatus =
  | "draft"
  | "video-uploaded"
  | "analyzing"
  | "analyzed"
  | "editing"
  | "review"
  | "approved"
  | "published";

export interface VideoFile {
  id: string;
  fileName: string;
  fileSize: number;
  duration: number;
  resolution: { width: number; height: number };
  thumbnailUrl: string;
  videoUrl: string;
  uploadedAt: string;
}

export interface WorkStandard {
  id: string;
  projectId: string;
  title: string;
  documentNumber: string;
  version: string;
  revisionHistory: RevisionEntry[];
  header: WorkStandardHeader;
  steps: WorkStep[];
  safetyNotes: SafetyNote[];
  qualityCheckpoints: QualityCheckpoint[];
  toolsRequired: ToolItem[];
  estimatedTotalTime: number;
  createdAt: string;
  updatedAt: string;
  approvedBy?: string;
  approvedAt?: string;
}

export interface WorkStandardHeader {
  processName: string;
  machineName: string;
  machineModel: string;
  department: string;
  applicableProducts: string[];
  requiredSkillLevel: SkillLevel;
  requiredPPE: string[];
  prerequisites: string[];
}

export type SkillLevel = "beginner" | "intermediate" | "advanced" | "expert";

export interface RevisionEntry {
  version: string;
  date: string;
  author: string;
  changes: string;
}

export interface WorkStep {
  id: string;
  stepNumber: number;
  title: string;
  description: string;
  detailedInstructions: string;
  keyPoints: string[];
  cautions: string[];
  thumbnailUrl: string;
  videoTimestamp: { start: number; end: number };
  estimatedTime: number;
  tools: string[];
  measurements?: MeasurementSpec[];
  annotations: Annotation[];
  qualityCheck?: string;
  safetyWarning?: string;
  category: StepCategory;
}

export type StepCategory =
  | "preparation"
  | "operation"
  | "inspection"
  | "measurement"
  | "adjustment"
  | "cleanup"
  | "safety-check";

export interface MeasurementSpec {
  parameter: string;
  nominalValue: number;
  tolerance: { upper: number; lower: number };
  unit: string;
  instrument: string;
}

export interface Annotation {
  id: string;
  type: AnnotationType;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  color: string;
}

export type AnnotationType =
  | "arrow"
  | "rectangle"
  | "circle"
  | "text"
  | "measurement"
  | "warning"
  | "tool-highlight";

export interface SafetyNote {
  id: string;
  severity: "info" | "caution" | "warning" | "danger";
  title: string;
  description: string;
  relatedSteps: number[];
  icon: string;
}

export interface QualityCheckpoint {
  id: string;
  stepNumber: number;
  checkItem: string;
  method: string;
  standard: string;
  acceptanceCriteria: string;
  measuringInstrument: string;
  frequency: string;
  recordRequired: boolean;
}

export interface ToolItem {
  id: string;
  name: string;
  specification: string;
  quantity: number;
  category: "measuring" | "hand-tool" | "power-tool" | "fixture" | "consumable" | "ppe";
  imageUrl?: string;
}

export interface AnalysisResult {
  scenes: DetectedScene[];
  ocrTexts: OcrResult[];
  detectedTools: string[];
  detectedActions: string[];
  suggestedSteps: SuggestedStep[];
  processingTime: number;
}

export interface DetectedScene {
  id: string;
  startTime: number;
  endTime: number;
  description: string;
  confidence: number;
  thumbnailUrl: string;
  category: StepCategory;
}

export interface OcrResult {
  timestamp: number;
  text: string;
  boundingBox: { x: number; y: number; width: number; height: number };
  confidence: number;
}

export interface SuggestedStep {
  title: string;
  description: string;
  keyPoints: string[];
  startTime: number;
  endTime: number;
  category: StepCategory;
  confidence: number;
}

export type DetailLevel = "sop" | "work-instruction";

export interface ExportOptions {
  format: "pdf" | "excel" | "word" | "html";
  includeImages: boolean;
  includeVideoLinks: boolean;
  language: "ja" | "en" | "zh" | "ko" | "vi" | "th";
  template: "standard" | "detailed" | "simplified" | "training";
  paperSize: "A4" | "A3" | "Letter";
  orientation: "portrait" | "landscape";
  includeQRCode: boolean;
  includeRevisionHistory: boolean;
  detailLevel: DetailLevel;
  companyTemplateId?: string;
}

export interface CompanyTemplate {
  id: string;
  name: string;
  description: string;
  category: ProjectCategory;
  format: "pdf" | "excel" | "word";
  sections: TemplateSectionConfig[];
  headerFields: TemplateFieldMapping[];
  footerText: string;
  logoUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateSectionConfig {
  id: string;
  name: string;
  enabled: boolean;
  order: number;
  type: "header" | "steps" | "safety" | "quality" | "tools" | "revision-history" | "approval" | "custom";
  customContent?: string;
}

export interface TemplateFieldMapping {
  fieldId: string;
  label: string;
  source: "auto" | "manual";
  value?: string;
}

export interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  correctAnswer: number;
  relatedStepNumber: number;
  difficulty: "easy" | "medium" | "hard";
  explanation: string;
}

export interface RevisionSnapshot {
  id: string;
  version: string;
  date: string;
  author: string;
  workStandard: WorkStandard;
}

export interface StepDiff {
  stepNumber: number;
  field: string;
  oldValue: string;
  newValue: string;
  changeType: "added" | "removed" | "modified";
}

export interface DashboardStats {
  totalProjects: number;
  publishedStandards: number;
  pendingReview: number;
  activeAnalysis: number;
  recentActivity: ActivityItem[];
}

export interface ActivityItem {
  id: string;
  type: "created" | "updated" | "published" | "reviewed" | "exported";
  projectName: string;
  projectId: string;
  user: string;
  timestamp: string;
  details: string;
}

export interface Template {
  id: string;
  name: string;
  description: string;
  category: ProjectCategory;
  presetSteps: Partial<WorkStep>[];
  presetSafetyNotes: Partial<SafetyNote>[];
  presetTools: Partial<ToolItem>[];
  presetQualityCheckpoints: Partial<QualityCheckpoint>[];
}
