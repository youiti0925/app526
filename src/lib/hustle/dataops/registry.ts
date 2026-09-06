/**
 * パターン台帳 — 市場に繰り返し出る「データ入力・書類作成」案件の型と、
 * それぞれをどのエンジンの組み合わせで受けるかのカタログ。
 *
 * marketExample は実際に観測した募集（ココナラ実データ220件・2026-08）から。
 * 案件が来たら matchDataOpsPatterns() に募集文を渡すと、該当パターンと
 * 「どこまで自動でどこから人か」が即答できる。
 */

/**
 * 価値レベル — 「データ入力系」の仕事をどこで線引きするかの定義。
 *
 * ジャンル名（データ入力・リスト作成・照合・事務代行）は市場で混用されていて境界が無い。
 * そこで「発注者が何にお金を払っているか」で5段階に切る。手を動かす中身は
 * どれも事務作業で近いが、単価が付く理由が違う。この番号が全部の判断の物差し。
 */
export type ValueLevel = 0 | 1 | 2 | 3 | 4;

export interface ValueLevelDef {
  name: string;
  /** その仕事は要するに何か */
  gist: string;
  /** 発注者が払っているもの */
  paidFor: string;
  /** 市場の単価帯（2026-09 調査） */
  unitPrice: string;
  /** 誰がやるか */
  who: string;
}

export const VALUE_LEVELS: Record<ValueLevel, ValueLevelDef> = {
  0: {
    name: "転記",
    gist: "渡されたAを、決められたBの形に写す",
    paidFor: "速さだけ。誰でもAIでもできるので値段が付かない",
    unitPrice: "1件1〜50円（時給換算100〜500円）",
    who: "機械100%。ただし単価が無いので受けない",
  },
  1: {
    name: "収集",
    gist: "Aがどこにあるか探して集める（公式サイト・掲載ページ）",
    paidFor: "探す手間",
    unitPrice: "1件10〜100円",
    who: "機械。収集元の規約（robots・利用規約）が壁になる",
  },
  2: {
    name: "照合",
    gist: "集めた値が正しいと、別ソースで裏取りして保証する",
    paidFor: "正確さの保証。納品後の『電話が通じない』を引き受けること",
    unitPrice: "1件100〜300円",
    who: "機械が確定、人は要確認行だけ。ここから受ける",
  },
  3: {
    name: "整形・変換",
    gist: "決まった仕様の形に組み替える（モールCSV、縦書き、Word書式、集計表）",
    paidFor: "仕様を知っていること",
    unitPrice: "1件数千〜3万円",
    who: "機械（仕様を一度コード化すれば毎回同じ）",
  },
  4: {
    name: "判断",
    gist: "どれを選ぶか・良し悪しを決める（OEM先選定、リスク評価、分類の最終判断）",
    paidFor: "専門知識と責任",
    unitPrice: "見積り（数万円〜）",
    who: "人。あなたの製造業知識が売り物になる領域＝出品レーン",
  },
};

/** 受ける下限。これ未満は自動化しても単価が無く、929人と競う市場になる。 */
export const MIN_LEVEL_TO_ACCEPT: ValueLevel = 2;

export type OpId =
  | "extract" // テキストから電話/URL/社名/価格等を抽出
  | "normalize" // 幅・電話・URL・法人名・住所の正規化
  | "validate" // 形式検査・ダミー検出・必須項目チェック
  | "crosscheck" // 複数ソース照合・確信度の申告
  | "dedupe" // 名寄せ・重複統合
  | "ng_filter" // NGリスト除外（表記ゆれ吸収）
  | "diff" // 既存リストとの差分
  | "tabulate" // 度数・クロス集計・数値要約
  | "mail_merge" // テンプレート差し込み
  | "csv_clean"; // CSV整形（既存 csv-cleaner）

export interface DataOpsPattern {
  id: string;
  name: string;
  /** どういう依頼文で来るか */
  looksLike: string;
  /** 実際に観測した募集（出典つきの実在例） */
  marketExample: string;
  keywords: RegExp;
  ops: OpId[];
  /** 機械で完結する工程 */
  autoParts: string[];
  /** 人（承認者）が最後にやること */
  humanParts: string[];
  /** 価値レベル（0転記/1収集/2照合/3整形変換/4判断）。受けるかどうかの物差し */
  level: ValueLevel;
  /** 法・規約の地雷。gates.ts の判定と対応 */
  caution: string;
  /** 市場の単価相場（2026-08 調査。出典は調査ログ） */
  priceHint?: string;
  /** AIを併用すると何が良くなるか。カスケード設計: 決定的処理の残りだけAIへ（コストは曖昧分にのみ比例） */
  aiUpgrade?: string;
}

