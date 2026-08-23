/**
 * 使うツールのライセンス条件。**一次情報（規約の条文）で確認したものだけ**を置く。
 *
 * なぜ分けるか:
 * 「そのツールで作ったものを、お金をもらって納品してよいか」は、
 * 成果物の出来とは別の話で、しかもこちらのほうが致命的。
 * 出来が良くても規約違反なら、納品した時点で問題になる。
 *
 * ここに書いてよいのは、規約・ライセンスの条文を実際に読んで確認したものだけ。
 * 「たぶん大丈夫」は unverified に置く。確認できていないものを
 * 「使える」側に入れると、後で全部やり直しになる。
 */

export type CommercialUse =
  | "ok" // 商用利用できる
  | "ok_with_credit" // クレジット表記をすれば商用利用できる
  | "restricted" // 条件つき。条件を満たさないと使えない
  | "forbidden" // 商用利用できない
  | "unverified"; // 規約を確認できていない

export const COMMERCIAL_LABELS: Record<CommercialUse, string> = {
  ok: "商用OK",
  ok_with_credit: "商用OK（クレジット表記が必要）",
  restricted: "条件つき",
  forbidden: "商用不可",
  unverified: "未確認",
};

export interface ToolLicense {
  id: string;
  name: string;
  /** 何を作るのに使うか */
  makes: string;
  commercial: CommercialUse;
  /** 費用。0 なら無料。 */
  costJpy: number;
  /** 根拠にした条文。要約ではなく、できるだけ原文。 */
  quote: string;
  sourceUrl: string;
  /** 確認した日 */
  checkedOn: string;
  /** 使う前に守ること */
  obligations: string[];
  /** 誤解しやすい点 */
  note: string;
}

