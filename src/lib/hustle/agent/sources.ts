import { extractBudget, fingerprint } from "./ingest";
import type { Lead } from "./types";

/**
 * 案件の自動収集。
 *
 * ここに実装してよいのは、サイトマップやAPIで「機械が読むことを想定して」
 * 公開されている経路だけ。robots.txt で拒否されている取得、WAFで弾かれる取得、
 * 規約が自動アクセスを禁じている取得は実装しない。
 *
 * 節度について:
 * 相手のサーバーに負荷をかけないよう、1回の実行で取りに行く件数に上限を置き、
 * 前回以降に更新されたものだけを対象にし、1件ごとに間隔を空ける。
 * 詳細ページを全件舐めるようなことはしない。
 */

const UA = "hustle-pipeline/1.0 (personal side-job assistant; low-rate, sitemap-driven)";

export interface SourceDefinition {
  id: string;
  name: string;
  /** サイトマップのURL。索引なら子を辿る。 */
  sitemapUrl: string;
  /** 索引サイトマップか */
  isIndex: boolean;
  /** 案件ページのURLの形 */
  detailPattern: RegExp;
  /** 何が取れるか、規約上の注意 */
  note: string;
  /** 既定で有効にするか。規約が灰色のものは既定オフ。 */
  defaultEnabled: boolean;
  /**
   * 差分の取り方。
   * lastmod: サイトマップの更新日時で絞る（軽い）
   * seen:    更新日時が無いサイト向け。取り込み済みIDで絞る（サイトマップは毎回全部読む）
   */
  trackBy: "lastmod" | "seen";
}

/**
 * 既定のオン・オフは、実際に取り込んだ結果で決めている。
 *
 * 44件を取り込んで契約形態を数えた結果:
 *   ギークスジョブ      16件 → 全部 月額（準委任の要員募集）
 *   ITプロパートナーズ  16件 → 全部 月額（準委任の要員募集）
 *   ココナラ 公開依頼   10件 → 9件が 請負（1件いくらの納品案件）
 *
 * 月額の要員募集は、月140〜160時間の常駐が前提です。
 * 週10時間しか出せない人には、時給が良くても成立しません
 * （engagement.ts の checkCapacity が全部落とします）。
 * つまり前2つは、取りに行っても1件も応募できないものを
 * 相手のサーバーに負荷をかけて集めていたことになります。
 *
 * なので、請負が取れるものを既定オン、月額の要員募集を既定オフにしました。
 * 稼働時間が増えたら、設定画面で前2つを有効にしてください。
 */
