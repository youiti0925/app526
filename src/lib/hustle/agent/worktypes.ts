/**
 * 仕事の種類ごとの工程分解。
 *
 * なぜ要るか:
 * 「文字数 × 速度」だけで見積もっていたので、文字数の書いていない仕事は
 * 全部「判定不能」で止まっていた。市場調査で実効時給が高いと分かった
 * SDS作成・化学物質リスクアセスメント・作業標準書・ISO文書整備が、
 * まさにそこで止まっていた。狙う市場の仕事が判定できないのでは意味がない。
 *
 * 工程で分ける理由:
 * AIを使うと「生成」は速くなるが「検証」はむしろ増える。実測でも、
 * 全体の短縮率の中央値は約5割で、9割ではなかった。
 * 工程ごとに「AIがやる/人がやる」を分けておかないと、
 * 生成が速いことを根拠に全体を過小評価してしまう。
 *
 * 数字について:
 * ここに書いてある分数は初期値。実際にやった時間を記録していけば、
 * 自己調整のループ（stepLearn）が実績に寄せていく。
 * 初期値のままのうちは confidence を low にして、そう表示する。
 */

/**
 * 工程を誰がやるか。
 *
 * 最初は "ai" か "human" の2択にしていた。これが設計の間違いだった。
 * 「LLMに判断させてはいけない」工程を、そのまま「人が45分かけてやる」に
 * 落としていた。第3の選択肢——**決定論的なツールにやらせて、人は結果を承認する**
 * ——を考えていなかった。
 *
 * 自動で回るというのは、人が作業しないという意味ではなく、
 * **人がやるのは承認だけ**という意味である。そこを型で表す。
 */
export type StepActor =
  /** ツールかAIが最後までやる。人は見ない。 */
  | "auto"
  /** AIかツールが作り、人が確認して承認する。minutes は「確認」の時間であって、作業の時間ではない。 */
  | "approve"
  /** 人がやらないと成立しない。why に理由が要る。 */
  | "human"
  /** 依頼者側の作業。こちらの時間は使わないが、返事を待つぶん納期には効く。 */
  | "client";

export const ACTOR_LABELS: Record<StepActor, string> = {
  auto: "自動",
  approve: "承認だけ",
  human: "人がやる",
  client: "依頼者",
};

export interface WorkStep {
  name: string;
  by: StepActor;
  /**
   * **あなたの時間**（分）。1単位あたり。
   * auto は 0。approve は「読んで確かめる」時間で、作る時間ではない。
   * client も 0（相手の時間なので）。
   */
  minutes: number;
  /**
   * 機械が動いている時間（分）。あなたのカレンダーは埋めない。
   * 納期に間に合うかを見るときだけ使う。
   */
  machineMinutes: number;
  /** すべて手作業でやった場合の1単位あたりの分数 */
  manualMinutes: number;
  /** どうやって自動化するか。auto / approve のときに書く。 */
  how?: string;
  /** なぜ人がやる必要があるか。by が human のときは必須。 */
  why?: string;
  /**
   * 数量に比例しない工程。案件ごとに1回だけ数える。
   *
   * ここが無かったので、依頼者とのやりとりを物質数だけ掛けていた。
   * 20物質のSDSで「やりとりに6.7時間」という数字が人の作業時間に入っていた。
   */
  perJob?: boolean;
}

export interface WorkType {
  id: string;
  label: string;
  /** 数量の単位 */
  unit: string;
  /** 単位を本文から読むための正規表現 */
  unitPattern: RegExp;
  /** この仕事だと判定するための正規表現 */
  patterns: RegExp[];
  steps: WorkStep[];
  /** 相場（1単位あたり、円）。分かっているものだけ。 */
  marketRateJpy?: { low: number; high: number };
  note: string;
}

