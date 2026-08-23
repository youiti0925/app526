// 副業パイプラインの純ロジックの回帰テスト。
// 依存を増やさないよう Node 標準の node:test を使う。
//   実行: npm test
import test from "node:test";
import assert from "node:assert/strict";

import { scoreScam, combineSignals } from "../dist-test/scam-rules.js";
import { computeStats, projectGoal, summarizeTasks, shiftDays, todayLocal } from "../dist-test/analytics.js";
import { computePayout, PLATFORM_FEES } from "../dist-test/payout.js";
import { diagnose, planToTasks } from "../dist-test/diagnose.js";
import { PATH_DEFINITIONS } from "../dist-test/paths-data.js";
import { emptyProfile } from "../dist-test/types.js";

const today = todayLocal();

// --- 詐欺スコアリング -------------------------------------------------------

test("口座の譲渡要求だけで danger になる", () => {
  const r = scoreScam("簡単なお仕事です。あなたの銀行口座を貸していただくだけで日給3万円。");
  assert.equal(r.verdict, "danger");
  assert.ok(r.score >= 60, `score=${r.score}`);
  assert.ok(r.signals.some((s) => s.id === "bank_account_handover"));
  assert.match(r.advice, /#9110/);
});

test("典型的な情報商材の勧誘は danger", () => {
  const r = scoreScam(`スマホ1台で誰でも月収50万円！AIが自動で稼いでくれます。
必ず稼げます。1日10分のコピペ作業だけ。まずは公式LINEにご登録ください。
本日限定 残り3名。初期費用として教材費19,800円が必要です。`);
  assert.equal(r.verdict, "danger");
  assert.ok(r.signals.some((s) => s.id === "upfront_payment"));
  assert.ok(r.signals.some((s) => s.id === "guaranteed_income"));
  assert.ok(r.signals.some((s) => s.id === "ai_magic_tool"));
});

test("まっとうな募集文は safe", () => {
  const r = scoreScam(`【業務内容】自社ブログの記事作成をお願いします。
1記事3000文字程度、単価5000円。月4本を想定しています。
納品形式はGoogleドキュメント。修正は2回まで。
お支払いはクラウドワークスの仮払いを通します。
ご不明点はメッセージでお気軽にご質問ください。`);
  assert.equal(r.verdict, "safe", JSON.stringify(r.signals.map((s) => s.label)));
});

test("弱いシグナルが多数あっても、致命的な1本を超えない", () => {
  const manyWeak = combineSignals([
    { id: "a", label: "a", weight: 5, why: "" },
    { id: "b", label: "b", weight: 5, why: "" },
    { id: "c", label: "c", weight: 5, why: "" },
  ]);
  const oneFatal = combineSignals([{ id: "x", label: "x", weight: 10, why: "" }]);
  assert.ok(oneFatal.score > manyWeak.score, `fatal=${oneFatal.score} weak=${manyWeak.score}`);
  assert.equal(oneFatal.verdict, "danger");
});

test("空に近い入力でも例外にならない", () => {
  const r = scoreScam("こんにちは");
  assert.equal(r.verdict, "safe");
  assert.deepEqual(r.signals, []);
});

// --- 手取り計算 -------------------------------------------------------------

test("1000円の案件は手数料と振込手数料でほとんど残らない", () => {
  const cw = PLATFORM_FEES.find((p) => p.id === "crowdworks");
  const r = computePayout(1000, cw, 2);
  // 20% 手数料 → 800円。最低出金額 1000円 に届かないので出金不可。
  assert.equal(r.feeJpy, 200);
  assert.equal(r.canWithdraw, false);
  assert.equal(r.withdrawalFeeJpy, 0);
  assert.ok(r.warnings.some((w) => w.includes("最低出金額")));
});

test("出金できる額なら振込手数料が引かれる", () => {
  const cw = PLATFORM_FEES.find((p) => p.id === "crowdworks");
  const r = computePayout(10000, cw, 5);
  assert.equal(r.feeJpy, 2000);
  assert.equal(r.canWithdraw, true);
  assert.equal(r.netJpy, 10000 - 2000 - 500);
  assert.equal(r.hourlyJpy, Math.round(7500 / 5));
});

test("最低賃金を割ると警告が出る", () => {
  const cw = PLATFORM_FEES.find((p) => p.id === "crowdworks");
  const r = computePayout(5000, cw, 20);
  assert.ok(r.hourlyJpy < 1121);
  assert.ok(r.warnings.some((w) => w.includes("最低賃金")));
});

test("時間が0なら時給は null で、0除算しない", () => {
  const cw = PLATFORM_FEES.find((p) => p.id === "crowdworks");
  const r = computePayout(5000, cw, 0);
  assert.equal(r.hourlyJpy, null);
});

// --- 収支分析 ---------------------------------------------------------------

const path = (id, name) => ({
  id,
  pathKey: "crowdsourcing",
  name,
  status: "active",
  targetJpy: 30000,
  notes: "",
  startedAt: shiftDays(today, -90),
  createdAt: today,
  updatedAt: today,
});

const entry = (over) => ({
  id: Math.random().toString(36).slice(2),
  pathId: null,
  date: today,
  kind: "time",
  amountJpy: 0,
  minutes: 0,
  memo: "",
  settled: true,
  createdAt: today,
  ...over,
});

test("未入金の売上は実効時給に含めない", () => {
  const paths = [path("p1", "受託")];
  const entries = [
    entry({ pathId: "p1", kind: "income", amountJpy: 10000, settled: true }),
    entry({ pathId: "p1", kind: "income", amountJpy: 50000, settled: false }),
    entry({ pathId: "p1", kind: "time", minutes: 600 }),
  ];
  const s = computeStats(entries, paths);
  assert.equal(s.settledJpy, 10000);
  assert.equal(s.pendingJpy, 50000);
  assert.equal(s.hourlyJpy, 1000);
});

test("経費は実効時給から差し引かれる", () => {
  const paths = [path("p1", "受託")];
  const entries = [
    entry({ pathId: "p1", kind: "income", amountJpy: 12000, settled: true }),
    entry({ pathId: "p1", kind: "expense", amountJpy: 2000 }),
    entry({ pathId: "p1", kind: "time", minutes: 600 }),
  ];
  const s = computeStats(entries, paths);
  assert.equal(s.netJpy, 10000);
  assert.equal(s.hourlyJpy, 1000);
});

test("立ち上げ期は撤退判定を出さない", () => {
  const paths = [path("p1", "受託")];
  const entries = [entry({ pathId: "p1", kind: "time", minutes: 300, date: shiftDays(today, -3) })];
  const s = computeStats(entries, paths);
  assert.equal(s.channels[0].verdict, "too_early");
});

test("60日以上・十分な時間でプラスにならなければ撤退を勧める", () => {
  const paths = [path("p1", "受託")];
  const entries = [
    entry({ pathId: "p1", kind: "time", minutes: 600, date: shiftDays(today, -90) }),
    entry({ pathId: "p1", kind: "time", minutes: 600, date: shiftDays(today, -30) }),
  ];
  const s = computeStats(entries, paths);
  assert.equal(s.channels[0].verdict, "consider_quitting");
});

test("最低賃金を超えていれば続けるべきと判定する", () => {
  const paths = [path("p1", "受託")];
  const entries = [
    entry({ pathId: "p1", kind: "time", minutes: 600, date: shiftDays(today, -90) }),
    entry({ pathId: "p1", kind: "time", minutes: 600, date: shiftDays(today, -10) }),
    entry({ pathId: "p1", kind: "income", amountJpy: 40000, settled: true, date: shiftDays(today, -5) }),
  ];
  const s = computeStats(entries, paths);
  assert.equal(s.channels[0].verdict, "healthy");
});

test("入金がゼロなら目標到達日を計算せず、その旨を返す", () => {
  const s = computeStats([], []);
  const g = projectGoal(s, 30000, "");
  assert.equal(g.daysNeeded, null);
  assert.match(g.message, /最初の1円/);
});

test("期限に対してペースが足りなければ onTrack が false", () => {
  const paths = [path("p1", "受託")];
  const entries = [entry({ pathId: "p1", kind: "income", amountJpy: 3000, settled: true, date: shiftDays(today, -7) })];
  const s = computeStats(entries, paths);
  const g = projectGoal(s, 100000, shiftDays(today, 20));
  assert.equal(g.onTrack, false);
  assert.ok(g.requiredJpyPerMonth > s.runRateJpyPerMonth);
});

test("期限切れのタスクを拾う", () => {
  const tasks = [
    { id: "1", pathId: null, title: "遅れ", detail: "", kind: "produce", status: "todo", dueDate: shiftDays(today, -2), estMinutes: 30, actualMinutes: 0, orderIndex: 0, doneAt: null, createdAt: today },
    { id: "2", pathId: null, title: "今日", detail: "", kind: "produce", status: "todo", dueDate: today, estMinutes: 30, actualMinutes: 0, orderIndex: 1, doneAt: null, createdAt: today },
    { id: "3", pathId: null, title: "先", detail: "", kind: "produce", status: "todo", dueDate: shiftDays(today, 5), estMinutes: 30, actualMinutes: 0, orderIndex: 2, doneAt: null, createdAt: today },
  ];
  const s = summarizeTasks(tasks);
  assert.equal(s.overdueCount, 1);
  assert.equal(s.todayCount, 1);
  assert.equal(s.nextUp[0].id, "1", "期限切れが先頭に来る");
  assert.equal(s.nextUp.length, 2, "未来のタスクは含めない");
});

// --- 診断エンジン -----------------------------------------------------------

test("元手0円だと初期費用のかかるチャネルが除外される", () => {
  const profile = { ...emptyProfile, budgetJpy: 0 };
  const r = diagnose(profile, PATH_DEFINITIONS);
  for (const item of r.ranked) {
    assert.equal(item.definition.upfrontCostJpy, 0, `${item.name} が除外されていない`);
  }
  assert.ok(r.urgent, "元手0円は緊急扱いになる");
});

test("匿名希望なら実名が必要なチャネルは除外される", () => {
  const profile = { ...emptyProfile, budgetJpy: 100000, needsAnonymity: true };
  const r = diagnose(profile, PATH_DEFINITIONS);
  for (const item of r.ranked) {
    assert.equal(item.definition.requires.publicIdentity, false, `${item.name} が除外されていない`);
  }
});

test("銀行口座が無ければ換金できるチャネルは残らない", () => {
  const profile = { ...emptyProfile, budgetJpy: 100000, hasBankAccount: false };
  const r = diagnose(profile, PATH_DEFINITIONS);
  for (const item of r.ranked) {
    assert.equal(item.definition.requires.bankAccount, false);
  }
});

test("期限が近いと、入金の速いチャネルが上位に来る", () => {
  const urgent = diagnose({ ...emptyProfile, budgetJpy: 50000, deadline: shiftDays(today, 20) }, PATH_DEFINITIONS);
  const relaxed = diagnose({ ...emptyProfile, budgetJpy: 50000, deadline: "" }, PATH_DEFINITIONS);
  assert.ok(urgent.urgent);
  assert.ok(!relaxed.urgent);
  assert.ok(
    urgent.ranked[0].outlook.daysToFirstYen <= relaxed.ranked[0].outlook.daysToFirstYen,
    `urgent=${urgent.ranked[0].name}(${urgent.ranked[0].outlook.daysToFirstYen}日) relaxed=${relaxed.ranked[0].name}(${relaxed.ranked[0].outlook.daysToFirstYen}日)`
  );
});

test("全チャネルが除外されても落ちない", () => {
  const profile = { ...emptyProfile, budgetJpy: 0, hasBankAccount: false, hasIdVerification: false, needsAnonymity: true };
  const r = diagnose(profile, PATH_DEFINITIONS);
  assert.equal(r.ranked.length + r.excluded.length, PATH_DEFINITIONS.length);
});

test("スコアは常に 0-100 に収まる", () => {
  for (const budget of [0, 5000, 1000000]) {
    for (const hours of [1, 10, 60]) {
      const r = diagnose({ ...emptyProfile, budgetJpy: budget, weeklyHours: hours }, PATH_DEFINITIONS);
      for (const item of [...r.ranked, ...r.excluded]) {
        assert.ok(item.score >= 0 && item.score <= 100, `${item.name}: ${item.score}`);
      }
    }
  }
});

test("30日プランが日付つきタスクに展開される", () => {
  const def = PATH_DEFINITIONS[0];
  const tasks = planToTasks(def, "path-1", "2026-01-01");
  assert.equal(tasks.length, def.plan.length);
  assert.equal(tasks[0].pathId, "path-1");
  for (const t of tasks) {
    assert.match(t.dueDate, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(t.estMinutes > 0);
  }
});

// --- データ整合性 -----------------------------------------------------------

test("全チャネル定義が必要なフィールドを持つ", () => {
  assert.ok(PATH_DEFINITIONS.length >= 5);
  const keys = new Set();
  for (const d of PATH_DEFINITIONS) {
    assert.ok(!keys.has(d.key), `key が重複: ${d.key}`);
    keys.add(d.key);

    assert.ok(d.name && d.oneLiner, `${d.key}: 名前/概要が空`);
    assert.ok(d.daysToFirstYen.p50 > 0 && d.daysToFirstYen.p90 >= d.daysToFirstYen.p50, `${d.key}: 日数が不正`);
    assert.ok(d.month3Jpy[0] <= d.month3Jpy[1], `${d.key}: 3ヶ月目レンジが逆`);
    assert.ok(d.month6Jpy[0] <= d.month6Jpy[1], `${d.key}: 6ヶ月目レンジが逆`);
    assert.ok(d.stability >= 1 && d.stability <= 5, `${d.key}: stability が範囲外`);
    assert.ok(d.ceiling >= 1 && d.ceiling <= 5, `${d.key}: ceiling が範囲外`);
    assert.ok(d.whyPeopleFail.length > 0, `${d.key}: 失敗要因が空`);
    assert.ok(d.humanOnly.length > 0, `${d.key}: 人間必須の工程が空`);
    assert.ok(d.platformRules.length > 0, `${d.key}: 規約の注意が空`);
    assert.ok(d.plan.length >= 5, `${d.key}: 30日プランが薄い`);
    assert.ok(d.sources.length > 0, `${d.key}: 出典が無い`);

    for (const p of d.plan) {
      assert.ok(p.day >= 0 && p.day <= 60, `${d.key}: plan の day が範囲外 (${p.day})`);
      assert.ok(p.estMinutes > 0, `${d.key}: plan の estMinutes が0`);
    }
  }
});

test("初期費用0円のチャネルが少なくとも2つある", () => {
  const free = PATH_DEFINITIONS.filter((d) => d.upfrontCostJpy === 0);
  assert.ok(free.length >= 2, `無料で始められるチャネルが ${free.length} 件しかない`);
});

test("期限に間に合わない場合、より速いチャネルをつなぎとして提示する", () => {
  const r = diagnose(
    {
      ...emptyProfile,
      budgetJpy: 0,
      deadline: shiftDays(today, 10),
      skills: ["writing", "excel"],
      equipment: ["pc", "smartphone", "stable_internet"],
    },
    PATH_DEFINITIONS
  );
  assert.ok(r.bridge, "bridge が出ていない");
  assert.ok(r.ranked[0].outlook.daysToFirstYen > 10, "前提: 1位は10日で間に合わない");
  assert.match(r.bridge.note, /つなぎ|公的支援/);
});

test("期限に余裕があれば、つなぎは提示しない", () => {
  const r = diagnose(
    { ...emptyProfile, budgetJpy: 0, deadline: shiftDays(today, 300), equipment: ["pc", "stable_internet"] },
    PATH_DEFINITIONS
  );
  assert.equal(r.bridge, null);
});

test("期限未設定なら、つなぎは提示しない", () => {
  const r = diagnose({ ...emptyProfile, budgetJpy: 0, deadline: "" }, PATH_DEFINITIONS);
  assert.equal(r.bridge, null);
});

test("パソコンが無いと、パソコン必須のチャネルは除外される", () => {
  const r = diagnose({ ...emptyProfile, budgetJpy: 0, equipment: ["smartphone"] }, PATH_DEFINITIONS);
  for (const item of r.ranked) {
    assert.ok(!item.definition.equipment.includes("pc"), `${item.name} が除外されていない`);
  }
  assert.ok(r.excluded.some((e) => e.excludedReason.includes("パソコン")));
});

// --- 日付の扱い -------------------------------------------------------------
// toISOString() は UTC に変換するため、日本時間の午前0〜9時に使うと日付が
// 1日ずれる。このスイートは TZ=UTC と TZ=Asia/Tokyo の両方で実行される。

test("shiftDays はローカル日付として正しく増減する", () => {
  assert.equal(shiftDays("2026-03-01", -1), "2026-02-28");
  assert.equal(shiftDays("2026-02-28", 1), "2026-03-01");
  assert.equal(shiftDays("2026-12-31", 1), "2027-01-01");
  assert.equal(shiftDays("2026-01-01", -1), "2025-12-31");
  assert.equal(shiftDays("2026-08-23", 0), "2026-08-23");
});

test("todayLocal は端末のローカル日付を返す", () => {
  const now = new Date();
  const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  assert.equal(todayLocal(), expected);
});

test("30日プランの期日がローカル日付でずれない", () => {
  const def = PATH_DEFINITIONS.find((d) => d.plan.some((p) => p.day === 0));
  const tasks = planToTasks(def, "p1", "2026-03-01");
  const dayZero = def.plan.findIndex((p) => p.day === 0);
  assert.equal(tasks[dayZero].dueDate, "2026-03-01");
  const day7 = def.plan.findIndex((p) => p.day === 7);
  if (day7 >= 0) assert.equal(tasks[day7].dueDate, "2026-03-08");
});

test("今日のタスクが「今日」として扱われる", () => {
  const t = {
    id: "1", pathId: null, title: "今日のタスク", detail: "", kind: "produce",
    status: "todo", dueDate: todayLocal(), estMinutes: 30, actualMinutes: 0,
    orderIndex: 0, doneAt: null, createdAt: "",
  };
  const s = summarizeTasks([t]);
  assert.equal(s.todayCount, 1);
  assert.equal(s.overdueCount, 0);
});
