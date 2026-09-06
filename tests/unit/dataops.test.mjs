// データ入力・書類作成エンジン（dataops）の回帰テスト。
// 実案件で起きた事故（ダミー電話の納品、表記ゆれの誤除外、項目の黙殺）を固定する。
import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeWidth, normalizeText, normalizePhoneJp, phoneKey, urlKey, corpKey,
  splitAddressJp, normalizePostal,
} from "../../dist-test/dataops/normalize.js";
import {
  stripHtml, extractPhones, extractEmails, extractUrls, extractPricesJpy,
  extractCorpNames, extractDates, extractAll,
} from "../../dist-test/dataops/extract.js";
import {
  isValidJpPhone, isDummyPhone, isEmail, isHttpUrl, inPriceBand, checkRow,
} from "../../dist-test/dataops/validate.js";
import { reconcileField, reconcileRow, summarizeReconcile } from "../../dist-test/dataops/crosscheck.js";
import { dedupeRows, excludeByNgList, diffAgainstExisting } from "../../dist-test/dataops/listops.js";
import { valueCounts, crossTab, numericSummary } from "../../dist-test/dataops/tabulate.js";
import { fillTemplate, mailMerge } from "../../dist-test/dataops/template.js";
import { parseTable, toCsvText } from "../../dist-test/dataops/table.js";
import { DATAOPS_PATTERNS, matchDataOpsPatterns } from "../../dist-test/dataops/registry.js";

// --- 正規化 -----------------------------------------------------------------

test("全角英数・半角カナ・空白の揺れを吸収する", () => {
  assert.equal(normalizeWidth("ＡＢＣ１２３"), "ABC123");
  assert.equal(normalizeWidth("ｷﾞﾝｺｳ"), "ギンコウ");
  assert.equal(normalizeText("  大阪　 ホテル  "), "大阪 ホテル");
});

test("電話番号の表記ゆれは同じキーに落ちる", () => {
  assert.equal(phoneKey("06-6942-2401"), "0669422401");
  assert.equal(phoneKey("０６（６９４２）２４０１"), "0669422401");
  assert.equal(phoneKey("+81-6-6942-2401"), "0669422401");
  assert.equal(phoneKey("090-1234"), null);
  assert.equal(normalizePhoneJp("09012345678"), "090-1234-5678");
  assert.equal(normalizePhoneJp("0120123456"), "0120-123-456");
});

test("URLの揺れ(www・末尾スラッシュ・utm)は同じキーに落ちる", () => {
  assert.equal(urlKey("https://www.example.co.jp/about/"), urlKey("http://example.co.jp/about?utm_source=x"));
  assert.equal(urlKey("mailto:a@b.jp"), null);
});

test("法人名: 法人格・中黒・全半角・大小の揺れを吸収する", () => {
  // ホテル案件の実要件: ソラーレ系の表記ゆれ
  assert.equal(corpKey("ソラーレ・ホテルズ・アンド・リゾーツ"), corpKey("(株)ソラーレホテルズアンドリゾーツ"));
  assert.equal(corpKey("株式会社オオサカキャッスル"), corpKey("オオサカキャッスル株式会社"));
  // カナ⇔英字は機械では同一にできない（同一にしないことが正しい）
  assert.notEqual(corpKey("ソラーレ・ホテルズ・アンド・リゾーツ"), corpKey("Solare Hotels and Resorts株式会社"));
});

test("住所を郵便番号/都道府県/市区町村/残りに分割する", () => {
  const a = splitAddressJp("〒540-0008 大阪府大阪市中央区大手前1-1-1");
  assert.equal(a.postal, "540-0008");
  assert.equal(a.prefecture, "大阪府");
  assert.equal(a.city, "大阪市中央区");
  assert.equal(a.rest, "大手前1-1-1");
  assert.equal(a.incomplete, false);
  const b = splitAddressJp("東京都西多摩郡瑞穂町箱根ケ崎100");
  assert.equal(b.city, "西多摩郡瑞穂町");
  const c = splitAddressJp("大手前1-1-1");
  assert.equal(c.incomplete, true);
  assert.equal(normalizePostal("５４０００００８".replace(/(\d{3})(\d{4})/, "$1$2")), null);
  assert.equal(normalizePostal("540-0008"), "540-0008");
});

