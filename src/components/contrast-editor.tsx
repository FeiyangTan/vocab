'use client';

import { useState } from 'react';
import { MAX_CONTRASTS } from '@/lib/contrasts';
import { speak } from '@/lib/speak';

/**
 * 对比词 chip 编辑器 —— **纯 UI，不碰网络**。
 *
 * 拆成这一层是因为有两种保存时机：
 * - 复习页 / 词汇页：词已存在，改一下就立刻 PUT（外面包一层 ContrastRow）
 * - 收集箱审核页：词**还不存在**（确认的事务里才创建），只能先攒在本地 state，
 *   随「确认」一起提交
 */
export function ContrastEditor({
  value,
  onChange,
  compact = false,
  busy = false,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  /** 词汇列表页一行一个词，「别搞混」这个标签就省了 */
  compact?: boolean;
  busy?: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');

  function add() {
    const word = draft.trim();
    setDraft('');
    setAdding(false);
    if (!word || value.includes(word)) return;
    onChange([...value, word]);
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {!compact && value.length > 0 && <span className="text-xs opacity-50">别搞混</span>}

      {value.map((word) => (
        <span
          key={word}
          className="inline-flex items-center gap-1 rounded-full border border-black/15 py-0.5 pl-2.5 pr-1 dark:border-white/20"
        >
          {word}
          <button
            type="button"
            onClick={() => speak(word)}
            aria-label={`朗读 ${word}`}
            className="px-1 opacity-60 hover:opacity-100"
          >
            🔊
          </button>
          <button
            type="button"
            onClick={() => onChange(value.filter((w) => w !== word))}
            aria-label={`删除 ${word}`}
            disabled={busy}
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
              add();
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
          type="button"
          onClick={() => setAdding(true)}
          disabled={busy || value.length >= MAX_CONTRASTS}
          className="rounded-full border border-dashed border-black/20 px-2.5 py-0.5 text-xs opacity-50 hover:opacity-100 disabled:opacity-20 dark:border-white/25"
        >
          {value.length > 0 ? '+' : '+ 对比词'}
        </button>
      )}
    </div>
  );
}
