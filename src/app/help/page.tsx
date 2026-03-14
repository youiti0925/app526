"use client";

import { useState } from "react";
import Sidebar from "@/components/ui/Sidebar";
import Header from "@/components/ui/Header";
import {
  HelpCircle,
  Video,
  Brain,
  FileEdit,
  Download,
  Settings,
  FolderOpen,
  PlusCircle,
  ClipboardCheck,
  Eye,
  GraduationCap,
  Smartphone,
  BarChart3,
  GitCompare,
  GitBranch,
  Activity,
  ArrowLeftRight,
  QrCode,
  Mic,
  BookOpen,
  Search,
  ChevronDown,
  ChevronUp,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  Lightbulb,
  FileText,
  Layout,
  Key,
  ToggleRight,
} from "lucide-react";

interface HelpSection {
  id: string;
  title: string;
  icon: typeof HelpCircle;
  color: string;
  content: React.ReactNode;
}

export default function HelpPage() {
  const [expandedSection, setExpandedSection] = useState<string | null>("overview");
  const [searchQuery, setSearchQuery] = useState("");

  const sections: HelpSection[] = [
    {
      id: "overview",
      title: "VideoSOP Pro とは",
      icon: Video,
      color: "#3b82f6",
      content: (
        <div className="space-y-4">
          <p className="text-sm text-slate-700 leading-relaxed">
            <strong>VideoSOP Pro</strong> は、作業動画からAIを活用して作業標準書（SOP: Standard Operating Procedure）を
            自動生成するアプリケーションです。製造業・検査・メンテナンスなどの現場で、
            熟練者の作業を動画で記録し、それを構造化された手順書に変換します。
          </p>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h4 className="font-bold text-sm text-blue-900 mb-2">主な特長</h4>
            <ul className="text-sm text-blue-800 space-y-1.5">
              <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />動画をアップロードするだけでAIが作業手順を自動分析</li>
              <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />ステップごとの詳細手順・ポイント・注意事項を自動生成</li>
              <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />安全注意事項・品質チェックポイント・必要工具を自動検出</li>
              <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />PDF・Excel・Word・HTML形式でエクスポート</li>
              <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />6言語対応（日本語・英語・中国語・韓国語・ベトナム語・タイ語）</li>
              <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />条件分岐型作業指示書・SOP逸脱検出・動画-文書同期などの高度な機能</li>
            </ul>
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
            <h4 className="font-bold text-sm text-amber-900 mb-2 flex items-center gap-1"><Lightbulb className="w-4 h-4" />基本的なワークフロー</h4>
            <div className="flex items-center gap-2 flex-wrap text-sm text-amber-800">
              <span className="bg-amber-100 px-2 py-1 rounded font-medium">1. 新規プロジェクト作成</span>
              <ArrowRight className="w-4 h-4" />
              <span className="bg-amber-100 px-2 py-1 rounded font-medium">2. 動画アップロード</span>
              <ArrowRight className="w-4 h-4" />
              <span className="bg-amber-100 px-2 py-1 rounded font-medium">3. AI分析</span>
              <ArrowRight className="w-4 h-4" />
              <span className="bg-amber-100 px-2 py-1 rounded font-medium">4. 手順書を編集</span>
              <ArrowRight className="w-4 h-4" />
              <span className="bg-amber-100 px-2 py-1 rounded font-medium">5. レビュー・承認</span>
              <ArrowRight className="w-4 h-4" />
              <span className="bg-amber-100 px-2 py-1 rounded font-medium">6. 公開・エクスポート</span>
            </div>
          </div>
        </div>
      ),
    },
    {
      id: "getting-started",
      title: "はじめかた（初期設定）",
      icon: Key,
      color: "#10b981",
      content: (
        <div className="space-y-4">
          <div className="space-y-3">
            <h4 className="font-bold text-sm text-slate-900">1. Google Gemini APIキーの設定</h4>
            <p className="text-sm text-slate-700">
              AI分析機能を使うには、Google Gemini APIキーが必要です。無料枠があり、個人利用では料金はかかりません。
            </p>
            <div className="bg-slate-50 rounded-lg p-3 space-y-2 text-sm">
              <p><strong>手順:</strong></p>
              <ol className="list-decimal list-inside space-y-1 text-slate-600">
                <li>サイドバーの「設定」をクリック</li>
                <li><a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">Google AI Studio</a> でAPIキーを取得</li>
                <li>取得したキーを「APIキー」欄に貼り付け</li>
                <li>「保存」→「接続テスト」で動作確認</li>
              </ol>
            </div>
          </div>

          <div className="space-y-3">
            <h4 className="font-bold text-sm text-slate-900">2. 専門用語辞書の登録（任意）</h4>
            <p className="text-sm text-slate-700">
              設定画面で業界固有の専門用語を登録すると、AI分析時のテキスト認識・手順生成の精度が向上します。
              機械名・部品名・略語などを登録してください。
            </p>
          </div>

          <div className="space-y-3">
            <h4 className="font-bold text-sm text-slate-900">3. 機能のON/OFF設定（任意）</h4>
            <p className="text-sm text-slate-700">
              設定画面の「機能のON/OFF」セクションで、条件分岐・逸脱検出・動画同期の各機能を個別に有効/無効にできます。
              必要ない機能はOFFにすることで、画面をシンプルに保てます。
            </p>
          </div>

          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <h4 className="font-bold text-sm text-green-900 mb-2">データの保存について</h4>
            <p className="text-sm text-green-800">
              すべてのデータはブラウザのローカルストレージに保存されます。サーバーにデータは送信されません。
              ブラウザのデータを消去すると、プロジェクトデータも消去されますのでご注意ください。
            </p>
          </div>
        </div>
      ),
    },
    {
      id: "new-project",
      title: "新規プロジェクト作成",
      icon: PlusCircle,
      color: "#8b5cf6",
      content: (
        <div className="space-y-4">
          <p className="text-sm text-slate-700">
            サイドバーの「新規作成」またはプロジェクト一覧画面の「新規プロジェクト」ボタンから作成できます。
            4ステップのウィザード形式で進みます。
          </p>

          <div className="space-y-3">
            <div className="border rounded-lg p-3" style={{ borderColor: "var(--card-border)" }}>
              <h4 className="font-bold text-sm text-slate-900 mb-2">ステップ1: 基本情報</h4>
              <ul className="text-sm text-slate-600 space-y-1">
                <li><strong>プロジェクト名</strong>（必須）: 作業標準書のタイトルになります（例: 円テーブル回転精度検査）</li>
                <li><strong>説明</strong>: 作業の概要を記入</li>
                <li><strong>カテゴリ</strong>: 検査・組立・メンテナンス・段取り・品質チェック・その他から選択</li>
                <li><strong>部門・機械型式・検査種別</strong>: 管理情報として記録（任意）</li>
                <li><strong>タグ</strong>: 検索・分類に使用するキーワード（任意）</li>
              </ul>
            </div>

            <div className="border rounded-lg p-3" style={{ borderColor: "var(--card-border)" }}>
              <h4 className="font-bold text-sm text-slate-900 mb-2">ステップ2: 動画アップロード</h4>
              <ul className="text-sm text-slate-600 space-y-1">
                <li>対応形式: MP4, MOV, AVI, WebM</li>
                <li>最大ファイルサイズ: 2GB</li>
                <li>ドラッグ&ドロップまたはクリックで選択</li>
                <li>動画なしでもプロジェクト作成は可能（後から追加可能）</li>
              </ul>
            </div>

            <div className="border rounded-lg p-3" style={{ borderColor: "var(--card-border)" }}>
              <h4 className="font-bold text-sm text-slate-900 mb-2">ステップ3: テンプレート選択</h4>
              <p className="text-sm text-slate-600">
                既存のテンプレート（円テーブル精度検査・組立作業標準・定期メンテナンス）から選ぶか、
                テンプレートなしでゼロから作成できます。
              </p>
            </div>

            <div className="border rounded-lg p-3" style={{ borderColor: "var(--card-border)" }}>
              <h4 className="font-bold text-sm text-slate-900 mb-2">ステップ4: 確認・作成</h4>
              <p className="text-sm text-slate-600">
                設定内容を確認して「プロジェクトを作成」を押すと、プロジェクト詳細画面に遷移します。
              </p>
            </div>
          </div>
        </div>
      ),
    },
    {
      id: "project-list",
      title: "プロジェクト一覧",
      icon: FolderOpen,
      color: "#f59e0b",
      content: (
        <div className="space-y-4">
          <p className="text-sm text-slate-700">
            サイドバーの「プロジェクト一覧」から、全プロジェクトを閲覧・管理できます。
          </p>
          <div className="space-y-2 text-sm text-slate-600">
            <p><strong>表示切り替え:</strong> グリッド表示とリスト表示を右上のアイコンで切り替え</p>
            <p><strong>検索:</strong> プロジェクト名・説明で絞り込み</p>
            <p><strong>フィルタ:</strong> ステータス（下書き・分析中・編集中など）やカテゴリで絞り込み</p>
            <p><strong>ソート:</strong> 更新日順・作成日順・名前順で並べ替え</p>
          </div>
          <div className="bg-slate-50 rounded-lg p-3">
            <h4 className="font-bold text-sm text-slate-700 mb-2">プロジェクトのステータス一覧</h4>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full" style={{ background: "#64748b" }} />下書き: 初期状態</div>
              <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full" style={{ background: "#8b5cf6" }} />動画アップロード済</div>
              <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full" style={{ background: "#f59e0b" }} />AI分析中: AI解析実行中</div>
              <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full" style={{ background: "#06b6d4" }} />分析完了: AI解析完了</div>
              <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full" style={{ background: "#3b82f6" }} />編集中: 手順書を編集中</div>
              <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full" style={{ background: "#f97316" }} />レビュー中: 承認待ち</div>
              <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full" style={{ background: "#10b981" }} />承認済: 承認完了</div>
              <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full" style={{ background: "#059669" }} />公開済: 作業者に公開</div>
            </div>
          </div>
        </div>
      ),
    },
    {
      id: "video-upload",
      title: "動画アップロードと音声認識",
      icon: Video,
      color: "#ef4444",
      content: (
        <div className="space-y-4">
          <p className="text-sm text-slate-700">
            プロジェクト詳細画面の「動画」タブから、作業動画をアップロードできます。
          </p>

          <div className="space-y-3">
            <h4 className="font-bold text-sm text-slate-900">動画のアップロード</h4>
            <ul className="text-sm text-slate-600 space-y-1">
              <li>ファイルをドラッグ&ドロップ、またはクリックして選択</li>
              <li>アップロード時に以下のコンテキスト情報を入力できます（AI分析の精度向上）:</li>
              <ul className="ml-4 list-disc space-y-0.5">
                <li><strong>作業内容の説明</strong>: この動画で何をしているかの概要</li>
                <li><strong>作業者のメモ</strong>: 動画では伝わりにくいポイント</li>
                <li><strong>カンコツ（暗黙知）</strong>: 経験者だけが知っているコツ</li>
                <li><strong>安全上の注意点</strong>: 必ず守るべき安全事項</li>
              </ul>
            </ul>
          </div>

          <div className="space-y-3">
            <h4 className="font-bold text-sm text-slate-900 flex items-center gap-2">
              <Mic className="w-4 h-4" />音声認識（字幕生成）
            </h4>
            <p className="text-sm text-slate-600">
              動画タブの右下にある「音声認識」パネルで、ブラウザの音声認識機能を使って
              動画内の音声をテキストに変換できます。変換されたテキストはAI分析時に参考情報として使用されます。
            </p>
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-xs text-red-700">
                ※ 音声認識はブラウザの Web Speech API を使用します。Chrome ブラウザでの利用を推奨します。
              </p>
            </div>
          </div>
        </div>
      ),
    },
    {
      id: "ai-analysis",
      title: "AI分析",
      icon: Brain,
      color: "#8b5cf6",
      content: (
        <div className="space-y-4">
          <p className="text-sm text-slate-700">
            「AI分析」タブで、アップロードした動画をGoogle Gemini AIが分析し、
            作業手順を自動的に検出・構造化します。
          </p>

          <div className="space-y-3">
            <h4 className="font-bold text-sm text-slate-900">分析で検出される内容</h4>
            <ul className="text-sm text-slate-600 space-y-1">
              <li><strong>シーン検出:</strong> 動画内の作業場面を自動的に分割し、各場面の内容を説明</li>
              <li><strong>OCRテキスト抽出:</strong> 動画内に映る文字（計器の値、ラベルなど）を認識</li>
              <li><strong>工具検出:</strong> 使用されている工具・器具を自動識別</li>
              <li><strong>動作認識:</strong> 作業者の動作パターンを分析</li>
              <li><strong>作業ステップ提案:</strong> 上記の分析結果から、構造化された作業手順を提案</li>
            </ul>
          </div>

          <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
            <h4 className="font-bold text-sm text-purple-900 mb-2">分析の精度を上げるコツ</h4>
            <ul className="text-sm text-purple-800 space-y-1">
              <li>・動画のアップロード時にコンテキスト情報を入力する</li>
              <li>・設定画面で専門用語辞書に固有名詞を登録する</li>
              <li>・音声認識で字幕テキストを生成しておく</li>
              <li>・明るい環境で撮影し、手元がよく見える角度で録画する</li>
            </ul>
          </div>

          <div className="space-y-3">
            <h4 className="font-bold text-sm text-slate-900">分析完了後</h4>
            <p className="text-sm text-slate-600">
              分析結果を確認したら、「作業標準書を生成」ボタンを押すと、
              AIの提案をもとに編集可能な作業標準書が作成されます。
            </p>
          </div>
        </div>
      ),
    },
    {
      id: "editor",
      title: "作業標準書の編集",
      icon: FileEdit,
      color: "#3b82f6",
      content: (
        <div className="space-y-4">
          <p className="text-sm text-slate-700">
            「編集」タブで、AI生成された作業標準書を自由に編集できます。
            6つのサブタブで構成されています。
          </p>

          <div className="space-y-3">
            <div className="border rounded-lg p-3" style={{ borderColor: "var(--card-border)" }}>
              <h4 className="font-bold text-sm text-slate-900 mb-2 flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-blue-500" />
                作業ステップ
              </h4>
              <ul className="text-sm text-slate-600 space-y-1">
                <li>各ステップのタイトル・説明・詳細手順を編集</li>
                <li><strong>ポイント</strong>: 作業の重要なポイントを箇条書きで追加</li>
                <li><strong>注意事項</strong>: 安全上の注意や品質上の注意を追加</li>
                <li><strong>使用工具</strong>: そのステップで使う工具を追加</li>
                <li><strong>測定仕様</strong>: 測定項目・基準値・公差・測定器を表形式で表示</li>
                <li><strong>カテゴリ</strong>: 準備・操作・検査・測定・調整・後片付け・安全確認から選択</li>
                <li><strong>所要時間</strong>: 秒単位で設定</li>
                <li>ドラッグ&ドロップまたは矢印ボタンでステップの順序を変更可能</li>
              </ul>
            </div>

            <div className="border rounded-lg p-3" style={{ borderColor: "var(--card-border)" }}>
              <h4 className="font-bold text-sm text-slate-900 mb-2">基本情報</h4>
              <p className="text-sm text-slate-600">
                工程名・機械名・型式・部門・必要スキルレベル・前提条件・必要保護具を編集
              </p>
            </div>

            <div className="border rounded-lg p-3" style={{ borderColor: "var(--card-border)" }}>
              <h4 className="font-bold text-sm text-slate-900 mb-2">安全注意事項</h4>
              <p className="text-sm text-slate-600">
                情報・注意・警告・危険の4段階の重大度で安全注意事項を管理。関連ステップとの紐付け。
              </p>
            </div>

            <div className="border rounded-lg p-3" style={{ borderColor: "var(--card-border)" }}>
              <h4 className="font-bold text-sm text-slate-900 mb-2">品質チェックポイント</h4>
              <p className="text-sm text-slate-600">
                各ステップの品質検査項目・検査方法・基準・合格基準・測定器・頻度・記録要否を表形式で管理
              </p>
            </div>

            <div className="border rounded-lg p-3" style={{ borderColor: "var(--card-border)" }}>
              <h4 className="font-bold text-sm text-slate-900 mb-2">必要工具・器具</h4>
              <p className="text-sm text-slate-600">
                測定器・手工具・電動工具・治具・消耗品・保護具のカテゴリ別に、名前・仕様・数量を管理
              </p>
            </div>

            <div className="border rounded-lg p-3" style={{ borderColor: "var(--card-border)" }}>
              <h4 className="font-bold text-sm text-slate-900 mb-2">改訂履歴</h4>
              <p className="text-sm text-slate-600">
                バージョン番号・日付・作成者・変更内容を記録。最新版が先頭に表示されます。
              </p>
            </div>
          </div>
        </div>
      ),
    },
    {
      id: "conditional-branching",
      title: "条件分岐型作業指示書",
      icon: GitBranch,
      color: "#8b5cf6",
      content: (
        <div className="space-y-4">
          <p className="text-sm text-slate-700">
            「条件分岐」タブで、製品バリエーションや条件に応じて異なるステップを実行する分岐を設定できます。
            <strong>設定画面でこの機能のON/OFFが可能です。</strong>
          </p>

          <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
            <h4 className="font-bold text-sm text-purple-900 mb-2">使用例</h4>
            <ul className="text-sm text-purple-800 space-y-1.5">
              <li>・コネクタタイプAの場合はステップ3-5、タイプBの場合はステップ3,6-7を実行</li>
              <li>・製品サイズが100mm以上の場合は追加の検査ステップを実行</li>
              <li>・材質がステンレスの場合は異なる工具セットを使用</li>
            </ul>
          </div>

          <div className="space-y-3">
            <h4 className="font-bold text-sm text-slate-900">使い方</h4>
            <ol className="text-sm text-slate-600 list-decimal list-inside space-y-2">
              <li>「分岐ポイント追加」ボタンをクリック</li>
              <li><strong>分岐するステップ</strong>: どのステップの後に分岐するかを選択</li>
              <li><strong>分岐変数名</strong>: 条件の対象（例: connectorType）</li>
              <li><strong>分岐変数ラベル</strong>: 表示名（例: コネクタタイプ）</li>
              <li>作成後、「条件パターンを追加」で各分岐条件を定義</li>
              <li>各パターンで「ラベル」「条件」「値」を設定し、実行するステップを選択</li>
            </ol>
          </div>

          <div className="space-y-3">
            <h4 className="font-bold text-sm text-slate-900">条件の種類</h4>
            <ul className="text-sm text-slate-600 space-y-1">
              <li><strong>等しい</strong>: 値が完全に一致する場合</li>
              <li><strong>等しくない</strong>: 値が一致しない場合</li>
              <li><strong>含む</strong>: 値が部分的に含まれる場合</li>
              <li><strong>より大きい / より小さい</strong>: 数値の比較</li>
            </ul>
          </div>
        </div>
      ),
    },
    {
      id: "drift-detection",
      title: "SOP逸脱検出",
      icon: Activity,
      color: "#f97316",
      content: (
        <div className="space-y-4">
          <p className="text-sm text-slate-700">
            「逸脱検出」タブで、録画された実際の作業とSOPを比較し、手順・時間・工具使用の逸脱を自動検出します。
            <strong>設定画面でこの機能のON/OFFが可能です。</strong>
          </p>

          <div className="space-y-3">
            <h4 className="font-bold text-sm text-slate-900">検出される逸脱の種類</h4>
            <ul className="text-sm text-slate-600 space-y-1.5">
              <li><strong>所要時間の逸脱:</strong> ステップの実際の作業時間がSOPの規定値から大きく外れている</li>
              <li><strong>工具使用の逸脱:</strong> SOPに記載された工具が使用されていない</li>
              <li><strong>作業順序の逸脱:</strong> SOPにない追加作業やステップの順番違い</li>
              <li><strong>安全確認の漏れ:</strong> 安全確認手順が実施されていない（危険レベル）</li>
              <li><strong>測定値の公差超過:</strong> 測定値がSOPの公差範囲外（危険レベル）</li>
            </ul>
          </div>

          <div className="space-y-3">
            <h4 className="font-bold text-sm text-slate-900">重大度レベル</h4>
            <div className="grid grid-cols-2 gap-2">
              <div className="p-2 rounded text-sm" style={{ background: "#dbeafe" }}>
                <span className="font-bold" style={{ color: "#3b82f6" }}>情報</span>: 軽微な差異、問題なし
              </div>
              <div className="p-2 rounded text-sm" style={{ background: "#fef3c7" }}>
                <span className="font-bold" style={{ color: "#f59e0b" }}>軽微</span>: 注意が必要
              </div>
              <div className="p-2 rounded text-sm" style={{ background: "#fed7aa" }}>
                <span className="font-bold" style={{ color: "#f97316" }}>重大</span>: 是正処置が必要
              </div>
              <div className="p-2 rounded text-sm" style={{ background: "#fee2e2" }}>
                <span className="font-bold" style={{ color: "#ef4444" }}>危険</span>: 即座の対応が必要
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <h4 className="font-bold text-sm text-slate-900">準拠スコア</h4>
            <p className="text-sm text-slate-600">
              0〜100のスコアで全体の準拠度を表示。90以上で「良好」、70以上で「要注意」、50以上で「要改善」、50未満で「要是正」。
            </p>
          </div>
        </div>
      ),
    },
    {
      id: "video-sync",
      title: "動画⇔文書の双方向同期",
      icon: ArrowLeftRight,
      color: "#06b6d4",
      content: (
        <div className="space-y-4">
          <p className="text-sm text-slate-700">
            「動画同期」タブで、各ステップと動画の対応区間を追跡し、どちらかが更新された際に自動的にアラートを出します。
            <strong>設定画面でこの機能のON/OFFが可能です。</strong>
          </p>

          <div className="space-y-3">
            <h4 className="font-bold text-sm text-slate-900">同期ステータス</h4>
            <ul className="text-sm text-slate-600 space-y-1">
              <li><span className="inline-block w-2 h-2 rounded-full mr-1" style={{ background: "#10b981" }} /><strong>同期済み:</strong> 動画と文書の内容が一致</li>
              <li><span className="inline-block w-2 h-2 rounded-full mr-1" style={{ background: "#f59e0b" }} /><strong>動画更新あり:</strong> 動画が再撮影/編集されたが文書が未更新</li>
              <li><span className="inline-block w-2 h-2 rounded-full mr-1" style={{ background: "#3b82f6" }} /><strong>文書更新あり:</strong> 文書が変更されたが動画が古いまま</li>
              <li><span className="inline-block w-2 h-2 rounded-full mr-1" style={{ background: "#ef4444" }} /><strong>競合:</strong> 動画と文書の両方が変更されており手動確認が必要</li>
            </ul>
          </div>

          <div className="space-y-3">
            <h4 className="font-bold text-sm text-slate-900">使い方</h4>
            <ol className="text-sm text-slate-600 list-decimal list-inside space-y-1">
              <li>「同期チェック」ボタンで最新の同期状態をスキャン</li>
              <li>アラートが表示されたら、内容を確認</li>
              <li>確認後、「同期済みとしてマーク」でアラートを解決</li>
              <li>目のアイコンをクリックすると、動画の該当位置にジャンプ</li>
            </ol>
          </div>
        </div>
      ),
    },
    {
      id: "export",
      title: "エクスポートとQRコード",
      icon: Download,
      color: "#059669",
      content: (
        <div className="space-y-4">
          <p className="text-sm text-slate-700">
            作成した作業標準書を各種形式で出力できます。
          </p>

          <div className="space-y-3">
            <h4 className="font-bold text-sm text-slate-900">エクスポート形式</h4>
            <ul className="text-sm text-slate-600 space-y-1">
              <li><strong>PDF:</strong> 印刷・配布に最適。ISO監査用の紙ベース文書として利用</li>
              <li><strong>Excel:</strong> データ管理・記録用。チェックリストの記入欄付き</li>
              <li><strong>Word:</strong> さらなる編集が必要な場合</li>
              <li><strong>HTML:</strong> Web上での閲覧・社内イントラネットへの掲載</li>
            </ul>
          </div>

          <div className="space-y-3">
            <h4 className="font-bold text-sm text-slate-900">エクスポートオプション</h4>
            <ul className="text-sm text-slate-600 space-y-1">
              <li><strong>テンプレート:</strong> 標準・詳細・簡略・トレーニング用</li>
              <li><strong>言語:</strong> 日本語・英語・中国語・韓国語・ベトナム語・タイ語</li>
              <li><strong>用紙サイズ:</strong> A4・A3・Letter</li>
              <li><strong>印刷方向:</strong> 縦・横</li>
              <li><strong>含める情報:</strong> 画像・動画リンク・QRコード・改訂履歴</li>
              <li><strong>詳細レベル:</strong> SOP（管理者向け）・作業指示書（作業者向け）</li>
            </ul>
          </div>

          <div className="space-y-3">
            <h4 className="font-bold text-sm text-slate-900 flex items-center gap-2">
              <QrCode className="w-4 h-4" />
              QRコード
            </h4>
            <p className="text-sm text-slate-600">
              プロジェクト詳細画面の「QR」ボタンから、QRコードを生成できます。
              印刷して機械やワークステーションに貼り付けることで、作業者がスマホで
              QRコードを読み取り、その場で作業標準書にアクセスできます。
            </p>
          </div>
        </div>
      ),
    },
    {
      id: "other-tabs",
      title: "その他の機能タブ",
      icon: Layout,
      color: "#64748b",
      content: (
        <div className="space-y-4">
          <p className="text-sm text-slate-700">
            プロジェクト詳細画面には、上記以外にも以下のタブがあります。
          </p>

          <div className="space-y-3">
            <div className="border rounded-lg p-3" style={{ borderColor: "var(--card-border)" }}>
              <h4 className="font-bold text-sm text-slate-900 mb-1 flex items-center gap-2">
                <ClipboardCheck className="w-4 h-4 text-green-500" />検査チェック
              </h4>
              <p className="text-sm text-slate-600">
                検査項目のチェックリストを表示・管理。実際の検査作業時にチェックを入れながら進める用途。
              </p>
            </div>

            <div className="border rounded-lg p-3" style={{ borderColor: "var(--card-border)" }}>
              <h4 className="font-bold text-sm text-slate-900 mb-1 flex items-center gap-2">
                <Eye className="w-4 h-4 text-blue-500" />外観基準
              </h4>
              <p className="text-sm text-slate-600">
                外観検査の良品・不良品サンプル画像、合否判定基準を視覚的に管理。
              </p>
            </div>

            <div className="border rounded-lg p-3" style={{ borderColor: "var(--card-border)" }}>
              <h4 className="font-bold text-sm text-slate-900 mb-1 flex items-center gap-2">
                <GraduationCap className="w-4 h-4 text-purple-500" />トレーニング
              </h4>
              <p className="text-sm text-slate-600">
                作業標準書を元にしたトレーニングコンテンツの管理。教育計画の作成・進捗追跡。
              </p>
            </div>

            <div className="border rounded-lg p-3" style={{ borderColor: "var(--card-border)" }}>
              <h4 className="font-bold text-sm text-slate-900 mb-1 flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-slate-500" />モバイル
              </h4>
              <p className="text-sm text-slate-600">
                スマートフォン表示のプレビュー。現場の作業者がモバイル端末で見た場合の表示を確認。
              </p>
            </div>

            <div className="border rounded-lg p-3" style={{ borderColor: "var(--card-border)" }}>
              <h4 className="font-bold text-sm text-slate-900 mb-1 flex items-center gap-2">
                <Brain className="w-4 h-4 text-pink-500" />クイズ
              </h4>
              <p className="text-sm text-slate-600">
                作業標準書の内容からクイズを自動生成。作業者の理解度を確認するためのテスト。
              </p>
            </div>

            <div className="border rounded-lg p-3" style={{ borderColor: "var(--card-border)" }}>
              <h4 className="font-bold text-sm text-slate-900 mb-1 flex items-center gap-2">
                <GitCompare className="w-4 h-4 text-indigo-500" />差分比較
              </h4>
              <p className="text-sm text-slate-600">
                作業標準書のバージョン間の差分を表示。どのステップがどう変更されたかを視覚的に確認。
              </p>
            </div>

            <div className="border rounded-lg p-3" style={{ borderColor: "var(--card-border)" }}>
              <h4 className="font-bold text-sm text-slate-900 mb-1 flex items-center gap-2">
                <FileText className="w-4 h-4 text-cyan-500" />テンプレート
              </h4>
              <p className="text-sm text-slate-600">
                会社独自のテンプレートの作成・管理。ヘッダー項目のカスタマイズ、セクションの構成変更。
              </p>
            </div>

            <div className="border rounded-lg p-3" style={{ borderColor: "var(--card-border)" }}>
              <h4 className="font-bold text-sm text-slate-900 mb-1 flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-emerald-500" />分析
              </h4>
              <p className="text-sm text-slate-600">
                プロジェクトの統計情報ダッシュボード。作成数・ステータス分布・最近のアクティビティ。
              </p>
            </div>
          </div>
        </div>
      ),
    },
    {
      id: "review-workflow",
      title: "レビュー・承認・公開フロー",
      icon: CheckCircle2,
      color: "#10b981",
      content: (
        <div className="space-y-4">
          <p className="text-sm text-slate-700">
            作業標準書は、編集完了後に承認フローを経て公開されます。
          </p>

          <div className="bg-slate-50 rounded-lg p-4">
            <div className="flex items-center gap-2 flex-wrap text-sm">
              <span className="bg-blue-100 text-blue-700 px-3 py-1.5 rounded font-medium">編集中</span>
              <ArrowRight className="w-4 h-4 text-slate-400" />
              <span className="bg-orange-100 text-orange-700 px-3 py-1.5 rounded font-medium">レビュー依頼</span>
              <ArrowRight className="w-4 h-4 text-slate-400" />
              <span className="bg-green-100 text-green-700 px-3 py-1.5 rounded font-medium">承認</span>
              <ArrowRight className="w-4 h-4 text-slate-400" />
              <span className="bg-emerald-100 text-emerald-700 px-3 py-1.5 rounded font-medium">公開</span>
            </div>
          </div>

          <ul className="text-sm text-slate-600 space-y-2">
            <li><strong>レビュー依頼:</strong> 編集中のプロジェクトで、ヘッダー右上の「レビュー依頼」ボタンを押す</li>
            <li><strong>承認:</strong> レビュー中のプロジェクトで「承認」ボタンを押す</li>
            <li><strong>公開:</strong> 承認済みのプロジェクトで「公開」ボタンを押すと作業者に公開される</li>
          </ul>
        </div>
      ),
    },
    {
      id: "settings-detail",
      title: "設定画面の詳細",
      icon: Settings,
      color: "#64748b",
      content: (
        <div className="space-y-4">
          <p className="text-sm text-slate-700">
            サイドバーの「設定」から、アプリ全体の設定を管理できます。
          </p>

          <div className="space-y-3">
            <div className="border rounded-lg p-3" style={{ borderColor: "var(--card-border)" }}>
              <h4 className="font-bold text-sm text-slate-900 mb-1">Google Gemini APIキー</h4>
              <p className="text-sm text-slate-600">AI分析に使用するAPIキーの設定・テスト。ローカルストレージに保存され、サーバーには送信されません。</p>
            </div>

            <div className="border rounded-lg p-3" style={{ borderColor: "var(--card-border)" }}>
              <h4 className="font-bold text-sm text-slate-900 mb-1">専門用語辞書</h4>
              <p className="text-sm text-slate-600">
                用語名・カテゴリ（機械/工具/測定/工程/材料/安全/その他）・定義・別名を登録。
                登録した用語はAI分析プロンプトに注入され、認識精度が向上します。
              </p>
            </div>

            <div className="border rounded-lg p-3" style={{ borderColor: "var(--card-border)" }}>
              <h4 className="font-bold text-sm text-slate-900 mb-1">会社テンプレート</h4>
              <p className="text-sm text-slate-600">
                会社独自のエクスポートテンプレートの作成・管理。ヘッダー項目や出力形式をカスタマイズ。
              </p>
            </div>

            <div className="border rounded-lg p-3" style={{ borderColor: "var(--card-border)" }}>
              <h4 className="font-bold text-sm text-slate-900 mb-1 flex items-center gap-2">
                <ToggleRight className="w-4 h-4 text-indigo-500" />
                機能のON/OFF
              </h4>
              <p className="text-sm text-slate-600">
                以下の3機能を個別にON/OFF切り替え可能:
              </p>
              <ul className="text-sm text-slate-600 mt-1 space-y-0.5 ml-4 list-disc">
                <li>条件分岐型作業指示書</li>
                <li>SOP逸脱検出</li>
                <li>動画⇔文書の双方向同期</li>
              </ul>
              <p className="text-xs text-slate-500 mt-1">OFFにした機能はプロジェクト画面のタブに表示されなくなります。</p>
            </div>

            <div className="border rounded-lg p-3" style={{ borderColor: "var(--card-border)" }}>
              <h4 className="font-bold text-sm text-slate-900 mb-1">データ管理</h4>
              <p className="text-sm text-slate-600">ローカルストレージの使用量を確認。</p>
            </div>
          </div>
        </div>
      ),
    },
    {
      id: "tips",
      title: "効率的に使うためのヒント",
      icon: Lightbulb,
      color: "#f59e0b",
      content: (
        <div className="space-y-4">
          <div className="space-y-3">
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <h4 className="font-bold text-sm text-amber-900 mb-1">動画撮影のコツ</h4>
              <ul className="text-sm text-amber-800 space-y-1">
                <li>・明るい環境で撮影（AI分析の精度が向上）</li>
                <li>・手元が見える角度で撮影（工具の使用が認識されやすい）</li>
                <li>・各作業ステップの間に少し間を空ける（場面分割がしやすい）</li>
                <li>・可能なら作業しながら声で手順を説明する（音声認識に有効）</li>
                <li>・計器の値やラベルが映るようにする（OCR認識に有効）</li>
              </ul>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <h4 className="font-bold text-sm text-blue-900 mb-1">AI分析を最大限活用する</h4>
              <ul className="text-sm text-blue-800 space-y-1">
                <li>・アップロード時のコンテキスト情報を必ず入力する</li>
                <li>・専門用語辞書に固有名詞を事前登録しておく</li>
                <li>・分析結果は必ず確認・編集する（AIは完璧ではない）</li>
                <li>・特にカンコツ（暗黙知）の欄を活用する</li>
              </ul>
            </div>

            <div className="bg-green-50 border border-green-200 rounded-lg p-3">
              <h4 className="font-bold text-sm text-green-900 mb-1">運用のベストプラクティス</h4>
              <ul className="text-sm text-green-800 space-y-1">
                <li>・改訂履歴を必ず記録する（ISO監査で必要）</li>
                <li>・QRコードを印刷して現場の機械に貼り付ける</li>
                <li>・定期的にSOP逸脱検出を実行して、手順のドリフトを検知する</li>
                <li>・動画同期を活用して、動画と文書の整合性を維持する</li>
                <li>・クイズ機能で新人教育の理解度を確認する</li>
              </ul>
            </div>
          </div>
        </div>
      ),
    },
    {
      id: "faq",
      title: "よくある質問（FAQ）",
      icon: HelpCircle,
      color: "#6366f1",
      content: (
        <div className="space-y-4">
          {[
            {
              q: "APIキーなしでも使えますか？",
              a: "プロジェクトの作成・手動での作業標準書の編集・エクスポートは可能です。ただし、AI分析機能（動画からの自動手順生成）にはGoogle Gemini APIキーが必要です。",
            },
            {
              q: "データはどこに保存されますか？",
              a: "すべてのデータはブラウザのローカルストレージに保存されます。サーバーにはデータは送信されません。ブラウザのキャッシュやデータを消去するとプロジェクトデータも消去されます。",
            },
            {
              q: "対応している動画形式は？",
              a: "MP4, MOV, AVI, WebM に対応しています。最大ファイルサイズは2GBです。",
            },
            {
              q: "複数人で同時に使えますか？",
              a: "現在はブラウザのローカルストレージベースのため、同一ブラウザ内でのシングルユーザー利用を想定しています。",
            },
            {
              q: "エクスポートした文書はそのまま使えますか？",
              a: "はい。PDF/Excel/Word/HTML形式で出力でき、そのまま印刷・配布・保管できます。ISO監査用のフォーマットにも対応しています。",
            },
            {
              q: "機能が多すぎて画面がごちゃごちゃしています",
              a: "設定画面の「機能のON/OFF」で、使わない機能（条件分岐・逸脱検出・動画同期）をOFFにできます。OFFにするとプロジェクト画面のタブに表示されなくなります。",
            },
            {
              q: "左下に表示されている名前は何ですか？",
              a: "サイドバー左下のユーザー名（例: 田中太郎）はデモ用のダミーデータです。現在のバージョンではユーザー認証機能はありません。",
            },
            {
              q: "AI分析の精度を上げるには？",
              a: "動画アップロード時のコンテキスト情報入力、設定画面での専門用語辞書登録、音声認識による字幕テキスト生成が効果的です。詳しくは「効率的に使うためのヒント」セクションを参照してください。",
            },
          ].map((faq, i) => (
            <div key={i} className="border rounded-lg p-3" style={{ borderColor: "var(--card-border)" }}>
              <h4 className="font-bold text-sm text-slate-900 mb-1">Q: {faq.q}</h4>
              <p className="text-sm text-slate-600">A: {faq.a}</p>
            </div>
          ))}
        </div>
      ),
    },
  ];

  const filteredSections = searchQuery
    ? sections.filter(
        (s) =>
          s.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          s.id.includes(searchQuery.toLowerCase())
      )
    : sections;

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex-1 flex flex-col">
        <Header />
        <main className="flex-1 bg-slate-50 p-6">
          <div className="max-w-3xl mx-auto">
            {/* Page Header */}
            <div className="flex items-center gap-3 mb-2">
              <HelpCircle className="w-6 h-6 text-blue-600" />
              <h1 className="text-2xl font-bold text-slate-900">ヘルプ・使い方ガイド</h1>
            </div>
            <p className="text-slate-500 mb-6">
              VideoSOP Pro の全機能の使い方を説明しています。セクションをクリックして展開してください。
            </p>

            {/* Search */}
            <div className="relative mb-6">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="ヘルプ内を検索..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                style={{ borderColor: "var(--card-border)" }}
              />
            </div>

            {/* Quick Links */}
            <div className="card mb-6">
              <h3 className="font-bold text-sm text-slate-900 mb-3">クイックリンク</h3>
              <div className="flex flex-wrap gap-2">
                {sections.map((section) => {
                  const Icon = section.icon;
                  return (
                    <button
                      key={section.id}
                      onClick={() => {
                        setExpandedSection(section.id);
                        document.getElementById(`section-${section.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-slate-100 transition-colors"
                      style={{ color: section.color }}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      {section.title}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Sections */}
            <div className="space-y-3">
              {filteredSections.map((section) => {
                const Icon = section.icon;
                const isExpanded = expandedSection === section.id;

                return (
                  <div
                    key={section.id}
                    id={`section-${section.id}`}
                    className="border rounded-lg bg-white overflow-hidden"
                    style={{ borderColor: isExpanded ? section.color + "60" : "var(--card-border)" }}
                  >
                    <button
                      onClick={() => setExpandedSection(isExpanded ? null : section.id)}
                      className="w-full flex items-center gap-3 p-4 hover:bg-slate-50 transition-colors text-left"
                    >
                      <div
                        className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                        style={{ background: section.color + "15" }}
                      >
                        <Icon className="w-5 h-5" style={{ color: section.color }} />
                      </div>
                      <h3 className="flex-1 font-bold text-sm text-slate-900">{section.title}</h3>
                      {isExpanded ? (
                        <ChevronUp className="w-5 h-5 text-slate-400" />
                      ) : (
                        <ChevronDown className="w-5 h-5 text-slate-400" />
                      )}
                    </button>

                    {isExpanded && (
                      <div className="border-t p-4" style={{ borderColor: "var(--card-border)" }}>
                        {section.content}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {searchQuery && filteredSections.length === 0 && (
              <div className="text-center py-12 text-slate-400">
                <Search className="w-10 h-10 mx-auto mb-2 opacity-40" />
                <p className="text-sm">「{searchQuery}」に一致するヘルプが見つかりませんでした</p>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
