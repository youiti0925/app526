import { CAPABILITIES, judgeDeliverability, type Capability } from "./deliverability";
import { readEngagement } from "./engagement";
import type { Lead } from "./types";

/**
 * 試作ハーネス。
 *
 * なぜ要るか:
 * deliverability.ts の「できる／できない」の表は、私の頭の中の知識で書いたもので、
 * 証拠がない。実際、最初は「動画は作れない」と書いていたが、それは誤りだった
 * （カット・テロップ・BGM合成は ffmpeg で仕様どおりに出せる）。
 * 主張だけで案件を落とすのも、主張だけで通すのも、どちらも危ない。
 *
 * だからここは、実在する案件を疑似的に受注して、実際に成果物を作り、
 * それがまともかどうかを別の目で採点する層。
 * 合格したジャンルだけを「実証済み」にする。
 *
 * 重要なのは、**できないと主張しているジャンルも必ず試す**こと。
 * 試さずに「できない」と言い続けると、取れたはずの仕事を永久に捨て続ける。
 */

export type DryRunStatus =
  | "pending" // 対象として選んだだけ
  | "produced" // 成果物を作った
  | "graded" // 採点した
  | "skipped"; // 作れなかった（理由を残す）

export type DryRunVerdict = "pass" | "needs_work" | "fail" | "cannot_produce";

export const VERDICT_LABELS: Record<DryRunVerdict, string> = {
  pass: "そのまま納品できる",
  needs_work: "手を入れれば納品できる",
  fail: "納品できる水準にない",
  cannot_produce: "そもそも作れなかった",
};

/** 採点。作った本人ではなく、別の目で付ける。 */
export interface Grade {
  /** 募集の要求をどれだけ満たしているか（0-100） */
  meetsRequirement: number;
  /** 依頼者に出せる水準か */
  deliverable: boolean;
  /** 足りていない点 */
  gaps: string[];
  /** 納品までに人が追加で使う時間 */
  humanHoursNeeded: number;
  /** 事実の裏取りが必要な箇所 */
  needsFactCheck: string[];
  /**
   * 成果物が募集と別物だったか。
   * これが true のときは、能力の問題ではなく**試作の対象選びの問題**なので、
   * そのジャンルの検証結果としては数えない。
   * （準委任の要員募集に「成果物を作れ」と指示してしまった実例が4件あった）
   */
  targetMismatch: boolean;
  verdict: DryRunVerdict;
  reason: string;
}

export interface DryRun {
  id: string;
  /** 元になった案件 */
  leadId: string | null;
  sourceUrl: string;
  title: string;
  /** どのジャンルの検証か */
  genre: Capability;
  /** 募集文から抜き出した要求 */
  requirement: string;
  /** 何を作るか */
  deliverableSpec: string;
  /** 作ったもの。長いものはファイルに置いてパスを入れる。 */
  artifact: string;
  artifactPath: string;
  /** どうやって作ったか（使ったツール・手順） */
  method: string;
  /** 作れなかった場合の理由 */
  blockedReason: string;
  grade: Grade | null;
  status: DryRunStatus;
  createdAt: string;
}

/**
 * 検証したいジャンル。
 *
 * できると主張しているものと、できないと主張しているものを両方入れる。
 * 「できない」の側を試さないと、その主張が正しいかどうか永久に分からない。
 */
export interface GenreTarget {
  genre: Capability;
  label: string;
  /** いまの主張 */
  claim: "can" | "cannot";
  /** この案件で何を作れば検証になるか */
  probe: string;
  /** 採点で特に見るべき点 */
  gradeFocus: string[];
}

