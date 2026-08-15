'use client';

import { Pencil } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * 改词本身。用在词汇页的展开区。
 *
 * 保存成功后必须 `router.refresh()` —— 词、音标、词频档位条都在**卡片头部**
 * 由服务端渲染，只更新展开区的话头部会停在旧词上。
 *
 * 撞 `(lemma, category_id)` 唯一索引时接口返回 409，这里把文案显示出来、
 * **输入框保持打开**让人接着改，而不是默默关掉。
 */
export function LemmaRow({ wordId, lemma }: { wordId: number; lemma: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(lemma);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    const next = draft.trim();
    if (!next || next === lemma) {
      setEditing(false);
      setError('');
      return;
    }
    setBusy(true);
    setError('');
    const response = await fetch(`/api/words/${wordId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lemma: next }),
    });
    setBusy(false);
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? 'Rename failed');
      return; // 不关输入框
    }
    setEditing(false);
    router.refresh();
  }

  if (editing) {
    return (
      <div>
        <Input
          autoFocus
          value={draft}
          maxLength={80}
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void save();
            }
            if (e.key === 'Escape') {
              setDraft(lemma);
              setError('');
              setEditing(false);
            }
          }}
          className="h-8 font-serif text-[15px]"
        />
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-2">
      <span className="min-w-0 truncate font-serif text-[15px]">{lemma}</span>
      <Button
        variant="ghost"
        size="icon-sm"
        className="shrink-0"
        aria-label="Edit the word"
        onClick={() => {
          setDraft(lemma);
          setEditing(true);
        }}
      >
        <Pencil className="size-3.5" />
      </Button>
    </div>
  );
}