// --- 抽出 -------------------------------------------------------------------

test("HTMLから電話・URL・社名・価格をまとめて抽出する", () => {
  const html = `<div>会社概要</div><p>株式会社オオサカキャッスル TEL: 06-6942-2401
    <a href="#">https://osaka-castle.co.jp/</a> 宿泊 1泊 9,800円〜 予算2万円 info@example.co.jp
    掲載日 2026年8月12日</p><script>var x=1;</script>`;
  const f = extractAll(html);
  assert.deepEqual(f.phones, ["06-6942-2401"]);
  assert.ok(f.corpNames.includes("株式会社オオサカキャッスル"));
  assert.ok(f.urls.some((u) => u.includes("osaka-castle")));
  assert.deepEqual(f.emails, ["info@example.co.jp"]);
  assert.ok(f.prices.some((p) => p.jpy === 9800));
  assert.ok(f.prices.some((p) => p.jpy === 20000), JSON.stringify(f.prices));
  assert.deepEqual(f.dates, ["2026-08-12"]);
});

test("前株・後株の両方を社名として拾う", () => {
  const names = extractCorpNames("運営は阪神住建株式会社。管理は株式会社市町村共済サービスです。");
  assert.ok(names.includes("阪神住建株式会社"));
  assert.ok(names.includes("株式会社市町村共済サービス"));
});

// --- 検証 -------------------------------------------------------------------

test("ダミー電話番号を検出する（実際に納品事故が起きたパターン）", () => {
  // ホテルコード心斎橋の公式サイトに実在した埋め草 06-0000-0000
  assert.equal(isDummyPhone("06-0000-0000"), true);
  assert.equal(isDummyPhone("03-1234-5678"), true);
  assert.equal(isDummyPhone("06-6942-2401"), false);
  assert.equal(isValidJpPhone("06-6942-2401"), true);
  assert.equal(isValidJpPhone("123-456"), false);
});

test("行の必須項目と形式をまとめて検査する", () => {
  const rules = {
    施設名: [{ kind: "required" }],
    電話: [{ kind: "required" }, { kind: "phone" }],
    HP: [{ kind: "url" }],
    価格: [{ kind: "priceBand", minJpy: 7000, maxJpy: 16000 }],
  };
  const good = checkRow({ 施設名: "大阪キャッスルホテル", 電話: "06-6942-2401", HP: "https://osaka-castle.co.jp/", 価格: "9600" }, rules);
  assert.equal(good.ok, true);
  const bad = checkRow({ 施設名: "", 電話: "06-0000-0000", HP: "ホームページなし", 価格: "20000" }, rules);
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.missing, ["施設名"]);
  assert.equal(bad.invalid.length, 3, JSON.stringify(bad.invalid));
});

// --- 照合 -------------------------------------------------------------------

test("2ソース一致で確定、食い違いはconflict、ダミーはsuspect", () => {
  const ok = reconcileField("phone", "06-6942-2401", [
    { label: "公式", values: ["06-6942-2401"] },
    { label: "楽天", values: ["06（6942）2401"] },
  ]);
  assert.equal(ok.confidence, "confirmed");

  const conflict = reconcileField("phone", "06-6942-9999", [
    { label: "公式", values: ["06-6942-2401"] },
  ]);
  assert.equal(conflict.confidence, "conflict");

  const dummy = reconcileField("phone", "06-0000-0000", [
    { label: "公式", values: ["06-0000-0000"] },
  ]);
  assert.equal(dummy.confidence, "suspect", "ソースと一致してもダミーは信用しない");

  const single = reconcileField("corp", "株式会社オオサカキャッスル", []);
  assert.equal(single.confidence, "single_source");
});

