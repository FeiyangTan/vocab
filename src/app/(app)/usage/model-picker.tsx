'use client';

import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  MODEL_CHOICES,
  PURPOSES,
  PURPOSE_LABEL,
  type ModelId,
  type Purpose,
} from '@/lib/models';
import { cn } from '@/lib/utils';

/**
 * Which model each AI path uses. At the top of the usage page — **what you're using comes
 * before what it cost** — and the spend below is already grouped by model, so a refresh after
 * changing it gives you the comparison directly.
 *
 * Choosing per path is deliberate: drafting is the quality-critical path (lemmatisation,
 * context-specific definitions, a cloze that aligns with the original sentence), while
 * confusables carries far less risk (homophones no longer depend on the model at all).
 */
export function ModelPicker({ current }: { current: Record<Purpose, ModelId> }) {
  const router = useRouter();
  // Optimistic update: it changes on tap, and rolls back if the request fails
  const [value, setValue] = useState(current);
  const [busy, setBusy] = useState<Purpose | null>(null);
  const [error, setError] = useState('');

  async function pick(purpose: Purpose, model: ModelId) {
    if (value[purpose] === model || busy) return;
    const previous = value[purpose];
    setValue((v) => ({ ...v, [purpose]: model }));
    setBusy(purpose);
    setError('');
    const response = await fetch('/api/settings/models', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ purpose, model }),
    });
    setBusy(null);
    if (!response.ok) {
      setValue((v) => ({ ...v, [purpose]: previous }));
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? 'Failed to save');
      return;
    }
    // The spend breakdown below is grouped by model, so it needs a refresh to line up
    router.refresh();
  }

  return (
    <section>
      <div className="border-t border-border pt-4">
        <div className="mb-3 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
          Model
        </div>

        <div className="space-y-3">
          {PURPOSES.map((purpose) => (
            <div key={purpose} className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span className="w-20 shrink-0 text-sm">{PURPOSE_LABEL[purpose]}</span>
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                {MODEL_CHOICES.map((choice) => {
                  const active = value[purpose] === choice.id;
                  return (
                    <button
                      key={choice.id}
                      type="button"
                      disabled={busy !== null}
                      onClick={() => void pick(purpose, choice.id)}
                      title={`${choice.id} · ${choice.note}`}
                      aria-pressed={active}
                      className={cn(
                        'border-b-2 pb-0.5 text-sm transition-colors disabled:opacity-50',
                        active
                          ? 'border-primary font-medium text-primary'
                          : 'border-transparent text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {choice.tier}
                      <span className="ml-1.5 text-[11px] tabular-nums opacity-60">
                        {choice.note.split(' (')[0]}
                      </span>
                    </button>
                  );
                })}
                {busy === purpose && (
                  <Loader2 className="size-3 animate-spin text-muted-foreground" />
                )}
              </div>
            </div>
          ))}
        </div>

        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

        <p className="mt-3 text-xs text-muted-foreground">
          Takes effect on the <strong className="font-medium">next</strong> call (not cached).
          Draft is the quality-critical path — it produces the cloze that must align with the
          original sentence; downgrading too far breaks the inflected-word highlight.
          Confusables is low risk: homophones aren’t computed by the model anyway.
        </p>
      </div>
    </section>
  );
}
