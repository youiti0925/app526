"use client";

import { useState } from "react";
import {
  GraduationCap,
  Users,
  Award,
  BookOpen,
  Clock,
  CheckCircle2,
  AlertCircle,
  Star,
  TrendingUp,
  BarChart3,
  Plus,
  Send,
  Eye,
  FileText,
  Target,
} from "lucide-react";

interface Trainee {
  id: string;
  name: string;
  department: string;
  role: string;
  skillLevel: "beginner" | "intermediate" | "advanced" | "expert";
  assignedSOPs: AssignedSOP[];
  certifications: Certification[];
  avatarInitial: string;
}

interface AssignedSOP {
  id: string;
  title: string;
  status: "not-started" | "in-progress" | "completed" | "quiz-pending";
  assignedDate: string;
  completedDate?: string;
  progress: number;
  quizScore?: number;
}

interface Certification {
  id: string;
  name: string;
  issuedDate: string;
  expiryDate: string;
  status: "valid" | "expiring-soon" | "expired";
}

interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  correctAnswer: number;
  relatedStep: number;
  difficulty: "easy" | "medium" | "hard";
}

const demoTrainees: Trainee[] = [
  {
    id: "tr-1",
    name: "山田 太郎",
    department: "品質管理部",
    role: "検査員",
    skillLevel: "intermediate",
    avatarInitial: "山",
    assignedSOPs: [
      {
        id: "sop-1",
        title: "円テーブル回転精度検査",
        status: "completed",
        assignedDate: "2026-02-15",
        completedDate: "2026-02-20",
        progress: 100,
        quizScore: 95,
      },
      {
        id: "sop-2",
        title: "円テーブル割出し精度検査",
        status: "in-progress",
        assignedDate: "2026-03-01",
        progress: 60,
      },
    ],
    certifications: [
      {
        id: "cert-1",
        name: "精密測定技能士 2級",
        issuedDate: "2025-06-01",
        expiryDate: "2028-06-01",
        status: "valid",
      },
    ],
  },
  {
    id: "tr-2",
    name: "佐藤 花子",
    department: "品質管理部",
    role: "検査員（新人）",
    skillLevel: "beginner",
    avatarInitial: "佐",
    assignedSOPs: [
      {
        id: "sop-1",
        title: "円テーブル回転精度検査",
        status: "in-progress",
        assignedDate: "2026-03-05",
        progress: 30,
      },
      {
        id: "sop-3",
        title: "基本測定器の使い方",
        status: "completed",
        assignedDate: "2026-02-20",
        completedDate: "2026-02-28",
        progress: 100,
        quizScore: 80,
      },
    ],
    certifications: [],
  },
  {
    id: "tr-3",
    name: "鈴木 一郎",
    department: "製造部",
    role: "組立作業者",
    skillLevel: "advanced",
    avatarInitial: "鈴",
    assignedSOPs: [
      {
        id: "sop-4",
        title: "円テーブル組立手順",
        status: "completed",
        assignedDate: "2026-01-10",
        completedDate: "2026-01-15",
        progress: 100,
        quizScore: 100,
      },
      {
        id: "sop-5",
        title: "定期メンテナンス手順",
        status: "quiz-pending",
        assignedDate: "2026-03-01",
        progress: 100,
      },
    ],
    certifications: [
      {
        id: "cert-2",
        name: "機械組立技能士 1級",
        issuedDate: "2024-04-01",
        expiryDate: "2026-04-01",
        status: "expiring-soon",
      },
    ],
  },
];

const demoQuiz: QuizQuestion[] = [
  {
    id: "q-1",
    question: "テーブル面振れ測定時の回転速度として適切なのはどれですか？",
    options: [
      "約1秒/回転",
      "約5秒/回転",
      "約10秒/回転",
      "速度は関係ない",
    ],
    correctAnswer: 2,
    relatedStep: 3,
    difficulty: "medium",
  },
  {
    id: "q-2",
    question: "検査環境温度の規定範囲は？",
    options: ["15±2℃", "18±2℃", "20±2℃", "25±2℃"],
    correctAnswer: 2,
    relatedStep: 1,
    difficulty: "easy",
  },
  {
    id: "q-3",
    question: "テーブル面振れの合格基準は？",
    options: ["≦0.001mm", "≦0.003mm", "≦0.005mm", "≦0.010mm"],
    correctAnswer: 2,
    relatedStep: 3,
    difficulty: "medium",
  },
  {
    id: "q-4",
    question: "割出し精度の合格基準は？",
    options: ["±5秒", "±10秒", "±15秒", "±30秒"],
    correctAnswer: 1,
    relatedStep: 5,
    difficulty: "easy",
  },
  {
    id: "q-5",
    question: "ダイヤルゲージ測定子の予圧の規定範囲は？",
    options: [
      "0.1〜0.2mm",
      "0.3〜0.5mm",
      "0.5〜1.0mm",
      "予圧は不要",
    ],
    correctAnswer: 1,
    relatedStep: 2,
    difficulty: "hard",
  },
];