export const WORK_TYPES: WorkType[] = [
  {
    id: "sds",
    label: "SDS（安全データシート）の作成・改訂",
    unit: "物質",
    unitPattern: /([0-9,]{1,5})\s*(?:物質|製品|品目|SDS|シート)/i,
    patterns: [/SDS|安全データシート|MSDS/i, /GHS[^。\n]{0,10}(分類|表示|ラベル)/],
    steps: [
      {
        name: "既存SDS・原材料情報の読み込みと整理",
        by: "auto",
        minutes: 0,
        machineMinutes: 3,
        manualMinutes: 40,
        how: "PDF・Excelから成分とCAS番号を抜き出す。",
      },
      {
        name: "GHS区分の照合（NITE統合版にCAS番号で当てる）",
        by: "approve",
        minutes: 3,
        machineMinutes: 2,
        manualMinutes: 45,
        how:
          "LLMに区分を推論させない。NITEが公開している統合版GHS分類結果" +
          "（約3,378物質・35クラスが1物質1行のxlsx）に、CAS番号で決定論的に当てる。" +
          "収載されていれば照合で終わり、人は出典と版を見るだけ。",
        why: "区分が1段ずれても文章としては自然に読めてしまう。だから推論させず、照合にする。",
      },
      {
        // 45分/物質 × 未収載率。未収載率 0.2 は**仮定**であって測定値ではない。
        // 実際の率は、案件のCAS番号を統合版に当てれば確定する。
        // 照合を実装したら、この定数ではなく実測に置き換えること。
        name: "収載外の物質の区分調査（未収載ぶんのみ）",
        by: "human",
        minutes: 9,
        machineMinutes: 0,
        manualMinutes: 9,
        why:
          "NITEの統合版（約3,378物質）に無い物質は、データそのものが存在しない。" +
          "一次文献に当たって区分を決めるしかなく、ここは自動化できない。" +
          "1物質あたり45分 × 未収載率0.2 として置いているが、この0.2は仮定。" +
          "案件のCAS番号を照合すれば確定するので、実装したら実測に差し替える。",
      },
      {
        name: "法令該当性の照合（安衛法・化管法・消防法）",
        by: "approve",
        minutes: 2,
        machineMinutes: 1,
        manualMinutes: 30,
        how:
          "NITE-CHRIPの法規制リスト（xlsx）にCAS番号で当てる。" +
          "「水銀及びその化合物」のような群名は、提供元が個別CASへ展開済み" +
          "（化管法は901の政令番号→10,855CAS）。裾切値も列として入っているので、" +
          "混合物の該当性は「成分濃度 ≧ 裾切値」の比較で決まる。",
        why: "安衛法は毎年対象が増える。人はリストの版（適用日）が古くないかだけを見る。",
      },
      {
        name: "16項目の下書き作成",
        by: "auto",
        minutes: 0,
        machineMinutes: 4,
        manualMinutes: 90,
        how: "照合結果をテンプレートに流し込む。文章の創作はしない。",
      },
      {
        name: "体裁の整形・書式合わせ",
        by: "auto",
        minutes: 0,
        machineMinutes: 1,
        manualMinutes: 20,
        how: "依頼者指定の書式に変換する。",
      },
      {
        name: "納品前の突き合わせと承認",
        by: "approve",
        minutes: 6,
        machineMinutes: 0,
        manualMinutes: 20,
        how: "募集文から抜いた要求項目の一覧と、成果物を並べて見せる（coverage.ts）。",
        why: "実案件で試した結果、AIは作れるところだけ作って残りを黙って飛ばす。並べないと気づけない。ここは省けない。",
      },
      {
        name: "依頼者とのやりとり・修正対応",
        by: "approve",
        minutes: 20,
        machineMinutes: 0,
        manualMinutes: 60,
        perJob: true,
        how: "返信の下書きはこちらで作る。人は読んで送信を承認する。",
        why: "文面は作れるが、送るかどうかの判断は人。",
      },
    ],
    marketRateJpy: { low: 15_000, high: 50_000 },
    note:
      "資格は要りません。GHS区分と法令該当性は、NITEが公開しているデータへのCAS照合で出せます" +
      "（統合版GHS分類結果 約3,378物質、安衛法7,061CAS、化管法10,855CAS、消防法1,956件。いずれもxlsxで一括入手可）。" +
      "自動化できないのは、収載外の物質の文献調査と、混合物の物理化学的危険性" +
      "（引火性液体を除き実測試験が要る）と、つなぎの原則の適用判断です。" +
      "SDSの内容についての法律上の責任は作成者にあり、これは委譲できません。",
  },
  {
    id: "risk_assessment",
    label: "化学物質リスクアセスメント",
    unit: "物質",
    unitPattern: /([0-9,]{1,5})\s*(?:物質|作業|工程|項目|品目)/,
    patterns: [
      /リスクアセスメント/,
      /(化学物質|有害物質)[^。\n]{0,15}(評価|管理|調査|ばく露)/,
      /(ばく露|曝露)[^。\n]{0,10}(濃度|基準|測定|評価)/,
    ],
    steps: [
      {
        name: "対象物質の洗い出しと台帳整理",
        by: "auto",
        minutes: 0,
        machineMinutes: 3,
        manualMinutes: 60,
        how: "提供された台帳・SDSから対象を抽出する。",
      },
      {
        name: "SDSからの危険有害性情報の抽出",
        by: "auto",
        minutes: 0,
        machineMinutes: 2,
        manualMinutes: 45,
        how: "SDSの2項・3項・8項を構造化して取り出す。",
      },
      {
        name: "作業実態の聞き取り（使用量・換気・作業時間・保護具）",
        by: "client",
        minutes: 0,
        machineMinutes: 0,
        manualMinutes: 40,
        how:
          "こちらが現場に行くのではなく、記入式のシートを生成して依頼者に埋めてもらう。" +
          "在宅の請負でこちらが現場に行く前提にしていたのが誤りだった。",
      },
      {
        name: "厚労省のツール（CREATE-SIMPLE 等）の入力値の組み立てと算定",
        by: "auto",
        minutes: 0,
        machineMinutes: 3,
        manualMinutes: 40,
        how: "回答シートから入力値を組み立てて算定する。計算式は公開されている。",
      },
      {
        name: "算定結果とリスク低減措置案の確認",
        by: "approve",
        minutes: 8,
        machineMinutes: 2,
        manualMinutes: 60,
        how: "低減措置の案は生成する。人は「その現場で実行できるか」だけを見る。",
        why: "実行できない対策を書いても意味がない。ここは依頼者の事情を知らないと判断できない。",
      },
      {
        name: "報告書の作成",
        by: "auto",
        minutes: 0,
        machineMinutes: 3,
        manualMinutes: 80,
        how: "算定結果と措置案を報告書の書式に流し込む。",
      },
      {
        name: "説明・修正対応",
        by: "approve",
        minutes: 30,
        machineMinutes: 0,
        manualMinutes: 90,
        perJob: true,
        how: "説明資料と返信の下書きを作る。人は送信を承認する。",
      },
    ],
    marketRateJpy: { low: 30_000, high: 120_000 },
    note:
      "資格は不要で、厚労省が無料のツールを公開しています。現場の情報は記入式シートで依頼者からもらう形にすれば、在宅で完結します。",
  },
  {
    id: "work_standard",
    label: "作業標準書・手順書の作成",
    unit: "工程",
    unitPattern: /([0-9,]{1,5})\s*(?:工程|作業|手順|ページ|項目|本)/,
    patterns: [
      /(作業標準|標準作業|作業手順書|手順書|SOP)/,
      /(マニュアル|業務手順)[^。\n]{0,10}(作成|整備|作り)/,
    ],
    steps: [
      {
        name: "既存資料・動画・メモの読み込み",
        by: "auto",
        minutes: 0,
        machineMinutes: 4,
        manualMinutes: 40,
        how: "依頼者から受け取った資料と作業動画から手順を起こす。",
      },
      {
        name: "手順の構造化と下書き",
        by: "auto",
        minutes: 0,
        machineMinutes: 3,
        manualMinutes: 90,
        how: "5W1Hと急所（安全・品質・やりやすさ）の型に沿って組む。",
      },
      {
        name: "図・写真の差し込みと体裁",
        by: "auto",
        minutes: 0,
        machineMinutes: 2,
        manualMinutes: 45,
        how: "受け取った写真を該当手順に割り当て、指定書式に整える。",
      },
      {
        name: "現物との突き合わせ",
        by: "client",
        minutes: 0,
        machineMinutes: 0,
        manualMinutes: 60,
        how:
          "現場を持っているのは依頼者。確認用のチェックリストを付けて渡し、" +
          "その通りにできるかを見てもらう。こちらが現場に行く前提にしていたのが誤りだった。",
      },
      {
        name: "要求項目との突き合わせ・承認",
        by: "approve",
        minutes: 3,
        machineMinutes: 0,
        manualMinutes: 15,
        how: "工程ごとに、募集の要求と成果物を並べて見せる。",
        why: "AIは作れるところだけ作って残りを黙って飛ばす。工程数ぶん確認は要る。",
      },
      {
        name: "指摘の反映と承認",
        by: "approve",
        minutes: 25,
        machineMinutes: 2,
        manualMinutes: 60,
        perJob: true,
        how: "指摘を反映した差分を生成する。人は差分を見て承認する。",
      },
    ],
    marketRateJpy: { low: 8_000, high: 30_000 },
    note: "製造業の現場を知っていると、依頼者への確認事項が的確になり、往復が減ります。",
  },
  {
    id: "iso_docs",
    label: "ISO文書の整備",
    unit: "文書",
    unitPattern: /([0-9,]{1,5})\s*(?:文書|規程|手順|様式|帳票)/,
    patterns: [/ISO\s?(9001|14001|45001|27001)/i, /(品質|環境|labour|労働安全)[^。\n]{0,8}マネジメントシステム/],
    steps: [
      {
        name: "規格要求事項と現状文書の突き合わせ",
        by: "auto",
        minutes: 0,
        machineMinutes: 5,
        manualMinutes: 90,
        how: "要求事項の一覧に対して、提供された文書がどこを満たすかを対応表にする。",
      },
      {
        name: "不足文書の下書き作成",
        by: "auto",
        minutes: 0,
        machineMinutes: 5,
        manualMinutes: 120,
        how: "対応表の空欄を埋める形で作る。",
      },
      {
        name: "運用と合っているかの確認",
        by: "client",
        minutes: 0,
        machineMinutes: 0,
        manualMinutes: 60,
        how: "文書と運用のずれは、運用している側にしか分からない。確認事項を一覧にして依頼者に渡す。",
      },
      {
        name: "対応表と成果物の突き合わせ・承認",
        by: "approve",
        minutes: 10,
        machineMinutes: 0,
        manualMinutes: 60,
        how: "要求事項の一覧と成果物を並べて見せる。",
        why: "抜けたまま出すと審査で落ちる。並べて確認する工程は省けない。",
      },
      {
        name: "審査指摘への対応",
        by: "approve",
        minutes: 45,
        machineMinutes: 5,
        manualMinutes: 120,
        perJob: true,
        how: "指摘に対する是正の案を生成する。人は妥当性を見て承認する。",
      },
    ],
    marketRateJpy: { low: 30_000, high: 150_000 },
    note: "審査の指摘対応まで含むかで工数が大きく変わります。範囲を先に文面で区切ってください。",
  },
  // --- ここから下は、実際に取れている案件から起こした工程表 ---------------
  //
  // 上の製造業ドキュメント系は、プロフィールの「製造業の実務経験がある」に
  // 寄せて作ったもので、実サイトから取れた42件のうち該当は0件だった
  // （当たった2件は、私が自分で打ち込んだテストデータ）。
  // 工程表が無い案件は unknownSplit で「全部あなたの時間」になり、
  // 時給が低く出て却下される。つまり市場の95%を、能力ではなく
  // 「見積もれないから」という理由で落としていた。
  //
  // 実際に来ているのは text 32件 / code 31件。そこの工程表を置く。
  {
    id: "article_writing",
    label: "記事・ブログの執筆",
    unit: "記事",
    unitPattern: /([0-9,]{1,4})\s*(?:記事|本|件|ページ|コンテンツ)/,
    patterns: [
      /(記事|ブログ|コラム|レビュー記事)[^。\n]{0,10}(作成|執筆|ライティング|書い|制作)/,
      /(ライター|ライティング)[^。\n]{0,8}(募集|依頼|お願い)/,
      /(SEO|検索)[^。\n]{0,10}(記事|コンテンツ)/,
      // 教材・原稿・台本・校正も同じ工程（調べて書いて確かめる）。
      // 実データで、1万円のFX教材のテキスト作成・校正、求人媒体の原稿作成、
      // 30万円のSNS運用教材制作が、どの工程表にも当たらず落ちていた。
      /(教材|テキスト|原稿|台本|シナリオ|マニュアル原稿|ホワイトペーパー)[^。\n]{0,10}(作成|執筆|制作|ライティング)/,
      /(校正|校閲|リライト|推敲)[^。\n]{0,10}(お願い|依頼|募集|できる方|担当)/,
    ],
    steps: [
      {
        name: "検索意図の整理と構成案",
        by: "auto",
        minutes: 0,
        machineMinutes: 2,
        manualMinutes: 40,
        how: "対象キーワードから、読者が何を知りたいのかを整理して見出しを組む。",
      },
      {
        name: "一次情報の収集",
        by: "auto",
        minutes: 0,
        machineMinutes: 4,
        manualMinutes: 45,
        how: "公的統計・公式サイト・原典に当たって、出典つきで事実を集める。",
      },
      { name: "本文の執筆", by: "auto", minutes: 0, machineMinutes: 3, manualMinutes: 90, how: "構成案と収集した事実から書く。" },
      {
        name: "事実確認（数字・固有名詞・出典）",
        by: "approve",
        minutes: 8,
        machineMinutes: 1,
        manualMinutes: 30,
        how: "本文中の数字・固有名詞・引用に出典を並べて出す。人は出典と本文が合っているかを見る。",
        why:
          "生成した文章は、出典が無くても断定調で書けてしまう。" +
          "ここを飛ばして納品すると、間違いが載ったまま公開される。省けない。",
      },
      { name: "体裁・見出し・内部リンク", by: "auto", minutes: 0, machineMinutes: 1, manualMinutes: 20, how: "指定の書式に整える。" },
      {
        name: "要求項目との突き合わせ・承認",
        by: "approve",
        minutes: 4,
        machineMinutes: 0,
        manualMinutes: 15,
        how: "募集文から抜いた要求項目と成果物を並べて見せる。",
        why: "実案件の試作で、募集に書いてある項目を黙って飛ばす失敗が全件で起きた。",
      },
      {
        name: "修正対応",
        by: "approve",
        minutes: 20,
        machineMinutes: 2,
        manualMinutes: 45,
        perJob: true,
        how: "修正の差分を生成する。人は差分を見て承認する。",
      },
    ],
    marketRateJpy: { low: 3_000, high: 15_000 },
    note:
      "実際に一番数がある仕事。単価は文字数ではなく「調べる量」で決まります。" +
      "一次情報に当たった記事は単価が上げられるので、そこを売りにしてください。",
  },
  {
    id: "sns_content",
    label: "SNS投稿文・運用",
    unit: "投稿",
    unitPattern: /([0-9,]{1,4})\s*(?:投稿|本|回|件|ポスト|ツイート)/,
    patterns: [
      /(SNS|Instagram|インスタ|X\(旧Twitter\)|Twitter|TikTok|Facebook)[^。\n]{0,14}(投稿|発信|集客)[^。\n]{0,10}(作成|制作|代行|依頼|お願い|募集|してくださる|していただ)/,
      /(投稿文|キャプション|ハッシュタグ|PR投稿|宣伝投稿)[^。\n]{0,10}(作成|制作|考え|依頼|お願い|募集|してくださる|していただ)/,
      /(SNS|Instagram|インスタ|X\(旧Twitter\)|Twitter|TikTok)[^。\n]{0,8}(戦略|運用)[^。\n]{0,10}(立案|設計|代行|依頼|お願い|募集)/,
    ],
    steps: [
      {
        name: "対象と訴求の整理",
        by: "auto",
        minutes: 0,
        machineMinutes: 2,
        manualMinutes: 30,
        how: "依頼者の商材・過去投稿から、誰に何を言うかを整理する。",
      },
      { name: "投稿文とハッシュタグの生成", by: "auto", minutes: 0, machineMinutes: 2, manualMinutes: 25, how: "媒体ごとの文字数と作法に合わせて書く。" },
      {
        name: "表現の確認（景表法・薬機法・誇大表現）",
        by: "approve",
        minutes: 5,
        machineMinutes: 1,
        manualMinutes: 20,
        how: "「必ず痩せる」「日本一」のような、根拠が要る表現を機械的に洗い出して並べる。",
        why:
          "投稿主が責任を負う表現なので、こちらの判断で通してはいけない。" +
          "効果効能・最上級・体験談は、根拠が無いと法に触れる。",
      },
      { name: "投稿カレンダーへの割り付け", by: "auto", minutes: 0, machineMinutes: 1, manualMinutes: 15, how: "曜日・時間帯を割り当てて表にする。" },
      {
        name: "要求項目との突き合わせ・承認",
        by: "approve",
        minutes: 3,
        machineMinutes: 0,
        manualMinutes: 10,
        how: "募集の指定（本数・媒体・トーン）と成果物を並べる。",
      },
      {
        name: "修正対応",
        by: "approve",
        minutes: 20,
        machineMinutes: 2,
        manualMinutes: 40,
        perJob: true,
        how: "修正の差分を生成する。",
      },
    ],
    marketRateJpy: { low: 1_000, high: 5_000 },
    note:
      "1投稿あたりの単価は低いので、本数でまとめないと成立しません。" +
      "投稿の代行（アカウントを預かる）は各社の規約に触れることがあるので、文面の納品までに留めてください。",
  },
  {
    id: "data_entry",
    label: "データ入力・リスト作成",
    unit: "件",
    unitPattern: /([0-9,]{1,6})\s*(?:件|行|社|レコード|商品|品目)/,
    patterns: [
      /(リスト|データ)[^。\n]{0,8}(作成|収集|入力|整理|化)/,
      /(データ入力|転記|名寄せ|リサーチ業務)/,
      /(企業|店舗|商品)[^。\n]{0,8}(情報|一覧)[^。\n]{0,8}(収集|作成|まとめ)/,
    ],
    steps: [
      { name: "収集元と項目の確定", by: "auto", minutes: 0, machineMinutes: 5, manualMinutes: 20, perJob: true, how: "どこから何を取るかを決めて、表の列を作る。" },
      {
        name: "収集と転記",
        by: "auto",
        minutes: 0,
        machineMinutes: 0.2,
        manualMinutes: 2,
        how: "公開情報から機械的に集める。robots.txt を見て、禁止されている先は取らない。",
      },
      {
        name: "名寄せ・重複除去・表記ゆれの統一",
        by: "auto",
        minutes: 0,
        machineMinutes: 10,
        manualMinutes: 15,
        perJob: true,
        how: "住所・社名の表記を揃え、重複を落とす。件数が増えても処理は一括なので、件数には比例しない。",
      },
      {
        name: "抜き取り検査",
        by: "approve",
        minutes: 25,
        machineMinutes: 0,
        manualMinutes: 25,
        perJob: true,
        how: "全件ではなく、無作為に抜いた30行ほどを原典と突き合わせて出す。",
        why:
          "全件は見られないが、ゼロ件も見ないのは危ない。抜き取りで誤りの率を出す。" +
          "**抜き取りなので件数に比例しない。** ここを件数ぶん掛けていたら、" +
          "500件のリストで「抜き取り検査に16時間」という計算になっていた。",
      },
      {
        name: "納品形式への変換",
        by: "auto",
        minutes: 0,
        machineMinutes: 3,
        manualMinutes: 10,
        perJob: true,
        how: "指定の CSV / Excel / スプレッドシートに落とす。",
      },
      { name: "修正対応", by: "approve", minutes: 15, machineMinutes: 1, manualMinutes: 30, perJob: true, how: "指摘のあった行を直して差分を出す。" },
    ],
    marketRateJpy: { low: 20, high: 100 },
    note:
      "1件あたりの単価が最も低い仕事なので、手作業でやると必ず最低賃金を割ります。" +
      "機械で集められる案件だけを受けてください。「サイトにログインして取る」ものは規約違反になりがちです。",
  },
  {
    id: "video_edit",
    label: "動画編集（仕様どおりの書き出し）",
    unit: "本",
    unitPattern: /([0-9,]{1,4})\s*(?:本|点|動画|編集)/,
    patterns: [
      /(動画|ムービー|映像)[^。\n]{0,10}(編集|制作|作成|カット)/,
      /(テロップ|字幕|BGM|カット編集)/,
    ],
    steps: [
      { name: "素材の確認と整理", by: "auto", minutes: 0, machineMinutes: 3, manualMinutes: 30, how: "受け取った素材の尺・解像度・音量を調べて一覧にする。" },
      {
        name: "構成とテロップの原稿化",
        by: "auto",
        minutes: 0,
        machineMinutes: 3,
        manualMinutes: 60,
        how: "音声を文字起こしして、カット位置とテロップを秒単位の表にする。",
      },
      { name: "書き出し（ffmpeg）", by: "auto", minutes: 0, machineMinutes: 8, manualMinutes: 90, how: "カット・テロップ焼き込み・BGM合成・音量調整を、表のとおりに実行する。" },
      {
        name: "通しでの目視確認",
        by: "approve",
        minutes: 25,
        machineMinutes: 0,
        manualMinutes: 30,
        how: "書き出したものを最初から最後まで見る。",
        why:
          "音ズレ・テロップの重なり・切り過ぎは、仕様書の上では正しくても目で見ないと分からない。" +
          "尺のぶんだけ時間がかかるので、ここは短縮できない。",
      },
      { name: "修正対応", by: "approve", minutes: 25, machineMinutes: 5, manualMinutes: 60, perJob: true, how: "指示の箇所だけ差し替えて書き出す。" },
    ],
    marketRateJpy: { low: 5_000, high: 30_000 },
    note:
      "**.prproj（Premiere のプロジェクトファイル）での納品を求める案件は受けられません。** " +
      "ffmpeg では作れない形式です（gates.ts が先に落とします）。" +
      "MP4 納品で、かつ演出をこちらに任せない（仕様が決まっている）案件だけが成立します。",
  },
  {
    id: "illustration",
    label: "イラスト制作",
    unit: "点",
    unitPattern: /([0-9,]{1,4})\s*(?:点|枚|カット|体|パターン|案)/,
    patterns: [
      /(イラスト|キャラクター|挿絵|アイコン|バナー)[^。\n]{0,12}(制作|作成|描い|お願い|依頼|募集)/,
      /(絵|作画)[^。\n]{0,8}(描け|制作|依頼)/,
    ],
    steps: [
      { name: "指定の読み取りと参考の整理", by: "auto", minutes: 0, machineMinutes: 2, manualMinutes: 30, how: "指定（構図・服装・表情・用途）を項目に落とす。" },
      { name: "画像生成（ローカルのSDXL等）", by: "auto", minutes: 0, machineMinutes: 10, manualMinutes: 240, how: "商用可のモデルだけを使う。licenses.ts で禁止しているものは選ばない。" },
      {
        name: "指定との突き合わせと選別",
        by: "approve",
        minutes: 20,
        machineMinutes: 0,
        manualMinutes: 30,
        how: "生成した候補と、指定の項目を並べて出す。",
        why:
          "指の本数・左右の取り違え・指定した小物の欠落は、生成側からは検出できない。" +
          "実案件の試作では、ここで落ちて納品できる水準にならなかった。",
      },
      { name: "修正対応", by: "approve", minutes: 30, machineMinutes: 10, manualMinutes: 90, perJob: true, how: "指摘を反映して再生成する。" },
    ],
    marketRateJpy: { low: 3_000, high: 30_000 },
    note:
      "**実案件の試作では、そのまま納品できる水準になりませんでした（vector 0点 / art 15点）。** " +
      "工程表を持っているのは「見積もれない」を「見積もれるが割に合わない」に変えるためで、" +
      "作れると主張しているわけではありません。試作の結果が変われば自動的に判定も変わります。" +
      "指定が細かい案件（キャラクターの一貫性・特定の画風）は特に通りません。",
  },
  {
    id: "web_build",
    label: "小規模なWeb実装・修正",
    unit: "機能",
    unitPattern: /([0-9,]{1,3})\s*(?:機能|画面|ページ|箇所|項目)/,
    patterns: [
      /(LP|ランディングページ|ホームページ|Webサイト|サイト)[^。\n]{0,10}(制作|作成|修正|改修|コーディング)/,
      /(HTML|CSS|JavaScript|WordPress|React|Next\.js|Python|GAS|Google Apps Script)[^。\n]{0,12}(実装|修正|対応|作成|開発)/,
      /(バグ|不具合)[^。\n]{0,8}(修正|対応)/,
      // 「システム開発」「ツール開発」「ボット開発」が当たっていなかった。
      // 実データで、5万円の自動購入ツール開発・LINEチャットボット開発・
      // 進捗管理システムの開発が、どの工程表にも当たらず落ちていた。
      /(システム|ツール|アプリ|ボット|bot|チャットボット|スクリプト|自動化|API連携|スクレイピング)[^。\n]{0,10}(開発|実装|構築|作成|制作)/,
      /(開発|実装|構築)[^。\n]{0,8}(できる方|担当|プロフェッショナル|エンジニア)[^。\n]{0,6}(募集|依頼|お願い)/,
    ],
    steps: [
      { name: "要件の整理と受け入れ条件の明文化", by: "auto", minutes: 0, machineMinutes: 2, manualMinutes: 40, how: "「何ができたら完了か」を先に文章にして、依頼者に確認してもらう。" },
      { name: "実装", by: "auto", minutes: 0, machineMinutes: 6, manualMinutes: 120, how: "受け入れ条件を満たすコードを書く。" },
      { name: "テストの作成と実行", by: "auto", minutes: 0, machineMinutes: 3, manualMinutes: 45, how: "受け入れ条件をそのままテストにして走らせる。落ちたら直して、通るまで繰り返す。" },
      {
        name: "実際に動かしての確認",
        by: "approve",
        minutes: 10,
        machineMinutes: 2,
        manualMinutes: 30,
        how: "テストが通っていても、画面を開いて操作する。",
        why:
          "テストが通ることと、依頼者が期待した動きになっていることは別。" +
          "見た目の崩れやスマホでの挙動は、テストでは拾えない。",
      },
      { name: "修正対応", by: "approve", minutes: 25, machineMinutes: 5, manualMinutes: 60, perJob: true, how: "指摘を直して、差分とテスト結果を出す。" },
    ],
    marketRateJpy: { low: 10_000, high: 80_000 },
    note:
      "受け入れ条件を先に文章で固めないと、無限に修正が続きます。" +
      "「イメージと違う」で戻ってくる案件は、条件を書面にしていないことが原因です。",
  },
  {
    id: "translation",
    label: "翻訳（機械翻訳＋後編集）",
    unit: "文字",
    unitPattern: /([0-9,]{2,7})\s*(?:文字|ワード|words?)/i,
    patterns: [/(翻訳|和訳|英訳|ローカライズ|多言語化)/],
    steps: [
      {
        name: "機械翻訳にかける",
        by: "auto",
        minutes: 0,
        machineMinutes: 1,
        manualMinutes: 30,
        how: "用語集を先に当ててから訳す。",
      },
      {
        name: "訳抜け・数値・用語の機械チェック",
        by: "auto",
        minutes: 0,
        machineMinutes: 1,
        manualMinutes: 15,
        how:
          "原文と訳文をセグメントで突き合わせ、抜けている文・数値の不一致・用語集違反を機械的に洗い出す。" +
          "ここは目視より機械のほうが確実に見つかる。",
      },
      {
        name: "機械が挙げた箇所の確認",
        by: "approve",
        minutes: 8,
        machineMinutes: 0,
        manualMinutes: 30,
        how: "全文を読み直すのではなく、機械が挙げた箇所だけを見る。",
        why: "機械翻訳は流暢に間違える。ただし全文を1文ずつ読む必要はなく、検出された箇所に絞れる。",
      },
      {
        name: "用語集の更新",
        by: "auto",
        minutes: 0,
        machineMinutes: 1,
        manualMinutes: 15,
        how: "確認で直った箇所を用語集に反映する。次の案件が速くなる。",
      },
    ],
    note: "1,000文字あたりの分数として計算します。「AIで速い」を売りにすると単価が壊れる代表例なので、売るなら用語統一と品質保証のほうです。",
  },
  {
    id: "manual_writing",
    label: "マニュアル・業務手順の文書化",
    unit: "ページ",
    unitPattern: /([0-9,]{1,4})\s*(?:ページ|項目|章|本)/,
    patterns: [/(マニュアル|取扱説明書|業務フロー|オンボーディング資料)/],
    steps: [
      {
        name: "素材の読み込みと構成案",
        by: "auto",
        minutes: 0,
        machineMinutes: 2,
        manualMinutes: 40,
        how: "受け取った資料から章立てを起こす。",
      },
      {
        name: "本文の下書き",
        by: "auto",
        minutes: 0,
        machineMinutes: 3,
        manualMinutes: 60,
        how: "構成案に沿って書く。",
      },
      {
        name: "図表の作成",
        by: "auto",
        minutes: 0,
        machineMinutes: 2,
        manualMinutes: 30,
        how: "手順のフロー図・表を生成する。",
      },
      {
        name: "手順が通るかの確認",
        by: "client",
        minutes: 0,
        machineMinutes: 0,
        manualMinutes: 40,
        how: "その手順で実際に動くかは、業務をやっている側にしか確かめられない。確認用のチェックリストを付けて渡す。",
      },
      {
        name: "要求項目との突き合わせ・承認",
        by: "approve",
        minutes: 5,
        machineMinutes: 0,
        manualMinutes: 20,
        how: "募集文から抜いた要求項目と成果物を並べて見せる。",
      },
      {
        name: "修正対応",
        by: "approve",
        minutes: 15,
        machineMinutes: 2,
        manualMinutes: 45,
        perJob: true,
        how: "修正の差分を生成する。人は差分を見て承認する。",
      },
    ],
    marketRateJpy: { low: 3_000, high: 15_000 },
    note: "",
  },
];

