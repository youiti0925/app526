/**
 * クラウドワークスの応募画面に、提案文・金額・納期を入力して止める部品（cw-patrol.mjs fill から使う）。
 *
 * 守ること（変えない）:
 *   - 「応募する」「送信する」「確認」などのボタンは押さない。フォームの submit も呼ばない
 *   - 触るのは下の FIELDS に書いた欄だけ（ページ上部の「ご意見箱」の textarea などには触らない）
 *   - 入力したら画面を開いたまま止め、中身を見て押すのはユーザー
 *
 * 入力欄の形は 2026-10-19 に本物の応募画面（/proposals/new?job_offer_id=…）で確かめた。
 */

export const MAX_TABS = 5;

/** 本物の応募画面で確かめた入力欄。id で指す（name に [] があり、セレクタが崩れやすいため）。 */
export const FIELDS = {
  message: "#proposal_conditions_attributes_0_message_attributes_body",
  paymentFixed: "#proposal_conditions_attributes_0_payment_type_fixed_price",
  paymentHourly: "#proposal_conditions_attributes_0_payment_type_hourly",
  presentContractFixed: "#how_to_present_fixed_price_contract_amount",
  presentContractHourly: "#how_to_present_hourly_contract_amount",
  amount: "#amount_dummy_",
  hourlyWage: "#hourly_wage_dummy_",
  deadlineYear: "#proposal_conditions_attributes_0_milestones_attributes_0_deadline_1i",
  deadlineMonth: "#proposal_conditions_attributes_0_milestones_attributes_0_deadline_2i",
  deadlineDay: "#proposal_conditions_attributes_0_milestones_attributes_0_deadline_3i",
};

/** 募集のURL（または番号）から募集の番号を取り出す。クラウドワークス以外は null。 */
export function jobIdFromUrl(input) {
  const s = String(input ?? "").trim();
  if (/^\d{5,}$/.test(s)) return s;
  let u;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.hostname !== "crowdworks.jp") return null;
  const m = u.pathname.match(/^\/public\/jobs\/(\d+)/) ?? null;
  if (m) return m[1];
  if (u.pathname.startsWith("/proposals/new")) return u.searchParams.get("job_offer_id")?.match(/^\d+$/)?.[0] ?? null;
  return null;
}

/**
 * 募集ページの <title> から、募集の題名だけを取り出す。
 * 形: 「題名 | 在宅ワーク・副業するなら【クラウドワークス】 [ID:13544312]」。
 * 題名の中にも「|」「｜」が入る(例:「【急募 | 初心者OK】…」)ので、先頭から切らず、
 * 最後の「 | サイト名」と「[ID:…]」だけを取り除く。
 */
export function cleanJobTitle(raw) {
  let t = String(raw ?? "").replace(/\s*\[ID:\d+\]\s*$/, "").trim();
  const m = t.match(/^(.*\S)\s*[|｜]\s*[^|｜]*(?:クラウドワークス|CrowdWorks)[^|｜]*$/i);
  if (m) t = m[1].trim();
  return t;
}

export const applyUrl = (jobId) => `https://crowdworks.jp/proposals/new?job_offer_id=${jobId}`;
export const jobUrl = (jobId) => `https://crowdworks.jp/public/jobs/${jobId}`;

/**
 * 募集ページの文字とリンクから、応募できる状態かを見る。
 * 応募できないときは理由を返す（締切・応募済み・募集終了・ログイン切れ）。
 */
export function applyState({ text = "", hrefs = [], finalUrl = "" }) {
  if (/\/login(\b|\/|\?|$)/.test(finalUrl)) return { ok: false, reason: "ログインが切れています（setup でログインし直してください）" };
  if (/応募済み|既に応募|すでに応募/.test(text)) return { ok: false, reason: "応募済みです" };
  if (/募集(は)?終了|募集を終了|掲載(は)?終了|この仕事は(現在)?募集していません|応募期限を過ぎ/.test(text)) return { ok: false, reason: "募集が終わっています" };
  const hasApply = hrefs.some((h) => /\/proposals\/new\?job_offer_id=\d+/.test(h));
  if (!hasApply) return { ok: false, reason: "応募画面へのリンクがありません（締切・応募済み・タスク形式のどれかです）" };
  return { ok: true, reason: "" };
}

