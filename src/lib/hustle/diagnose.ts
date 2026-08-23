import type { HustleProfile, PathKey } from "./types";
import type { PathDefinition, SkillTag } from "./paths-schema";

export interface Ranked {
  key: PathKey;
  name: string;
  oneLiner: string;
  /** 0-100 の適合度 */
  score: number;
  /** 除外された場合は理由が入る（score は 0） */
  excludedReason: string | null;
  /** なぜこの順位なのか、上から効いた順 */
  reasons: string[];
  /** 進める場合に必ず読ませたい注意 */
  warnings: string[];
  /** この人が想定すべき現実の数字 */
  outlook: {
    daysToFirstYen: number;
    month3Jpy: [number, number];
    upfrontCostJpy: number;
    minWeeklyHours: number;
  };
  definition: PathDefinition;
}

export interface DiagnosisResult {
  urgent: boolean;
  urgencyNote: string;
  ranked: Ranked[];
  excluded: Ranked[];
  /**
   * 1位のチャネルでは期限に間に合わないとき、並行してやるべき
   * 「もっと速く現金になる手段」。間に合うときは null。
   */
  bridge: { key: PathKey; name: string; note: string } | null;
}

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

function daysUntil(deadline: string): number | null {
  if (!deadline) return null;
  const diff = new Date(`${deadline}T00:00:00`).getTime() - Date.now();
  return Math.ceil(diff / 86_400_000);
}

/**
 * 「今すぐ現金が要るのか、腰を据えて積めるのか」で、何を重視するかを切り替える。
 * 金欠のときに「半年後に伸びる」チャネルを勧めるのは害でしかない。
 */
function assessUrgency(profile: HustleProfile): { urgent: boolean; note: string; daysLeft: number | null } {
  const daysLeft = daysUntil(profile.deadline);

  if (daysLeft !== null && daysLeft <= 45) {
    return {
      urgent: true,
      note: `期限まで残り${daysLeft}日。入金までの速さを最優先で並べています。積み上げ型（ブログ・動画）は間に合わないため順位を下げています。`,
      daysLeft,
    };
  }
  if (profile.budgetJpy <= 0) {
    return {
      urgent: true,
      note: "投じられる現金が0円のため、初期費用が要るものを除外し、入金の速さを重視して並べています。",
      daysLeft,
    };
  }
  return {
    urgent: false,
    note: "急ぎではないため、続けたときに伸びるかどうかも含めて並べています。",
    daysLeft,
  };
}

function skillFit(profile: HustleProfile, def: PathDefinition): { score: number; matched: SkillTag[] } {
  const owned = new Set(profile.skills as SkillTag[]);
  let sum = 0;
  const matched: SkillTag[] = [];
  for (const [tag, bonus] of Object.entries(def.skillAffinity) as [SkillTag, number][]) {
    if (owned.has(tag)) {
      sum += bonus;
      matched.push(tag);
    }
  }
  return { score: clamp(sum), matched };
}

function hardFilter(profile: HustleProfile, def: PathDefinition): string | null {
  if (def.upfrontCostJpy > profile.budgetJpy) {
    return `始めるのに最低 ${def.upfrontCostJpy.toLocaleString()}円 かかりますが、投じられる現金が ${profile.budgetJpy.toLocaleString()}円 です。借りてまで始めるべきではありません。`;
  }
  if (def.requires.bankAccount && !profile.hasBankAccount) {
    return "報酬の受け取りに本人名義の銀行口座が必要です。口座を用意してから再診断してください。";
  }
  if (def.requires.idVerification && !profile.hasIdVerification) {
    return "出金時に本人確認書類の提出が必須です。用意できてから再診断してください。";
  }
  if (def.requires.publicIdentity && profile.needsAnonymity) {
    return "実名や所在を相手に開示する必要があります。身元を伏せたいという条件と両立しません。";
  }
  if (profile.avoid.includes(def.key)) {
    return "「やりたくないこと」に指定されています。";
  }
  const missing = def.equipment.filter((e) => !profile.equipment.includes(e));
  if (missing.includes("pc")) {
    return "パソコンが必須の作業です。スマホだけでは納品品質に届きません。";
  }
  return null;
}

