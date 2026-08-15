/**
 * SM-2 spaced repetition. A proven algorithm — don't invent your own.
 *
 * Original SM-2 grades on 0–5, but this project's API contract is **0–3** (four buttons),
 * so map onto the original scale first, then apply the formula:
 *
 *   0 no idea → q=0    1 struggled to recall → q=3    2 slight hesitation → q=4    3 instant → q=5
 *
 * q < 3 counts as a lapse: reps reset, interval resets, due again in 10 minutes
 * (so it can come back around within the same session).
 */

export const GRADES = [
  { grade: 0, label: 'Again', hint: 'No idea at all' },
  { grade: 1, label: 'Hard', hint: 'Took a long time' },
  { grade: 2, label: 'Good', hint: 'A little hesitation' },
  { grade: 3, label: 'Easy', hint: 'Instant' },
] as const;

const Q_BY_GRADE = [0, 3, 4, 5] as const;

/** How soon a lapse comes back. Within the same session, which is SM-2's "relearn now". */
const RELEARN_MINUTES = 10;

export type CardState = { ease: number; interval: number; reps: number };
export type NextState = CardState & { due: Date };

export function sm2(state: CardState, grade: number, now = new Date()): NextState {
  const q = Q_BY_GRADE[Math.min(3, Math.max(0, Math.trunc(grade)))];

  // Ease factor follows the original formula, updated on lapses too (q=0 drops it sharply)
  const ease = Math.max(1.3, state.ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));

  if (q < 3) {
    return {
      ease,
      interval: 0,
      reps: 0,
      due: new Date(now.getTime() + RELEARN_MINUTES * 60_000),
    };
  }

  const reps = state.reps + 1;
  const interval = reps === 1 ? 1 : reps === 2 ? 6 : Math.round(state.interval * ease);

  return {
    ease,
    interval,
    reps,
    due: new Date(now.getTime() + interval * 86_400_000),
  };
}