export const SOURCES: SourceDefinition[] = [
  {
    id: "geechs",
    name: "ギークスジョブ",
    sitemapUrl: "https://geechs-job.com/sitemap.xml",
    isIndex: false,
    detailPattern: /\/project\/details\/\d+$/,
    trackBy: "lastmod",
    note:
      "フリーランスのIT案件が約10,100件。全件に更新日時が入っているので新着だけを拾えます。robots.txt は取得を禁止していません。本文はJSON-LDで取れます。取り込んだ16件は全部が月額の準委任（常駐・週5日前提）でした。週の稼働が20時間を超えてから有効にしてください。",
    defaultEnabled: false,
  },
  {
    id: "itpropartners",
    name: "ITプロパートナーズ",
    sitemapUrl: "https://itpropartners.com/sitemap.xml",
    isIndex: false,
    detailPattern: /\/job\/detail\/\d+$/,
    trackBy: "seen",
    note:
      "「週2日から」と書かれた業務委託案件が約3,000件。ただし取り込んだ16件は全部が月額の準委任で、週2日でも月60時間前後が必要でした。更新日時がサイトマップに無いので、取り込み済みかどうかで差分を取ります。週の稼働が15時間を超えてから有効にしてください。",
    defaultEnabled: false,
  },
  {
    id: "mamaworks",
    name: "ままワークス",
    sitemapUrl: "https://mamaworks.jp/sitemap-jobs.xml",
    isIndex: false,
    detailPattern: /\/job\/\d+$/,
    trackBy: "seen",
    note:
      "在宅ワーク特化。sitemap に案件975件（2026-08-24 実測）。1件いくらの請負（案件単価制・文字単価制）と" +
      "時給のパート求人が混在するので、契約形態の判定（engagement.ts）が働く前提で使う。" +
      "robots.txt はクエリ付き一覧を禁止・sitemap 経由を許可しているので、必ず sitemap から辿る。" +
      "規約に自動アクセス禁止条項なし。応募人数は非公開。" +
      "curl 系クライアントを弾く WAF があるが、このアプリの fetch は通ることを実測済み。",
    defaultEnabled: true,
  },
  {
    id: "cw_tech",
    name: "クラウドワークス テック",
    sitemapUrl: "https://tech.crowdworks.jp/job_opened.xml",
    isIndex: false,
    detailPattern: /\/job_offers\/\d+/,
    trackBy: "seen",
    note:
      "募集中の案件だけのサイトマップ（job_opened.xml、実測695件）を提供している唯一のサイト。robots.txt 全面許可。" +
      "ただし全件が月額の準委任（週4〜5日）なので、週の稼働が20時間を超えるまでは有効にしないこと。" +
      "親サイト crowdworks.jp は ClaudeBot 拒否だが、このホストは別（2026-08-24 確認）。",
    defaultEnabled: false,
  },
  {
    id: "coconala",
    name: "ココナラ 公開依頼",
    sitemapUrl: "https://coconala.com/sitemaps/category-requests-index.xml",
    isIndex: true,
    detailPattern: /\/requests\/\d+$/,
    trackBy: "lastmod",
    note:
      "公開依頼が約230件。1件いくらの請負が中心で、取り込んだ10件のうち9件が請負でした。いま唯一、週10時間で受けられる案件が取れるソースです。以前ここに「イラスト・動画編集はAIでは作れないので期待するな」と書いていましたが、それは調べる前の思い込みでした（画像生成・ffmpeg・VOICEVOX の利用条件を確認した結果、仕様が決まっているものは作れます。licenses.ts を参照）。件数が少ないので負荷も小さいです。",
    defaultEnabled: true,
  },
];

/**
 * 調べたが使えなかったサイト。同じ検証を繰り返さないために残す。
 * ここに書いてあるものは、コネクタとして実装しない。
 */
