"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ListChecks,
  Check,
  Plus,
  Compass,
  Clock,
  Wallet,
  ArrowRight,
  AlertTriangle,
  Trash2,
  Sparkles,
} from "lucide-react";
import { useHustleStore } from "@/store/useHustleStore";
import StorageNotice from "@/components/hustle/StorageNotice";
import { computeStats, summarizeTasks, todayLocal, DEFAULT_MIN_WAGE_JPY } from "@/lib/hustle/analytics";
import type { HustleTask } from "@/lib/hustle/types";

const yen = (n: number) => `${n.toLocaleString()}円`;
const today = todayLocal;

export default function HustleDashboard() {
  const { load, loaded, tasks, entries, paths, profile, updateTask, addTask, removeTask, addEntry } =
    useHustleStore();
  const [newTask, setNewTask] = useState("");

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => computeStats(entries, paths), [entries, paths]);
  const taskSummary = useMemo(() => summarizeTasks(tasks), [tasks]);

  if (loaded && paths.length === 0) {
    return <FirstRun />;
  }

  async function complete(task: HustleTask) {
    await updateTask(task.id, { status: "done", doneAt: new Date().toISOString() });
    // 実効時給を正しく出すため、完了したタスクの見積時間を作業時間として記録する
    if (task.estMinutes > 0) {
      await addEntry({
        kind: "time",
        pathId: task.pathId,
        date: today(),
        minutes: task.estMinutes,
        amountJpy: 0,
        memo: task.title,
        settled: true,
      });
    }
  }

  return (
    <div className="p-8 max-w-5xl">
      <StorageNotice />

      <header className="mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ListChecks className="w-6 h-6 text-emerald-600" />
          今日やること
        </h1>
        <p className="text-sm text-slate-600 mt-2">
          考える時間をなくすために、やることは決めてあります。上から順に潰してください。
        </p>
      </header>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Stat label="今日のタスク" value={`${taskSummary.todayCount}件`} sub={`完了 ${taskSummary.doneToday}件`} />
        <Stat label="期限切れ" value={`${taskSummary.overdueCount}件`} warn={taskSummary.overdueCount > 0} />
        <Stat label="今月の入金" value={yen(stats.monthSettledJpy)} />
        <Stat
          label="実効時給"
          value={stats.hourlyJpy === null ? "—" : yen(stats.hourlyJpy)}
          sub={`最低賃金 ${DEFAULT_MIN_WAGE_JPY.toLocaleString()}円`}
          warn={stats.hourlyJpy !== null && stats.hourlyJpy < DEFAULT_MIN_WAGE_JPY}
        />
      </div>

      {!stats.firstYenReached && (
        <div className="card mb-6 border-l-4 !border-l-amber-500">
          <h2 className="font-semibold text-sm">まだ最初の1円が入っていません</h2>
          <p className="text-sm text-slate-600 mt-1.5 leading-relaxed">
            ここを越えるかどうかで、続くか続かないかが決まります。金額は問いません。
            プラットフォームには最低出金額があるので、口座に入るまでは数週間かかることを見込んでおいてください。
          </p>
        </div>
      )}

      <section className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">キュー</h2>
          <Link href="/hustle/diagnose" className="text-sm text-emerald-700 hover:underline flex items-center gap-1">
            チャネルを追加
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        {taskSummary.nextUp.length === 0 ? (
          <div className="card text-sm text-slate-500">
            今日のタスクはありません。次のタスクは先の日付に入っています。
            前倒しでやりたい場合は、下から追加してください。
          </div>
        ) : (
          <div className="space-y-2">
            {taskSummary.nextUp.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                pathName={paths.find((p) => p.id === task.pathId)?.name}
                onComplete={() => complete(task)}
                onDelete={() => removeTask(task.id)}
              />
            ))}
          </div>
        )}

        <p className="text-xs text-slate-500 mt-3">
          タスクを完了すると、見積時間がそのまま作業時間として記録されます。
          実際にかかった時間が違う場合は「収支と実効時給」で直してください。
        </p>

        <div className="flex gap-2 mt-3">
          <input
            value={newTask}
            onChange={(e) => setNewTask(e.target.value)}
            onKeyDown={async (e) => {
              if (e.key === "Enter" && newTask.trim()) {
                await addTask({ title: newTask.trim(), dueDate: today(), kind: "produce", estMinutes: 30 });
                setNewTask("");
              }
            }}
            placeholder="タスクを追加して Enter"
            className="flex-1 rounded-lg border px-3 py-2 text-sm"
            style={{ borderColor: "var(--card-border)" }}
          />
          <button
            onClick={async () => {
              if (!newTask.trim()) return;
              await addTask({ title: newTask.trim(), dueDate: today(), kind: "produce", estMinutes: 30 });
              setNewTask("");
            }}
            className="btn-secondary flex items-center gap-1.5 !py-2"
          >
            <Plus className="w-4 h-4" />
            追加
          </button>
        </div>
      </section>

      {stats.channels.some((c) => c.verdict === "consider_quitting") && (
        <section className="mb-6">
          <div className="card border-l-4 !border-l-rose-500">
            <h2 className="font-semibold flex items-center gap-2 text-sm">
              <AlertTriangle className="w-4 h-4 text-rose-600" />
              撤退を検討すべきチャネルがあります
            </h2>
            <ul className="mt-2 space-y-1.5">
              {stats.channels
                .filter((c) => c.verdict === "consider_quitting")
                .map((c) => (
                  <li key={c.pathId} className="text-sm">
                    <span className="font-medium">{c.name}</span>
                    <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">{c.verdictReason}</p>
                  </li>
                ))}
            </ul>
            <Link href="/hustle/money" className="text-sm text-emerald-700 hover:underline mt-2 inline-block">
              収支を確認する
            </Link>
          </div>
        </section>
      )}

      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <QuickLink
          href="/hustle/proposal"
          title="案件を判定して提案文をつくる"
          body="受けていい案件かを先に判定してから、提案文を3案。"
        />
        <QuickLink href="/hustle/factory" title="定型文をまとめて生成" body="営業メール、出品文、納品物の初稿。" />
        <QuickLink href="/hustle/scam" title="怪しいDMを判定" body="お金がないときほど狙われます。着手前に必ず。" />
      </section>

      {profile && (
        <p className="text-xs text-slate-400 mt-8">
          目標: 月 {yen(profile.goalJpy)}
          {profile.deadline && ` / 期限 ${profile.deadline}`} / 使える時間 週{profile.weeklyHours}時間
          <Link href="/hustle/diagnose" className="ml-2 hover:underline">
            変更する
          </Link>
        </p>
      )}
    </div>
  );
}