export interface WorkTypeEstimate {
  workType: WorkType;
  /** 読み取れた数量 */
  units: number;
  /** 数量が本文から読めたか。読めなければ1件として計算している。 */
  unitsRead: boolean;
  /**
   * **あなたの時間**（時間）。承認・確認・人がやるしかない工程の合計。
   * 週の稼働時間と比べるのはこの数字。
   */
  humanHours: number;
  /** 機械が動いている時間。あなたのカレンダーは埋めないが、納期には効く。 */
  machineHours: number;
  /** あなたの時間 + 機械の時間。仕事全体の所要時間の目安。 */
  aiHours: number;
  /** すべて手作業でやった場合の合計時間 */
  manualHours: number;
  /** 依頼者に動いてもらう必要がある時間。こちらの時間ではないが、待ちが発生する。 */
  clientHours: number;
  /** 手作業に対する短縮率（0〜1）。1に近いほど速い。 */
  reduction: number;
  /** 工程ごとの内訳。人に見せる。 */
  breakdown: {
    name: string;
    by: StepActor;
    /** あなたの時間 */
    hours: number;
    /** 機械の時間 */
    machineHours: number;
    how?: string;
    why?: string;
    perJob: boolean;
  }[];
}

/**
 * 数量として読んではいけない数字を消す。
 *
 * 実データで「ISO14001 文書の整備」から 14,001文書 と読み、
 * 33,835時間 という見積りを出していた。ギークスジョブのページタグ
 * 「24365作業なし」からは 24,365工程 を読んでいた。
 * どちらも、そのまま時給の計算に流れる。
 */