test("行の照合は最悪の確信度を採用し、まとめで人に回る件数が分かる", () => {
  const rows = [
    reconcileRow(
      { 電話: "06-6942-2401", 運営: "株式会社オオサカキャッスル" },
      { 電話: "phone", 運営: "corp" },
      { 電話: [{ label: "公式", values: ["06-6942-2401"] }], 運営: [{ label: "公式", values: ["(株)オオサカキャッスル"] }] }
    ),
    reconcileRow(
      { 電話: "06-0000-0000", 運営: "株式会社テスト" },
      { 電話: "phone", 運営: "corp" },
      { 電話: [], 運営: [] }
    ),
  ];
  assert.equal(rows[0].worst, "confirmed");
  assert.equal(rows[1].worst, "suspect");
  const s = summarizeReconcile(rows);
  assert.equal(s.autoOk, 1);
  assert.equal(s.needsHuman, 1);
});

// --- リスト操作 --------------------------------------------------------------

test("名寄せ: 表記ゆれの重複を畳み、除外ログを残す", () => {
  const rows = [
    { 社名: "株式会社オオサカキャッスル", 電話: "06-6942-2401" },
    { 社名: "オオサカキャッスル(株)", 電話: "" },
    { 社名: "株式会社阪神住建", 電話: "06-6243-7000" },
    { 社名: "", 電話: "" },
  ];
  const r = dedupeRows(rows, [{ column: "社名", kind: "corp" }, { column: "電話", kind: "phone" }]);
  assert.equal(r.kept.length, 3, "キーの作れない空行は残す");
  assert.equal(r.removed.length, 1);
  assert.equal(r.removed[0].duplicateOf, 0);
});

test("NGリスト除外: 表記ゆれで当て、英字名は人に回す", () => {
  const rows = [
    { 施設: "A", 運営: "ソラーレ・ホテルズ・アンド・リゾーツ" },
    { 施設: "B", 運営: "株式会社オオサカキャッスル" },
    { 施設: "C", 運営: "Solare Hotels and Resorts株式会社" },
  ];
  const r = excludeByNgList(rows, "運営", ["(株)ソラーレホテルズアンドリゾーツ", "アパホテル"]);
  assert.equal(r.excluded.length, 1);
  assert.equal(r.excluded[0].row.施設, "A");
  assert.equal(r.kept.length, 2);
  // 英字表記はカナNGリストと機械照合できないので review に上がる
  assert.equal(r.review.length, 1);
  assert.equal(r.review[0].row.施設, "C");
});

test("既存リストとの差分で重複納品を防ぐ（ホテル案件の「既存300件と重複しない」要件）", () => {
  const existing = [{ 施設名: "大阪キャッスルホテル", HP: "https://osaka-castle.co.jp/" }];
  const collected = [
    { 施設名: "大阪キャッスルホテル", HP: "https://www.osaka-castle.co.jp" },
    { 施設名: "ホテルコード心斎橋", HP: "https://www.hotelcode.jp/" },
  ];
  const r = diffAgainstExisting(collected, existing, [{ column: "HP", kind: "url" }]);
  assert.equal(r.fresh.length, 1);
  assert.equal(r.fresh[0].施設名, "ホテルコード心斎橋");
  assert.equal(r.alreadyListed.length, 1);
});

// --- 集計 -------------------------------------------------------------------

test("度数分布: 複数回答の分解と無回答の明示", () => {
  const rows = [{ 趣味: "読書、映画" }, { 趣味: "読書" }, { 趣味: "" }];
  const c = valueCounts(rows, "趣味", { splitMulti: /[、,]/ });
  assert.equal(c[0].value, "読書");
  assert.equal(c[0].count, 2);
  assert.ok(c.some((x) => x.value === "(無回答)"), "空欄を黙って落とさない");
});

