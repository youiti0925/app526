"use client";

import { useState } from "react";
import { MessageCircle, AlertTriangle, Lightbulb, ThumbsUp, Send, X } from "lucide-react";

interface FeedbackItem {
  id: string;
  stepNumber: number;
  type: "unclear" | "improvement" | "safety" | "praise";
  message: string;
  author: string;
  createdAt: string;
}

interface StepFeedbackProps {
  stepNumber: number;
  stepTitle: string;
  projectId: string;
}

const FEEDBACK_KEY = "videosop-feedback";

function getFeedback(projectId: string, stepNumber: number): FeedbackItem[] {
  if (typeof window === "undefined") return [];
  try {
    const all = JSON.parse(localStorage.getItem(FEEDBACK_KEY) || "{}");
    return (all[`${projectId}-${stepNumber}`] || []) as FeedbackItem[];
  } catch { return []; }
}

function saveFeedbackItem(projectId: string, stepNumber: number, item: FeedbackItem) {
  if (typeof window === "undefined") return;
  const all = JSON.parse(localStorage.getItem(FEEDBACK_KEY) || "{}");
  const key = `${projectId}-${stepNumber}`;
  if (!all[key]) all[key] = [];
  all[key].push(item);
  localStorage.setItem(FEEDBACK_KEY, JSON.stringify(all));
}

const feedbackTypes = [
  { type: "unclear" as const, label: "不明確", icon: AlertTriangle, color: "#f59e0b", bgColor: "#fef3c7" },
  { type: "improvement" as const, label: "改善提案", icon: Lightbulb, color: "#3b82f6", bgColor: "#dbeafe" },
  { type: "safety" as const, label: "安全懸念", icon: AlertTriangle, color: "#ef4444", bgColor: "#fee2e2" },
  { type: "praise" as const, label: "良い", icon: ThumbsUp, color: "#10b981", bgColor: "#d1fae5" },
];

export default function StepFeedback({ stepNumber, stepTitle, projectId }: StepFeedbackProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [feedbackList, setFeedbackList] = useState<FeedbackItem[]>(() => getFeedback(projectId, stepNumber));
  const [selectedType, setSelectedType] = useState<FeedbackItem["type"]>("improvement");
  const [message, setMessage] = useState("");

  const handleSubmit = () => {
    if (!message.trim()) return;
    const item: FeedbackItem = {
      id: crypto.randomUUID(),
      stepNumber,
      type: selectedType,
      message: message.trim(),
      author: "作業者",
      createdAt: new Date().toISOString(),
    };
    saveFeedbackItem(projectId, stepNumber, item);
    setFeedbackList([...feedbackList, item]);
    setMessage("");
  };

  return (
    <div className="mt-2">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-blue-500 transition-colors"
      >
        <MessageCircle className="w-3.5 h-3.5" />
        フィードバック{feedbackList.length > 0 && ` (${feedbackList.length})`}
      </button>

      {isOpen && (
        <div className="mt-2 border rounded-lg p-3 bg-slate-50" style={{ borderColor: "var(--card-border)" }}>
          {/* Existing feedback */}
          {feedbackList.length > 0 && (
            <div className="space-y-2 mb-3">
              {feedbackList.map((fb) => {
                const typeInfo = feedbackTypes.find((t) => t.type === fb.type)!;
                const Icon = typeInfo.icon;
                return (
                  <div key={fb.id} className="flex items-start gap-2 text-xs p-2 rounded" style={{ background: typeInfo.bgColor }}>
                    <Icon className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" style={{ color: typeInfo.color }} />
                    <div>
                      <span className="font-medium" style={{ color: typeInfo.color }}>{typeInfo.label}</span>
                      <span className="text-slate-500 ml-2">{fb.author}</span>
                      <p className="text-slate-700 mt-0.5">{fb.message}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Add feedback */}
          <div className="space-y-2">
            <div className="flex gap-1">
              {feedbackTypes.map((ft) => {
                const Icon = ft.icon;
                return (
                  <button
                    key={ft.type}
                    onClick={() => setSelectedType(ft.type)}
                    className={`flex items-center gap-1 text-xs px-2 py-1 rounded-full border transition-colors ${
                      selectedType === ft.type ? "border-current" : "border-transparent"
                    }`}
                    style={{
                      background: selectedType === ft.type ? ft.bgColor : "white",
                      color: selectedType === ft.type ? ft.color : "#94a3b8",
                    }}
                  >
                    <Icon className="w-3 h-3" />
                    {ft.label}
                  </button>
                );
              })}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                placeholder="コメントを入力..."
                className="flex-1 border rounded px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-blue-400"
                style={{ borderColor: "var(--card-border)" }}
              />
              <button
                onClick={handleSubmit}
                disabled={!message.trim()}
                className="p-1 rounded hover:bg-blue-50 disabled:opacity-30"
              >
                <Send className="w-3.5 h-3.5 text-blue-500" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
