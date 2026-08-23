"use client";

import { useEffect, useState } from "react";
import { Compass, Loader2, Check, AlertTriangle, XCircle, ArrowRight, Clock, Banknote } from "lucide-react";
import { useHustleStore } from "@/store/useHustleStore";
import StorageNotice from "@/components/hustle/StorageNotice";
import { SKILL_LABELS, EQUIPMENT_LABELS, type SkillTag, type EquipmentTag } from "@/lib/hustle/paths-schema";
import { emptyProfile, type HustleProfile } from "@/lib/hustle/types";
import type { DiagnosisResult, Ranked } from "@/lib/hustle/diagnose";
import { planToTasks } from "@/lib/hustle/diagnose";

const yen = (n: number) => `${n.toLocaleString()}円`;

export default function DiagnosePage() {
  const { load, profile, saveProfile, addPath, addTasks, paths } = useHustleStore();
  // 未診断の初期状態では、このアプリを開けている前提の環境を仮に入れておく。
  // 実際と違えばチェックを外してもらう。空のままだと大半が「PCが無い」で除外されてしまう。
  const [form, setForm] = useState<HustleProfile>({
    ...emptyProfile,
    equipment: ["pc", "smartphone", "stable_internet"],
  });
  const [result, setResult] = useState<DiagnosisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (profile) setForm(profile);
  }, [profile]);

  function toggle<T extends string>(list: T[], value: T): T[] {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  }

  async function run() {
    setLoading(true);
    setError(null);
    try {
      await saveProfile(form);
      const res = await fetch("/api/hustle/diagnose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "診断に失敗しました");
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "診断に失敗しました");
    } finally {
      setLoading(false);
    }
  }

  async function excludePath(key: string) {
    const next = { ...form, avoid: [...form.avoid, key] };
    setForm(next);
    await saveProfile(next);
    const res = await fetch("/api/hustle/diagnose", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    });
    if (res.ok) setResult(await res.json());
  }

  async function restoreExcluded(key: string) {
    const next = { ...form, avoid: form.avoid.filter((k) => k !== key) };
    setForm(next);
    await saveProfile(next);
    const res = await fetch("/api/hustle/diagnose", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    });
    if (res.ok) setResult(await res.json());
  }

  async function startPath(ranked: Ranked) {
    setAdding(ranked.key);
    try {
      const path = await addPath({
        pathKey: ranked.key,
        name: ranked.name,
        status: "active",
        targetJpy: form.goalJpy,
        notes: ranked.oneLiner,
      });
      if (path) {
        await addTasks(planToTasks(ranked.definition, path.id));
      }
    } finally {
      setAdding(null);
    }
  }

  const startedKeys = new Set(paths.map((p) => p.pathKey));

  return (
    <div className="p-8 max-w-5xl">
      <StorageNotice />

      <header className="mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Compass className="w-6 h-6 text-emerald-600" />
          あなたの条件で副業を選ぶ
        </h1>
        <p className="text-sm text-slate-600 mt-2 leading-relaxed">
          「稼げる副業ランキング」は、あなたの手持ち時間・資金・スキルを無視しているから役に立ちません。
          ここでは条件を入れて、<strong className="text-slate-900">入金までの速さ</strong>を軸に並べ替えます。
          元手が用意できないものは最初から除外します。
        </p>
      </header>

      <div className="card mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <label className="block">
            <span className="text-sm font-medium">副業に使える時間（時間/週）</span>
            <input
              type="number"
              min={1}
              value={form.weeklyHours}
              onChange={(e) => setForm({ ...form, weeklyHours: Number(e.target.value) })}
              className="w-full rounded-lg border px-3 py-2 text-sm mt-1"
              style={{ borderColor: "var(--card-border)" }}
            />
            <span className="text-xs text-slate-500">睡眠と本業を削らずに、無理なく続く範囲で。</span>
          </label>

          <label className="block">
            <span className="text-sm font-medium">いま副業に出せるお金（円）</span>
            <input
              type="number"
              min={0}
              value={form.budgetJpy}
              onChange={(e) => setForm({ ...form, budgetJpy: Number(e.target.value) })}
              className="w-full rounded-lg border px-3 py-2 text-sm mt-1"
              style={{ borderColor: "var(--card-border)" }}
            />
            <span className="text-xs text-slate-500">0 で構いません。借りて始めるのは論外なので、正直に。</span>
          </label>

          <label className="block">
            <span className="text-sm font-medium">目標（円/月）</span>
            <input
              type="number"
              min={0}
              value={form.goalJpy}
              onChange={(e) => setForm({ ...form, goalJpy: Number(e.target.value) })}
              className="w-full rounded-lg border px-3 py-2 text-sm mt-1"
              style={{ borderColor: "var(--card-border)" }}
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium">いつまでに必要か</span>
            <input
              type="date"
              value={form.deadline}
              onChange={(e) => setForm({ ...form, deadline: e.target.value })}
              className="w-full rounded-lg border px-3 py-2 text-sm mt-1"
              style={{ borderColor: "var(--card-border)" }}
            />
            <span className="text-xs text-slate-500">空欄なら期限なしとして扱います。</span>
          </label>
        </div>

        <fieldset className="mb-4">
          <legend className="text-sm font-medium mb-2">できること（当てはまるもの全部）</legend>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(SKILL_LABELS) as SkillTag[]).map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => setForm({ ...form, skills: toggle(form.skills as SkillTag[], tag) })}
                className={`px-3 py-1.5 rounded-full border text-sm transition-colors ${
                  form.skills.includes(tag)
                    ? "bg-emerald-600 text-white border-emerald-600"
                    : "bg-white hover:bg-slate-50"
                }`}
                style={form.skills.includes(tag) ? undefined : { borderColor: "var(--card-border)" }}
              >
                {SKILL_LABELS[tag]}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="mb-4">
          <legend className="text-sm font-medium mb-2">持っているもの</legend>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(EQUIPMENT_LABELS) as EquipmentTag[]).map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => setForm({ ...form, equipment: toggle(form.equipment as EquipmentTag[], tag) })}
                className={`px-3 py-1.5 rounded-full border text-sm transition-colors ${
                  form.equipment.includes(tag)
                    ? "bg-emerald-600 text-white border-emerald-600"
                    : "bg-white hover:bg-slate-50"
                }`}
                style={form.equipment.includes(tag) ? undefined : { borderColor: "var(--card-border)" }}
              >
                {EQUIPMENT_LABELS[tag]}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="flex flex-wrap gap-4 mb-4 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.hasBankAccount}
              onChange={(e) => setForm({ ...form, hasBankAccount: e.target.checked })}
            />
            本人名義の銀行口座がある
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.hasIdVerification}
              onChange={(e) => setForm({ ...form, hasIdVerification: e.target.checked })}
            />
            本人確認書類（免許証・マイナンバーカード等）がある
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.needsAnonymity}
              onChange={(e) => setForm({ ...form, needsAnonymity: e.target.checked })}
            />
            実名・顔を出したくない（勤務先の副業規定など）
          </label>
        </div>

        <button onClick={run} disabled={loading} className="btn-primary flex items-center gap-2 disabled:opacity-60">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Compass className="w-4 h-4" />}
          この条件で並べ替える
        </button>
        {error && <p className="text-sm text-rose-600 mt-3">{error}</p>}
      </div>

      {result && (
        <section>
          <div className="rounded-lg border-l-4 border-l-emerald-500 bg-emerald-50 px-4 py-3 mb-4 text-sm leading-relaxed">
            {result.urgencyNote}
          </div>

          {result.bridge && (
            <div className="rounded-lg border-l-4 border-l-amber-500 bg-amber-50 px-4 py-3 mb-4 text-sm leading-relaxed flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />
              <span>{result.bridge.note}</span>
            </div>
          )}

          <div className="space-y-4">
            {result.ranked.map((r, i) => (
              <RankedCard
                key={r.key}
                rank={i + 1}
                ranked={r}
                started={startedKeys.has(r.key)}
                adding={adding === r.key}
                onStart={() => startPath(r)}
                onExclude={() => excludePath(r.key)}
              />
            ))}
          </div>

          {result.excluded.length > 0 && (
            <div className="mt-8">
              <h2 className="text-sm font-semibold text-slate-500 mb-3">
                今のあなたの条件では除外（{result.excluded.length}件）
              </h2>
              <div className="space-y-2">
                {result.excluded.map((r) => (
                  <div key={r.key} className="card !py-3 opacity-75">
                    <div className="flex items-start gap-2">
                      <XCircle className="w-4 h-4 mt-0.5 shrink-0 text-slate-400" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{r.name}</p>
                        <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">{r.excludedReason}</p>
                      </div>
                      {form.avoid.includes(r.key) && (
                        <button
                          onClick={() => restoreExcluded(r.key)}
                          className="text-xs text-emerald-700 hover:underline shrink-0"
                        >
                          候補に戻す
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function RankedCard({
  rank,
  ranked,
  started,
  adding,
  onStart,
  onExclude,
}: {
  rank: number;
  ranked: Ranked;
  started: boolean;
  adding: boolean;
  onStart: () => void;
  onExclude: () => void;
}) {
  const [open, setOpen] = useState(rank === 1);
  const def = ranked.definition;

  return (
    <div className={`card ${rank === 1 ? "border-l-4 !border-l-emerald-500" : ""}`}>
      <div className="flex items-start gap-4">
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm shrink-0 text-white"
          style={{ background: rank === 1 ? "#059669" : rank === 2 ? "#0d9488" : "#64748b" }}
        >
          {rank}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold">{ranked.name}</h3>
              <p className="text-sm text-slate-600 mt-0.5 leading-relaxed">{ranked.oneLiner}</p>
            </div>
            <span className="badge badge-info shrink-0">適合度 {ranked.score}</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3 text-sm">
            <Fact icon={Clock} label="最初の入金まで" value={`約${ranked.outlook.daysToFirstYen}日`} />
            <Fact
              icon={Banknote}
              label="3ヶ月目の目安"
              value={`${(ranked.outlook.month3Jpy[0] / 10000).toFixed(1)}〜${(ranked.outlook.month3Jpy[1] / 10000).toFixed(1)}万円`}
            />
            <Fact icon={Banknote} label="初期費用" value={yen(ranked.outlook.upfrontCostJpy)} />
            <Fact icon={Clock} label="必要な稼働" value={`週${ranked.outlook.minWeeklyHours}時間`} />
          </div>

          {ranked.warnings.length > 0 && (
            <ul className="mt-3 space-y-1">
              {ranked.warnings.map((w, i) => (
                <li key={i} className="text-xs text-amber-700 flex items-start gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span className="leading-relaxed">{w}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap items-center gap-3 mt-4">
            <button onClick={() => setOpen(!open)} className="text-sm text-emerald-700 hover:underline">
              {open ? "詳細を閉じる" : "詳細と30日プランを見る"}
            </button>
            {started ? (
              <span className="badge badge-success gap-1">
                <Check className="w-3.5 h-3.5" />
                開始済み
              </span>
            ) : (
              <>
                <button onClick={onStart} disabled={adding} className="btn-primary !py-1.5 !px-4 text-sm flex items-center gap-1.5 disabled:opacity-60">
                  {adding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowRight className="w-3.5 h-3.5" />}
                  これで始める（30日ぶんのタスクが入ります）
                </button>
                <button onClick={onExclude} className="text-sm text-slate-500 hover:text-slate-800 hover:underline">
                  これはやらない
                </button>
              </>
            )}
          </div>

          {open && (
            <div className="mt-4 pt-4 border-t space-y-4" style={{ borderColor: "var(--card-border)" }}>
              <Block title="なぜこれが成立するのか">
                <p className="text-sm leading-relaxed">{def.whyItWorks}</p>
              </Block>

              <Block title="この順位になった理由">
                <ul className="list-disc list-inside text-sm space-y-0.5">
                  {ranked.reasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </Block>

              <Block title="失敗する人が踏む地雷">
                <ul className="list-disc list-inside text-sm space-y-0.5">
                  {def.whyPeopleFail.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </Block>

              <Block title="このアプリが肩代わりする作業">
                <ul className="space-y-1.5">
                  {def.automatable.map((a, i) => (
                    <li key={i} className="text-sm">
                      <span className="font-medium">{a.step}</span>
                      <span className="text-emerald-700 text-xs ml-2">−約{a.savedMinutesPerUnit}分/回</span>
                      <p className="text-xs text-slate-600 mt-0.5">{a.how}</p>
                    </li>
                  ))}
                </ul>
              </Block>

              <Block title="自動化できない、自分でやるしかない部分">
                <ul className="list-disc list-inside text-sm space-y-0.5">
                  {def.humanOnly.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </Block>

              <Block title="プラットフォームの規約で気をつけること">
                <ul className="list-disc list-inside text-sm space-y-0.5">
                  {def.platformRules.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </Block>

              <Block title={`最初の30日にやること（${def.plan.length}件）`}>
                <ol className="space-y-1.5">
                  {def.plan.map((p, i) => (
                    <li key={i} className="text-sm flex gap-2">
                      <span className="text-xs text-slate-400 tabular-nums shrink-0 w-12">{p.day}日目</span>
                      <span>
                        <span className="font-medium">{p.title}</span>
                        <span className="text-xs text-slate-500 ml-2">{p.estMinutes}分</span>
                        <p className="text-xs text-slate-600 mt-0.5">{p.detail}</p>
                      </span>
                    </li>
                  ))}
                </ol>
              </Block>

              <Block title="この数字の根拠">
                <ul className="text-xs text-slate-500 space-y-0.5">
                  {def.sources.map((s, i) => (
                    <li key={i}>・{s}</li>
                  ))}
                </ul>
                <p className="text-xs text-slate-500 mt-2">{def.failureNote}</p>
              </Block>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Fact({ icon: Icon, label, value }: { icon: typeof Clock; label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-slate-500 flex items-center gap-1">
        <Icon className="w-3 h-3" />
        {label}
      </p>
      <p className="font-medium tabular-nums">{value}</p>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-sm font-semibold mb-1.5">{title}</h4>
      {children}
    </div>
  );
}