test("クロス集計と数値要約", () => {
  const rows = [
    { 年代: "20代", 満足: "はい", 金額: "1,000円" },
    { 年代: "20代", 満足: "いいえ", 金額: "3000" },
    { 年代: "30代", 満足: "はい", 金額: "abc" },
  ];
  const ct = crossTab(rows, "年代", "満足");
  assert.equal(ct.cells[0][0], 1);
  assert.equal(ct.rowTotals[0], 2);
  assert.equal(ct.total, 3);
  const ns = numericSummary(rows, "金額");
  assert.equal(ns.count, 2);
  assert.equal(ns.invalid, 1, "数値にならないセルを黙って0にしない");
  assert.equal(ns.median, 2000);
});

// --- 差し込み ----------------------------------------------------------------

test("差し込み: 埋まらない穴は残して報告する（黙って納品しない）", () => {
  const t = "{{会社名}} 御中\n{{担当者}}様\nお見積り: {{金額}}円";
  const one = fillTemplate(t, { 会社名: "オオサカキャッスル", 金額: "45000" });
  assert.ok(one.text.includes("{{担当者}}"), "穴をそのまま残す");
  assert.deepEqual(one.missing, ["担当者"]);
  const m = mailMerge(t, [
    { 会社名: "A", 担当者: "山田", 金額: "1000", 備考: "急ぎ" },
    { 会社名: "B", 金額: "2000" },
  ]);
  assert.equal(m.complete, 1);
  assert.equal(m.incomplete, 1);
  assert.deepEqual(m.unusedColumns, ["備考"], "渡されたのに使っていない列も報告する");
});

// --- 表入出力 ----------------------------------------------------------------

test("CSVテキスト⇔行オブジェクトの往復", () => {
  const t = parseTable('社名,電話\n"株式会社A",06-1111-2222\nB社,');
  assert.deepEqual(t.headers, ["社名", "電話"]);
  assert.equal(t.rows[0].社名, "株式会社A");
  assert.equal(t.rows[1].電話, "");
  const csv = toCsvText(t.rows, t.headers);
  assert.ok(csv.startsWith("\uFEFF社名,電話"), "BOM付きでExcelでも文字化けしない");
});

// --- パターン台帳 ------------------------------------------------------------

test("実在した募集文がパターンに当たる", () => {
  const hotel = matchDataOpsPatterns("大阪府内ホテル情報収集・リスト作成担当者を募集します。1件200円で100件");
  assert.ok(hotel.some((m) => m.pattern.id === "store_list" || m.pattern.id === "company_list"), JSON.stringify(hotel.map((m) => m.pattern.id)));

  const rakuten = matchDataOpsPatterns("楽天新規出店の商品50アイテムの登録をお願いしたい。CSV形式にはなっていません。");
  assert.ok(rakuten.some((m) => m.pattern.id === "ec_product_entry"));

  const survey = matchDataOpsPatterns("アンケートの集計をお願いします。回答データをクロス集計してください");
  assert.ok(survey.some((m) => m.pattern.id === "survey_tabulation"));

  const none = matchDataOpsPatterns("和風ロックの作曲をお願いいたします");
  assert.equal(none.length, 0);
});

test("台帳の全パターンが必須情報を持つ", () => {
  assert.ok(DATAOPS_PATTERNS.length >= 20, `patterns=${DATAOPS_PATTERNS.length}`);
  const ids = new Set();
  for (const p of DATAOPS_PATTERNS) {
    assert.ok(p.id && p.name && p.marketExample && p.caution, p.id);
    assert.ok(p.ops.length > 0 && p.autoParts.length > 0 && p.humanParts.length > 0, p.id);
    assert.ok(!ids.has(p.id), `id重複: ${p.id}`);
    ids.add(p.id);
  }
});

// --- AI併用エンジンの検品（aiops-core）---------------------------------------
// ネットワークは触らない。プロンプト組み立てと「AIの答えを信用しない」検品を固定する。

import {
  chunk, estimateCalls,
  buildMatchPrompt, parseMatchResponse,
  buildClassifyPrompt, parseClassifyResponse,
  buildFieldExtractPrompt, parseFieldExtractResponse,
  buildRewritePrompt, parseRewriteResponse,
} from "../../dist-test/dataops/aiops-core.js";

test("バッチ分割とコスト見積り", () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.equal(estimateCalls(51, 25), 3);
  assert.equal(estimateCalls(0, 25), 0);
});

