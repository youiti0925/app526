/**
 * 「この案件の納品物を、AI（私）が作れるか」の判定。
 *
 * これが選別の一番上に来る。経歴ではなく、納品物で切る。
 * このアプリは「AIが作業する」前提なので、経歴で絞ると
 * AIが余裕で作れる仕事まで「経験が無いから」で落としてしまう。
 *
 * 境界の引き方について:
 * 最初は「画像・動画・音声は作れない」で切っていたが、これは間違いだった。
 * 私はファイルを直接吐けないだけで、ツールを書いて回せば作れるものは多い。
 * 動画のカット・テロップ・BGM合成は ffmpeg で仕様どおりに出せるし、
 * ロゴや図解は SVG を直接書ける。
 *
 * 本当の境界は媒体ではなく、**仕様で決まるか、センスで決まるか**。
 *   - 「1分に縮めて、字幕を焼いて、BGMを-20dBで」→ 仕様。自動化できる。
 *   - 「どこで切ると面白いか」「この絵柄で描いて」→ センス。できない。
 *
 * もうひとつの軸が費用。このアプリを使う人にお金が無いことが前提なので、
 * 無料で動くルート（ffmpeg・SVG・コード）だけを「できる」に入れ、
 * API課金が要るものは needsPaid にして別に出す。
 */

import { blockedTools, obligationsFor } from "./licenses";

/** どうやって作るか。 */
export type Route =
  | "direct" // 私がそのまま書く（文章・コード）
  | "tooling" // 私がツール／コードを書いて出力させる（ffmpeg・SVG・スクリプト）
  | "taste" // 出来映えの良し悪しが商品。仕様に落ちない
  | "physical"; // 体が要る（電話・撮影・訪問）

export const ROUTE_LABELS: Record<Route, string> = {
  direct: "私が直接書ける",
  tooling: "私がツールを書いて出せる",
  taste: "センスが商品なので出せない",
  physical: "体が要るので出せない",
};

export type Capability =
  | "text"
  | "code"
  | "data"
  | "research"
  | "video_spec" // 仕様どおりの動画処理
  | "vector" // SVG・図解・チャート
  | "image_batch" // 画像の一括処理
  | "voice" // TTS
  | "image_gen" // 汎用イラスト（画風の指定が無いもの）
  | "art" // 絵柄そのものが商品のイラスト
  | "direction" // 演出・構成のセンス
  | "music"
  | "onsite";

export interface CapabilityDef {
  id: Capability;
  label: string;
  route: Route;
  /** 動かすのに要るもの。空なら追加費用なしで動く。 */
  requires: string[];
  /** 使うツールのID。licenses.ts で規約を確認したもの。 */
  toolIds?: string[];
  /** 課金が要るか */
  needsPaid: boolean;
  /** 具体的に何ができる／できないか。人に見せる。 */
  detail: string;
  patterns: RegExp[];
}

