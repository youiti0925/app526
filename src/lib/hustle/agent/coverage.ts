/**
 * 募集が求めている項目を列挙して、抜けを見えるようにする。
 *
 * なぜ要るか:
 * 実案件9件で成果物を作らせて採点した結果、pass はゼロだった。
 * そして失敗の型が全件で同じだった——**作れるところだけ作って、
 * 作れないところを黙って飛ばす**。
 *
 * 採点者の指摘（原文）:
 *   「作業内容4項目のうち3項目が成果物に一切含まれない」
 *   「依頼工程『素材挿入』がパイプラインに完全に不在」
 *   「ターゲット設計が完全に不在。募集の明示項目でありながら」
 *   「月次レポーティングが未実装。募集要項に明記された業務」
 *
 * 全部、募集文に書いてあることを飛ばしている。しかも成果物は
 * それらしく仕上がっているので、並べて確認しないと気づけない。
 *
 * だから機械で照合しようとはしない（できない）。
 * **求められている項目を列挙して、人が突き合わせられる形にする**のがここの仕事。
 */

export interface Requirement {
  /** 求められていること（募集文から抜き出した原文） */
  text: string;
  /** どこから抜いたか */
  source: "bullet" | "duty" | "must" | "deliverable" | "process";
  /** 必須と書かれているか */
  required: boolean;
}

export const SOURCE_LABELS: Record<Requirement["source"], string> = {
  bullet: "箇条書き",
  duty: "業務内容",
  must: "必須要件",
  deliverable: "納品物",
  process: "依頼工程",
};

/** 見出しの直後にある箇条書きを集める。 */
const SECTIONS: { source: Requirement["source"]; heading: RegExp; required: boolean }[] = [
  { source: "must", heading: /(必須|必要)(条件|要件|スキル|なもの)|【必須】|MUST/i, required: true },
  { source: "duty", heading: /(業務|作業|依頼)(内容|範囲)|お願いしたいこと|担当いただく/, required: true },
  { source: "process", heading: /(依頼|作業)工程|工程|作業の流れ/, required: true },
  { source: "deliverable", heading: /(納品|成果)(物|ファイル|形式)|アウトプット/, required: true },
];

/** 予算・期間・連絡手段など、こちらが「作る」ものではない行。 */
const NOT_A_DELIVERABLE =
  /^(希望)?(予算|報酬|単価|金額|支払|お支払)[:：]?|^(納期|期間|募集期間|締切)[:：]|^(応募|連絡)(方法|先)[:：]|^用意できるもの[:：]|^(お?支払い方法)/;

const BULLET = /^\s*(?:[-–—・*●○◆■□▪▶]|[0-9０-９]{1,2}[.．)）、]|\([0-9０-９]{1,2}\))\s*(.+)$/;

/**
 * 募集文から「求められていること」を抜き出す。
 *
 * 完璧に抜けるとは考えていない。抜けたぶんは人が読むしかない。
 * ここの役割は「列挙して並べる」ことで、「全部拾う」ことではない。
 */
export function extractRequirements(text: string, max = 30): Requirement[] {
  const lines = text.normalize("NFKC").split(/\r?\n/);
  const out: Requirement[] = [];
  const seen = new Set<string>();

  let current: { source: Requirement["source"]; required: boolean } | null = null;
  let sinceHeading = 0;

  const push = (t: string, source: Requirement["source"], required: boolean) => {
    const clean = t.trim().replace(/\s+/g, " ").slice(0, 200);
    // 短すぎるものと、見出しの再掲は落とす
    if (clean.length < 6 || clean.length > 200) return;
    // こちらが作るものではない行を落とす。混ぜると確認表がノイズだらけになる。
    if (NOT_A_DELIVERABLE.test(clean)) return;
    if (seen.has(clean)) return;
    seen.add(clean);
    out.push({ text: clean, source, required });
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      sinceHeading++;
      continue;
    }

    const section = SECTIONS.find((s) => s.heading.test(line));
    if (section) {
      current = { source: section.source, required: section.required };
      sinceHeading = 0;
      // 「業務内容：記事作成、SEO対策」のように見出しと同じ行に本文があるケース
      const inline = line.split(/[:：]/).slice(1).join(":").trim();
      if (inline.length >= 6) {
        for (const part of inline.split(/[、,／/]/)) push(part, section.source, section.required);
      }
      continue;
    }

    const bullet = line.match(BULLET);
    if (bullet) {
      // 見出しから離れすぎた箇条書きは、別の話題に移っている可能性が高い
      const src = current && sinceHeading < 3 ? current : { source: "bullet" as const, required: false };
      push(bullet[1], src.source, src.required);
      sinceHeading = 0;
      continue;
    }

    sinceHeading++;
    if (sinceHeading > 4) current = null;
  }

  return out.slice(0, max);
}

export interface CoverageChecklist {
  requirements: Requirement[];
  /** 必須と書かれているものの数 */
  requiredCount: number;
  /** 人に見せる確認表 */
  markdown: string;
}

/**
 * 確認表を作る。
 *
 * 自動でチェックを入れない。入れると「機械が確認したから大丈夫」と
 * 思われてしまい、まさに今回すり抜けた失敗が再発する。
 * 並べて、人にチェックさせる。
 */
export function buildChecklist(text: string, title: string): CoverageChecklist {
  const requirements = extractRequirements(text);
  const requiredCount = requirements.filter((r) => r.required).length;

  if (requirements.length === 0) {
    return {
      requirements,
      requiredCount: 0,
      markdown: [
        `# 納品前の確認: ${title}`,
        "",
        "募集文から、求められている項目を箇条書きとして抜き出せませんでした。",
        "募集文を自分で読んで、項目を書き出してから納品してください。",
        "",
        "実案件で試したところ、**AIは作れるところだけ作って、作れないところを黙って飛ばします。**",
        "並べて突き合わせないと気づけません。",
      ].join("\n"),
    };
  }

  const lines = [
    `# 納品前の確認: ${title}`,
    "",
    `募集文から ${requirements.length}項目（うち必須と読めるもの ${requiredCount}項目）を抜き出しました。`,
    "**成果物がこれを全部カバーしているか、1つずつ確認してください。**",
    "",
    "実案件9件で試した結果、そのまま納品できたものはゼロでした。",
    "失敗の型は全件同じで、募集に書いてある項目を黙って飛ばしていました。",
    "「作業内容4項目のうち3項目が含まれていない」「依頼工程の素材挿入が不在」といった指摘です。",
    "成果物はそれらしく仕上がっているので、並べないと気づけません。",
    "",
  ];

  for (const group of ["must", "duty", "process", "deliverable", "bullet"] as const) {
    const items = requirements.filter((r) => r.source === group);
    if (items.length === 0) continue;
    lines.push(`## ${SOURCE_LABELS[group]}${group === "must" ? "（満たせないなら応募しない）" : ""}`);
    lines.push("");
    for (const item of items) lines.push(`- [ ] ${item.text}`);
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push("チェックが埋まらない項目があるなら、それは納品前に埋めるか、");
  lines.push("「この部分は含みません」と先方に明示してください。黙って出すのが一番まずいです。");

  return { requirements, requiredCount, markdown: lines.join("\n") };
}
