'use client';

import { Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { MAX_REMARK } from '@/lib/remark';

/**
 * The note editor plus **immediate save**. Used where the word already exists: the words page's
 * expanded area, and the back of a review card.
 *
 * The inbox review page can't use this — the word doesn't exist yet, so there's no id to PUT
 * to. That page accumulates the note in its local Draft, which goes out with Confirm.
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
    // Use the server's cleaned result rather than the local one — trimming and truncation
    // both live there
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
      {/* whitespace-pre-wrap: a note may be several lines, and the breaks must survive */}
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
