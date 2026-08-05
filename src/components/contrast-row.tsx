'use client';

import { useState } from 'react';
import { speak } from '@/lib/speak';

/**
 * 对比词编辑器。复习页背面和词汇列表页共用。
 *
 * 「就地添加」是这个功能的关键 —— 意识到「我又把这两个搞混了」的那一刻，
 * 恰恰是答错翻面的那一刻。当场能加，摩擦最小。
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
  /** 词汇列表页里一行一个词，标签省掉 */
  compact?: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
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

  async function add() {
    const word = draft.trim();
    setDraft('');
    setAdding(false);
    if (!word || contrasts.includes(word)) return;
    await save([...contrasts, word]);
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {!compact && contrasts.length > 0 && (
        <span className="text-xs opacity-50">别搞混</span>
      )}

      {contrasts.map((word) => (
        <span
          key={word}
          className="inline-flex items-center gap-1 rounded-full border border-black/15 py-0.5 pl-2.5 pr-1 dark:border-white/20"
        >
          {word}
          <button
            onClick={() => speak(word)}
            aria-label={`朗读 ${word}`}
            className="px-1 opacity-60 hover:opacity-100"
          >
            🔊
          </button>
          <button
            onClick={() => save(contrasts.filter((w) => w !== word))}
            aria-label={`删除 ${word}`}
            disabled={pending}
            className="px-1 text-xs opacity-30 hover:opacity-80"
          >
            ✕
          </button>
        </span>
      ))}

      {adding ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={add}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void add();
            }
            if (e.key === 'Escape') {
              setDraft('');
              setAdding(false);
            }
          }}
          placeholder="相近的词"
          className="w-28 rounded-full border border-black/15 px-2.5 py-0.5 text-sm outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/50"
        />
      ) : (
        <button
          onClick={() => setAdding(true)}
          disabled={pending || contrasts.length >= 8}
          className="rounded-full border border-dashed border-black/20 px-2.5 py-0.5 text-xs opacity-50 hover:opacity-100 disabled:opacity-20 dark:border-white/25"
        >
          {contrasts.length > 0 ? '+' : '+ 对比词'}
        </button>
      )}
    </div>
  );
}