export function stripNonQuantities(text: string): string {
  return (
    text
      // 規格番号: ISO9001 / ISO 14001 / JIS Z 7253 / IEC 62443
      .replace(/\b(ISO|IEC|JIS|ANSI|ASTM)\s?[A-Z]?\s?[0-9-]{3,7}/gi, " ")
      // 年号・西暦
      .replace(/\b(19|20)[0-9]{2}\s*年?/g, " ")
      // 5桁以上の連番（タグ・ID・郵便番号のたぐい）。
      // ただし直後に単位が付いているものは本物の数量なので残す。
      // 「100000文字の翻訳」を消していたせいで数量が読めなくなり、
      // 1単位（1,000文字）として計算していた。100倍の過小見積りになる。
      .replace(
        /\b[0-9]{5,}\b(?!\s*(?:文字|字|語|ワード|words?|件|物質|製品|品目|ページ|枚|本|点|行|レコード|セル|項目))/gi,
        " "
      )
  );
}

/** 副業として現実的な数量の上限。これを超えたら読み間違いとみなす。 */
const MAX_PLAUSIBLE_UNITS = 500;

/**
 * 「これを作ってください」と依頼している形。
 * 助詞で見る。日本語は「Xを作成」「Xの作成」が依頼で、「Xが整備されている」は状態の説明。
 */
