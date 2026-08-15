'use client';

import { Pencil, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

/**
 * 释义编辑器 + **立刻保存**。用在词汇页展开区。
 *
 * 改的是 **encounter** 的释义，不是词的 —— 同一个词在不同语境下意思可以不一样。
 *
 * 保存后除了更新本地，还要 `router.refresh()`：这条释义**在两个地方出现**
 *（主卡片那行取的是最近一次 encounter 的释义，展开区里是每条各自的），
 * 只更新本地的话主卡片会停在旧值上。
 */
export function NoteRow({
  encounterId,
  pos,
  note,
  onChange,
}: {
  encounterId: number;
  /** 词性，和释义同源、按语境判定。只显示不在这儿改（改词性去收集箱审核页） */
  pos: string | null;
  note: string | null;
  onChange: (next: string | null) => void;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note ?? '');
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const response = await fetch(`/api/encounters/${encounterId}/note`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: draft }),
    });
    setBusy(false);
    setEditing(false);
    if (!response.ok) return;
    const data = (await response.json().catch(() => ({}))) as { note?: string | null };
    const next = data.note ?? null;
    setDraft(next ?? '');
    onChange(next);
    router.refresh();
  }

  if (editing) {
    return (
      <Textarea
        autoFocus
        value={draft}
        rows={2}
        disabled={busy}
        placeholder="Chinese definition"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void save();
          }
          if (e.key === 'Escape') {
            setDraft(note ?? '');
            setEditing(false);
          }
        }}
        className="text-sm"
      />
    );
  }

  if (!note) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="font-normal text-muted-foreground"
        onClick={() => {
          setDraft('');
          setEditing(true);
        }}
      >
        <Plus className="size-3.5" />
        Definition
      </Button>
    );
  }

  return (
    <div className="flex items-start justify-between gap-2">
      <p className="min-w-0 flex-1 text-sm text-muted-foreground">
        {pos && <span className="mr-1 text-muted-foreground/60">{pos}</span>}
        {note}
      </p>
      <Button
        variant="ghost"
        size="icon-sm"
        className="shrink-0"
        aria-label="Edit definition"
        onClick={() => {
          setDraft(note);
          setEditing(true);
        }}
      >
        <Pencil className="size-3.5" />
      </Button>
    </div>
  );
}