export const DATAOPS_PATTERNS: DataOpsPattern[] = [
  {
    id: "company_list",
    level: 2,
    name: "企業・店舗リスト作成",
    looksLike: "条件に合う企業/店舗をN件、指定項目で一覧化",
    marketExample: "「大阪府内ホテル情報収集・リスト作成」1件200円×100件、「保育園リストアップ300件」（ココナラ 2026-08）",
    keywords: /リスト(作成|アップ)|(企業|店舗|会社|施設|病院|クリニック|サロン|工場)(の)?(リスト|一覧|情報収集)/,
    ops: ["extract", "normalize", "validate", "crosscheck", "dedupe", "ng_filter", "diff"],
    autoParts: ["候補収集", "項目抽出", "電話・URL・社名の照合", "NGリスト除外", "既存リストとの重複排除", "全項目の埋まり検査"],
    humanParts: ["照合で確定できなかった行の目視（1〜2割）", "カナ⇔英字の同一判定", "納品前の抜き打き確認"],
    caution: "個人（個人事業主の自宅等）の連絡先収集は個人情報保護法の要注意類型 → personal_data ゲートで停止。法人公開情報に限る",
    priceHint: "2〜60円/件（検証・付加価値つきは500円/件超も）",
    aiUpgrade: "英字⇔カナの同一判定と非定型サイトからの項目抽出。決定的処理で確定できなかった行だけAIへ",
  },
  {
    id: "list_cleansing",
    level: 2,
    name: "既存リストの検証・更新（リストクレンジング）",
    looksLike: "古い顧客/営業リストの電話・住所・URLが今も有効か確認して直す",
    marketExample: "営業代行会社の定番依頼。ホテル案件も「過去納品の電話番号が使われていない」ことが発端",
    keywords: /リスト(の)?(クレンジング|整備|更新|精査|チェック)|(電話番号|URL|住所)(の)?(確認|検証|生死)/,
    ops: ["normalize", "validate", "crosscheck", "dedupe"],
    autoParts: ["形式検査", "ダミー番号検出", "現ソースとの照合", "重複統合"],
    humanParts: ["移転・社名変更の最終判断", "電話でしか確認できない項目"],
    caution: "個人リストのクレンジングは受けない（法人リストのみ）",
    priceHint: "1〜10円/件、一式5,000円〜数万円",
    aiUpgrade: "移転・社名変更の候補判定。新旧の値が同一組織かをAIが判定し、unsureは人へ",
  },
  {
    id: "dedupe_merge",
    level: 2,
    name: "名寄せ・重複統合",
    looksLike: "複数の名簿/リストを1本にまとめ、表記ゆれの重複を消す",
    marketExample: "住所録整備・顧客名簿統合。ホテル案件の「同一運営会社は表記ゆれ含め3施設まで」も同型",
    keywords: /名寄せ|重複(の)?(削除|排除|統合|チェック)|(リスト|名簿|データ)の(統合|マージ|突合)/,
    ops: ["normalize", "dedupe", "diff", "csv_clean"],
    autoParts: ["法人格・全半角・スペースの揺れを吸収した同一判定", "先勝ち統合と除外ログ"],
    humanParts: ["カナ⇔英字など機械で同一にできない候補の判定"],
    caution: "個人名簿は個人情報保護法の管理下。取り扱い条件を発注者に確認してから",
    aiUpgrade: "カナ⇔英字・略称の同一判定（ソラーレ⇔Solare）。曖昧ペアだけAIに掛ける",
  },
  {
    id: "ec_product_entry",
    level: 3,
    name: "ECサイト商品登録・商品データ整形",
    looksLike: "商品情報N点をモール仕様のCSVに整えて登録",
    marketExample: "「楽天新規出店の商品50アイテムの登録」画像はメーカーHPから取得（ココナラ 2026-08）",
    keywords: /商品.{0,12}(登録|入力|整形)|商品(データ|情報)|(楽天|Yahoo!?|Amazon|ヤフー|BASE|Shopify).{0,20}(出品|登録|CSV)/,
    ops: ["normalize", "validate", "mail_merge", "csv_clean"],
    autoParts: ["項目の正規化", "モールCSV仕様への変換", "必須項目の欠け検査", "説明文の差し込み生成"],
    humanParts: ["画像の権利確認（メーカー画像の転載可否は人が確認）", "登録実行"],
    caution: "画像・説明文の転載は著作権と各モール規約の確認が必須。無断転載の代行はしない",
    priceHint: "単純転記10〜30円/商品、説明文込み50〜200円/商品",
    aiUpgrade: "商品説明文の下書き生成とカテゴリ判定。公開前に人が読む前提",
  },
  {
    id: "survey_tabulation",
    level: 3,
    name: "アンケート集計・報告表作成",
    looksLike: "回答データを集計してグラフ/表にまとめる",
    marketExample: "「採用サービスのアンケート・ヒアリング」系（ココナラ 2026-08）。回答CSV→単純集計+クロス集計が定番",
    keywords: /アンケート(の)?(集計|入力|結果)|回答(データ)?の(集計|整理)|クロス集計|単純集計/,
    ops: ["csv_clean", "tabulate", "mail_merge"],
    autoParts: ["度数分布", "複数回答の分解", "クロス集計", "数値要約", "報告文の骨組み生成"],
    humanParts: ["自由記述の解釈", "報告書の考察部分"],
    caution: "回答者の個人情報（氏名・連絡先つき生データ）は受領前に匿名化を依頼する",
    aiUpgrade: "自由記述の分類。回答内の引用を根拠として要求し、引用が実在しない回答は人へ（幻覚検品）",
  },
  {
    id: "transcription_structuring",
    level: 3,
    name: "テキスト転記・構造化（PDF/画像/名刺→表）",
    looksLike: "PDFや画像のテキストをExcel/スプレッドシートに転記",
    marketExample: "名刺入力・レシート入力・請求書転記。クラウドソーシングのデータ入力カテゴリの最頻出型",
    keywords: /(PDF|画像|名刺|レシート|領収書|請求書|伝票|手書き).{0,12}(入力|転記|データ化|Excel|エクセル|起こし)/,
    ops: ["extract", "normalize", "validate", "csv_clean"],
    autoParts: ["テキストからの項目抽出", "形式検査", "表への整形"],
    humanParts: ["OCRの読み間違い確認（画像→文字の精度は素材次第）", "判読不能箇所"],
    caution: "名刺・個人宛請求書は個人情報。保管・破棄条件を発注者と合意してから",
    aiUpgrade: "正規表現で拾えない非定型レイアウトからの項目抽出。抽出値は決定的検証を再通過",
  },
  {
    id: "price_research",
    level: 2,
    name: "価格調査・相場表作成",
    looksLike: "指定商品/サービスの価格を複数サイトで調べ相場表に",
    marketExample: "「ヴィンテージサングラス市場調査」「メルカリ/Yahooフリマ商品リサーチ」（ココナラ 2026-08）",
    keywords: /(価格|相場|料金)(の)?(調査|リサーチ|比較|一覧)|市場調査.{0,10}(価格|商品)/,
    ops: ["extract", "normalize", "crosscheck", "tabulate"],
    autoParts: ["価格表記の抽出と円換算", "複数ソースの突き合わせ", "最安/中央値の要約"],
    humanParts: ["状態・真贋など写真でしか判断できない項目"],
    caution: "メルカリ・Amazon等は規約でスクレイピング禁止 → collection_source ゲート。目視収集かAPIの範囲で",
    aiUpgrade: "同一商品かの判定（型番違い・セット品・色違い）",
  },
  {
    id: "mail_merge_docs",
    level: 3,
    name: "差し込み書類の量産（案内文・見積書・宛名）",
    looksLike: "テンプレートに顧客ごとのデータを差し込んでN通作成",
    marketExample: "案内状・DM原稿・見積書の宛先差し替え。事務代行カテゴリの定番",
    keywords: /(差し込み|宛名|宛先).{0,8}(作成|印刷|文書)|(案内文|見積書|請求書).{0,8}(一括|まとめて|複数|量産)/,
    ops: ["mail_merge", "validate", "csv_clean"],
    autoParts: ["全件差し込み", "埋まらない穴の検出と報告", "使われていない列の報告"],
    humanParts: ["文面の最終確認", "発送・送信"],
    caution: "送信代行（メール一斉送信）は特定電子メール法の同意確認が必要。文書作成までに留める",
    aiUpgrade: "文面のトーン調整・敬語の統一",
  },
  {
    id: "web_directory_check",
    level: 2,
    name: "掲載確認・リンク切れ調査",
    looksLike: "リストのURLが生きているか・掲載が続いているか一括確認",
    marketExample: "アフィリエイトサイトのリンク切れ調査、掲載店舗の閉店確認。リスト検証案件の亜種",
    keywords: /(リンク切れ|デッドリンク|URL)(の)?(調査|確認|チェック)|掲載(確認|の有無)/,
    ops: ["normalize", "validate", "crosscheck"],
    autoParts: ["URL形式の検査", "到達確認の一覧化（要ネットワーク実行）"],
    humanParts: ["閉店・移転など内容レベルの確認"],
    caution: "確認先サイトのrobots・負荷に配慮（1件1リクエスト・間隔を空ける）",
    aiUpgrade: "移転先ページが同一事業者かの判定",
  },
  {
    id: "seo_article_data",
    level: 1,
    name: "記事用データ収集・一覧表埋め込み",
    looksLike: "比較記事・まとめ記事のための項目表（N社比較表など）を作る",
    marketExample: "「恋愛・出会いテーマの記事リサーチ」「転職エージェント比較」系記事の下ごしらえ（ココナラ 2026-08）",
    keywords: /(比較表|一覧表|まとめ表)(の)?(作成|埋め)|記事.{0,10}(リサーチ|データ収集|情報収集)/,
    ops: ["extract", "normalize", "validate", "crosscheck", "mail_merge"],
    autoParts: ["公式サイトからの項目抽出", "表への整形", "出典URLの併記"],
    humanParts: ["主観評価の列", "文章化"],
    caution: "他サイトの表の丸写しは著作権侵害。一次ソース（公式）から自分で組む",
    aiUpgrade: "非定型ページからの項目抽出と表の下書き",
  },
  {
    id: "business_card_entry",
    level: 0,
    name: "名刺データ入力",
    looksLike: "名刺のスキャン画像から氏名・会社・連絡先を指定フォーマットへ",
    marketExample: "クラウドソーシングのデータ入力カテゴリ定番。相場10〜30円/枚（2026-08調査）",
    keywords: /名刺.{0,8}(入力|データ化|整理)/,
    ops: ["extract", "normalize", "validate", "csv_clean"],
    autoParts: ["項目分類（社名/TEL/メール）", "全半角・電話番号の正規化", "形式検査"],
    humanParts: ["読み取りの目視補正（旧字体・デザイン名刺）", "同姓同名の判断"],
    caution: "個人情報保護法の要注意類型。NDA必須が普通。データの再利用・持ち出しは禁止",
    priceHint: "10〜30円/枚",
    aiUpgrade: "OCR後の項目分類の補正（氏名/社名/役職の切り分け）",
  },
  {
    id: "transcription_audio",
    level: 0,
    name: "音声文字起こしの整形（ケバ取り・整文・タイムスタンプ）",
    looksLike: "会議・インタビュー音源の書き起こしと整形",
    marketExample: "切り抜き案件の下工程にも頻出（「Vrewで文字起こし」ココナラ 2026-08）。素起こし50〜150円/分",
    keywords: /(文字起こし|テープ起こし|書き起こし)|(音声|会議|インタビュー).{0,8}(テキスト化|文字化)/,
    ops: ["normalize", "validate", "mail_merge"],
    autoParts: ["一次書き起こし（ASRツール併用）", "フィラー除去", "話者ラベル・タイムスタンプの整形"],
    humanParts: ["聞き取りにくい箇所・固有名詞の確認", "意味を変えない整文の最終判断"],
    caution: "会議内容はNDA前提。医療・法律系音源は個人情報の要注意類型",
    priceHint: "素起こし50〜150円/分、整文150〜300円/分",
    aiUpgrade: "ケバ取り・整文。長さの激変は機械検品で弾くが、意味の保存は人が読んで確認",
  },
  {
    id: "receipt_entry",
    level: 0,
    name: "レシート・領収書入力（単純転記に限定）",
    looksLike: "領収書の日付・金額・取引先・費目をExcelへ",
    marketExample: "記帳補助の定番。相場5〜30円/枚（2026-08調査）",
    keywords: /(レシート|領収書|請求書|伝票).{0,8}(入力|転記|データ化)/,
    ops: ["extract", "normalize", "validate", "tabulate"],
    autoParts: ["金額・日付・店名の抽出", "消費税率の判定", "合計の検算"],
    humanParts: ["かすれ・手書きの判読", "費目判断の例外"],
    caution: "税額計算・税務判断まで踏み込むと税理士法52条 → restricted_work ゲート。単純転記に限定",
    priceHint: "5〜30円/枚",
    aiUpgrade: "店名・費目の推定補助（税務判断はしない）",
  },
  {
    id: "job_posting_entry",
    level: 0,
    name: "求人票の転記・求人情報入力",
    looksLike: "求人票PDFや媒体から自社サイト/DBの形式へ転記",
    marketExample: "求人媒体運営会社の定番外注。相場30〜100円/件（2026-08調査）",
    keywords: /求人(票|情報|データ).{0,8}(入力|転記|登録|作成)/,
    ops: ["extract", "normalize", "validate", "mail_merge"],
    autoParts: ["給与・勤務地・雇用形態の抽出と正規化", "必須項目の欠け検査"],
    humanParts: ["表現の言い換え（丸写しは転載）", "掲載可否の確認"],
    caution: "職業安定法の表示ルール（固定残業代の明示等）と元媒体の著作権に注意",
    priceHint: "30〜100円/件",
    aiUpgrade: "転載回避の言い換え（事実の追加・削除は禁止のプロンプトで）",
  },
  {
    id: "property_entry",
    level: 0,
    name: "物件情報入力",
    looksLike: "マイソク・物件資料からポータルへ登録",
    marketExample: "不動産会社の定番外注。相場50〜300円/件（2026-08調査）",
    keywords: /物件(情報|データ).{0,8}(入力|登録|転記)|マイソク|レインズ/,
    ops: ["extract", "normalize", "validate", "mail_merge"],
    autoParts: ["面積・築年・駅距離の抽出と正規化", "表示ルールの形式検査"],
    humanParts: ["図面の読み取り", "おとり広告にならないかの確認"],
    caution: "宅建業法・不動産公正競争規約の表示ルール（徒歩分数の計算方法等）",
    priceHint: "50〜300円/件",
    aiUpgrade: "物件キャッチコピーの下書き",
  },
  {
    id: "meeting_minutes",
    level: 3,
    name: "議事録作成",
    looksLike: "会議録音から決定事項・ToDo・発言要旨をまとめる",
    marketExample: "1本2,000〜10,000円（2026-08調査）",
    keywords: /議事録.{0,6}(作成|起こし|まとめ)/,
    ops: ["normalize", "mail_merge", "validate"],
    autoParts: ["文字起こし整形", "決定事項・宿題・期日の候補抽出", "テンプレへの流し込み"],
    humanParts: ["「決定」か「保留」かの判断", "社内文脈の補完", "責任者名の確定"],
    caution: "経営情報のNDA前提。人事系会議は個人情報の要注意類型",
    priceHint: "1本2,000〜10,000円",
    aiUpgrade: "決定事項・ToDo・期日の抽出案の提示。確定は人",
  },
  {
    id: "annotation",
    level: 4,
    name: "AI学習データ作成（アノテーション）の品質検査",
    looksLike: "ラベル付けと、その一貫性チェック",
    marketExample: "「AIモデルのデータ収録の協力依頼」（ココナラ 2026-08）。時給1,000〜3,000円と入力系より高単価",
    keywords: /アノテーション|ラベル(付け|リング)|(AI|機械学習|学習(用)?)(データ|モデル).{0,10}(作成|収録|タグ)/,
    ops: ["validate", "tabulate", "dedupe"],
    autoParts: ["ガイドライン化できるルールの一括適用", "ラベル分布の集計", "矛盾ラベルの検出"],
    humanParts: ["曖昧ケースの判断", "エッジケースのラベリング"],
    caution: "人物画像・個人情報を含むデータセットは要注意類型。NDA前提",
    priceHint: "時給1,000〜3,000円相当",
    aiUpgrade: "プリラベリング（AIが仮ラベル→人が修正）。アノテーション業界の標準工程",
  },
  {
    id: "store_list",
    level: 2,
    name: "店舗情報収集・エリアリサーチ",
    looksLike: "指定エリア・業態の店舗一覧（店名・住所・営業時間・URL）",
    marketExample: "「大阪府内ホテル」「保育園300件」の同型。相場5〜30円/店舗（2026-08調査）",
    keywords: /(店舗|飲食店|美容室|サロン|ホテル|クリニック).{0,10}(リスト|一覧|情報収集|調査)|エリア.{0,6}リサーチ/,
    ops: ["extract", "normalize", "validate", "crosscheck", "dedupe", "ng_filter"],
    autoParts: ["公式サイト×掲載サイトの二重照合", "住所分割", "チェーン除外"],
    humanParts: ["閉店・移転の最終確認", "「雰囲気」等の感覚条件"],
    caution: "参照元ポータル（食べログ等）の転載禁止規約 → collection_source ゲート。店主個人の携帯収集は要注意類型",
    priceHint: "5〜30円/店舗",
    aiUpgrade: "英字⇔カナの同一判定と非定型サイトからの抽出（company_listと同じカスケード）",
  },
  {
    id: "keyword_research",
    level: 1,
    name: "検索結果・キーワード調査",
    looksLike: "キーワードごとの上位サイト・順位・サジェストを表に",
    marketExample: "SEO会社の定番外注。相場1〜10円/キーワード（2026-08調査）",
    keywords: /(キーワード|検索結果|検索順位).{0,8}(調査|チェック|収集|リサーチ)|サジェスト.{0,6}(収集|調査)/,
    ops: ["extract", "normalize", "tabulate", "dedupe"],
    autoParts: ["結果の転記・整形", "重複統合", "分布集計"],
    humanParts: ["検索意図の分類", "競合の質的評価"],
    caution: "検索エンジンへの自動アクセスは利用規約違反 → 手動収集の整理・集計側をエンジン化する",
    priceHint: "1〜10円/キーワード",
    aiUpgrade: "検索意図（情報収集/比較/購入）の分類",
  },
  {
    id: "document_admin",
    level: 3,
    name: "定型書類の作成代行（請求書・見積書・管理表）",
    looksLike: "元データとテンプレートから書類を量産",
    marketExample: "事務代行カテゴリ定番。1通100〜500円（2026-08調査）",
    keywords: /(請求書|見積書|納品書|管理表|報告書).{0,8}(作成|発行|代行)|事務(代行|作業).{0,10}(書類|資料)/,
    ops: ["mail_merge", "validate", "tabulate", "csv_clean"],
    autoParts: ["差し込み量産", "金額・消費税の検算", "穴の検出と報告"],
    humanParts: ["内容の妥当性確認", "先方事情の例外処理"],
    caution: "契約書など権利義務文書の作成代行は行政書士法・弁護士法に触れ得る → テンプレ転記・清書に限定",
    priceHint: "1通100〜500円",
    aiUpgrade: "文面調整と敬語の統一。金額計算はAIに触らせない（決定的処理のまま）",
  },
  {
    id: "translation_glossary",
    level: 3,
    name: "対訳表・用語集の整備",
    looksLike: "原文と訳文から対訳表・用語集を作る",
    marketExample: "翻訳会社の下工程。相場1〜5円/対（2026-08調査）",
    keywords: /(対訳|用語集|用語ベース|グロッサリ).{0,8}(作成|整備|抽出)/,
    ops: ["normalize", "dedupe", "validate", "csv_clean"],
    autoParts: ["用語候補の抽出", "重複統合", "表への整形"],
    humanParts: ["訳語の妥当性判断", "文脈による訳し分け"],
    caution: "元文書の著作権・機密保持に注意",
    priceHint: "1〜5円/対",
    aiUpgrade: "訳語候補の提示と用語の揺れ検出",
  },

];

export interface PatternMatch {
  pattern: DataOpsPattern;
  /** 募集文にキーワードが当たった箇所 */
  matched: string;
}

/** 募集文に当たるパターンを列挙する。複数当たれば組み合わせ案件。 */
export function matchDataOpsPatterns(text: string): PatternMatch[] {
  const out: PatternMatch[] = [];
  for (const pattern of DATAOPS_PATTERNS) {
    const m = text.match(pattern.keywords);
    if (m) out.push({ pattern, matched: m[0] });
  }
  return out;
}

/** 案件が受けられる水準かの一言。エンジン対応の行や台帳に添える。 */
export function levelVerdict(level: ValueLevel): { accept: boolean; label: string; note: string } {
  const def = VALUE_LEVELS[level];
  if (level >= MIN_LEVEL_TO_ACCEPT) {
    return { accept: true, label: `L${level} ${def.name}`, note: `${def.paidFor}（相場 ${def.unitPrice}）` };
  }
  return {
    accept: false,
    label: `L${level} ${def.name}`,
    note: `${def.paidFor}（相場 ${def.unitPrice}）。単価200円以上の例外を除き受けない`,
  };
}
