import { asc, eq, sql } from 'drizzle-orm';
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { getDb } from '@/db';
import { cards, categories, encounters, words } from '@/db/schema';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

/**
 * The two study modes. Their queues come from **different sources**, which is why you pick the
 * mode first and the category second, rather than hanging two links off every category.
 *
 * 🔴 **Order is the default**: whichever comes first is both shown on the left and where a
 * bare `?mode=`-less visit lands (its link is the plain `/review`). So reordering this array
 * also changes the default mode.
 */
const MODES = [
  {
    key: 'triage',
    label: 'Quick pass',
    hint: 'See the word, mark know / don\u2019t know — by frequency',
    empty: 'Round finished',
    unit: (n: number) => `${n} left`,
    href: (scope: string) => `/review/${scope}/triage`,
  },
  {
    key: 'cloze',
    label: 'Cloze',
    hint: 'Guess the word from a blanked sentence — scheduled by SM-2',
    /** What an empty queue says — "nothing due" and "round finished" are different things */
    empty: 'Nothing due',
    unit: (n: number) => `${n} due`,
    href: (scope: string) => `/review/${scope}`,
  },
] as const;

type Mode = (typeof MODES)[number];

/**
 * The review entry point. **Mode on top, category below.**
 *
 * The mode lives in the URL (`?mode=triage`) rather than client state: back/forward work,
 * refresh doesn't lose it, and a link can be saved — the same rule as the words page's
 * category filter.
 */
export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const wanted = (await searchParams).mode;
  // A stale or bogus parameter falls back to the first mode — it shouldn't make the whole
  // page unopenable
  const mode = MODES.find((m) => m.key === wanted) ?? MODES[0];

  // Left-join outward from categories: a category with no due cards still has to appear in
  // the list (greyed out). Grouping outward from cards would drop its row entirely.
  const rows = await getDb()
    .select({
      id: categories.id,
      name: categories.name,
      cloze: sql<number>`count(${cards.id})::int`,
      /*
       * The Quick pass queue length. **distinct is required** — counting due cards above joins
       * encounters, so a word gets counted once per encounter it has.
       *
       * Whether a word has a queue position doesn't matter: anything unstamped gets stamped on
       * entry (see `stampUnqueued`), so this number naturally equals the remaining count you
       * see after tapping in. That is also why it **sums across categories**, letting the
       * "All" row simply add them up.
       */
      triage: sql<number>`count(distinct ${words.id}) FILTER (WHERE NOT ${words.triageDone})::int`,
      /** How many words the category holds in total. Used to tell "this round is finished"
       *  apart from "this category has no words at all" */
      total: sql<number>`count(distinct ${words.id})::int`,
    })
    .from(categories)
    .leftJoin(words, eq(words.categoryId, categories.id))
    .leftJoin(encounters, eq(encounters.wordId, words.id))
    .leftJoin(cards, sql`${cards.encounterId} = ${encounters.id} and ${cards.due} <= now()`)
    .groupBy(categories.id)
    .orderBy(asc(categories.sortOrder), asc(categories.id));

  // Each word belongs to one category and each card to one word, so summing double-counts
  // nothing
  const sum = (pick: (r: (typeof rows)[number]) => number) =>
    rows.reduce((acc, r) => acc + pick(r), 0);
  const all = {
    id: 0,
    name: 'All',
    cloze: sum((r) => r.cloze),
    triage: sum((r) => r.triage),
    total: sum((r) => r.total),
  };

  return (
    <main className="mx-auto w-full max-w-2xl p-4 md:p-8">
      <h1 className="mb-5 font-serif text-2xl font-medium tracking-tight">Review</h1>

      {/* Mode first — two ways of studying, not two views of one queue */}
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2 border-b border-border pb-3">
        {MODES.map((m) => (
          <Link
            key={m.key}
            href={m.key === MODES[0].key ? '/review' : `/review?mode=${m.key}`}
            title={m.hint}
            className={cn(
              'border-b-2 pb-0.5 text-sm transition-colors',
              m.key === mode.key
                ? 'border-primary font-medium text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {m.label}
          </Link>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{mode.hint}</p>

      {rows.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">
          No categories yet — create one under <Link href="/categories" className="mx-1 underline">Categories</Link>
        </p>
      ) : (
        /* Then the category. The paper look: separated by hairlines, not boxes */
        <div className="mt-4">
          {/* "All" comes first — it's the union of every category, not a peer of them */}
          <ScopeRow scope="all" row={all} mode={mode} />
          {rows.map((r) => (
            <ScopeRow key={r.id} scope={String(r.id)} row={r} mode={mode} />
          ))}
        </div>
      )}
    </main>
  );
}

/** One scope (a category, or "All") as an entry point in the current mode. */
function ScopeRow({
  scope,
  row,
  mode,
}: {
  /** A category id or `'all'`, interpolated straight into the link */
  scope: string;
  row: { name: string; cloze: number; triage: number; total: number };
  mode: Mode;
}) {
  const count = mode.key === 'cloze' ? row.cloze : row.triage;
  // An empty queue over a non-empty scope means "this round is finished" in Quick pass —
  // and it **stays tappable** so you can press New round. Cloze review has no such state:
  // zero due simply means nothing to review, so it greys out.
  const revivable = mode.key === 'triage' && row.total > 0;
  const disabled = count === 0 && !revivable;

  return (
    <Link
      href={disabled ? '/review' : mode.href(scope)}
      aria-disabled={disabled}
      className={cn(
        'flex items-center justify-between gap-3 border-t border-border py-4 transition-opacity',
        disabled ? 'pointer-events-none opacity-45' : 'hover:opacity-70',
      )}
    >
      <div className="min-w-0">
        <div className="truncate font-serif text-xl font-medium">{row.name}</div>
        <div className="mt-0.5 text-sm text-muted-foreground">
          {row.total === 0 ? 'No words yet' : count === 0 ? mode.empty : mode.unit(count)}
        </div>
      </div>
      {!disabled && <ChevronRight className="size-4 shrink-0 text-muted-foreground" />}
    </Link>
  );
}
