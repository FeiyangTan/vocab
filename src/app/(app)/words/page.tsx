import { asc, eq, inArray, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { listCategories } from '@/db/queries';
import { cards, categories, encounters, words } from '@/db/schema';
import { parseCategoryId } from '@/lib/categories';
import { contrastHintsFor } from '@/lib/dictionary';
import { phoneticsFor } from '@/lib/phonetics';
import { WordList } from './word-list';

export const dynamic = 'force-dynamic';

/**
 * 筛选走 URL（`?category=<id>`）不走客户端 state：前进/后退能用、刷新不丢、
 * 链接可以存。做成客户端 state 反而要多一个 'use client' 边界，
 * 还得把全部词都送到浏览器再过滤。
 */
/** 每页条数。3 列 × 10 行，正好一屏 */
const PAGE_SIZE = 30;

export default async function WordsPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; page?: string }>;
}) {
  const cats = await listCategories();
  const params = await searchParams;

  // 分类被删掉之后旧链接还在的话，退回「全部」而不是 404 ——
  // 一个筛选参数过期不该让整页打不开
  const requested = parseCategoryId(params.category);
  const active = cats.some((c) => c.id === requested) ? requested : null;

  const scope = active ? eq(words.categoryId, active) : undefined;

  const [{ total }] = await getDb()
    .select({ total: sql<number>`count(*)::int` })
    .from(words)
    .where(scope);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // 页码非法或越界一律落回第 1 页 —— 和 ?category=99 同一条：参数过期不该让整页打不开
  const wanted = Number(params.page);
  const page = Number.isInteger(wanted) && wanted >= 1 && wanted <= totalPages ? wanted : 1;

  const rows = await getDb()
    .select({
      id: words.id,
      lemma: words.lemma,
      category: categories.name,
      contrasts: words.contrasts,
      remark: words.remark,
      zipf: words.zipf,
      // 释义挂在 encounter 上（同一个词不同语境可以有不同释义），卡片取最近那次。
      // 卡片上不放释义的话就只剩一个孤零零的单词，看不出什么。
      note: sql<string | null>`
        (array_agg(${encounters.note} ORDER BY ${encounters.createdAt} DESC)
         FILTER (WHERE ${encounters.note} IS NOT NULL))[1]
      `,
      pos: sql<string | null>`
        (array_agg(${encounters.pos} ORDER BY ${encounters.createdAt} DESC)
         FILTER (WHERE ${encounters.note} IS NOT NULL))[1]
      `,
    })
    .from(words)
    .innerJoin(categories, eq(categories.id, words.categoryId))
    .leftJoin(encounters, eq(encounters.wordId, words.id))
    .where(scope)
    .groupBy(words.id, categories.name)
    .orderBy(asc(words.sortOrder), asc(words.lemma))
    // 分页真正省下来的开销在下面两处：encounters 和 glosses 只查这 30 个词的
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);

  /*
   * 展开区要的原句和释义，一次全取回来在 JS 里分组。
   * 全库 225 条 encounter、原句平均 76 字符 —— 整个数据集比一张图片还小，
   * 做成点开时才请求要多一个接口还有网络延迟，不值得。
   */
  const detail = rows.length
    ? await getDb()
        .select({
          id: encounters.id,
          wordId: encounters.wordId,
          rawText: encounters.rawText,
          note: encounters.note,
          pos: encounters.pos,
          // 挖空句用来定位原句里**当初被挖掉的那一段** —— 词在句子里往往是变形的
          clozeText: cards.clozeText,
        })
        .from(encounters)
        .innerJoin(cards, eq(cards.encounterId, encounters.id))
        .where(
          inArray(
            encounters.wordId,
            rows.map((r) => r.id),
          ),
        )
        .orderBy(asc(encounters.createdAt))
    : [];

  const byWord = new Map<number, typeof detail>();
  for (const e of detail) {
    const list = byWord.get(e.wordId) ?? [];
    list.push(e);
    byWord.set(e.wordId, list);
  }

  /*
   * 对比词的中文在**服务端**查好，只把这一屏用到的那几十条发下去（几百字节）。
   * 词表本身 2.18MB，绝不能进浏览器。
   */
  const glosses = contrastHintsFor(new Set(rows.flatMap((r) => r.contrasts)));
  // 音标同理 —— 表在服务端，只把这 30 个词的发下去
  const phonetics = phoneticsFor(rows.map((r) => r.lemma));

  const allCount = cats.reduce((sum, c) => sum + c.wordCount, 0);

  return (
    <main className="mx-auto w-full max-w-4xl p-4 md:p-8">
      <div className="mb-4 flex items-baseline justify-between">
        <h1 className="font-serif text-2xl font-medium tracking-tight">词汇</h1>
        <span className="text-sm text-muted-foreground">
          {rows.length} / {total} 个
        </span>
      </div>

      {/* chip 是拖拽的放置区，得和卡片在同一个 DndContext 里，所以一起交给 WordList */}
      <WordList
        words={rows}
        encountersByWord={Object.fromEntries(byWord)}
        chips={cats.map((c) => ({ id: c.id, name: c.name, count: c.wordCount }))}
        activeCategory={active}
        total={allCount}
        glosses={glosses}
        phonetics={phonetics}
        page={page}
        totalPages={totalPages}
        empty={active === null ? '还没有确认过的词' : '这个分类下还没有词'}
      />
    </main>
  );
}