function FirstRun() {
  return (
    <div className="p-8 max-w-3xl">
      <StorageNotice />
      <div className="card">
        <h1 className="text-2xl font-bold mb-4">はじめに、正直なところを書いておきます</h1>
        <div className="space-y-3 text-sm leading-relaxed text-slate-700">
          <p>
            <strong className="text-slate-900">完全に自動でお金が入ってくるアプリは作れません。</strong>
            そう宣伝されているものは、ほぼ例外なく「それを売る側だけが儲かる」構造です。
            お金がないときにそこへ払うのが、いちばん損失の大きい選択になります。
          </p>
          <p>
            このアプリが自動化するのは<strong className="text-slate-900">「稼ぐための作業」</strong>です。
            案件を見極める、提案文を書く、営業メールを書く、納品物の初稿を作る、収支を計算する。
            これらは毎回ほぼ同じ形をしているので、機械にやらせる意味があります。
          </p>
          <p>
            自動化できないのは、<strong className="text-slate-900">相手との信用をつくる部分</strong>です。
            そこだけに時間を使えるようにするのが、このアプリの目的です。
          </p>
          <p>
            そして、稼げていないときに一番大事なのは「稼げていないと気づくこと」です。
            投入時間と入金を記録して、実効時給が最低賃金を割っていたら撤退を勧めます。
            続けるべきでないものを続けさせません。
          </p>
          <p className="rounded-lg bg-slate-50 p-3 text-xs">
            調べた結果の要点だけ先に書いておきます。クラウドソーシングは登録しても中央値の人は1円も稼げないまま
            3か月以内に離脱します。ブログは中央値で6か月後も入金0円。AI音声の動画量産は2025年7月の規約改定で
            収益化の対象外だと明記されました。AI素材のストック販売は販路そのものが閉じつつあります。
            物販は家の不用品が尽きる2〜3か月で終わります。
            <br />
            それでも0円で始められる道はあります。現金が手元に来るまでの最短は
            <strong className="text-slate-900">「家にある不用品を売って7〜14日」</strong>、次が
            <strong className="text-slate-900">「クラウドソーシングで3〜6週間」</strong>です。
            それ以外はすべて数か月かかります。
          </p>
          <p>
            最後にひとつだけ。
            <strong className="text-slate-900">
              仕事を受ける側が、先にお金を払うことは絶対にありません。
            </strong>
            登録料・保証金・手数料・出金手数料・凍結解除費など、名目が何であれ1円でも先払いを求められた時点で、それは詐欺です。
            焦っているときほど、この一行だけは読み返してください。
          </p>
        </div>

        <div className="mt-6 pt-6 border-t" style={{ borderColor: "var(--card-border)" }}>
          <Link href="/hustle/diagnose" className="btn-primary inline-flex items-center gap-2">
            <Compass className="w-4 h-4" />
            自分の条件で副業を選ぶ
          </Link>
          <p className="text-xs text-slate-500 mt-3">
            所要3分。時間・資金・スキルを入れると、入金までの速さ順に並べ替えます。
          </p>
        </div>

        <div className="mt-6 rounded-lg bg-slate-50 p-4 text-xs text-slate-600 leading-relaxed">
          今日の生活費が足りない状況であれば、副業より先に使える制度があります。
          <Link href="/hustle/guide" className="text-emerald-700 hover:underline ml-1">
            相談窓口と公的支援を見る
          </Link>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div className="card !p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`text-xl font-bold tabular-nums mt-1 ${warn ? "text-rose-600" : ""}`}>{value}</p>
      {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
    </div>
  );
}

function TaskRow({
  task,
  pathName,
  onComplete,
  onDelete,
}: {
  task: HustleTask;
  pathName?: string;
  onComplete: () => void;
  onDelete: () => void;
}) {
  const overdue = task.dueDate !== "" && task.dueDate < today();

  return (
    <div className="card !py-3 flex items-start gap-3">
      <button
        onClick={onComplete}
        className="w-5 h-5 rounded border-2 border-slate-300 hover:border-emerald-500 hover:bg-emerald-50 shrink-0 mt-0.5 flex items-center justify-center transition-colors"
        aria-label="完了にする"
      >
        <Check className="w-3 h-3 text-transparent hover:text-emerald-600" />
      </button>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{task.title}</p>
        {task.detail && <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">{task.detail}</p>}
        <div className="flex flex-wrap items-center gap-2 mt-1.5 text-xs text-slate-500">
          {pathName && <span className="badge badge-info">{pathName}</span>}
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {task.estMinutes}分
          </span>
          {task.dueDate && (
            <span className={overdue ? "text-rose-600 font-medium" : ""}>
              {overdue ? `期限切れ ${task.dueDate}` : task.dueDate}
            </span>
          )}
          {task.template && (
            <Link
              href={`/hustle/factory?template=${task.template}`}
              className="flex items-center gap-1 text-emerald-700 hover:underline font-medium"
            >
              <Sparkles className="w-3 h-3" />
              AIに下書きさせる
            </Link>
          )}
        </div>
      </div>
      <button onClick={onDelete} className="text-slate-300 hover:text-rose-600 shrink-0" aria-label="削除">
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}

function QuickLink({ href, title, body }: { href: string; title: string; body: string }) {
  return (
    <Link href={href} className="card hover:border-emerald-400 transition-colors block">
      <h3 className="font-semibold text-sm flex items-center gap-1.5">
        <Wallet className="w-4 h-4 text-emerald-600" />
        {title}
      </h3>
      <p className="text-xs text-slate-600 mt-1 leading-relaxed">{body}</p>
    </Link>
  );
}
