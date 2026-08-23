import { readProfile } from "../db";
import { PLATFORM_FEES } from "../payout";
import { insertDiscovery, logEvent, pushInbox, readAgentConfig, readDiscoveryKeys } from "./db";
import {
  CHANNEL_LABELS,
  CHANNEL_NOTES,
  parseFindings,
  reconcileDiscovery,
  type Discovery,
} from "./discovery-core";

export * from "./discovery-core";

/**
 * 探索層。
 *
 * なぜ必要か:
 * ここまでのパイプラインは「来た案件を裁く」ことしかできない。入口は
 * 貼り付け・RSS・サイトマップの3つで、どれも「募集として公開されているもの」しか
 * 拾えない。ところが市場調査の結果、実効時給が高い仕事ほど募集として出てこない
 * ことが分かった。SDS作成・化学物質リスクアセスメント・ISO文書整備は、
 * ココナラの公開依頼1,751件に1件も出てこない。出品して待つか、直接当たるかの
 * 市場だからである。
 *
 * つまり、募集を待つ設計のままでは、一番良い仕事は原理的に見えない。
 * ここは「募集が存在しない市場を探しに行く」ための層で、実行するのは
 * ルールでも無料枠のAIでもなく、Webを見に行ける上位モデル。
 *
 * この層は案件を作らない。見つけた「市場」を記録するだけで、
 * 応募・出品・営業メールの送信は一切自動化しない（規約違反になるうえ、
 * 送る前に人が読むべき内容だから）。
 */

// ---------------------------------------------------------------------------
// 指示書
// ---------------------------------------------------------------------------

/**
 * 上位モデルに渡す探索の指示書。
 *
 * ここに書いてあることは、ほぼ全部が実地調査で分かったこと。
 * 「一般論としてAI副業を調べて」と投げると必ず情報商材の焼き直しが返ってくるので、
 * 何を見るな・何を見ろ・何を根拠として認めるかまで指定している。
 */
