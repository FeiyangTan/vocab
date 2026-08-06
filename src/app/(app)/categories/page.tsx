import { listCategories } from '@/db/queries';
import { CategoryList } from './category-list';

export const dynamic = 'force-dynamic';

export default async function CategoriesPage() {
  const rows = await listCategories();

  return (
    <main className="mx-auto w-full max-w-2xl p-4 md:p-8">
      <div className="mb-6 flex items-baseline justify-between">
        <h1 className="font-serif text-2xl font-medium tracking-tight">分类</h1>
        <span className="text-sm text-muted-foreground">{rows.length} 个</span>
      </div>

      <CategoryList initial={rows} />
    </main>
  );
}
