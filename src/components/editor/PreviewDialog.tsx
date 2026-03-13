"use client";

import { X, Printer, Download, ZoomIn, ZoomOut } from "lucide-react";
import type { WorkStandard } from "@/types";
import { useState } from "react";

interface PreviewDialogProps {
  isOpen: boolean;
  onClose: () => void;
  workStandard: WorkStandard;
}

export default function PreviewDialog({ isOpen, onClose, workStandard }: PreviewDialogProps) {
  const [zoom, setZoom] = useState(100);

  if (!isOpen) return null;

  const totalTime = workStandard.steps.reduce((sum, s) => sum + s.estimatedTime, 0);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[95vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: "var(--card-border)" }}>
          <h2 className="text-lg font-bold text-slate-900">印刷プレビュー</h2>
          <div className="flex items-center gap-2">
            <button onClick={() => setZoom(Math.max(50, zoom - 10))} className="p-1.5 hover:bg-slate-100 rounded">
              <ZoomOut className="w-4 h-4 text-slate-600" />
            </button>
            <span className="text-sm text-slate-500 w-12 text-center">{zoom}%</span>
            <button onClick={() => setZoom(Math.min(150, zoom + 10))} className="p-1.5 hover:bg-slate-100 rounded">
              <ZoomIn className="w-4 h-4 text-slate-600" />
            </button>
            <button className="btn-secondary flex items-center gap-1.5 text-sm ml-4">
              <Printer className="w-4 h-4" />
              印刷
            </button>
            <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg">
              <X className="w-5 h-5 text-slate-400" />
            </button>
          </div>
        </div>

        {/* Preview Content */}
        <div className="flex-1 overflow-y-auto bg-slate-200 p-8">
          <div
            className="bg-white mx-auto shadow-lg"
            style={{
              width: `${(210 * zoom) / 100}mm`,
              minHeight: `${(297 * zoom) / 100}mm`,
              padding: `${(15 * zoom) / 100}mm`,
              fontSize: `${(zoom / 100) * 0.875}rem`,
            }}
          >
            {/* Document Header */}
            <div className="border-2 border-slate-800 mb-4">
              <div className="grid grid-cols-3 border-b-2 border-slate-800">
                <div className="p-2 border-r-2 border-slate-800 text-center">
                  <p className="text-xs text-slate-500">文書番号</p>
                  <p className="font-bold">{workStandard.documentNumber}</p>
                </div>
                <div className="p-2 border-r-2 border-slate-800 text-center">
                  <p className="text-xs text-slate-500">版数</p>
                  <p className="font-bold">Rev.{workStandard.version}</p>
                </div>
                <div className="p-2 text-center">
                  <p className="text-xs text-slate-500">発行日</p>
                  <p className="font-bold">{new Date(workStandard.updatedAt).toLocaleDateString("ja-JP")}</p>
                </div>
              </div>
              <div className="p-3 text-center border-b-2 border-slate-800">
                <h1 className="text-xl font-bold">作 業 標 準 書</h1>
                <p className="text-lg font-bold mt-1">{workStandard.title}</p>
              </div>
              <div className="grid grid-cols-4 text-sm">
                <div className="p-2 border-r border-slate-400">
                  <p className="text-xs text-slate-500">工程名</p>
                  <p className="font-medium">{workStandard.header.processName}</p>
                </div>
                <div className="p-2 border-r border-slate-400">
                  <p className="text-xs text-slate-500">機械型式</p>
                  <p className="font-medium">{workStandard.header.machineModel}</p>
                </div>
                <div className="p-2 border-r border-slate-400">
                  <p className="text-xs text-slate-500">部門</p>
                  <p className="font-medium">{workStandard.header.department}</p>
                </div>
                <div className="p-2">
                  <p className="text-xs text-slate-500">総作業時間</p>
                  <p className="font-medium">{Math.floor(totalTime / 60)}分</p>
                </div>
              </div>
            </div>

            {/* Safety Notes */}
            {workStandard.safetyNotes.length > 0 && (
              <div className="border border-red-300 rounded mb-4 p-3 bg-red-50">
                <h3 className="font-bold text-red-700 text-sm mb-2">安全注意事項</h3>
                <ul className="text-xs text-red-700 space-y-1">
                  {workStandard.safetyNotes.map((note) => (
                    <li key={note.id}>&#9888; {note.title}: {note.description}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Required PPE */}
            <div className="mb-4">
              <h3 className="font-bold text-sm mb-1">必要保護具:</h3>
              <p className="text-sm">{workStandard.header.requiredPPE.join("、")}</p>
            </div>

            {/* Steps */}
            <div className="space-y-3">
              {workStandard.steps.map((step) => (
                <div key={step.id} className="border border-slate-300 rounded">
                  <div className="flex items-center gap-2 bg-slate-100 px-3 py-2 border-b border-slate-300">
                    <span className="bg-blue-600 text-white w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold">
                      {step.stepNumber}
                    </span>
                    <h4 className="font-bold text-sm flex-1">{step.title}</h4>
                    <span className="text-xs text-slate-500">
                      {Math.floor(step.estimatedTime / 60)}分{step.estimatedTime % 60 > 0 ? `${step.estimatedTime % 60}秒` : ""}
                    </span>
                  </div>
                  <div className="p-3 text-sm">
                    <div className="grid grid-cols-3 gap-3">
                      <div className="col-span-2">
                        <p className="text-slate-700 mb-2">{step.description}</p>
                        <pre className="text-xs text-slate-600 whitespace-pre-wrap bg-slate-50 p-2 rounded">
                          {step.detailedInstructions}
                        </pre>
                        {step.keyPoints.length > 0 && (
                          <div className="mt-2">
                            <p className="text-xs font-bold text-amber-700">ポイント:</p>
                            <ul className="text-xs text-amber-700">
                              {step.keyPoints.map((kp, i) => (
                                <li key={i}>&#9679; {kp}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {step.cautions.length > 0 && (
                          <div className="mt-2 bg-red-50 p-2 rounded">
                            <p className="text-xs font-bold text-red-700">注意:</p>
                            <ul className="text-xs text-red-600">
                              {step.cautions.map((c, i) => (
                                <li key={i}>&#9888; {c}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                      <div className="bg-slate-100 rounded flex items-center justify-center text-xs text-slate-400 h-24">
                        画像
                      </div>
                    </div>
                    {step.measurements && step.measurements.length > 0 && (
                      <div className="mt-2 border-t pt-2" style={{ borderColor: "var(--card-border)" }}>
                        <p className="text-xs font-bold mb-1">測定基準:</p>
                        {step.measurements.map((m, i) => (
                          <span key={i} className="text-xs text-slate-600 mr-3">
                            {m.parameter}: {m.nominalValue}{m.unit} (+{m.tolerance.upper}/{m.tolerance.lower})
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Quality Checkpoints */}
            {workStandard.qualityCheckpoints.length > 0 && (
              <div className="mt-4 border border-slate-300 rounded">
                <div className="bg-green-50 px-3 py-2 border-b border-slate-300">
                  <h3 className="font-bold text-sm text-green-800">品質チェックポイント</h3>
                </div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50">
                      <th className="px-2 py-1.5 text-left">検査項目</th>
                      <th className="px-2 py-1.5 text-left">基準</th>
                      <th className="px-2 py-1.5 text-left">測定器</th>
                      <th className="px-2 py-1.5 text-center">合否</th>
                    </tr>
                  </thead>
                  <tbody>
                    {workStandard.qualityCheckpoints.map((qc) => (
                      <tr key={qc.id} className="border-t border-slate-200">
                        <td className="px-2 py-1.5">{qc.checkItem}</td>
                        <td className="px-2 py-1.5">{qc.standard}</td>
                        <td className="px-2 py-1.5">{qc.measuringInstrument}</td>
                        <td className="px-2 py-1.5 text-center">&#9744;</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Approval Section */}
            <div className="mt-6 border-t-2 border-slate-800 pt-3">
              <div className="grid grid-cols-4 gap-4 text-sm">
                <div className="border border-slate-400 p-2 text-center">
                  <p className="text-xs text-slate-500">作成者</p>
                  <div className="h-8" />
                </div>
                <div className="border border-slate-400 p-2 text-center">
                  <p className="text-xs text-slate-500">確認者</p>
                  <div className="h-8" />
                </div>
                <div className="border border-slate-400 p-2 text-center">
                  <p className="text-xs text-slate-500">承認者</p>
                  <div className="h-8" />
                  {workStandard.approvedBy && (
                    <p className="text-xs text-green-600">{workStandard.approvedBy}</p>
                  )}
                </div>
                <div className="border border-slate-400 p-2 text-center">
                  <p className="text-xs text-slate-500">日付</p>
                  <div className="h-8" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
