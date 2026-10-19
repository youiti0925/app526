/**
 * 巡回のまとめを、スマホで見やすい HTML メールにする（文字だけのメールの代わり）。
 *
 * - 1件ずつカードにする。金額・期限・依頼者の評価を大きく出す
 * - 危ない相手は赤、おすすめは緑、確認が要るものは黄色
 * - やることはボタン1つ（応募画面／やり取りをひらく）。送信はしない
 * Gmail は <style> を落とすことがあるので、見た目はすべてタグに直接書く。
 */
import type { JudgedJob, QueueItem, ReportInput } from "./patrol-core";
import { cleanProposal, jobReason, messageNotes, sortQueue } from "./patrol-core";

const WANT = ["応募してよい", "確認してから応募"];

const C = {
  bg: "#f2f4f8",
  card: "#ffffff",
  text: "#1f2937",
  sub: "#6b7280",
  line: "#e5e7eb",
  green: "#16a34a",
  greenBg: "#dcfce7",
  red: "#dc2626",
  redBg: "#fee2e2",
  amber: "#b45309",
  amberBg: "#fef3c7",
  blue: "#2563eb",
  blueBg: "#dbeafe",
  gray: "#4b5563",
  grayBg: "#f3f4f6",
};

export function escapeHtml(t: string): string {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** 文字を HTML にして、URL はリンクにする（改行は <br>） */
function richText(t: string): string {
  return escapeHtml(t)
    .replace(/https?:\/\/[^\s<>"）」]+/g, (u) => `<a href="${u}" style="color:${C.blue};word-break:break-all">${u}</a>`)
    .replace(/\n/g, "<br>");
}

const shortTitle = (title: string): string => {
  const t = title
    .replace(/^(相談から契約まで|契約詳細)[：:]\s*/, "")
    .replace(/【(クラウドワークス|新着)】/g, "")
    .trim();
  return t.length > 50 ? `${t.slice(0, 50)}…` : t;
};

const badge = (text: string, fg: string, bg: string) =>
  `<span style="display:inline-block;padding:3px 10px;margin:0 4px 4px 0;border-radius:999px;background:${bg};color:${fg};font-size:13px;font-weight:bold">${escapeHtml(text)}</span>`;

const button = (label: string, url: string, color: string) =>
  `<a href="${escapeHtml(url)}" style="display:block;text-align:center;padding:14px 10px;margin-top:14px;border-radius:12px;background:${color};color:#ffffff;font-size:17px;font-weight:bold;text-decoration:none">${escapeHtml(label)}</a>`;

const card = (inner: string, accent: string) =>
  `<div style="background:${C.card};border-radius:16px;border-top:6px solid ${accent};padding:16px;margin:0 0 14px 0;box-shadow:0 1px 3px rgba(0,0,0,.08)">${inner}</div>`;

const heading = (emoji: string, text: string, note = "") =>
  `<div style="margin:26px 4px 10px 4px"><div style="font-size:20px;font-weight:bold;color:${C.text}">${emoji} ${escapeHtml(text)}</div>${note ? `<div style="font-size:13px;color:${C.sub};margin-top:2px">${escapeHtml(note)}</div>` : ""}</div>`;

/** 大きい数字の箱（報酬・期限・依頼者） */
const stat = (label: string, value: string, sub = "") =>
  `<td style="width:33%;padding:4px;vertical-align:top"><div style="background:${C.grayBg};border-radius:10px;padding:8px 6px;text-align:center">` +
  `<div style="font-size:12px;color:${C.sub}">${escapeHtml(label)}</div>` +
  `<div style="font-size:18px;font-weight:bold;color:${C.text};margin-top:2px;word-break:break-all">${escapeHtml(value)}</div>` +
  (sub ? `<div style="font-size:11px;color:${C.sub};margin-top:2px">${escapeHtml(sub)}</div>` : "") +
  `</div></td>`;

const stats = (cells: string[]) => `<table role="presentation" style="width:100%;border-collapse:collapse;margin-top:10px"><tr>${cells.join("")}</tr></table>`;

const title = (t: string) => `<div style="font-size:18px;font-weight:bold;color:${C.text};margin-top:6px;line-height:1.4">${escapeHtml(t)}</div>`;

const small = (t: string) => `<div style="font-size:14px;color:${C.gray};margin-top:8px;line-height:1.6">${t}</div>`;

const box = (head: string, body: string, fg: string, bg: string) =>
  `<div style="background:${bg};border-radius:10px;padding:10px 12px;margin-top:10px"><div style="font-size:13px;font-weight:bold;color:${fg}">${escapeHtml(head)}</div><div style="font-size:14px;color:${C.text};margin-top:4px;line-height:1.6">${body}</div></div>`;

const list = (items: string[]) => items.map((i) => `・${richText(i)}`).join("<br>");

function payValue(i: QueueItem): { value: string; sub: string } {
  if (i.price !== null) {
    const unit = i.payType === "時間単価" ? "円/時" : "円";
    return { value: `${i.price.toLocaleString()}${unit}`, sub: i.payType === "不明" ? "" : i.payType };
  }
  const first = i.payText.split("。")[0];
  return { value: first.length > 14 ? `${first.slice(0, 14)}…` : first || "—", sub: "" };
}

const TIER_COLOR: Record<QueueItem["client"]["tier"], [string, string]> = {
  優良: [C.green, C.greenBg],
  普通: [C.blue, C.blueBg],
  初めて: [C.amber, C.amberBg],
  不明: [C.gray, C.grayBg],
  注意: [C.red, C.redBg],
};

function queueCard(i: QueueItem): string {
  const good = i.verdict.startsWith("応募してよい");
  const accent = i.client.tier === "注意" || i.aiRestriction ? C.red : good ? C.green : C.amber;
  const [tf, tb] = TIER_COLOR[i.client.tier];
  const badges =
    (good ? badge("🟢 おすすめ", C.green, C.greenBg) : badge("🟡 確認してから", C.amber, C.amberBg)) +
    badge(`依頼者: ${i.client.tier}`, tf, tb) +
    (i.aiRestriction ? badge("⚠ AI禁止あり", C.red, C.redBg) : "");
  const pay = payValue(i);
  const c = i.client;
  const proposal = cleanProposal(i.proposal);
  return card(
    `<div style="font-size:13px;color:${C.sub}">No.${i.no}</div>` +
      badges +
      title(shortTitle(i.title)) +
      stats([
        stat("💴 報酬", pay.value, pay.sub),
        stat("⏰ 応募期限", i.deadline ?? "—"),
        stat("⭐ 依頼者", c.rating !== null ? `★${c.rating}` : "—", `発注${c.orders ?? "—"}件${c.completionRate !== null ? `・完了${c.completionRate}%` : ""}`),
      ]) +
      small(`👥 ${i.applicants !== null ? `${i.applicants}人が応募中` : "応募人数は読めず"}${i.openings ? `（募集${i.openings}人）` : ""}`) +
      (i.reason ? small(`💡 ${escapeHtml(i.reason)}`) : "") +
      (i.aiRestriction ? box("⚠ AIの使用について", richText(i.aiRestriction), C.red, C.redBg) : "") +
      (i.checks.length ? box("✅ 送る前に見ること", list(i.checks), C.amber, C.amberBg) : "") +
      box("📝 提案文（入力済みになります）", proposal ? richText(proposal) : "（なし）", C.gray, C.grayBg) +
      button("応募画面をひらく", i.applyUrl, good ? C.green : C.amber) +
      `<div style="text-align:center;margin-top:8px;font-size:13px"><a href="${escapeHtml(i.url)}" style="color:${C.blue}">募集ページを見る</a></div>`,
    accent
  );
}

function jobCard(j: JudgedJob): string {
  const good = j.verdict.startsWith("応募してよい");
  return card(
    (good ? badge("🟢 おすすめ", C.green, C.greenBg) : badge("🟡 確認してから", C.amber, C.amberBg)) +
      title(shortTitle(j.title)) +
      box("判定", richText(j.detail.trim()), C.gray, C.grayBg) +
      button("募集ページをひらく", j.url, good ? C.green : C.amber),
    good ? C.green : C.amber
  );
}

export interface ReportHtmlInput extends ReportInput {
  /** まとめの末尾に小さく出す補足（単価の記録など） */
  notes?: string[];
}

/** 巡回のまとめ（buildReport と同じ中身）を、HTMLメールの本文にする。 */
export function buildReportHtml(input: ReportHtmlInput): string {
  const parts: string[] = [];

  if (input.loginExpired) {
    parts.push(
      card(
        `<div style="font-size:40px;text-align:center">🔑</div>` +
          `<div style="font-size:20px;font-weight:bold;text-align:center;color:${C.red}">ログインが切れました</div>` +
          small("クラウドワークスのログインが切れていて、巡回できませんでした。") +
          box("やること（1つだけ）", "PCで「cw-patrol-setup」をもう一度実行して、ログインし直してください。<br>パスワードはあなたのPCのブラウザにだけ入力します。", C.red, C.redBg),
        C.red
      )
    );
    return page("ログインが切れました", parts.join(""));
  }

  const risky = input.threads.filter((t) => t.review.scam && t.review.scam.verdict !== "safe");
  const riskySet = new Set(risky);
  const skipped = input.threads.filter((t) => !riskySet.has(t) && t.review.skipReasons?.length);
  const skippedSet = new Set(skipped);
  const reply = input.threads.filter(
    (t) => !riskySet.has(t) && !skippedSet.has(t) && (t.review.waiting === "me" || t.review.flags.some((f) => f.includes("提示額")))
  );
  const picks = input.jobs.filter((j) => WANT.some((w) => j.verdict.startsWith(w)));
  const others = input.jobs.filter((j) => !picks.includes(j));
  const scanCandidates = input.scan?.candidates ?? 0;
  const todo = picks.length + reply.length + scanCandidates;
  const noteMap = new Map(messageNotes(input.threads).map((n) => [n.url, n]));

  // いちばん上: 今やることの数を大きく
  const chip = (emoji: string, label: string, n: number, fg: string, bg: string) =>
    n ? `<td style="padding:4px;width:33%"><div style="background:${bg};border-radius:12px;padding:10px 4px;text-align:center"><div style="font-size:22px">${emoji}</div><div style="font-size:24px;font-weight:bold;color:${fg}">${n}</div><div style="font-size:12px;color:${fg}">${escapeHtml(label)}</div></div></td>` : "";
  const chips = [
    chip("🟢", "応募を考える", picks.length + scanCandidates, C.green, C.greenBg),
    chip("💬", "返事を考える", reply.length, C.blue, C.blueBg),
    chip("🔴", "危ない相手", risky.length, C.red, C.redBg),
  ].filter(Boolean);
  parts.push(
    `<div style="background:${todo ? C.blue : C.green};border-radius:18px;padding:20px 16px;color:#ffffff;text-align:center">` +
      `<div style="font-size:14px;opacity:.9">クラウドワークス巡回のまとめ</div>` +
      `<div style="font-size:30px;font-weight:bold;margin-top:4px">${todo ? `今やること ${todo}件` : "今やることはありません 🎉"}</div>` +
      (input.queue?.added.length ? `<div style="font-size:14px;margin-top:6px">応募の下書き一覧に ${input.queue.added.length}件 足しました（全部で ${input.queue.pendingTotal}件）</div>` : "") +
      `</div>` +
      (chips.length ? `<table role="presentation" style="width:100%;border-collapse:collapse;margin-top:10px"><tr>${chips.join("")}</tr></table>` : "")
  );
  if (risky.length) {
    parts.push(box("🔴 危ない相手について", `危険信号の出た相手が ${risky.length}件 います。仕事は受けず、連絡先も追加しません。返事は基本しなくて大丈夫です（下に理由）。`, C.red, C.redBg));
  }

  if (picks.length) {
    parts.push(heading("🟢", `応募を考える ${picks.length}件`, "送るかどうかはあなたが決めます。こちらからは送信しません。"));
    if (input.queue?.added.length) for (const i of sortQueue(input.queue.added)) parts.push(queueCard(i));
    else for (const j of picks) parts.push(jobCard(j));
  }

  if (input.scan && scanCandidates > 0) {
    parts.push(heading("🟢", `ココナラ・ままワークスの候補 ${scanCandidates}件`, "送るかどうかはあなたが決めます。"));
    parts.push(card(`<div style="font-size:14px;color:${C.text};line-height:1.6">${richText(input.scan.body.trim())}</div>`, C.green));
  }

  if (reply.length) {
    parts.push(heading("💬", `返事を考える ${reply.length}件`));
    for (const t of reply) {
      const last = t.review.thread.messages[t.review.thread.messages.length - 1];
      const gist = noteMap.get(t.url)?.gist;
      parts.push(
        card(
          (t.changed ? badge("🆕 新着", C.blue, C.blueBg) : "") +
            title(shortTitle(t.review.thread.title)) +
            (last ? small(`👤 ${escapeHtml(last.from)}さん${t.review.daysSinceLast !== null ? `・${t.review.daysSinceLast}日前` : ""}`) : "") +
            (gist ? `<div style="background:${C.blueBg};border-radius:4px 14px 14px 14px;padding:10px 12px;margin-top:8px;font-size:15px;color:${C.text};line-height:1.6">${richText(gist)}</div>` : "") +
            (t.review.flags.length ? box("気をつけること", list(t.review.flags), C.amber, C.amberBg) : "") +
            button("やり取りをひらく", t.url, C.blue),
          C.blue
        )
      );
    }
  }

  if (risky.length) {
    parts.push(heading("🔴", `危ない相手 ${risky.length}件`, "仕事は受けません。LINEなど外の連絡先は追加しません。"));
    for (const t of risky) {
      const danger = t.review.scam?.verdict === "danger";
      const why = t.review.scam?.signals[0]?.label ?? "危険信号あり";
      const gist = noteMap.get(t.url)?.gist;
      let inner =
        badge(danger ? "🔴 危険" : "🟡 注意", danger ? C.red : C.amber, danger ? C.redBg : C.amberBg) +
        (t.changed ? badge("🆕 新着", C.blue, C.blueBg) : "") +
        title(shortTitle(t.review.thread.title)) +
        small(`理由: <b style="color:${C.red}">${escapeHtml(why)}</b>`);
      if (danger) {
        if (gist) inner += box("相手が言っていること", richText(gist), C.gray, C.grayBg);
        if (t.review.actions.length) inner += box("どうするか", list(t.review.actions), C.red, C.redBg);
        if (t.review.draftReply) inner += box("理由を聞く返信の下書き（クラウドワークスの中で）", richText(t.review.draftReply), C.gray, C.grayBg);
        inner += button("やり取りをひらく", t.url, C.red);
      } else {
        inner += small("返事はしなくて大丈夫です。");
      }
      parts.push(card(inner, danger ? C.red : C.amber));
    }
  }

  if (skipped.length) {
    parts.push(heading("⚪", `受けない型のやり取り ${skipped.length}件`, "返信しなくて大丈夫です。"));
    parts.push(
      card(
        skipped
          .map((t) => `<div style="padding:8px 0;border-bottom:1px solid ${C.line};font-size:14px;color:${C.text}"><a href="${escapeHtml(t.url)}" style="color:${C.text};font-weight:bold">${escapeHtml(shortTitle(t.review.thread.title))}</a><div style="color:${C.sub};font-size:13px;margin-top:2px">${escapeHtml(t.review.skipReasons!.join("／"))}</div></div>`)
          .join(""),
        C.gray
      )
    );
  }

  if (others.length) {
    parts.push(heading("⚪", `見送った新着 ${others.length}件`, "読んだうえで見送りました。見なくて大丈夫です。"));
    parts.push(
      card(
        others
          .map((j) => `<div style="padding:8px 0;border-bottom:1px solid ${C.line};font-size:14px"><a href="${escapeHtml(j.url)}" style="color:${C.text};font-weight:bold">${escapeHtml(shortTitle(j.title))}</a><div style="color:${C.sub};font-size:13px;margin-top:2px">${escapeHtml(j.verdict)}｜${escapeHtml(jobReason(j))}</div></div>`)
          .join(""),
        C.gray
      )
    );
  }

  if (input.errors.length || input.notes?.length) {
    const lines = [...input.errors.slice(0, 10).map((e) => `うまく読めなかった: ${e}`), ...(input.notes ?? [])];
    parts.push(`<div style="margin:20px 4px 0 4px;font-size:12px;color:${C.sub};line-height:1.6">${list(lines)}</div>`);
  }

  parts.push(
    `<div style="margin:20px 4px 0 4px;font-size:12px;color:${C.sub};line-height:1.6">` +
      "※ 危険信号が出ていないことは、安全の保証ではありません。契約と仮払いが画面に出るまで作業しないでください。<br>" +
      "※ このメールはあなたのPCの巡回が送っています。応募・返信・送信はしません。</div>"
  );
  return page(todo ? `今やること ${todo}件` : "今やることなし", parts.join(""));
}

function page(heading: string, inner: string): string {
  return (
    `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(heading)}</title></head>` +
    `<body style="margin:0;padding:0;background:${C.bg};font-family:-apple-system,'Hiragino Sans','Hiragino Kaku Gothic ProN','Yu Gothic','Meiryo',sans-serif">` +
    `<div style="max-width:600px;margin:0 auto;padding:16px 12px 28px 12px">${inner}</div></body></html>`
  );
}