export const CAPABILITIES: CapabilityDef[] = [
  // ---------------- 私が直接書ける ----------------
  {
    id: "text",
    label: "文章・文書",
    route: "direct",
    requires: [],
    needsPaid: false,
    detail: "記事・マニュアル・仕様書・翻訳・SDS などの下書きまで出せます。事実確認はあなたが要ります。",
    patterns: [
      /(記事|ブログ|コラム|原稿|文章|ライティング|執筆|リライト|校正|校閲)/,
      /(マニュアル|手順書|仕様書|議事録|報告書|提案書|企画書|資料作成|構成案)/,
      /(SEO|LP|セールスレター|キャッチコピー|商品説明|メルマガ)/,
      /(翻訳|和訳|英訳|ローカライズ)/,
      /(SDS|安全データシート|リスクアセスメント|ISO|規程|規格文書|作業標準)/,
    ],
  },
  {
    id: "code",
    label: "コード・スクリプト",
    route: "direct",
    requires: [],
    needsPaid: false,
    detail: "プログラム・マクロ・GAS・Excel関数・バグ修正。動かして確認するところまでできます。",
    patterns: [
      /(プログラ|コーディング|開発|実装|スクリプト|マクロ|VBA|GAS|Google Apps Script)/,
      /(Python|JavaScript|TypeScript|PHP|Ruby|Java\b|C#|SQL|HTML|CSS|React|Vue|Next\.js|Laravel|WordPress)/,
      /(API|バッチ|自動化ツール|Excel関数|スプレッドシート.{0,8}(関数|数式|自動))/,
      /(バグ|不具合).{0,10}(修正|対応)/,
      /(コードレビュー|リファクタ|テストコード)/,
    ],
  },
  {
    id: "data",
    label: "データ処理",
    route: "direct",
    requires: [],
    needsPaid: false,
    detail: "入力・整形・集計・名寄せ。手作業でやる想定の量でも、スクリプトを書けば一瞬です。",
    patterns: [
      /(データ入力|データ整形|データ収集|リスト作成|転記|集計|名寄せ)/,
      /(タグ付け|アノテーション|ラベリング|分類作業)/,
      /(スプレッドシート|Excel|CSV).{0,12}(入力|整理|作成|まとめ)/,
    ],
  },
  {
    id: "research",
    label: "調査・要約",
    route: "direct",
    requires: [],
    needsPaid: false,
    detail: "市場調査・競合調査・比較表。一次情報を実際に開いて確かめられます。",
    patterns: [/(市場調査|競合調査|情報収集|リサーチ|下調べ|文献|要約)/, /(比較表|一覧化|洗い出し)/],
  },

  // ---------------- ツールを書けば出せる ----------------
  {
    id: "video_spec",
    label: "動画（仕様どおりの処理）",
    route: "tooling",
    requires: ["ffmpeg"],
    toolIds: ["ffmpeg"],
    needsPaid: false,
    detail:
      "カット・無音カット・テロップ焼き込み・BGM合成・尺調整・ショート化・サムネ切り出し・一括変換。ffmpeg のコマンドを私が書いて回します。無料で、納品物にライセンス上の義務はありません（義務が生じるのは ffmpeg 自体を配布するときだけ）。**ただし mp4 納品でよい案件に限ります。** Premiere のプロジェクトファイル（.prproj）を求められると出力できないので、そういう案件は「応募前の確認」で落ちます。無音カットのしきい値は素材ごとに変わるため、必ず一度目視してから書き出してください。",
    patterns: [
      /(動画|ムービー|映像).{0,10}(編集|制作|作成)/,
      /(テロップ|字幕|カット編集|エンコード|尺|BGM.{0,6}(挿入|合成))/,
      /(YouTube|TikTok|ショート|Reels).{0,10}(編集|制作)/,
      /(Premiere|AfterEffects|After Effects|DaVinci|Vrew|CapCut|Filmora)/,
    ],
  },
  {
    id: "vector",
    label: "図解・ロゴ・チャート",
    route: "tooling",
    requires: [],
    needsPaid: false,
    detail:
      "SVG を直接書きます。図解・インフォグラフィック・グラフ・アイコン。無料。ただし**商標として登録・使用するロゴ**は別です。著作権譲渡と独占的利用と第三者権利の非侵害を同時に保証する必要があり、生成AIでも自作SVGでも保証しきれません（そういう案件は「応募前の確認」で落ちます）。",
    patterns: [
      /(ロゴ|アイコン|図解|インフォグラフィック|チャート|グラフ|作図|ダイアグラム|フロー図)/,
      /(バナー|サムネイル|名刺|チラシ|パンフレット).{0,8}(制作|作成|デザイン)/,
    ],
  },
  {
    id: "image_batch",
    label: "画像の一括処理",
    route: "tooling",
    requires: ["ImageMagick か Python"],
    needsPaid: false,
    detail: "リサイズ・切り抜き・透かし・フォーマット変換・命名整理。枚数が多いほど効きます。無料。",
    patterns: [/(画像|写真).{0,10}(リサイズ|加工|切り抜き|一括|変換|圧縮|トリミング)/],
  },
  {
    id: "image_gen",
    label: "汎用イラスト・画像",
    route: "tooling",
    requires: ["Stable Diffusion（GPU）か ChatGPT 無料枠"],
    toolIds: ["sdxl_local"],
    needsPaid: false,
    // 当初は「イラストは一切作れない」としていたが、ライセンスの調査で誤りと分かった。
    // SDXL（CreativeML Open RAIL++-M）は「Licensor claims no rights in the Output」、
    // ChatGPT 無料枠の gpt-image は「regardless of whether an image was generated
    // through a free or paid credit」と、無料枠でも権利がこちらに来ることを明記している。
    detail:
      "SNSアイコン・挿絵・記事用画像など、画風の指定が無い画像なら無料で商用納品できます。既存キャラや特定作家の画風に似ていないかの目視確認は、あなたの工程として残ります。",
    patterns: [
      /(アイキャッチ|挿絵|記事用|SNS用|アイコン).{0,10}(画像|イラスト|素材)/,
      /(画像|イラスト|ビジュアル).{0,10}(素材|生成|用意).{0,8}(して|お願い|募集)/,
      /(AI画像|画像生成|生成AI).{0,10}(で|を使)/,
    ],
  },
  {
    id: "voice",
    label: "ナレーション（合成音声）",
    route: "tooling",
    requires: ["VOICEVOX Nemo"],
    toolIds: ["voicevox_nemo"],
    // 当初は「有料APIが要るので不可」としていたが、規約を読んだら誤りだった。
    // VOICEVOX Nemo は無料で商用利用でき、条件はクレジット表記のみ。
    needsPaid: false,
    detail:
      "台本は私が書き、読み上げは VOICEVOX Nemo で出せます。無料で商用利用できますが、成果物にクレジット表記が必要です（表記無しは禁止事項）。依頼者が表記を受け入れるかを先に確認してください。",
    patterns: [/(ナレーション|読み上げ|音声化|VOICEVOX|合成音声)/],
  },

  // ---------------- 出せない ----------------
  {
    id: "art",
    label: "イラスト・キャラクター",
    route: "taste",
    requires: [],
    needsPaid: false,
    detail:
      "**画風・絵柄そのものが商品**の案件です。生成AIで画像を出すこと自体はライセンス上できますが、「この画風で」「このキャラで」の指定には追従できません。受けると必ずあなたが描くことになります。画風の指定が無い汎用画像なら「汎用イラスト・画像」のほうで受けられます。",
    patterns: [
      // 単語だけでは判定しない。質問欄のユーザー名で誤判定した実例がある。
      /(イラスト|作画|キャラクターデザイン|似顔絵|漫画|挿絵|線画)[^。\n]{0,20}(制作|作成|描|募集|依頼|お願い|担当)/,
      /(制作|作成|描いて|募集|依頼)[^。\n]{0,20}(イラスト|作画|キャラクターデザイン|似顔絵|挿絵|線画)/,
      /(CLIP STUDIO|クリスタ|SAI|Procreate)/,
      /(画風|絵柄|塗り方|レイヤー構成)/,
    ],
  },
  {
    id: "direction",
    label: "演出・センスが要る編集",
    route: "taste",
    requires: [],
    needsPaid: false,
    detail:
      "「どこで切ると面白いか」「どう見せると伝わるか」は仕様に落ちないので自動化できません。",
    patterns: [
      /(演出|センス|クオリティ.{0,6}(重視|高)|世界観|テイスト.{0,6}(合わせ|寄せ))/,
      /(面白く|バズ|エモ|かっこよく|おしゃれ)/,
      /(モーショングラフィック|アニメーション制作)/,
    ],
  },
  {
    id: "music",
    label: "作曲・歌唱",
    route: "taste",
    requires: [],
    needsPaid: false,
    detail: "作曲・編曲・歌唱は出せません。",
    patterns: [
      /(作曲|編曲|楽曲|劇伴|DTM|ミックス|マスタリング)/,
      /(歌唱|歌ってみた|ボーカル|声優|吹き替え|アフレコ)/,
    ],
  },
  {
    id: "onsite",
    label: "現地作業・電話",
    route: "physical",
    requires: [],
    needsPaid: false,
    detail: "電話・訪問・撮影・接客は体が要るので、あなたがやるしかありません。",
    patterns: [
      // 「電話番号」は集める項目であって、電話をかける仕事ではない。
      // 「架電前」「架電先」は依頼者の行為。
      /(?<!番号調査|候補)(電話(?!番号)|架電(?!前|先|リスト)|コールセンター|テレアポ|受電|SMS.{0,6}対応)/,
      // 「訪問看護」「訪問介護」は事業所の種別名。現地作業の指定ではない。
      /(訪問(?!看護|介護|診療|リハ|美容|理美容)|来社|出社|現地|実地|立会|常駐)/,
      // 「画像の用意（選定/撮影）」のように選択肢として並んでいるものは、
      // 撮影しなくても成立する。区切り記号の直後は指定とみなさない。
      /(?<![/／・|｜])(撮影|カメラマン|ロケ)/,
      /(接客|配送|梱包|発送作業)/,
    ],
  },
];

/**
 * 買い叩かれている領域のサイン。
 * 作れるとしても、実効時給が出ない可能性が高い。
 */
const COMMODITY_RULES: { why: string; patterns: RegExp[] }[] = [
  {
    why: "募集側が「AIを使えば速い」前提で値付けしています。実測で、この書き方の募集は応募者が集中して単価が壊れます。",
    patterns: [
      /(AI|ChatGPT|GPT|生成AI).{0,20}(使っ|活用|利用|使える|OK|可)/,
      /(AI|ChatGPT).{0,10}(で|を使って).{0,10}(作成|執筆|生成)/,
    ],
  },
  {
    why: "単純作業の大量発注です。1件あたりに割り戻すと最低賃金を割ることが多い。",
    patterns: [
      /(単純作業|コピペ|コピー&ペースト|誰でもできる|スキル不要)/,
      /(大量|まとめて).{0,8}(発注|募集|お願い)/,
    ],
  },
  {
    why: "文字単価が明示されていて、相場より低いです。",
    patterns: [/(1|一)文字\s*0?\.?[0-9]{1,2}\s*円/, /文字単価\s*0?\.?[0-9]{1,2}\s*円/],
  },
];

export interface DeliverabilityResult {
  /** 追加費用なしで、私が納品物を出せるか */
  canDeliver: boolean;
  /** 当たった能力 */
  matched: Capability[];
  /** 使うルート */
  routes: Route[];
  /** 動かすのに要るもの（ffmpeg など） */
  requires: string[];
  /** 出せない理由。canDeliver=false のときに必ず入る。 */
  blockers: string[];
  /** お金があれば出せるようになるもの */
  unlockedByPaying: string[];
  /** 作れるとしても、人がやらないと終わらない工程 */
  humanSteps: string[];
  commoditized: boolean;
  commodityReasons: string[];
  /** 納品前に守る必要があること（クレジット表記など） */
  licenseObligations: string[];
  /** 商用の納品に使えないツールが混ざっている場合 */
  licenseBlockers: { id: string; why: string }[];
  note: string;
}

const byId = new Map(CAPABILITIES.map((c) => [c.id, c]));

/**
 * 「〜は含みません」「〜はありません」のように、否定されている言及。
 * これを blocker として数えると、こちらに都合のよい案件まで落とす。
 * 実データで「イラスト制作は業務範囲に含まれず、こちらで用意します」という
 * 動画編集の案件を「イラストは作れない」で落としていた。
 */
const NEGATED =
  /^[^。、\n]{0,12}(含みません|含まず|含まれず|含まれません|ありません|不要|不問|発生しません|お願いしません|ございません|除きます|対象外|こちらで(用意|対応))/;

function isNegated(text: string, pattern: RegExp): boolean {
  const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
  let sawAny = false;
  for (const m of text.matchAll(re)) {
    if (m.index === undefined) continue;
    sawAny = true;
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 25);
    // 1箇所でも否定されていない言及があれば、それは本当に求められている
    if (!NEGATED.test(after)) return false;
  }
  return sawAny;
}