export const TOOL_LICENSES: ToolLicense[] = [
  {
    id: "nite_ghs_integrated",
    name: "NITE統合版GHS分類結果（xlsx）",
    makes: "SDSのGHS区分。CAS番号で引く照合テーブル。約3,378物質・35危険有害性クラス。",
    commercial: "restricted",
    costJpy: 0,
    quote:
      "本分類結果は、GHSに基づくラベルやSDSを作成する際に自由に引用又は複写していただけます。" +
      "ただし、…責任は、ラベルやSDSの作成者にあることにご留意ください。",
    sourceUrl: "https://www.chem-info.nite.go.jp/chem/ghs/ghs_download.html",
    checkedOn: "2026-08-23",
    obligations: [
      "許諾の範囲は「ラベル・SDSの作成」に紐づく。無条件のオープンデータではないので、別用途に流用しない",
      "SDSの内容についての責任は作成者にある（法律上、委譲できない）",
      "版（更新日）を成果物に残す。統合版は政府分類結果より遅れることがある（令和7年度141CASのうち57件が統合版に未収載だった）",
    ],
    note:
      "旧URL（www.nite.go.jp/chem/ghs/）は404。現行は chem-info.nite.go.jp。" +
      "同一物質が年度ごとに複数行ある list_all.xlsx ではなく、名寄せ済みの統合版を照合キーに使うこと。",
  },
  {
    id: "nite_chrip_laws",
    name: "NITE-CHRIP 法規制リスト（安衛法・化管法・消防法ほか）",
    makes: "法令該当性の判定。CAS番号で引く。群名は個別CASへ展開済み、裾切値つき。",
    commercial: "ok",
    costJpy: 0,
    quote:
      "複製、公衆送信、翻訳・変形等の翻案等、自由に利用できます。商用利用も可能です。",
    sourceUrl: "https://www.chem-info.nite.go.jp/chem/chrip/chrip_search/html/condUse.html",
    checkedOn: "2026-08-23",
    obligations: [
      "出典を記載する。改変したときはその旨を明示する",
      "配布されている xlsx を使う。全件スクレイピングはしない（利用条件に通信量による利用中止の定めがある）",
      "法規制の該当性を最終判断するときは、所管官庁または化学物質管理センターに確認する旨を成果物に書く（CHRIP自身の免責）",
      "安衛法は適用日が毎年動く。リストの版を成果物に残す",
    ],
    note:
      "「水銀及びその化合物」のような群名を個別CASへ展開済み（化管法901政令番号→10,855CAS、安衛法2,505→7,061CAS）。" +
      "手作業で一番時間を食う部分が提供元で解決されている。",
  },
  {
    id: "cas_registry_numbers",
    name: "CAS登録番号",
    makes: "（データそのものではなく）照合キーとして使う番号",
    commercial: "restricted",
    costJpy: 0,
    quote:
      "CAS登録番号は…Chemical Abstracts Service (CAS) の知的財産であり…" +
      "CASの事前許可なくCAS登録番号を再配布することは禁じられています。",
    sourceUrl: "https://www.chem-info.nite.go.jp/chem/chrip/chrip_search/html/condUse.html",
    checkedOn: "2026-08-23",
    obligations: [
      "CAS番号を含むデータセットをこのリポジトリに同梱しない。実行時にNITEから取得してローカルに置く",
      "CAS番号を含むデータを商品として配布しない。内部の照合キーとして使うのは別問題",
      "納品するSDSにCAS番号が載るのは通常の用途（SDSの記載事項）だが、DBそのものの配布とは分けて考える",
    ],
    note:
      "「照合に使う」と「番号入りのDBを配る」は別。前者は問題にならないが、後者は事前許可が要る。" +
      "このアプリがデータを同梱せず実行時に取りに行く設計にしているのはこのため。",
  },
  {
    id: "mhlw_model_sds",
    name: "厚労省 職場のあんぜんサイト モデルSDS",
    makes: "SDSの記載例。3,622物質。",
    commercial: "forbidden",
    costJpy: 0,
    quote: "内容をそのままダウンロードして営利目的に使用することはお断り致します。",
    sourceUrl: "https://anzeninfo.mhlw.go.jp/anzen/gmsds/50-00-0.html",
    checkedOn: "2026-08-23",
    obligations: ["有償のSDS作成には使わない。同じ情報はNITE-CHRIP側から取れるので、そちらを使う"],
    note:
      "第15項に法令該当性が15法令ぶん集約されていて便利だが、営利目的での使用が明示的に断られている。" +
      "一括取得の口も無い（個別ページのみ）。CHRIPのxlsxで代替すること。",
  },
  {
    id: "nite_gmiccs",
    name: "NITE-Gmiccs（GHS混合物分類判定システム）",
    makes: "混合物のGHS区分。健康有害性・環境有害性の計算。",
    commercial: "unverified",
    costJpy: 0,
    quote:
      "本システムの主な対象は、健康有害性と環境有害性です。" +
      "物理化学的危険性については基本的に分類できません。",
    sourceUrl: "https://www.ghs.nite.go.jp/",
    checkedOn: "2026-08-23",
    obligations: [
      "商用利用の可否が明示されていない。有償の受託に使う前に問い合わせること",
      "混合物の物理化学的危険性は出せない。引火性液体だけは引火点・初留点から算出できる",
      "つなぎの原則（希釈・同一バッチ・濃縮・内挿）は非対応。ここは人の判断",
    ],
    note:
      "無料・登録不要・CSV入出力あり。分類アルゴリズムの仕様書が公開されており" +
      "（ATE加算式・濃度限界表）、自前で実装することもできる。" +
      "ただし公開仕様書は改訂6版/JIS 2019ベースで、改訂9版/JIS 2025のロジックは未確認。",
  },
  {
    id: "ffmpeg",
    name: "FFmpeg",
    makes: "動画・音声の変換、カット、テロップ焼き込み、BGM合成",
    commercial: "ok",
    costJpy: 0,
    quote:
      "「copyright law does not give you any say in the use of the output people make from their data using your program.（中略）when a program translates its input into some other form, the copyright status of the output inherits that of the input it was generated from.」（GNU GPL FAQ #GPLOutput）",
    sourceUrl: "https://www.gnu.org/licenses/gpl-faq.html#GPLOutput",
    checkedOn: "2026-08-23",
    obligations: [],
    note:
      "FFmpeg 本体は LGPL-2.1+（一部 GPL-2.0+）ですが、その義務が生じるのは **FFmpeg 自体を配布するとき**（ライブラリにリンクした自作アプリを配る等）です。FFmpeg で変換した動画を納品する行為には義務がありません。ffmpeg.org のコンプライアンス手順も「when linking against the FFmpeg libraries」と、リンクして配布する場合の話として書かれています。",
  },
  {
    id: "voicevox_nemo",
    name: "VOICEVOX Nemo",
    makes: "ナレーション（音声合成）",
    commercial: "ok_with_credit",
    costJpy: 0,
    quote:
      "「VOICEVOX Nemo を用いて制作された音声は、クレジットを表記すれば商用・非商用問わずご利用いただけます。」／禁止事項に「クレジット表記無しでの利用」",
    sourceUrl: "https://voicevox.hiroshiba.jp/nemo/term/",
    checkedOn: "2026-08-23",
    obligations: [
      "成果物にクレジットを表記する（表記無しは禁止事項に明記されている）",
      "納品前に、依頼者がクレジット表記を受け入れるか確認する",
    ],
    note:
      "**Nemo を使ってください。** 本家 VOICEVOX はキャラクターごとに規約が違います。No.7 とユーレイちゃんは一般商用不可、もち子さんは音声作品・音声素材・ゲーム作品が対象外、ぞん子は商用なら個別問い合わせ、Voidoll は法人利用なら問い合わせ、青山龍星・後鬼は企業が関わる形なら事前確認が要ります。Nemo ならクレジット1行だけで済み、この分岐に悩まされません。",
  },
  {
    id: "flux_dev",
    name: "FLUX.1 [dev]（ローカル実行）",
    makes: "画像生成",
    commercial: "forbidden",
    costJpy: 0,
    quote:
      "§2(b) Non-Commercial Use Only: 「You may only access, use, Distribute, or create Derivatives of the FLUX.1 [dev] Model or Derivatives for Non-Commercial Purposes.」（FLUX.1 [dev] Non-Commercial License v1.1.1）",
    sourceUrl: "https://huggingface.co/black-forest-labs/FLUX.1-dev",
    checkedOn: "2026-08-23",
    obligations: [],
    note:
      "ローカルで動かしても同じです。作った画像を有償の受託で納品すると、無償ライセンスの範囲外になります。「自分のPCで動かしているから自由」は成り立ちません。",
  },
  {
    id: "gemini_free",
    name: "Gemini API 無料枠 / Google AI Studio",
    makes: "文章・コードの生成、判定",
    commercial: "restricted",
    costJpy: 0,
    quote:
      "「When you use Unpaid Services, including, for example, Google AI Studio and the unpaid quota on Gemini API, Google uses the content you submit to the Services and any generated responses to provide, improve, and develop Google products and services and machine learning technologies.」（Gemini API Additional Terms of Service）",
    sourceUrl: "https://ai.google.dev/gemini-api/terms",
    checkedOn: "2026-08-23",
    obligations: [
      "依頼者の機密情報・個人情報・未公開資料は送らない",
      "NDA を結んでいる案件では使わない",
    ],
    note:
      "**商用利用そのものは禁止されていません。** 生成物の権利も Google に留保されません（「Google won't claim ownership over that content」）。問題は、無料枠では送った内容が製品改善に使われることです。だから公開情報の処理には使えますが、顧客から預かった資料には使えません。ここを取り違えて「商用禁止」と覚えないでください。",
  },
  {
    id: "sdxl_local",
    name: "Stable Diffusion XL / 1.5（ローカル実行）",
    makes: "画像生成",
    commercial: "ok",
    costJpy: 0,
    quote:
      "「Licensor claims no rights in the Output You generate using the Model.」（CreativeML Open RAIL++-M License）",
    sourceUrl: "https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0",
    checkedOn: "2026-08-23",
    obligations: [
      "他人が配布している LoRA を足すなら、その LoRA 側の配布条件を1件ずつ確認する（ベースが商用可でも LoRA が非商用のことが多い）",
      "既存キャラ・特定作家の画風に似ていないか目視で確認する（侵害の責任は利用者側）",
    ],
    note:
      "売上の閾値も登録義務も帰属表示も無く、調査した画像生成の中で制約が最も少ない。ただし GPU が要ります。無ければ ChatGPT 無料枠の gpt-image が次点。",
  },
  {
    id: "gpt_image_free",
    name: "DALL·E / gpt-image（ChatGPT 無料枠）",
    makes: "画像生成",
    commercial: "ok",
    costJpy: 0,
    quote:
      "「you own the Output. We hereby assign to you all our right, title, and interest」／ヘルプが「regardless of whether an image was generated through a free or paid credit」と無料・有料の区別を明示的に否定",
    sourceUrl: "https://openai.com/policies/terms-of-use",
    checkedOn: "2026-08-23",
    obligations: [
      "「他所では使われない」と約束しない（同様の出力が他の利用者にも生成されうると明記されている）",
    ],
    note: "無料枠と有料枠で権利の扱いが変わらないことを、運営が名指しで否定しています。GPUが無い場合の第一候補。",
  },
  {
    id: "leonardo_free",
    name: "Leonardo.Ai（無料プラン）",
    makes: "画像生成",
    commercial: "forbidden",
    costJpy: 0,
    quote:
      "§8.7「ownership of all Intellectual Property Rights in any Output you ... create while using the Platform will vest in us upon creation」",
    sourceUrl: "https://leonardo.ai/terms-of-service/",
    checkedOn: "2026-08-23",
    obligations: [],
    note:
      "生成した瞬間に権利が運営に移ります。納品すると、自分が持っていない権利を渡すことになります。調査で見つかった中で最も危険な条項でした。",
  },
  {
    id: "opusclip_free",
    name: "Opus Clip（無料プラン）",
    makes: "縦型ショート動画の切り抜き",
    commercial: "forbidden",
    costJpy: 0,
    quote:
      "「You will only use the Services for your own internal, personal, non-commercial use, and not on behalf of or for the benefit of any third party」",
    sourceUrl: "https://www.opus.pro/terms",
    checkedOn: "2026-08-23",
    obligations: [],
    note:
      "クライアントワークは「非商用違反」と「第三者の利益のための利用」の二重で規約違反になります。同じことは ffmpeg で無料・無制限にできます。",
  },
  {
    id: "runway_free",
    name: "Runway（無料プラン）",
    makes: "動画生成・編集",
    commercial: "forbidden",
    costJpy: 0,
    quote:
      "「All videos generated on a Free plan feature a Runway watermark.」／§4.1 が proprietary rights notices の改変を禁止",
    sourceUrl: "https://runwayml.com/terms-of-use",
    checkedOn: "2026-08-23",
    obligations: [],
    note:
      "透かしが入り、その除去は規約違反です。透かし入りのまま納品するしかない＝実質使えません。",
  },
  {
    id: "elevenlabs_free",
    name: "ElevenLabs（無料プラン）",
    makes: "音声合成",
    commercial: "forbidden",
    costJpy: 0,
    quote:
      "「if you access or use our Services free of charge (such a user, a Free User), you may only use the Services for non-commercial purposes」",
    sourceUrl: "https://elevenlabs.io/terms-of-use",
    checkedOn: "2026-08-23",
    obligations: [],
    note: "無料枠は非商用に明文で限定されています。VOICEVOX Nemo を使ってください。",
  },
  {
    id: "gcloud_tts",
    name: "Google Cloud Text-to-Speech",
    makes: "ナレーション（音声合成）",
    // 規約の条文を読んでいないので unverified。元手ゼロの前提では使わないため、
    // 確認を後回しにした。使うことになったら先に規約を読むこと。
    commercial: "unverified",
    costJpy: -1,
    quote:
      "未確認。Google Cloud の利用規約・Service Specific Terms を読んでいません。「商用利用できるはず」という一般的な理解だけで、条文を当てていません。",
    sourceUrl: "https://cloud.google.com/text-to-speech/terms",
    checkedOn: "2026-08-23",
    obligations: ["使う前に利用規約を読む（まだ読んでいない）", "課金が発生するので、単価に織り込む"],
    note: "元手ゼロの前提では選べません。VOICEVOX Nemo を先に検討してください。",
  },
];

