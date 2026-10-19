/**
 * クラウドワークスの検索画面の登録（cw-patrol.mjs add-keyword から使う）。通信しない部分。
 *
 * 巡回の対象は Excel/VBA・品質に絞らない。Claude が作業して納品できる仕事は全部見る
 * （2026-10-19 方針。納品できるかの判定は judgeDeliverability と関門が行う）。
 * ここは「どの言葉で探すか」の一覧と、検索画面のURLの作り方だけ。
 */

/** 探す言葉。Claude が作業して納品できる仕事の種類ごと。空白は「かつ」。 */
export const WIDE_KEYWORDS = [
  { group: "文章・ライティング", words: ["記事作成", "ブログ記事", "SEO 記事", "商品説明文", "校正 校閲", "リライト", "コラム 執筆"] },
  { group: "文字起こし・要約・議事録", words: ["文字起こし", "議事録", "要約"] },
  { group: "翻訳", words: ["英語 翻訳", "英日 翻訳"] },
  { group: "データ・調査", words: ["リスト作成", "リサーチ", "情報収集", "データ整形"] },
  { group: "資料作成", words: ["パワーポイント", "資料作成", "スライド"] },
  { group: "Web制作", words: ["LP制作", "ホームページ制作", "WordPress"] },
  { group: "プログラミング・自動化", words: ["Python", "GAS", "スクレイピング", "ツール開発", "自動化"] },
  { group: "マニュアル・手順書", words: ["マニュアル作成", "手順書"] },
  { group: "Excel・スプレッドシート", words: ["Excel", "VBA", "スプレッドシート"] },
];

export const WIDE_WORD_LIST = WIDE_KEYWORDS.flatMap((g) => g.words);

/** 登録が無いときに使う検索画面の形（新着順・募集中のみ） */
const DEFAULT_TEMPLATE = "https://crowdworks.jp/public/jobs/search?hide_expired=true&order=new&search%5Bkeywords%5D=";

/**
 * 言葉から検索画面のURLを作る。すでに登録してある検索画面（本物の画面のURL）があれば、
 * その形（並び順など）を借りて、言葉の所だけ差し替える。なければ既定の形を使う。
 */
export function searchUrlFrom(templates, keyword) {
  const word = String(keyword).trim();
  if (!word) throw new Error("言葉が空です");
  for (const t of templates ?? []) {
    let u;
    try {
      u = new URL(t);
    } catch {
      continue;
    }
    if (u.hostname !== "crowdworks.jp") continue;
    const key = [...u.searchParams.keys()].find((k) => /keywords?\]?$/.test(k));
    if (!key) continue;
    u.searchParams.set(key, word);
    // 新着順にする（ほかの並び順で登録されていても、巡回は新着を見る）
    u.searchParams.set("order", "new");
    // 2ページ目以降を借りてしまわない
    u.searchParams.delete("page");
    return u.toString();
  }
  const base = new URL(DEFAULT_TEMPLATE + encodeURIComponent(word));
  return base.toString();
}

/** 検索画面のURLから、探している言葉を取り出す（無ければ null） */
export function keywordOf(url) {
  try {
    const u = new URL(url);
    const key = [...u.searchParams.keys()].find((k) => /keywords?\]?$/.test(k));
    return key ? u.searchParams.get(key) : null;
  } catch {
    return null;
  }
}

/**
 * 検索画面を回す順番を、巡回ごとにずらす。
 * 毎回同じ並びだと、前のほうの検索に新着が出続けて、後ろの検索が読まれないまま残る。
 */
export function rotate(list, step) {
  if (!list.length) return list;
  const k = ((step % list.length) + list.length) % list.length;
  return [...list.slice(k), ...list.slice(0, k)];
}