/** 案件本文から、納品物と出せるかどうかを判定する。 */
export function judgeDeliverability(text: string): DeliverabilityResult {
  const t = text.slice(0, 8000);
  const matched = CAPABILITIES.filter((c) =>
    c.patterns.some((p) => p.test(t) && !isNegated(t, p))
  );

  const blockers = matched.filter((c) => c.route === "taste" || c.route === "physical");
  const paid = matched.filter((c) => c.needsPaid);
  const free = matched.filter((c) => !c.needsPaid && (c.route === "direct" || c.route === "tooling"));

  const commodityReasons = COMMODITY_RULES.filter((r) => r.patterns.some((p) => p.test(t))).map(
    (r) => r.why
  );
  const humanSteps = detectHumanSteps(t);

  // 使うツールの規約。クレジット表記の義務を見落として納品すると規約違反になる。
  const toolIds = [...new Set(free.flatMap((c) => c.toolIds ?? []))];

  const base = {
    matched: matched.map((c) => c.id),
    licenseObligations: obligationsFor(toolIds),
    licenseBlockers: blockedTools(toolIds),
    routes: [...new Set(matched.map((c) => c.route))],
    requires: [...new Set(free.flatMap((c) => c.requires))],
    unlockedByPaying: paid.map((c) => `${c.label}（${c.requires.join("・")}）`),
    humanSteps,
    commoditized: commodityReasons.length > 0,
    commodityReasons,
  };

  // 出せないものが1つでも混ざっていたら受けない。
  // 「動画編集、ただし演出はお任せ」は演出のところで必ず詰まる。
  if (blockers.length > 0) {
    return {
      ...base,
      canDeliver: false,
      blockers: blockers.map((c) => `${c.label}: ${c.detail}`),
      note: `${blockers.map((c) => c.label).join("・")} が含まれます。ここは私が出せないので、受けるとあなたが手を動かすことになります。`,
    };
  }

  if (free.length === 0) {
    if (paid.length > 0) {
      return {
        ...base,
        canDeliver: false,
        blockers: paid.map((c) => `${c.label}: ${c.detail}`),
        note: `${paid.map((c) => c.label).join("・")} は外部サービスの課金が要ります。お金ができてからにしてください。`,
      };
    }
    return {
      ...base,
      canDeliver: false,
      blockers: ["何を納品するのか、本文から読み取れませんでした"],
      note: "納品物が読み取れませんでした。募集文が短いか、添付ファイル頼みの可能性があります。応募前に何を作るのか聞いてください。",
    };
  }

  // 商用に使えないツールしか手が無いなら、作れることにしない
  if (base.licenseBlockers.length > 0) {
    return {
      ...base,
      canDeliver: false,
      blockers: base.licenseBlockers.map((b) => `${b.id}: ${b.why}`),
      note: `使えるツールが商用の納品に使えません（${base.licenseBlockers.map((b) => b.id).join("・")}）。出来に関係なく規約違反になります。`,
    };
  }

  const tools = base.requires.length ? `動かすのに ${base.requires.join("・")} が要ります。` : "";
  const duty = base.licenseObligations.length
    ? `納品前に守ること: ${base.licenseObligations.join(" / ")}。`
    : "";
  const money = commodityReasons.length ? "ただし単価が壊れている領域の可能性があります。" : "";
  const hands = humanSteps.length ? `あなたの手が要る工程: ${humanSteps.join(" / ")}。` : "";

  return {
    ...base,
    canDeliver: true,
    blockers: [],
    note: `${free.map((c) => c.label).join("・")} なので出せます。${tools}${duty}${money}${hands}`,
  };
}

/**
 * AIが作れる仕事でも、人がやらないと終わらない工程がある。
 * ここを計上しないと工数を過小評価する。
 */
export function detectHumanSteps(text: string): string[] {
  const steps: string[] = [];
  const add = (label: string, patterns: RegExp[]) => {
    if (patterns.some((p) => p.test(text))) steps.push(label);
  };

  add("依頼者とのやりとり", [/(打ち合わせ|ミーティング|MTG|定例|Slack|Chatwork|チャット.{0,8}(参加|対応))/]);
  add("実物・現場の確認", [/(現場|実物|サンプル|工場|設備).{0,10}(確認|見て|把握)/]);
  add("あなたの名前での確認・署名", [/(署名|捺印|責任者|有資格者|最終確認)/]);
  add("守秘情報の扱い", [/(NDA|秘密保持|機密|個人情報|マイナンバー)/]);
  add("アカウント・権限の受け渡し", [/(アカウント|ログイン情報|管理画面|権限).{0,10}(共有|発行|お渡し)/]);
  return steps;
}

export const getCapability = (id: Capability): CapabilityDef | undefined => byId.get(id);