test("同一判定: 欠落・不正な応答は unsure=人へ に倒れる", () => {
  const pairs = [
    { a: "ソラーレ・ホテルズ", b: "Solare Hotels and Resorts" },
    { a: "アパホテル", b: "APA Hotel" },
    { a: "東横イン", b: "全然別の会社" },
  ];
  const prompt = buildMatchPrompt(pairs);
  assert.ok(prompt.includes("unsure"), "不確実なら unsure にせよ、が入っている");
  const parsed = parseMatchResponse(
    { items: [
      { index: 0, verdict: "same", reason: "カナ/英字表記" },
      { index: 2, verdict: "maybe", reason: "壊れた値" },
      { index: 99, verdict: "same", reason: "範囲外" },
    ] },
    pairs.length
  );
  assert.equal(parsed.length, 3, "応答が欠けても全ペア分返る");
  assert.equal(parsed[0].verdict, "same");
  assert.equal(parsed[0].needsHuman, false);
  assert.equal(parsed[1].verdict, "unsure", "応答が無いペアは人へ");
  assert.equal(parsed[2].verdict, "unsure", "不正な verdict は人へ");
  assert.ok(parsed.every((v) => v.verdict !== "same" || !v.needsHuman));
});

test("分類: 引用が回答本文に実在しなければ幻覚扱いで人へ", () => {
  const texts = ["配送が遅かったが品質は良い", "値段が高い"];
  const categories = ["品質", "価格", "配送"];
  assert.ok(buildClassifyPrompt(texts, categories).includes("分類不能"));
  const parsed = parseClassifyResponse(
    { items: [
      { index: 0, category: "配送", quote: "配送が遅かった" },
      { index: 1, category: "価格", quote: "配送料が高い" }, // 元テキストに無い引用
    ] },
    texts, categories
  );
  assert.equal(parsed[0].needsHuman, false);
  assert.equal(parsed[1].needsHuman, true, "実在しない引用は信用しない");
  const badCat = parseClassifyResponse({ items: [{ index: 0, category: "その他", quote: "品質" }] }, texts, categories);
  assert.equal(badCat[0].category, "分類不能", "一覧外のカテゴリは受け付けない");
  assert.equal(badCat[0].needsHuman, true);
});

test("項目抽出: AIの答えも決定的検証を再通過させる", () => {
  const text = "お問い合わせ: 06-0000-0000 / 公式 https://example.co.jp";
  const fields = [
    { name: "電話番号", kind: "phone" },
    { name: "HP", kind: "url" },
    { name: "FAX", kind: "phone" },
  ];
  assert.ok(buildFieldExtractPrompt(text, fields).includes("推測で補完しない"));
  const parsed = parseFieldExtractResponse(
    { fields: [
      { name: "電話番号", value: "06-0000-0000", quote: "06-0000-0000" },
      { name: "HP", value: "https://example.co.jp", quote: "https://example.co.jp" },
    ] },
    text, fields
  );
  assert.equal(parsed[0].needsHuman, true, "ダミー電話はAIが返しても弾く");
  assert.equal(parsed[1].needsHuman, false);
  assert.equal(parsed[2].needsHuman, true, "見つからない項目は空のまま人へ（勝手に埋めない）");
  assert.equal(parsed[2].value, "");
});

test("整文: 長さの激変は省略/水増しとして検知し、意味の確認は常に人", () => {
  const original = "えーと、本日はですね、あのー、次回の納期について話します。".repeat(10);
  assert.ok(buildRewritePrompt(original, "kebatori").includes("禁止"));
  const ok = parseRewriteResponse({ text: original.replace(/えーと、|あのー、/g, "") }, original, "kebatori");
  assert.equal(ok.needsHuman, true, "整文は必ず人が読む前提で返す");
  const tooShort = parseRewriteResponse({ text: "納期の話。" }, original, "kebatori");
  assert.ok(tooShort.reason.includes("省略か水増し"));
  const empty = parseRewriteResponse({}, original, "seibun");
  assert.equal(empty.reason, "応答が空");
});

