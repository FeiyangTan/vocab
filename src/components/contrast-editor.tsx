'use client';

import { Plus, Volume2, X } from 'lucide-react';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
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
      {!compact && value.length > 0 && (
        <span className="text-xs text-muted-foreground">别搞混</span>
      )}

      {/*
        不用 Badge 的灰底胶囊 —— 对比词是全站最像「纸上批注」的一处，
        衬线斜体 + 墨绿下划线比方块 chip 更贴纸质风。
      */}
      {value.map((word) => (
        <span key={word} className="inline-flex items-center gap-0.5">
          <span className="font-serif text-[15px] italic text-primary underline decoration-border underline-offset-4">
            {word}
          </span>
          <button
            type="button"
            onClick={() => speak(word)}
            aria-label={`朗读 ${word}`}
            className="px-0.5 text-muted-foreground hover:text-foreground"
          >
            <Volume2 className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onChange(value.filter((w) => w !== word))}
            aria-label={`删除 ${word}`}
            disabled={busy}
            className="px-0.5 text-muted-foreground/50 hover:text-foreground"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}

      {adding ? (
        <Input
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
          className="h-7 w-32 rounded-sm px-2 font-serif text-[15px] italic"
        />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          disabled={busy || value.length >= MAX_CONTRASTS}
          className="inline-flex items-center gap-1 rounded-sm border border-dashed px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
        >
          <Plus className="size-3" />
          {value.length === 0 && '对比词'}
        </button>
      )}
    </div>
  );
}
