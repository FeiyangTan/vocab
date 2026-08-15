'use client';

import { Pencil } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * Editing the word itself. Used in the words page's expanded area.
 *
 * A successful save must be followed by `router.refresh()` — the word, its phonetics and the
 * frequency band are all rendered by the server in the **card header**, so updating only the
 * expanded area would leave the header showing the old word.
 *
 * Colliding with the `(lemma, category_id)` unique index returns 409, and this shows that
 * message while **keeping the input open** so the edit can continue, rather than closing
 * silently.
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
      return; // leave the input open
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
