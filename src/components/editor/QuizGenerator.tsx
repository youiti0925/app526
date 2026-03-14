"use client";

import { useState, useMemo } from "react";
import {
  Brain,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Send,
  Target,
  Lightbulb,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  Shuffle,
} from "lucide-react";
import type { WorkStandard, QuizQuestion } from "@/types";

interface QuizGeneratorProps {
  workStandard: WorkStandard;
}

function generateQuizFromSOP(ws: WorkStandard): QuizQuestion[] {
  const questions: QuizQuestion[] = [];

  // Generate questions from steps
  ws.steps.forEach((step) => {
    // Question about step order/purpose
    if (step.description) {
      questions.push({
        id: `q-step-${step.stepNumber}`,
        question: `「${step.title}」の作業で最も重要なポイントは何ですか？`,
        options: [
          step.keyPoints[0] || step.description,
          ...(step.cautions.length > 0
            ? [step.cautions[0]]
            : [`作業時間を${step.estimatedTime}秒以内に収める`]),
          `特に注意点はない`,
          `前工程の確認のみ`,
        ].slice(0, 4),
        correctAnswer: 0,
        relatedStepNumber: step.stepNumber,
        difficulty: "easy",
        explanation: `「${step.title}」では、${step.keyPoints[0] || step.description}が最重要ポイントです。`,
      });
    }

    // Question about cautions
    if (step.cautions.length > 0) {
      questions.push({
        id: `q-caution-${step.stepNumber}`,
        question: `ステップ${step.stepNumber}「${step.title}」で注意すべき事項はどれですか？`,
        options: [
          step.cautions[0],
          "特に注意事項はない",
          "作業速度を上げること",
          "工具の使用は不要",
        ],
        correctAnswer: 0,
        relatedStepNumber: step.stepNumber,
        difficulty: "medium",
        explanation: `この作業では「${step.cautions[0]}」に注意が必要です。`,
      });
    }

    // Questions about measurements
    if (step.measurements && step.measurements.length > 0) {
      step.measurements.forEach((m) => {
        const wrongValues = [
          `${m.nominalValue * 2} ${m.unit}`,
          `${m.nominalValue / 2} ${m.unit}`,
          `${m.nominalValue * 10} ${m.unit}`,
        ];
        questions.push({
          id: `q-meas-${step.stepNumber}-${m.parameter}`,
          question: `「${m.parameter}」の基準値はいくつですか？`,
          options: [
            `${m.nominalValue} ${m.unit}（公差: +${m.tolerance.upper}/${m.tolerance.lower}）`,
            wrongValues[0],
            wrongValues[1],
            wrongValues[2],
          ],
          correctAnswer: 0,
          relatedStepNumber: step.stepNumber,
          difficulty: "medium",
          explanation: `${m.parameter}の基準値は${m.nominalValue}${m.unit}、公差は+${m.tolerance.upper}/${m.tolerance.lower}です。測定器: ${m.instrument}`,
        });
      });
    }

    // Questions about tools
    if (step.tools.length > 0) {
      questions.push({
        id: `q-tools-${step.stepNumber}`,
        question: `ステップ${step.stepNumber}「${step.title}」で使用する工具として正しいのはどれですか？`,
        options: [
          step.tools.join("、"),
          "素手で作業する",
          "工具は不要",
          "任意の工具を使用",
        ],
        correctAnswer: 0,
        relatedStepNumber: step.stepNumber,
        difficulty: "easy",
        explanation: `この作業では${step.tools.join("、")}を使用します。`,
      });
    }
  });

  // Generate questions from safety notes
  ws.safetyNotes.forEach((note, i) => {
    questions.push({
      id: `q-safety-${i}`,
      question: `安全事項「${note.title}」の重要度レベルはどれですか？`,
      options: [
        note.severity === "danger" ? "危険" : note.severity === "warning" ? "警告" : note.severity === "caution" ? "注意" : "情報",
        "参考情報のみ",
        "任意の確認事項",
        "該当なし",
      ],
      correctAnswer: 0,
      relatedStepNumber: note.relatedSteps[0] || 1,
      difficulty: "easy",
      explanation: `「${note.title}」は${note.severity === "danger" ? "危険" : note.severity === "warning" ? "警告" : note.severity === "caution" ? "注意" : "情報"}レベルの安全事項です。${note.description}`,
    });
  });

  // Generate questions from quality checkpoints
  ws.qualityCheckpoints.forEach((qc) => {
    questions.push({
      id: `q-quality-${qc.id}`,
      question: `品質チェック「${qc.checkItem}」の合格基準はどれですか？`,
      options: [
        qc.acceptanceCriteria,
        "目視確認のみ",
        "基準は設定されていない",
        "作業者の判断に委ねる",
      ],
      correctAnswer: 0,
      relatedStepNumber: qc.stepNumber,
      difficulty: "hard",
      explanation: `「${qc.checkItem}」の合格基準は「${qc.acceptanceCriteria}」です。測定方法: ${qc.method}、測定器: ${qc.measuringInstrument}`,
    });
  });

  // General knowledge question about PPE
  if (ws.header.requiredPPE.length > 0) {
    questions.push({
      id: "q-ppe",
      question: "この作業で必要な保護具として正しいのはどれですか？",
      options: [
        ws.header.requiredPPE.join("、"),
        "保護具は不要",
        "安全靴のみ",
        "ヘルメットのみ",
      ],
      correctAnswer: 0,
      relatedStepNumber: 1,
      difficulty: "easy",
      explanation: `この作業では${ws.header.requiredPPE.join("、")}が必要です。`,
    });
  }

  // Shuffle options for each question (except keeping track of correct answer)
  return questions.map((q) => {
    const entries = q.options.map((opt, idx) => ({ opt, isCorrect: idx === q.correctAnswer }));
    // Fisher-Yates shuffle
    for (let i = entries.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [entries[i], entries[j]] = [entries[j], entries[i]];
    }
    return {
      ...q,
      options: entries.map((e) => e.opt),
      correctAnswer: entries.findIndex((e) => e.isCorrect),
    };
  });
}

