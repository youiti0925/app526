/**
 * 正規化 — データ入力仕事の土台。
 *
 * ここが甘いと後段の照合・名寄せが全部狂う。全部AIなしの決定的処理。
 * 同じ入力には必ず同じ出力を返す（毎回結果が揺れる処理はここに入れない）。
 */

/** 全角英数記号→半角、半角カナ→全角カナ、空白の統一。 */
export function normalizeWidth(text: string): string {
  return (
    text
      // 全角英数
      .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
      // 全角記号のうち、データでよく揺れるもの
      .replace(/［/g, "[")
      .replace(/］/g, "]")
      .replace(/（/g, "(")
      .replace(/）/g, ")")
      .replace(/／/g, "/")
      .replace(/．/g, ".")
      .replace(/，/g, ",")
      .replace(/：/g, ":")
      .replace(/；/g, ";")
      .replace(/－|―|‐|−/g, "-")
      .replace(/～/g, "~")
      .replace(/＠/g, "@")
      .replace(/　/g, " ")
      // 半角カナ→全角カナ（濁点結合を先に）
      .replace(/ｶﾞ/g, "ガ").replace(/ｷﾞ/g, "ギ").replace(/ｸﾞ/g, "グ").replace(/ｹﾞ/g, "ゲ").replace(/ｺﾞ/g, "ゴ")
      .replace(/ｻﾞ/g, "ザ").replace(/ｼﾞ/g, "ジ").replace(/ｽﾞ/g, "ズ").replace(/ｾﾞ/g, "ゼ").replace(/ｿﾞ/g, "ゾ")
      .replace(/ﾀﾞ/g, "ダ").replace(/ﾁﾞ/g, "ヂ").replace(/ﾂﾞ/g, "ヅ").replace(/ﾃﾞ/g, "デ").replace(/ﾄﾞ/g, "ド")
      .replace(/ﾊﾞ/g, "バ").replace(/ﾋﾞ/g, "ビ").replace(/ﾌﾞ/g, "ブ").replace(/ﾍﾞ/g, "ベ").replace(/ﾎﾞ/g, "ボ")
      .replace(/ﾊﾟ/g, "パ").replace(/ﾋﾟ/g, "ピ").replace(/ﾌﾟ/g, "プ").replace(/ﾍﾟ/g, "ペ").replace(/ﾎﾟ/g, "ポ")
      .replace(/[ｦ-ﾟ]/g, (c) => HALF_KANA[c] ?? c)
  );
}

const HALF_KANA: Record<string, string> = {
  "ｦ": "ヲ", "ｧ": "ァ", "ｨ": "ィ", "ｩ": "ゥ", "ｪ": "ェ", "ｫ": "ォ", "ｬ": "ャ", "ｭ": "ュ", "ｮ": "ョ", "ｯ": "ッ",
  "ｰ": "ー", "ｱ": "ア", "ｲ": "イ", "ｳ": "ウ", "ｴ": "エ", "ｵ": "オ", "ｶ": "カ", "ｷ": "キ", "ｸ": "ク", "ｹ": "ケ",
  "ｺ": "コ", "ｻ": "サ", "ｼ": "シ", "ｽ": "ス", "ｾ": "セ", "ｿ": "ソ", "ﾀ": "タ", "ﾁ": "チ", "ﾂ": "ツ", "ﾃ": "テ",
  "ﾄ": "ト", "ﾅ": "ナ", "ﾆ": "ニ", "ﾇ": "ヌ", "ﾈ": "ネ", "ﾉ": "ノ", "ﾊ": "ハ", "ﾋ": "ヒ", "ﾌ": "フ", "ﾍ": "ヘ",
  "ﾎ": "ホ", "ﾏ": "マ", "ﾐ": "ミ", "ﾑ": "ム", "ﾒ": "メ", "ﾓ": "モ", "ﾔ": "ヤ", "ﾕ": "ユ", "ﾖ": "ヨ", "ﾗ": "ラ",
  "ﾘ": "リ", "ﾙ": "ル", "ﾚ": "レ", "ﾛ": "ロ", "ﾜ": "ワ", "ﾝ": "ン", "ﾞ": "゛", "ﾟ": "゜",
};

/** 前後の空白・連続空白をまとめ、幅を正規化した1行テキスト。 */
export function normalizeText(text: string): string {
  return normalizeWidth(text).replace(/\s+/g, " ").trim();
}

/**
 * 日本の電話番号を数字だけに落として市外局番つきの表記へそろえる。
 * そろえられない（桁が合わない）ものは null。判断はしない、形だけ整える。
 */