const byId = new Map(TOOL_LICENSES.map((l) => [l.id, l]));

export const getLicense = (id: string): ToolLicense | undefined => byId.get(id);

/** 追加費用なしで、商用の納品に使えるツール。 */
export const freeCommercialTools = (): ToolLicense[] =>
  TOOL_LICENSES.filter(
    (l) => l.costJpy === 0 && (l.commercial === "ok" || l.commercial === "ok_with_credit")
  );

/**
 * このツールを使ったときに、納品前に人がやらなければならないこと。
 * 空なら、そのまま納品してよい。
 */
export function obligationsFor(toolIds: string[]): string[] {
  const out: string[] = [];
  for (const id of toolIds) {
    const license = byId.get(id);
    if (!license) {
      out.push(`${id}: ライセンスを確認していません。使う前に規約を読んでください。`);
      continue;
    }
    for (const o of license.obligations) out.push(`${license.name}: ${o}`);
  }
  return out;
}

/**
 * 商用の納品に使ってはいけないツール。
 *
 * forbidden だけでなく unverified も弾く。「たぶん大丈夫」で通すのが
 * このファイルを作った理由そのものなので、確認していないものは使わない。
 * restricted は弾かない（条件を守れば使えるため）。条件は obligationsFor が出す。
 */
export function blockedTools(toolIds: string[]): { id: string; why: string }[] {
  return toolIds
    .map((id) => {
      const license = byId.get(id);
      if (!license) return { id, why: "ライセンスを確認していないので、納品には使えません" };
      if (license.commercial === "forbidden") return { id, why: license.quote };
      if (license.commercial === "unverified") {
        return { id, why: `規約を確認していません。${license.quote}` };
      }
      return null;
    })
    .filter((x): x is { id: string; why: string } => x !== null);
}
