/**
 * 納品物の種類より先に見る4つの関門。
 *
 * ツールの実地調査（30エージェント・規約の条文で確認）から出た結論:
 * 次の4つで落ちる案件は、**どのツールを選んでも無料枠では成立しない**。
 * だから納品物が作れるかを判定する前に、ここで落とす。
 *
 *   1. NDA・機密がある     → 無料枠のAIに投げられない（権利ではなく守秘義務で死ぬ）
 *   2. 権利非侵害の表明保証 → 全ツールが逆に「ユーザーが運営を補償する」条項を持つ
 *   3. 納品形式             → .prproj や .psd を求められると、出力できない
 *   4. クレジット表記が不可 → 無料枠の音声・素材が使えなくなる
 *
 * 調査で確認できた実例:
 * - クラウドワークスの動画編集案件2件が2件とも「Adobe Premiereの
 *   プロジェクトファイルにて」納品を要求していた。ffmpeg が出せるのは mp4 だけ。
 *   どれだけ正確にカットできても応募要件を満たせない。
 * - Gemini API 無料枠は入出力とも学習に使われ、人間のレビュアーが読む。
 *   顧客の未公開資料を投げると、権利侵害ではなく NDA 違反になる。
 * - Midjourney・Descript・Runway・BFL・Google・NovelAI が揃って、
 *   侵害クレームが来たらユーザーが運営を補償する側に回る条項を置いている。
 *   賠償上限は直近12か月の支払額（無料枠なら0円）。
 */

export type GateId =
  | "confidentiality"
  | "warranty"
  | "format"
  | "credit"
  | "personal_data"
  | "restricted_work"
  | "collection_source";

export interface GateHit {
  id: GateId;
  label: string;
  /** 募集文のどこを見てそう判断したか */
  matched: string;
  why: string;
  /** 交渉で外せる可能性があるか */
  negotiable: boolean;
  /** 確認・交渉するときに聞くこと */
  ask: string;
}

interface GateRule {
  id: GateId;
  label: string;
  patterns: RegExp[];
  why: string;
  negotiable: boolean;
  ask: string;
}

/** 私が出力できないファイル形式。ここを求められたら応募しても取れない。 */
const UNPRODUCIBLE_FORMATS =
  /(\.?prproj|premiere.{0,10}プロジェクト|プロジェクトファイル|\.aep|after ?effects.{0,10}プロジェクト|\.psd|photoshop.{0,8}(データ|形式|ファイル)|\.ai\b|illustrator.{0,8}(データ|形式|ファイル)|\.clip\b|クリスタ.{0,6}(データ|ファイル)|\.fig\b|figma.{0,8}(データ|ファイル)|レイヤー.{0,6}(分け|構造).{0,10}(納品|渡)|編集データ.{0,6}(も|込|付))/i;

