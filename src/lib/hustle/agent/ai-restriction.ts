/**
 * 募集文に書かれた「AIの使用の禁止・制限」を読む。
 *
 * 禁止は一律の見送りにしない（ゆうの指示 2026-10-19: 「使用禁止も理由次第」「俺も一緒にやっている」）。
 * 禁止されている範囲を本文から抜き出して一覧に載せ、その範囲をゆう自身が手でやれるかを人が決める。
 * 禁止された範囲をAIで作って納品する形では受けない・提案文も書かない（契約違反になるため）。
 * 巡回（クラウドワークス・ランサーズ・公開募集）のどれからも、この部品を使う。
 */

import { stripNegatedClauses } from "./negation";

/** 禁止・制限を言っている文の形 */
export const AI_BAN_PATTERNS: RegExp[] = [
  // 「ChatGPTなどの生成AIの使用は禁止です」「AI利用不可」「AIでの作成はご遠慮ください」
  /(?<![A-Za-z])(生成AI|AIツール|AI|ChatGPT|チャットGPT|GPT|Gemini|Claude)(?![a-z])[^。\n]{0,16}(使用|利用|活用|使うこと|使って|生成|作成|執筆|翻訳)[^。\n]{0,10}(禁止(?!しません|していません|ではありません|ではない)|不可|NG|ご遠慮|お控え|控えて|厳禁|お断り|できません|いけません|避けて)/,
  // 「AI禁止」「AIはNG」
  /(?<![A-Za-z])(生成AI|AI|ChatGPT)(?![a-z])(の|は|を)?(使用|利用)?(は|を)?(禁止(?!しません|していません|ではありません|ではない)|不可|NG|厳禁|お断り)/,
  // 「AIで作った文章は受け取れません」「AIのみで作成したものは不採用」
  /(?<![A-Za-z])(生成AI|AI|ChatGPT)(?![a-z])[^。\n]{0,12}(文章|記事|成果物|納品物|原稿|翻訳|のみ|だけ|任せ)[^。\n]{0,10}(受け付け|受け取れ|認め|不可|NG|お断り|ご遠慮|禁止|不採用)/,
  // 「手書き（ご自身）で執筆してください。AIは…」
  /(手書き|自力|ご自身)[^。\n]{0,8}(で|の)[^。\n]{0,6}(執筆|作成)[^。\n]{0,8}(AI)/,
];

/** 禁止が一部の範囲だけ（画像・翻訳・最終稿など）に見える言葉 */
const PART_WORDS = /(画像|イラスト|写真|音声|動画|図|翻訳|校正|校閲|執筆|タイトル|見出し|サムネ|ロゴ|デザイン|コード|プログラム|一部|部分|のみ|だけ|丸ごと|そのまま|コピペ|最終稿)/;

export interface AiRestriction {
  restricted: boolean;
  /** all: 全面的に見える／part: 一部の範囲に見える（推測。必ず抜き出した文を読んで決める） */
  kind: "all" | "part" | null;
  /** 本文から抜き出した、禁止・制限を言っている文（最大3つ・各90字まで） */
  scope: string[];
  /** 一覧に出す1行 */
  summary: string;
}

const NONE: AiRestriction = { restricted: false, kind: null, scope: [], summary: "" };

export function readAiRestriction(text: string): AiRestriction {
  const asked = stripNegatedClauses(text.normalize("NFKC").slice(0, 8000));
  const hits = asked
    .split(/(?<=[。！？!?\n])/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s && AI_BAN_PATTERNS.some((p) => p.test(s)));
  if (hits.length === 0) return NONE;
  const scope = [...new Set(hits)].slice(0, 3).map((s) => (s.length > 90 ? `${s.slice(0, 90)}…` : s));
  const kind = hits.some((s) => PART_WORDS.test(s)) ? "part" : "all";
  return {
    restricted: true,
    kind,
    scope,
    summary: `AI禁止あり（${kind === "all" ? "全面に見えます" : "一部の範囲に見えます"}）: ${scope.map((s) => `「${s}」`).join(" ")}`,
  };
}

/**
 * 禁止・制限を言っている文を本文から外す。「生成AIの使用は禁止です」の「生成AI」が
 * 画像生成の仕事の語として数えられないように、納品物の判定に渡す前に使う。
 */
export function stripAiBanSentences(text: string): string {
  return text
    .split(/(?<=[。！？!?\n])/)
    .filter((s) => !AI_BAN_PATTERNS.some((p) => p.test(s.normalize("NFKC"))))
    .join("");
}