export const GENRE_TARGETS: GenreTarget[] = [
  {
    genre: "text",
    label: "文章・文書",
    claim: "can",
    probe: "募集が求めている文書を、実際に納品できる分量まで書いてください（見本ではなく本番の一部）。",
    gradeFocus: ["事実の誤りがないか", "依頼者の業界の用語が正しいか", "そのまま提出できる体裁か"],
  },
  {
    genre: "code",
    label: "コード・スクリプト",
    claim: "can",
    probe: "動くコードを書いてください。実行して結果を確認し、その出力も添えてください。",
    gradeFocus: ["実際に動くか", "エラー処理があるか", "要求仕様を満たしているか"],
  },
  {
    genre: "data",
    label: "データ処理",
    claim: "can",
    probe: "サンプルデータを作り、それを処理するスクリプトを書いて実行し、出力を見せてください。",
    gradeFocus: ["件数が多くても破綻しないか", "元データの形式ゆれに耐えるか"],
  },
  {
    genre: "research",
    label: "調査・要約",
    claim: "can",
    probe: "実際にWebを見て一次情報を確認し、根拠URL付きでまとめてください。",
    gradeFocus: ["根拠が一次情報か", "推測を事実として書いていないか", "数字が確認できるか"],
  },
  {
    genre: "video_spec",
    label: "動画（仕様どおりの処理）",
    claim: "can",
    probe:
      "ffmpeg で実行できるコマンド列を、この案件の要求（カット・テロップ・BGM・尺・書き出し形式）に合わせて具体的に書いてください。可能なら実際にサンプル動画を生成して確認してください。",
    gradeFocus: [
      "コマンドが実際に通るか",
      "募集が求めている編集を全部カバーしているか",
      "カバーできない部分を正直に書いているか",
    ],
  },
  {
    genre: "vector",
    label: "図解・ロゴ・チャート",
    claim: "can",
    probe: "SVG を実際に書いてください。ファイルとして完結し、ブラウザで開ける形にしてください。",
    gradeFocus: ["商用に耐える見た目か", "フォント依存で崩れないか", "要求されたサイズ・形式か"],
  },
  {
    genre: "image_batch",
    label: "画像の一括処理",
    claim: "can",
    probe: "サンプル画像を作り、要求された処理をするスクリプトを書いて実行し、結果を確認してください。",
    gradeFocus: ["処理結果が要求どおりか", "枚数が多くても現実的な時間で終わるか"],
  },
  {
    genre: "image_gen",
    label: "汎用イラスト・画像",
    claim: "can",
    probe:
      "画風の指定が無い画像（アイキャッチ、挿絵、アイコン）を、無料で商用利用できる手段で実際に出してください。使った手段の商用可否を規約で確認して書いてください。",
    gradeFocus: ["依頼者が金を払う水準か", "商用利用が許諾されている手段か", "既存の作品に似ていないか"],
  },
  {
    genre: "art",
    label: "イラスト・キャラクター",
    claim: "cannot",
    probe:
      "「できない」という主張が本当か検証します。この案件の要求に対して、いま無料で使える手段（SVG、生成AIの無料枠、素材の組み合わせ）で、どこまで近づけるか実際に試してください。作れないなら、何が足りないのかを具体的に書いてください。",
    gradeFocus: [
      "依頼者が金を払う水準か（習作ではなく商品として）",
      "商用利用が許諾されている手段か",
      "画風の指定に応えられるか",
    ],
  },
  {
    genre: "direction",
    label: "演出・センスが要る編集",
    claim: "cannot",
    probe:
      "「できない」という主張の検証です。この案件の演出要求に対して、判断基準を言語化して仕様に落とせるか試してください。落とせるなら、その仕様を書いてください。",
    gradeFocus: ["仕様として書けているか", "誰がやっても同じ結果になるか"],
  },
  {
    genre: "music",
    label: "作曲・歌唱",
    claim: "cannot",
    probe:
      "「できない」という主張の検証です。無料かつ商用利用できる手段があるか実際に調べ、あれば試してください。無ければその根拠（規約の該当箇所）を示してください。",
    gradeFocus: ["商用利用の可否が規約で確認できているか"],
  },
  {
    genre: "voice",
    label: "ナレーション（合成音声）",
    claim: "cannot",
    probe:
      "無料で商用利用できる音声合成（VOICEVOX 等）があるか、規約を実際に読んで確認してください。使えるなら台本と手順を作ってください。",
    gradeFocus: ["商用利用条件をキャラクター単位で確認しているか", "クレジット表記の義務"],
  },
];

export const getGenreTarget = (genre: Capability): GenreTarget | undefined =>
  GENRE_TARGETS.find((g) => g.genre === genre);

// ---------------------------------------------------------------------------
// 返答の受け取り
// ---------------------------------------------------------------------------

const str = (v: unknown, max = 60_000): string =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

const arr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.slice(0, 500)) : [];