const GATE_RULES: GateRule[] = [
  {
    id: "confidentiality",
    label: "機密・NDA",
    patterns: [
      /(NDA|秘密保持契約|機密保持契約)/i,
      /(社外秘|機密情報|非公開|未公開).{0,12}(資料|情報|データ|設定|企画)/,
      /(個人情報|マイナンバー|顧客名簿|カルテ|診療|口座情報)/,
      /(取扱い?注意|他言無用|口外.{0,4}禁止)/,
    ],
    why:
      "無料枠の生成AIは、送った内容を学習・製品改善に使います（Gemini API 無料枠は「human reviewers may read, annotate, and process your API input and output」と明記）。顧客から預かった資料を投げると、権利侵害ではなく守秘義務違反になります。有料枠なら学習対象外にできますが、いまは元手がありません。",
    negotiable: false,
    ask: "この案件は、AIを使わず全部あなたが手で作業する前提で工数を見積もり直してください。それでも割に合うかを判断してください。",
  },
  {
    id: "warranty",
    label: "権利非侵害の表明保証",
    patterns: [
      /(第三者|他者|他人).{0,10}(権利|著作権|商標).{0,12}(侵害しな|侵害してい?な)/,
      /(表明|保証).{0,8}(条項|する|していただ)/,
      /(著作権).{0,10}(譲渡|買い取り|買取|全部譲渡)/,
      /(独占|専属).{0,8}(利用|使用|使わない)/,
      /(商標|ロゴ).{0,10}(登録|出願|使用)/,
    ],
    why:
      "生成AIのツールは、侵害クレームが来たら逆に**ユーザーが運営を補償する**条項を置いています（Midjourney・Descript・Runway・Google・NovelAI で確認）。賠償上限は直近12か月の支払額なので、無料枠なら0円です。さらに独占性は誰も売っていません（Google「Google may generate the same or similar content for others」、Runway「OUTPUTS MAY NOT BE UNIQUE」）。「他所で使われない」と約束すると履行不能になります。",
    negotiable: true,
    ask:
      "生成AIを使う旨を先に伝え、独占的利用と第三者権利の表明保証を外してもらえるか確認してください。外せないなら、AI生成物を最終稿にせず、自分の手で作り直す前提で工数を見積もってください。",
  },
  {
    id: "format",
    label: "出力できない納品形式",
    patterns: [UNPRODUCIBLE_FORMATS],
    why:
      "Premiere のプロジェクトファイル（.prproj）や Photoshop の .psd は、こちらのツールでは出力できません。完成した mp4 や png は作れても、応募要件を満たしません。発注側がプロジェクトファイルを求めるのは、修正を自分で当てたい・編集者を替えても資産を残したいという運用上の理由なので、価格交渉では覆りません。",
    negotiable: true,
    ask: "完成データ（mp4 / png / PDF）での納品で足りるか確認してください。ダメなら、この案件は取れません。",
  },
  {
    id: "credit",
    label: "クレジット表記が出せない",
    patterns: [
      /(クレジット|表記|ロゴ|透かし|ウォーターマーク).{0,12}(不可|なし|禁止|入れないで|消して|外して)/,
      /(自社|弊社|当社).{0,8}(名義|オリジナル).{0,10}(として|で).{0,8}(公開|使用|納品)/,
      /(制作者|作成者).{0,8}(非公開|伏せ|出さない)/,
    ],
    why:
      "無料で商用に使える手段の一部は、クレジット表記が条件です（VOICEVOX Nemo は「クレジット表記無しでの利用」を禁止事項に明記）。表記できないなら、その手段は使えません。透かしを消す行為自体も、各サービスの規約で禁止されています。",
    negotiable: true,
    ask:
      "音声や素材にクレジット1行を入れてよいか確認してください。不可なら、その工程は手作業になるか、有料ライセンスが必要になります。",
  },
  {
    id: "personal_data",
    label: "個人の連絡先を集める仕事",
    patterns: [
      /(個人|顧客|会員|見込み客|インフルエンサー|フォロワー)[^。\n]{0,12}(氏名|名前|メール|電話番号|連絡先|住所|アカウント)[^。\n]{0,15}(収集|リスト|抽出|取得|入力|まとめ|集め)/,
      /(経営者|代表者|担当者)[^。\n]{0,8}(の)?(メール|電話|LINE|連絡先)[^。\n]{0,12}(収集|リスト|抽出|取得|集め)/,
      /(名簿|リードリスト|営業リスト)[^。\n]{0,10}(作成|収集|販売|購入)/,
    ],
    why:
      "特定の個人の氏名・連絡先を集めてリストにして渡す仕事は、個人情報保護法の適用を受けます。本人の同意なく収集した個人データの第三者提供は原則できず、名簿屋の届出（オプトアウト）の話になります。会社名・代表電話・住所のような法人情報のリストは問題ありません。",
    negotiable: false,
    ask: "対象が法人の公開情報（会社名・住所・代表電話・URL）だけなら受けられます。個人の連絡先が含まれるなら断ってください。",
  },
  {
    id: "restricted_work",
    label: "士業の独占業務",
    patterns: [
      /(確定申告|税務申告|税務書類)[^。\n]{0,12}(作成|代行|お願い|依頼)/,
      /(譲渡損益|損益)[^。\n]{0,6}(の)?(計算|集計)[^。\n]{0,12}(代行|お願い|依頼|担当|募集)/,
      /(補助金|助成金)[^。\n]{0,10}(申請|書類)[^。\n]{0,10}(作成|代行|支援)/,
      /(登記|定款|ビザ|在留資格)[^。\n]{0,8}(申請|作成|代行|手続)/,
    ],
    why:
      "税務書類の作成・税務相談は税理士（税理士法52条）、官公署に出す書類の作成は行政書士、助成金申請は社会保険労務士の独占業務です。補助金申請書類の有償作成代行は1年以下の拘禁刑または100万円以下の罰金です。単なる計算の手伝いに見えても、申告のための集計は独占業務に踏み込むおそれがあります。迷ったら受けません。",
    negotiable: false,
    ask: "この案件は受けられません。資格者に依頼するよう先方に伝えるのが正しい対応です。",
  },
  {
    id: "collection_source",
    label: "収集元の規約確認が要る",
    patterns: [
      /(Instagram|インスタ|Twitter|X（旧Twitter）|Amazon|楽天市場|食べログ|ぐるなび|ホットペッパー|Booking\.?com|じゃらん|Indeed|リクナビ|マイナビ|Googleマップ|グーグルマップ|メルカリ|ヤフオク|LinkedIn|広告ライブラリ|透明性センター)[^。\n]{0,25}(収集|抽出|取得|転記|リスト(アップ|化)?|スクレイピング|情報を集め|調べて|検索して)/,
    ],
    why:
      "リスト作成の収集元として指定されがちなサイトの多くは、利用規約で自動取得（スクレイピング）を禁止しています。この案件を自動で処理すると収集元の規約違反になり、手作業でやると採算が崩れます。受ける前に、収集元の robots.txt と利用規約を確認する必要があります。",
    negotiable: true,
    ask: "収集元の利用規約が自動取得を許しているかを確認してください。禁止されているなら、公式API・公開データセットで代替できるか、それとも見送るかを判断してください。",
  },
];