const AS_REQUEST =
  /[をの]\s*[^。\n]{0,20}(作成|制作|整備|作り|書き|執筆|依頼|お願い|募集|代行|支援|実施)/;

/**
 * 語そのものが動詞になるもの（翻訳・英訳・リスクアセスメント）は、
 * 直後の「してください」「をお願い」で依頼と分かる。
 */
const AS_SAHEN_REQUEST =
  /^\s*(を?\s*(し|いたし|お願い|依頼|代行|対応)|の\s*(お願い|依頼|代行|案件|業務))/;

/**
 * 「SDS作成」「リスクアセスメント実施」のように、助詞をはさまず
 * 直後に動作の語が続く形。日本語ではこれが一番よくある依頼の書き方。
 * 「手順書が整備されている」は先に AS_BACKGROUND で落ちるので、ここには来ない。
 */
const AS_COMPOUND = /^\s*(作成|制作|整備|作り|執筆|代行|支援|実施|対応)/;

/**
 * 状態の説明。ここに当たるものは依頼ではない。
 * 実データで「確実な手順書が整備されているため」という背景説明だけで、
 * SAP運用保守の案件を「作業標準書の作成」と判定していた。
 */
const AS_BACKGROUND =
  /が\s*[^。\n]{0,10}(整備|完備|用意|存在|あり|ある|ござい|できてい|揃っ)|に\s*(沿っ|従っ|基づ)|(支援)?(サービス|事業|会社|企業)?\s*を\s*(提供|運営|展開|手掛け|行っ)|(サービス|事業)\s*(です|でございます|を営)/;