const skillLevelConfig = {
  beginner: { label: "初級", color: "#3b82f6", bg: "#dbeafe" },
  intermediate: { label: "中級", color: "#f59e0b", bg: "#fef3c7" },
  advanced: { label: "上級", color: "#10b981", bg: "#d1fae5" },
  expert: { label: "熟練", color: "#8b5cf6", bg: "#ede9fe" },
};

export default function TrainingManagement() {
  const [activeTab, setActiveTab] = useState<"trainees" | "quiz" | "skills">("trainees");
  const [selectedTrainee, setSelectedTrainee] = useState<Trainee | null>(null);
  const [showQuizPreview, setShowQuizPreview] = useState(false);

  const tabs = [
    { id: "trainees" as const, label: "受講者管理", icon: Users },
    { id: "quiz" as const, label: "理解度テスト", icon: Target },
    { id: "skills" as const, label: "スキルマトリクス", icon: Award },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
          <GraduationCap className="w-6 h-6 text-purple-500" />
          トレーニング・スキル管理
        </h2>
        <button className="btn-primary flex items-center gap-2 text-sm">
          <Plus className="w-4 h-4" />
          トレーニング割当
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <div className="card flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-purple-100 flex items-center justify-center">
            <Users className="w-5 h-5 text-purple-600" />
          </div>
          <div>
            <p className="text-xl font-bold text-slate-900">{demoTrainees.length}</p>
            <p className="text-xs text-slate-500">登録受講者</p>
          </div>
        </div>
        <div className="card flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center">
            <CheckCircle2 className="w-5 h-5 text-green-600" />
          </div>
          <div>
            <p className="text-xl font-bold text-slate-900">5</p>
            <p className="text-xs text-slate-500">完了済みSOP</p>
          </div>
        </div>
        <div className="card flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center">
            <BookOpen className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <p className="text-xl font-bold text-slate-900">3</p>
            <p className="text-xs text-slate-500">受講中</p>
          </div>
        </div>
        <div className="card flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center">
            <Star className="w-5 h-5 text-amber-600" />
          </div>
          <div>
            <p className="text-xl font-bold text-slate-900">91.7%</p>
            <p className="text-xs text-slate-500">平均スコア</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b" style={{ borderColor: "var(--card-border)" }}>
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? "border-purple-500 text-purple-600"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Trainees Tab */}
      {activeTab === "trainees" && (
        <div className="space-y-4">
          {demoTrainees.map((trainee) => {
            const skill = skillLevelConfig[trainee.skillLevel];
            return (
              <div key={trainee.id} className="card">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-full bg-blue-500 flex items-center justify-center text-white font-bold text-lg flex-shrink-0">
                    {trainee.avatarInitial}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-1">
                      <h3 className="font-bold text-slate-900">{trainee.name}</h3>
                      <span className="badge text-xs" style={{ background: skill.bg, color: skill.color }}>
                        {skill.label}
                      </span>
                    </div>
                    <p className="text-sm text-slate-500">
                      {trainee.department} | {trainee.role}
                    </p>

                    {/* Certifications */}
                    {trainee.certifications.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        {trainee.certifications.map((cert) => (
                          <span
                            key={cert.id}
                            className={`badge text-xs flex items-center gap-1 ${
                              cert.status === "valid"
                                ? "badge-success"
                                : cert.status === "expiring-soon"
                                ? "badge-warning"
                                : "badge-danger"
                            }`}
                          >
                            <Award className="w-3 h-3" />
                            {cert.name}
                            {cert.status === "expiring-soon" && " (期限間近)"}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Assigned SOPs */}
                    <div className="mt-3 space-y-2">
                      {trainee.assignedSOPs.map((sop) => (
                        <div
                          key={sop.id}
                          className="flex items-center gap-3 p-2 bg-slate-50 rounded-lg"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <FileText className="w-4 h-4 text-slate-400" />
                              <span className="text-sm font-medium text-slate-700 truncate">
                                {sop.title}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 mt-1">
                              <div className="flex-1 progress-bar" style={{ height: "3px" }}>
                                <div
                                  className="progress-bar-fill"
                                  style={{ width: `${sop.progress}%` }}
                                />
                              </div>
                              <span className="text-xs text-slate-400">{sop.progress}%</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {sop.quizScore !== undefined && (
                              <span className="text-xs font-medium text-green-600">
                                テスト: {sop.quizScore}点
                              </span>
                            )}
                            <span
                              className={`badge text-xs ${
                                sop.status === "completed"
                                  ? "badge-success"
                                  : sop.status === "in-progress"
                                  ? "badge-info"
                                  : sop.status === "quiz-pending"
                                  ? "badge-warning"
                                  : ""
                              }`}
                              style={
                                sop.status === "not-started"
                                  ? { background: "#f1f5f9", color: "#64748b" }
                                  : {}
                              }
                            >
                              {sop.status === "completed"
                                ? "完了"
                                : sop.status === "in-progress"
                                ? "受講中"
                                : sop.status === "quiz-pending"
                                ? "テスト待ち"
                                : "未開始"}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Quiz Tab */}
      {activeTab === "quiz" && (
        <div className="card">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="font-bold text-slate-900">理解度テスト（自動生成）</h3>
              <p className="text-sm text-slate-500 mt-1">
                AIが作業標準書の内容から自動的に理解度確認テストを生成します
              </p>
            </div>
            <button className="btn-primary flex items-center gap-2 text-sm">
              <Send className="w-4 h-4" />
              テストを配信
            </button>
          </div>

          <div className="space-y-4">
            {demoQuiz.map((q, i) => {
              const difficultyConfig = {
                easy: { label: "易", color: "#10b981", bg: "#d1fae5" },
                medium: { label: "普通", color: "#f59e0b", bg: "#fef3c7" },
                hard: { label: "難", color: "#ef4444", bg: "#fee2e2" },
              };
              const diff = difficultyConfig[q.difficulty];

              return (
                <div key={q.id} className="p-4 border rounded-lg" style={{ borderColor: "var(--card-border)" }}>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="w-7 h-7 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center text-sm font-bold">
                      {i + 1}
                    </span>
                    <span className="badge text-xs" style={{ background: diff.bg, color: diff.color }}>
                      {diff.label}
                    </span>
                    <span className="text-xs text-slate-400">Step {q.relatedStep} 関連</span>
                  </div>
                  <p className="font-medium text-slate-900 mb-3">{q.question}</p>
                  <div className="grid grid-cols-2 gap-2">
                    {q.options.map((opt, j) => (
                      <div
                        key={j}
                        className={`p-2.5 rounded-lg border text-sm ${
                          j === q.correctAnswer
                            ? "border-green-300 bg-green-50 text-green-700 font-medium"
                            : "border-slate-200 text-slate-600"
                        }`}
                      >
                        <span className="text-xs text-slate-400 mr-2">
                          {String.fromCharCode(65 + j)}.
                        </span>
                        {opt}
                        {j === q.correctAnswer && (
                          <CheckCircle2 className="w-4 h-4 text-green-500 inline ml-2" />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Skills Matrix Tab */}
      {activeTab === "skills" && (
        <div className="card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b" style={{ borderColor: "var(--card-border)" }}>
                  <th className="text-left px-4 py-3 font-semibold text-slate-600">作業者</th>
                  <th className="text-center px-4 py-3 font-semibold text-slate-600">回転精度検査</th>
                  <th className="text-center px-4 py-3 font-semibold text-slate-600">割出し精度検査</th>
                  <th className="text-center px-4 py-3 font-semibold text-slate-600">組立作業</th>
                  <th className="text-center px-4 py-3 font-semibold text-slate-600">メンテナンス</th>
                  <th className="text-center px-4 py-3 font-semibold text-slate-600">総合レベル</th>
                </tr>
              </thead>
              <tbody>
                {[
                  {
                    name: "山田 太郎",
                    skills: [3, 2, 1, 1],
                    level: "intermediate",
                  },
                  {
                    name: "佐藤 花子",
                    skills: [1, 0, 0, 0],
                    level: "beginner",
                  },
                  {
                    name: "鈴木 一郎",
                    skills: [2, 2, 4, 3],
                    level: "advanced",
                  },
                ].map((person) => {
                  const level = skillLevelConfig[person.level as keyof typeof skillLevelConfig];
                  return (
                    <tr
                      key={person.name}
                      className="border-b"
                      style={{ borderColor: "var(--card-border)" }}
                    >
                      <td className="px-4 py-3 font-medium text-slate-900">{person.name}</td>
                      {person.skills.map((s, i) => (
                        <td key={i} className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center gap-0.5">
                            {[1, 2, 3, 4].map((star) => (
                              <Star
                                key={star}
                                className={`w-4 h-4 ${
                                  star <= s
                                    ? "text-amber-400 fill-amber-400"
                                    : "text-slate-200"
                                }`}
                              />
                            ))}
                          </div>
                        </td>
                      ))}
                      <td className="px-4 py-3 text-center">
                        <span
                          className="badge text-xs"
                          style={{ background: level.bg, color: level.color }}
                        >
                          {level.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
