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

/** 分类 chip 的 droppable id 前缀 —— 和卡片的数字 id 区分开 */
const CHIP = 'chip:';

/**
 * 词汇页的 client 外壳：托管「中文可见性」+ 拖拽。
 *
 * 中文默认全部隐藏 —— 词汇页因此能当自测用。用 `Set<id>` 而不是
 *「全局布尔 + 每卡例外」：后者在「全局开→单卡关→再全局开」这种序列下要维护
 * 两层状态，容易对不上。一个集合就是唯一真相。**不持久化**，刷新回到默认隐藏。
 *
 * 拖拽两种落点：拖到别的卡上 = 调顺序，拖到顶部的分类 chip 上 = 改分类。
 * 两者都**先乐观更新再发请求，失败回滚**。
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
  /** 一条都没有时显示的话 */
  empty: string;
  /** 对比词 → 中文，服务端查好的 */
  glosses: Record<string, string>;
  /** 词 → 美式音标，服务端查好的 */
  phonetics: Record<string, string>;
  page: number;
  totalPages: number;
}) {
  const router = useRouter();
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  /*
   * 对比词 hover 出中文要不要显示。**默认开** —— 它得刻意悬停 1.2 秒才出来，
   * 不像释义那样一进页面就摆在眼前，泄不了题；想连对比词一起自测再关掉。
   */
  const [showGlosses, setShowGlosses] = useState(true);
  /** 音标要不要显示。默认开 —— 它不是「答案」，单词本来就摆在那儿，泄不了题 */
  const [showPhonetics, setShowPhonetics] = useState(true);
  /** 展开了详情的卡。和 revealed 同一套：一个集合就是唯一真相，不搞「全局布尔 + 每卡例外」 */
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [order, setOrder] = useState<Word[]>(words);
  const [dragging, setDragging] = useState<Word | null>(null);
  const [error, setError] = useState('');

  /*
   * 服务端数据变了（翻页、换筛选、保存后的 router.refresh()）就跟着换一批。
   *
   * `revealed` / `expanded` **按 id 取交集**，不是一律清空：
   * - 保存释义/改词之后的 refresh，id 集合没变 → 展开状态原样保留
   *  （一律清空的话，每次保存卡片都会自己收拢）
   * - 翻页/换筛选，旧 id 一个都不在了 → 自然等于清空
   * - 删掉一个词，只有它自己消失，其它卡不受影响
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
    // 不设 distance 的话，手柄上的一次点击也会被当成拖拽起手
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  /**
   * 按词频重排当前这批。复用 `PUT /api/words/reorder`，前端排好再发 ids。
   *
   * 要这个按钮，是因为「词频当默认顺序」和「能手动拖」本质上有张力：拖过之后
   * 顺序就是手动的了，新词也只落在末尾。给一个**显式**的「回到词频序」
   * 比让系统偷偷重排更好 —— 后者会把手动拖的结果无声抹掉。
   */
  async function sortByFrequency() {
    setError('');
    /*
     * 🔴 走服务端接口，**排的是整个范围不是当前页**。
     *
     * 以前是前端把 order 按 zipf 排好再发 ids —— 分页之后前端手里只有这 30 个，
     * 那样只会排当前页，而这个按钮的意思显然是整个分类回到词频序。
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
     * 防线：被拖的 id 必须还在当前列表里才动手。
     * 列表会因为换筛选 / router.refresh() 在拖拽过程中被换掉，拿着一个已经不在
     * 列表里的 id 去写库，改的就是另一个词 —— 这种错静默且难查。
     */
    if (!order.some((w) => w.id === wordId)) return;

    // ① 落在分类 chip 上 = 改分类
    if (typeof over.id === 'string' && over.id.startsWith(CHIP)) {
      const categoryId = Number(over.id.slice(CHIP.length));
      const before = order;
      setOrder((prev) => prev.filter((w) => w.id !== wordId)); // 乐观：从当前列表移走
      const response = await fetch(`/api/words/${wordId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categoryId }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setOrder(before); // 回滚
        setError(data.error ?? 'Failed to change category');
        return;
      }
      router.refresh();
      return;
    }

    // ② 落在别的卡上 = 调顺序
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
      {/* 只有一个分类时没得筛，这排就别占地方 */}
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
              // 拖到「全部」上没有语义，所以只有真正的分类才是放置区
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
              // 关掉时传空对象 —— 没有 gloss 的 chip 根本不套 Tooltip，一处开关全站生效
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

      {/* 拖动时跟手的那张卡 —— 没有它的话拖起来看不见自己在拖什么 */}
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

/** 选中态用墨绿文字 + 下方细线，和侧边栏那条竖条同一套语言，不用灰底色块 */
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
      {/* 数字包成小圆胶囊，和文字拉开层次 */}
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

/** 翻页保留当前筛选 */
function pageHref(category: number | null, page: number): string {
  const params = new URLSearchParams();
  if (category) params.set('category', String(category));
  if (page > 1) params.set('page', String(page));
  const query = params.toString();
  return query ? `/words?${query}` : '/words';
}

/** 用 Link 不用 button —— 保留 URL 语义，前进/后退能用 */
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