export const REJECTED_SOURCES: { name: string; why: string }[] = [
  {
    name: "ランサーズ",
    why:
      "【2026-08-24 再調査で理由を訂正】robots.txt は ClaudeBot を名指しで許可（Crawl-delay: 5）しており、" +
      "請負案件が主体で、提案数（応募人数）も公開している——条件が揃う唯一のサイト。" +
      "しかしWAFが未知のUAを405で弾き、このアプリのUAでは robots.txt すら取れない。" +
      "ClaudeBot を名乗れば通るが、このアプリは Anthropic のクローラではないので、それはUA偽装。やらない。" +
      "**手動で見る・応募するぶんには何の問題もない**ので、人が使う先としては最有力。",
  },
  {
    name: "クラウドワークス",
    why: "robots.txt が ClaudeBot / GPTBot を名指しで Disallow: /（「AI学習用クローラーのクロールを拒否」とコメント付き）。ただし子サービスの tech.crowdworks.jp は全面許可で、ホスト単位で真逆。ドメインごとに必ず取り直すこと。",
  },
  {
    name: "Offers",
    why:
      "robots.txt は「LLMO optimization」とコメント付きで ClaudeBot を歓迎しているのに、" +
      "利用規約第20条(16)が「スクレイピング、クローリングその他ロボット、プログラム等のデータ収集」を明示禁止。" +
      "矛盾しているが、規約を優先して使わない。稼働70〜80h/月の低稼働案件があるので、手動なら見る価値あり。",
  },
  {
    name: "SOKUDAN",
    why:
      "sitemapあり・完全SSR・「1案件あたり月額10〜15万円／週7〜8h」という週10時間で受けられる形が実在する、内容的には最有力。" +
      "しかし規約の禁止行為に「スクレイピング、クローリング…により…本サービスに関する情報を取得する行為」とあり、" +
      "案件情報まで含む読み方ができる。迷ったら禁止側。運営に確認が取れたら解禁する。",
  },
  {
    name: "Wantedly",
    why: "robots.txt に ClaudeBot の記載は無い（＝許可）のに、WAFが ClaudeBot UA を403で弾く。robots.txt だけ見ると誤る例。偽装しないので使わない。",
  },
  {
    name: "YOUTRUST",
    why: "規約が「ロボット、クローラー、スクレイパーその他の自動的手段」を明示禁止。かつ案件本文がSPAでHTMLに無い。",
  },
  {
    name: "レバテックフリーランス",
    why: "curl では取れるのに、プログラム（Node の fetch）からは全ページ HTTP 403。WAF がクライアントを見て弾いています。ブラウザのふりをすれば通る可能性はありますが、それは回避なのでしません。",
  },
  {
    name: "SKIMA / ストアカ / Green",
    why: "robots.txt で AI クローラを名指し拒否。",
  },
  {
    name: "クラウディア",
    why: "サイトマップは取れますが、中身の8,233件が出品者プロフィールで、案件ページはほぼありません。",
  },
  {
    name: "lotsful / Anycrew / テックビズ",
    why: "lotsful は CloudFront がUAに関係なく403（週10h案件を売りにしていて内容的には合うのに届かない）。Anycrew は2025年6月にサービス終了。テックビズは公開案件が存在しない（登録前提）。",
  },
  {
    name: "エージェント系all（ギークス/ITプロ/Midworks/ココナラテック(旧フリエン)/PE-BANK/Workship/Findy/HiPro/Relance）",
    why:
      "【2026-08-24 実地再調査】技術的には大半が取得可能（Midworks 32,048件・ココナラテック21,215件は完全SSR、" +
      "以前の「入口が無い」判定は誤りだった。フリエンは tech.coconala.com への移転を見逃し、Midworks はドメイン取り違え）。" +
      "しかし実ページで契約形態を確認した結果、17サイト中16サイトが月額の準委任（精算140〜180h/月、週2日でも月60h前後）で、" +
      "週10時間では1件も受けられない。取れるのに取らないのは負荷をかけないため。稼働が増えたら tech.crowdworks.jp（下記ソース）から順に解禁。",
  },
];

interface SitemapEntry {
  url: string;
  lastmod: string;
}