export interface GateResult {
  /** 通ったか */
  passed: boolean;
  hits: GateHit[];
  /** 交渉すれば通る可能性があるか */
  negotiable: boolean;
  /** 人が読む1〜2行 */
  note: string;
}

/**
 * 4つの関門を通すかどうか。
 *
 * ここで落ちたものは reject ではなく「確認が要る」に寄せる場合がある。
 * 納品形式もクレジットも、聞けば変わることがあるため。
 * 機密・NDA だけは交渉で変わらないので、無料枠では受けない前提にする。
 */
export function checkGates(text: string): GateResult {
  const t = text.normalize("NFKC").slice(0, 8000);
  const hits: GateHit[] = [];

  for (const rule of GATE_RULES) {
    for (const p of rule.patterns) {
      const m = t.match(p);
      if (!m) continue;
      hits.push({
        id: rule.id,
        label: rule.label,
        matched: m[0].slice(0, 60),
        why: rule.why,
        negotiable: rule.negotiable,
        ask: rule.ask,
      });
      break;
    }
  }

  if (hits.length === 0) {
    return { passed: true, hits: [], negotiable: false, note: "" };
  }

  const blocking = hits.filter((h) => !h.negotiable);
  const negotiable = hits.every((h) => h.negotiable);

  return {
    passed: false,
    hits,
    negotiable,
    note: blocking.length
      ? `${blocking.map((h) => h.label).join("・")} があります。交渉では外せないので、無料枠のAIを使う前提では受けられません。`
      : `${hits.map((h) => h.label).join("・")} があります。応募前に確認すれば通る可能性があります。`,
  };
}

/** 確認事項を1本の文面にする。承認キューに出す。 */
export function renderGateQuestions(result: GateResult, title: string): string {
  if (result.hits.length === 0) return "";

  const lines = [
    `# 応募前に確認すること: ${title}`,
    "",
    "この案件には、AIで作業する前提だと引っかかる条件があります。",
    "先に確認しないと、受注してから作れないことが分かります。",
    "",
  ];

  for (const h of result.hits) {
    lines.push(`## ${h.label}${h.negotiable ? "" : "（交渉では外せません）"}`);
    lines.push("");
    lines.push(`募集文の該当箇所: 「${h.matched}」`);
    lines.push("");
    lines.push(h.why);
    lines.push("");
    lines.push(`**${h.ask}**`);
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push(
    "確認の結果、条件が外れたらこの案件を「新規」に戻して再判定させてください。外れないなら見送ってください。"
  );

  return lines.join("\n");
}
