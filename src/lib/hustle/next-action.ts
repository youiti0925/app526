import { reviewListing, summarizeListings, type PublishedListing } from "./agent/listing-tracker";
import { checkCashNeed, type CashNeed } from "./cashflow";

/**
 * 「いま何をすればいいか」を、アプリの状態から1つだけ決める。
 *
 * なぜ要るか:
 * 機能が増えるほど、画面が増えて、どこから手をつければいいか分からなくなる。
 * このアプリを使う人は時間も気力も限られているので、
 * 選択肢を並べるのではなく「次の1手」を出す必要がある。
 *
 * 順番は固定する。気分で変えない。
 *   1. 現金が期日に間に合わない  … 副業の話より先。公的支援に向ける。
 *   2. 承認待ちが溜まっている    … 作ったものが誰にも見られず腐る。
 *   3. 出品案があるのに出していない … 出すまでは1円にもならない。
 *   4. 出品の見直しが要る        … 出しっぱなしで放置しない。
 *   5. 判定待ちの案件がある      … 取り込んだのに裁いていない。
 *   6. 取り込み元が無い          … そもそも何も入ってこない。
 *   7. どれも無い                … 出品を増やすか、市場を探す。
 */

export type NextActionKind =
  | "cash_emergency"
  | "clear_inbox"
  | "publish_listing"
  | "fix_listing"
  | "run_triage"
  | "add_source"
  | "grow";

export interface NextAction {
  kind: NextActionKind;
  /** 見出し。命令形で1行。 */
  title: string;
  /** なぜそれが先なのか */
  why: string;
  /** どこへ行けばよいか */
  href: string;
  linkLabel: string;
  /** 深刻なもの（赤で出す） */
  urgent: boolean;
}

export interface AppState {
  /** 承認待ちの件数 */
  pendingInbox: number;
  /** 出品案の件数（承認待ちのうち kind=listing） */
  pendingListingDrafts: number;
  /** 実際に出品したもの */
  published: PublishedListing[];
  /** 判定待ちの案件数 */
  newLeads: number;
  /** 取り込み元が1つでも有効か */
  hasSource: boolean;
  /** 期日までに要る現金。無ければ null。 */
  cashNeed: CashNeed | null;
  /** 受注済みで入金待ちの仕事 */
  wonJobs: { label: string; amountJpy: number; platformId: string; wonAt: Date }[];
  today: string;
}

export function decideNextAction(state: AppState): NextAction {
  // 1. 現金が間に合わないなら、副業の話より先にそっち
  if (state.cashNeed) {
    const cash = checkCashNeed(state.cashNeed, state.wonJobs, new Date(`${state.today}T00:00:00`));
    if (!cash.covers) {
      return {
        kind: "cash_emergency",
        title: `${state.cashNeed.byDate} までに ${cash.shortfallJpy.toLocaleString()}円 足りません`,
        why: cash.advice,
        href: "/hustle/guide",
        linkLabel: "相談窓口を見る",
        urgent: true,
      };
    }
  }

  // 2. 承認待ちが溜まっていると、作ったものが誰にも見られないまま腐る
  if (state.pendingInbox >= 3) {
    return {
      kind: "clear_inbox",
      title: `承認待ちが ${state.pendingInbox}件 溜まっています`,
      why: "作った提案文や出品案は、あなたが目を通して出すまで何も起きません。溜めると、どれが新しいのか分からなくなります。",
      href: "/hustle/inbox",
      linkLabel: "承認キューを開く",
      urgent: false,
    };
  }

  // 3. 出品案があるのに1つも出していない
  if (state.pendingListingDrafts > 0 && state.published.length === 0) {
    return {
      kind: "publish_listing",
      title: `出品案が ${state.pendingListingDrafts}件 できています。1つ出してください`,
      why: "いま狙っている仕事（SDS・リスクアセスメント・作業標準書・ISO）は、募集として公開されません。出品して待つ形でしか入り口がありません。出すまでは1円にもなりません。",
      href: "/hustle/inbox",
      linkLabel: "出品案を見る",
      urgent: false,
    };
  }

  // 4. 出しっぱなしで放置しない
  if (state.published.length > 0) {
    const reviews = state.published.map((l) => reviewListing(l, state.today));
    const needsChange = reviews.filter(
      (r) => r.verdict === "invisible" || r.verdict === "no_conversion" || r.verdict === "stop"
    );
    if (needsChange.length > 0) {
      const first = needsChange[0];
      return {
        kind: "fix_listing",
        title: `出品「${first.title.slice(0, 24)}」を直してください`,
        why: `${first.reason} ${first.nextAction}`,
        href: "/hustle/inbox",
        linkLabel: "見直しの指示を見る",
        urgent: false,
      };
    }
    // 全部様子見なら、待つのが正解。次の手はその間にやること。
    if (reviews.every((r) => r.verdict === "too_early")) {
      return {
        kind: "grow",
        title: "出品はいじらず、種類を増やしてください",
        why: summarizeListings(reviews),
        href: "/hustle/inbox",
        linkLabel: "次の出品案を見る",
        urgent: false,
      };
    }
  }

  // 5. 取り込んだのに裁いていない
  if (state.newLeads > 0) {
    return {
      kind: "run_triage",
      title: `判定していない案件が ${state.newLeads}件 あります`,
      why: "取り込んだだけでは何も進みません。自律運転を1回まわすと、受ける価値があるものだけが残ります。",
      href: "/hustle/agent",
      linkLabel: "自律運転を開く",
      urgent: false,
    };
  }

  // 6. そもそも何も入ってこない
  if (!state.hasSource) {
    return {
      kind: "add_source",
      title: "案件を取りに行く先が1つも有効になっていません",
      why: "取り込み元が無いと、あなたが手で貼った案件しか扱えません。まず1つ有効にしてください。",
      href: "/hustle/agent",
      linkLabel: "取り込み先を設定する",
      urgent: false,
    };
  }

  // 7. 手が空いている
  return {
    kind: "grow",
    title: "手が空いています。市場を探すか、出品を増やしてください",
    why: "応募できる案件が無いときは、待つのではなく入り口を増やす番です。募集として公開されていない市場を探させることもできます。",
    href: "/hustle/discovery",
    linkLabel: "市場を探す",
    urgent: false,
  };
}