/**
 * その仕事を「依頼されている」のか、単に言及されているだけなのかを見る。
 *
 * 位置では判定しない。本文抽出が JSON-LD の説明文を先頭に置くので、
 * 「先頭にあれば依頼」という仮定は成り立たなかった。
 */
function matchesAsRequest(text: string, workType: WorkType): boolean {
  // 短い文字列は、それ自体が依頼。背景としての言及は長い文章の中に現れる。
  const isShort = text.length < 120;

  for (const p of workType.patterns) {
    // 同じ語が複数回出るので、依頼の形で使われている箇所があるかを全部見る
    const re = new RegExp(p.source, p.flags.includes("g") ? p.flags : `${p.flags}g`);
    for (const m of text.matchAll(re)) {
      if (m.index === undefined) continue;
      const after = text.slice(m.index + m[0].length, m.index + m[0].length + 30);
      if (AS_BACKGROUND.test(after)) continue;
      if (isShort) return true;
      if (AS_REQUEST.test(after) || AS_SAHEN_REQUEST.test(after) || AS_COMPOUND.test(after)) return true;
      // 「作業標準書の作成をお願いします」のように語の前に依頼語がある形
      const before = text.slice(Math.max(0, m.index - 20), m.index);
      if (/(作成|制作|整備|代行)\s*[すし]?\s*[るま]?[^。\n]{0,6}$/.test(before)) return true;
    }
  }
  return false;
}

