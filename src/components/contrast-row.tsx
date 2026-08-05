'use client';

import { useState } from 'react';
import { ContrastEditor } from './contrast-editor';

/**
 * 对比词编辑器 + **立刻保存**。用在词已经存在的地方：复习页背面、词汇列表页。
 *
 * 收集箱审核页不能用这个 —— 那时词还没创建，没有 id 可 PUT，
 * 那边直接用 `ContrastEditor` 攒本地 state，随「确认」一起提交。
 */
export function ContrastRow({
  wordId,
  contrasts,
  onChange,
  compact = false,
}: {
  wordId: number;
  contrasts: string[];
  onChange: (next: string[]) => void;
  compact?: boolean;
}) {
  const [pending, setPending] = useState(false);

  async function save(next: string[]) {
    setPending(true);
    const response = await fetch(`/api/words/${wordId}/contrasts`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contrasts: next }),
    });
    setPending(false);
    if (!response.ok) return;
    const data = (await response.json().catch(() => ({}))) as { contrasts?: string[] };
    // 用服务端清洗后的结果，别用本地的 —— trim / 去重 / 上限都在那边
    onChange(data.contrasts ?? next);
  }

  return (
    <ContrastEditor value={contrasts} onChange={save} compact={compact} busy={pending} />
  );
}
