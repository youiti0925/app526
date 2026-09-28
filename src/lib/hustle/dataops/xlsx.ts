/**
 * Excel（.xlsx）の読み書き — 外部ライブラリを使わず、Node の zlib だけで行う。
 *
 * なぜ自前か:
 * 定番の exceljs は依存が160個・36MBあり、注意すべき脆弱性の指摘も付いている。
 * 受託のデータ作業で要るのは「表の値を読む」「表を書く」だけなので、
 * xlsx の中身（ZIPに入ったXML）を直接扱うほうが小さく、中身も追える。
 *
 * 読むときに気をつけていること（日本の Excel で実際に起きるもの）:
 * - ふりがな（<rPh>）が文字列に混ざる → 除いてから読む
 * - 日付はシリアル値（45123 など）で入っている → 書式を見て YYYY-MM-DD に戻す
 * - 数値は 0.30000000000000004 のように入っている → Excel の表示と同じ15桁に丸める
 * - 改行などの制御文字は _x000D_ の形で入っている → 元に戻す
 * - 巨大な展開（ZIP爆弾）→ 展開後の大きさに上限を掛ける
 *
 * 書くときは全セルを「文字列」として書く。電話番号の先頭の0や、日付に見える文字列を
 * Excel が勝手に変換しないようにするため（納品物が化けると差し戻しになる）。
 */
import { inflateRawSync, deflateRawSync } from "zlib";

// --- ZIP ------------------------------------------------------------------------

const MAX_ENTRY_BYTES = 60 * 1024 * 1024;
const MAX_TOTAL_BYTES = 150 * 1024 * 1024;
const MAX_ENTRIES = 5000;
const MAX_ROWS = 200_000;
const MAX_COLS = 1000;

export class XlsxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XlsxError";
  }
}

/** ZIPの中身を、名前 → 展開済みバイト列 で返す。 */
export function unzip(buf: Buffer): Map<string, Buffer> {
  // 末尾の「中央ディレクトリの終わり」を探す（コメントがあると末尾から最大64KB手前）
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65_535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new XlsxError("Excelファイル（ZIP）として読めません。壊れているか、別の形式です");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  if (count > MAX_ENTRIES) throw new XlsxError("ファイル内の部品が多すぎます");
  const out = new Map<string, Buffer>();
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new XlsxError("ZIPの目次が壊れています");
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (compSize === 0xffffffff || size === 0xffffffff) throw new XlsxError("4GBを超えるファイルには対応していません");
    if (size > MAX_ENTRY_BYTES) throw new XlsxError(`展開後が大きすぎます（${name}）`);
    total += size;
    if (total > MAX_TOTAL_BYTES) throw new XlsxError("展開後の合計が大きすぎます");
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) throw new XlsxError("ZIPの中身が壊れています");
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + compSize);
    if (method === 0) out.set(name, Buffer.from(data));
    else if (method === 8) out.set(name, inflateRawSync(data, { maxOutputLength: MAX_ENTRY_BYTES }));
    else throw new XlsxError(`対応していない圧縮方式です（${method}）`);
  }
  return out;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** 名前 → 中身 から ZIP を作る（deflate 圧縮）。 */
export function zip(files: { name: string; data: Buffer }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, "utf8");
    const comp = deflateRawSync(f.data);
    const crc = crc32(f.data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0x0800, 6); // 名前はUTF-8
    lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(0, 10); // 時刻（1980-01-01 00:00 扱い）
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(f.data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    lh.writeUInt16LE(0, 28);
    locals.push(lh, name, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(0, 12);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(f.data.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);
    offset += 30 + name.length + comp.length;
  }
  const central = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, central, end]);
}

// --- XML の小道具 -------------------------------------------------------------------

export function decodeXml(s: string): string {
  return s
    .replace(/&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos);/gi, (m, e: string) => {
      const k = e.toLowerCase();
      if (k === "amp") return "&";
      if (k === "lt") return "<";
      if (k === "gt") return ">";
      if (k === "quot") return '"';
      if (k === "apos") return "'";
      const code = k.startsWith("#x") ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    })
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
}

