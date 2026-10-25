/**
 * 巡回のメールを「1日1回」にまとめる。
 * 巡回（CW・ランサーズ）は今までどおり3時間ごとに動き、送るはずだったメールはここに溜める。
 * 朝8時（日本時間）以降の最初の巡回で、その日の分を1通にして、自分宛てに送る。
 * 溜めたメールは %USERPROFILE%\.cw-patrol\mail-digest.json に置く（リポジトリには入れない）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const DEFAULT_FILE = path.join(process.env.CW_PATROL_HOME || path.join(os.homedir(), ".cw-patrol"), "mail-digest.json");
/** この時刻（日本時間）より前には送らない */
export const SEND_HOUR_JST = 8;
const MAX_ENTRIES = 12;
const KEEP_MS = 48 * 3600_000;

const jst = (d) => {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(d)
      .map((x) => [x.type, x.value])
  );
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), label: `${Number(p.month)}/${Number(p.day)} ${p.hour}:${p.minute}` };
};

function load(file) {
  try {
    const s = JSON.parse(fs.readFileSync(file, "utf8"));
    return { lastSentDate: s.lastSentDate ?? null, entries: Array.isArray(s.entries) ? s.entries : [] };
  } catch {
    return { lastSentDate: null, entries: [] };
  }
}
function save(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 1));
  fs.renameSync(tmp, file);
}

const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** 溜めたメールから、1通ぶんの件名・本文・HTMLを作る。 */
export function buildDigest(entries, now = new Date()) {
  const label = (e) => jst(new Date(e.at)).label;
  const subjects = [...new Set(entries.map((e) => e.subject.replace(/^【[^】]*】/, "").trim()))];
  const subject = `【今日のまとめ】${jst(now).date.slice(5).replace("-", "/")} ${subjects.slice(0, 3).join("／")}${subjects.length > 3 ? "…" : ""}`;
  const body = entries.map((e) => `━━ ${label(e)} の${e.source}巡回 ━━\n${e.subject}\n\n${e.body}`).join("\n\n\n");
  const sections = entries.map((e) => {
    const head = `<div style="margin:22px 4px 8px 4px;font-size:13px;font-weight:bold;color:#6b7280">🕗 ${esc(label(e))} の${esc(e.source)}巡回</div>`;
    if (e.html) {
      const inner = e.html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? e.html;
      return head + inner.replace(/^<div style="max-width:600px[^>]*>/, "<div>");
    }
    return head + `<div style="background:#ffffff;border-radius:16px;padding:16px;font-size:14px;line-height:1.7;color:#1f2937;white-space:pre-wrap;word-break:break-all">${esc(e.body)}</div>`;
  });
  const html =
    `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>今日のまとめ</title></head>` +
    `<body style="margin:0;padding:0;background:#f2f4f8;font-family:-apple-system,'Hiragino Sans','Yu Gothic','Meiryo',sans-serif"><div style="max-width:600px;margin:0 auto;padding:16px 12px 28px 12px">` +
    `<div style="background:#2563eb;border-radius:18px;padding:16px;color:#ffffff;text-align:center"><div style="font-size:14px;opacity:.9">巡回のメールは1日1回にまとめています</div><div style="font-size:22px;font-weight:bold;margin-top:4px">${esc(subjects.join("／"))}</div></div>` +
    sections.join("") +
    `</div></body></html>`;
  return { subject, body, html };
}

function mime({ from, to, subject, body, html, now }) {
  const enc = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`);
  const b64 = (t) => Buffer.from(t.replace(/\r?\n/g, "\r\n"), "utf8").toString("base64").match(/.{1,76}/g) ?? [""];
  const boundary = `cwpatrol-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return [
    `From: ${from}`, `To: ${to}`, `Subject: ${enc(subject)}`, `Date: ${now.toUTCString()}`, "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`, "",
    `--${boundary}`, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", ...b64(body),
    `--${boundary}`, "Content-Type: text/html; charset=UTF-8", "Content-Transfer-Encoding: base64", "", ...b64(html),
    `--${boundary}--`, "",
  ].join("\r\n");
}

/**
 * entry（今回送るはずだったメール。無ければ null）を溜め、送る時刻なら溜めた分を1通にして送る。
 * 戻り値: "sent"（送った）／"held"（溜めた。次は朝8時以降）／"none"（溜まっているものが無い）／"failed"（送れず、溜めたまま）
 * send(message) が実際に送る関数。force なら時刻と回数を無視して今送る（--always 用）。
 */
export async function deliverDaily({ file = DEFAULT_FILE, source, entry, from, to, send, now = new Date(), force = false, log = () => {} }) {
  const state = load(file);
  const cutoff = now.getTime() - KEEP_MS;
  state.entries = state.entries.filter((e) => new Date(e.at).getTime() > cutoff);
  if (entry) {
    const dup = state.entries.some((e) => e.source === source && e.subject === entry.subject && e.body === entry.body);
    if (!dup) state.entries.push({ source, at: now.toISOString(), subject: entry.subject, body: entry.body, ...(entry.html ? { html: entry.html } : {}) });
    state.entries = state.entries.slice(-MAX_ENTRIES);
  }
  const t = jst(now);
  const due = force || (state.entries.length > 0 && t.hour >= SEND_HOUR_JST && state.lastSentDate !== t.date);
  if (!due) {
    save(file, state);
    return state.entries.length ? "held" : "none";
  }
  if (!state.entries.length) {
    save(file, state);
    return "none";
  }
  const d = buildDigest(state.entries, now);
  try {
    await send(mime({ from, to, subject: d.subject, body: d.body, html: d.html, now }));
  } catch (e) {
    save(file, state);
    log(`まとめメールを送れませんでした（溜めたままにして、次の巡回でもう一度送ります）: ${e.message}`);
    return "failed";
  }
  save(file, { lastSentDate: t.date, entries: [] });
  return "sent";
}
