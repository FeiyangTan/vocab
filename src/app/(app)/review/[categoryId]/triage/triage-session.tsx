'use client';

import { ChevronLeft, Trash2, Volume2 } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { speak } from '@/lib/speak';
import { cn } from '@/lib/utils';
import { WordDetail, type Encounter } from '../../../words/word-detail';

/** Where the phonetics toggle is stored. A setting should be remembered — one you re-press
 *  on every visit isn't a setting */
const PHONETIC_KEY = 'vocab:triage:phonetic';

/** How far counts as a swipe. About the natural travel of one thumb on a phone */
const SWIPE_THRESHOLD = 70;
/** Past this displacement it counts as "a swipe", and the click that follows must be
 *  suppressed (otherwise swiping across the word also speaks it) */
const SLOP = 8;

type Word = {
  id: number;
  lemma: string;
  phonetic: string | null;
  remark: string | null;
  contrasts: string[];
  zipf: number | null;
  category: string;
  /** Every encounter of this word, each with its own definition and sentence */
  encounters: Encounter[];
};

/**
 * One Quick pass session. See the word → Know / Don't know / Delete, clearing the whole
 * category to finish a round.
 *
 * The queue lives on the server and this takes **one word at a time** — same reasoning as
 * cloze review, and it also makes "refresh doesn't lose progress" true for free: the frontend
 * holds no queue at all.
 *
 * The detail is **hidden by default** — the point of this mode is to test yourself first, so
 * the answer has to be asked for. Once opened it shows **exactly** what the words page shows
 * when expanded (reusing `WordDetail`), sentences and confusables included: deciding whether
 * you know a word often depends on the sentence to jog the memory, and without it you're only
 * guessing.
 */
