import type { AssetKind } from "./types";

/**
 * 生成テンプレート。
 *
 * 方針:
 * - AI が担当するのは「毎回書くのが面倒な定型文の初稿」まで。
 *   最終的な事実確認と送信は必ず人間が行う前提で設計している。
 * - APIキーが無い / 無料枠を使い切った場合でも、fallback() で
 *   穴埋め式の雛形が返るようにしてある。アプリが止まらないことを優先する。
 */

export type TemplateId =
  | "proposal"
  | "outreach_email"
  | "service_menu"
  | "profile"
  | "deliverable_draft"
  | "listing"
  | "interview_questions"
  | "sns_post";

export interface TemplateField {
  name: string;
  label: string;
  placeholder: string;
  type: "text" | "textarea" | "number";
  required: boolean;
  help?: string;
}

export interface TemplateDefinition {
  id: TemplateId;
  name: string;
  purpose: string;
  assetKind: AssetKind;
  /** 手作業でやった場合にかかる時間（分）。削減効果の表示に使う。 */
  manualMinutes: number;
  fields: TemplateField[];
  /** 生成前に必ず読ませる注意書き */
  caution?: string;
  buildPrompt: (values: Record<string, string>, count: number) => string;
  fallback: (values: Record<string, string>) => string;
}

const v = (values: Record<string, string>, key: string, fallback = "") =>
  (values[key] ?? "").trim() || fallback;

const OUTPUT_RULES = `
出力ルール:
- 日本語。ビジネス文書として自然な敬体。
- 誇張・断定的な成果保証を書かない（景品表示法・特定商取引法に触れるため）。
- 事実として確認できないこと（実績数値、資格、経歴）を勝手に創作しない。
  埋めるべき箇所は 【要確認: 何を書くか】 の形式で残す。
- AIが書いたと分かる定型句（「〜ではないでしょうか」「いかがでしょうか」の乱用、
  過剰な前置き、箇条書きの多用）を避ける。
- 記号での装飾（絵文字、★、■の乱用）をしない。
`;

