// Domain-specific terminology dictionary
// Helps AI transcription and analysis accuracy

const GLOSSARY_KEY = "videosop-glossary";

export interface GlossaryEntry {
  id: string;
  term: string;
  reading?: string;      // furigana / pronunciation hint
  definition: string;
  category: "machine" | "tool" | "measurement" | "process" | "material" | "safety" | "other";
  synonyms: string[];    // alternative names/abbreviations
}

export function getGlossary(): GlossaryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = localStorage.getItem(GLOSSARY_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export function saveGlossary(entries: GlossaryEntry[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(GLOSSARY_KEY, JSON.stringify(entries));
}

export function addGlossaryEntry(entry: Omit<GlossaryEntry, "id">): GlossaryEntry {
  const entries = getGlossary();
  const newEntry = { ...entry, id: crypto.randomUUID() };
  entries.push(newEntry);
  saveGlossary(entries);
  return newEntry;
}

export function deleteGlossaryEntry(id: string): void {
  const entries = getGlossary().filter((e) => e.id !== id);
  saveGlossary(entries);
}

export function updateGlossaryEntry(id: string, updates: Partial<GlossaryEntry>): void {
  const entries = getGlossary().map((e) => (e.id === id ? { ...e, ...updates } : e));
  saveGlossary(entries);
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
