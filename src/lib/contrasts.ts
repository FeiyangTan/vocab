/** A guard against pasting a whole page in by accident, not a product feature */
export const MAX_CONTRASTS = 8;

/**
 * Clean an array of confusables: trim, drop empties, dedupe, truncate.
 *
 * Shared by both write paths — `PUT /api/words/{id}/contrasts` (word already exists) and
 * `POST /api/inbox/{id}/confirm` (word doesn't exist yet, created as part of confirming).
 * null means the input wasn't an array at all.
 */
export function cleanContrasts(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const word = item.trim();
    if (word && !seen.has(word)) seen.add(word);
    if (seen.size >= MAX_CONTRASTS) break;
  }
  return [...seen];
}

/**
 * The `carve (cave)` shorthand: whatever is in parentheses becomes a confusable for the
 * word in front of it.
 *
 * **The match is deliberately narrow** — parentheses are far too common in real sentences
 * (`The dropdown box (a UI control) was ambiguous.`), and stripping them eagerly destroys
 * the context. All of these must hold before it counts:
 *
 * - the line **ends with `)`** and has exactly one pair (text after `)` means it's a
 *   sentence, not this shorthand)
 * - what precedes the parens is a **word or short phrase** (≤ 3 words), not a sentence
 * - neither side is empty
 *
 * When it doesn't match, the input is returned untouched with an empty `contrasts` — better
 * to miss one and have him fill it in by hand than to mangle a real sentence.
 *
 * Multiple confusables are separated by comma / ideographic comma / semicolon / slash:
 * `carve (cave, curve)`. **Not split on spaces**, so a phrase like `(dropdown box)` can be
 * a single confusable.
 */
export function splitContrastSuffix(raw: string): { text: string; contrasts: string[] } {
  const none = { text: raw, contrasts: [] as string[] };

  const trimmed = raw.trim();
  const match = /^([^()]+)[（(]([^()（）]+)[)）]$/.exec(trimmed);
  if (!match) return none;

  const head = match[1].trim();
  const inside = match[2].trim();
  if (!head || !inside) return none;

  // Reject when a whole sentence precedes the parens — that's almost always a real aside
  if (head.split(/\s+/).length > 3) return none;

  const contrasts = cleanContrasts(inside.split(/[,，、;；/／]+/)) ?? [];
  if (contrasts.length === 0) return none;

  return { text: head, contrasts };
}
