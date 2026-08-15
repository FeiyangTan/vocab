'use client';

import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ContrastRow } from '@/components/contrast-row';
import { RemarkRow } from '@/components/remark-row';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { speak } from '@/lib/speak';
import { GRADES } from '@/lib/sm2';

type Card = {
  id: number;
  clozeText: string;
  lemma: string;
  note: string | null;
  pos: string | null;
  rawText: string;
  wordId: number;
  contrasts: string[];
  remark: string | null;
};

/**
 * One review session. Cloze sentence → flip for the answer → four grading buttons.
 *
 * Every answer POSTs back to the server before the next card is fetched — on iOS the system
 * reaps a backgrounded PWA, and progress held in memory until the end would be gone the moment
 * you switched apps.
 *
 * Confusables appear **on the back only**: the front is a fill-in-the-blank, and putting
 * similar words on it degrades that into multiple choice, weakening free recall. Their job on
 * the back is "now that you've answered, don't mix this up with X".
 */
export function ReviewSession({
  scope,
  name,
}: {
  /** A category id or `'all'`. Interpolated straight into the query string, hence a string
   *  rather than a number */
  scope: string;
  name: string;
}) {
  const [card, setCard] = useState<Card | null>(null);
  const [remaining, setRemaining] = useState(0);
  /** confusable → gloss, fetched together with the card */
  const [glosses, setGlosses] = useState<Record<string, string>>({});
  const [flipped, setFlipped] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setFlipped(false);
    const response = await fetch(`/api/review?category=${scope}`);
    const data = (await response.json().catch(() => ({}))) as {
      card?: Card | null;
      remaining?: number;
      glosses?: Record<string, string>;
      error?: string;
    };
    setLoading(false);
    if (!response.ok) {
      setError(data.error ?? 'Failed to load');
      return;
    }
    setCard(data.card ?? null);
    setRemaining(data.remaining ?? 0);
    setGlosses(data.glosses ?? {});
  }, [scope]);

  useEffect(() => {
    void load();
  }, [load]);

  async function grade(g: number) {
    if (!card) return;
    const id = card.id;
    setCard(null); // switch away immediately, so fast taps can't grade the same card twice
    await fetch(`/api/review/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grade: g }),
    });
    await load();
  }

  // Keyboard: space flips, 1–4 grade
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!card) return;
      // Don't steal keys while a confusable is being typed — otherwise the characters in
      // "courtesy" would trigger grades
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;

      if (e.code === 'Space') {
        e.preventDefault();
        setFlipped((f) => !f);
        return;
      }
      if (flipped && e.key >= '1' && e.key <= '4') {
        void grade(Number(e.key) - 1);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col p-4 md:p-8">
      <div className="mb-6 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1">
          {/* A permanent way out — previously "back to the queue list" only appeared once a
              queue was finished, leaving nowhere to tap to switch category mid-session */}
          <Button asChild variant="ghost" size="icon-sm" className="-ml-1 shrink-0">
            <Link href="/review" aria-label="Back to queues">
              <ChevronLeft className="size-4" />
            </Link>
          </Button>
          <h1 className="truncate font-serif text-2xl font-medium tracking-tight">{name}</h1>
        </div>
        <span className="shrink-0 text-sm text-muted-foreground">{remaining} left</span>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {loading && !card ? (
        <p className="py-24 text-center text-sm text-muted-foreground">…</p>
      ) : !card ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4">
          <p className="text-sm text-muted-foreground">This queue is done</p>
          <Button asChild variant="outline">
            <Link href="/review">Back to queues</Link>
          </Button>
        </div>
      ) : (
        <>
          <div className="flex flex-1 flex-col justify-center gap-10">
            {/* Front: the sentence with the blank. Confusables never appear here */}
            <p className="text-center font-serif text-2xl leading-[1.65]">{card.clozeText}</p>

            {flipped ? (
              /* The paper look layers with whitespace and hairlines rather than boxes — Card
                 is only a layout container here */
              <Card className="gap-6 border-0 bg-transparent p-0 ring-0">
                {/* The word is itself the speak button, consistent with the confusables —
                    no separate speaker icon */}
                <button
                  type="button"
                  aria-label={`Speak ${card.lemma}`}
                  onClick={() => speak(card.lemma)}
                  className="mx-auto block font-serif text-4xl font-medium transition-colors hover:text-primary"
                >
                  {card.lemma}
                </button>

                {card.note && (
                  <p className="text-center text-base">
                    {card.pos && (
                      <span className="mr-1 text-muted-foreground">{card.pos}</span>
                    )}
                    {card.note}
                  </p>
                )}

                <Separator />
                <ContrastRow
                  wordId={card.wordId}
                  contrasts={card.contrasts}
                  onChange={(next) => setCard({ ...card, contrasts: next })}
                  glosses={glosses}
                />

                <Separator />
                {/* The sentence is itself the speak button, consistent with the word and the
                    confusables */}
                <button
                  type="button"
                  aria-label="Speak the example"
                  onClick={() => speak(card.rawText)}
                  className="block w-full text-center font-serif text-[15px] italic leading-relaxed text-muted-foreground transition-colors hover:text-foreground"
                >
                  {card.rawText}
                </button>

                {/* The note goes last — the sentence is the context you met it in, the note
                    is your own annotation, so it closes the card */}
                <Separator />
                <RemarkRow
                  wordId={card.wordId}
                  remark={card.remark}
                  onChange={(next) => setCard({ ...card, remark: next })}
                />
              </Card>
            ) : (
              <Button
                variant="outline"
                className="mx-auto h-auto px-6 py-2.5 font-normal"
                onClick={() => setFlipped(true)}
              >
                Flip <span className="ml-1 text-xs opacity-50">space</span>
              </Button>
            )}
          </div>

          {flipped && (
            <div className="grid grid-cols-4 gap-2 pt-10">
              {GRADES.map((g, i) => (
                <Button
                  key={g.grade}
                  variant="outline"
                  title={g.hint}
                  onClick={() => grade(g.grade)}
                  className="h-auto flex-col gap-0.5 rounded-sm py-3 font-normal"
                >
                  <span>{g.label}</span>
                  <span className="text-[11px] tabular-nums text-muted-foreground/60">{i + 1}</span>
                </Button>
              ))}
            </div>
          )}
        </>
      )}
    </main>
  );
}