export const TEMPLATES: TemplateDefinition[] = [
  {
    id: "proposal",
    name: "提案文（クラウドソーシング応募）",
    purpose:
      "ランサーズ・クラウドワークス・ココナラの募集に出す提案文。ここの通過率が受注数をそのまま決めるので、案件ごとに書き分けるべき箇所を自動で埋める。",
    assetKind: "proposal",
    manualMinutes: 25,
    fields: [
      { name: "jobText", label: "募集文（全文）", placeholder: "案件ページの本文をそのまま貼り付け", type: "textarea", required: true },
      { name: "myBackground", label: "自分の経歴・できること", placeholder: "例: 製造業で7年、品質管理。Excelでの集計と手順書作成が得意。", type: "textarea", required: true },
      { name: "portfolio", label: "見せられる実績（あれば）", placeholder: "例: 自作の作業手順書サンプル、GitHub、過去の納品物", type: "textarea", required: false },
      { name: "rateJpy", label: "希望単価（円）", placeholder: "例: 15000", type: "number", required: false, help: "空欄なら募集側の提示額に合わせた書き方になります" },
    ],
    buildPrompt: (values, count) => `あなたは日本のクラウドソーシングで高い提案通過率を出しているフリーランスです。
以下の募集に対する提案文を ${count} 案、それぞれ切り口を変えて書いてください。

${OUTPUT_RULES}
提案文の要件:
- 冒頭2行で「この募集を読んだ上で書いている」ことが伝わること。テンプレ感を出さない。
- 募集文に書かれている要件を、こちらの経歴のどれで満たせるかを対応させる。
- 相手が一番不安なこと（納期に間に合うか、途中で消えないか、指示が通じるか）を先回りして潰す。
- 質問がある場合は最後に1〜2個だけ。多いと読まれない。
- 長さは400〜600文字。長文は読まれない。
- 実績が無い場合は、無いことを隠さず「サンプルを先に作って提出する」など具体的な代替案で埋める。

案ごとに切り口を変えること:
1案目 = 要件充足を正面から示す型
2案目 = 相手の不安（品質・コミュニケーション）を潰す型
3案目 = 先にサンプル/たたき台を出して判断してもらう型

次のJSONで返してください:
{ "variants": [ { "angle": "この案の切り口", "subject": "件名（あれば）", "body": "提案文の本文" } ] }

=== 募集文 ===
${v(values, "jobText")}

=== 自分の経歴 ===
${v(values, "myBackground")}

=== 見せられる実績 ===
${v(values, "portfolio", "（なし）")}

=== 希望単価 ===
${v(values, "rateJpy", "（提示額に合わせる）")}`,
    fallback: (values) => `【提案文の雛形（AI未使用）】

${v(values, "jobText").slice(0, 40)}… の募集を拝見しました。

■ 募集要件に対して私が対応できること
・【要確認: 募集文の要件1】 → ${v(values, "myBackground", "【要確認: 対応できる経験】").slice(0, 60)}
・【要確認: 募集文の要件2】 → 【要確認: 対応できる経験】

■ 進め方
着手前に認識合わせとして【要確認: 確認したい点】を確認させてください。
その上で、初稿を【要確認: 日数】日でお出しし、修正は2回まで対応します。

■ 実績
${v(values, "portfolio", "【要確認: 提出できるサンプル。無ければ「本案件用にサンプルを先にお作りします」と書く】")}

■ 希望単価
${v(values, "rateJpy") ? `${v(values, "rateJpy")}円` : "【要確認: 提示額に合わせるか、根拠付きで提示する】"}

ご検討よろしくお願いいたします。`,
  },

  {
    id: "outreach_email",
    name: "営業メール（地元の事業者向け）",
    purpose:
      "近所の中小企業・個人商店に、AIを使った業務代行を直接売り込むためのメール。競合が少なく単価が高い代わりに、送る文面を毎回考えるのが面倒なので、そこを自動化する。",
    assetKind: "outreach_mail",
    manualMinutes: 30,
    caution:
      "同じ文面を大量送信しないでください。特定電子メール法により、広告宣伝メールには原則として事前同意、送信者の氏名・住所・連絡先の表示、受信拒否の方法の明示が必要です。1通ずつ相手を調べて個別に書く前提の道具です。",
    fields: [
      { name: "target", label: "相手の事業者", placeholder: "例: 市内の整体院。Googleマップの口コミ40件、ホームページなし", type: "textarea", required: true },
      { name: "observed", label: "実際に見て気づいたこと", placeholder: "例: 予約が電話のみ。営業時間の更新が止まっている。InstagramはあるがXは未運用。", type: "textarea", required: true, help: "ここが具体的なほど返信率が上がります。想像で書かないこと。" },
      { name: "offer", label: "提供できること", placeholder: "例: Googleビジネスプロフィールの整備と月2回の投稿代行", type: "textarea", required: true },
      { name: "priceJpy", label: "提示価格（円）", placeholder: "例: 月15000", type: "text", required: false },
    ],
    buildPrompt: (values, count) => `あなたは地域の中小事業者に業務支援を売っている個人事業主です。
以下の相手に送る初回の営業メールを ${count} 案書いてください。

${OUTPUT_RULES}
メールの要件:
- 件名は具体的に。「ご提案」「ご挨拶」だけの件名は開かれない。
- 冒頭で、実際にその事業者を見た上で書いていることを示す（観察した事実を1つ入れる）。
- 売り込む前に、相手にとっての具体的な不便を1つだけ指摘する。指摘は事実ベースに留め、批判にしない。
- 提供内容と価格を明示する。「まずはお話だけでも」で終わらせない。
- 最初の依頼のハードルを下げる（無料または低額の小さな1件から始める提案を入れる）。
- 300〜450文字。長いと読まれない。
- 末尾に送信者の氏名・連絡先を書く欄を 【要確認: 氏名】【要確認: 連絡先】 として残す。

案ごとに切り口を変えること:
1案目 = 気づいた不便を起点にする型
2案目 = 小さな無料サンプルを先に渡す型
3案目 = 同業他社の動きを引き合いに出す型（事実として確認できない比較は書かない）

次のJSONで返してください:
{ "variants": [ { "angle": "切り口", "subject": "件名", "body": "本文" } ] }

=== 相手 ===
${v(values, "target")}

=== 観察した事実 ===
${v(values, "observed")}

=== 提供できること ===
${v(values, "offer")}

=== 価格 ===
${v(values, "priceJpy", "（要検討）")}`,
    fallback: (values) => `件名: 【要確認: 具体的な件名】の件（${v(values, "target", "貴社").slice(0, 20)}様）

突然のご連絡失礼いたします。【要確認: 氏名】と申します。

先日、${v(values, "target", "【要確認: 相手】").slice(0, 40)} を拝見し、${v(values, "observed", "【要確認: 気づいた事実】").slice(0, 80)} が気になりご連絡しました。

私は ${v(values, "offer", "【要確認: 提供内容】")} をお手伝いしています。
${v(values, "priceJpy") ? `費用は ${v(values, "priceJpy")} を想定しています。` : "費用は【要確認: 金額】を想定しています。"}

いきなりご契約いただく必要はありません。まずは【要確認: 小さな無料サンプル】を1件お作りしますので、使えそうかどうかだけご判断ください。

【要確認: 氏名】
【要確認: 連絡先（メール・電話）】
【要確認: 住所】`,
  },

  {
    id: "service_menu",
    name: "サービス出品文（ココナラ等）",
    purpose: "自分のサービスを商品として並べるための出品文と料金プラン。1回作れば使い回せる資産になる。",
    assetKind: "listing",
    manualMinutes: 60,
    fields: [
      { name: "skill", label: "売るスキル", placeholder: "例: 製造現場向けの作業手順書作成", type: "textarea", required: true },
      { name: "background", label: "その根拠になる経験", placeholder: "例: 品質管理7年、手順書を200件以上作成", type: "textarea", required: true },
      { name: "targetCustomer", label: "想定する買い手", placeholder: "例: 手順書の整備が追いついていない小規模の製造業", type: "text", required: false },
    ],
    buildPrompt: (values, count) => `あなたはスキルマーケットで安定して売れている出品者です。
以下のスキルの出品ページ本文を ${count} 案書いてください。

${OUTPUT_RULES}
要件:
- タイトルは30文字前後。検索されるキーワードを含め、「誰の」「何を」「どうするか」を入れる。
- 本文は「こんな方向け」「提供内容」「進め方」「納期」「お願い」の構成。
- 料金は松竹梅の3プラン。安い順に並べ、真ん中が選ばれるように設計する。
  金額は根拠を書ける範囲で提案し、断定せず【要確認】を付ける。
- 対応できないこと・範囲外を明記する。ここを書くとクレームが減る。
- 実績は与えられた情報の範囲でのみ書く。創作しない。

次のJSONで返してください:
{ "variants": [ { "angle": "切り口", "subject": "出品タイトル", "body": "出品本文（料金プラン含む）" } ] }

=== 売るスキル ===
${v(values, "skill")}

=== 経験 ===
${v(values, "background")}

=== 想定する買い手 ===
${v(values, "targetCustomer", "（未定）")}`,
    fallback: (values) => `【出品タイトル】
${v(values, "skill", "【要確認: スキル】").slice(0, 30)}

【こんな方向け】
・${v(values, "targetCustomer", "【要確認: 想定する買い手】")}
・【要確認: 買い手が抱えている困りごと】

【提供内容】
${v(values, "skill", "【要確認】")}

【私について】
${v(values, "background", "【要確認: 経験】")}

【料金プラン】
・ライト 【要確認: 金額】円 … 【要確認: 範囲】
・スタンダード 【要確認: 金額】円 … 【要確認: 範囲】
・プレミアム 【要確認: 金額】円 … 【要確認: 範囲】

【進め方】
1. ヒアリング（【要確認】分）
2. 初稿の提出（【要確認】日）
3. 修正（2回まで）

【対応できないこと】
・【要確認: 範囲外の作業】`,
  },

  {
    id: "profile",
    name: "プロフィール文",
    purpose:
      "クラウドソーシングのプロフィールは、提案文より先に読まれる。ここが空欄だと提案が通らない。1回書けば全案件に効く。",
    assetKind: "profile",
    manualMinutes: 45,
    fields: [
      { name: "career", label: "職歴・経験", placeholder: "例: 製造業7年（品質管理3年、組立4年）", type: "textarea", required: true },
      { name: "canDo", label: "受けられる仕事", placeholder: "例: 手順書作成、Excel集計、文字起こし", type: "textarea", required: true },
      { name: "availability", label: "稼働できる時間帯", placeholder: "例: 平日20-23時、土日終日。返信は12時間以内。", type: "text", required: true },
    ],
    buildPrompt: (values, count) => `あなたはクラウドソーシングで受注が安定しているフリーランスです。
以下の情報でプロフィール文を ${count} 案書いてください。

${OUTPUT_RULES}
要件:
- 冒頭3行で「何ができる人か」が分かること。
- 発注者が一番知りたいのは、スキルよりも「連絡が取れるか」「納期を守るか」。稼働時間と返信速度を必ず明記する。
- 実務経験を、発注者側のメリットに翻訳する（例: 品質管理7年 → 仕様の抜け漏れを事前に指摘できる）。
- 未経験分野を「勉強中です」と書かない。書くなら「対応可能な範囲」を具体化する。
- 500〜700文字。

次のJSONで返してください:
{ "variants": [ { "angle": "切り口", "subject": "キャッチコピー1行", "body": "プロフィール本文" } ] }

=== 職歴 ===
${v(values, "career")}

=== 受けられる仕事 ===
${v(values, "canDo")}

=== 稼働時間 ===
${v(values, "availability")}`,
    fallback: (values) => `【キャッチコピー】
${v(values, "career", "【要確認】").slice(0, 30)} の実務経験を活かして、${v(values, "canDo", "【要確認】").slice(0, 30)} をお手伝いします。

【経歴】
${v(values, "career", "【要確認: 職歴】")}

【対応できる業務】
${v(values, "canDo", "【要確認: 受けられる仕事】")}

【稼働時間・連絡について】
${v(values, "availability", "【要確認: 稼働時間帯】")}
ご連絡には【要確認: 時間】以内に返信します。

【お仕事を進めるうえで大事にしていること】
・着手前に認識合わせを必ず行います
・納期に遅れそうな場合は、遅れる前にご連絡します`,
  },

  {
    id: "deliverable_draft",
    name: "納品物の初稿",
    purpose:
      "受注した後の実作業。ここが一番時間を食う。初稿をAIに出させて、人間は事実確認と手直しに集中する。",
    assetKind: "article",
    manualMinutes: 120,
    caution:
      "納品先によっては生成AIの使用に制限があります。発注者の指示を必ず確認してください。また、出力をそのまま納品せず、事実確認と自分の言葉での書き直しを必ず行ってください。",
    fields: [
      { name: "deliverableType", label: "成果物の種類", placeholder: "例: 商品紹介記事 / 議事録 / マニュアル / メルマガ", type: "text", required: true },
      { name: "requirements", label: "発注内容・要件", placeholder: "文字数、トーン、構成、含めるキーワード、NG表現などをそのまま貼り付け", type: "textarea", required: true },
      { name: "material", label: "素材・元情報", placeholder: "支給された資料、取材メモ、箇条書きなど", type: "textarea", required: false },
    ],
    buildPrompt: (values, count) => `あなたは受注案件の初稿を作るライターです。
以下の要件で ${v(values, "deliverableType")} の初稿を ${count} 案作ってください。

${OUTPUT_RULES}
追加ルール:
- 発注要件に書かれた文字数・構成・トーンを厳守する。
- 素材に無い事実（数値、固有名詞、日付、効能）を創作しない。必要な箇所は 【要確認: 何を調べるか】 で残す。
- 医薬品・健康食品・化粧品に関する表現は薬機法に触れる可能性があるため、効果を断定しない。
- 冒頭に「この初稿で人間が必ず確認すべき点」を3つ、チェックリストとして付ける。

次のJSONで返してください:
{ "variants": [ { "angle": "切り口", "subject": "タイトル", "body": "本文（先頭に確認チェックリスト）" } ] }

=== 成果物の種類 ===
${v(values, "deliverableType")}

=== 発注要件 ===
${v(values, "requirements")}

=== 素材 ===
${v(values, "material", "（支給なし）")}`,
    fallback: (values) => `【納品前に必ず確認すること】
1. 【要確認: 発注要件の文字数を満たしているか】
2. 【要確認: 事実・数値の出典を確認したか】
3. 【要確認: NG表現・薬機法に触れる表現がないか】

---

# ${v(values, "deliverableType", "【要確認: タイトル】")}

## 導入
【要確認: 読者が抱えている問題】

## 本文
${v(values, "material", "【要確認: 素材から本文を構成する】")}

## まとめ
【要確認: 発注要件で求められている結論】

---
（AI未使用の雛形です。APIキーを設定すると初稿が自動生成されます）`,
  },

  {
    id: "listing",
    name: "フリマ出品文",
    purpose: "不用品販売は、元手ゼロで最短に現金化できる手段。出品文と価格設定を毎回考えるのが面倒なので自動化する。",
    assetKind: "listing",
    manualMinutes: 15,
    fields: [
      { name: "item", label: "商品", placeholder: "例: SONY WH-1000XM4 ヘッドホン ブラック 2021年購入", type: "textarea", required: true },
      { name: "condition", label: "状態（正直に）", placeholder: "例: 右側のイヤーパッドに擦れ。動作は問題なし。箱・ケーブルあり。", type: "textarea", required: true, help: "状態を盛るとトラブルと返品になり、結局損をします" },
      { name: "marketPrice", label: "相場（調べた結果）", placeholder: "例: 同状態の売却済みが12000〜15000円", type: "text", required: false },
    ],
    buildPrompt: (values, count) => `あなたはフリマアプリで回転率高く売っている出品者です。
以下の商品の出品文を ${count} 案書いてください。

${OUTPUT_RULES}
要件:
- 商品名は「ブランド + 型番 + 特徴 + 状態」を40文字以内に。検索でヒットする語を必ず入れる。
- 本文は「商品の概要」「状態（マイナス点を先に）」「付属品」「発送」の順。
- マイナス点を隠さない。隠すと評価が下がり、次が売れなくなる。
- 価格は相場情報がある場合のみ提案し、根拠を添える。無い場合は【要確認: 売却済み一覧で相場を確認】と書く。
- 値下げ交渉の想定ラインも添える。

次のJSONで返してください:
{ "variants": [ { "angle": "切り口", "subject": "商品名", "body": "出品本文（末尾に価格提案）" } ] }

=== 商品 ===
${v(values, "item")}

=== 状態 ===
${v(values, "condition")}

=== 相場 ===
${v(values, "marketPrice", "（未調査）")}`,
    fallback: (values) => `【商品名】
${v(values, "item", "【要確認】").slice(0, 40)}

【商品説明】
${v(values, "item", "【要確認: 商品概要】")}

【状態】
${v(values, "condition", "【要確認: 状態を正直に】")}

【付属品】
【要確認: 箱・ケーブル・保証書の有無】

【発送】
【要確認: 発送方法】／ご購入から【要確認】日以内に発送します

【価格】
${v(values, "marketPrice") ? `相場: ${v(values, "marketPrice")}` : "【要確認: フリマアプリで「売却済み」に絞って相場を確認】"}`,
  },

  {
    id: "interview_questions",
    name: "着手前の確認質問リスト",
    purpose:
      "「安く受けてしまった」「無限に修正させられた」の大半は、着手前に確認しなかったことが原因。案件ごとに聞くべきことを自動で洗い出す。",
    assetKind: "other",
    manualMinutes: 20,
    fields: [
      { name: "jobText", label: "案件の内容", placeholder: "募集文や打ち合わせメモを貼り付け", type: "textarea", required: true },
    ],
    buildPrompt: (values, count) => `あなたは受注トラブルを避けることに長けたフリーランスです。
以下の案件について、着手前に必ず確認すべきことを整理してください。（${count} 通りは不要。1つの決定版を作ってください）

${OUTPUT_RULES}
出力の構成:
1. 「これを確認しないと赤字になる」項目（報酬、修正回数、検収条件、追加作業の扱い、支払日、支払方法）
2. 「これを確認しないと作り直しになる」項目（成果物の形式、想定読者/利用者、参考例、NG）
3. 募集文から読み取れる地雷（見積もりが甘くなりそうな箇所、範囲が曖昧な箇所）を具体的に指摘
4. そのまま相手に送れる質問文（5問以内。多いと嫌がられる）

次のJSONで返してください:
{ "variants": [ { "angle": "確認事項", "subject": "案件名", "body": "上記1〜4を含む本文" } ] }

=== 案件 ===
${v(values, "jobText")}`,
    fallback: () => `【赤字を防ぐために確認すること】
1. 報酬は税込か税抜か、源泉徴収の有無
2. 修正は何回まで無料か
3. 検収の基準と、検収にかかる日数
4. 範囲外の作業が発生した場合の追加料金
5. 支払日と支払方法（プラットフォームの仮払いを通すか）

【作り直しを防ぐために確認すること】
6. 成果物のファイル形式と納品方法
7. 想定している読者・利用者
8. 参考にしてほしい例、避けてほしい例

【そのまま送れる質問文】
着手前に4点だけ確認させてください。
1. 修正のご対応は何回までを想定されていますか。
2. 検収の基準と、お戻しの目安日数を教えてください。
3. 【要確認: この案件固有の曖昧な点】について、どちらの想定でしょうか。
4. お支払いはプラットフォームの仮払いを通す形で問題ないでしょうか。`,
  },

  {
    id: "sns_post",
    name: "集客用SNS投稿",
    purpose: "受注を待つのではなく、こちらから見つけてもらうための投稿。営業の母数を増やす。",
    assetKind: "thread",
    manualMinutes: 20,
    caution:
      "案件募集の投稿には、こちらを狙った詐欺DMが必ず来ます。届いたDMは必ず「詐欺チェック」に通してください。",
    fields: [
      { name: "offer", label: "受けられる仕事", placeholder: "例: 製造業向けの作業手順書作成", type: "textarea", required: true },
      { name: "proof", label: "信用の裏付け", placeholder: "例: 品質管理7年、手順書200件", type: "textarea", required: false },
      { name: "platform", label: "投稿先", placeholder: "例: X / Instagram / Facebook地域グループ", type: "text", required: false },
    ],
    buildPrompt: (values, count) => `あなたは個人で仕事を受注しているフリーランスです。
${v(values, "platform", "X")} 向けの集客投稿を ${count} 案書いてください。

${OUTPUT_RULES}
要件:
- 「仕事ください」ではなく、相手の困りごとを起点にする。
- 具体的な成果物と価格帯を出す。曖昧な募集には問い合わせが来ない。
- 1投稿140〜200文字程度（プラットフォームに合わせる）。
- ハッシュタグは3個まで。
- 誇大な収益実績を書かない。

次のJSONで返してください:
{ "variants": [ { "angle": "切り口", "subject": "投稿の狙い", "body": "投稿本文" } ] }

=== 受けられる仕事 ===
${v(values, "offer")}

=== 信用の裏付け ===
${v(values, "proof", "（なし）")}`,
    fallback: (values) => `${v(values, "offer", "【要確認: 受けられる仕事】")} を承っています。

【要確認: 想定する相手の困りごと】でお困りの方向けです。

・対応内容: ${v(values, "offer", "【要確認】")}
・納期: 【要確認】日
・料金: 【要確認】円〜

${v(values, "proof") ? `（${v(values, "proof")}）` : "【要確認: 信用の裏付けになる経験】"}

DMでご相談ください。

#【要確認: タグ】`,
  },
];

export const getTemplate = (id: string): TemplateDefinition | undefined =>
  TEMPLATES.find((t) => t.id === id);
