// Excel（.xlsx）の読み書きの回帰テスト。
// 読む側は、別の実装（Python の openpyxl）が作ったファイルと、日本の Excel が書く形（ふりがな付き）で確かめる。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  readXlsx, writeXlsx, sheetToTable, zip, unzip, serialToDate, formatNumber, looksLikeXlsx, XlsxError,
} from "../../dist-test/dataops/xlsx.js";

const FIXTURE = path.join(import.meta.dirname, "..", "fixtures", "openpyxl-sample.xlsx");

test("openpyxl が作ったExcelを読む: 日付・小数・先頭0の電話・記号・改行・複数シート", () => {
  const book = readXlsx(fs.readFileSync(FIXTURE));
  assert.deepEqual(book.sheets.map((s) => s.name), ["ホテル一覧", "NGリスト"]);
  const t = sheetToTable(book.sheets[0]);
  assert.deepEqual(t.headers, ["施設名", "所在地", "電話", "開業日", "客室数", "評価"]);
  assert.equal(t.rows[0]["開業日"], "2019-04-01", "日付はシリアル値ではなく日付で");
  assert.equal(t.rows[0]["評価"], "0.3", "0.1+0.2 は Excel の表示どおり 0.3");
  assert.equal(t.rows[0]["客室数"], "120");
  assert.equal(t.rows[1]["電話"], "0612345678", "文字列の電話番号は先頭の0を保つ");
  assert.equal(t.rows[2]["施設名"], "ゲストハウス & 民泊 <本館>", "空行は飛ばし、記号は元に戻す");
  assert.equal(t.rows[2]["評価"], "", "計算結果が保存されていない数式は空（値を捏造しない）");
  assert.equal(t.rows[3]["施設名"], "改行\nあり");
  assert.equal(t.rows.length, 4);
});

function book(files) {
  const base = {
    "[Content_Types].xml": "<Types/>",
    "xl/workbook.xml":
      '<workbook xmlns:r="r"><workbookPr date1904="0"/><sheets><sheet name="一覧" sheetId="1" r:id="rId1"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels": '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
  };
  return zip(Object.entries({ ...base, ...files }).map(([name, data]) => ({ name, data: Buffer.from(data, "utf8") })));
}

test("日本の Excel の形: ふりがな（rPh）を混ぜない・空要素・_x000D_・書式で日付を見分ける", () => {
  const buf = book({
    "xl/sharedStrings.xml":
      '<sst><si><t>会社名</t></si>' +
      '<si><r><t>株式会社</t></r><r><t>山田</t></r><rPh sb="4" eb="6"><t>ヤマダ</t></rPh><phoneticPr fontId="1"/></si>' +
      "<si><t/></si><si/>" +
      "<si><t>1行目_x000D_\n2行目</t></si></sst>",
    "xl/styles.xml":
      '<styleSheet><numFmts count="2"><numFmt numFmtId="176" formatCode="yyyy&quot;年&quot;m&quot;月&quot;d&quot;日&quot;"/>' +
      '<numFmt numFmtId="177" formatCode="0.00E+00"/></numFmts>' +
      '<cellXfs count="4"><xf numFmtId="0"/><xf numFmtId="176"/><xf numFmtId="177"/><xf numFmtId="14"/></cellXfs></styleSheet>',
    "xl/worksheets/sheet1.xml":
      "<worksheet><sheetData>" +
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>日付</t></is></c><c r="C1" t="inlineStr"><is><t>数値</t></is></c><c r="D1" t="inlineStr"><is><t>標準日付</t></is></c></row>' +
      '<row r="2" spans="1:4"/>' +
      '<row r="3"><c r="A3" t="s"><v>1</v></c><c r="B3" s="1"><v>45566</v></c><c r="C3" s="2"><v>12345.678</v></c><c r="D3" s="3"><v>45566.5</v></c></row>' +
      '<row r="4"><c r="A4" t="s"><v>4</v></c><c r="C4" t="b"><v>1</v></c><c r="D4"/></row>' +
      "</sheetData></worksheet>",
  });
  const sheet = readXlsx(buf).sheets[0];
  assert.equal(sheet.name, "一覧");
  assert.deepEqual(sheet.rows[1], ["", "", "", ""], "空の行（<row/>）で次の行を飲み込まない");
  assert.equal(sheet.rows[2][0], "株式会社山田", "ふりがな（ヤマダ）を混ぜない");
  assert.equal(sheet.rows[2][1], "2024-10-01", "独自の日付書式（yyyy年m月d日）も日付として読む");
  assert.equal(sheet.rows[2][2], "12345.678", "指数書式（0.00E+00）は日付ではない");
  assert.equal(sheet.rows[2][3], "2024-10-01 12:00", "時刻付き");
  assert.equal(sheet.rows[3][0], "1行目\r\n2行目", "_x000D_ を元に戻す");
  assert.equal(sheet.rows[3][2], "TRUE");
});

test("シリアル値と数値の丸め", () => {
  assert.equal(serialToDate(1), "1900-01-01", "Excel のシリアル1は1900年1月1日");
  assert.equal(serialToDate(61), "1900-03-01", "1900年の閏年の扱い（存在しない2/29）の後もずれない");
  assert.equal(serialToDate(45566), "2024-10-01");
  assert.equal(serialToDate(0, true), "1904-01-01", "1904年起点のブック");
  assert.equal(formatNumber("0.30000000000000004"), "0.3");
  assert.equal(formatNumber("120"), "120");
  assert.equal(formatNumber("1.0000000000000002"), "1");
});

test("書いたExcelを読み戻せる。数式に見える値も文字列のまま（勝手に計算させない）", () => {
  const headers = ["施設名", "電話", "備考"];
  const rows = [
    { 施設名: "ホテル青空", 電話: "0312345678", 備考: 'a<b>&"c"\n改行' },
    { 施設名: "=HYPERLINK(\"http://evil\")", 電話: "03-1234-5678", 備考: "" },
  ];
  const buf = writeXlsx(headers, rows, { sheetName: "納品", highlightRows: new Set([1]) });
  assert.equal(looksLikeXlsx(buf), true);
  const back = readXlsx(buf).sheets[0];
  assert.equal(back.name, "納品");
  assert.deepEqual(back.rows, [headers, ["ホテル青空", "0312345678", 'a<b>&"c"\n改行'], ['=HYPERLINK("http://evil")', "03-1234-5678", ""]]);
  const sheetXml = unzip(buf).get("xl/worksheets/sheet1.xml").toString("utf8");
  assert.ok(!sheetXml.includes("<f>"), "数式としては書かない");
  assert.match(sheetXml, /<c r="A3" s="3"/, "要確認の行は赤の書式");
  assert.match(sheetXml, /<c r="A2" s="1"/, "ふつうの行は文字列の書式");
  assert.match(sheetXml, /state="frozen"/, "見出しを固定");
});

test("壊れたファイル・ZIP爆弾は例外で止める（読み込みで固まらない）", () => {
  assert.throws(() => readXlsx(Buffer.from("これはExcelではありません")), XlsxError);
  const bomb = zip([{ name: "xl/workbook.xml", data: Buffer.alloc(61 * 1024 * 1024) }]);
  assert.ok(bomb.length < 200_000, "中身はほぼゼロで圧縮される");
  assert.throws(() => unzip(bomb), /大きすぎます/);
  const noWorkbook = zip([{ name: "word/document.xml", data: Buffer.from("<w/>") }]);
  assert.throws(() => readXlsx(noWorkbook), /xlsx ではない/);
});
