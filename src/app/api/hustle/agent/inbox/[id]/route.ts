import { NextRequest, NextResponse } from "next/server";
import {
  decideInbox,
  logEvent,
  readInboxItem,
  updateInboxBody,
  updateLead,
  upsertPublishedListing,
} from "@/lib/hustle/agent/db";
import { updatePath } from "@/lib/hustle/repo";
import { readPaths } from "@/lib/hustle/db";
import { generateJson, describeAiError, hasApiKey } from "@/lib/hustle/ai";
import { guard, oneOf, readJsonObject, str } from "@/lib/hustle/http";
import type { InboxStatus } from "@/lib/hustle/agent/types";

const STATUSES = ["approved", "rejected"] as const satisfies readonly InboxStatus[];

/**
 * 承認キューの1件を処理する。
 *
 * approve は「人がこれで送る」という意思表示であり、
 * アプリが代わりに送信することはない（自動送信は各社の規約違反のため）。
 */
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const { id } = await ctx.params;
    const parsed = await readJsonObject(request);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    const item = readInboxItem(id);
    if (!item) return NextResponse.json({ error: "見つかりません" }, { status: 404 });

    // 修正指示: AIに直させる（決定はまだしない）
    if (body.action === "revise") {
      const instruction = str(body.instruction, 2000) ?? "";
      if (!instruction.trim()) {
        return NextResponse.json({ error: "どう直すかを書いてください" }, { status: 400 });
      }
      if (!hasApiKey()) {
        return NextResponse.json(
          { error: "AIキーが未設定のため、修正はできません。本文を直接編集してください。" },
          { status: 400 }
        );
      }
      try {
        const result = await generateJson<{ body?: string }>(
          `次の文章を、指示に従って書き直してください。
指示以外の部分は変えないでください。誇張や成果保証を書かないでください。
事実として確認できない箇所は 【要確認: 何を書くか】 のまま残してください。

次のJSONだけを返してください: { "body": "書き直した本文" }

=== 指示 ===
${instruction}

=== 元の文章 ===
${item.body.slice(0, 8000)}`,
          { temperature: 0.6, maxOutputTokens: 4096 }
        );
        if (!result?.body?.trim()) {
          return NextResponse.json({ error: "書き直しに失敗しました" }, { status: 500 });
        }
        updateInboxBody(id, result.body);
        logEvent(item.runId || "manual", "runner", "action", `承認待ちの1件を修正しました: ${instruction.slice(0, 60)}`, {
          inboxId: id,
        });
        return NextResponse.json({ item: { ...item, body: result.body } });
      } catch (error) {
        const described = describeAiError(error);
        return NextResponse.json({ error: described.message }, { status: described.status });
      }
    }

    // 本文の手直しを保存するだけ
    if (body.action === "save") {
      const text = str(body.body, 20000) ?? "";
      updateInboxBody(id, text);
      return NextResponse.json({ item: { ...item, body: text } });
    }

    const status = oneOf(body.status, STATUSES);
    if (!status) {
      return NextResponse.json({ error: "status は approved / rejected です" }, { status: 400 });
    }
    const note = str(body.note, 1000) ?? "";

    const decided = decideInbox(id, status, note);
    if (!decided) return NextResponse.json({ error: "見つかりません" }, { status: 404 });

    // 案件に紐づくものは、案件側の状態も進める。
    // ただし危険通知やレポートは「読んだ/読んでいない」の話なので、
    // これを却下しても案件を「落選」にしてはいけない。
    const advancesLead = ["proposal", "outreach", "listing", "deliverable"].includes(item.kind);
    if (item.leadId && advancesLead) {
      // 承認は「この内容で出す」という意思表示であって、応募はまだ済んでいない。
      // 実際に送ったら leads の状態を applied に進める（/api/hustle/agent/leads/[id]）。
      // 却下は「出さない」なので rejected。lost は応募後に返事が無かったときに使う。
      updateLead(item.leadId, { status: status === "approved" ? "approved" : "rejected" });
    }

    // 出品案を承認したら、出品として記録する。
    //
    // ここが抜けていたので、出品の記録テーブルは**一度も書かれていませんでした**。
    // 読む側（listing-tracker / next-action）は実装されていたのに、
    // 中身が常に空なので「見られていない出品はありませんか」の確認が
    // 永久に動かない状態でした。
    //
    // 承認は「この内容で出す」という意思表示であって、まだ出品はされていません。
    // URL と閲覧数は、実際に出したあとに本人が入れます。
    if (status === "approved" && item.kind === "listing") {
      const meta = item.meta as { workTypeId?: string; priceJpy?: number };
      if (typeof meta.workTypeId === "string" && meta.workTypeId) {
        const listing = upsertPublishedListing({
          workTypeId: meta.workTypeId,
          title: item.title.replace(/^出品案:\s*/, "").replace(/（.*$/, ""),
          platformId: "coconala",
          priceJpy: typeof meta.priceJpy === "number" ? meta.priceJpy : 0,
          // まだ出品していないので、出品日は空。実際に出したら
          // 出品ページで「出品中」に切り替えた日を出品日として記録する。
          publishedAt: "",
          status: "approved",
        });
        logEvent(item.runId || "manual", "listing", "action", `出品内容を確定として記録しました（まだ未出品）: ${listing.title}`, {
          listingId: listing.id,
          workTypeId: meta.workTypeId,
        });
      }
    }

    // 「撤退しますか」を承認したら、実際にチャネルを止める
    if (status === "approved" && item.meta.action === "kill_path" && typeof item.meta.pathId === "string") {
      const path = readPaths().find((p) => p.id === item.meta.pathId);
      if (path) {
        updatePath(path.id, { status: "killed" });
        logEvent(item.runId || "manual", "runner", "action", `「${path.name}」を撤退として止めました`, {
          pathId: path.id,
        });
      }
    }

    logEvent(
      item.runId || "manual",
      "runner",
      "decision",
      `${status === "approved" ? "承認" : "却下"}: ${item.title.slice(0, 50)}${note ? `（${note.slice(0, 60)}）` : ""}`,
      { inboxId: id, status }
    );

    return NextResponse.json({ item: decided });
  });
}
