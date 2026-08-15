/** Max category-name length. Not a product feature — a guard against pasting a page in */
export const MAX_CATEGORY_NAME = 40;

/**
 * Clean a category name: trim, collapse runs of interior whitespace to one space, truncate.
 *
 * Shared by both write paths — `POST /api/categories` (create) and
 * `PATCH /api/categories/{id}` (rename). null means the name is unusable.
 */
export function cleanCategoryName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim().replace(/\s+/g, ' ');
  if (!name) return null;
  return name.slice(0, MAX_CATEGORY_NAME);
}

/**
 * Parse a category id from a path param or request body into a positive integer.
 *
 * Guarantees the *shape* only, **not that the row exists** — existence is the caller's job to
 * check, because the error wording and transaction boundary differ per route.
 */
export function parseCategoryId(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n <= 0) return null;
  return n;
}

/**
 * Review scope: one category, or `'all'` (no category filter, everything mixed together).
 *
 * Shared by both review modes. A category id and `'all'` occupy the same parameter slot, so
 * `/review/5` and `/review/all` land on the same dynamic route — no separate page for "all".
 */
export type Scope = number | 'all';

/** A superset of `parseCategoryId`: also accepts `'all'`. */
export function parseScope(value: unknown): Scope | null {
  if (value === 'all') return 'all';
  return parseCategoryId(value);
}
