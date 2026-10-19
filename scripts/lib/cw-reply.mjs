/**
 * クラウドワークスのやり取り画面に返信を入れる部品（cw-patrol.mjs reply から使う）。
 *
 * 守ること（変えない）:
 *   - 送ってよいのは、ゆうが許可した種類だけ（下の SEND_KINDS）。応募・納品・金額や条件の交渉は含まない
 *   - 送るのは、PCの設定で autoSend を「オン」にしてあるときだけ（初期はオフ。入力して止まるだけ）
 *   - ゆっくり1件ずつ（前の送信から間をあけ、1日の上限つき）。同じやり取りに同じ種類を2回送らない
 *   - 送る前に「今から◯◯に△△を送ります」とスレッドで伝えたことを記録に残す（--announced）
 *   - 送った文と日時は sent-log.jsonl に残す。連絡先（URL・メール・電話番号）を含む文は送らない
 *   - 触るのは、返信の入力欄と送信ボタンの1組だけ。ご意見箱など別の欄は触らない。見つからない・複数あるときは止まる
 */

/** 自動で送ってよい種類（ゆうが許可: 外部での連絡が必要な理由を聞く質問）。 */
export const SEND_KINDS = {
  "reason-question": "外部でのやり取りが必要な理由を、やり取りの中で聞く質問",
};

const DEFAULTS = { minGapMinutes: 10, maxPerDay: 3 };

/** 返信を入れてよいクラウドワークスのやり取りのURLか（契約・応募・メッセージの画面）。 */
export function isThreadUrl(url) {
  let u;
  try {
    u = new URL(String(url));
  } catch {
    return false;
  }
  return u.protocol === "https:" && u.hostname === "crowdworks.jp" && /^\/(contracts|proposals|messages)\/\d+\/?$/.test(u.pathname);
}

/** 送る文の確かめ（空・書きかけの印・連絡先つきは止める）。問題の一覧を返す。 */
export function validateReplyText(text) {
  const problems = [];
  const t = String(text ?? "").trim();
  if (!t) problems.push("送る文が空です");
  if (t.length > 3000) problems.push("送る文が長すぎます（3000字まで）");
  const left = t.match(/【要確認[^】]*】|\[要確認[^\]]*\]|［要確認[^］]*］|〇〇|○○|ＸＸ|XXX/);
  if (left) problems.push(`書きかけの印が残っています（${left[0].slice(0, 30)}）`);
  if (/https?:\/\/|www\./i.test(t)) problems.push("文にURLが入っています（連絡先やリンクは送りません）");
  if (/[\w.+-]+@[\w-]+\.[\w.-]+/.test(t)) problems.push("文にメールアドレスが入っています");
  if (/0\d{1,4}[-ー−\s]?\d{1,4}[-ー−\s]?\d{3,4}/.test(t)) problems.push("文に電話番号らしい数字が入っています");
  return problems;
}

const jstDay = (d) => new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10);

/**
 * 送ってよいかの門番。ok:false のときは理由を返す（送らない）。
 *   config.autoSend = { enabled, kinds?, minGapMinutes?, maxPerDay?, termsChecked }
 *   sentLog = これまでの送信記録（{ at, url, kind }[]）
 */
export function sendGate({ config, sentLog = [], url, kind, now = new Date() }) {
  const a = config?.autoSend;
  if (!a || a.enabled !== true) return { ok: false, reason: "自動送信はオフです（`autosend on` でオンにします。初期はオフ）" };
  if (!a.termsChecked) return { ok: false, reason: "規約の原文を確かめた記録がありません（autosend on --terms-checked \"確かめた日と所見\"）" };
  if (!SEND_KINDS[kind]) return { ok: false, reason: `許可されていない種類です: ${kind}（送ってよいのは ${Object.keys(SEND_KINDS).join("・")} だけ）` };
  if (a.kinds && !a.kinds.includes(kind)) return { ok: false, reason: `この設定では ${kind} は自動送信しません` };
  if (!isThreadUrl(url)) return { ok: false, reason: "クラウドワークスのやり取りのURLではありません" };
  if (sentLog.some((l) => l.url === url && l.kind === kind)) return { ok: false, reason: "このやり取りには、同じ種類をもう送っています" };
  const gap = (a.minGapMinutes ?? DEFAULTS.minGapMinutes) * 60_000;
  const last = sentLog.map((l) => new Date(l.at).getTime()).filter(Number.isFinite).sort((x, y) => y - x)[0];
  if (last !== undefined && now.getTime() - last < gap) {
    const wait = Math.ceil((gap - (now.getTime() - last)) / 60_000);
    return { ok: false, reason: `前の送信からまだ間があいていません（あと約${wait}分あけます）` };
  }
  const today = sentLog.filter((l) => jstDay(new Date(l.at)) === jstDay(now)).length;
  const max = a.maxPerDay ?? DEFAULTS.maxPerDay;
  if (today >= max) return { ok: false, reason: `今日はもう ${today} 件送りました（1日 ${max} 件まで）` };
  return { ok: true, reason: "" };
}