const numOr = (v: unknown, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

export interface ProduceResult {
  dryRunId: string;
  artifact: string;
  method: string;
  humanStepsLeft: string[];
  humanHoursLeft: number;
  blocked: string;
  selfDoubt: string;
}

export function parseProduceResults(raw: unknown): ProduceResult[] {
  const list = (raw as { results?: unknown })?.results;
  if (!Array.isArray(list)) return [];
  const out: ProduceResult[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const dryRunId = str(o.dryRunId, 100);
    if (!dryRunId) continue;
    out.push({
      dryRunId,
      artifact: str(o.artifact),
      method: str(o.method, 4000),
      humanStepsLeft: arr(o.humanStepsLeft),
      humanHoursLeft: numOr(o.humanHoursLeft, 0),
      blocked: str(o.blocked, 2000),
      selfDoubt: str(o.selfDoubt, 2000),
    });
  }
  return out;
}

export function parseGrades(raw: unknown): (Grade & { dryRunId: string })[] {
  const list = (raw as { grades?: unknown })?.grades;
  if (!Array.isArray(list)) return [];
  const out: (Grade & { dryRunId: string })[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const dryRunId = str(o.dryRunId, 100);
    if (!dryRunId) continue;
    const verdict = o.verdict;
    out.push({
      dryRunId,
      meetsRequirement: Math.max(0, Math.min(100, numOr(o.meetsRequirement, 0))),
      deliverable: o.deliverable === true,
      gaps: arr(o.gaps),
      humanHoursNeeded: numOr(o.humanHoursNeeded, 0),
      needsFactCheck: arr(o.needsFactCheck),
      targetMismatch: o.targetMismatch === true,
      verdict:
        verdict === "pass" || verdict === "needs_work" || verdict === "fail" || verdict === "cannot_produce"
          ? verdict
          : "fail",
      reason: str(o.reason, 2000),
    });
  }
  return out;
}

/**
 * 採点を検算する。
 *
 * 「そのまま納品できる（pass）」なのに人の作業が何時間も残っている、
 * というのは矛盾している。数字で判定できるところは、返ってきた結論ではなく
 * こちらの計算を正とする。上書きしたことは記録に残す。
 */
export function reconcileGrade(grade: Grade): { grade: Grade; overridden: string } {
  const g = { ...grade };
  const notes: string[] = [];

  if (g.verdict === "pass" && g.humanHoursNeeded > 1) {
    g.verdict = "needs_work";
    notes.push(`pass と返ってきたが、人の作業が ${g.humanHoursNeeded}時間 残っているので needs_work に落とした`);
  }
  if (g.verdict === "pass" && g.needsFactCheck.length > 0) {
    g.verdict = "needs_work";
    notes.push(`pass と返ってきたが、裏取りが必要な記述が ${g.needsFactCheck.length}件 あるので needs_work に落とした`);
  }
  if (g.verdict === "pass" && !g.deliverable) {
    g.verdict = "needs_work";
    notes.push("pass と返ってきたが、deliverable=false なので needs_work に落とした");
  }
  if (g.meetsRequirement < 60 && (g.verdict === "pass" || g.verdict === "needs_work")) {
    g.verdict = "fail";
    notes.push(`要求充足度が ${g.meetsRequirement} なので fail に落とした`);
  }

  return { grade: g, overridden: notes.join(" / ") };
}

// ---------------------------------------------------------------------------
// 能力表への反映
// ---------------------------------------------------------------------------

export type Evidence = "proven" | "needs_human" | "disproven" | "untested";

export const EVIDENCE_LABELS: Record<Evidence, string> = {
  proven: "実証済み（そのまま納品できた）",
  needs_human: "条件つき（人が手を入れれば納品できた）",
  disproven: "反証された（納品できる水準にならなかった）",
  untested: "未検証（試していない）",
};

/**
 * 試作の結果から、そのジャンルの能力をどう扱うかを決める。
 * 主張ではなく結果で決める。
 */
export function evidenceFor(runs: DryRun[]): Evidence {
  // 成果物が募集と別物だったものは、能力の検証になっていないので除く。
  // ここを数えると「案件選びを間違えた」を「作れない」と誤って結論づける。
  const graded = runs.filter((r) => r.grade !== null && !r.grade.targetMismatch);
  if (graded.length === 0) return "untested";
  if (graded.some((r) => r.grade!.verdict === "pass")) return "proven";
  if (graded.some((r) => r.grade!.verdict === "needs_work")) return "needs_human";
  return "disproven";
}

/** 対象選びを間違えた試作。ハーネス側の問題として別に数える。 */
export const mismatchedRuns = (runs: DryRun[]): DryRun[] =>
  runs.filter((r) => r.grade?.targetMismatch === true);

/** 主張と結果が食い違っているジャンルを洗い出す。ここが直すべきところ。 */
export function findContradictions(
  byGenre: Map<Capability, DryRun[]>
): { genre: Capability; claim: string; evidence: Evidence; note: string }[] {
  const out: { genre: Capability; claim: string; evidence: Evidence; note: string }[] = [];

  for (const target of GENRE_TARGETS) {
    const runs = byGenre.get(target.genre) ?? [];
    const evidence = evidenceFor(runs);
    if (evidence === "untested") continue;

    const capability = CAPABILITIES.find((c) => c.id === target.genre);
    const claimsCan = target.claim === "can";

    if (claimsCan && evidence === "disproven") {
      out.push({
        genre: target.genre,
        claim: "作れる",
        evidence,
        note: `「作れる」としていたが、実際には納品できる水準にならなかった。${capability?.label ?? target.genre} を「作れない」側に移すべき。`,
      });
    }
    if (!claimsCan && (evidence === "proven" || evidence === "needs_human")) {
      out.push({
        genre: target.genre,
        claim: "作れない",
        evidence,
        note: `「作れない」としていたが、実際には${evidence === "proven" ? "納品できた" : "人が手を入れれば納品できた"}。落としていた案件を取り逃していた可能性がある。`,
      });
    }
  }

  return out;
}


// ---------------------------------------------------------------------------
// 対象の選定
// ---------------------------------------------------------------------------

export interface DryRunTarget {
  leadId: string | null;
  sourceUrl: string;
  title: string;
  genre: Capability;
  requirement: string;
  deliverableSpec: string;
}

/**
 * 実在する案件の中から、ジャンルごとに1件ずつ検証対象を選ぶ。
 *
 * ジャンルは案件本文から判定する。ここで「作れない」と判定された案件も
 * 必ず対象に入れる。そうしないと、判定が正しいかどうかを確かめられない。
 */
export function pickTargets(
  leads: Lead[],
  options: { skipGenres?: Set<string>; perGenre?: number } = {}
): DryRunTarget[] {
  const skip = options.skipGenres ?? new Set<string>();
  const perGenre = options.perGenre ?? 1;
  const picked = new Map<Capability, DryRunTarget[]>();

  // 本文が長いものを優先する。短すぎる募集だと成果物を作れず、検証にならない。
  const sorted = [...leads].sort((a, b) => b.rawText.length - a.rawText.length);

  for (const lead of sorted) {
    if (lead.rawText.length < 300) continue;

    // 準委任の要員募集は「成果物を納品する案件」ではないので、試作の対象にしない。
    // ここを外していたせいで、月140時間の常駐案件に「成果物を作れ」と指示し、
    // 出てきたものが募集と別物になって4件が無駄になった。
    if (readEngagement(lead.rawText, lead.budgetJpy).kind === "monthly") continue;

    const judged = judgeDeliverability(lead.rawText);
    for (const genre of judged.matched) {
      if (skip.has(genre)) continue;
      if (!GENRE_TARGETS.some((g) => g.genre === genre)) continue;
      const list = picked.get(genre) ?? [];
      if (list.length >= perGenre) continue;
      // 同じ案件を複数ジャンルで使い回さない（1案件1ジャンル）
      if ([...picked.values()].flat().some((t) => t.leadId === lead.id)) continue;
      list.push({
        leadId: lead.id,
        sourceUrl: lead.url,
        title: lead.title,
        genre,
        requirement: lead.rawText,
        deliverableSpec: getGenreTarget(genre)?.probe ?? "",
      });
      picked.set(genre, list);
    }
  }

  return [...picked.values()].flat();
}

/** まだ一度も検証していないジャンル。案件が見つかっていないものも含む。 */
export function untestedGenres(tested: Set<string>, targets: DryRunTarget[]): GenreTarget[] {
  const covered = new Set([...tested, ...targets.map((t) => t.genre)]);
  return GENRE_TARGETS.filter((g) => !covered.has(g.genre));
}