export function buildDiscoveryBrief(options: { avoidKeys?: string[]; want?: number } = {}): string {
  const profile = readProfile();
  const config = readAgentConfig();
  const want = options.want ?? 6;
  const minHourly = config.learned.minHourlyJpy;
  const avoid = options.avoidKeys ?? [];

  return `# 仕事の市場を探してください

あなたはWebを見に行けます。日本の受託・副業市場を実際に見て、
下の条件を満たす「仕事の市場」を ${want} 件見つけてください。
案件1件ではなく、**繰り返し受けられる市場**を探してください。

## 探す人の条件

- 経歴: ${profile?.background || "（未入力）"}
- 使える時間: 週 ${profile?.weeklyHours ?? 10} 時間
- 目標: 月 ${(profile?.goalJpy ?? 0).toLocaleString()} 円
- 元手: ${(profile?.budgetJpy ?? 0).toLocaleString()} 円（ほぼ無い前提で。有料ツール前提の案は不可）
- 実績: ゼロから。ポートフォリオも評価もまだ無い。

## この探索が必要な理由（読んでから探してください）

このアプリは案件を「待つ」ことはできます。貼り付け・RSS・サイトマップの3経路が
すでに動いています。それでも足りないのは、**実効時給が高い仕事ほど募集として
公開されないから**です。実測で、ココナラの公開依頼1,751件のうち、
SDS作成・化学物質リスクアセスメント・ISO文書整備は**1件もありませんでした**。
出品して待つか、直接当たるかの市場だからです。

だからあなたに探してほしいのは、募集一覧に出ているものではありません。

## 選別の基準（これで落としてください）

1. **AIで丸ごと置き換えられる仕事は落としてください。**
   実測で、AIによる時間短縮率と実効時給は**逆相関**していました。
   例: GAS自動化の募集は応募者中央値31人（最大147人）。一方、SDS関連は
   全国で競合4〜5件。速くできる仕事ほど人が殺到して単価が壊れます。
   「AIで9割自動化できます」と言える仕事は、その時点で価格競争に入っています。

2. **工程レベルでの短縮率で見てください。**
   生成そのものが速くても、検証工程はむしろ増えます（実測: SDS作成は
   60分→90分、翻訳は後編集が0分→220分に増加）。全体の短縮率の中央値は
   約50%であって、9割ではありません。「生成が速い」を根拠にしないでください。

3. **手数料を引いた実効時給が ${minHourly.toLocaleString()}円 を下回る市場は落としてください。**
   総額ではなく、1件あたりに割り戻してから工数で割ってください。
   「1件50円 × 100件」のような書き方に騙されないこと。

4. **資格の壁があるものは落としてください。**
   税理士・行政書士・司法書士・社会保険労務士・宅建士・弁護士の業務独占。
   特に**補助金申請書類の有償作成代行は行政書士法違反**（1年以下の拘禁刑または
   100万円以下の罰金）なので、絶対に候補に入れないでください。

5. **規約違反を前提にする手口は落としてください。**
   応募の自動化、出品の自動化、他人のチャンネル/コンテンツの複製、
   スクレイピングが禁止されているサイトからの自動取得。
   実行するとアカウントが消えるので、稼げる稼げない以前の問題です。

## 探す場所（募集一覧以外を見てください）

- **制度変更で新しく発生した需要。** 法改正・規制強化の施行日と、それによって
  義務が生じる事業者の数を一次情報（官公庁のページ）で確認してください。
  例として、2026年4月の化学物質規制の対象拡大（674物質→約2,300〜2,900物質）が
  あります。これは資格不要で、厚労省が無料ツールを出しています。
  同種の「制度が需要を作った」ものが他にもあるはずです。
- **業界団体・組合のサイト。** 会員企業向けの求人・外注募集が載ることがあります。
- **企業が自社サイトで直接出している募集。** 仲介手数料が無いぶん単価が高い。
- **出品型プラットフォームで、需要はあるのに出品が薄いカテゴリ。**
  出品数と、そのカテゴリの購入実績（レビュー数）の両方を見てください。
- **在庫型（作って置く）。** 時間と収入を切り離せる唯一の形なので、
  1件は在庫型を入れてください。ただし「置けば売れる」という前提では書かないこと。
  実際に売れている個人の出品を見て、何がどれだけ売れているかを根拠にしてください。

## 根拠として認めるもの

- 実際に開いたページのURLと、そこに書いてあった数字。
- 官公庁・業界団体の一次情報。

## 根拠として認めないもの

- 「AI副業で月30万」系の記事・動画・note。実測で、この種の発信者は
  20件中17件が「無料動画 → LINE登録 → セミナー → 高額講座」の構造で、
  収益源は語っている副業ではなく**その手口を売ること**でした。
  実績の数字は検証手段がありません。参考にしないでください。
  ただし、**工程が最後まで公開されていて、自分で検証できるもの**は別です。
  その場合も「本人がそう言っている」ではなく、実際の出品ページや販売実績を見て
  確認してから書いてください。
- あなた自身の推測。市場規模の概算や「〜と思われる」は根拠になりません。
  分からないものは confidence を "low" にして、そう書いてください。

${
  avoid.length
    ? `## すでに調べたもの（重複させないでください）\n\n${avoid.map((k) => `- ${k}`).join("\n")}\n`
    : ""
}
## 出力

次の形の JSON **だけ** を返してください。前後に説明を書かないでください。
数値は数値型で返してください（"3万円" のような文字列は不可）。

\`\`\`json
{
  "findings": [
    {
      "key": "重複判定用。URLがあればURL、無ければ市場を表す短い文字列。",
      "channel": "apply" | "listing" | "direct" | "stock",
      "title": "何の仕事か。1行。",
      "url": "根拠として実際に開いたページ。無ければ空文字。",
      "evidence": "そのページに何が書いてあったか。数字を含めて具体的に。",
      "demandSignal": "需要がある根拠。件数・施行日・対象事業者数など。",
      "supplySignal": "競合がどれだけいるか。出品数・応募者数など。",
      "priceJpy": { "low": 数値, "high": 数値 },
      "priceUnit": "上の金額が何に対する額か。例: 1物質あたり / 1式 / 月額",
      "estimatedHours": { "low": 数値, "high": 数値 },
      "platformId": ${PLATFORM_FEES.map((p) => `"${p.id}"`).join(" | ")} | "direct",
      "whyAiCannotKill": "AIで丸ごと置き換えられない理由。工程のどこが残るか。",
      "qualificationBarrier": "資格・許認可の壁。無ければ「なし」。",
      "timeToFirstYen": "最初の1円までの目安。",
      "firstStep": "明日やる1手。具体的に。",
      "confidence": "high" | "medium" | "low"
    }
  ]
}
\`\`\`

条件を満たすものが ${want} 件見つからなければ、見つかった数だけ返してください。
数を揃えるために基準を緩めないでください。0件なら空配列を返して構いません。
`;
}