/**
 * ブラウザの中で動かして、画面の入力欄と近くのボタンの形を集める（page.evaluate に渡す）。
 * 見つけた欄・ボタンには data-cwp-ta / data-cwp-btn の印を付け、あとで指せるようにする（画面の見た目は変えない）。
 */
export function scanReplyForms() {
  const shown = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
  };
  const out = [];
  [...document.querySelectorAll("textarea")].forEach((ta, i) => {
    ta.setAttribute("data-cwp-ta", String(i));
    const form = ta.closest("form");
    const buttons = [];
    if (form) {
      [...form.querySelectorAll("button, input[type=submit], input[type=button]")].forEach((b, j) => {
        b.setAttribute("data-cwp-btn", `${i}-${j}`);
        buttons.push({
          key: `${i}-${j}`,
          label: (b.innerText || b.value || b.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim(),
          type: b.type || "",
          shown: shown(b),
          disabled: !!b.disabled,
          // 画面の作りを調べる用(--dump)。値や本文は含めず、タグと属性だけ
          html: b.cloneNode(false).outerHTML.slice(0, 200),
        });
      });
    }
    out.push({
      index: i,
      id: ta.id || "",
      name: ta.getAttribute("name") || "",
      placeholder: ta.getAttribute("placeholder") || "",
      formAction: form ? form.getAttribute("action") || "" : "",
      formHtml: form ? form.cloneNode(false).outerHTML.slice(0, 240) : "",
      html: ta.cloneNode(false).outerHTML.slice(0, 240),
      ancestors: (() => {
        const a = [];
        for (let e = ta.parentElement; e && a.length < 5; e = e.parentElement) a.push(`${e.tagName.toLowerCase()}${e.id ? `#${e.id}` : ""}${e.className && typeof e.className === "string" ? `.${e.className.trim().split(/\s+/).slice(0, 3).join(".")}` : ""}`);
        return a;
      })(),
      inDialog: !!ta.closest("[role=dialog], dialog, .modal, [class*=modal], [class*=dialog]"),
      shown: shown(ta),
      value: ta.value || "",
      buttons,
    });
  });
  return out;
}

const NOT_REPLY = /feedback|opinion|ご意見|意見箱|search|検索|report|通報|違反|memo|メモ|milestones|complete|納品|完了報告/i;
const SEND_LABEL = /送信|返信|投稿/;
const DELIVERY_LABEL = /納品|完了報告/;
const NOT_SEND_LABEL = /キャンセル|削除|下書き|取り消|閉じる|ご意見|通報|違反/;

/**
 * scanReplyForms の結果から、返信の入力欄と送信ボタンの1組を選ぶ。
 * ちょうど1組に絞れないときは選ばず、理由と見つけたものの一覧を返す（呼び出し側は止まる）。
 */
export function pickReplyForm(forms) {
  const seen = (forms ?? []).map((f) => `textarea#${f.id || "-"} name=${f.name || "-"} 見える=${f.shown} ボタン=[${f.buttons.map((b) => b.label || b.type).join("|")}]`);
  const candidates = [];
  for (const f of forms ?? []) {
    if (!f.shown || f.inDialog) continue;
    if (NOT_REPLY.test(`${f.id} ${f.name} ${f.placeholder} ${f.formAction}`)) continue;
    const sends = f.buttons.filter(
      (b) => b.shown && !b.disabled && !NOT_SEND_LABEL.test(b.label) && !DELIVERY_LABEL.test(b.label) && (SEND_LABEL.test(b.label) || (b.label === "" && b.type === "submit"))
    );
    if (sends.length !== 1) continue;
    candidates.push({ form: f, button: sends[0] });
  }
  if (candidates.length === 1) return { ok: true, textarea: `[data-cwp-ta="${candidates[0].form.index}"]`, button: `[data-cwp-btn="${candidates[0].button.key}"]`, buttonLabel: candidates[0].button.label, seen };
  return { ok: false, reason: candidates.length === 0 ? "返信の入力欄と送信ボタンの組が見つかりません" : "返信の入力欄らしい組が複数あり、どれか決められません", seen };
}

/** 送信後の画面に、送った文の頭の部分が出ているか（出ていなければ送れていない可能性がある）。 */
export function sentTextAppears(pageText, text) {
  const head = String(text).replace(/\s+/g, "").slice(0, 24);
  return head.length > 0 && String(pageText).replace(/\s+/g, "").includes(head);
}

/** 送信記録（jsonl）を読む。壊れた行は飛ばす。 */
export function parseSentLog(raw) {
  return String(raw ?? "")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter((x) => x && x.url && x.kind && x.at);
}