async function get(url: string, timeoutMs = 20_000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": UA, Accept: "application/xml, text/xml, text/html;q=0.9, */*;q=0.8" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

export function parseSitemap(xml: string): SitemapEntry[] {
  const out: SitemapEntry[] = [];
  for (const m of xml.matchAll(/<(?:url|sitemap)>([\s\S]*?)<\/(?:url|sitemap)>/g)) {
    const loc = m[1].match(/<loc>\s*([\s\S]*?)\s*<\/loc>/)?.[1]?.trim();
    if (!loc) continue;
    const lastmod = m[1].match(/<lastmod>\s*([\s\S]*?)\s*<\/lastmod>/)?.[1]?.trim() ?? "";
    out.push({ url: loc, lastmod });
  }
  return out;
}

/**
 * 前回の位置より後に更新された案件ページだけを、**古い順**で返す。
 *
 * 古い順なのが肝心。新しい順にすると、溜まった分より新着のほうが常に先に来るので、
 * 1回の上限を超えている限り毎回同じものを取りに行って、溜まった分が永久に減らない。
 * 実際そうなった（新着233件 / 上限2件で、2回目も同じ2件を取りに行った）。
 * 古い順に消化すれば、実行するたびに前回の位置が前に進み、いつか追いつく。
 *
 * 比較は「前回の位置**以降**」。「後」にすると、同じ日付のものを取りこぼす。
 * 実際、ココナラの lastmod は日付までしか無く、位置が 2026-08-09 に進んだ時点で
 * 同じ日の残り3件が黙って消えた。同日ぶんを拾い直すぶんは、取り込み済み判定で弾く。
 *
 * lastmod の無いページは対象外にする。更新日時が無いと位置を進められず、
 * 毎回そこで止まってしまうため。件数は undated として返し、黙って捨てない。
 */
/** 索引サイトマップで、1回に開く子の上限。 */
const MAX_INDEX_CHILDREN = 20;

export function selectNew(
  entries: SitemapEntry[],
  detailPattern: RegExp,
  since: string,
  isKnown: (url: string) => boolean = () => false,
  allowUndated = false
): { candidates: SitemapEntry[]; undated: number } {
  const details = entries.filter((e) => detailPattern.test(e.url));
  const usable = allowUndated ? details : details.filter((e) => Boolean(e.lastmod));
  return {
    candidates: usable
      .filter((e) => !since || (Boolean(e.lastmod) && e.lastmod >= since))
      .filter((e) => !isKnown(e.url))
      .sort((a, b) => a.lastmod.localeCompare(b.lastmod)),
    undated: allowUndated ? 0 : details.length - usable.length,
  };
}

/**
 * 次回の位置。
 * 「実際に見に行ったところまで」であって、「サイトマップで見えた一番新しいもの」ではない。
 * 見ていないものを飛ばすと、その案件は二度と拾われない。
 */
export function nextSince(attempted: SitemapEntry[], since: string): string {
  let mark = since;
  for (const e of attempted) {
    if (e.lastmod && e.lastmod > mark) mark = e.lastmod;
  }
  return mark;
}

/**
 * HTML から本文らしきところを取り出す。
 *
 * 素朴にタグを剥がすだけだと、先頭が全部ナビゲーションメニューになる。
 * 実際、ココナラの依頼ページは冒頭6,000文字がほぼメニューで、そのまま渡すと
 * 判定エンジンが「サービスを探す」「ブログを探す」を募集文だと思って読む。
 * そこで、CSSの断片と、何度も出てくる短い行（＝メニュー項目）を落としてから返す。
 */
export function extractText(html: string, maxChars = 6000): string {
  // JSON-LD の description が一番きれい。ただし単価や期間は本文側にしか無いことが
  // あるので、これだけで返さず、剥がした本文の前に置く。
  let jsonLd = "";
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(m[1].trim());
      const nodes = Array.isArray(data) ? data : [data];
      for (const node of nodes) {
        const desc = node?.description;
        if (typeof desc === "string" && desc.length > 80) {
          jsonLd = desc;
          break;
        }
      }
    } catch {
      // 次へ
    }
  }

  let stripped = html;
  for (const tag of ["script", "style", "svg", "noscript", "template", "nav", "header", "footer"]) {
    stripped = stripped.replace(new RegExp(`<${tag}[\\s\\S]*?</${tag}>`, "gi"), " ");
  }

  const lines = stripped
    .replace(/<[^>]+>/g, "\n")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    // 閉じ忘れたスタイルブロックの残骸
    .filter((l) => !/[{};]\s*[\w-]+\s*:/.test(l));

  const body = cutAfterBody(dropLeadingChrome(dropTaxonomyLines(cutToRepeatedTitle(dropRepeatedShortLines(lines))))).join("\n").replace(/\n{3,}/g, "\n\n");
  return (jsonLd ? `${jsonLd}\n\n${body}` : body).slice(0, maxChars);
}

/**
 * 募集内容の後ろに付く、質問欄・関連案件・おすすめを切り落とす。
 *
 * ここを残すと、質問した人のハンドル名まで募集文として読まれる。
 * 実際、「採用サービスのアンケート担当者募集」が、質問欄にいた
 * 「nachuho_イラスト・動画・広報」というユーザー名のせいで
 * 「イラスト制作の案件」と誤判定された。
 */