export function diagnose(profile: HustleProfile, definitions: PathDefinition[]): DiagnosisResult {
  const urgency = assessUrgency(profile);
  const daysLeft = urgency.daysLeft;

  // 緊急時は「入金の速さ」、そうでなければ「向き・伸びしろ」に重みを移す。
  const w = urgency.urgent
    ? { speed: 0.4, money: 0.2, fit: 0.28, sustain: 0.12 }
    : { speed: 0.18, money: 0.24, fit: 0.32, sustain: 0.26 };

  const all: Ranked[] = definitions.map((def) => {
    const excludedReason = hardFilter(profile, def);

    // 入金の速さ: 7日で満点、90日で0点
    const speedScore = clamp(100 - ((def.daysToFirstYen.p50 - 7) / 83) * 100);

    // 金額: 3ヶ月目の中央値レンジの下限が、目標月収にどれだけ届くか
    const target = Math.max(1, profile.goalJpy);
    const moneyScore = clamp((def.month3Jpy[0] / target) * 100);

    const fit = skillFit(profile, def);

    const sustainScore = clamp(((def.stability + def.ceiling) / 10) * 100);

    let score =
      speedScore * w.speed + moneyScore * w.money + fit.score * w.fit + sustainScore * w.sustain;

    const warnings: string[] = [];
    const reasons: string[] = [];

    // 使える時間が足りないぶんを減点する
    if (def.minWeeklyHours > profile.weeklyHours) {
      const shortfall = def.minWeeklyHours - profile.weeklyHours;
      const penalty = Math.min(35, shortfall * 4);
      score -= penalty;
      warnings.push(
        `週 ${def.minWeeklyHours}時間 は欲しい作業ですが、確保できるのは週 ${profile.weeklyHours}時間 です。立ち上がりは想定の ${Math.round((profile.weeklyHours / def.minWeeklyHours) * 100)}% の速度になります。`
      );
    }

    // ポートフォリオが要るのに実績ゼロ
    if (def.requires.portfolio && profile.skills.length === 0) {
      score -= 15;
      warnings.push("見せられる制作物が要ります。最初の1件は無報酬でもサンプルを作る必要があります。");
    }

    const missingEquipment = def.equipment.filter((e) => !profile.equipment.includes(e));
    if (missingEquipment.length > 0) {
      score -= missingEquipment.length * 6;
      warnings.push(`不足している環境: ${missingEquipment.join(", ")}`);
    }

    // 順位の説明を、効いた順に組み立てる
    const contributions: { text: string; value: number }[] = [
      { text: `最初の入金まで中央値 ${def.daysToFirstYen.p50}日（遅いと ${def.daysToFirstYen.p90}日）`, value: speedScore * w.speed },
      {
        text: `続けられた場合の3ヶ月目は月 ${def.month3Jpy[0].toLocaleString()}〜${def.month3Jpy[1].toLocaleString()}円`,
        value: moneyScore * w.money,
      },
      {
        text: fit.matched.length
          ? `持っているスキルが活きる（${fit.matched.length}件一致）`
          : "特別なスキルは不要だが、その分だけ単価は上がりにくい",
        value: fit.score * w.fit,
      },
      { text: `収入の安定性 ${def.stability}/5・伸びしろ ${def.ceiling}/5`, value: sustainScore * w.sustain },
    ];
    contributions.sort((a, b) => b.value - a.value);
    reasons.push(...contributions.map((c) => c.text));

    if (def.upfrontCostJpy === 0) {
      reasons.push("初期費用0円で始められる");
    }

    return {
      key: def.key,
      name: def.name,
      oneLiner: def.oneLiner,
      score: excludedReason ? 0 : Math.round(clamp(score)),
      excludedReason,
      reasons,
      warnings,
      outlook: {
        daysToFirstYen: def.daysToFirstYen.p50,
        month3Jpy: def.month3Jpy,
        upfrontCostJpy: def.upfrontCostJpy,
        minWeeklyHours: def.minWeeklyHours,
      },
      definition: def,
    };
  });

  const ranked = all.filter((r) => !r.excludedReason).sort((a, b) => b.score - a.score);
  const excluded = all.filter((r) => r.excludedReason);

  return {
    urgent: urgency.urgent,
    urgencyNote: urgency.note,
    ranked,
    excluded,
    bridge: findBridge(ranked, daysLeft),
  };
}

/**
 * 1位に選ばれたチャネルの入金が期限に間に合わない場合、
 * それより速く現金になる手段を「つなぎ」として別枠で出す。
 *
 * 1位を速いものに差し替えないのは、速いだけのチャネル（不用品販売など）は
 * 売るものが尽きた時点で終わり、本命にはならないため。両方やるのが正解になる。
 */
function findBridge(ranked: Ranked[], daysLeft: number | null): DiagnosisResult["bridge"] {
  const top = ranked[0];
  if (!top || daysLeft === null || daysLeft <= 0) return null;
  if (top.outlook.daysToFirstYen <= daysLeft) return null;

  const faster = ranked
    .slice(1)
    .filter((r) => r.outlook.daysToFirstYen <= daysLeft)
    .sort((a, b) => a.outlook.daysToFirstYen - b.outlook.daysToFirstYen)[0];

  if (!faster) {
    return {
      key: top.key,
      name: top.name,
      note: `期限まで${daysLeft}日ですが、どのチャネルもそれまでに入金が間に合いません。副業で間に合わせようとせず、「現実と相談窓口」にある公的支援を先に使ってください。`,
    };
  }

  return {
    key: faster.key,
    name: faster.name,
    note: `1位の「${top.name}」は最初の入金まで約${top.outlook.daysToFirstYen}日かかり、期限（残り${daysLeft}日）に間に合いません。本命は1位のまま進めつつ、つなぎとして「${faster.name}」（約${faster.outlook.daysToFirstYen}日）を並行してください。`,
  };
}

/** 選んだチャネルの30日プランを、日付つきのタスクに展開する。 */
export function planToTasks(
  def: PathDefinition,
  pathId: string,
  startDate: string = new Date().toISOString().slice(0, 10)
) {
  const base = new Date(`${startDate}T00:00:00`);
  return def.plan.map((item, index) => {
    const due = new Date(base);
    due.setDate(due.getDate() + item.day);
    return {
      pathId,
      title: item.title,
      detail: item.detail,
      kind: item.kind,
      status: "todo" as const,
      dueDate: due.toISOString().slice(0, 10),
      estMinutes: item.estMinutes,
      orderIndex: index,
    };
  });
}
