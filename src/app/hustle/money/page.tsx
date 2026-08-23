"use client";

import { useEffect, useMemo, useState } from "react";
import { Wallet, Plus, Trash2, Calculator, TrendingUp, TrendingDown, AlertTriangle } from "lucide-react";
import { useHustleStore } from "@/store/useHustleStore";
import StorageNotice from "@/components/hustle/StorageNotice";
import { computeStats, projectGoal, DEFAULT_MIN_WAGE_JPY } from "@/lib/hustle/analytics";
import { PLATFORM_FEES, computePayout } from "@/lib/hustle/payout";
import type { ChannelStats } from "@/lib/hustle/analytics";

const yen = (n: number) => `${n.toLocaleString()}円`;

export default function MoneyPage() {
  const { load, entries, paths, profile, addEntry, removeEntry } = useHustleStore();

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => computeStats(entries, paths), [entries, paths]);
  const goal = useMemo(
    () => projectGoal(stats, profile?.goalJpy ?? 0, profile?.deadline ?? ""),
    [stats, profile]
  );

  return (
    <div className="p-8 max-w-6xl">
      <StorageNotice />

      <header className="mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Wallet className="w-6 h-6 text-emerald-600" />
          収支と実効時給
        </h1>
        <p className="text-sm text-slate-600 mt-2 leading-relaxed">
          副業で失敗する最大の原因は、稼げないことではなく
          <strong className="text-slate-900">「稼げていないことに気づかないまま時間を溶かす」</strong>
          ことです。入金と時間を両方記録して、実効時給で判断します。
        </p>
      </header>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatCard label="入金済み（累計）" value={yen(stats.settledJpy)} />
        <StatCard label="未入金（確定分）" value={yen(stats.pendingJpy)} sub="まだ口座に入っていない" />
        <StatCard label="投入時間（累計）" value={`${Math.round(stats.minutes / 60)}時間`} />
        <StatCard
          label="実効時給"
          value={stats.hourlyJpy === null ? "—" : yen(stats.hourlyJpy)}
          sub={`最低賃金 ${DEFAULT_MIN_WAGE_JPY.toLocaleString()}円`}
          warn={stats.hourlyJpy !== null && stats.hourlyJpy < DEFAULT_MIN_WAGE_JPY}
        />
      </div>

      {!stats.firstYenReached && (
        <div className="card mb-6 border-l-4 !border-l-amber-500">
          <h2 className="font-semibold flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600" />
            まだ最初の1円が入っていません
          </h2>
          <p className="text-sm text-slate-600 mt-2 leading-relaxed">
            ここが最大の関門です。金額の大小ではなく「入金される経験を1回作る」ことを目標にしてください。
            なお多くのプラットフォームには最低出金額（多くは1,000円）があり、それ未満は口座に入りません。
            下の手取り計算で、実際にいくら残るかを先に確認してください。
          </p>
        </div>
      )}

      {profile && profile.goalJpy > 0 && (
        <div className="card mb-6">
          <h2 className="font-semibold mb-2">目標 {yen(profile.goalJpy)} / 月 に対して</h2>
          <div className="progress-bar mb-2">
            <div
              className="progress-bar-fill"
              style={{ width: `${Math.min(100, (goal.achievedJpy / Math.max(1, goal.goalJpy)) * 100)}%` }}
            />
          </div>
          <p className="text-sm text-slate-600">
            今月 {yen(goal.achievedJpy)} / 残り {yen(goal.remainingJpy)}
          </p>
          {goal.message && <p className="text-sm mt-2 leading-relaxed">{goal.message}</p>}
        </div>
      )}

      <PayoutCalculator />

      <section className="mt-6">
        <h2 className="font-semibold mb-3">チャネル別の判定</h2>
        {stats.channels.length === 0 ? (
          <p className="text-sm text-slate-500">
            まだチャネルがありません。「副業を選ぶ」で診断すると登録されます。
          </p>
        ) : (
          <div className="space-y-3">
            {stats.channels.map((c) => (
              <ChannelCard key={c.pathId} channel={c} />
            ))}
          </div>
        )}
      </section>

      <EntryForm paths={paths} onAdd={addEntry} />

      <section className="mt-6">
        <h2 className="font-semibold mb-3">記録（{entries.length}件）</h2>
        {entries.length === 0 ? (
          <p className="text-sm text-slate-500">まだ記録がありません。作業したらすぐ時間を入れてください。</p>
        ) : (
          <div className="card !p-0 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-3 py-2">日付</th>
                  <th className="px-3 py-2">チャネル</th>
                  <th className="px-3 py-2">種類</th>
                  <th className="px-3 py-2 text-right">金額 / 時間</th>
                  <th className="px-3 py-2">メモ</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {entries.slice(0, 60).map((e) => (
                  <tr key={e.id} className="border-t" style={{ borderColor: "var(--card-border)" }}>
                    <td className="px-3 py-2 tabular-nums whitespace-nowrap">{e.date}</td>
                    <td className="px-3 py-2 text-slate-600">
                      {paths.find((p) => p.id === e.pathId)?.name ?? "—"}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`badge ${
                          e.kind === "income" ? "badge-success" : e.kind === "expense" ? "badge-danger" : "badge-info"
                        }`}
                      >
                        {e.kind === "income" ? (e.settled ? "入金" : "未入金") : e.kind === "expense" ? "経費" : "作業"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {e.kind === "time" ? `${e.minutes}分` : yen(e.amountJpy)}
                    </td>
                    <td className="px-3 py-2 text-slate-600 max-w-xs truncate">{e.memo}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => void removeEntry(e.id)}
                        className="text-slate-400 hover:text-rose-600"
                        aria-label="削除"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function StatCard({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div className="card !p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`text-xl font-bold tabular-nums mt-1 ${warn ? "text-rose-600" : ""}`}>{value}</p>
      {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
    </div>
  );
}

function ChannelCard({ channel }: { channel: ChannelStats }) {
  const tone = {
    healthy: { cls: "badge-success", label: "続ける", Icon: TrendingUp },
    watch: { cls: "badge-warning", label: "様子見", Icon: AlertTriangle },
    consider_quitting: { cls: "badge-danger", label: "撤退を検討", Icon: TrendingDown },
    too_early: { cls: "badge-info", label: "判断はまだ早い", Icon: AlertTriangle },
  }[channel.verdict];

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-3 mb-2">
        <h3 className="font-semibold">{channel.name}</h3>
        <span className={`badge ${tone.cls} gap-1 shrink-0`}>
          <tone.Icon className="w-3.5 h-3.5" />
          {tone.label}
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm mb-2">
        <div>
          <p className="text-xs text-slate-500">入金済み</p>
          <p className="tabular-nums font-medium">{yen(channel.settledJpy)}</p>
        </div>
        <div>
          <p className="text-xs text-slate-500">経費</p>
          <p className="tabular-nums font-medium">{yen(channel.expenseJpy)}</p>
        </div>
        <div>
          <p className="text-xs text-slate-500">投入時間</p>
          <p className="tabular-nums font-medium">{Math.round(channel.minutes / 60)}時間</p>
        </div>
        <div>
          <p className="text-xs text-slate-500">実効時給</p>
          <p
            className={`tabular-nums font-medium ${
              channel.hourlyJpy !== null && channel.hourlyJpy < DEFAULT_MIN_WAGE_JPY ? "text-rose-600" : ""
            }`}
          >
            {channel.hourlyJpy === null ? "—" : yen(channel.hourlyJpy)}
          </p>
        </div>
      </div>
      <p className="text-sm text-slate-600 leading-relaxed">{channel.verdictReason}</p>
    </div>
  );
}

function PayoutCalculator() {
  const [gross, setGross] = useState(3000);
  const [platformId, setPlatformId] = useState(PLATFORM_FEES[0].id);
  const [hours, setHours] = useState(5);
  const [otherCost, setOtherCost] = useState(0);

  const platform = PLATFORM_FEES.find((p) => p.id === platformId)!;
  const result = computePayout(gross, platform, hours, otherCost);

  return (
    <div className="card">
      <h2 className="font-semibold flex items-center gap-2 mb-1">
        <Calculator className="w-4 h-4 text-emerald-600" />
        手取り計算
      </h2>
      <p className="text-sm text-slate-600 mb-4 leading-relaxed">
        受注額はそのままもらえません。手数料・振込手数料・最低出金額を引いて、実際に口座に入る額と実効時給を出します。
        <strong className="text-slate-900">受ける前にここを通してください。</strong>
      </p>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <label className="block">
          <span className="text-xs text-slate-500">受注額（円）</span>
          <input
            type="number"
            value={gross}
            onChange={(e) => setGross(Number(e.target.value))}
            className="w-full rounded-lg border px-3 py-2 text-sm mt-1"
            style={{ borderColor: "var(--card-border)" }}
          />
        </label>
        <label className="block">
          <span className="text-xs text-slate-500">プラットフォーム</span>
          <select
            value={platformId}
            onChange={(e) => setPlatformId(e.target.value)}
            className="w-full rounded-lg border px-3 py-2 text-sm mt-1"
            style={{ borderColor: "var(--card-border)" }}
          >
            {PLATFORM_FEES.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-slate-500">かかる時間（時間）</span>
          <input
            type="number"
            step="0.5"
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
            className="w-full rounded-lg border px-3 py-2 text-sm mt-1"
            style={{ borderColor: "var(--card-border)" }}
          />
        </label>
        <label className="block">
          <span className="text-xs text-slate-500">その他の経費（円）</span>
          <input
            type="number"
            value={otherCost}
            onChange={(e) => setOtherCost(Number(e.target.value))}
            className="w-full rounded-lg border px-3 py-2 text-sm mt-1"
            style={{ borderColor: "var(--card-border)" }}
          />
        </label>
      </div>

      <div className="rounded-lg bg-slate-50 p-4 border" style={{ borderColor: "var(--card-border)" }}>
        <div className="space-y-1 text-sm">
          <Row label="受注額" value={yen(result.grossJpy)} />
          <Row label={`システム手数料（${Math.round(platform.feeRate * 100)}%）`} value={`-${yen(result.feeJpy)}`} negative />
          <Row label="振込手数料" value={`-${yen(result.withdrawalFeeJpy)}`} negative />
          {result.otherCostJpy > 0 && <Row label="その他経費" value={`-${yen(result.otherCostJpy)}`} negative />}
          <div className="border-t pt-1.5 mt-1.5" style={{ borderColor: "var(--card-border)" }}>
            <Row label="手取り" value={yen(result.netJpy)} bold />
            <Row
              label="実効時給"
              value={result.hourlyJpy === null ? "—" : yen(result.hourlyJpy)}
              bold
              negative={result.hourlyJpy !== null && result.hourlyJpy < DEFAULT_MIN_WAGE_JPY}
            />
            <Row label="手元に残る割合" value={`${Math.round(result.retentionRate * 100)}%`} />
          </div>
        </div>

        <p className="text-xs text-slate-500 mt-3">
          {platform.feeNote} / {platform.withdrawalNote} / 入金: {platform.payoutLagDays}
        </p>

        {result.warnings.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {result.warnings.map((w, i) => (
              <li key={i} className="text-sm text-rose-700 flex items-start gap-1.5">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <span className="leading-relaxed">{w}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, negative, bold }: { label: string; value: string; negative?: boolean; bold?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className={bold ? "font-semibold" : "text-slate-600"}>{label}</span>
      <span className={`tabular-nums ${bold ? "font-bold" : ""} ${negative ? "text-rose-600" : ""}`}>{value}</span>
    </div>
  );
}

function EntryForm({
  paths,
  onAdd,
}: {
  paths: { id: string; name: string }[];
  onAdd: (entry: {
    kind: "income" | "expense" | "time";
    pathId: string | null;
    date: string;
    amountJpy: number;
    minutes: number;
    memo: string;
    settled: boolean;
  }) => Promise<void>;
}) {
  const [kind, setKind] = useState<"income" | "expense" | "time">("time");
  const [pathId, setPathId] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState("");
  const [minutes, setMinutes] = useState("");
  const [memo, setMemo] = useState("");
  const [settled, setSettled] = useState(true);

  async function submit() {
    await onAdd({
      kind,
      pathId: pathId || null,
      date,
      amountJpy: Number(amount) || 0,
      minutes: Number(minutes) || 0,
      memo,
      settled,
    });
    setAmount("");
    setMinutes("");
    setMemo("");
  }

  return (
    <section className="card mt-6">
      <h2 className="font-semibold mb-3">記録を追加</h2>
      <div className="flex flex-wrap gap-3 items-end">
        <label className="block">
          <span className="text-xs text-slate-500">種類</span>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as typeof kind)}
            className="block rounded-lg border px-3 py-2 text-sm mt-1"
            style={{ borderColor: "var(--card-border)" }}
          >
            <option value="time">作業時間</option>
            <option value="income">収入</option>
            <option value="expense">経費</option>
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-slate-500">日付</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="block rounded-lg border px-3 py-2 text-sm mt-1"
            style={{ borderColor: "var(--card-border)" }}
          />
        </label>
        <label className="block">
          <span className="text-xs text-slate-500">チャネル</span>
          <select
            value={pathId}
            onChange={(e) => setPathId(e.target.value)}
            className="block rounded-lg border px-3 py-2 text-sm mt-1"
            style={{ borderColor: "var(--card-border)" }}
          >
            <option value="">未指定</option>
            {paths.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        {kind === "time" ? (
          <label className="block">
            <span className="text-xs text-slate-500">分</span>
            <input
              type="number"
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              placeholder="90"
              className="block w-28 rounded-lg border px-3 py-2 text-sm mt-1"
              style={{ borderColor: "var(--card-border)" }}
            />
          </label>
        ) : (
          <label className="block">
            <span className="text-xs text-slate-500">金額（円）</span>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="3000"
              className="block w-32 rounded-lg border px-3 py-2 text-sm mt-1"
              style={{ borderColor: "var(--card-border)" }}
            />
          </label>
        )}
        {kind === "income" && (
          <label className="flex items-center gap-1.5 text-sm pb-2">
            <input type="checkbox" checked={settled} onChange={(e) => setSettled(e.target.checked)} />
            口座に入金済み
          </label>
        )}
        <label className="block flex-1 min-w-40">
          <span className="text-xs text-slate-500">メモ</span>
          <input
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="例: 提案文を8件送った"
            className="block w-full rounded-lg border px-3 py-2 text-sm mt-1"
            style={{ borderColor: "var(--card-border)" }}
          />
        </label>
        <button onClick={submit} className="btn-primary flex items-center gap-1.5 !py-2">
          <Plus className="w-4 h-4" />
          追加
        </button>
      </div>
      <p className="text-xs text-slate-500 mt-3">
        提案文を書いた時間・案件を探した時間も「作業時間」に入れてください。そこを除外すると実効時給が実態より高く出て、判断を誤ります。
      </p>
    </section>
  );
}
