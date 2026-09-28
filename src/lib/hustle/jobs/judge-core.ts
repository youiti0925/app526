/**
 * 案件判定の純ロジック（テスト対象）。DBやAIに触らない。
 */

/**
 * 貼り付けた募集文から報酬の総額を読む（サイトから取り込んだ案件は予算欄があるが、貼り付けには無い）。
 * 「予算: 20,000円」「報酬 2万円」「10,000円〜20,000円」（幅があれば低いほう）。読めなければ null。
 * 「1件100円」のような単価は総額ではないので読まない（pricing.ts が単価×数量で読む）。
 */
export function readBudgetFromText(text: string): number | null {
  const t = text.normalize("NFKC");
  const LABEL = "(?:予算|報酬|金額|契約金額|固定報酬|謝礼|支払)";
  const man = t.match(new RegExp(`${LABEL}[^0-9\\n]{0,12}([0-9]+(?:\\.[0-9]+)?)\\s*万\\s*円`));
  const yen = t.match(new RegExp(`${LABEL}[^0-9\\n]{0,12}([0-9][0-9,]{2,})\\s*円`));
  const candidates: { at: number; jpy: number }[] = [];
  if (man?.index !== undefined) candidates.push({ at: man.index, jpy: Math.round(parseFloat(man[1]) * 10_000) });
  if (yen?.index !== undefined) candidates.push({ at: yen.index, jpy: parseInt(yen[1].replace(/,/g, ""), 10) });
  const first = candidates.sort((a, b) => a.at - b.at)[0];
  if (!first || !Number.isFinite(first.jpy) || first.jpy < 100 || first.jpy > 100_000_000) return null;
  // 「1件」「1記事」などの直後の金額は単価
  const before = t.slice(Math.max(0, first.at - 1), first.at + 30);
  if (/1\s*(?:件|記事|本|点|枚|ページ)(?:あたり|につき)?[^0-9]{0,4}[0-9]/.test(before)) return null;
  return first.jpy;
}

/** 貼り付けた募集文の件名。1行目（長ければ切る）。 */
export function titleFromText(text: string): string {
  const line = text.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? "";
  return line.slice(0, 80);
}