const BODY_END_MARKERS = [
  /^募集内容についての質問/,
  /^(この|関連する)(募集|依頼|案件|サービス)/,
  /^(おすすめ|似た|その他)の(募集|依頼|案件|サービス|出品)/,
  /^(コメント|質問)(一覧|する)?$/,
  /^(よくある質問|FAQ)$/,
  // 案件ページの下にある「他の案件」の一覧。ここを残すと、別の案件の単価を
  // この案件の報酬として読んでしまう（実データで、CS案件の報酬を
  // 隣に並んでいたエンジニア案件の「〜1,500,000円/月」として読んでいた）。
  /^(新着|関連|おすすめ|人気|注目|類似)(の)?(案件|求人|募集)/,
  /(案件|求人)の(新着|人気|注目)/,
  /^.{0,12}(の)?(新着|人気)案件$/,
  /(応募人気|閲覧数)ランキング/,
  /^(この|同じ).{0,10}(の)?(他の)?(案件|求人)/,
  // 応募者の一覧。ここを残すと、応募者のハンドル名が募集文として読まれる。
  // 「nachuho_イラスト・動画・広報」という応募者名のせいで、アンケートの
  // 募集をイラスト案件と誤判定した実例がある。
  /^応募者(一覧)?$/,
  /^(応募|購入)者のみ/,
  /^(添付ファイル|参考URL)$/,
];

/**
 * ページ冒頭のメニューを落とす。
 *
 * dropRepeatedShortLines は「何度も出てくる短い行」しか落とせないので、
 * 1回しか出てこないメニュー項目（「購入・発注したい方」「ログイン」など）が
 * そのまま本文の先頭に残っていた。実際、ココナラの「仕事・求人を投稿して募集」
 * という**メニュー項目**に当たって、電話対応の求人をSNS投稿の案件と誤判定した。
 *
 * 冒頭から続く短い行の連なりは、本文ではなくメニューとみなして落とす。
 */

/** 本文の始まりを示す行。短くても、ここから先は本文。 */
const BODY_START = /^[【\[［]|^[■●◆▼]|^(お?仕事|業務|依頼|作業|募集)(内容|範囲|詳細)|^(概要|前提|背景)[:：]?$|[:：]\s*$/;

/**
 * サイトが付けている分類タグの行を落とす。
 *
 * ココナラの案件ページには「職種」「依頼範囲」というラベルの直後に、
 * サイト共通の分類語がずらりと並ぶ。募集した人が書いた文ではない。
 *
 * 実害があった: 10万円の「ホテル情報収集・リスト作成」が、
 * 職種タグに含まれる「営業・接客」に当たって「現地作業が要る案件」と
 * 判定され、落とされていた。工程表には当たっていて、あなたの時間は
 * 0.7時間と出ていたのに、その手前で捨てていた。
 */
const TAXONOMY_LABEL = /^(職種|依頼範囲|カテゴリ|タグ|求めるスキル|特記事項)$/;

export function dropTaxonomyLines(lines: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (TAXONOMY_LABEL.test(lines[i].trim())) {
      // ラベルの直後に続く分類語を落とす。
      // 1行に「、」で並ぶ場合と、1語1行の場合の両方がある。
      i++;
      let dropped = 0;
      while (
        i < lines.length &&
        dropped < 40 &&
        (lines[i].split(/[、,]/).length >= 3 || lines[i].trim().length < 20) &&
        !BODY_START.test(lines[i])
      ) {
        i++;
        dropped++;
      }
      i--;
      continue;
    }
    out.push(lines[i]);
  }
  return out;
}

/**
 * 見出しが2回出てくるページは、1回目と2回目の間がメニュー。
 *
 * 案件ページは「タイトル → サイトのメニュー → タイトル → 本文」という
 * 並びになっていることが多い。先頭行が長いタイトルだと、
 * 短い行を落とす処理が0行目で止まってメニューが素通りしていた。
 */
