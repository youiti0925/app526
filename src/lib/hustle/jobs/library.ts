/**
 * 手順書と使用量の記録を、リポジトリの library/ に書き出す（と、起動時に読み戻す）。
 *
 * なぜ要るか:
 * クラウドの作業場所（Claude Code on the web）はしばらく使わないと消え、SQLite も一緒に消える。
 * 手順書が消えると、次の依頼はまた「新しい型」になって上位モデルを使う。慣れた型ほど軽くなる
 * 仕組みが効かなくなるので、手順書だけはGitHubに残す。
 *
 * 依頼者のデータはGitHubに置かない:
 * - 手本（testSet）は依頼者の資料から作られることがある。公開情報だけの依頼の手本以外は書き出さない
 * - 使用量の記録は、モデル・時間・トークンだけ（依頼の中身は入れない）
 *
 * 有効にするのは環境変数 JOB_LIBRARY_DIR が設定されているときだけ（scripts/job.mjs が設定する）。
 */
import fs from "node:fs";
import path from "node:path";
import type { Recipe } from "./recipe";
import type { UsageRecord } from "./models";

export function libraryDir(): string | null {
  const dir = process.env.JOB_LIBRARY_DIR?.trim();
  return dir ? dir : null;
}

/** GitHubに置いてよい形にする。依頼者の資料から作った手本は外す。 */
export function publishable(recipe: Recipe): Recipe {
  if (recipe.testSet && recipe.testSet.dataClass !== "public") {
    return { ...recipe, testSet: null };
  }
  return recipe;
}

export function exportRecipe(recipe: Recipe): void {
  const dir = libraryDir();
  if (!dir) return;
  const recipes = path.join(dir, "recipes");
  fs.mkdirSync(recipes, { recursive: true });
  const safeId = recipe.id.replace(/[^a-z0-9_-]/gi, "_");
  fs.writeFileSync(path.join(recipes, `${safeId}.json`), `${JSON.stringify(publishable(recipe), null, 2)}\n`);
}

export function readLibraryRecipes(): Recipe[] {
  const dir = libraryDir();
  if (!dir) return [];
  const recipes = path.join(dir, "recipes");
  if (!fs.existsSync(recipes)) return [];
  const out: Recipe[] = [];
  for (const name of fs.readdirSync(recipes)) {
    if (!name.endsWith(".json")) continue;
    try {
      out.push(JSON.parse(fs.readFileSync(path.join(recipes, name), "utf8")) as Recipe);
    } catch {
      /* 壊れたファイルは読まない（DB側の検証でも弾かれる） */
    }
  }
  return out;
}

export type UsageLine = UsageRecord & { at: string; jobId: string | null; recipeId: string | null };

export function appendUsage(line: UsageLine): void {
  const dir = libraryDir();
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
  // note にはエラー文が入ることがあり、依頼の中身が混ざりうるので書き出さない
  const { note: _note, ...rest } = line;
  fs.appendFileSync(path.join(dir, "usage.jsonl"), `${JSON.stringify(rest)}\n`);
}

export function readLibraryUsage(): UsageLine[] {
  const dir = libraryDir();
  if (!dir) return [];
  const file = path.join(dir, "usage.jsonl");
  if (!fs.existsSync(file)) return [];
  const out: UsageLine[] = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push({ ...(JSON.parse(line) as Omit<UsageLine, "note">), note: "" });
    } catch {
      /* 壊れた行は飛ばす */
    }
  }
  return out;
}
