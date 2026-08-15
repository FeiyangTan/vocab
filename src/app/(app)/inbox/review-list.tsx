'use client';

import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ContrastEditor } from '@/components/contrast-editor';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import type { Draft } from '@/db/schema';
import { CONFIRM_BATCH_SIZE, PROCESS_BATCH_SIZE } from '@/lib/batch';
import { MAX_REMARK } from '@/lib/remark';

/** The minimum horizontal displacement (px) that counts as a swipe. Any smaller and ordinary
 *  finger tremor triggers it */
const SWIPE_THRESHOLD = 60;

export type CategoryOption = { id: number; name: string; isDefault: boolean };

export type InboxItem = {
  id: number;
  rawText: string;
  source: string;
  draft: Draft | null;
  /** The category chosen at capture time; null = none was chosen (the Shortcut path) */
  categoryId: number | null;
  createdAt: string;
};

/**
 * One item per screen. The four fields are directly editable — "edit" needs no button of its
 * own; you change something and press Confirm, which saves one mode switch.
 */
export function ReviewList({
  items,
  unprocessed,
  categories,
  categoryId,
}: {
  items: InboxItem[];
  unprocessed: number;
  categories: CategoryOption[];
  /** Whatever the "Save to" control at the top selects — confirming files it there */
  categoryId: number | null;
}) {
  const router = useRouter();
  /**
   * Which item is being reviewed, tracked by **id, not index**.
   *
   * Background drafting calls `router.refresh()` after each batch, so the list changes while
   * jimmy is mid-review. With an index: confirming A leaves the index pointing at B, then the
   * refresh drops A from the list (it's now processed), everything shifts left by one, and the
   * same index now points at C — **B is silently skipped and never reviewed at all**.
   */
  const [currentId, setCurrentId] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [processed, setProcessed] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  /** Stop only affects batches **not yet sent**; one already in flight finishes first */
  const stopped = useRef(false);
  /** The first tap on "Confirm all" only arms it; the second actually writes — this step is
   *  irreversible and the app has no undo */
  const [armed, setArmed] = useState(false);
  const [confirming, setConfirming] = useState<{ done: number; total: number } | null>(null);

  const idx = items.findIndex((i) => i.id === currentId);
  const safeIdx = idx >= 0 ? idx : 0;
  const current = items[safeIdx];

  /**
   * id → edited fields. **A ref, not state** — it's written on every keystroke and doesn't need
   * to trigger a re-render.
   *
   * This layer exists because `ReviewCard` is keyed by `key={id}`, so paging remounts it and
   * resets all local state. Previously the only way out was confirm or discard (leave and
   * never return), which made that harmless; once you can page back and forth, "edit item 3 →
   * look ahead → come back and the edits are gone" would happen daily.
   */
  const edits = useRef(new Map<number, Draft>());
  const draftOf = (item: InboxItem) => edits.current.get(item.id) ?? item.draft!;

  function go(delta: number) {
    const next = items[safeIdx + delta];
    if (next) {
      setArmed(false); // paging disarms, so the armed state can't follow you to another card
      setCurrentId(next.id);
    }
  }

  // Disarm automatically if the second press doesn't come — so a stray touch half an hour
  // later can't write everything
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 5000);
    return () => clearTimeout(timer);
  }, [armed]);

  // ← / → page. Keys aren't stolen while the caret is in an input — otherwise moving the
  // caret inside the example sentence would page
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
      e.preventDefault();
      go(e.key === 'ArrowRight' ? 1 : -1);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  /** Touch swipe: left for the next item, right for the previous */
  const touch = useRef<{ x: number; y: number } | null>(null);

  function onTouchStart(e: React.TouchEvent) {
    // Ignore swipes starting on an input control — that's selecting text or operating the
    // control, not paging
    const el = e.target as HTMLElement;
    if (el.closest('input, textarea, button')) {
      touch.current = null;
      return;
    }
    const t = e.touches[0];
    touch.current = { x: t.clientX, y: t.clientY };
  }

  function onTouchEnd(e: React.TouchEvent) {
    const start = touch.current;
    touch.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    // The horizontal displacement must be large enough **and** exceed the vertical one, or
    // this fights with vertical scrolling
    if (Math.abs(dx) < SWIPE_THRESHOLD || Math.abs(dx) <= Math.abs(dy)) return;
    go(dx < 0 ? 1 : -1);
  }

  /**
   * Confirm all. **Sent sequentially, never concurrently** — confirm runs one transaction
   * (find-or-create word → encounter → card), and confirming the same lemma concurrently would
   * create two word rows.
   */
  async function confirmAll() {
    setArmed(false);
    setConfirming({ done: 0, total: items.length });
    setError('');
    setNotice('');

    let ok = 0;
    let skipped = 0;
    let lastError = '';

    // Chunked and sequential. One request per item would mean one transaction and 9 round
    // trips each, so 135 items would take two minutes
    for (let from = 0; from < items.length; from += CONFIRM_BATCH_SIZE) {
      const chunk = items.slice(from, from + CONFIRM_BATCH_SIZE);
      const response = await fetch('/api/inbox/confirm-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          categoryId,
          items: chunk.map((item) => ({ id: item.id, ...draftOf(item) })),
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        confirmed?: number;
        skipped?: number[];
        error?: string;
      };

      if (!response.ok) {
        lastError = data.error ?? 'Failed';
        break; // the chunk is one transaction, so a failure means none of it was written
      }

      ok += data.confirmed ?? 0;
      skipped += data.skipped?.length ?? 0;
      for (const item of chunk) edits.current.delete(item.id);
      setConfirming({ done: Math.min(from + chunk.length, items.length), total: items.length });
    }

    setConfirming(null);
    setCurrentId(null);
    if (lastError) setError(lastError);
    setNotice(
      `Confirmed ${ok}` +
        (skipped > 0 ? `, ${skipped} already handled` : '') +
        (lastError ? `, the rest were not written` : ''),
    );
    router.refresh();
  }

  /**
   * Draft one batch, or keep going to the end.
   *
   * "Process all" also sends **10 at a time, sequentially**, rather than handing Claude all N
   * at once — batching means reviewing can start as soon as the first batch returns, whereas
   * one big call shows nothing until it's all done.
   *
   * Sequential, never concurrent: `/api/inbox/process` is "SELECT 10 rows → call Claude →
   * UPDATE" with no lock in between, so concurrency would have two requests pick up the same
   * rows and pay for them twice.
   */
  async function runBatches(all: boolean) {
    stopped.current = false;
    setRunning(true);
    setError('');
    setNotice('');

    let total = 0;
    let left = unprocessed;
    // A runaway guard. Normal exit is processed === 0; this only catches the infinite loop
    // where a few rows fail on every attempt
    const maxRounds = Math.ceil(unprocessed / PROCESS_BATCH_SIZE) + 3;

    for (let round = 0; round < maxRounds; round++) {
      const response = await fetch('/api/inbox/process', { method: 'POST' });
      const data = (await response.json().catch(() => ({}))) as {
        processed?: number;
        error?: string;
      };

      if (!response.ok) {
        setError(data.error ?? 'Processing failed');
        break;
      }

      const done = data.processed ?? 0;
      total += done;
      left = Math.max(0, left - done);
      setProcessed(total);
      // Not awaited — new drafts accumulate in the list while the next batch goes out
      router.refresh();

      if (done === 0 || !all || stopped.current) break;
    }

    setRunning(false);
    setNotice(
      total === 0
        ? 'This batch produced no drafts — try again'
        : left > 0
          ? `Drafted ${total}, ${left} still waiting`
          : `Drafted ${total} — all done`,
    );
  }

  function handleDone() {
    const next = items[safeIdx + 1];
    if (next) setCurrentId(next.id);
    else router.refresh();
  }

  return (
    <>
      {running ? (
        <div className="mb-2 flex items-center justify-between gap-3 border border-border px-3 py-2 text-sm">
          <span className="text-muted-foreground">
            Drafting… {processed} done{unprocessed > 0 && `, ${unprocessed} left`}
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="shrink-0 font-normal"
            onClick={() => {
              stopped.current = true;
            }}
          >
            Stop
          </Button>
        </div>
      ) : (
        unprocessed > 0 && (
          <div className="mb-2 flex gap-2">
            <Button
              variant="outline"
              onClick={() => runBatches(false)}
              className="flex-1 font-normal"
            >
              {unprocessed > PROCESS_BATCH_SIZE
                ? `Process ${PROCESS_BATCH_SIZE}`
                : `Process ${unprocessed} waiting`}
            </Button>
            {/* The count is on the button, so how many Claude calls a press costs is visible
                at a glance — no separate confirmation dialog */}
            {unprocessed > PROCESS_BATCH_SIZE && (
              <Button
                variant="outline"
                onClick={() => runBatches(true)}
                className="flex-1 font-normal"
              >
                Process all ({unprocessed})
              </Button>
            )}
          </div>
        )
      )}

      {notice && <p className="mb-4 text-sm text-muted-foreground">{notice}</p>}
      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}
      {unprocessed === 0 && !notice && <div className="mb-4" />}

      {!current ? (
        <p className="py-16 text-center text-sm text-muted-foreground">
          {unprocessed > 0 ? 'Use the button above to start drafting' : 'Inbox is empty'}
        </p>
      ) : (
        <>
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              {safeIdx + 1} / {items.length}
            </span>
            {/* The gesture is undiscoverable on desktop, so there has to be a visible
                control */}
            <div className="flex items-center gap-1">
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Previous"
                disabled={safeIdx === 0}
                onClick={() => go(-1)}
              >
                <ChevronLeft className="size-4" />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Next"
                disabled={safeIdx >= items.length - 1}
                onClick={() => go(1)}
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
          <div onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
            <ReviewCard
              key={current.id}
              item={current}
              draft={draftOf(current)}
              categories={categories}
              categoryId={categoryId}
              armed={armed}
              total={items.length}
              confirming={confirming}
              onArm={() => setArmed(true)}
              onConfirmAll={confirmAll}
              onEdit={(draft) => edits.current.set(current.id, draft)}
              onDone={() => {
                edits.current.delete(current.id);
                handleDone();
              }}
            />
          </div>
        </>
      )}
    </>
  );
}

