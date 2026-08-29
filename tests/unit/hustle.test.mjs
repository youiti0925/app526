// 副業パイプラインの純ロジックの回帰テスト。
// 依存を増やさないよう Node 標準の node:test を使う。
//   実行: npm test
import test from "node:test";
import assert from "node:assert/strict";

import { scoreScam, combineSignals } from "../../dist-test/scam-rules.js";
import { computeStats, projectGoal, summarizeTasks, shiftDays, todayLocal } from "../../dist-test/analytics.js";
import { computePayout, PLATFORM_FEES } from "../../dist-test/payout.js";
import { diagnose, planToTasks } from "../../dist-test/diagnose.js";
import { PATH_DEFINITIONS } from "../../dist-test/paths-data.js";
import { emptyProfile } from "../../dist-test/types.js";
import { TEMPLATES } from "../../dist-test/templates.js";

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
  // 公称20% + 手数料の消費税で実効22% → 780円。最低出金額1000円に届かない。
  // 振込手数料は免除されるわけではなく、合算出金のときに引かれるので常に控除する。
  assert.equal(r.feeJpy, 220);
  assert.equal(r.canWithdraw, false);
  assert.equal(r.netJpy, 280);
  assert.ok(r.warnings.some((w) => w.includes("最低出金額")));
});

