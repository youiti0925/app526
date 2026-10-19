/**
 * 「〜は一切ありません」「〜は不要」「出社なし」のように、無いと言い切っている部分を本文から消す。
 *
 * 募集文には、安心させるための否定文がよく入る。
 * 実データで「営業活動・電話連絡は一切発生しません」の「電話」が現地作業に、
 * 「社外秘の情報や社名のご開示は不要」の「社外秘」が機密・NDA に当たって、
 * 条件の良い在宅の案件を落としていた。
 *
 * 消すのは「否定の言い切りまで」の1かたまりだけ。
 *   - 文（。！？と改行）の中で、言い切りの直前の「が／けど／ただし」までを範囲とする
 *   - 「出社、電話連絡は一切ありません」のように語が並んでいるときは、
 *     助詞のない短い語（出社）も範囲に入れる
 *   - 「NDAを結んでください、電話は不要です」の NDA のように、助詞のある別の節は残す
 */

const NEG_END = new RegExp(
  "(?:" +
    // 「は一切ありません」「は発生しません」「はございません」「は求めておりません」
    "(?:は|も|など|等)?(?:一切)?(?:あり|ござい|発生し|含まれ|含み|行い|おこない|求め|要求し|お願いし|必要とし)(?:て?おり)?ません(?!か)" +
    "|" +
    // 「は不要」「不問」「必要ありません」「いりません」
    "(?:は|も|など|等)?(?:一切)?(?:不要(?![なのをに])|不問|必要(?:は)?(?:あり|ござい)ません|必要ない|いりません|要りません)" +
    "|" +
    // 「出社なし」「出社はなし」（「お話し」の「はなし」に当たらないよう、直前がひらがなのときは見ない）
    "(?<![ぁ-ん])(?:は|も)?(?:なし|無し)(?![一-龥ァ-ヶー])" +
  ")",
  "g"
);

/** 言い切りの前で、話が切り替わる所。ここより前は否定の範囲に入れない。 */
const CONTRAST = /(?:ですが|ますが|けれども|けれど|けども|けど|ものの|ただし|しかし|一方)[、,]?/g;

/** 並んでいる語（助詞を持たない短い語）か */
function isListItem(segment: string): boolean {
  const s = segment.trim();
  return s.length > 0 && s.length <= 12 && !/[はがをにへでとの]/.test(s);
}

function stripSentence(sentence: string): string {
  NEG_END.lastIndex = 0;
  let out = "";
  let cursor = 0;
  for (const m of sentence.matchAll(NEG_END)) {
    if (m.index === undefined || m.index < cursor) continue;
    const end = m.index + m[0].length;
    // 範囲の始まり: 直前の「が／けど／ただし」の後ろ。なければ（cursor 以降の）文の頭
    let start = cursor;
    for (const c of sentence.slice(cursor, m.index).matchAll(CONTRAST)) {
      if (c.index === undefined) continue;
      start = cursor + c.index + c[0].length;
    }
    // 読点で区切られた節は、助詞のない短い語が並んでいる間だけ左へ広げる
    // （「出社、電話連絡は一切ありません」は両方が否定の対象）
    const head = sentence.slice(start, m.index);
    const lastComma = Math.max(head.lastIndexOf("、"), head.lastIndexOf(","), head.lastIndexOf("，"));
    if (lastComma >= 0) {
      let boundary = lastComma + 1; // 最後の読点の後ろから否定の言い切りまでは必ず範囲
      let rest = head.slice(0, lastComma);
      while (rest.length > 0) {
        const cut = Math.max(rest.lastIndexOf("、"), rest.lastIndexOf(","), rest.lastIndexOf("，"));
        const seg = rest.slice(cut + 1);
        if (!isListItem(seg)) break;
        boundary = cut + 1;
        if (cut < 0) break;
        rest = rest.slice(0, cut);
      }
      start += boundary;
    }
    out += sentence.slice(cursor, start);
    cursor = end;
  }
  return out + sentence.slice(cursor);
}

/** 本文から、無いと言い切っている部分を取り除く。 */
export function stripNegatedClauses(text: string): string {
  return text
    .split(/(?<=[。！？!?\n])/)
    .map((s) => stripSentence(s))
    .join("");
}
