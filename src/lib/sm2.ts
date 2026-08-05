/**
 * SM-2 间隔重复算法。成熟方案，不要自己发明。
 *
 * 原始 SM-2 的评分是 0–5，但本项目的 API 契约定的是 **0–3**（四个按钮），
 * 所以先映射到原始量表再套公式：
 *
 *   0 完全不会 → q=0    1 很吃力想起来 → q=3    2 有点犹豫 → q=4    3 秒答 → q=5
 *
 * q < 3 算失败：reps 归零、间隔归零、10 分钟后再来一次（同一场复习里能再遇到）。
 */

export const GRADES = [
  { grade: 0, label: '不会', hint: '完全没印象' },
  { grade: 1, label: '勉强', hint: '想了很久' },
  { grade: 2, label: '记得', hint: '有点犹豫' },
  { grade: 3, label: '秒答', hint: '毫不费力' },
] as const;

const Q_BY_GRADE = [0, 3, 4, 5] as const;

/** 失败后多久再出现。放在同一场复习里能再撞见，符合 SM-2 的「当场重来」。 */
const RELEARN_MINUTES = 10;

export type CardState = { ease: number; interval: number; reps: number };
export type NextState = CardState & { due: Date };

export function sm2(state: CardState, grade: number, now = new Date()): NextState {
  const q = Q_BY_GRADE[Math.min(3, Math.max(0, Math.trunc(grade)))];

  // 难度系数按原始公式更新，失败也照更新（q=0 会显著拉低）
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
