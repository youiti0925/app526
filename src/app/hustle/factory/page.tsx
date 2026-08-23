"use client";

import { useEffect, useMemo, useState } from "react";
import { Factory, Loader2, Copy, Check, Save, AlertTriangle, Clock } from "lucide-react";
import { TEMPLATES, type TemplateDefinition } from "@/lib/hustle/templates";
import { useHustleStore } from "@/store/useHustleStore";
import StorageNotice from "@/components/hustle/StorageNotice";

interface Variant {
  angle: string;
  subject: string;
  body: string;
}

export default function FactoryPage() {
  const { load, paths, addAsset, meta } = useHustleStore();
  const [templateId, setTemplateId] = useState<string>(TEMPLATES[0].id);
  const [values, setValues] = useState<Record<string, string>>({});
  const [pathId, setPathId] = useState<string>("");
  const [variants, setVariants] = useState<Variant[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [savedMinutes, setSavedMinutes] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, [load]);

  const template = useMemo(
    () => TEMPLATES.find((t) => t.id === templateId) as TemplateDefinition,
    [templateId]
  );

  function switchTemplate(id: string) {
    setTemplateId(id);
    setValues({});
    setVariants([]);
    setNotice(null);
    setError(null);
  }

  async function run() {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/hustle/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId, values, count: 3 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "生成に失敗しました");
      setVariants(data.variants ?? []);
      setNotice(data.notice ?? null);
      setSavedMinutes(data.aiUsed ? data.manualMinutes ?? 0 : 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "生成に失敗しました");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-8 max-w-6xl">
      <StorageNotice />

      <header className="mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Factory className="w-6 h-6 text-emerald-600" />
          コンテンツ量産
        </h1>
        <p className="text-sm text-slate-600 mt-2 leading-relaxed">
          稼ぐために毎回書かされる定型文の初稿を、まとめて3案つくります。
          <strong className="text-slate-900">出力をそのまま出さないでください。</strong>
          【要確認】の箇所を自分の言葉で埋めたものだけが、実際に売れる文章になります。
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
        <nav className="space-y-1.5">
          {TEMPLATES.map((t) => (
            <button
              key={t.id}
              onClick={() => switchTemplate(t.id)}
              className={`w-full text-left px-3 py-2.5 rounded-lg border text-sm transition-colors ${
                t.id === templateId
                  ? "bg-emerald-50 border-emerald-400 font-semibold"
                  : "bg-white hover:bg-slate-50"
              }`}
              style={t.id === templateId ? undefined : { borderColor: "var(--card-border)" }}
            >
              <span className="block">{t.name}</span>
              <span className="block text-xs text-slate-500 mt-0.5 flex items-center gap-1">
                <Clock className="w-3 h-3" />
                手作業なら約{t.manualMinutes}分
              </span>
            </button>
          ))}
        </nav>

        <div className="min-w-0">
          <div className="card mb-4">
            <h2 className="font-semibold mb-1">{template.name}</h2>
            <p className="text-sm text-slate-600 leading-relaxed mb-4">{template.purpose}</p>

            {template.caution && (
              <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs text-amber-900 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <span className="leading-relaxed">{template.caution}</span>
              </div>
            )}

            <div className="space-y-3">
              {template.fields.map((field) => (
                <div key={field.name}>
                  <label className="block text-sm font-medium mb-1">
                    {field.label}
                    {field.required && <span className="text-rose-500 ml-1">*</span>}
                  </label>
                  {field.type === "textarea" ? (
                    <textarea
                      rows={field.name === "jobText" || field.name === "requirements" ? 8 : 4}
                      value={values[field.name] ?? ""}
                      onChange={(e) => setValues({ ...values, [field.name]: e.target.value })}
                      placeholder={field.placeholder}
                      className="w-full rounded-lg border p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      style={{ borderColor: "var(--card-border)" }}
                    />
                  ) : (
                    <input
                      type={field.type === "number" ? "number" : "text"}
                      value={values[field.name] ?? ""}
                      onChange={(e) => setValues({ ...values, [field.name]: e.target.value })}
                      placeholder={field.placeholder}
                      className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      style={{ borderColor: "var(--card-border)" }}
                    />
                  )}
                  {field.help && <p className="text-xs text-slate-500 mt-1">{field.help}</p>}
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-3 mt-4">
              {paths.length > 0 && (
                <select
                  value={pathId}
                  onChange={(e) => setPathId(e.target.value)}
                  className="rounded-lg border px-3 py-2 text-sm"
                  style={{ borderColor: "var(--card-border)" }}
                >
                  <option value="">チャネル未指定</option>
                  {paths.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              )}
              <button onClick={run} disabled={loading} className="btn-primary flex items-center gap-2 disabled:opacity-60">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Factory className="w-4 h-4" />}
                3案つくる
              </button>
              {!meta.aiEnabled && (
                <span className="text-xs text-slate-500">
                  APIキー未設定 → 穴埋め雛形が返ります
                </span>
              )}
            </div>

            {error && <p className="text-sm text-rose-600 mt-3">{error}</p>}
            {notice && <p className="text-xs text-amber-700 mt-3 leading-relaxed">{notice}</p>}
          </div>

          {savedMinutes > 0 && variants.length > 0 && (
            <p className="text-xs text-emerald-700 mb-3">
              手作業なら約{savedMinutes}分ぶんの下書きです。ここから先の事実確認と手直しが、あなたの価値になります。
            </p>
          )}

          <div className="space-y-4">
            {variants.map((variant, i) => (
              <VariantCard
                key={i}
                index={i}
                variant={variant}
                onSave={async () => {
                  await addAsset({
                    pathId: pathId || null,
                    kind: template.assetKind,
                    title: variant.subject || `${template.name} 案${i + 1}`,
                    body: variant.body,
                    meta: { templateId, angle: variant.angle, inputs: values },
                    status: "draft",
                  });
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function VariantCard({
  index,
  variant,
  onSave,
}: {
  index: number;
  variant: Variant;
  onSave: () => Promise<void>;
}) {
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <span className="badge badge-info mb-1.5">案{index + 1}</span>
          <h3 className="font-semibold text-sm break-words">{variant.subject || "（無題）"}</h3>
          {variant.angle && <p className="text-xs text-slate-500 mt-0.5">切り口: {variant.angle}</p>}
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={async () => {
              await navigator.clipboard.writeText(
                variant.subject ? `${variant.subject}\n\n${variant.body}` : variant.body
              );
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="btn-secondary !px-3 !py-1.5 text-xs flex items-center gap-1.5"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? "コピーしました" : "コピー"}
          </button>
          <button
            onClick={async () => {
              await onSave();
              setSaved(true);
              setTimeout(() => setSaved(false), 1500);
            }}
            className="btn-secondary !px-3 !py-1.5 text-xs flex items-center gap-1.5"
          >
            {saved ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Save className="w-3.5 h-3.5" />}
            {saved ? "保存しました" : "保存"}
          </button>
        </div>
      </div>
      <pre className="text-sm whitespace-pre-wrap leading-relaxed font-sans bg-slate-50 rounded-lg p-3 border" style={{ borderColor: "var(--card-border)" }}>
        {variant.body}
      </pre>
    </div>
  );
}
