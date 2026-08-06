'use client';

import { Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { CategoryRow } from '@/db/queries';
import { MAX_CATEGORY_NAME } from '@/lib/categories';

/**
 * 分类的增删改。
 *
 * 仓库里没有 Dialog 组件，删除确认做成**行内展开**（选转移目标 + 确认），
 * 和纸质风一致，也少一个依赖。
 *
 * 每次写完都 `router.refresh()` 重新拉服务端数据，不在本地拼状态 ——
 * 词数、默认标记会被别的操作连带改掉（删掉默认分类时默认会顺延），
 * 本地推算迟早对不上。
 */
export function CategoryList({ initial }: { initial: CategoryRow[] }) {
  const router = useRouter();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  /** 正在改名的分类 id */
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  /** 正在确认删除的分类 id */
  const [deleting, setDeleting] = useState<number | null>(null);
  const [moveTo, setMoveTo] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');

  const isLast = initial.length <= 1;

  async function send(url: string, init: RequestInit) {
    setBusy(true);
    setError('');
    const response = await fetch(url, init);
    setBusy(false);
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? '操作失败');
      return false;
    }
    router.refresh();
    return true;
  }

  async function create() {
    const name = newName.trim();
    if (!name) return;
    if (
      await send('/api/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
    ) {
      setNewName('');
      setAdding(false);
    }
  }

  async function rename(id: number) {
    const name = draft.trim();
    if (!name) return;
    if (
      await send(`/api/categories/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
    ) {
      setEditing(null);
    }
  }

  async function makeDefault(id: number) {
    await send(`/api/categories/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isDefault: true }),
    });
  }

  async function remove(row: CategoryRow) {
    const query = row.wordCount > 0 && moveTo ? `?moveTo=${moveTo}` : '';
    if (await send(`/api/categories/${row.id}${query}`, { method: 'DELETE' })) {
      setDeleting(null);
      setMoveTo(null);
    }
  }

  function startDelete(row: CategoryRow) {
    setError('');
    setDeleting(row.id);
    // 转移目标预选第一个别的分类，省一次点击
    setMoveTo(initial.find((c) => c.id !== row.id)?.id ?? null);
  }

  return (
    <>
      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      <div>
        {initial.map((row) => (
          <div key={row.id} className="border-t border-border py-4">
            <div className="flex items-center justify-between gap-3">
              {editing === row.id ? (
                <>
                  <Input
                    autoFocus
                    value={draft}
                    maxLength={MAX_CATEGORY_NAME}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void rename(row.id);
                      if (e.key === 'Escape') setEditing(null);
                    }}
                    className="h-8 max-w-48"
                  />
                  <div className="flex shrink-0 gap-1">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="保存"
                      disabled={busy}
                      onClick={() => void rename(row.id)}
                    >
                      <Check className="size-4" />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="取消"
                      onClick={() => setEditing(null)}
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex min-w-0 items-baseline gap-2">
                    <span className="truncate font-serif text-xl font-medium">{row.name}</span>
                    {row.isDefault && (
                      <span className="shrink-0 text-[11px] uppercase tracking-[0.14em] text-primary">
                        默认
                      </span>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    <span className="mr-1 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                      {row.wordCount} 词
                    </span>
                    {!row.isDefault && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="font-normal text-muted-foreground"
                        disabled={busy}
                        onClick={() => void makeDefault(row.id)}
                      >
                        设为默认
                      </Button>
                    )}
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`重命名 ${row.name}`}
                      onClick={() => {
                        setEditing(row.id);
                        setDraft(row.name);
                        setDeleting(null);
                      }}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`删除 ${row.name}`}
                      title={isLast ? '至少要留一个分类' : undefined}
                      disabled={isLast || busy}
                      onClick={() => startDelete(row)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </>
              )}
            </div>

            {deleting === row.id && (
              <div className="mt-3 border-l-2 border-destructive/40 pl-3">
                {row.wordCount > 0 ? (
                  <>
                    <p className="text-sm">
                      「{row.name}」里还有 {row.wordCount} 个词，先转到：
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {initial
                        .filter((c) => c.id !== row.id)
                        .map((c) => (
                          <Button
                            key={c.id}
                            size="sm"
                            variant={moveTo === c.id ? 'default' : 'outline'}
                            className="font-normal"
                            onClick={() => setMoveTo(c.id)}
                          >
                            {c.name}
                          </Button>
                        ))}
                    </div>
                  </>
                ) : (
                  <p className="text-sm">删除「{row.name}」？里面没有词。</p>
                )}

                <div className="mt-3 flex gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="font-normal"
                    onClick={() => setDeleting(null)}
                  >
                    取消
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    className="font-normal"
                    disabled={busy || (row.wordCount > 0 && !moveTo)}
                    onClick={() => void remove(row)}
                  >
                    {row.wordCount > 0 ? '转移并删除' : '删除'}
                  </Button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="border-t border-border pt-4">
        {adding ? (
          <div className="flex items-center gap-2">
            <Input
              autoFocus
              value={newName}
              maxLength={MAX_CATEGORY_NAME}
              placeholder="分类名"
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void create();
                if (e.key === 'Escape') {
                  setNewName('');
                  setAdding(false);
                }
              }}
              className="h-8 max-w-48"
            />
            <Button size="sm" className="font-normal" disabled={busy} onClick={() => void create()}>
              新建
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="font-normal"
              onClick={() => {
                setNewName('');
                setAdding(false);
              }}
            >
              取消
            </Button>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="font-normal text-muted-foreground"
            onClick={() => setAdding(true)}
          >
            <Plus className="size-3.5" />
            新建分类
          </Button>
        )}
      </div>
    </>
  );
}
