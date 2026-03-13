"use client";

import {
  BarChart3,
  TrendingUp,
  Clock,
  Eye,
  Users,
  AlertTriangle,
  CheckCircle2,
  Activity,
  Layers,
  Target,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";

interface MetricCard {
  label: string;
  value: string;
  change: number;
  changeLabel: string;
  icon: typeof BarChart3;
  color: string;
}

const metrics: MetricCard[] = [
  {
    label: "SOP閲覧数（今月）",
    value: "1,284",
    change: 12.5,
    changeLabel: "前月比",
    icon: Eye,
    color: "#3b82f6",
  },
  {
    label: "平均作業時間",
    value: "48分",
    change: -8.3,
    changeLabel: "前月比",
    icon: Clock,
    color: "#10b981",
  },
  {
    label: "トレーニング完了率",
    value: "87%",
    change: 5.2,
    changeLabel: "前月比",
    icon: Target,
    color: "#8b5cf6",
  },
  {
    label: "不適合発生率",
    value: "2.1%",
    change: -15.0,
    changeLabel: "前月比",
    icon: AlertTriangle,
    color: "#f59e0b",
  },
];

interface BottleneckItem {
  step: string;
  sopName: string;
  avgTime: string;
  expectedTime: string;
  deviation: number;
  frequency: number;
}

const bottlenecks: BottleneckItem[] = [
  {
    step: "Step 3: 回転精度測定",
    sopName: "円テーブル回転精度検査",
    avgTime: "12分30秒",
    expectedTime: "10分",
    deviation: 25,
    frequency: 15,
  },
  {
    step: "Step 5: 割出し精度測定",
    sopName: "円テーブル回転精度検査",
    avgTime: "18分",
    expectedTime: "15分",
    deviation: 20,
    frequency: 12,
  },
  {
    step: "Step 2: ゲージセッティング",
    sopName: "円テーブル回転精度検査",
    avgTime: "4分30秒",
    expectedTime: "3分",
    deviation: 50,
    frequency: 8,
  },
];

interface UsageByDepartment {
  department: string;
  views: number;
  completions: number;
  percentage: number;
}

const departmentUsage: UsageByDepartment[] = [
  { department: "品質管理部", views: 542, completions: 128, percentage: 42 },
  { department: "製造部", views: 389, completions: 95, percentage: 30 },
  { department: "保全部", views: 215, completions: 48, percentage: 17 },
  { department: "技術部", views: 138, completions: 32, percentage: 11 },
];

export default function AnalyticsDashboard() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
          <BarChart3 className="w-6 h-6 text-blue-500" />
          分析レポート
        </h2>
        <div className="flex items-center gap-2">
          <select className="border rounded-lg px-3 py-2 text-sm" style={{ borderColor: "var(--card-border)" }}>
            <option>今月（2026年3月）</option>
            <option>先月（2026年2月）</option>
            <option>過去3ヶ月</option>
            <option>過去6ヶ月</option>
            <option>今年度</option>
          </select>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {metrics.map((metric) => {
          const Icon = metric.icon;
          const isPositive = metric.change > 0;
          const isGoodDirection =
            metric.label.includes("不適合") || metric.label.includes("時間")
              ? !isPositive
              : isPositive;

          return (
            <div key={metric.label} className="card">
              <div className="flex items-center justify-between mb-3">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{ background: metric.color + "15" }}
                >
                  <Icon className="w-5 h-5" style={{ color: metric.color }} />
                </div>
                <div
                  className={`flex items-center gap-1 text-xs font-medium ${
                    isGoodDirection ? "text-green-600" : "text-red-600"
                  }`}
                >
                  {isPositive ? (
                    <ArrowUpRight className="w-3 h-3" />
                  ) : (
                    <ArrowDownRight className="w-3 h-3" />
                  )}
                  {Math.abs(metric.change)}%
                </div>
              </div>
              <p className="text-2xl font-bold text-slate-900">{metric.value}</p>
              <p className="text-xs text-slate-500 mt-1">{metric.label}</p>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Department Usage */}
        <div className="card">
          <h3 className="font-bold text-slate-900 mb-4 flex items-center gap-2">
            <Layers className="w-5 h-5 text-blue-500" />
            部門別SOP利用状況
          </h3>
          <div className="space-y-4">
            {departmentUsage.map((dept) => (
              <div key={dept.department}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-slate-700">{dept.department}</span>
                  <span className="text-sm text-slate-500">
                    {dept.views}閲覧 / {dept.completions}完了
                  </span>
                </div>
                <div className="progress-bar">
                  <div className="progress-bar-fill" style={{ width: `${dept.percentage}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Bottleneck Detection */}
        <div className="card">
          <h3 className="font-bold text-slate-900 mb-4 flex items-center gap-2">
            <Activity className="w-5 h-5 text-amber-500" />
            ボトルネック検出
          </h3>
          <p className="text-xs text-slate-500 mb-4">
            標準時間を大幅に超過しているステップを自動検出します
          </p>
          <div className="space-y-3">
            {bottlenecks.map((bn, i) => (
              <div key={i} className="p-3 bg-amber-50 rounded-lg border border-amber-200">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-amber-900">{bn.step}</span>
                  <span className="badge badge-warning text-xs">+{bn.deviation}%超過</span>
                </div>
                <p className="text-xs text-amber-700 mb-2">{bn.sopName}</p>
                <div className="flex items-center gap-4 text-xs text-amber-800">
                  <span>実測: {bn.avgTime}</span>
                  <span>標準: {bn.expectedTime}</span>
                  <span>発生回数: {bn.frequency}回</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Monthly Trend (Simplified) */}
      <div className="card">
        <h3 className="font-bold text-slate-900 mb-4 flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-green-500" />
          月次トレンド
        </h3>
        <div className="grid grid-cols-6 gap-4">
          {[
            { month: "10月", created: 3, published: 2, views: 856 },
            { month: "11月", created: 5, published: 4, views: 1024 },
            { month: "12月", created: 2, published: 3, views: 945 },
            { month: "1月", created: 4, published: 3, views: 1105 },
            { month: "2月", created: 6, published: 5, views: 1198 },
            { month: "3月", created: 3, published: 1, views: 1284 },
          ].map((m) => (
            <div key={m.month} className="text-center">
              <div className="relative h-32 bg-slate-50 rounded-lg mb-2 flex items-end justify-center gap-1 p-2">
                <div
                  className="w-4 bg-blue-400 rounded-t"
                  style={{ height: `${(m.created / 6) * 100}%` }}
                  title={`作成: ${m.created}`}
                />
                <div
                  className="w-4 bg-green-400 rounded-t"
                  style={{ height: `${(m.published / 5) * 100}%` }}
                  title={`公開: ${m.published}`}
                />
              </div>
              <p className="text-xs font-medium text-slate-600">{m.month}</p>
              <p className="text-xs text-slate-400">{m.views}閲覧</p>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-center gap-6 mt-4 text-xs text-slate-500">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm bg-blue-400" />
            作成数
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm bg-green-400" />
            公開数
          </div>
        </div>
      </div>
    </div>
  );
}