test("出金できる額なら振込手数料が引かれる", () => {
  const cw = PLATFORM_FEES.find((p) => p.id === "crowdworks");
  const r = computePayout(10000, cw, 5);
  assert.equal(r.feeJpy, 2200);
  assert.equal(r.canWithdraw, true);
  assert.equal(r.netJpy, 10000 - 2200 - 500);
  assert.equal(r.hourlyJpy, Math.round(7300 / 5));
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

test("「これはやらない」で指定したチャネルは除外される", () => {
  const profile = {
    ...emptyProfile,
    budgetJpy: 100000,
    equipment: ["pc", "smartphone", "stable_internet"],
    avoid: ["content_seo", "short_video"],
  };
  const r = diagnose(profile, PATH_DEFINITIONS);
  assert.ok(!r.ranked.some((x) => x.key === "content_seo"));
  assert.ok(!r.ranked.some((x) => x.key === "short_video"));
  const reasons = r.excluded.filter((x) => ["content_seo", "short_video"].includes(x.key));
  assert.equal(reasons.length, 2);
  for (const e of reasons) assert.match(e.excludedReason, /やりたくないこと/);
});

test("プランのタスクに、対応する生成テンプレートが紐づいている", () => {
  const ids = new Set(TEMPLATES.map((t) => t.id));
  let linked = 0;
  for (const d of PATH_DEFINITIONS) {
    for (const p of d.plan) {
      if (!p.template) continue;
      assert.ok(ids.has(p.template), `${d.key}: 存在しないテンプレート ${p.template}`);
      linked++;
    }
  }
  assert.ok(linked >= 8, `テンプレートに紐づいたタスクが ${linked} 件しかない`);
});

test("planToTasks が template を引き継ぐ", () => {
  const def = PATH_DEFINITIONS.find((d) => d.plan.some((p) => p.template));
  const tasks = planToTasks(def, "p1");
  const withTemplate = tasks.filter((t) => t.template);
  assert.ok(withTemplate.length > 0);
  for (const t of tasks) assert.equal(typeof t.template, "string");
});

test("全テンプレートが必須項目とフォールバックを持つ", () => {
  for (const t of TEMPLATES) {
    assert.ok(t.name && t.purpose, `${t.id}: 名前/目的が空`);
    assert.ok(t.manualMinutes > 0, `${t.id}: manualMinutes が0`);
    assert.ok(t.fields.length > 0, `${t.id}: 入力欄が無い`);
    const values = Object.fromEntries(t.fields.map((f) => [f.name, "テスト入力"]));
    const prompt = t.buildPrompt(values, 3);
    assert.ok(prompt.includes("テスト入力"), `${t.id}: プロンプトに入力が反映されていない`);
    const fallback = t.fallback(values);
    assert.ok(fallback.length > 50, `${t.id}: フォールバックが薄い`);
    // 空入力でも落ちないこと（必須未入力のままボタンを押されるケース）
    assert.doesNotThrow(() => t.fallback({}), `${t.id}: 空入力でフォールバックが落ちる`);
    assert.doesNotThrow(() => t.buildPrompt({}, 1), `${t.id}: 空入力でプロンプト生成が落ちる`);
  }
});

// --- 詐欺判定: 誤検知と見逃しの回帰 ------------------------------------------

test("2桁以上の高額報酬も implausible_rate で拾う", () => {
  for (const text of [
    "日給10万円のかんたんなお仕事です。",
    "日収15万円も可能。",
    "月収50万円を目指せます。",
    "副業で月100万円。",
  ]) {
    const r = scoreScam(text);
    assert.ok(
      r.signals.some((s) => s.id === "implausible_rate"),
      `拾えていない: ${text} → ${JSON.stringify(r.signals.map((s) => s.id))}`
    );
  }
});

test("「月収50万円を保証」を収入の断定として拾う", () => {
  const r = scoreScam("当社のシステムなら月収50万円を保証します。");
  assert.ok(r.signals.some((s) => s.id === "guaranteed_income"));
  assert.equal(r.verdict, "danger");
});

test("「Zoomで面談」だけの普通の求人を danger にしない", () => {
  const r = scoreScam(
    "【経理事務】freeeへの仕訳入力をお願いします。時給1,200円、週10時間。選考はZoomで面談を行います。お支払いはクラウドワークスの仮払いを通します。"
  );
  assert.notEqual(r.verdict, "danger", JSON.stringify(r.signals.map((s) => s.label)));
});

test("「売買シグナル」の記事案件を danger にしない", () => {
  const r = scoreScam(
    "【記事作成】株式投資の売買シグナルの読み方を解説する記事を3本お願いします。1本5,000円、クラウドワークスの仮払いを通します。修正は2回まで。"
  );
  assert.notEqual(r.verdict, "danger", JSON.stringify(r.signals.map((s) => s.label)));
});

test("「オンライン登録」をLINE誘導と誤検知しない", () => {
  const r = scoreScam(
    "オンライン登録をしていただき、指定のフォームから作業を進めてください。業務は在宅で完結します。報酬は月末締め翌月払いです。"
  );
  assert.ok(
    !r.signals.some((s) => s.id === "line_only_contact"),
    JSON.stringify(r.signals.map((s) => s.label))
  );
  assert.equal(r.verdict, "safe");
});

test("Telegram誘導と身分証の先出しがそろうと danger", () => {
  const both = scoreScam(
    "詳細はテレグラムでご連絡します。まずは身分証の写真を送ってください。高額報酬をお約束します。"
  );
  assert.equal(both.verdict, "danger");
  assert.ok(both.signals.some((s) => s.id === "telegram_signal_secrecy"));

  // 身分証の提出だけなら、単独では danger にしない（正規の本人確認と区別できないため）
  const idOnly = scoreScam("ご登録の際に本人確認書類として免許証の画像を提出いただきます。");
  assert.notEqual(idOnly.verdict, "danger", JSON.stringify(idOnly.signals.map((s) => s.label)));
});

test("公式LINE誘導＋前払い要求は従来どおり danger", () => {
  const r = scoreScam(
    "まずは公式LINEにご登録ください。初期費用として教材費19,800円が必要です。本日限定 残り3名。"
  );
  assert.equal(r.verdict, "danger");
  assert.ok(r.signals.some((s) => s.id === "line_only_contact"));
  assert.ok(r.signals.some((s) => s.id === "upfront_payment"));
});

// --- レビュー指摘の回帰 ------------------------------------------------------

test("目標の達成判定は経費を引いた額で行う", () => {
  const paths = [path("p1", "受託")];
  const entries = [
    entry({ pathId: "p1", kind: "income", amountJpy: 30000, settled: true }),
    entry({ pathId: "p1", kind: "expense", amountJpy: 20000 }),
    entry({ pathId: "p1", kind: "time", minutes: 600 }),
  ];
  const s = computeStats(entries, paths);
  assert.equal(s.monthSettledJpy, 30000);
  assert.equal(s.monthExpenseJpy, 20000);
  assert.equal(s.monthNetJpy, 10000);

  const g = projectGoal(s, 30000, "");
  assert.equal(g.achievedJpy, 10000, "入金額ではなく手元に残った額で判定する");
  assert.equal(g.remainingJpy, 20000);
  assert.ok(!/達成しています/.test(g.message));
});

test("日付が空の記録があっても撤退判定が暴走しない", () => {
  const paths = [path("p1", "受託")];
  const entries = [
    entry({ pathId: "p1", kind: "time", minutes: 900, date: "" }),
    entry({ pathId: "p1", kind: "time", minutes: 900, date: shiftDays(today, -1) }),
  ];
  const s = computeStats(entries, paths);
  assert.equal(s.channels[0].verdict, "too_early", s.channels[0].verdictReason);
  assert.ok(Number.isFinite(s.channels[0].ageDays));
});

test("最低出金額に届かなくても振込手数料は手取りから引く", () => {
  const cw = PLATFORM_FEES.find((p) => p.id === "crowdworks");
  const r = computePayout(1000, cw, 2);
  assert.equal(r.feeJpy, 220);
  assert.equal(r.canWithdraw, false);
  assert.equal(r.withdrawalFeeJpy, 500);
  assert.equal(r.netJpy, 280, "1000円 − 実効手数料220円 − 振込500円 = 280円");
  assert.ok(r.retentionRate < 0.5);
  assert.ok(r.warnings.some((w) => w.includes("最低出金額")));
  assert.ok(r.warnings.some((w) => w.includes("手元に残りません")));
});

test("完了時刻がUTCでも、ローカルの今日として数える", () => {
  const now = new Date();
  const t = {
    id: "1", pathId: null, title: "済", detail: "", kind: "produce",
    status: "done", dueDate: todayLocal(), estMinutes: 30, actualMinutes: 0,
    orderIndex: 0, doneAt: now.toISOString(), createdAt: "",
  };
  assert.equal(summarizeTasks([t]).doneToday, 1);

  // 壊れた値でも落ちない
  const broken = { ...t, id: "2", doneAt: "not-a-date" };
  assert.doesNotThrow(() => summarizeTasks([broken]));
  assert.equal(summarizeTasks([broken]).doneToday, 0);
});


// ---------------------------------------------------------------------------
// 実データで出た誤検知の回帰テスト
// 実際にギークスジョブ／ココナラから取り込んだ案件で「詐欺スコア70〜85」が
// 出てしまったもの。普通の案件を danger にすると、警告そのものが信用されなくなる。
// ---------------------------------------------------------------------------

test("requireAll は patterns に足す条件であって、単体では発火しない", () => {
  // 「個別説明会」＋「安定稼働」の"稼"だけで高額バックエンド判定が出ていた
  const text = [
    "Go／プレイヤープラットフォームのバックエンド開発案件",
    "安定稼働 長期プロジェクト 高単価",
    "ギークスジョブの掲載案件はリモートワークでの参画がご相談可能です。",
    "また、現在実施している個別説明会、各種イベントについてはこちら。",
    "単価税抜 95 〜 115 万円/月",
  ].join("\n");
  const r = scoreScam(text);
  assert.notEqual(r.verdict, "danger", JSON.stringify(r.signals));
  assert.ok(!r.signals.some((s) => s.id === "high_ticket_backend"), "高額バックエンドは発火しない");
});

test("闇バイト隠語の「UD」が英単語の中で発火しない", () => {
  // CLIP ST-UD-IO で発火していた
  const r = scoreScam("CLIP STUDIO PAINTによるオリジナル人物イラスト制作をお願いします。");
  assert.ok(!r.signals.some((s) => s.id === "dark_part_time"), JSON.stringify(r.signals));
  // 隠語として単独で出てきたときは、これまでどおり拾う
  const real = scoreScam("UDの仕事です。荷物を受け取って指定場所に運んでください。即日現金でお支払い。");
  assert.ok(real.score > 0, "本物の隠語は拾う");
});

test("「組織の体制構築」を連鎖販売と誤判定しない", () => {
  const r = scoreScam(
    "受注状況が非常に好調である一方、CS担当者のリソースが逼迫しています。新設組織の体制構築には時間を要するため、短期的な支援をお願いします。"
  );
  assert.ok(!r.signals.some((s) => s.id === "mlm_recruiting"), JSON.stringify(r.signals));
});

test("本物の連鎖販売（ダウンライン構築）はこれまでどおり拾う", () => {
  const r = scoreScam("ダウンラインを構築すれば、あなたは何もしなくても権利収入が入り続けます。");
  assert.ok(r.score > 0, JSON.stringify(r));
});

// ---------------------------------------------------------------------------
// いつ現金が入るか
// このアプリを使う理由が「お金が無い」ことなので、
// いくら稼げるかより、期日までに現金化できるかのほうが重要な場面がある。
// ---------------------------------------------------------------------------

import { projectPayout, checkCashNeed, nextCutoff, PAYOUT_RULES } from "../../dist-test/cashflow.js";

const AUG23 = new Date(2026, 7, 23); // 日曜

test("ココナラは毎週木曜なので現金化が速い", () => {
  const p = projectPayout(50_000, "coconala", AUG23, AUG23);
  assert.equal(p.payoutDate, "2026-08-27", "次の木曜");
  assert.ok(p.daysUntil <= 7, String(p.daysUntil));
});

test("クラウドワークスは締めてから半月かかる", () => {
  const p = projectPayout(50_000, "crowdworks", AUG23, AUG23);
  assert.equal(p.cutoffDate, "2026-08-31", "23日なので月末締め");
  assert.equal(p.payoutDate, "2026-09-15");
});

test("15日より前なら15日締め", () => {
  const aug10 = new Date(2026, 7, 10);
  assert.equal(projectPayout(50_000, "crowdworks", aug10, aug10).cutoffDate, "2026-08-15");
});

test("締め曜日当日は、その週に間に合わないものとして翌週にする", () => {
  const thursday = new Date(2026, 7, 27);
  const rule = PAYOUT_RULES.find((r) => r.platformId === "coconala");
  const next = nextCutoff(thursday, rule);
  assert.equal(next.getDate(), 3, "翌週の木曜（9/3）");
});

test("最低出金額に届かない報酬は、入らないものとして数える", () => {
  const p = projectPayout(500, "crowdworks", AUG23, AUG23);
  assert.equal(p.stuck, true);
  assert.match(p.note, /引き出せません/);
});

test("締め日の規則を確認していないものは、その旨を出す", () => {
  const p = projectPayout(50_000, "direct", AUG23, AUG23);
  assert.equal(p.verified, false);
  assert.match(p.note, /未確認/);
});

test("期日までに足りるかを判定し、足りなければ額と日数を出す", () => {
  const c = checkCashNeed(
    { byDate: "2026-09-05", amountJpy: 60_000, label: "家賃" },
    [
      { label: "記事10本", amountJpy: 50_000, platformId: "crowdworks", wonAt: AUG23 },
      { label: "資料作成", amountJpy: 30_000, platformId: "coconala", wonAt: AUG23 },
    ],
    AUG23
  );
  assert.equal(c.covers, false);
  assert.equal(c.arriving.length, 1, "ココナラだけ間に合う");
  assert.equal(c.tooLate.length, 1, "クラウドワークスは9/15で間に合わない");
  assert.equal(c.shortfallJpy, 60_000 - c.incomingJpy);
});

test("期日が近いときは、副業で埋めさせずに公的支援へ向ける", () => {
  const c = checkCashNeed(
    { byDate: "2026-08-30", amountJpy: 100_000, label: "家賃" },
    [],
    AUG23
  );
  assert.equal(c.covers, false);
  assert.match(c.advice, /副業で埋めようとしないでください/);
  assert.match(c.advice, /緊急小口資金|住居確保給付金/);
});

test("足りるときは余計なことを言わない", () => {
  const c = checkCashNeed(
    { byDate: "2026-09-30", amountJpy: 10_000, label: "携帯代" },
    [{ label: "資料作成", amountJpy: 30_000, platformId: "coconala", wonAt: AUG23 }],
    AUG23
  );
  assert.equal(c.covers, true);
  assert.ok(!/公的支援|窓口/.test(c.advice), c.advice);
});

// ---------------------------------------------------------------------------
// 次の1手
// 機能が増えるほど、どこから手をつければいいか分からなくなる。
// 選択肢を並べず、状態から1つだけ決める。順番は固定で、気分で変えない。
// ---------------------------------------------------------------------------

import { decideNextAction } from "../../dist-test/next-action.js";

const appState = (over = {}) => ({
  pendingInbox: 0,
  pendingListingDrafts: 0,
  published: [],
  newLeads: 0,
  hasSource: true,
  cashNeed: null,
  wonJobs: [],
  today: "2026-08-23",
  ...over,
});

test("現金が期日に間に合わないときは、副業の話より先にそちらを出す", () => {
  const a = decideNextAction(
    appState({ cashNeed: { byDate: "2026-08-30", amountJpy: 80_000, label: "家賃" }, pendingInbox: 10 })
  );
  assert.equal(a.kind, "cash_emergency");
  assert.equal(a.urgent, true);
  assert.match(a.why, /公的支援|緊急小口資金|住居確保給付金/);
});

test("現金が足りているなら、その警告は出さない", () => {
  const a = decideNextAction(
    appState({
      cashNeed: { byDate: "2026-12-31", amountJpy: 10_000, label: "目標" },
      wonJobs: [{ label: "記事", amountJpy: 50_000, platformId: "coconala", wonAt: new Date(2026, 7, 23) }],
      pendingInbox: 5,
    })
  );
  assert.notEqual(a.kind, "cash_emergency");
});

test("出品案があるのに1つも出していないなら、出させる", () => {
  const a = decideNextAction(appState({ pendingListingDrafts: 4 }));
  assert.equal(a.kind, "publish_listing");
  assert.match(a.why, /出すまでは1円にもなりません/);
});

test("出品済みで様子見の期間なら、いじらせずに種類を増やさせる", () => {
  const a = decideNextAction(
    appState({
      published: [
        {
          id: "l1", workTypeId: "sds", title: "SDS作成", platformId: "coconala", url: "",
          publishedAt: "2026-08-15", priceJpy: 45_000, views: 3, inquiries: 0, orders: 0,
          lastCheckedAt: "", status: "published", createdAt: "",
        },
      ],
    })
  );
  assert.equal(a.kind, "grow");
  assert.match(a.why, /いま出品文をいじらないでください/);
});

test("出品を直す必要があれば、どこを直すかまで出す", () => {
  const a = decideNextAction(
    appState({
      published: [
        {
          id: "l1", workTypeId: "sds", title: "SDS作成を代行します", platformId: "coconala", url: "",
          publishedAt: "2026-06-01", priceJpy: 45_000, views: 8, inquiries: 0, orders: 0,
          lastCheckedAt: "", status: "published", createdAt: "",
        },
      ],
    })
  );
  assert.equal(a.kind, "fix_listing");
  assert.match(a.why, /タイトルとカテゴリ/);
});

test("優先順位が固定されている（承認待ち > 判定待ち）", () => {
  const a = decideNextAction(appState({ pendingInbox: 5, newLeads: 20 }));
  assert.equal(a.kind, "clear_inbox");
});

test("何も無ければ、待たせずに入り口を増やさせる", () => {
  assert.equal(decideNextAction(appState()).kind, "grow");
});

// ---------------------------------------------------------------------------
// 税金の目安
// 副業で一番よくある事故が「20万円以下なら申告不要」の誤解。
// これは所得税だけの話で、住民税の申告は金額に関係なく必要。
// ---------------------------------------------------------------------------

import { summarizeTax, INCOME_TAX_THRESHOLD_JPY } from "../../dist-test/tax.js";

test("20万円のラインは売上ではなく所得（売上 − 経費）で見る", () => {
  const t = summarizeTax({
    revenueJpy: 250_000,
    expenseJpy: 80_000,
    hasExpenseRecords: true,
    isEmployee: true,
  });
  assert.equal(t.incomeJpy, 170_000);
  // 売上25万でも、経費8万を引けば20万円を超えていない
  assert.notEqual(t.flag, "over_threshold");
  // 経費を入れなければ超えていた、という対比
  const noExpense = summarizeTax({
    revenueJpy: 250_000,
    expenseJpy: 0,
    hasExpenseRecords: true,
    isEmployee: true,
  });
  assert.equal(noExpense.flag, "over_threshold");
});

test("住民税の申告は、金額に関係なく必ず出す", () => {
  for (const revenue of [0, 50_000, 500_000]) {
    const t = summarizeTax({ revenueJpy: revenue, expenseJpy: 0, hasExpenseRecords: true, isEmployee: true });
    assert.ok(
      t.warnings.some((w) => /住民税/.test(w)),
      `売上${revenue}で住民税の注意が出ていない`
    );
    assert.ok(t.todo.some((x) => /住民税/.test(x)));
  }
});

test("経費が記録されていなければ、そう警告する", () => {
  const t = summarizeTax({ revenueJpy: 300_000, expenseJpy: 0, hasExpenseRecords: false, isEmployee: true });
  assert.ok(t.warnings.some((w) => /経費が1件も記録されていません/.test(w)));
});

test("ラインに近づいたら、超える前に知らせる", () => {
  const t = summarizeTax({
    revenueJpy: 190_000,
    expenseJpy: 0,
    hasExpenseRecords: true,
    isEmployee: true,
  });
  assert.equal(t.flag, "near_threshold");
  assert.ok(t.todo.some((x) => /あと 10,000円/.test(x)), JSON.stringify(t.todo));
});

test("超えていれば確定申告が要ると言う", () => {
  const t = summarizeTax({
    revenueJpy: 500_000,
    expenseJpy: 100_000,
    hasExpenseRecords: true,
    isEmployee: true,
  });
  assert.equal(t.flag, "over_threshold");
  assert.ok(t.todo.some((x) => /確定申告が必要/.test(x)));
});

test("給与所得が無い人には、20万円の特例が使えないと言う", () => {
  const t = summarizeTax({
    revenueJpy: 100_000,
    expenseJpy: 0,
    hasExpenseRecords: true,
    isEmployee: false,
  });
  assert.ok(t.todo.some((x) => /特例は使えません/.test(x)));
});

test("目安であることを必ず添える（断定しない）", () => {
  const t = summarizeTax({ revenueJpy: 500_000, expenseJpy: 0, hasExpenseRecords: true, isEmployee: true });
  assert.match(t.note, /目安/);
  assert.match(t.note, /税務署|税理士/);
});

test("入金がゼロなら、余計なことを言わない", () => {
  const t = summarizeTax({ revenueJpy: 0, expenseJpy: 0, hasExpenseRecords: false, isEmployee: true });
  assert.equal(t.flag, "no_records");
  assert.match(t.note, /最初の1円/);
});

// ---------------------------------------------------------------------------
// 敵対的レビューで確定した誤検知の回帰テスト
// まっとうな案件を danger にすると、警告そのものが信用されなくなる。
// ---------------------------------------------------------------------------

test("「UDフォント」を闇バイト隠語と誤判定しない", () => {
  // 前の修正では ASCII 隣接しか除外しておらず、日本語が隣だと素通りしていた
  for (const t of ["本文はUDフォントを指定してください。", "UD-1の仕様に合わせてください。", "UDトラックスの資料です。"]) {
    const r = scoreScam(t);
    assert.ok(!r.signals.some((s) => s.id === "dark_part_time"), `${t} → ${JSON.stringify(r.signals)}`);
  }
  // 隠語として単独で立っているときは拾う
  assert.ok(scoreScam("UDの仕事です。荷物を受け取って指定場所に運んでください。").score > 0);
});

test("「初期費用0円」「登録料無料」を前払い要求と誤判定しない", () => {
  for (const t of [
    "初期費用0円・登録料無料をうたう自社サービスのLPを作成してください。報酬50,000円。",
    "登録料は不要です。",
    "入会金はいただきません。",
  ]) {
    const r = scoreScam(t);
    assert.ok(!r.signals.some((s) => s.id === "upfront_payment"), `${t} → ${JSON.stringify(r.signals)}`);
  }
  // 実際に払わせる形は拾う
  for (const t of ["登録料として30,000円をお支払いください。", "初期費用5万円を最初にご入金いただきます。"]) {
    assert.ok(scoreScam(t).signals.some((s) => s.id === "upfront_payment"), t);
  }
});

test("打ち合わせでの画面共有を遠隔操作と誤判定しない", () => {
  const r = scoreScam("作業内容の擦り合わせのため、初回はZoomで画面共有をお願いします。");
  assert.ok(!r.signals.some((s) => s.id === "remote_access_tool"), JSON.stringify(r.signals));
  // 操作させる文脈なら拾う
  for (const t of [
    "AnyDeskをインストールして画面を操作させてください。",
    "遠隔操作アプリをインストールしてください。",
  ]) {
    assert.ok(scoreScam(t).signals.some((s) => s.id === "remote_access_tool"), t);
  }
});
