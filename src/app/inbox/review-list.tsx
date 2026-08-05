'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ContrastEditor } from '@/components/contrast-editor';
import type { Draft } from '@/db/schema';
import { PROCESS_BATCH_SIZE } from '@/lib/batch';

type Item = {
  id: number;
  rawText: string;
  source: string;
  draft: Draft | null;
  createdAt: string;
};

/**
 * 一条一屏。四个字段直接可编辑 —— 「修改」不需要单独一个按钮，
 * 改完按确认就是修改，少一次模式切换。
 */
export function ReviewList({ items, unprocessed }: { items: Item[]; unprocessed: number }) {
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  /** 处理前的 id 集合，用来在刷新后找出「第一条新卡」并跳过去 */
  const idsBeforeProcess = useRef<Set<number> | null>(null);

  const current = items[index];

  // 处理完 router.refresh() 后 items 会变长；把视图跳到第一条新处理出来的卡，
  // 否则屏幕还停在原来那张，看起来像什么都没发生
  useEffect(() => {
    const before = idsBeforeProcess.current;
    if (!before || items.length <= before.size) return;
    const firstNew = items.findIndex((i) => !before.has(i.id));
    if (firstNew >= 0) setIndex(firstNew);
    idsBeforeProcess.current = null;
  }, [items]);

  async function handleProcess() {
    idsBeforeProcess.current = new Set(items.map((i) => i.id));
    setProcessing(true);
    setError('');
    setNotice('');
    const response = await fetch('/api/inbox/process', { method: 'POST' });
    const data = (await response.json().catch(() => ({}))) as {
      processed?: number;
      error?: string;
    };
    setProcessing(false);
    if (!response.ok) {
      idsBeforeProcess.current = null;
      setError(data.error ?? '处理失败');
      return;
    }
    const done = data.processed ?? 0;
    const left = Math.max(0, unprocessed - done);
    setNotice(
      done === 0
        ? '这一批没有产出草稿，再点一次试试'
        : left > 0
          ? `已处理 ${done} 条，还剩 ${left} 条待整理`
          : `已处理 ${done} 条，全部整理完了`,
    );
    router.refresh();
  }

  function handleDone() {
    if (index + 1 < items.length) setIndex(index + 1);
    else router.refresh();
  }

  return (
    <>
      {unprocessed > 0 && (
        <button
          onClick={handleProcess}
          disabled={processing}
          className="mb-2 w-full rounded-lg border border-black/15 px-3 py-2 text-sm disabled:opacity-40 dark:border-white/20"
        >
          {processing
            ? '正在调用 Claude…'
            : unprocessed > PROCESS_BATCH_SIZE
              ? `处理 ${PROCESS_BATCH_SIZE} 条（共 ${unprocessed} 条待整理）`
              : `处理 ${unprocessed} 条待整理`}
        </button>
      )}

      {notice && <p className="mb-4 text-sm opacity-60">{notice}</p>}
      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
      {unprocessed === 0 && !notice && <div className="mb-4" />}

      {!current ? (
        <p className="py-16 text-center text-sm opacity-60">
          {unprocessed > 0 ? '点上面的按钮开始整理' : '收集箱是空的'}
        </p>
      ) : (
        <>
          <p className="mb-3 text-xs opacity-50">
            第 {index + 1} / {items.length} 条
          </p>
          <ReviewCard key={current.id} item={current} onDone={handleDone} />
        </>
      )}
    </>
  );
}

function ReviewCard({ item, onDone }: { item: Item; onDone: () => void }) {
  const d = item.draft!;
  const [target, setTarget] = useState(d.target);
  const [lemma, setLemma] = useState(d.lemma);
  const [definition, setDefinition] = useState(d.definition);
  const [domain, setDomain] = useState<'work' | 'daily'>(d.domain);
  const [sentence, setSentence] = useState(d.sentence ?? item.rawText);
  const [cloze, setCloze] = useState(d.cloze);
  // 词这时还不存在（确认的事务里才创建），所以只能攒在本地，随确认一起提交
  const [contrasts, setContrasts] = useState<string[]>([]);
  const [pending, setPending] = useState<'confirm' | 'discard' | null>(null);
  const [error, setError] = useState('');

  const noContext = !cloze.includes('___');

  async function send(kind: 'confirm' | 'discard') {
    setPending(kind);
    setError('');
    const response = await fetch(`/api/inbox/${item.id}/${kind}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body:
        kind === 'confirm'
          ? JSON.stringify({
              target,
              lemma,
              definition,
              domain,
              sentence,
              cloze,
              generated: d.generated ?? false,
              contrasts,
            })
          : '{}',
    });
    if (response.ok) {
      onDone();
      return;
    }
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    setError(data.error ?? '失败');
    setPending(null);
  }

  return (
    <div className="space-y-5 rounded-xl border border-black/10 p-4 dark:border-white/15">
      <div>
        <div className="mb-1 text-xs opacity-50">
          原文 · {item.source} · {new Date(item.createdAt).toLocaleDateString()}
        </div>
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{item.rawText}</p>
      </div>

      <div className="space-y-3 border-t border-black/10 pt-4 dark:border-white/15">
        <Field label="目标词" value={target} onChange={setTarget} />
        <Field label="词形还原" value={lemma} onChange={setLemma} />
        <Field label="释义" value={definition} onChange={setDefinition} />

        <div>
          <div className="mb-1 text-xs opacity-50">归类</div>
          <div className="flex gap-2">
            {(['work', 'daily'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setDomain(v)}
                className={`rounded-lg px-3 py-1.5 text-sm ${
                  domain === v
                    ? 'bg-foreground text-background'
                    : 'border border-black/15 dark:border-white/20'
                }`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-1 text-xs opacity-50">
            例句
            {d.generated && (
              <span className="ml-2 text-amber-600">⚠ AI 造的，不是你真实遇到的语境</span>
            )}
          </div>
          <textarea
            value={sentence}
            onChange={(e) => setSentence(e.target.value)}
            rows={2}
            className="w-full rounded-lg border border-black/15 px-3 py-2 text-sm dark:border-white/20"
          />
        </div>

        <div>
          <div className="mb-1 text-xs opacity-50">
            挖空（复习时的正面）
            {noContext && <span className="ml-2 text-amber-600">⚠ 没挖空</span>}
          </div>
          <textarea
            value={cloze}
            onChange={(e) => setCloze(e.target.value)}
            rows={2}
            className="w-full rounded-lg border border-black/15 px-3 py-2 text-sm dark:border-white/20"
          />
        </div>

        <div>
          <div className="mb-1 text-xs opacity-50">
            对比词（复习时在背面显示，AI 不填）
          </div>
          <ContrastEditor value={contrasts} onChange={setContrasts} compact />
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2 border-t border-black/10 pt-4 dark:border-white/15">
        <button
          onClick={() => send('discard')}
          disabled={pending !== null}
          className="rounded-lg border border-black/15 px-4 py-2 text-sm disabled:opacity-40 dark:border-white/20"
        >
          {pending === 'discard' ? '…' : '丢弃'}
        </button>
        <button
          onClick={() => send('confirm')}
          disabled={pending !== null}
          className="flex-1 rounded-lg bg-foreground px-4 py-2 text-sm text-background disabled:opacity-40"
        >
          {pending === 'confirm' ? '…' : '确认'}
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <div className="mb-1 text-xs opacity-50">{label}</div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-black/15 px-3 py-2 text-sm dark:border-white/20"
      />
    </div>
  );
}
