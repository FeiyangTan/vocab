'use client';

import { Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { MAX_REMARK } from '@/lib/remark';

/**
 * 备注编辑器 + **立刻保存**。用在词已经存在的地方：词汇页展开区、复习页背面。
 *
 * 收集箱审核页不能用这个 —— 那时词还没创建，没有 id 可 PUT，
 * 那边直接把备注攒进本地 Draft，随「确认」一起提交。
 */
export function RemarkRow({
  wordId,
  remark,
  onChange,
}: {
  wordId: number;
  remark: string | null;
  onChange: (next: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(remark ?? '');
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const response = await fetch(`/api/words/${wordId}/remark`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ remark: draft }),
    });
    setBusy(false);
    setEditing(false);
    if (!response.ok) return;
    const data = (await response.json().catch(() => ({}))) as { remark?: string | null };
    // 用服务端清洗后的结果，别用本地的 —— trim / 截断都在那边
    const next = data.remark ?? null;
    setDraft(next ?? '');
    onChange(next);
  }

  if (editing) {
    return (
      <Textarea
        autoFocus
        value={draft}
        maxLength={MAX_REMARK}
        rows={2}
        disabled={busy}
        placeholder="Why it's tricky, where you saw it…"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void save();
          }
          if (e.key === 'Escape') {
            setDraft(remark ?? '');
            setEditing(false);
          }
        }}
        className="text-sm"
      />
    );
  }

  if (!remark) {
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
        Note
      </Button>
    );
  }

  return (
    <div className="flex items-start justify-between gap-2">
      {/* whitespace-pre-wrap：备注可能是几行，换行要留着 */}
      <p className="min-w-0 flex-1 whitespace-pre-wrap text-sm">{remark}</p>
      <Button
        variant="ghost"
        size="icon-sm"
        className="shrink-0"
        aria-label="Edit note"
        onClick={() => {
          setDraft(remark);
          setEditing(true);
        }}
      >
        <Pencil className="size-3.5" />
      </Button>
    </div>
  );
}
