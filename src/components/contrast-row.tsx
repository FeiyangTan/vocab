'use client';

import { Loader2, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ContrastEditor } from './contrast-editor';

/**
 * The confusable editor plus **immediate save**. Used where the word already exists: the back
 * of a review card, and the words list.
 *
 * The inbox review page can't use this — the word doesn't exist yet, so there's no id to PUT
 * to. That page uses `ContrastEditor` directly, accumulating local state that goes out with
 * Confirm.
 */
export function ContrastRow({
  wordId,
  contrasts,
  onChange,
  compact = false,
  glosses,
}: {
  wordId: number;
  contrasts: string[];
  onChange: (next: string[]) => void;
  compact?: boolean;
  glosses?: Record<string, string>;
}) {
  const [pending, setPending] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [error, setError] = useState('');
  /** "Searched, found nothing suitable" has to be said out loud, or the button looks broken */
  const [notice, setNotice] = useState('');
  /** Glosses for newly added words come back with the response, layered over the set the
   *  server sent down */
  const [extra, setExtra] = useState<Record<string, string>>({});

  /**
   * Ask Claude for look-alikes and sound-alikes and add them directly. **Billed per call**, so
   * it only fires on a button press, never as autocomplete (calling it on page load would mean
   * paying for every browse).
   */
  async function suggest() {
    setSuggesting(true);
    setError('');
    setNotice('');
    const response = await fetch(`/api/words/${wordId}/contrasts/suggest`, { method: 'POST' });
    setSuggesting(false);
    const data = (await response.json().catch(() => ({}))) as {
      contrasts?: string[];
      added?: string[];
      dropped?: number;
      glosses?: Record<string, string>;
      error?: string;
    };
    if (!response.ok) {
      setError(data.error ?? 'Matching failed');
      return;
    }
    // The server has already unioned with the existing set and cleaned it, so use its result
    if (data.contrasts) onChange(data.contrasts);
    if (data.glosses) setExtra((prev) => ({ ...prev, ...data.glosses }));
    if (!data.added?.length) {
      setNotice(
        data.dropped
          ? `No common-enough confusables (${data.dropped} suggestions dropped as too rare)`
          : 'No suitable confusables found',
      );
    }
  }

  async function save(next: string[]) {
    setPending(true);
    const response = await fetch(`/api/words/${wordId}/contrasts`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contrasts: next }),
    });
    setPending(false);
    if (!response.ok) return;
    const data = (await response.json().catch(() => ({}))) as {
      contrasts?: string[];
      glosses?: Record<string, string>;
    };
    // Use the server's cleaned result rather than the local one — trimming, deduping and the
    // cap all live there
    onChange(data.contrasts ?? next);
    if (data.glosses) setExtra((prev) => ({ ...prev, ...data.glosses }));
  }

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-1">
        <ContrastEditor
          value={contrasts}
          onChange={save}
          compact={compact}
          busy={pending}
          glosses={{ ...glosses, ...extra }}
        />
        <Button
          variant="ghost"
          size="icon-xs"
          className="shrink-0 text-muted-foreground"
          aria-label="Let AI find confusables"
          title="Let AI find look-alike / homophone / easily-confused words and add them"
          disabled={suggesting || pending}
          onClick={() => void suggest()}
        >
          {suggesting ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <Sparkles className="size-3" />
          )}
        </Button>
      </div>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      {notice && <p className="mt-1 text-xs text-muted-foreground">{notice}</p>}
    </div>
  );
}
