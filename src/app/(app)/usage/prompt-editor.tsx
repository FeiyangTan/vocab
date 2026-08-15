'use client';

import { ChevronDown, Loader2, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { PURPOSE_LABEL, PURPOSES, type Purpose } from '@/lib/models';
import {
  CALL_PARAMS,
  DEFAULT_PROMPT,
  MAX_PROMPT_LENGTH,
  OUTPUT_SCHEMA,
  USER_TEMPLATE,
} from '@/lib/prompts';
import { cn } from '@/lib/utils';

export type PromptState = { text: string; customized: boolean };

/**
 * View and edit the prompts sent to Claude. Directly below the model picker on the usage page
 * — **this page is already the AI console**: which model, what instructions, and what it cost
 * are three faces of one thing, and after editing a prompt you can scroll one screen to see
 * what it spent.
 *
 * Everything is collapsed by default: the two prompts run well over a hundred lines together,
 * and expanded they would push the usage statistics entirely off screen — while checking
 * spend is far more frequent than editing a prompt.
 *
 * 🔴 **Only the system prompt is editable**; the user message and output schema are read-only
 * — the first is a data envelope, the second an interface contract mapped one-to-one onto
 * database columns, with the reasoning in `prompts.ts`. But both are **displayed**: the ask
 * was to see every prompt, and hiding them wouldn't answer it.
 */
export function PromptEditor({ current }: { current: Record<Purpose, PromptState> }) {
  return (
    <section>
      <div className="border-t border-border pt-4">
        <div className="mb-3 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
          Prompts
        </div>
        <div className="divide-y divide-border/60">
          {PURPOSES.map((purpose) => (
            <PromptRow key={purpose} purpose={purpose} initial={current[purpose]} />
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Sent with every call, so length costs money on each one. Takes effect on the{' '}
          <strong className="font-medium">next</strong> call (not cached). They are written in
          Chinese on purpose — they tell the model to write Chinese definitions.
        </p>
      </div>
    </section>
  );
}

function PromptRow({ purpose, initial }: { purpose: Purpose; initial: PromptState }) {
  const [open, setOpen] = useState(false);
  /** The saved version — compared against the draft to decide whether anything changed */
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState(initial.text);
  const [busy, setBusy] = useState<'save' | 'reset' | null>(null);
  const [error, setError] = useState('');

  const dirty = draft !== saved.text;
  const tooLong = draft.length > MAX_PROMPT_LENGTH;
  const params = CALL_PARAMS[purpose];

  async function submit(kind: 'save' | 'reset') {
    setBusy(kind);
    setError('');
    const response = await fetch('/api/settings/prompts', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ purpose, prompt: kind === 'reset' ? null : draft }),
    });
    setBusy(null);
    const data = (await response.json().catch(() => ({}))) as {
      error?: string;
      prompt?: string;
      customized?: boolean;
    };
    if (!response.ok || typeof data.prompt !== 'string') {
      setError(data.error ?? 'Failed to save');
      return;
    }
    // The server returns whatever is actually in effect — after a reset it's what refills
    // the editor
    setSaved({ text: data.prompt, customized: data.customized === true });
    setDraft(data.prompt);
  }

  return (
    <div className="py-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 text-left text-sm"
      >
        <ChevronDown
          className={cn(
            'size-3.5 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-180',
          )}
        />
        <span>{PURPOSE_LABEL[purpose]}</span>
        <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
          {saved.customized ? 'Edited' : 'Default'}
        </span>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {saved.text.length} chars
        </span>
      </button>

      {open && (
        <div className="mt-3 space-y-3 pl-5">
          <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            System · max_tokens {params.maxTokens} · effort {params.effort}
          </div>

          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
            aria-label={`${PURPOSE_LABEL[purpose]} system prompt`}
            /* 🔴 The `max-h` is required: the `Textarea` base class carries
               `field-sizing-content`, so it grows to fit its content — and the drafting prompt
               runs over two thousand characters, some ninety lines expanded, pushing the save
               button and the entire usage report below it off screen. Capped, it scrolls
               internally instead. */
            className="max-h-[60vh] min-h-64 overflow-auto font-mono text-xs leading-relaxed"
          />

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <button
              type="button"
              onClick={() => void submit('save')}
              disabled={!dirty || tooLong || busy !== null}
              className="border-b-2 border-primary pb-0.5 font-medium text-primary transition-opacity disabled:border-transparent disabled:font-normal disabled:text-muted-foreground disabled:opacity-50"
            >
              {dirty ? 'Save' : 'Saved'}
            </button>

            {/* "Reset to default" appears only when something is actually customised — on a
                path already at the default it would do nothing when pressed, and its presence
                would only make you wonder what you'd missed */}
            {saved.customized && (
              <button
                type="button"
                onClick={() => void submit('reset')}
                disabled={busy !== null}
                className="inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
              >
                <RotateCcw className="size-3" />
                Reset to default
              </button>
            )}

            {busy && <Loader2 className="size-3 animate-spin text-muted-foreground" />}

            <span
              className={cn(
                'ml-auto text-xs tabular-nums',
                tooLong ? 'text-destructive' : 'text-muted-foreground',
              )}
            >
              {draft.length} / {MAX_PROMPT_LENGTH}
            </span>
          </div>

          {/* Leaving with unsaved edits is easy, so say so plainly — but don't block it */}
          {dirty && !error && (
            <p className="text-xs text-muted-foreground">
              Unsaved — the next call still uses the saved version.
            </p>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}

          <ReadOnlyBlock label="User message" body={USER_TEMPLATE[purpose]} />
          <ReadOnlyBlock
            label="Output schema"
            body={JSON.stringify(OUTPUT_SCHEMA[purpose], null, 2)}
          />

          {/* So that comparing against the original after breaking something doesn't mean
              digging through the code */}
          {saved.customized && (
            <ReadOnlyBlock label="Default system prompt" body={DEFAULT_PROMPT[purpose]} />
          )}
        </div>
      )}
    </div>
  );
}

/** The read-only blocks: collapsed by default, and `<details>` is enough — not worth another
 *  piece of state */
function ReadOnlyBlock({ label, body }: { label: string; body: string }) {
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-[11px] uppercase tracking-[0.14em] text-muted-foreground marker:text-muted-foreground">
        {label} <span className="normal-case tracking-normal">(read-only)</span>
      </summary>
      {/* Its own scroll container: the schema has long lines, and without one a narrow
          screen would be stretched wide by them */}
      <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-sm border border-border bg-muted/30 p-2 font-mono leading-relaxed text-muted-foreground">
        {body}
      </pre>
    </details>
  );
}
