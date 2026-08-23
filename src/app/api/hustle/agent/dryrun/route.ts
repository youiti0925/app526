import { NextRequest, NextResponse } from "next/server";
import {
  buildGradeBrief,
  buildProduceBrief,
  evidenceFor,
  findContradictions,
  parseGrades,
  parseProduceResults,
  pickTargets,
  reconcileGrade,
  untestedGenres,
  type DryRun,
} from "@/lib/hustle/agent/dryrun";
import type { Capability } from "@/lib/hustle/agent/deliverability";
import {
  insertDryRun,
  readDryRuns,
  readLeads,
  readTestedGenres,
  saveArtifact,
  saveGrade,
} from "@/lib/hustle/agent/db";
import { guard, num, oneOf, readJsonObject } from "@/lib/hustle/http";

/**
 * 試作ハーネスの受け渡し口。
 *
 * GET ?phase=produce … 「実際に作ってください」の指示書
 * GET ?phase=grade   … 「作られたものを採点してください」の指示書
 * GET ?format=json   … 結果の一覧と、主張と結果の食い違い
 * POST phase=produce … 成果物を書き戻す
 * POST phase=grade   … 採点を書き戻す
 *
 * localhost でしか使わない前提。
 */

const PHASES = ["produce", "grade"] as const;

/**
 * 対象を limit 件まで用意する。
 *
 * 既存の pending があってもそこで打ち切らず、足りないぶんを補充する。
 * ここで打ち切っていたせいで、最初に選ばれた簡単なジャンル（文章・コード）だけが
 * 何度も対象になり、検証したい難しいジャンルにいつまでも到達しなかった。
 */
function ensureTargets(limit: number): DryRun[] {
  const pending = readDryRuns("pending", 50);
  if (pending.length >= limit) return pending.slice(0, limit);

  // すでに対象になっているジャンルは飛ばして、未着手のジャンルを埋めにいく
  const covered = new Set<string>([...readTestedGenres(), ...pending.map((p) => p.genre)]);
  const leads = readLeads(undefined, 300);
  const targets = pickTargets(leads, { skipGenres: covered });

  const added = targets.slice(0, limit - pending.length).map((t) =>
    insertDryRun({
      leadId: t.leadId,
      sourceUrl: t.sourceUrl,
      title: t.title,
      genre: t.genre,
      requirement: t.requirement,
      deliverableSpec: t.deliverableSpec,
    })
  );
  return [...pending, ...added];
}

export async function GET(request: NextRequest) {
  return guard(async () => {
    const params = request.nextUrl.searchParams;
    const limit = Math.max(1, Math.min(10, Math.round(num(params.get("limit")) ?? 4)));

    if (params.get("format") === "json") {
      const all = readDryRuns(undefined, 200);
      const byGenre = new Map<Capability, DryRun[]>();
      for (const r of all) {
        byGenre.set(r.genre, [...(byGenre.get(r.genre) ?? []), r]);
      }
      const evidence = [...byGenre.entries()].map(([genre, runs]) => ({
        genre,
        evidence: evidenceFor(runs),
        runs: runs.length,
      }));
      return NextResponse.json({
        dryRuns: all,
        evidence,
        contradictions: findContradictions(byGenre),
        // 対象として積んであるだけのジャンルを「未検証」に混ぜると、
        // 何が本当に手つかずなのか分からなくなる
        untested: untestedGenres(
          readTestedGenres(),
          all.filter((r) => r.status === "pending").map((r) => ({ genre: r.genre }) as never)
        ).map((g) => ({
          genre: g.genre,
          label: g.label,
          claim: g.claim,
        })),
      });
    }

    const phase = oneOf(params.get("phase"), PHASES) ?? "produce";

    if (phase === "produce") {
      const runs = ensureTargets(limit);
      if (runs.length === 0) {
        return text("試作する案件がありません。先に案件を取り込んでください。\n");
      }
      return markdown(buildProduceBrief(runs));
    }

    const produced = readDryRuns("produced", limit);
    if (produced.length === 0) {
      return text("採点する成果物がありません。先に produce を回してください。\n");
    }
    return markdown(buildGradeBrief(produced));
  });
}

export async function POST(request: NextRequest) {
  return guard(async () => {
    const parsed = await readJsonObject(request);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;
    const phase = oneOf(body.phase, PHASES);

    if (phase === "produce" || Array.isArray(body.results)) {
      const results = parseProduceResults(body);
      if (results.length === 0) {
        return NextResponse.json({ error: "results が空です" }, { status: 400 });
      }
      let saved = 0;
      const skipped: string[] = [];
      for (const r of results) {
        const updated = saveArtifact(r.dryRunId, {
          artifact: r.artifact,
          // 自己申告の危うい点も残す。採点者に渡す材料になる。
          method: [r.method, r.selfDoubt ? `【自己申告の懸念】${r.selfDoubt}` : ""]
            .filter(Boolean)
            .join("\n\n"),
          blockedReason: r.blocked,
        });
        if (updated) saved++;
        else skipped.push(r.dryRunId);
      }
      return NextResponse.json({ phase: "produce", saved, skipped });
    }

    if (phase === "grade" || Array.isArray(body.grades)) {
      const grades = parseGrades(body);
      if (grades.length === 0) {
        return NextResponse.json({ error: "grades が空です" }, { status: 400 });
      }
      let saved = 0;
      const overrides: { dryRunId: string; note: string }[] = [];
      for (const g of grades) {
        const { dryRunId, ...raw } = g;
        // 「そのまま納品できる」なのに人の作業が残っている、のような矛盾を潰す
        const { grade, overridden } = reconcileGrade(raw);
        if (overridden) overrides.push({ dryRunId, note: overridden });
        if (saveGrade(dryRunId, grade)) saved++;
      }
      return NextResponse.json({ phase: "grade", saved, overrides });
    }

    return NextResponse.json(
      { error: "phase は produce か grade を指定してください" },
      { status: 400 }
    );
  });
}

const markdown = (body: string) =>
  new NextResponse(body, { headers: { "Content-Type": "text/markdown; charset=utf-8" } });

const text = (body: string) =>
  new NextResponse(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
