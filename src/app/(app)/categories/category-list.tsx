'use client';

import { Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { CategoryRow } from '@/db/queries';
import { MAX_CATEGORY_NAME } from '@/lib/categories';

/**
 * Create, rename and delete categories.
 *
 * There is no Dialog component in this repository, so delete confirmation **expands inline**
 * (pick a destination, then confirm) — consistent with the paper look, and one fewer
 * dependency.
 *
 * Every write is followed by `router.refresh()` to re-fetch from the server rather than
 * patching local state — word counts and the default flag get changed as side effects of
 * other operations (deleting the default category promotes another), and local guesses would
 * eventually diverge.
 */
export function CategoryList({ initial }: { initial: CategoryRow[] }) {
  const router = useRouter();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  /** The id of the category being renamed */
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  /** The id of the category awaiting delete confirmation */
  const [deleting, setDeleting] = useState<number | null>(null);
  const [moveTo, setMoveTo] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');

  const isLast = initial.length <= 1;

  async function send(url: string, init: RequestInit) {
    setBusy(true);
    setError('');
    const response = await fetch(url, init);
    setBusy(false);
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? 'Operation failed');
      return false;
    }
    router.refresh();
    return true;
  }

  async function create() {
    const name = newName.trim();
    if (!name) return;
    if (
      await send('/api/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
    ) {
      setNewName('');
      setAdding(false);
    }
  }

  async function rename(id: number) {
    const name = draft.trim();
    if (!name) return;
    if (
      await send(`/api/categories/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
    ) {
      setEditing(null);
    }
  }

  async function makeDefault(id: number) {
    await send(`/api/categories/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isDefault: true }),
    });
  }

  async function remove(row: CategoryRow) {
    const query = row.wordCount > 0 && moveTo ? `?moveTo=${moveTo}` : '';
    if (await send(`/api/categories/${row.id}${query}`, { method: 'DELETE' })) {
      setDeleting(null);
      setMoveTo(null);
    }
  }

  function startDelete(row: CategoryRow) {
    setError('');
    setDeleting(row.id);
    // Preselect the first other category as the destination, saving one tap
    setMoveTo(initial.find((c) => c.id !== row.id)?.id ?? null);
  }

  return (
    <>
      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      <div>
        {initial.map((row) => (
          <div key={row.id} className="border-t border-border py-4">
            <div className="flex items-center justify-between gap-3">
              {editing === row.id ? (
                <>
                  <Input
                    autoFocus
                    value={draft}
                    maxLength={MAX_CATEGORY_NAME}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void rename(row.id);
                      if (e.key === 'Escape') setEditing(null);
                    }}
                    className="h-8 max-w-48"
                  />
                  <div className="flex shrink-0 gap-1">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Save"
                      disabled={busy}
                      onClick={() => void rename(row.id)}
                    >
                      <Check className="size-4" />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Cancel"
                      onClick={() => setEditing(null)}
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex min-w-0 items-baseline gap-2">
                    <span className="truncate font-serif text-xl font-medium">{row.name}</span>
                    {row.isDefault && (
                      <span className="shrink-0 text-[11px] uppercase tracking-[0.14em] text-primary">
                        Default
                      </span>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    <span className="mr-1 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                      {row.wordCount} words
                    </span>
                    {!row.isDefault && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="font-normal text-muted-foreground"
                        disabled={busy}
                        onClick={() => void makeDefault(row.id)}
                      >
                        Make default
                      </Button>
                    )}
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Rename ${row.name}`}
                      onClick={() => {
                        setEditing(row.id);
                        setDraft(row.name);
                        setDeleting(null);
                      }}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Delete ${row.name}`}
                      title={isLast ? 'You must keep at least one category' : undefined}
                      disabled={isLast || busy}
                      onClick={() => startDelete(row)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </>
              )}
            </div>

            {deleting === row.id && (
              <div className="mt-3 border-l-2 border-destructive/40 pl-3">
                {row.wordCount > 0 ? (
                  <>
                    <p className="text-sm">
                      {row.name} still has {row.wordCount} words — move them to:
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {initial
                        .filter((c) => c.id !== row.id)
                        .map((c) => (
                          <Button
                            key={c.id}
                            size="sm"
                            variant={moveTo === c.id ? 'default' : 'outline'}
                            className="font-normal"
                            onClick={() => setMoveTo(c.id)}
                          >
                            {c.name}
                          </Button>
                        ))}
                    </div>
                  </>
                ) : (
                  <p className="text-sm">Delete {row.name}? It has no words.</p>
                )}

                <div className="mt-3 flex gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="font-normal"
                    onClick={() => setDeleting(null)}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    className="font-normal"
                    disabled={busy || (row.wordCount > 0 && !moveTo)}
                    onClick={() => void remove(row)}
                  >
                    {row.wordCount > 0 ? 'Move and delete' : 'Delete'}
                  </Button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="border-t border-border pt-4">
        {adding ? (
          <div className="flex items-center gap-2">
            <Input
              autoFocus
              value={newName}
              maxLength={MAX_CATEGORY_NAME}
              placeholder="Category name"
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void create();
                if (e.key === 'Escape') {
                  setNewName('');
                  setAdding(false);
                }
              }}
              className="h-8 max-w-48"
            />
            <Button size="sm" className="font-normal" disabled={busy} onClick={() => void create()}>
              Create
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="font-normal"
              onClick={() => {
                setNewName('');
                setAdding(false);
              }}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="font-normal text-muted-foreground"
            onClick={() => setAdding(true)}
          >
            <Plus className="size-3.5" />
            New category
          </Button>
        )}
      </div>
    </>
  );
}