/** 本文がどの仕事に当たるかを判定し、工程を積み上げて時間を出す。 */
/**
 * 仕事の種類が分かっているときに、そこから直接見積もる。
 *
 * 出品の料金表は「1単位の◯◯」という文を組み立てて estimateByWorkType に
 * 通していたが、その合成文が別の仕事の判定に当たったり、どれにも当たらず
 * null になったりしていた。null のときは1単位4時間という根拠の無い数字に
 * 落ちて、そのまま価格になっていた。
 * 種類が手元にあるなら、文を経由しないで数える。
 */
export function estimateUnits(workType: WorkType, units: number): WorkTypeEstimate {
  const N = Math.max(1, Math.round(units));
  const UNITS_READ = true;
  const scaled = (pick: (s: WorkStep) => number) =>
    workType.steps.reduce((acc, s) => acc + (s.perJob ? pick(s) : pick(s) * N), 0);

  // あなたの時間: 承認と、人がやるしかない工程だけ。
  // auto は 0、client は相手の時間なので 0。
  const humanMinutes = scaled((s) => (s.by === "approve" || s.by === "human" ? s.minutes : 0));
  const machineMinutes = scaled((s) => s.machineMinutes);
  const clientMinutes = scaled((s) => (s.by === "client" ? s.manualMinutes : 0));
  const manualMinutes = scaled((s) => s.manualMinutes);

  return {
    workType,
    units: N,
    unitsRead: UNITS_READ,
    humanHours: round(humanMinutes / 60),
    machineHours: round(machineMinutes / 60),
    aiHours: round((humanMinutes + machineMinutes) / 60),
    manualHours: round(manualMinutes / 60),
    clientHours: round(clientMinutes / 60),
    // 短縮率は 0.95 のような値になるので、小数第1位で丸めると 1.0 に潰れる。
    reduction:
      manualMinutes > 0
        ? Math.min(0.99, Math.round((1 - humanMinutes / manualMinutes) * 100) / 100)
        : 0,
    breakdown: workType.steps.map((s) => ({
      name: s.name,
      by: s.by,
      hours: round(((s.perJob ? s.minutes : s.minutes * N) * (s.by === "approve" || s.by === "human" ? 1 : 0)) / 60),
      machineHours: round((s.perJob ? s.machineMinutes : s.machineMinutes * N) / 60),
      how: s.how,
      why: s.why,
      perJob: s.perJob === true,
    })),
  };
}

