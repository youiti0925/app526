// Domain-specific terminology dictionary
// Backed by SQLite via API

export interface GlossaryEntry {
  id: string;
  term: string;
  reading?: string;      // furigana / pronunciation hint
  definition: string;
  category: "machine" | "tool" | "measurement" | "process" | "material" | "safety" | "other";
  synonyms: string[];    // alternative names/abbreviations
}

let glossaryCache: GlossaryEntry[] | null = null;

export function getGlossary(): GlossaryEntry[] {
  return glossaryCache ?? [];
}

export async function fetchGlossary(): Promise<GlossaryEntry[]> {
  try {
    const res = await fetch("/api/glossary");
    if (!res.ok) return [];
    const entries: GlossaryEntry[] = await res.json();
    glossaryCache = entries;
    return entries;
  } catch {
    return [];
  }
}

export async function saveGlossary(entries: GlossaryEntry[]): Promise<void> {
  glossaryCache = entries;
  // Bulk replace: delete all then re-insert
  // For simplicity, we sync individual entries
}

export async function addGlossaryEntry(entry: Omit<GlossaryEntry, "id">): Promise<GlossaryEntry> {
  try {
    const res = await fetch("/api/glossary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry),
    });
    const newEntry: GlossaryEntry = await res.json();
    glossaryCache = [...(glossaryCache ?? []), newEntry];
    return newEntry;
  } catch {
    const fallback = { ...entry, id: crypto.randomUUID() } as GlossaryEntry;
    glossaryCache = [...(glossaryCache ?? []), fallback];
    return fallback;
  }
}

export async function deleteGlossaryEntry(id: string): Promise<void> {
  glossaryCache = (glossaryCache ?? []).filter((e) => e.id !== id);
  try {
    await fetch(`/api/glossary?id=${id}`, { method: "DELETE" });
  } catch {
    // ignore
  }
}

export async function updateGlossaryEntry(id: string, updates: Partial<GlossaryEntry>): Promise<void> {
  glossaryCache = (glossaryCache ?? []).map((e) => (e.id === id ? { ...e, ...updates } : e));
  try {
    await fetch("/api/glossary", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...updates }),
    });
  } catch {
    // ignore
  }
}

/**
 * Format glossary for AI prompt injection
 */
export function formatGlossaryForPrompt(): string {
  const entries = getGlossary();
  if (entries.length === 0) return "";

  const lines = entries.map((e) => {
    let line = `- ${e.term}`;
    if (e.synonyms.length > 0) line += ` (別名: ${e.synonyms.join(", ")})`;
    line += `: ${e.definition}`;
    return line;
  });

  return `\n\n=== 専門用語辞書 ===\n以下の専門用語をテキスト生成・認識時に参照してください:\n${lines.join("\n")}`;
}
