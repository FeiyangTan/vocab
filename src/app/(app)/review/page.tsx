import { asc, eq, sql } from 'drizzle-orm';
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { getDb } from '@/db';
import { cards, categories, encounters, words } from '@/db/schema';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

/** 两种学习模式。队列**来源不同**，所以先选模式、再选分类，而不是每个分类挂两条链接 */
const MODES = [
  {
    key: 'cloze',
    label: '挖空复习',
    hint: '看挖空句猜词，按 SM-2 排到期',
    /** 空队列时的说法 —— 「没有到期的」和「过完了」不是一回事 */
    empty: '没有到期的',
    unit: (n: number) => `${n} 张到期`,
    href: (scope: string) => `/review/${scope}`,
  },
  {
    key: 'triage',
    label: '快速过词',
    hint: '看单词选认识/不认识，按词频过一遍',
    empty: '这轮过完了',
    unit: (n: number) => `剩 ${n} 个`,
    href: (scope: string) => `/review/${scope}/triage`,
  },
] as const;

type Mode = (typeof MODES)[number];

/**
 * 复习入口。**上面选模式，下面选分类。**
 *
 * 模式走 URL（`?mode=triage`）不走客户端 state：前进/后退能用、刷新不丢、
 * 链接可以存 —— 和词汇页的分类筛选同一条规矩。
 */
export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const wanted = (await searchParams).mode;
  // 参数过期/乱填一律落回第一个模式，不该让整页打不开
  const mode = MODES.find((m) => m.key === wanted) ?? MODES[0];

  // 从 categories 出发做左连接：没有到期卡的分类也要出现在列表里（置灰），
  // 从 cards 出发 groupBy 的话它们会整行消失。
  const rows = await getDb()
    .select({
      id: categories.id,
      name: categories.name,
      cloze: sql<number>`count(${cards.id})::int`,
      /*
       * 快速过词的队列长度。**必须 distinct** —— 上面为了数到期卡连了
       * encounters，一个词有几条 encounter 就会被数几遍。
       *
       * 不用管词有没有排过位置：还没排的进去就会被排上（见 `stampUnqueued`），
       * 所以这个数天然等于点进去看到的剩余数。也因此它**可以跨分类相加**，
       * 「全部」那一行直接把各分类的加起来。
       */
      triage: sql<number>`count(distinct ${words.id}) FILTER (WHERE NOT ${words.triageDone})::int`,
      /** 分类里一共多少词。用来把「这轮过完了」和「这个分类根本没词」分开 */
      total: sql<number>`count(distinct ${words.id})::int`,
    })
    .from(categories)
    .leftJoin(words, eq(words.categoryId, categories.id))
    .leftJoin(encounters, eq(encounters.wordId, words.id))
    .leftJoin(cards, sql`${cards.encounterId} = ${encounters.id} and ${cards.due} <= now()`)
    .groupBy(categories.id)
    .orderBy(asc(categories.sortOrder), asc(categories.id));

  // 每个词只属于一个分类、每张卡只属于一个词，所以直接相加不会重复计数
  const sum = (pick: (r: (typeof rows)[number]) => number) =>
    rows.reduce((acc, r) => acc + pick(r), 0);
  const all = {
    id: 0,
    name: '全部',
    cloze: sum((r) => r.cloze),
    triage: sum((r) => r.triage),
    total: sum((r) => r.total),
  };

  return (
    <main className="mx-auto w-full max-w-2xl p-4 md:p-8">
      <h1 className="mb-5 font-serif text-2xl font-medium tracking-tight">复习</h1>

      {/* 先选模式 —— 两种学习方式，不是同一个队列的两个视图 */}
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
          还没有分类，先去<Link href="/categories" className="mx-1 underline">分类</Link>建一个
        </p>
      ) : (
        /* 再选分类。纸质风：靠发丝线分隔，不用盒子 */
        <div className="mt-4">
          {/* 「全部」放最前 —— 它是所有分类的并集，不是并列的一项 */}
          <ScopeRow scope="all" row={all} mode={mode} />
          {rows.map((r) => (
            <ScopeRow key={r.id} scope={String(r.id)} row={r} mode={mode} />
          ))}
        </div>
      )}
    </main>
  );
}

/** 一个范围（某个分类，或「全部」）在当前模式下的入口。 */
function ScopeRow({
  scope,
  row,
  mode,
}: {
  /** 分类 id 或 `'all'`，直接拼进链接 */
  scope: string;
  row: { name: string; cloze: number; triage: number; total: number };
  mode: Mode;
}) {
  const count = mode.key === 'cloze' ? row.cloze : row.triage;
  // 队列空但范围里有词，在快速过词下意味着「这轮过完了」—— **照样能点进去**按
  // 「再来一轮」。挖空复习没有这回事，到期为 0 就是没得复习，置灰。
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
          {row.total === 0 ? '还没有词' : count === 0 ? mode.empty : mode.unit(count)}
        </div>
      </div>
      {!disabled && <ChevronRight className="size-4 shrink-0 text-muted-foreground" />}
    </Link>
  );
}