/** 今日から days 日後の年・月・日（日本時間）。 */
export function deadlineParts(days, now = new Date()) {
  const jst = new Date(now.getTime() + 9 * 3600_000);
  jst.setUTCDate(jst.getUTCDate() + Number(days));
  return { year: String(jst.getUTCFullYear()), month: String(jst.getUTCMonth() + 1), day: String(jst.getUTCDate()) };
}

/** --list のファイル（1行に「URL<TAB>提案文.txt<TAB>金額<TAB>日数」。金額・日数は省略可、# で始まる行は飛ばす）を読む。 */
export function parseList(text) {
  return String(text)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const [url, proposal, price, days] = l.split("\t").map((c) => c?.trim());
      return { url, proposal, price: price ? Number(price.replace(/[,円]/g, "")) : undefined, days: days ? Number(days) : undefined };
    });
}

/** 入力内容の確かめ（足りない・おかしい値は先に止める）。 */
export function validateEntry(e) {
  const problems = [];
  if (!jobIdFromUrl(e.url)) problems.push(`クラウドワークスの募集のURLではありません: ${e.url}`);
  if (!e.message || !e.message.trim()) problems.push("提案文が空です");
  // 確認が済んでいない書きかけの提案文は、送る直前まで進めない（残った印を見落とさないため）
  const left = (e.message ?? "").match(/【要確認[^】]*】|\[要確認[^\]]*\]|［要確認[^］]*］|〇〇|○○|ＸＸ|XXX/);
  if (left) problems.push(`提案文に書きかけの印が残っています（${left[0].slice(0, 30)}）。事実を確かめて書き直してから入力します: ${e.url}`);
  if (e.price !== undefined && !(Number.isInteger(e.price) && e.price > 0 && e.price < 10_000_000)) problems.push(`金額がおかしいです: ${e.price}`);
  if (e.days !== undefined && !(Number.isInteger(e.days) && e.days >= 1 && e.days <= 365)) problems.push(`日数がおかしいです: ${e.days}`);
  return problems;
}

/**
 * 開いた応募画面に入力する。押すのはラジオボタン（支払い方式・金額の出し方）だけで、送信系のボタンには触らない。
 * page は Playwright の Page（試験では同じ形の偽物）。入力した欄と、入力できなかった欄を返す。
 */
export async function fillProposalForm(page, { message, price, days, now = new Date() }) {
  const done = [];
  const skipped = [];
  const visible = async (sel) => (await page.locator(sel).count()) > 0 && (await page.locator(sel).first().isVisible());

  if (!(await visible(FIELDS.message))) throw new Error("提案文の欄が見つかりません（応募画面の形が変わったか、応募できない状態です）");
  await page.locator(FIELDS.message).first().fill(message);
  done.push("提案文");

  if (price !== undefined) {
    // 時間単価の欄が見えていれば時間単価制、そうでなければ固定報酬制の金額欄に入れる
    const hourly = await visible(FIELDS.hourlyWage);
    const amountSel = hourly ? FIELDS.hourlyWage : FIELDS.amount;
    const presentSel = hourly ? FIELDS.presentContractHourly : FIELDS.presentContractFixed;
    if (!hourly && (await page.locator(FIELDS.paymentFixed).count()) > 0 && !(await visible(FIELDS.amount))) {
      await page.locator(FIELDS.paymentFixed).first().check();
    }
    if ((await page.locator(presentSel).count()) > 0) await page.locator(presentSel).first().check();
    if (await visible(amountSel)) {
      const box = page.locator(amountSel).first();
      await box.fill(String(price));
      await box.press("Tab"); // 画面の計算（手数料・受取額）を動かす
      done.push(hourly ? `時間単価 ${price}円（契約金額・税抜として）` : `金額 ${price}円（契約金額・税抜として）`);
    } else skipped.push("金額（欄が見えません）");
  }

  if (days !== undefined) {
    const d = deadlineParts(days, now);
    if ((await visible(FIELDS.deadlineYear)) && (await visible(FIELDS.deadlineMonth)) && (await visible(FIELDS.deadlineDay))) {
      await page.locator(FIELDS.deadlineYear).first().selectOption(d.year);
      await page.locator(FIELDS.deadlineMonth).first().selectOption(d.month);
      await page.locator(FIELDS.deadlineDay).first().selectOption(d.day);
      done.push(`納期 ${d.year}/${d.month}/${d.day}`);
    } else skipped.push("納期（欄が見えません。時間単価制の募集では納期の欄がありません）");
  }
  return { done, skipped };
}