export function cutToRepeatedTitle(lines: string[], maxLook = 80): string[] {
  const head = lines[0]?.trim();
  if (!head || head.length < 8) return lines;
  // 「| サイト名」が付いた形も同じ見出しとみなす
  const bare = head.replace(/\s*[|｜]\s*[^|｜]{1,20}$/, "").trim();
  for (let i = 1; i < lines.length && i < maxLook; i++) {
    const l = lines[i].trim();
    if (l === head || (bare.length >= 8 && l === bare)) return lines.slice(i);
  }
  return lines;
}

export function dropLeadingChrome(lines: string[], shortLen = 25, maxSkip = 60): string[] {
  let i = 0;
  while (i < lines.length && i < maxSkip && lines[i].length < shortLen) {
    // 「【業務内容】」のような見出しは短いが本文の始まり。ここで止める。
    if (BODY_START.test(lines[i])) break;
    i++;
  }
  // 全部落ちてしまうなら、判断を誤っている。元のまま返す。
  return i >= lines.length ? lines : lines.slice(i);
}

export function cutAfterBody(lines: string[]): string[] {
  // 先頭近く（5行以内）で当たったものは、本文ではなくページの飾りなので無視する。
  // ただし「最初の一致」で探すと、飾りに当たった時点で探索が終わってしまい、
  // その先にある本物の切れ目（応募者一覧など）を見落とす。6行目以降で探す。
  const at = lines.findIndex((l, i) => i > 5 && BODY_END_MARKERS.some((m) => m.test(l)));
  return at > 5 ? lines.slice(0, at) : lines;
}

/**
 * 短い行が何度も出てきたら、それはメニューかパンくずなので落とす。
 * 本文中の短い1行（「【必須条件】」など）は1回しか出てこないので残る。
 */
export function dropRepeatedShortLines(lines: string[], shortLen = 30): string[] {
  const counts = new Map<string, number>();
  for (const l of lines) counts.set(l, (counts.get(l) ?? 0) + 1);
  return lines.filter((l) => l.length >= shortLen || (counts.get(l) ?? 0) === 1);
}

function guessTitle(html: string, text: string): string {
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim();
  if (t) return t.replace(/\s+/g, " ").slice(0, 120);
  return text.split("\n")[0]?.slice(0, 120) ?? "";
}

export interface FetchOptions {
  /** この日時より後に更新されたものだけを対象にする */
  since: string;
  /** 1回の実行で詳細まで取りに行く上限 */
  maxDetails: number;
  /** 1件ごとに空ける間隔（ミリ秒） */
  delayMs: number;
  /** すでに取り込んだURLか。同じものを二度取りに行かないため。 */
  isKnown?: (url: string) => boolean;
}

export interface SourceResult {
  sourceId: string;
  /** サイトマップで見つかった新着の数 */
  found: number;
  /** 実際に詳細まで取れた数 */
  fetched: number;
  /** 上限を超えて今回は見送った数。次回に持ち越す。 */
  remaining: number;
  /** 更新日時が無くて対象外にした数 */
  undated: number;
  /** 取得しようとして落ちた数 */
  failedPages: number;
  /** 取れたが本文が空だった数 */
  emptyPages: number;
  /** 索引の子サイトマップのうち、上限で開かなかった数 */
  skippedChildren: number;
  /** 索引の子サイトマップのうち、取得に失敗した数 */
  failedChildren: number;
  /** 見に行ったのに1件も本文が取れなかったか */
  allFailed: boolean;
  /** そのときの説明 */
  failureNote: string;
  leads: (Partial<Lead> & { rawText: string })[];
  error: string | null;
  /** 次回の since に使う値 */
  newestLastmod: string;
}

/**
 * 1ソースぶん取り込む。
 * サイトマップで新着を絞ってから、上限まで詳細を取りに行く。
 */
