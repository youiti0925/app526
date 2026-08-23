/**
 * 納期に間に合うかの判定。
 *
 * なぜ要るか:
 * いまは「実効時給が基準を超えていれば応募候補」にしている。
 * だが週10時間しか出せない人にとって、22時間かかる仕事を1週間で、は成立しない。
 * 時給が良くても間に合わなければ、遅延して信用を失うか、徹夜して時給が崩れる。
 *
 * 月額契約は checkCapacity（engagement.ts）が月の稼働で見ている。
 * こちらは1件いくらの請負向けで、「納期までに人の作業時間が収まるか」を見る。
 */

export interface Deadline {
  /** 納期までの日数。読めなければ null。 */
  days: number | null;
  /** 何を読んだか */
  basis: string;
  /** 急ぎを煽る書き方か（単価が実質下がるサイン） */
  rushed: boolean;
}

const num = (s: string): number => Number(s.replace(/[,，\s]/g, ""));

/**
 * 納期を日数で読む。
 * 相対（「2週間以内」）も絶対（「2026年9月10日まで」）も拾う。
 */
export function readDeadline(text: string, now: Date = new Date()): Deadline {
  const t = text.normalize("NFKC").slice(0, 8000);
  const rushed = /(即日|本日中|今日中|至急|大至急|明日まで|24時間以内)/.test(t);

  if (/(即日|本日中|今日中)/.test(t)) {
    return { days: 0, basis: "即日・当日中と書かれています", rushed: true };
  }

  // 絶対日付: 2026年9月10日 / 2026/9/10 / 9月10日
  const abs =
    t.match(/(20\d{2})\s*[年\/\-]\s*(\d{1,2})\s*[月\/\-]\s*(\d{1,2})\s*日?/) ??
    t.match(/(?:納期|締切|締め切り|期限|納品).{0,10}?(\d{1,2})\s*[月\/]\s*(\d{1,2})\s*日?/);
  if (abs) {
    const [y, m, d] =
      abs.length === 4
        ? [Number(abs[1]), Number(abs[2]), Number(abs[3])]
        : [now.getFullYear(), Number(abs[1]), Number(abs[2])];
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      const target = new Date(y, m - 1, d);
      // 月日だけの表記で、すでに過ぎている場合は来年とみなす
      if (abs.length !== 4 && target < now) target.setFullYear(y + 1);
      const days = Math.round((target.getTime() - startOfDay(now).getTime()) / 86_400_000);
      if (days >= 0 && days < 730) {
        return { days, basis: `納期 ${y}年${m}月${d}日（あと${days}日）`, rushed: rushed || days <= 3 };
      }
    }
  }

  // 相対: 2週間以内 / 1ヶ月 / 10日以内
  const rel = t.match(/(?:納期|締切|締め切り|期限|納品|以内|まで).{0,8}?([0-9]{1,3})\s*(日|週間?|ヶ?月|カ月)/) ??
    t.match(/([0-9]{1,3})\s*(日|週間?|ヶ?月|カ月)\s*(?:以内|程度|ほど|くらい|で)/);
  if (rel) {
    const n = num(rel[1]);
    const unit = rel[2];
    const days = unit.startsWith("日") ? n : unit.startsWith("週") ? n * 7 : n * 30;
    if (days > 0 && days < 730) {
      return { days, basis: `納期 ${n}${unit}（約${days}日）`, rushed: rushed || days <= 3 };
    }
  }

  return {
    days: null,
    basis: "納期が読み取れませんでした",
    rushed,
  };
}

const startOfDay = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate());

export interface DeadlineCheck {
  /** 間に合うか */
  fits: boolean;
  /** 納期までに出せる作業時間 */
  availableHours: number | null;
  /** 必要な作業時間 */
  neededHours: number;
  reason: string;
}

/**
 * 納期までに終わるか。
 *
 * 週の時間を全部この1件に注げる前提にはしない。
 * 応募・やりとり・他の案件があるので、実際に手を動かせるのは一部。
 * ここを楽観に倒すと、受けてから間に合わないことが分かる。
 */
export function checkDeadline(
  deadline: Deadline,
  neededHours: number,
  weeklyHours: number,
  options: { focusRatio?: number } = {}
): DeadlineCheck {
  // この1件に割ける割合。残りは応募・やりとり・他案件に消える。
  const focus = options.focusRatio ?? 0.7;

  if (deadline.days === null) {
    return {
      fits: true,
      availableHours: null,
      neededHours,
      reason: "納期が書かれていないので、間に合うかは判断できません。応募前に必ず確認してください。",
    };
  }

  if (deadline.days === 0) {
    return {
      fits: false,
      availableHours: 0,
      neededHours,
      reason: `即日納品で ${neededHours}時間 の作業は成立しません。急ぎを理由に単価を抑える案件は、実質的な時給がさらに下がります。`,
    };
  }

  const availableHours = Math.round((weeklyHours * focus * deadline.days) / 7);

  if (neededHours <= availableHours) {
    return {
      fits: true,
      availableHours,
      neededHours,
      reason: `${deadline.basis}。この1件に割ける時間は約${availableHours}時間で、必要な${neededHours}時間に足ります。`,
    };
  }

  const needWeeks = Math.ceil((neededHours / (weeklyHours * focus)) * 10) / 10;
  return {
    fits: false,
    availableHours,
    neededHours,
    reason:
      `${deadline.basis}。この1件に割ける時間は約${availableHours}時間ですが、` +
      `必要なのは${neededHours}時間です（週${weeklyHours}時間のうち${Math.round(focus * 100)}%を充てる前提）。` +
      `終わらせるには約${needWeeks}週かかります。納期の延長を交渉するか、見送ってください。`,
  };
}
