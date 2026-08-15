'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import type { CategoryOption } from './review-list';

/**
 * Adding by hand from the web.
 *
 * Why it exists: macOS's Services mechanism won't register on this machine (the Shortcut never
 * appears in Preview's or Chrome's Services menu, and `pbs -dump` shows 0 matches in the
 * registry), so the Mac keyboard-shortcut route is a dead end. The iPhone share sheet is
 * unaffected and still works.
 *
 * Cookie-authenticated, not token — the token is reserved for the Shortcut and must not end up
 * in frontend JS.
 *
 * By default it **splits on newlines into separate items** (entering a run of words at once is
 * common). But sentences copied from a PDF or an ebook carry layout line wraps, not sentence
 * boundaries, and splitting those produces fragments — hence the "whole block is one item"
 * toggle.
 *
 * The "Save to" row renders here but its state lives on `InboxPanel` — it's a master control,
 * and the review cards below read the same value.
 */
export function CaptureBox({
  categories,
  categoryId,
  onCategoryChange,
}: {
  categories: CategoryOption[];
  categoryId: number | null;
  onCategoryChange: (id: number) => void;
}) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [asOne, setAsOne] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  const willSave = asOne ? (text.trim() ? 1 : 0) : lines.length;

  async function submit() {
    if (willSave === 0) return;
    setPending(true);
    setError('');

    const response = await fetch('/api/inbox', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        raw_text: text,
        source: 'web',
        split: !asOne,
        category_id: categoryId,
      }),
    });

    setPending(false);
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? 'Failed to save');
      return;
    }
    setText('');
    router.refresh();
  }

  return (
    <div className="mb-6">
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // ⌘Enter / Ctrl+Enter submits directly, without reaching for the mouse
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void submit();
          }
        }}
        rows={3}
        placeholder="Paste an English sentence, or one word per line. carve (cave) — the part in parentheses becomes a confusable"
        className="resize-y font-serif text-[15px] leading-relaxed"
      />

      {categories.length > 1 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-muted-foreground">Save to</span>
          {categories.map((c) => (
            <Button
              key={c.id}
              size="xs"
              variant={categoryId === c.id ? 'default' : 'outline'}
              className="font-normal"
              onClick={() => onCategoryChange(c.id)}
            >
              {c.name}
            </Button>
          ))}
        </div>
      )}

      <div className="mt-2 flex items-center justify-between gap-3">
        <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
          <Checkbox checked={asOne} onCheckedChange={(v) => setAsOne(v === true)} />
          Whole block as one
        </label>

        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            {willSave > 0 ? `Save ${willSave} · ⌘↩` : '⌘↩ Save'}
          </span>
          <Button size="sm" onClick={submit} disabled={pending || willSave === 0}>
            {pending ? '…' : 'Save'}
          </Button>
        </div>
      </div>

      {!asOne && lines.length > 1 && (
        <p className="mt-1.5 text-xs text-muted-foreground">
          Text copied from PDFs or e-books often has hard line breaks — tick “Whole block as one” for that
        </p>
      )}

      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  );
}