function ReviewCard({
  item,
  draft: d,
  categories,
  categoryId,
  armed,
  total,
  confirming,
  onArm,
  onConfirmAll,
  onEdit,
  onDone,
}: {
  item: InboxItem;
  /** The edited version if it has been edited, otherwise the original draft — ReviewList
   *  decides */
  draft: Draft;
  categories: CategoryOption[];
  categoryId: number | null;
  armed: boolean;
  /** How many are awaiting confirmation — shown on the Confirm all button */
  total: number;
  confirming: { done: number; total: number } | null;
  onArm: () => void;
  onConfirmAll: () => void;
  onEdit: (draft: Draft) => void;
  onDone: () => void;
}) {
  const [target, setTarget] = useState(d.target);
  const [lemma, setLemma] = useState(d.lemma);
  const [definition, setDefinition] = useState(d.definition);
  const [pos, setPos] = useState(d.pos ?? '');
  // Filing isn't chosen here; it follows the master control at the top. Change that and this
  // row updates immediately
  const categoryName = categories.find((c) => c.id === categoryId)?.name ?? null;
  const [sentence, setSentence] = useState(d.sentence ?? item.rawText);
  const [cloze, setCloze] = useState(d.cloze);
  // The word doesn't exist yet (it's created inside the confirm transaction), so this can
  // only accumulate locally and go out with the confirmation.
  // The initial value comes from the parentheses of the `carve (cave)` shorthand — written
  // once at capture time, it needn't be typed again
  const [contrasts, setContrasts] = useState<string[]>(d.contrasts ?? []);
  // The word doesn't exist yet, so there's no id to PUT to — like the confusables, this
  // accumulates locally and goes out with Confirm
  const [remark, setRemark] = useState(d.remark ?? '');
  const [pending, setPending] = useState<'confirm' | 'discard' | null>(null);
  const [error, setError] = useState('');

  const noContext = !cloze.includes('___');

  const values = {
    target,
    lemma,
    definition,
    sentence,
    cloze,
    generated: d.generated ?? false,
    pos,
    contrasts,
    remark: remark.trim() || null,
  };

  /**
   * Every edit reports a complete draft upward, which `ReviewList` stores in `edits`.
   * Paging unmounts this card and loses all local state — the reported copy is what seeds it
   * when you page back.
   */
  function edit<K extends keyof typeof values>(key: K, value: (typeof values)[K]) {
    onEdit({ ...values, [key]: value });
  }

  async function send(kind: 'confirm' | 'discard') {
    setPending(kind);
    setError('');
    const response = await fetch(`/api/inbox/${item.id}/${kind}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body:
        kind === 'confirm' ? JSON.stringify({ ...values, categoryId }) : '{}',
    });
    if (response.ok) {
      onDone();
      return;
    }
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    setError(data.error ?? 'Failed');
    setPending(null);
  }

  return (
    <Card className="gap-5 border-0 bg-transparent p-0 ring-0">
      <div>
        <div className="mb-1 text-xs text-muted-foreground">
          Original · {item.source} · {new Date(item.createdAt).toLocaleDateString()}
        </div>
        <p className="whitespace-pre-wrap font-serif text-[15px] leading-relaxed">{item.rawText}</p>
      </div>

      <Separator />

      <div className="space-y-3">
        <Field
          label="Target"
          value={target}
          onChange={(v) => {
            setTarget(v);
            edit('target', v);
          }}
          serif
        />
        <Field
          label="Lemma"
          value={lemma}
          onChange={(v) => {
            setLemma(v);
            edit('lemma', v);
          }}
          serif
        />
        <div className="flex gap-3">
          <div className="w-20 shrink-0">
            <Field
              label="Part of speech"
              value={pos}
              onChange={(v) => {
                setPos(v);
                edit('pos', v);
              }}
            />
          </div>
          <div className="min-w-0 flex-1">
            <Field
              label="Definition"
              value={definition}
              onChange={(v) => {
                setDefinition(v);
                edit('definition', v);
              }}
            />
          </div>
        </div>

        {/* Read-only — filing is decided at capture time. It's displayed because "where did
            this go" shouldn't be a blind spot */}
        <div>
          <div className="mb-1 text-xs text-muted-foreground">Category</div>
          {categoryName ? (
            <p className="text-sm">{categoryName}</p>
          ) : (
            <p className="text-sm text-destructive">No categories yet — create one under Categories</p>
          )}
        </div>

        <div>
          <div className="mb-1 text-xs text-muted-foreground">
            Example
            {/*
              `generated` now covers two cases: a sentence invented wholesale by the AI (only a
              word was entered), and a fragment the AI completed into a sentence. In the second
              case the fragment is something he really met, so calling it "AI-written" would be
              wrong — both are phrased as "not what you met verbatim".
            */}
            {d.generated && (
              <span className="ml-2 text-amber-600">⚠ Not exactly what you met — AI completed or wrote it</span>
            )}
          </div>
          <Textarea
            value={sentence}
            onChange={(e) => {
              setSentence(e.target.value);
              edit('sentence', e.target.value);
            }}
            rows={2}
            className="font-serif text-[15px] leading-relaxed"
          />
        </div>

        <div>
          <div className="mb-1 text-xs text-muted-foreground">
            Cloze (front of the card)
            {noContext && <span className="ml-2 text-amber-600">⚠ nothing blanked</span>}
          </div>
          <Textarea
            value={cloze}
            onChange={(e) => {
              setCloze(e.target.value);
              edit('cloze', e.target.value);
            }}
            rows={2}
            className="font-serif text-[15px] leading-relaxed"
          />
        </div>

        <div>
          <div className="mb-1 text-xs text-muted-foreground">
            Confusables (shown on the back)
          </div>
          <ContrastEditor
            value={contrasts}
            onChange={(next) => {
              setContrasts(next);
              edit('contrasts', next);
            }}
            compact
          />
        </div>

        <div>
          <div className="mb-1 text-xs text-muted-foreground">Note (yours — AI never fills this)</div>
          <Textarea
            value={remark}
            maxLength={MAX_REMARK}
            onChange={(e) => {
              setRemark(e.target.value);
              edit('remark', e.target.value.trim() || null);
            }}
            rows={2}
            placeholder="Why it's tricky, where you saw it…"
            className="text-sm"
          />
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Separator />

      <div className="flex gap-2">
        <Button
          variant="outline"
          onClick={() => send('discard')}
          disabled={pending !== null || confirming !== null}
        >
          {pending === 'discard' ? '…' : 'Discard'}
        </Button>
        {/*
          Confirm all takes two taps: the first only arms it and changes the label, the second
          actually writes. That step irreversibly creates N words and N cards, and the app has
          no undo — one accidental press costs far more than one extra press.
        */}
        <Button
          variant={armed ? 'destructive' : 'outline'}
          className="font-normal"
          onClick={() => (armed ? onConfirmAll() : onArm())}
          disabled={pending !== null || confirming !== null || categoryId === null}
        >
          {confirming
            ? `Confirming… ${confirming.done} / ${confirming.total}`
            : armed
              ? `Sure? All ${total}`
              : `Confirm all (${total})`}
        </Button>
        <Button
          className="flex-1"
          onClick={() => send('confirm')}
          disabled={pending !== null || confirming !== null || categoryId === null}
        >
          {pending === 'confirm' ? '…' : 'Confirm'}
        </Button>
      </div>
    </Card>
  );
}

function Field({
  label,
  value,
  onChange,
  /** English fields (the target word, the lemma) use the serif; the Chinese definition
   *  doesn't */
  serif = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  serif?: boolean;
}) {
  return (
    <div>
      <div className="mb-1 text-xs text-muted-foreground">{label}</div>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={serif ? 'font-serif text-[15px]' : undefined}
      />
    </div>
  );
}
