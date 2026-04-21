/**
 * Heuristic for showing a markdown preview toggle on editable graph nodes.
 */
export function looksLikeMarkdown(text: string): boolean {
  const t = text.trim();
  if (!t) return false;

  if (t.includes('```')) return true;

  const lines = t.split('\n');
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^\s*#{1,6}\s+\S/.test(line)) return true;
    if (/^\s*[-*+]\s+\S/.test(line)) return true;
    if (/^\s*\d+\.\s+\S/.test(line)) return true;
    if (/^\s*>\s/.test(line)) return true;
    if (/^\s*\[[ xX]\]\s/.test(line)) return true;
    if (/\[[^\]]+\]\([^)]+\)/.test(line)) return true;
    if (/^---+(\s*)$|^\*{3,}(\s*)$|^_+\s*$/.test(line.trim())) return true;
  }

  return false;
}