export async function fetchSource(source: SourceDefinition, options: FetchOptions): Promise<SourceResult> {
  const result: SourceResult = {
    sourceId: source.id,
    found: 0,
    fetched: 0,
    remaining: 0,
    undated: 0,
    failedPages: 0,
    emptyPages: 0,
    skippedChildren: 0,
    failedChildren: 0,
    allFailed: false,
    failureNote: "",
    leads: [],
    error: null,
    newestLastmod: options.since,
  };

  try {
    let entries: SitemapEntry[] = [];

    if (source.isIndex) {
      const index = parseSitemap(await get(source.sitemapUrl));
      // 索引の lastmod が古い子は開かない。無駄な取得をしないため。
      //
      // ただし lastmod が無い子は開く。以前は文字列比較で落としていたので
      // （"" >= "2026-08-20" は false）、lastmod を書かない索引だと
      // since が入った2回目以降ずっと0件になり、そのサイトが死んでいた。
      const fresh = index.filter(
        (c) => !options.since || !c.lastmod || c.lastmod >= options.since.slice(0, 10)
      );
      const children = fresh.slice(0, MAX_INDEX_CHILDREN);
      if (fresh.length > children.length) {
        result.skippedChildren = fresh.length - children.length;
      }
      for (const child of children) {
        try {
          entries.push(...parseSitemap(await get(child.url)));
        } catch {
          // 子サイトマップ1本が落ちても続ける
          result.failedChildren++;
        }
        await new Promise((r) => setTimeout(r, options.delayMs));
      }
    } else {
      entries = parseSitemap(await get(source.sitemapUrl));
    }

    // 更新日時が無いサイトは、位置ではなく「取り込み済みか」だけで差分を取る
    const since = source.trackBy === "seen" ? "" : options.since;
    const { candidates, undated } = selectNew(
      entries,
      source.detailPattern,
      since,
      options.isKnown,
      source.trackBy === "seen"
    );
    result.found = candidates.length;
    result.undated = undated;
    const attempted = candidates.slice(0, options.maxDetails);
    result.remaining = Math.max(0, candidates.length - attempted.length);

    for (const entry of attempted) {
      try {
        const html = await get(entry.url);
        const text = extractText(html);
        if (text.length < 80) {
          // 本文が取れなかった。ここで continue すると下の待ち時間を飛ばして
          // 次のページを叩いてしまう。相手のサーバーに連打をかけることになる。
          result.emptyPages++;
        } else {
          result.leads.push({
            source: "site",
            externalId: `${source.id}:${entry.url}`,
            url: entry.url,
            title: guessTitle(html, text),
            rawText: text,
            budgetJpy: extractBudget(text),
            postedAt: entry.lastmod || new Date().toISOString(),
          });
          result.fetched++;
        }
      } catch {
        // 1件落ちても続ける
        result.failedPages++;
      }
      // 成否にかかわらず必ず待つ
      await new Promise((r) => setTimeout(r, options.delayMs));
    }

    // 全部取れなかったのに何も言わないと、画面上は「0件でした」としか出ず
    // 原因が分からない。error とは分けて持つ（error にすると呼び出し側が
    // 「取得そのものが失敗した」として扱い、位置の判断ができなくなる）。
    if (result.fetched === 0 && attempted.length > 0) {
      result.allFailed = true;
      result.failureNote =
        `${attempted.length}件を見に行きましたが、1件も本文を取れませんでした` +
        `（取得エラー ${result.failedPages}件 / 本文が空 ${result.emptyPages}件）。` +
        `ページの作りが変わったか、プログラムからの取得を弾かれている可能性があります。`;
    }

    // 見に行ったところまで位置を進める。取れなかった1件があっても進めてよい
    // （何度も同じもので詰まらないため）。
    result.newestLastmod = nextSince(attempted, options.since);
  } catch (error) {
    result.error = error instanceof Error ? error.message : "不明なエラー";
    // 証明書まわりは原因が分かりにくいので、そのまま流さず言い換える
    if (/certificate|CERT_|self.signed|unable to verify/i.test(result.error)) {
      result.error = `${result.error}（相手サーバーの証明書チェーンが不完全な可能性があります。ブラウザでは開けても、プログラムからは検証できません）`;
    }
  }

  return result;
}

export const getSource = (id: string): SourceDefinition | undefined => SOURCES.find((s) => s.id === id);

export { fingerprint };