function escapeXml(s: string): string {
  return s
    // XMLに書けない制御文字は落とす（タブ・改行は残す）
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const attr = (tag: string, name: string): string | null => {
  const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return m ? decodeXml(m[1]) : null;
};

/** <si> や <is> の中の文字列。ふりがな（<rPh>）は除く。 */
function textOf(xml: string): string {
  const body = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "").replace(/<phoneticPr\b[^>]*\/>/g, "");
  let out = "";
  // 空要素（<t/>）を先に当てる。逆順だと <t/> を開始タグとみなして次の </t> まで飲み込む
  for (const m of body.matchAll(/<t\b[^>]*?\/>|<t\b[^>]*>([\s\S]*?)<\/t>/g)) out += m[1] ? decodeXml(m[1]) : "";
  return out;
}

// --- 読む -------------------------------------------------------------------------

export interface XlsxSheet {
  name: string;
  /** 値の2次元配列（行 × 列）。空のセルは ""。末尾の空行・空列は落としてある。 */
  rows: string[][];
}

export interface XlsxBook {
  sheets: XlsxSheet[];
}

/** 日付として扱う組み込み書式の番号（日本語版の和暦・年月日を含む）。 */
const DATE_FMT_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);

function isDateFormat(code: string): boolean {
  // 引用符・[色]・エスケープ・指数（0.00E+00）を除いてから、年月日時分秒・和暦の記号があるかを見る
  const plain = code
    .replace(/"[^"]*"/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\\./g, "")
    .replace(/E[+-]/gi, "");
  if (/^\s*(general|@)\s*$/i.test(plain)) return false;
  return /[ymdhsge]/i.test(plain);
}

function columnIndex(ref: string): number {
  const letters = ref.match(/^[A-Z]+/i)?.[0].toUpperCase() ?? "";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Excel のシリアル値を日付（時刻があれば日時）の文字列に。 */
export function serialToDate(serial: number, date1904 = false): string {
  // Excel は1900年を閏年として扱う（存在しない1900-02-29 がシリアル60）。
  // そのため1900-03-01より前（シリアル61未満）は、基準日が1日ずれる。
  const base = date1904 ? Date.UTC(1904, 0, 1) : serial < 61 ? Date.UTC(1899, 11, 31) : Date.UTC(1899, 11, 30);
  const ms = Math.round(serial * 86_400_000);
  const d = new Date(base + ms);
  const ymd = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  const secs = Math.round((serial % 1) * 86_400);
  if (secs === 0 || secs === 86_400) return ymd;
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return serial < 1 ? `${hh}:${mm}` : `${ymd} ${hh}:${mm}`;
}

/** Excel が表示するのと同じ15桁に丸める（0.1+0.2 → 0.3）。 */
export function formatNumber(raw: string): string {
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n);
  return String(Number(n.toPrecision(15)));
}

