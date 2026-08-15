/** A guard against pasting a whole page in by accident, not a product feature */
export const MAX_REMARK = 500;

/**
 * Clean a note: trim, truncate, collapse anything empty to null.
 *
 * Shared by three write paths — `PUT /api/words/{id}/remark` (word already exists),
 * `POST /api/inbox/{id}/confirm` and `POST /api/inbox/confirm-batch`
 * (word doesn't exist yet, created as part of confirming).
 *
 * **Interior newlines are preserved** — a note may be several lines; only the ends are trimmed.
 * Empty string and null mean the same thing, "never written", so don't leave a pile of
 * empty strings in the database.
 */
export function cleanRemark(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const remark = value.trim();
  if (!remark) return null;
  return remark.slice(0, MAX_REMARK);
}
