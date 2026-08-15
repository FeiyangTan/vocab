'use client';

import { Pencil, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

/**
 * The definition editor plus **immediate save**. Used in the words page's expanded area.
 *
 * It edits the **encounter's** definition, not the word's — the same word can mean different
 * things in different contexts.
 *
 * Besides updating local state, a save must call `router.refresh()`: this definition **appears
 * in two places** (the main card's row shows the most recent encounter's definition, while the
 * expanded area shows each one separately), so a local-only update would leave the main card
 * on the old value.
 */
export function NoteRow({
  encounterId,
  pos,
  note,
  onChange,
}: {
  encounterId: number;
  /** Part of speech — same origin as the definition, judged per context. Shown but not
   *  editable here (change it on the inbox review page) */
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
