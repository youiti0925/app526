import { NextRequest, NextResponse } from "next/server";
import { decideInbox, logEvent, readInboxItem, updateInboxBody, updateLead } from "@/lib/hustle/agent/db";
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
      updateLead(item.leadId, { status: status === "approved" ? "applied" : "lost" });
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
