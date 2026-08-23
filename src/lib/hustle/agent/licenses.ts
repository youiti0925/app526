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
      "本家 VOICEVOX はキャラクターごとに規約が異なります（一部は条件が厳しい）。Nemo 以外を使う場合は、そのキャラクターの規約を個別に確認してください。",
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