const difficultyConfig = {
  easy: { label: "易", color: "#10b981", bg: "#d1fae5" },
  medium: { label: "普通", color: "#f59e0b", bg: "#fef3c7" },
  hard: { label: "難", color: "#ef4444", bg: "#fee2e2" },
};

export default function QuizGenerator({ workStandard }: QuizGeneratorProps) {
  const [quizQuestions, setQuizQuestions] = useState<QuizQuestion[]>([]);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, number>>({});
  const [showResults, setShowResults] = useState(false);
  const [expandedExplanations, setExpandedExplanations] = useState<Set<string>>(new Set());
  const [filterDifficulty, setFilterDifficulty] = useState<"all" | "easy" | "medium" | "hard">("all");
  const [quizMode, setQuizMode] = useState<"edit" | "test">("edit");

  const handleGenerate = () => {
    const questions = generateQuizFromSOP(workStandard);
    setQuizQuestions(questions);
    setSelectedAnswers({});
    setShowResults(false);
    setExpandedExplanations(new Set());
  };

  const handleRegenerate = () => {
    handleGenerate();
  };

  const filteredQuestions = useMemo(() => {
    if (filterDifficulty === "all") return quizQuestions;
    return quizQuestions.filter((q) => q.difficulty === filterDifficulty);
  }, [quizQuestions, filterDifficulty]);

  const handleAnswer = (questionId: string, answerIndex: number) => {
    if (showResults) return;
    setSelectedAnswers({ ...selectedAnswers, [questionId]: answerIndex });
  };

  const handleSubmitQuiz = () => {
    setShowResults(true);
  };

  const toggleExplanation = (questionId: string) => {
    const newSet = new Set(expandedExplanations);
    if (newSet.has(questionId)) {
      newSet.delete(questionId);
    } else {
      newSet.add(questionId);
    }
    setExpandedExplanations(newSet);
  };

  const score = useMemo(() => {
    if (!showResults || filteredQuestions.length === 0) return null;
    const correct = filteredQuestions.filter(
      (q) => selectedAnswers[q.id] === q.correctAnswer
    ).length;
    return {
      correct,
      total: filteredQuestions.length,
      percentage: Math.round((correct / filteredQuestions.length) * 100),
    };
  }, [showResults, filteredQuestions, selectedAnswers]);

  const answeredCount = Object.keys(selectedAnswers).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <Brain className="w-5 h-5 text-purple-500" />
            AI理解度クイズ自動生成
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            作業標準書の内容からAIが自動的に理解度確認テストを生成します
          </p>
        </div>
        <div className="flex items-center gap-2">
          {quizQuestions.length > 0 && (
            <button
              onClick={handleRegenerate}
              className="btn-secondary flex items-center gap-1.5 text-sm"
            >
              <Shuffle className="w-4 h-4" />
              再生成
            </button>
          )}
          <button
            onClick={handleGenerate}
            className="btn-primary flex items-center gap-1.5 text-sm"
          >
            <Brain className="w-4 h-4" />
            {quizQuestions.length > 0 ? "クイズを更新" : "クイズを生成"}
          </button>
        </div>
      </div>

      {quizQuestions.length === 0 ? (
        <div className="card text-center py-12">
          <Target className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <h3 className="font-bold text-slate-900 mb-2">クイズを生成してください</h3>
          <p className="text-sm text-slate-500 mb-4">
            「{workStandard.title}」の内容から理解度確認クイズを自動生成します。
            <br />
            作業ステップ、安全事項、品質基準、測定仕様などから出題されます。
          </p>
          <button onClick={handleGenerate} className="btn-primary text-sm inline-flex items-center gap-1.5">
            <Brain className="w-4 h-4" />
            クイズを生成する
          </button>
        </div>
      ) : (
        <>
          {/* Quiz Controls */}
          <div className="card flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-500">難易度:</span>
                {(["all", "easy", "medium", "hard"] as const).map((level) => (
                  <button
                    key={level}
                    onClick={() => setFilterDifficulty(level)}
                    className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                      filterDifficulty === level
                        ? level === "all"
                          ? "bg-slate-800 text-white"
                          : `text-white`
                        : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                    }`}
                    style={
                      filterDifficulty === level && level !== "all"
                        ? { background: difficultyConfig[level].color }
                        : {}
                    }
                  >
                    {level === "all" ? "全て" : difficultyConfig[level].label}
                  </button>
                ))}
              </div>
              <span className="text-xs text-slate-400">
                {filteredQuestions.length}問 / 回答済み: {answeredCount}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setQuizMode(quizMode === "edit" ? "test" : "edit")}
                className="btn-secondary text-xs py-1.5 px-3"
              >
                {quizMode === "edit" ? "テストモード" : "編集モード"}
              </button>
              {!showResults && answeredCount === filteredQuestions.length && filteredQuestions.length > 0 && (
                <button
                  onClick={handleSubmitQuiz}
                  className="btn-primary flex items-center gap-1.5 text-sm"
                >
                  <Send className="w-4 h-4" />
                  採点する
                </button>
              )}
            </div>
          </div>

          {/* Score Result */}
          {score && (
            <div
              className={`card border-2 ${
                score.percentage >= 80
                  ? "border-green-300 bg-green-50"
                  : score.percentage >= 60
                  ? "border-yellow-300 bg-yellow-50"
                  : "border-red-300 bg-red-50"
              }`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-lg">
                    {score.percentage >= 80 ? "合格！" : score.percentage >= 60 ? "もう少し！" : "復習が必要です"}
                  </h3>
                  <p className="text-sm text-slate-600">
                    {score.correct}/{score.total}問正解（{score.percentage}%）
                  </p>
                </div>
                <div
                  className={`text-4xl font-bold ${
                    score.percentage >= 80
                      ? "text-green-600"
                      : score.percentage >= 60
                      ? "text-yellow-600"
                      : "text-red-600"
                  }`}
                >
                  {score.percentage}%
                </div>
              </div>
            </div>
          )}

          {/* Questions */}
          <div className="space-y-4">
            {filteredQuestions.map((q, i) => {
              const diff = difficultyConfig[q.difficulty];
              const hasAnswered = selectedAnswers[q.id] !== undefined;
              const isCorrect = hasAnswered && selectedAnswers[q.id] === q.correctAnswer;
              const showExplanation = expandedExplanations.has(q.id);

              return (
                <div
                  key={q.id}
                  className={`card ${
                    showResults
                      ? isCorrect
                        ? "border-l-4 border-l-green-500"
                        : hasAnswered
                        ? "border-l-4 border-l-red-500"
                        : "border-l-4 border-l-slate-300"
                      : ""
                  }`}
                >
                  <div className="flex items-center gap-2 mb-3">
                    <span className="w-7 h-7 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center text-sm font-bold">
                      {i + 1}
                    </span>
                    <span className="badge text-xs" style={{ background: diff.bg, color: diff.color }}>
                      {diff.label}
                    </span>
                    <span className="text-xs text-slate-400">Step {q.relatedStepNumber} 関連</span>
                    {showResults && hasAnswered && (
                      isCorrect ? (
                        <CheckCircle2 className="w-5 h-5 text-green-500 ml-auto" />
                      ) : (
                        <XCircle className="w-5 h-5 text-red-500 ml-auto" />
                      )
                    )}
                  </div>

                  <p className="font-medium text-slate-900 mb-3">{q.question}</p>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {q.options.map((opt, j) => {
                      const isSelected = selectedAnswers[q.id] === j;
                      const isCorrectOption = j === q.correctAnswer;
                      let optionClass = "border-slate-200 text-slate-600 hover:border-blue-300 hover:bg-blue-50 cursor-pointer";

                      if (quizMode === "edit") {
                        // Show correct answers in edit mode
                        if (isCorrectOption) {
                          optionClass = "border-green-300 bg-green-50 text-green-700 font-medium";
                        }
                      } else if (showResults) {
                        if (isCorrectOption) {
                          optionClass = "border-green-300 bg-green-50 text-green-700 font-medium";
                        } else if (isSelected && !isCorrectOption) {
                          optionClass = "border-red-300 bg-red-50 text-red-700";
                        }
                      } else if (isSelected) {
                        optionClass = "border-blue-500 bg-blue-50 text-blue-700 font-medium";
                      }

                      return (
                        <button
                          key={j}
                          onClick={() => quizMode === "test" && handleAnswer(q.id, j)}
                          className={`p-2.5 rounded-lg border text-sm text-left transition-all ${optionClass}`}
                          disabled={quizMode === "edit" || showResults}
                        >
                          <span className="text-xs text-slate-400 mr-2">
                            {String.fromCharCode(65 + j)}.
                          </span>
                          {opt}
                          {quizMode === "edit" && isCorrectOption && (
                            <CheckCircle2 className="w-4 h-4 text-green-500 inline ml-2" />
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {/* Explanation */}
                  {(showResults || quizMode === "edit") && (
                    <div className="mt-3">
                      <button
                        onClick={() => toggleExplanation(q.id)}
                        className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
                      >
                        <Lightbulb className="w-3.5 h-3.5" />
                        解説{showExplanation ? "を閉じる" : "を見る"}
                        {showExplanation ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      </button>
                      {showExplanation && (
                        <div className="mt-2 p-3 bg-blue-50 rounded-lg text-sm text-blue-800 border border-blue-200">
                          {q.explanation}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
