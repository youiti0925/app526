/**
 * 承認キューの掃除 — 締切が過ぎた案件を自動で下げる。
 *
 * ホテル案件（8/26締切）と海外企業リスト案件（8/28締切）が、承認待ちのまま
 * 募集終了して機会を逃した。人の承認が遅れるのは前提なので、
 * キューの側が「もう出せないもの」を自分で見分けて下がる必要がある。
 *
 * 判定は取り込み時の募集文に書かれた締切日だけを使う（決定的・通信なし）。
 * 締切の書かれていない案件（出品案・貼り付け起源）は触らない。
 */

/** 募集文から「締切日 YYYY年M月D日」を読む。無ければ null。 */
export function parseListedDeadline(rawText: string): string | null {
  const m = rawText.match(/締切日\s*(20\d{2})年\s*(\d{1,2})月\s*(\d{1,2})日/);
  if (!m) return null;
  const [, y, mo, d] = m;
  const month = Number(mo);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * 締切超過か。締切日の当日は「まだ出せる」扱い（当日中の応募は可能なため）。
 * today は YYYY-MM-DD のローカル日付。
 */
export function isPastDeadline(deadline: string | null, today: string): boolean {
  if (!deadline) return false;
  return deadline < today;
}

export interface ExpiryCandidate {
  inboxId: string;
  title: string;
  deadline: string;
}

/**
 * 承認待ちの中から締切超過を選び出す。
 * items は {id, title, leadRawText} の形に整えてから渡す（DBの形に依存させない）。
 */
export function findExpiredItems(
  items: { id: string; title: string; leadRawText: string | null }[],
  today: string
): ExpiryCandidate[] {
  const out: ExpiryCandidate[] = [];
  for (const item of items) {
    if (!item.leadRawText) continue;
    const deadline = parseListedDeadline(item.leadRawText);
    if (isPastDeadline(deadline, today)) {
      out.push({ inboxId: item.id, title: item.title, deadline: deadline! });
    }
  }
  return out;
}