// --- レビューで実証された抜け道の再発防止 -------------------------------------

import { normalizedIncludes } from "../../dist-test/dataops/aiops-core.js";

test("抽出の検品: 実在する引用に捏造した値を添えても通らない", () => {
  const text = "大阪本社の連絡先は 06-6942-2401 です。";
  const parsed = parseFieldExtractResponse(
    { fields: [
      { name: "運営会社", value: "株式会社デタラメ商事", quote: "大阪本社" }, // 値が本文に無い
      { name: "電話番号", value: "03-5555-1234", quote: "連絡先" }, // 形式は正しいが本文に無い番号
      { name: "本物", value: "06-6942-2401", quote: "06-6942-2401" },
    ] },
    text,
    [
      { name: "運営会社", kind: "text" },
      { name: "電話番号", kind: "phone" },
      { name: "本物", kind: "phone" },
    ]
  );
  assert.equal(parsed[0].needsHuman, true, "値そのものの実在確認が要る");
  assert.equal(parsed[1].needsHuman, true, "整形式でも本文に無い番号は通さない");
  assert.equal(parsed[2].needsHuman, false);
});

test("分類の検品: 改行をまたぐ正しい引用は落とさない（正規化照合）", () => {
  const texts = ["配送が遅い。\nそれと 梱包が雑だった"];
  const parsed = parseClassifyResponse(
    { items: [{ index: 0, category: "配送", quote: "遅い。 それと 梱包" }] },
    texts, ["品質", "配送"]
  );
  assert.equal(parsed[0].needsHuman, false, "プロンプトと同じ空白正規化で照合する");
  assert.ok(normalizedIncludes("Ａ　Ｂ\nＣ", "A B C"));
  assert.equal(normalizedIncludes("abc", ""), false);
});

test("抽出の検品: 元テキストがプロンプト上限を超えるときは未探索と明示する", () => {
  const longText = "前置き。".repeat(2000) + " TEL: 06-6942-2401";
  const parsed = parseFieldExtractResponse(
    { fields: [{ name: "電話番号", value: "", quote: "" }] },
    longText,
    [{ name: "電話番号", kind: "phone" }]
  );
  assert.equal(parsed[0].needsHuman, true);
  assert.ok(parsed[0].reason.includes("未探索"), parsed[0].reason);
});


// --- 価値レベル（「データ入力系」の線引きの定義）--------------------------------

test("全パターンに価値レベルがあり、受ける/受けないが定義から決まる", async () => {
  const { VALUE_LEVELS, MIN_LEVEL_TO_ACCEPT, levelVerdict } = await import("../../dist-test/dataops/registry.js");
  for (const lv of [0, 1, 2, 3, 4]) assert.ok(VALUE_LEVELS[lv].name && VALUE_LEVELS[lv].unitPrice, `L${lv}`);
  for (const p of DATAOPS_PATTERNS) assert.ok([0, 1, 2, 3, 4].includes(p.level), `${p.id} にレベルが無い`);
  // 転記(L0)は受けない、照合(L2)から受ける
  assert.equal(levelVerdict(0).accept, false);
  assert.equal(levelVerdict(MIN_LEVEL_TO_ACCEPT).accept, true);
  assert.match(levelVerdict(2).label, /照合/);
  // 市場で「データ入力」と呼ばれる名刺入力・レシート入力は L0 = 受けない側
  const byId = Object.fromEntries(DATAOPS_PATTERNS.map((p) => [p.id, p]));
  assert.equal(byId.business_card_entry.level, 0);
  assert.equal(byId.receipt_entry.level, 0);
  // ホテル型の店舗リストは照合が値段の理由 = L2
  assert.equal(byId.store_list.level, 2);
  assert.equal(byId.company_list.level, 2);
  // EC登録・集計・差し込みは仕様を知っている値段 = L3
  assert.equal(byId.ec_product_entry.level, 3);
  assert.equal(byId.survey_tabulation.level, 3);
});
