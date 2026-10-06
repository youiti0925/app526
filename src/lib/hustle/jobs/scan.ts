/**
 * 案件の自動収集と一次判定（専用会話や定期実行から使う）。
 *
 * 取りに行くのは、サイトマップなど「機械が読むことを想定して公開されている」経路で、
 * 規約も自動アクセスを禁じていないと確認したソースだけ（agent/sources.ts の defaultEnabled）。
 * クラウドワークス本体のように robots.txt が AI の巡回を拒否しているサイトは取りに行かない。
 *
 * 流れ: 取り込み → 機械の判定（詐欺・関門・納期・実効時給）→ 判定しきれないものだけ Claude →
 *       応募してよいものに提案文の下書き。応募はしない（人が各サイトで行う）。
 */
import { readLeads, readInbox, writeAgentConfig } from "../agent/db";
import { runAgent } from "../agent/runner";
import { SOURCES } from "../agent/sources";
import type { InboxItem, Lead } from "../agent/types";
import { resolveEscalations } from "./judge";

export interface ScanResult {
  started: string;
  sources: string[];
  ingested: number;
  /** 今回の実行で新しく入った案件。 */
  fresh: Lead[];
  /** 判定の内訳（今回の新着のうち）。 */
  counts: { proceed: number; verify_first: number; reject: number; unknown: number };
  /** 提案文などの下書き（今回出たもの）。lead と対応。 */
  drafts: { lead: Lead; items: InboxItem[] }[];
  /** Claude に判定を頼んだ件数と、頼めなかった残り。 */
  escalated: number;
  escalationNote: string;
  summary: string;
}

/** 有効にするソースを整える（作業場所が作り直されると設定が消えるので、毎回確かめる）。 */
export function enableDefaultSources(maxDetails?: number): string[] {
  const on = SOURCES.filter((s) => s.defaultEnabled);
  // 1回に読む詳細ページの上限。相手のサーバーに負荷をかけないよう、指定しても150件で頭打ち
  const cap = maxDetails ? Math.max(1, Math.min(150, Math.round(maxDetails))) : undefined;
  writeAgentConfig({
    sources: Object.fromEntries(on.map((s) => [s.id, cap ? { enabled: true, maxDetails: cap } : { enabled: true }])),
  });
  return on.map((s) => s.name);
}

export async function scanLeads(opts: { maxEscalate?: number; maxDetails?: number } = {}): Promise<ScanResult> {
  const started = new Date().toISOString();
  const sources = enableDefaultSources(opts.maxDetails);

  const outcome = await runAgent({ trigger: "manual", force: true, only: ["ingest", "triage", "draft"] });
  if (!outcome.ran) throw new Error(`収集を実行できませんでした: ${outcome.reason ?? ""}`);

  const esc = await resolveEscalations(undefined, opts.maxEscalate ?? 5);

  const fresh = readLeads(undefined, 500).filter((l) => l.createdAt >= started && l.source === "site");
  const counts = { proceed: 0, verify_first: 0, reject: 0, unknown: 0 };
  for (const l of fresh) counts[l.verdict as keyof typeof counts] = (counts[l.verdict as keyof typeof counts] ?? 0) + 1;

  const byLead = new Map<string, InboxItem[]>();
  for (const item of readInbox(undefined, 500)) {
    if (!item.leadId || item.createdAt < started) continue;
    byLead.set(item.leadId, [...(byLead.get(item.leadId) ?? []), item]);
  }
  const drafts = fresh
    .filter((l) => l.verdict !== "reject" && byLead.has(l.id))
    .sort((a, b) => b.score - a.score)
    .map((lead) => ({ lead, items: byLead.get(lead.id)! }));

  const ingested = outcome.result?.ingested ?? 0;
  return {
    started,
    sources,
    ingested,
    fresh,
    counts,
    drafts,
    escalated: esc.requested,
    escalationNote: esc.note,
    summary: `新着${fresh.length}件（応募候補${counts.proceed}・確認してから${counts.verify_first}・見送り${counts.reject}・判定保留${counts.unknown}）`,
  };
}