export function estimateByWorkType(text: string): WorkTypeEstimate | null {
  const normalized = text.normalize("NFKC");
  // 仕事の種類の判定には規格番号が要る（ISO9001 で ISO 案件と分かる）ので元のまま。
  // 数量を読むときだけ、数量ではない数字を消したテキストを使う。
  const workType = WORK_TYPES.find((w) => matchesAsRequest(normalized, w));
  if (!workType) return null;

  const t = stripNonQuantities(normalized);
  // 最初の一致を取ると「1記事3000文字、10本」で 1 を拾ってしまう。
  // 「1◯◯あたり」という書き方が先に来るのが普通なので、最大値を見る。
  // ただし「実績5件以上」のような応募条件の数字は数量ではないので外す。
  const global = new RegExp(workType.unitPattern.source, "g");
  // 応募条件や、除外リストの件数は「作る量」ではない。
  // 実データ:「すでにリストアップ済み（約300件）をお伝えします」の300を
  // 作業量として読み、実際の「100件作成」を無視していた。
  const NOT_QUANTITY = /(実績|経験|以上|最低|月間|年間|累計|登録|会員|募集|済み?|除く|以外|重複|NG|不可)[^。\n]{0,6}$/;
  // 数量のすぐ後ろに作業の動詞が来るものが、一番確かな「作る量」。
  const IS_WORK = /^\s*(?:を|は|ほど|程度|分)?\s*(作成|制作|入力|収集|執筆|編集|翻訳|納品|対応|お願い|依頼)/;

  const cands = [...t.matchAll(global)]
    .filter((mm) => !NOT_QUANTITY.test(t.slice(Math.max(0, (mm.index ?? 0) - 14), mm.index)))
    .map((mm) => ({
      value: Number(mm[1].replace(/,/g, "")),
      work: IS_WORK.test(t.slice((mm.index ?? 0) + mm[0].length, (mm.index ?? 0) + mm[0].length + 12)),
    }))
    .filter((c) => Number.isFinite(c.value) && c.value > 0);

  // 動詞が続くものがあれば、その中の最大値。無ければ全体の最大値。
  const worked = cands.filter((c) => c.work);
  const pool = worked.length ? worked : cands;
  const raw = pool.length ? Math.max(...pool.map((c) => c.value)) : NaN;
  // 文字単位の仕事だけは桁が大きいので別枠
  const cap = workType.unit === "文字" ? 500_000 : MAX_PLAUSIBLE_UNITS;
  const unitsRead = Number.isFinite(raw) && raw > 0 && raw <= cap;
  // 文字単位の仕事は1,000文字を1単位として数える
  const perUnit = workType.unit === "文字" ? 1000 : 1;
  const units = unitsRead ? Math.max(1, Math.ceil(raw / perUnit)) : 1;

  const est = estimateUnits(workType, units);
  return { ...est, unitsRead };
}

const round = (n: number): number => Math.round(n * 10) / 10;

/** 人が読む説明文にする。 */
export function describeWorkType(e: WorkTypeEstimate): string {
  const unitLabel = e.workType.unit === "文字" ? `${e.units * 1000}文字` : `${e.units}${e.workType.unit}`;
  const counted = e.unitsRead ? unitLabel : `${unitLabel}（数量が読めなかったので1単位として計算）`;
  return (
    `${e.workType.label} / ${counted}。` +
    `AI併用で ${e.aiHours}時間（手作業だけなら ${e.manualHours}時間、短縮 ${Math.round(e.reduction * 100)}%）。` +
    `うち ${e.humanHours}時間 はあなたが手を動かす必要があります。`
  );
}
