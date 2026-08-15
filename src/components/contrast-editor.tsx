'use client';

import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { MAX_CONTRASTS } from '@/lib/contrasts';
import { speak } from '@/lib/speak';

/**
 * The confusable chip editor — **pure UI, no network**.
 *
 * It's split out because there are two different moments to save:
 * - review page / words page: the word exists, so an edit PUTs immediately (wrapped by
 *   ContrastRow)
 * - inbox review page: the word **doesn't exist yet** (it's created inside the confirm
 *   transaction), so edits accumulate in local state and go out with Confirm
 */
export function ContrastEditor({
  value,
  onChange,
  compact = false,
  busy = false,
  readOnly = false,
  glosses,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  /** The words list is one word per row, so the "Confusables" label is redundant there */
  compact?: boolean;
  busy?: boolean;
  /**
   * Display only: keeps the words and **speech** (speaking isn't editing, and hearing them was
   * the original point of confusables), drops add and remove. The words page's collapsed card
   * uses this; adding and removing live in the expanded detail.
   */
  readOnly?: boolean;
  /**
   * word → Chinese gloss, **resolved on the server and passed down**
   * (`src/lib/dictionary.ts`). Only contains what was found; anything missing gets no title
   * and so pops no empty bubble.
   */
  glosses?: Record<string, string>;
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
        <span className="text-xs text-muted-foreground">Confusables</span>
      )}

      {/*
        Not Badge's grey pill — confusables are the most annotation-like thing in the app, and
        a serif italic with an ink-green underline suits the paper look better than a square
        chip.
      */}
      {value.map((word) => (
        /* `flex-wrap` + `min-w-0`: with the gloss expanded this chip can be wider than a
           line, so it has to be allowed to wrap internally — otherwise a narrow screen gets a
           horizontal scrollbar across the whole page */
        <span key={word} className="inline-flex min-w-0 flex-wrap items-center gap-0.5">
          {/*
            The word is itself the speak button — a separate speaker icon beside it would be
            pure visual noise. The hover gloss uses Tooltip rather than the native `title`:
            the latter needs 1–2 seconds of stillness and won't appear if the pointer drifts,
            so in practice you conclude there is no hint at all.
          */}
          <ChipButton word={word} gloss={glosses?.[word]} />
          {!readOnly && (
            <button
              type="button"
              onClick={() => onChange(value.filter((w) => w !== word))}
              aria-label={`Remove ${word}`}
              disabled={busy}
              className="px-0.5 text-muted-foreground/50 hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          )}
        </span>
      ))}

      {readOnly ? null : adding ? (
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
          placeholder="a similar word"
          className="h-7 w-32 rounded-sm px-2 font-serif text-[15px] italic"
        />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          disabled={busy || value.length >= MAX_CONTRASTS}
          aria-label="Add a confusable"
          className="inline-flex items-center gap-1 rounded-sm border border-dashed px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
        >
          <Plus className="size-3" />
          {value.length === 0 && 'Confusables'}
        </button>
      )}
    </div>
  );
}

/**
 * One confusable chip: **tap = speak + expand the phonetics and gloss in place**, tap again to
 * collapse.
 *
 * 🔴 Why tapping wasn't simply repurposed to "show the gloss": tapping already meant speak,
 * and that can't be lost — many confusables are confusable because they **sound** alike
 * (crispy / crisis), which the spelling doesn't convey. So it does both.
 *
 * 🔴 Why it expands inline rather than in a popup: on mobile, Radix's `Tooltip` deliberately
 * doesn't respond to touch, and switching to `Popover` means handling positioning, stacking
 * and click-outside — plus Quick pass's gesture container is `overflow-hidden`, so a floating
 * layer gets clipped. Inline depends on none of that and behaves identically everywhere. The
 * cost is that the row reflows, which is acceptable.
 *
 * The desktop hover bubble is kept — hovering is less work than tapping. **But it stops
 * appearing once expanded**, or the same text would be on screen twice.
 */
function ChipButton({ word, gloss }: { word: string; gloss?: string }) {
  const [open, setOpen] = useState(false);

  const button = (
    <button
      type="button"
      onClick={() => {
        speak(word);
        // A word with no gloss only speaks, rather than leaving a toggle that does nothing
        if (gloss) setOpen((v) => !v);
      }}
      aria-label={gloss ? `Speak ${word} and ${open ? 'hide' : 'show'} its gloss` : `Speak ${word}`}
      aria-expanded={gloss ? open : undefined}
      className="font-serif text-[15px] italic text-primary underline decoration-border underline-offset-4 transition-colors hover:decoration-primary"
    >
      {word}
    </button>
  );

  // No gloss means no Tooltip wrapper — nothing should pop an empty bubble
  if (!gloss) return button;

  return (
    <>
      {open ? (
        button
      ) : (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>{button}</TooltipTrigger>
            <TooltipContent>{gloss}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
      {open && (
        /* Deliberately quiet styling: it's an annotation and shouldn't compete with the
           italic word itself.
           **No `whitespace-nowrap`** — a gloss can run twenty or thirty characters
           (`/ˈkraɪsɪs/ n. 危机, 危险期, 决定性时刻`), and refusing to wrap overflows
           horizontally on a narrow screen */
        <span className="min-w-0 text-xs text-muted-foreground">{gloss}</span>
      )}
    </>
  );
}