export function readXlsx(buf: Buffer): XlsxBook {
  const files = unzip(buf);
  const get = (name: string) => files.get(name)?.toString("utf8") ?? null;
  const workbook = get("xl/workbook.xml");
  if (!workbook) throw new XlsxError("Excelの本体（xl/workbook.xml）がありません。.xlsx ではない可能性があります（古い .xls は未対応）");

  const date1904 = /<workbookPr\b[^>]*\bdate1904="(1|true)"/.test(workbook);
  const rels = new Map<string, string>();
  for (const m of (get("xl/_rels/workbook.xml.rels") ?? "").matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], "Id");
    const target = attr(m[0], "Target");
    if (id && target) rels.set(id, target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`);
  }

  const shared: string[] = [];
  for (const m of (get("xl/sharedStrings.xml") ?? "").matchAll(/<si\b[^>]*?\/>|<si\b[^>]*>([\s\S]*?)<\/si>/g)) shared.push(m[1] ? textOf(m[1]) : "");

  // 書式: セルの s= 番号 → 日付かどうか
  const styles = get("xl/styles.xml") ?? "";
  const custom = new Map<number, string>();
  for (const m of styles.matchAll(/<numFmt\b[^>]*>/g)) {
    const id = Number(attr(m[0], "numFmtId"));
    const code = attr(m[0], "formatCode");
    if (Number.isFinite(id) && code !== null) custom.set(id, code);
  }
  const xfDate: boolean[] = [];
  const cellXfs = styles.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] ?? "";
  for (const m of cellXfs.matchAll(/<xf\b[^>]*\/?>/g)) {
    const id = Number(attr(m[0], "numFmtId") ?? 0);
    xfDate.push(DATE_FMT_IDS.has(id) || (custom.has(id) && isDateFormat(custom.get(id)!)));
  }

  const sheets: XlsxSheet[] = [];
  for (const m of workbook.matchAll(/<sheet\b[^>]*\/?>/g)) {
    const name = attr(m[0], "name") ?? `Sheet${sheets.length + 1}`;
    const rid = attr(m[0], "r:id");
    const path = rid ? rels.get(rid) : undefined;
    const xml = path ? get(path) : null;
    if (!xml) {
      sheets.push({ name, rows: [] });
      continue;
    }
    const rows: string[][] = [];
    let rowNo = 0;
    // 空の行（<row .../>）を先に当てる。逆順だと次の行まで飲み込む
    for (const r of xml.matchAll(/<row\b([^>]*?)\/>|<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
      const rAttr = attr(`<row ${r[1] ?? r[2] ?? ""}>`, "r");
      rowNo = rAttr ? Number(rAttr) : rowNo + 1;
      if (!Number.isFinite(rowNo) || rowNo > MAX_ROWS) throw new XlsxError(`行が多すぎます（${MAX_ROWS.toLocaleString()}行まで）`);
      if (r[1] !== undefined) continue;
      const cells: string[] = [];
      let colNo = -1;
      for (const c of (r[3] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const head = `<c ${c[1]}>`;
        const ref = attr(head, "r");
        colNo = ref ? columnIndex(ref) : colNo + 1;
        if (colNo >= MAX_COLS) continue;
        const type = attr(head, "t") ?? "n";
        const style = Number(attr(head, "s") ?? 0);
        const inner = c[2] ?? "";
        const v = inner.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1];
        let value = "";
        if (type === "s") value = v !== undefined ? (shared[Number(v)] ?? "") : "";
        else if (type === "inlineStr") value = textOf(inner.match(/<is\b[^>]*>([\s\S]*?)<\/is>/)?.[1] ?? "");
        else if (type === "str" || type === "e") value = v !== undefined ? decodeXml(v) : "";
        else if (type === "b") value = v === "1" ? "TRUE" : v === "0" ? "FALSE" : "";
        else if (type === "d") value = v !== undefined ? decodeXml(v).slice(0, 10) : "";
        else if (v !== undefined) value = xfDate[style] ? serialToDate(Number(v), date1904) : formatNumber(decodeXml(v));
        while (cells.length < colNo) cells.push("");
        cells[colNo] = value;
      }
      while (rows.length < rowNo - 1) rows.push([]);
      rows[rowNo - 1] = cells;
    }
    sheets.push({ name, rows: trim(rows) });
  }
  return { sheets };
}

function trim(rows: string[][]): string[][] {
  const out = rows.map((r) => (r ?? []).map((v) => v ?? ""));
  while (out.length && out[out.length - 1].every((v) => !v.trim())) out.pop();
  let width = 0;
  for (const r of out) for (let i = r.length - 1; i >= 0; i--) if (r[i].trim()) { width = Math.max(width, i + 1); break; }
  return out.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? ""));
}

/** 見出し行（最初の空でない行）から下を、見出し → 値 の行に。 */
export function sheetToTable(sheet: XlsxSheet): { headers: string[]; rows: Record<string, string>[] } {
  const start = sheet.rows.findIndex((r) => r.some((v) => v.trim()));
  if (start < 0) return { headers: [], rows: [] };
  const seen = new Map<string, number>();
  const headers = sheet.rows[start].map((h, i) => {
    const base = h.trim() || `列${i + 1}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}_${n}`;
  });
  const rows = sheet.rows
    .slice(start + 1)
    .filter((r) => r.some((v) => v.trim()))
    .map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? "").trim()])));
  return { headers, rows };
}

// --- 書く -------------------------------------------------------------------------

function colName(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

export interface WriteOptions {
  sheetName?: string;
  /** 薄い赤で塗る行（データ行の番号。0始まり）。要確認の行を目立たせる。 */
  highlightRows?: Set<number>;
}

/** 見出しと行から .xlsx を作る。全セルを文字列（書式「文字列」）で書く。 */
export function writeXlsx(headers: string[], rows: Record<string, string>[], opts: WriteOptions = {}): Buffer {
  const sheetName = escapeXml((opts.sheetName ?? "Sheet1").replace(/[\\/?*[\]:]/g, "_").slice(0, 31) || "Sheet1");
  const cell = (ref: string, value: string, style: number) =>
    `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
  const lines: string[] = [];
  lines.push(`<row r="1">${headers.map((h, i) => cell(`${colName(i)}1`, h, 2)).join("")}</row>`);
  rows.forEach((row, ri) => {
    const style = opts.highlightRows?.has(ri) ? 3 : 1;
    const r = ri + 2;
    lines.push(`<row r="${r}">${headers.map((h, i) => cell(`${colName(i)}${r}`, row[h] ?? "", style)).join("")}</row>`);
  });
  // 列幅: 全角は2文字ぶんで数え、上限を付ける
  const widthOf = (s: string) => [...s].reduce((a, ch) => a + (ch.charCodeAt(0) > 0xff ? 2 : 1), 0);
  const cols = headers
    .map((h, i) => {
      const w = Math.min(60, Math.max(8, widthOf(h), ...rows.slice(0, 500).map((r) => widthOf(r[h] ?? ""))) + 2);
      return `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`;
    })
    .join("");
  const last = `${colName(Math.max(0, headers.length - 1))}${rows.length + 1}`;
  const sheet =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<dimension ref="A1:${last}"/>` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="18"/>` +
    (cols ? `<cols>${cols}</cols>` : "") +
    `<sheetData>${lines.join("")}</sheetData>` +
    (headers.length ? `<autoFilter ref="A1:${last}"/>` : "") +
    `</worksheet>`;
  const stylesXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<fonts count="2"><font><sz val="11"/><name val="Yu Gothic"/><family val="3"/><charset val="128"/></font>` +
    `<font><b/><sz val="11"/><name val="Yu Gothic"/><family val="3"/><charset val="128"/></font></fonts>` +
    `<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>` +
    `<fill><patternFill patternType="solid"><fgColor rgb="FFE2EFDA"/><bgColor indexed="64"/></patternFill></fill>` +
    `<fill><patternFill patternType="solid"><fgColor rgb="FFFDE2E2"/><bgColor indexed="64"/></patternFill></fill></fills>` +
    `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
    `<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
    `<xf numFmtId="49" fontId="1" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/>` +
    `<xf numFmtId="49" fontId="0" fillId="3" borderId="0" xfId="0" applyNumberFormat="1" applyFill="1"/></cellXfs>` +
    `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
    `</styleSheet>`;
  const workbookXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets>` +
    (headers.length ? `<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${sheetName.replace(/'/g, "''")}'!$A$1:$${colName(Math.max(0, headers.length - 1))}$${rows.length + 1}</definedName></definedNames>` : "") +
    `</workbook>`;
  const text = (s: string) => Buffer.from(s, "utf8");
  return zip([
    {
      name: "[Content_Types].xml",
      data: text(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
          `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
          `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
          `<Default Extension="xml" ContentType="application/xml"/>` +
          `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
          `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
          `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
          `</Types>`
      ),
    },
    {
      name: "_rels/.rels",
      data: text(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
          `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
          `</Relationships>`
      ),
    },
    { name: "xl/workbook.xml", data: text(workbookXml) },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: text(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
          `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
          `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
          `</Relationships>`
      ),
    },
    { name: "xl/worksheets/sheet1.xml", data: text(sheet) },
    { name: "xl/styles.xml", data: text(stylesXml) },
  ]);
}

/** 先頭4バイトでZIP（= xlsx の可能性）かを見る。 */
export function looksLikeXlsx(buf: Buffer): boolean {
  return buf.length > 4 && buf.readUInt32LE(0) === 0x04034b50;
}
