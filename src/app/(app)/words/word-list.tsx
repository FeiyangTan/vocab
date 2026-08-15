'use client';

import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import {
  ArrowDownWideNarrow,
  ChevronLeft,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Eye,
  EyeOff,
  Languages,
  Volume2,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { WordCard, type Word } from './word-card';
import type { Encounter } from './word-detail';

export type CategoryChip = { id: number; name: string; count: number };

/** The droppable id prefix for category chips — keeps them distinct from cards' numeric ids */
const CHIP = 'chip:';

/**
 * The words page's client shell: it holds gloss visibility and dragging.
 *
 * Glosses are all hidden by default, which is what lets the words page double as self-testing.
 * It uses a `Set<id>` rather than "a global boolean plus per-card exceptions": the latter has
 * to maintain two layers of state through a sequence like global-on → one card off → global-on
 * again, and they drift apart easily. One set is the single source of truth. **Not persisted**
 * — a refresh returns to hidden.
 *
 * Dragging has two kinds of target: onto another card = reorder, onto a category chip at the
 * top = change category. Both **update optimistically, then send the request, rolling back on
 * failure**.
 */
export function WordList({
  words,
  encountersByWord,
  chips,
  activeCategory,
  total,
  empty,
  glosses,
  phonetics,
  page,
  totalPages,
}: {
  words: Word[];
  encountersByWord: Record<number, Encounter[]>;
  chips: CategoryChip[];
  activeCategory: number | null;
  total: number;
  /** What to show when there's nothing at all */
  empty: string;
  /** confusable → gloss, resolved on the server */
  glosses: Record<string, string>;
  /** word → US phonetics, resolved on the server */
  phonetics: Record<string, string>;
  page: number;
  totalPages: number;
}) {
  const router = useRouter();
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  /*
   * Whether hovering a confusable reveals its gloss. **On by default** — it takes a deliberate
   * 1.2-second hover to appear, unlike the definition which would otherwise sit there the
   * moment the page loads, so it gives nothing away. Turn it off to self-test the confusables
   * too.
   */
  const [showGlosses, setShowGlosses] = useState(true);
  /** Whether phonetics are shown. On by default — they aren't "the answer", the word is
   *  already right there, so they give nothing away */
  const [showPhonetics, setShowPhonetics] = useState(true);
  /** Which cards have their detail expanded. Same approach as revealed: one set is the single
   *  source of truth, rather than "a global boolean plus per-card exceptions" */
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [order, setOrder] = useState<Word[]>(words);
  const [dragging, setDragging] = useState<Word | null>(null);
  const [error, setError] = useState('');

  /*
   * When the server data changes (paging, changing the filter, the router.refresh() after a
   * save), swap in the new batch.
   *
   * `revealed` / `expanded` are **intersected by id** rather than simply cleared:
   * - after saving a definition or renaming, the refresh leaves the id set unchanged → the
   *   expanded state survives (clearing would collapse the card on every save)
   * - paging or changing the filter leaves none of the old ids → which naturally equals a
   *   clear
   * - deleting a word removes only that one, leaving the other cards untouched
   */
  const [serverWords, setServerWords] = useState(words);
  if (serverWords !== words) {
    const alive = new Set(words.map((w) => w.id));
    const keep = (prev: Set<number>) => new Set([...prev].filter((id) => alive.has(id)));
    setServerWords(words);
    setOrder(words);
    setRevealed(keep);
    setExpanded(keep);
  }

  const allShown = order.length > 0 && revealed.size === order.length;
  const allExpanded = order.length > 0 && expanded.size === order.length;

  const sensors = useSensors(
    // Without a distance, a plain click on the handle would register as the start of a drag
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  /**
   * Reorder by frequency.
   *
   * This button exists because "frequency as the default order" and "draggable by hand" are in
   * genuine tension: once you've dragged, the order is manual, and new words only land at the
   * end. An **explicit** "return to frequency order" is better than having the system
   * silently re-sort — the latter would erase the result of dragging without a word.
   */
  async function sortByFrequency() {
    setError('');
    /*
     * 🔴 Goes through the server endpoint, which **sorts the whole scope, not the current
     * page**.
     *
     * This used to sort `order` by zipf in the frontend and send the ids — but after
     * pagination the frontend only holds these 30, so it would sort the current page alone,
     * while the button obviously means the whole category returns to frequency order.
     */
    const response = await fetch('/api/words/reorder-by-frequency', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ categoryId: activeCategory }),
    });
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? 'Reorder failed');
      return;
    }
    router.refresh();
  }

  function onDragStart(event: DragStartEvent) {
    setError('');
    setDragging(order.find((w) => w.id === event.active.id) ?? null);
  }

  async function onDragEnd(event: DragEndEvent) {
    setDragging(null);
    const { active, over } = event;
    if (!over) return;

    const wordId = Number(active.id);
    /*
     * A guard: only act if the dragged id is still in the current list.
     * The list can be swapped out mid-drag by a filter change or a router.refresh(), and
     * writing to the database with an id that has left the list modifies a different word —
     * a silent error, and a hard one to track down.
     */
    if (!order.some((w) => w.id === wordId)) return;

    // (1) dropped on a category chip = change category
    if (typeof over.id === 'string' && over.id.startsWith(CHIP)) {
      const categoryId = Number(over.id.slice(CHIP.length));
      const before = order;
      setOrder((prev) => prev.filter((w) => w.id !== wordId)); // optimistic: drop it from the list
      const response = await fetch(`/api/words/${wordId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categoryId }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setOrder(before); // roll back
        setError(data.error ?? 'Failed to change category');
        return;
      }
      router.refresh();
      return;
    }

    // (2) dropped on another card = reorder
    if (active.id === over.id) return;
    const from = order.findIndex((w) => w.id === wordId);
    const to = order.findIndex((w) => w.id === Number(over.id));
    if (from < 0 || to < 0) return;

    const before = order;
    const next = arrayMove(order, from, to);
    setOrder(next);

    const response = await fetch('/api/words/reorder', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: next.map((w) => w.id) }),
    });
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      setOrder(before);
      setError(data.error ?? 'Sorting failed');
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      {/* With only one category there's nothing to filter, so this row shouldn't take space */}
      {chips.length > 1 && (
        <div className="mb-6 flex flex-wrap items-baseline gap-x-4 gap-y-1.5">
          <FilterChip href="/words" label="All" count={total} active={activeCategory === null} />
          {chips.map((c) => (
            <FilterChip
              key={c.id}
              href={`/words?category=${c.id}`}
              label={c.name}
              count={c.count}
              active={activeCategory === c.id}
              // Dropping onto "All" has no meaning, so only real categories are drop targets
              dropId={`${CHIP}${c.id}`}
              dropDisabled={c.id === activeCategory}
            />
          ))}
        </div>
      )}

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      {order.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">{empty}</p>
      ) : (
        <>
      <div className="mb-4 flex justify-end gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="font-normal text-muted-foreground"
          title="Common words first. Newly confirmed words land at the end — this puts them in place"
          onClick={() => void sortByFrequency()}
        >
          <ArrowDownWideNarrow className="size-3.5" />
          Sort by frequency
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="font-normal text-muted-foreground"
          onClick={() => setExpanded(allExpanded ? new Set() : new Set(order.map((w) => w.id)))}
        >
          {allExpanded ? (
            <ChevronsDownUp className="size-3.5" />
          ) : (
            <ChevronsUpDown className="size-3.5" />
          )}
          {allExpanded ? 'Collapse all' : 'Expand all'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="font-normal text-muted-foreground"
          aria-pressed={showPhonetics}
          title="US phonetics (CMUdict)"
          onClick={() => setShowPhonetics((v) => !v)}
        >
          <Volume2 className={cn('size-3.5', !showPhonetics && 'opacity-40')} />
          {showPhonetics ? 'Hide phonetics' : 'Show phonetics'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="font-normal text-muted-foreground"
          aria-pressed={showGlosses}
          title="Chinese shown when hovering a confusable for 1.2s"
          onClick={() => setShowGlosses((v) => !v)}
        >
          <Languages className={cn('size-3.5', !showGlosses && 'opacity-40')} />
          {showGlosses ? 'Hide confusable glosses' : 'Show confusable glosses'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="font-normal text-muted-foreground"
          onClick={() => setRevealed(allShown ? new Set() : new Set(order.map((w) => w.id)))}
        >
          {allShown ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
          {allShown ? 'Hide Chinese' : 'Show Chinese'}
        </Button>
      </div>

      <SortableContext items={order.map((w) => w.id)} strategy={rectSortingStrategy}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {order.map((w) => (
            <WordCard
              key={w.id}
              word={w}
              encounters={encountersByWord[w.id] ?? []}
              // Switched off, pass an empty object — a chip without a gloss isn't wrapped in
              // a Tooltip at all, so one toggle covers the whole page
              glosses={showGlosses ? glosses : {}}
              phonetic={showPhonetics ? (phonetics[w.lemma] ?? null) : null}
              revealed={revealed.has(w.id)}
              onToggleReveal={() =>
                setRevealed((prev) => {
                  const next = new Set(prev);
                  if (next.has(w.id)) next.delete(w.id);
                  else next.add(w.id);
                  return next;
                })
              }
              expanded={expanded.has(w.id)}
              onToggleExpand={() =>
                setExpanded((prev) => {
                  const next = new Set(prev);
                  if (next.has(w.id)) next.delete(w.id);
                  else next.add(w.id);
                  return next;
                })
              }
            />
          ))}
        </div>
      </SortableContext>

      {totalPages > 1 && (
        <div className="mt-8 flex items-center justify-center gap-4 border-t border-border pt-5 text-sm">
          <PageLink
            href={pageHref(activeCategory, page - 1)}
            disabled={page <= 1}
            label="Previous page"
          >
            <ChevronLeft className="size-4" />
            Previous
          </PageLink>
          <span className="tabular-nums text-muted-foreground">
            {page} / {totalPages}
          </span>
          <PageLink
            href={pageHref(activeCategory, page + 1)}
            disabled={page >= totalPages}
            label="Next page"
          >
            Next
            <ChevronRight className="size-4" />
          </PageLink>
        </div>
      )}
        </>
      )}

      {/* The card that follows the pointer while dragging — without it you can't see what
          you're dragging */}
      <DragOverlay>
        {dragging && (
          <div className="rounded-sm border border-primary bg-card px-3 py-2 shadow-lg">
            <span className="font-serif text-xl font-medium">{dragging.lemma}</span>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

/** The active state is ink-green text plus a thin underline — the same visual language as the
 *  sidebar's vertical bar, rather than a grey filled block */
function FilterChip({
  href,
  label,
  count,
  active,
  dropId,
  dropDisabled,
}: {
  href: string;
  label: string;
  count: number;
  active: boolean;
  dropId?: string;
  dropDisabled?: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: dropId ?? `noop:${label}`,
    disabled: !dropId || dropDisabled,
  });

  return (
    <Link
      ref={setNodeRef}
      href={href}
      className={cn(
        'border-b-2 pb-0.5 text-sm transition-colors',
        active
          ? 'border-primary font-medium text-primary'
          : 'border-transparent text-muted-foreground hover:text-foreground',
        isOver && 'rounded-sm bg-primary px-2 text-primary-foreground',
      )}
    >
      {label}
      {/* The count is wrapped in a small pill to separate it from the label */}
      <span
        className={cn(
          'ml-1.5 rounded-full px-1.5 py-px text-[11px] tabular-nums',
          active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
        )}
      >
        {count}
      </span>
    </Link>
  );
}

/** Paging preserves the current filter */
function pageHref(category: number | null, page: number): string {
  const params = new URLSearchParams();
  if (category) params.set('category', String(category));
  if (page > 1) params.set('page', String(page));
  const query = params.toString();
  return query ? `/words?${query}` : '/words';
}

/** A Link rather than a button — it keeps the URL meaningful, so back/forward work */
function PageLink({
  href,
  disabled,
  label,
  children,
}: {
  href: string;
  disabled: boolean;
  label: string;
  children: React.ReactNode;
}) {
  if (disabled) {
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground/30">{children}</span>
    );
  }
  return (
    <Link
      href={href}
      aria-label={label}
      className="inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
    >
      {children}
    </Link>
  );
}
