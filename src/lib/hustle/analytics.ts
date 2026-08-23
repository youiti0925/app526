import type { HustleEntry, HustlePath, HustleTask } from "./types";

/**
 * 全国加重平均の最低賃金（円/時）。判断の基準線として使う。
 * 実額は毎年10月に改定されるため、設定で上書きできるようにしてある。
 */
export const DEFAULT_MIN_WAGE_JPY = 1121;

const toDate = (s: string) => new Date(`${s}T00:00:00`);
const todayStr = () => new Date().toISOString().slice(0, 10);

function daysBetween(a: string, b: string): number {
  const diff = toDate(b).getTime() - toDate(a).getTime();
  return Math.floor(diff / 86_400_000);
}

export function shiftDays(dateStr: string, days: number): string {
  const d = toDate(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface ChannelStats {
  pathId: string | null;
  name: string;
  /** 入金済みの収入合計 */
  settledJpy: number;
  /** 受注確定だが未入金 */
  pendingJpy: number;
  expenseJpy: number;
  /** 入金済み収入 - 経費 */
  netJpy: number;
  minutes: number;
  /** 実効時給。投入時間が 0 なら null。 */
  hourlyJpy: number | null;
  /** 最初に時間を投じてからの日数 */
  ageDays: number;
  /** 直近入金日からの経過日数。入金ゼロなら null。 */
  daysSinceLastIncome: number | null;
  /** 撤退を検討すべきか、その理由 */
  verdict: "too_early" | "healthy" | "watch" | "consider_quitting";
  verdictReason: string;
}

export interface OverallStats {
  settledJpy: number;
  pendingJpy: number;
  expenseJpy: number;
  netJpy: number;
  minutes: number;
  hourlyJpy: number | null;
  /** まだ1円も入っていないか */
  firstYenReached: boolean;
  firstYenDate: string | null;
  /** 今月分 */
  monthSettledJpy: number;
  monthMinutes: number;
  monthHourlyJpy: number | null;
  /** 直近28日の実績から見た月次ペース */
  runRateJpyPerMonth: number;
  channels: ChannelStats[];
}

export interface GoalProjection {
  goalJpy: number;
  achievedJpy: number;
  remainingJpy: number;
  /** 現ペースで達成に必要な日数。ペース0なら null。 */
  daysNeeded: number | null;
  /** 期限に間に合うか。期限未設定なら null。 */
  onTrack: boolean | null;
  /** 期限に間に合わせるために必要な月次ペース */
  requiredJpyPerMonth: number | null;
  message: string;
}

function minutesOf(entries: HustleEntry[]): number {
  return entries.reduce((sum, e) => sum + (e.kind === "time" ? e.minutes : 0), 0);
}

function incomeOf(entries: HustleEntry[], settledOnly: boolean): number {
  return entries.reduce(
    (sum, e) => (e.kind === "income" && (!settledOnly || e.settled) ? sum + e.amountJpy : sum),
    0
  );
}

function expenseOf(entries: HustleEntry[]): number {
  return entries.reduce((sum, e) => sum + (e.kind === "expense" ? e.amountJpy : 0), 0);
}

function hourly(netJpy: number, minutes: number): number | null {
  if (minutes <= 0) return null;
  return Math.round((netJpy / minutes) * 60);
}

function judgeChannel(
  netJpy: number,
  minutes: number,
  ageDays: number,
  daysSinceLastIncome: number | null,
  minWage: number
): { verdict: ChannelStats["verdict"]; reason: string } {
  const rate = hourly(netJpy, minutes);

  // 立ち上げ期に時給で判断すると、伸びる前に全部やめてしまう。
  if (ageDays < 30 || minutes < 600) {
    return {
      verdict: "too_early",
      reason: `まだ判断の材料が足りません（稼働${ageDays}日 / ${Math.round(minutes / 60)}時間）。30日 かつ 10時間 を超えてから評価します。`,
    };
  }

  if (rate === null) {
    return { verdict: "watch", reason: "投入時間が記録されていないため時給を計算できません。" };
  }

  if (netJpy <= 0 && ageDays >= 60) {
    return {
      verdict: "consider_quitting",
      reason: `60日以上・${Math.round(minutes / 60)}時間かけて収支がプラスになっていません。同じ時間を別のチャネルに移した方が期待値が高いです。`,
    };
  }

  if (rate >= minWage) {
    return {
      verdict: "healthy",
      reason: `実効時給 ${rate.toLocaleString()}円 は最低賃金（${minWage.toLocaleString()}円）を上回っています。ここに時間を寄せてください。`,
    };
  }

  if (rate >= minWage * 0.5) {
    return {
      verdict: "watch",
      reason: `実効時給 ${rate.toLocaleString()}円。最低賃金の半分は超えていますが下回っています。単価交渉か作業の自動化で改善しない場合、3ヶ月で見切ってください。`,
    };
  }

  if (daysSinceLastIncome !== null && daysSinceLastIncome > 45) {
    return {
      verdict: "consider_quitting",
      reason: `実効時給 ${rate.toLocaleString()}円 で、直近の入金から ${daysSinceLastIncome}日 空いています。撤退して時間を回収した方がいいです。`,
    };
  }

  return {
    verdict: "consider_quitting",
    reason: `実効時給 ${rate.toLocaleString()}円 は最低賃金の半分未満です。続けるほど時間を失います。`,
  };
}

export function computeStats(
  entries: HustleEntry[],
  paths: HustlePath[],
  minWage: number = DEFAULT_MIN_WAGE_JPY
): OverallStats {
  const today = todayStr();
  const monthPrefix = today.slice(0, 7);

  const settledJpy = incomeOf(entries, true);
  const pendingJpy = incomeOf(entries, false) - settledJpy;
  const expenseJpy = expenseOf(entries);
  const minutes = minutesOf(entries);
  const netJpy = settledJpy - expenseJpy;

  const incomeEntries = entries
    .filter((e) => e.kind === "income" && e.settled && e.amountJpy > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  const monthEntries = entries.filter((e) => e.date.startsWith(monthPrefix));
  const monthSettledJpy = incomeOf(monthEntries, true);
  const monthMinutes = minutesOf(monthEntries);

  const since = shiftDays(today, -28);
  const recentIncome = entries
    .filter((e) => e.kind === "income" && e.settled && e.date >= since)
    .reduce((sum, e) => sum + e.amountJpy, 0);

  const channels: ChannelStats[] = paths.map((path) => {
    const own = entries.filter((e) => e.pathId === path.id);
    const s = incomeOf(own, true);
    const p = incomeOf(own, false) - s;
    const exp = expenseOf(own);
    const min = minutesOf(own);
    const net = s - exp;

    const dates = own.map((e) => e.date).sort();
    const firstDate = dates[0] ?? path.startedAt ?? today;
    const ageDays = Math.max(0, daysBetween(firstDate, today));

    const lastIncomeDate = own
      .filter((e) => e.kind === "income" && e.settled && e.amountJpy > 0)
      .map((e) => e.date)
      .sort()
      .pop();
    const daysSinceLastIncome = lastIncomeDate ? daysBetween(lastIncomeDate, today) : null;

    const judged = judgeChannel(net, min, ageDays, daysSinceLastIncome, minWage);

    return {
      pathId: path.id,
      name: path.name,
      settledJpy: s,
      pendingJpy: p,
      expenseJpy: exp,
      netJpy: net,
      minutes: min,
      hourlyJpy: hourly(net, min),
      ageDays,
      daysSinceLastIncome,
      verdict: judged.verdict,
      verdictReason: judged.reason,
    };
  });

  return {
    settledJpy,
    pendingJpy,
    expenseJpy,
    netJpy,
    minutes,
    hourlyJpy: hourly(netJpy, minutes),
    firstYenReached: incomeEntries.length > 0,
    firstYenDate: incomeEntries[0]?.date ?? null,
    monthSettledJpy,
    monthMinutes,
    monthHourlyJpy: hourly(monthSettledJpy, monthMinutes),
    runRateJpyPerMonth: Math.round((recentIncome / 28) * 30),
    channels,
  };
}

export function projectGoal(stats: OverallStats, goalJpy: number, deadline: string): GoalProjection {
  const achievedJpy = stats.monthSettledJpy;
  const remainingJpy = Math.max(0, goalJpy - achievedJpy);
  const pace = stats.runRateJpyPerMonth;

  const daysNeeded = pace > 0 ? Math.ceil((remainingJpy / pace) * 30) : null;

  let onTrack: boolean | null = null;
  let requiredJpyPerMonth: number | null = null;

  if (deadline) {
    const daysLeft = daysBetween(todayStr(), deadline);
    if (daysLeft > 0) {
      requiredJpyPerMonth = Math.ceil((remainingJpy / daysLeft) * 30);
      onTrack = pace >= requiredJpyPerMonth;
    } else {
      requiredJpyPerMonth = remainingJpy;
      onTrack = remainingJpy <= 0;
    }
  }

  let message: string;
  if (remainingJpy <= 0) {
    message = "今月の目標は達成しています。";
  } else if (pace <= 0) {
    message =
      "まだ入金の実績がないため、到達時期を計算できません。まずは金額の大小を問わず「最初の1円」を作ってください。";
  } else if (onTrack === false && requiredJpyPerMonth !== null) {
    message = `現在のペースは月 ${pace.toLocaleString()}円。期限に間に合わせるには月 ${requiredJpyPerMonth.toLocaleString()}円 が必要です。目標か期限のどちらかを現実に合わせて調整してください。`;
  } else if (daysNeeded !== null) {
    message = `現在のペース（月 ${pace.toLocaleString()}円）なら、あと約 ${daysNeeded}日 で到達します。`;
  } else {
    message = "";
  }

  return { goalJpy, achievedJpy, remainingJpy, daysNeeded, onTrack, requiredJpyPerMonth, message };
}

export interface TaskSummary {
  todayCount: number;
  overdueCount: number;
  doneToday: number;
  nextUp: HustleTask[];
}

export function summarizeTasks(tasks: HustleTask[]): TaskSummary {
  const today = todayStr();
  const open = tasks.filter((t) => t.status === "todo" || t.status === "doing");

  const todayTasks = open.filter((t) => t.dueDate === today || t.dueDate === "");
  const overdue = open.filter((t) => t.dueDate !== "" && t.dueDate < today);
  const doneToday = tasks.filter((t) => t.status === "done" && (t.doneAt ?? "").startsWith(today));

  const nextUp = [...overdue, ...todayTasks]
    .sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999") || a.orderIndex - b.orderIndex)
    .slice(0, 8);

  return {
    todayCount: todayTasks.length,
    overdueCount: overdue.length,
    doneToday: doneToday.length,
    nextUp,
  };
}
