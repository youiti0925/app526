import test from "node:test";
import assert from "node:assert/strict";

import {
  cleanCsv,
  detectDelimiter,
  serializeCsv,
} from "../../dist-test/csv-cleaner.js";

test("CSVの空行・重複・前後空白・全角英数字をまとめて整理する", () => {
  const input = "氏名,コード\r\n 山田太郎 ,Ａ１２\r\n\r\n山田太郎,A12\r\n佐藤花子, B34 ";
  const result = cleanCsv(input);

  assert.equal(result.stats.inputRows, 5);
  assert.equal(result.stats.outputRows, 3);
  assert.equal(result.stats.blankRowsRemoved, 1);
  assert.equal(result.stats.duplicatesRemoved, 1);
  assert.deepEqual(result.rows, [
    ["氏名", "コード"],
    ["山田太郎", "A12"],
    ["佐藤花子", "B34"],
  ]);
});

test("タブ区切りを自動判定する", () => {
  assert.equal(detectDelimiter("氏名\t住所\n山田\t東京\n佐藤\t大阪"), "\t");
});

test("引用符内のカンマ・改行・引用符を壊さない", () => {
  const result = cleanCsv('name,note\r\n"山田,太郎","1行目\n2行目"\r\n佐藤,"""確認済み"""');
  assert.deepEqual(result.rows[1], ["山田,太郎", "1行目\n2行目"]);
  assert.deepEqual(result.rows[2], ["佐藤", '"確認済み"']);
  assert.match(result.csv, /"山田,太郎"/);
  assert.match(result.csv, /"1行目\n2行目"/);
});

test("Windows版Excel向けにBOM付きCSVを出す", () => {
  const out = serializeCsv([["氏名", "メモ"], ["山田", "A,B"]]);
  assert.equal(out.charCodeAt(0), 0xfeff);
  assert.match(out, /"A,B"/);
});

test("列数が異なる行を要確認として返す", () => {
  const result = cleanCsv("a,b,c\n1,2,3\n4,5");
  assert.equal(result.stats.irregularRows, 1);
  assert.ok(result.warnings.some((warning) => /列数/.test(warning)));
});