export function normalizePhoneJp(raw: string): string | null {
  const digits = normalizeWidth(raw).replace(/[^\d+]/g, "").replace(/^\+81/, "0");
  if (!/^0\d{9,10}$/.test(digits)) return null;
  // フリーダイヤル・ナビダイヤル
  if (/^(0120|0800|0570)/.test(digits)) return digits.replace(/^(\d{4})(\d{3})(\d{3,4})$/, "$1-$2-$3");
  // 携帯・IP (070/080/090/050): 3-4-4
  if (/^0[5789]0/.test(digits) && digits.length === 11) return digits.replace(/^(\d{3})(\d{4})(\d{4})$/, "$1-$2-$3");
  // 固定10桁: 市外局番の桁は地域で違うが、表記ゆれ対策としては 2-4-4 に寄せて比較する
  if (digits.length === 10) return digits.replace(/^(\d{2})(\d{4})(\d{4})$/, "$1-$2-$3");
  return null;
}

/** 電話番号の比較キー（数字のみ）。表記ゆれを無視して同一判定するために使う。 */
export function phoneKey(raw: string): string | null {
  const digits = normalizeWidth(raw).replace(/[^\d+]/g, "").replace(/^\+81/, "0");
  return /^0\d{9,10}$/.test(digits) ? digits : null;
}

/** URLの比較キー。プロトコル・www・末尾スラッシュ・追跡パラメータの揺れを吸収する。 */
export function urlKey(raw: string): string | null {
  try {
    const u = new URL(normalizeWidth(raw.trim()));
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const TRACKING = /^(utm_|fbclid|gclid|yclid)/;
    const params = [...u.searchParams.entries()].filter(([k]) => !TRACKING.test(k));
    params.sort(([a], [b]) => (a < b ? -1 : 1));
    const query = params.length ? "?" + params.map(([k, v]) => `${k}=${v}`).join("&") : "";
    const path = u.pathname.replace(/\/+$/, "");
    return host + path + query;
  } catch {
    return null;
  }
}

/**
 * 法人名の比較キー。法人格・空白・中黒・大文字小文字・全半角の揺れを吸収する。
 *
 * これで「ソラーレ・ホテルズ・アンド・リゾーツ」と「(株)ソラーレホテルズアンドリゾーツ」は同一になる。
 * ただしカナ表記と英字表記（Solare Hotels and Resorts）は機械では同一にできない。
 * その照合は人の行に回すのが正しい。無理に自動化して誤除外・誤通過させない。
 */
export function corpKey(raw: string): string {
  return normalizeWidth(raw)
    .replace(/株式会社|有限会社|合同会社|合資会社|合名会社|一般社団法人|一般財団法人|公益社団法人|公益財団法人|特定非営利活動法人|医療法人(社団|財団)?|学校法人|社会福祉法人/g, "")
    .replace(/\(株\)|㈱|\(有\)|㈲|\(同\)/g, "")
    .replace(/co\.?,?\s*ltd\.?|inc\.?|corp(oration)?\.?|k\.k\.?|l\.?l\.?c\.?|company|limited/gi, "")
    .toLowerCase()
    .replace(/[\s・･·.,、。'’"”\-]/g, "")
    .trim();
}

const PREFECTURES = [
  "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県", "茨城県", "栃木県", "群馬県",
  "埼玉県", "千葉県", "東京都", "神奈川県", "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県",
  "岐阜県", "静岡県", "愛知県", "三重県", "滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県",
  "鳥取県", "島根県", "岡山県", "広島県", "山口県", "徳島県", "香川県", "愛媛県", "高知県", "福岡県",
  "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県",
];

export interface AddressParts {
  postal: string;
  prefecture: string;
  city: string;
  rest: string;
  /** 分割しきれなかったときtrue。人が見る行に回す目印。 */
  incomplete: boolean;
}

/**
 * 日本の住所を 郵便番号 / 都道府県 / 市区町村 / それ以降 に分割する。
 * 住所録整備・名寄せ案件の頻出前処理。政令市の「市+区」は市区町村側にまとめる。
 */
export function splitAddressJp(raw: string): AddressParts {
  let text = normalizeText(raw);
  let postal = "";
  const pm = text.match(/〒?\s*(\d{3})-?(\d{4})/);
  if (pm) {
    postal = `${pm[1]}-${pm[2]}`;
    text = text.replace(pm[0], "").trim();
  }
  const prefecture = PREFECTURES.find((p) => text.startsWith(p)) ?? "";
  let rest = prefecture ? text.slice(prefecture.length) : text;
  let city = "";
  // 郡→町村、政令市→区まで、それ以外は最初の 市/区/町/村 まで
  const cm =
    rest.match(/^(.{1,6}?郡.{1,6}?[町村])/) ??
    rest.match(/^(.{1,8}?市.{1,6}?区)/) ??
    rest.match(/^(.{1,8}?[市区町村])/);
  if (cm) {
    city = cm[1];
    rest = rest.slice(city.length);
  }
  return {
    postal,
    prefecture,
    city,
    rest: rest.trim(),
    incomplete: !prefecture || !city,
  };
}

/** 郵便番号を NNN-NNNN にそろえる。形にならなければ null。 */
export function normalizePostal(raw: string): string | null {
  const m = normalizeWidth(raw).match(/^〒?\s*(\d{3})-?(\d{4})$/);
  return m ? `${m[1]}-${m[2]}` : null;
}