export function TriageSession({
  scope,
  name,
  pushBack,
}: {
  /** A category id or `'all'`. Interpolated straight into the query string / request body,
   *  hence a string rather than a number */
  scope: string;
  name: string;
  /** How many places a "Don't know" moves back. Passed in from the server — `@/lib/triage`
   *  pulls in drizzle and must not enter the client bundle */
  pushBack: number;
}) {
  const [word, setWord] = useState<Word | null>(null);
  /** confusable → phonetics + gloss, fetched with the word (the tables live server-side) */
  const [glosses, setGlosses] = useState<Record<string, string>>({});
  const [remaining, setRemaining] = useState(0);
  const [roundOver, setRoundOver] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  /** The first tap on Delete only arms it — it takes the sentences and review progress with
   *  it, and there is no undo */
  const [armed, setArmed] = useState(false);
  /** Pressing "Don't know" on the last remaining word returns the same word. Say so plainly,
   *  rather than letting it look stuck */
  const [stuck, setStuck] = useState(false);
  /*
   * Whether to show phonetics. **On by default** (which is how it always was).
   *
   * In this mode the phonetics sit right there next to the word, rather than behind Details —
   * so turn it off to test pronunciation too (read the spelling aloud yourself, then tap the
   * word to check).
   *
   * The initial value is true rather than a direct localStorage read: there is no localStorage
   * during server rendering, and reading it directly makes the first paint disagree with
   * hydration. The real value is filled in by the effect below.
   */
  const [showPhonetic, setShowPhonetic] = useState(true);

  useEffect(() => {
    if (localStorage.getItem(PHONETIC_KEY) === 'off') setShowPhonetic(false);
  }, []);

  function togglePhonetic() {
    setShowPhonetic((v) => {
      localStorage.setItem(PHONETIC_KEY, v ? 'off' : 'on');
      return !v;
    });
  }

  /*
   * ---- vertical swipe gestures ----
   *
   * Swipe up = Know, swipe down = Don't know. **The primary path on mobile**, with the bottom
   * buttons kept as they were. Delete deliberately has no gesture: an irreversible action
   * shouldn't happen from one swipe (it takes two taps as it is).
   *
   * Pointer Events rather than Touch Events — touch and mouse go through one code path, it
   * drags on desktop too, and that also makes it verifiable in a desktop browser.
   */

  /** Vertical displacement since pointerdown. null = not dragging */
  const [dragY, setDragY] = useState<number | null>(null);
  /** The direction the card flies once a judgement lands. null = not flying */
  const [flying, setFlying] = useState<'up' | 'down' | null>(null);
  /*
   * How many cards have been dealt. Used as the card's `key`: change the number and React
   * remounts the element, which replays the entry keyframes.
   *
   * 🔴 `word.id` can't be the key — marking "Don't know" on the last remaining word returns
   * that same word, so the id doesn't change, the animation doesn't replay, and it looks
   * frozen.
   */
  const [dealt, setDealt] = useState(0);
  /**
   * Which way the previous card left, which decides the side the next one enters from.
   * A ref rather than state: it's read once during render, and as state it would dirty
   * `load`'s dependencies.
   */
  const flew = useRef<'up' | 'down' | null>(null);
  const startY = useRef(0);
  /** Whether this interaction already counts as a swipe. Used to suppress the click on
   *  release */
  const swiping = useRef(false);
  /*
   * Currently dragging — 🔴 **must be a ref; `dragY !== null` cannot stand in for it.**
   *
   * `dragY` is the value captured by the render closure: a pointermove arriving after
   * pointerdown but before React has re-rendered still sees the stale null, and that entire
   * stretch of movement is dropped. A quick flick of the finger (where down and the first few
   * moves land in one frame) is exactly that case, and the swipe fails for no visible reason.
   * A ref is written and read on the spot, with no such lag.
   */
  const dragging = useRef(false);

  /*
   * 🔴 **Only take over the gesture while the detail is collapsed.**
   *
   * A vertical swipe competes with page scrolling for the same motion. With the detail
   * collapsed this screen doesn't need to scroll at all, so the gesture area gets
   * `touch-action: none` to keep the browser entirely out of it (which also blocks iOS
   * pull-to-refresh). Once the detail expands the content grows and the page must scroll, so
   * the gesture is switched off and the bottom buttons take over.
   *
   * The detail collapses automatically on every new word, so the gesture is live nearly all
   * of the time.
   */
  const swipeEnabled = !revealed && !busy && !flying && word !== null;

  function onPointerDown(e: React.PointerEvent) {
    if (!swipeEnabled) return;
    startY.current = e.clientY;
    swiping.current = false;
    dragging.current = true;
    setDragY(0);
    /*
     * Capture the pointer, so events keep arriving even if the finger leaves this element.
     *
     * Wrapped in try because it throws NotFoundError when the pointerId isn't an "active
     * pointer", and that throw takes the whole handler down with it — the gesture stops
     * working entirely. A failed capture costs at most some events once you leave the
     * element's bounds, which isn't worth sacrificing the gesture for.
     */
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignored: it still works uncaptured, it just breaks if you swipe outside the element
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!dragging.current) return;
    const dy = e.clientY - startY.current;
    if (Math.abs(dy) > SLOP) swiping.current = true;
    setDragY(dy);
  }

  function onPointerUp(e: React.PointerEvent) {
    if (!dragging.current) return;
    dragging.current = false;
    // The displacement is computed from the event too, not read from state — same reason,
    // state may not have caught up with the final move
    const dy = e.clientY - startY.current;
    setDragY(null);
    if (Math.abs(dy) < SWIPE_THRESHOLD) return; // under the threshold, springs back

    const direction = dy < 0 ? 'up' : 'down';
    setFlying(direction);
    // Don't wait for the fly-out animation before sending the request — a round trip already
    // takes 200–350ms, and running them in sequence is visibly sluggish. Animation and
    // request run together, and whichever finishes first doesn't change the outcome.
    void judge(direction === 'up' ? 'known' : 'unknown');
  }

  /** The browser still fires a click on release; after a swipe it has to be suppressed, or
   *  it triggers the word's pronunciation */
  function onClickCapture(e: React.MouseEvent) {
    if (!swiping.current) return;
    e.preventDefault();
    e.stopPropagation();
    swiping.current = false;
  }

  const load = useCallback(
    async (previousId?: number) => {
      setLoading(true);
      setRevealed(false);
      setArmed(false);
      const response = await fetch(`/api/triage?category=${scope}`);
      const data = (await response.json().catch(() => ({}))) as {
        word?: Word | null;
        glosses?: Record<string, string>;
        remaining?: number;
        roundOver?: boolean;
        error?: string;
      };
      setLoading(false);
      if (!response.ok) {
        setError(data.error ?? 'Failed to load');
        return;
      }
      const next = data.word ?? null;
      setWord(next);
      setGlosses(data.glosses ?? {});
      setRemaining(data.remaining ?? 0);
      setRoundOver(Boolean(data.roundOver));
      setStuck(previousId !== undefined && next?.id === previousId);
      // The new word has landed: clear the flying state and deal a card (key changes → the
      // entry animation replays)
      setFlying(null);
      setDealt((n) => n + 1);
    },
    [scope],
  );

  useEffect(() => {
    void load();
  }, [load]);

  async function judge(action: 'known' | 'unknown') {
    if (!word || busy) return;
    const id = word.id;
    // The entry direction follows the judgement, so buttons, shortcuts and gestures all
    // produce the same motion
    flew.current = action === 'known' ? 'up' : 'down';
    setBusy(true);
    const response = await fetch(`/api/triage/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // scope goes with it: "back 10 places" is counted inside **the queue currently on
      // screen**, and going back 10 within All lands somewhere different than within one
      // category
      body: JSON.stringify({ action, scope }),
    });
    setBusy(false);
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? 'Failed to submit');
      return;
    }
    // Only "Don't know" can leave the word in place; "Know" always moves on, so no notice
    // is needed
    await load(action === 'unknown' ? id : undefined);
  }

  async function remove() {
    if (!word || busy) return;
    if (!armed) {
      setArmed(true);
      return;
    }
    setBusy(true);
    const response = await fetch(`/api/words/${word.id}`, { method: 'DELETE' });
    setBusy(false);
    if (!response.ok) {
      setArmed(false);
      setError('Failed to delete');
      return;
    }
    await load();
  }

  async function again() {
    setBusy(true);
    await fetch('/api/triage/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ categoryId: scope }),
    });
    setBusy(false);
    await load();
  }

  // Disarm automatically if the second tap doesn't come, so a stray touch while parked on
  // this screen can't delete anything
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 5000);
    return () => clearTimeout(timer);
  }, [armed]);

  // Keyboard: space reveals the detail, 1 is Don't know, 2 is Know. **Delete has no
  // shortcut** — an irreversible action shouldn't happen from one keypress
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!word) return;
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;

      if (e.code === 'Space') {
        e.preventDefault();
        setRevealed((r) => !r);
        return;
      }
      if (e.key === '1') void judge('unknown');
      if (e.key === '2') void judge('known');
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col p-4 md:p-8">
      <div className="mb-6 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1">
          <Button asChild variant="ghost" size="icon-sm" className="-ml-1 shrink-0">
            <Link href="/review" aria-label="Back to queues">
              <ChevronLeft className="size-4" />
            </Link>
          </Button>
          <h1 className="truncate font-serif text-2xl font-medium tracking-tight">{name}</h1>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <span className="text-sm text-muted-foreground">{remaining} left</span>
          {/* The phonetics toggle. An icon button takes no room — this screen's subject is
              the word in the middle */}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-pressed={showPhonetic}
            aria-label={showPhonetic ? 'Hide phonetics' : 'Show phonetics'}
            title={showPhonetic ? 'Hide phonetics (US, CMUdict)' : 'Show phonetics (US, CMUdict)'}
            onClick={togglePhonetic}
          >
            <Volume2 className={cn('size-4', !showPhonetic && 'opacity-40')} />
          </Button>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {loading && !word ? (
        <p className="py-24 text-center text-sm text-muted-foreground">…</p>
      ) : !word ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4">
          <p className="text-sm text-muted-foreground">
            {roundOver ? 'Round finished' : 'No words in this category yet'}
          </p>
          {roundOver && (
            <Button variant="outline" disabled={busy} onClick={() => void again()}>
              New round
            </Button>
          )}
          <Button asChild variant="ghost" size="sm">
            <Link href="/review">Back to queues</Link>
          </Button>
        </div>
      ) : (
        <>
          {/*
            The gesture area is the whole middle region, not just the few dozen pixels of the
            word — on a phone it has to accept a casual swipe rather than demanding aim.
            `touch-action: none` is applied **only while the gesture is live**: once the detail
            expands the content grows and the page must scroll, and control goes back to the
            browser.
          */}
          <div
            className={cn(
              'relative flex flex-1 flex-col justify-center overflow-hidden',
              swipeEnabled && 'touch-none select-none',
            )}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onClickCapture={onClickCapture}
          >
            {/* The two hints. **Outside** the card, so they stay put while the card follows
                the finger */}
            <SwipeHint label="Know" side="up" dy={dragY} />
            <SwipeHint label="Don’t know" side="down" dy={dragY} />

            <div
              key={dealt}
              style={{
                transform: flying
                  ? `translateY(${flying === 'up' ? '-120vh' : '120vh'})`
                  : dragY !== null
                    ? // Follows the finger and shrinks slightly — the further it goes, the
                      // more it reads as leaving your hand
                      `translateY(${dragY}px) scale(${1 - Math.min(Math.abs(dragY), 240) / 2400})`
                    : undefined,
                opacity:
                  flying !== null
                    ? 0
                    : dragY !== null
                      ? 1 - Math.min(Math.abs(dragY), 300) / 600
                      : undefined,
                // No transition while dragging, or it can't keep up with the finger
                transition: dragY !== null ? 'none' : undefined,
                animation:
                  flying === null && flew.current
                    ? `triage-enter-from-${flew.current === 'up' ? 'below' : 'above'} 180ms ease-out`
                    : undefined,
              }}
              className={cn(
                'flex flex-col justify-center gap-8',
                // Flying out runs 180ms straight; releasing under the threshold springs back
                // with a little bounce, which feels more physical
                flying
                  ? 'transition-[transform,opacity] duration-[180ms] ease-out'
                  : 'transition-[transform,opacity] duration-200 ease-[cubic-bezier(.2,1.3,.4,1)]',
              )}
            >
            {/* Word and phonetics travel together, phonetics tucked against the word —
                consistent with the words page */}
            <div className="flex flex-wrap items-baseline justify-center gap-x-2 gap-y-1">
              <button
                type="button"
                aria-label={`Speak ${word.lemma}`}
                onClick={() => speak(word.lemma)}
                className="font-serif text-4xl font-medium transition-colors hover:text-primary"
              >
                {word.lemma}
              </button>
              {showPhonetic && word.phonetic && (
                <button
                  type="button"
                  aria-label={`Speak ${word.lemma}`}
                  onClick={() => speak(word.lemma)}
                  className="text-sm text-muted-foreground/70 transition-colors hover:text-primary"
                >
                  /{word.phonetic}/
                </button>
              )}
            </div>

            {revealed ? (
              /*
               * Reuses the words page's expanded component, with **identical content**:
               * category + frequency, each encounter's definition and highlighted sentence,
               * confusables, and the note. No second copy — two places showing the same card
               * would eventually drift apart if written separately.
               *
               * `showLemma={false}`: the word is already up there in large type.
               */
              <div className="space-y-4">
                <Separator />
                <WordDetail
                  wordId={word.id}
                  lemma={word.lemma}
                  category={word.category}
                  zipf={word.zipf}
                  encounters={word.encounters}
                  contrasts={word.contrasts}
                  onContrastsChange={(next) => setWord({ ...word, contrasts: next })}
                  glosses={glosses}
                  remark={word.remark}
                  onRemarkChange={(next) => setWord({ ...word, remark: next })}
                  showLemma={false}
                />
              </div>
            ) : (
              <Button
                variant="outline"
                className="mx-auto h-auto px-6 py-2.5 font-normal"
                onClick={() => setRevealed(true)}
              >
                Details <span className="ml-1 text-xs opacity-50">space</span>
              </Button>
            )}

            {stuck && (
              <p className="text-center text-xs text-muted-foreground">
                It’s the only word left — marking it “don’t know” brings it right back. Know it or delete it to finish the round.
              </p>
            )}
            </div>
          </div>

          <div className="flex items-stretch gap-2 pt-10">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void judge('unknown')}
              className="h-auto flex-1 flex-col gap-0.5 rounded-sm py-3 font-normal"
              title={`Moves back ${pushBack} places — you’ll see it again this round`}
            >
              <span>Don’t know</span>
              <span className="text-[11px] tabular-nums text-muted-foreground/60">1</span>
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void judge('known')}
              className="h-auto flex-1 flex-col gap-0.5 rounded-sm py-3 font-normal"
              title="Won’t appear again this round"
            >
              <span>Know</span>
              <span className="text-[11px] tabular-nums text-muted-foreground/60">2</span>
            </Button>
            {/* Delete is not in the same league as the other two — no equal width, and no
                shortcut */}
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void remove()}
              aria-label={armed ? `Confirm delete ${word.lemma}` : `Delete ${word.lemma}`}
              title={armed ? 'Tap again to delete (along with its examples and review progress)' : 'Delete this word'}
              className={`h-auto shrink-0 rounded-sm px-4 font-normal ${
                armed ? 'border-destructive text-destructive' : 'text-muted-foreground'
              }`}
            >
              <Trash2 className="size-4" />
              {armed && <span className="text-xs">Tap again</span>}
            </Button>
          </div>
        </>
      )}
    </main>
  );
}

/**
 * The hint that floats above or below during a swipe, telling you **what releasing will do**.
 *
 * It only appears for the direction you're actually swiping: up lights "Know", down lights
 * "Don't know" — both lit at once would be no hint at all.
 *
 * Past the threshold it switches to a solid highlight, and that visual jump *is* the "release
 * now and it happens" signal. There's no hover on a phone, so this has to carry it.
 */
function SwipeHint({
  label,
  side,
  dy,
}: {
  label: string;
  side: 'up' | 'down';
  /** The current vertical displacement; null = not dragging */
  dy: number | null;
}) {
  const towards = dy !== null && (side === 'up' ? dy < 0 : dy > 0);
  const distance = towards ? Math.abs(dy) : 0;
  const past = distance >= SWIPE_THRESHOLD;

  return (
    <div
      aria-hidden
      className={cn(
        'pointer-events-none absolute inset-x-0 flex justify-center transition-opacity duration-100',
        side === 'up' ? 'top-0' : 'bottom-0',
      )}
      // Fully lit exactly at the threshold, fading in proportionally before that
      style={{ opacity: Math.min(distance / SWIPE_THRESHOLD, 1) }}
    >
      <span
        className={cn(
          'rounded-full border px-4 py-1 text-sm transition-colors',
          past
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-border text-muted-foreground',
        )}
      >
        {label}
      </span>
    </div>
  );
}