// ---------------------------------------------------------------------------
// 取り込み
// ---------------------------------------------------------------------------

export interface ApplyResult {
  received: number;
  saved: number;
  duplicates: number;
  belowBar: number;
  discoveries: Discovery[];
}

/**
 * 探索の結果を取り込む。
 *
 * 基準を割ったものも捨てずに保存する。「調べたが割に合わなかった」という事実が
 * 残っていないと、次の探索で同じ市場をまた調べてしまうため。
 */
export function applyFindings(runId: string, raw: unknown): ApplyResult {
  const config = readAgentConfig();
  const minHourly = config.learned.minHourlyJpy;
  const findings = parseFindings(raw);

  const result: ApplyResult = {
    received: findings.length,
    saved: 0,
    duplicates: 0,
    belowBar: 0,
    discoveries: [],
  };

  for (const finding of findings) {
    const checked = reconcileDiscovery(finding, minHourly);
    if (!checked.meetsBar) result.belowBar++;

    const { discovery, created } = insertDiscovery({
      ...finding,
      runId,
      hourlyJpy: checked.hourlyJpy,
      meetsBar: checked.meetsBar,
      note: checked.note,
    });

    if (created) {
      result.saved++;
      result.discoveries.push(discovery);
    } else {
      result.duplicates++;
    }
  }

  const passed = result.discoveries.filter((d) => d.meetsBar);
  logEvent(runId, "ingest", "action", `探索: ${result.received}件のうち ${result.saved}件を新規に記録（基準を満たすもの ${passed.length}件）`, {
    received: result.received,
    saved: result.saved,
    duplicates: result.duplicates,
    belowBar: result.belowBar,
  });

  if (passed.length > 0) {
    pushInbox({
      runId,
      kind: "report",
      priority: 70,
      title: `新しい仕事の市場を ${passed.length}件 見つけました`,
      body: renderReport(passed, minHourly),
      actionUrl: "/hustle/discovery",
      leadId: null,
      meta: { kind: "discovery", count: passed.length },
    });
  }

  return result;
}

/** 承認キューに出す、人が読むための要約。 */
export function renderReport(discoveries: Discovery[], minHourlyJpy: number): string {
  const lines = discoveries.map((d, i) => {
    const hourly = d.hourlyJpy
      ? `実効時給 ${d.hourlyJpy.low.toLocaleString()}〜${d.hourlyJpy.high.toLocaleString()}円`
      : "実効時給は計算できていません";
    return [
      `## ${i + 1}. ${d.title}`,
      "",
      `- 形: ${CHANNEL_LABELS[d.channel]}（${CHANNEL_NOTES[d.channel]}）`,
      `- ${hourly}（相場 ${d.priceJpy.low.toLocaleString()}〜${d.priceJpy.high.toLocaleString()}円 / ${d.priceUnit || "単位不明"}、想定 ${d.estimatedHours.low}〜${d.estimatedHours.high}時間）`,
      `- 需要: ${d.demandSignal || "（根拠なし）"}`,
      `- 競合: ${d.supplySignal || "（根拠なし）"}`,
      `- AIに潰されない理由: ${d.whyAiCannotKill || "（説明なし）"}`,
      `- 資格の壁: ${d.qualificationBarrier}`,
      `- 最初の1円まで: ${d.timeToFirstYen || "不明"}`,
      `- 明日やる1手: ${d.firstStep || "（未記入）"}`,
      ...(d.url ? [`- 根拠: ${d.url}`] : []),
      ...(d.confidence !== "high"
        ? [`- 確信度: ${d.confidence}。裏を取ってから動いてください。`]
        : []),
      "",
    ].join("\n");
  });

  return [
    `実効時給の基準 ${minHourlyJpy.toLocaleString()}円 を満たした市場です。`,
    "どれも「募集を待つ」だけでは出てこない仕事です。動くかどうかはあなたが決めてください。",
    "",
    ...lines,
  ].join("\n");
}

/** 直近で調べた市場を除いた指示書を組む。 */
export function buildNextBrief(want = 6): string {
  return buildDiscoveryBrief({ want, avoidKeys: readDiscoveryKeys(60) });
}
