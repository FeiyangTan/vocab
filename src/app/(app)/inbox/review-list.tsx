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

/** 判定为「滑动」的最小横向位移（px）。再小就会被日常的手指抖动误触发 */
const SWIPE_THRESHOLD = 60;

export type CategoryOption = { id: number; name: string; isDefault: boolean };

export type InboxItem = {
  id: number;
  rawText: string;
  source: string;
  draft: Draft | null;
  /** 存入时就选好的分类，null = 那时没选（快捷指令那条链路） */
  categoryId: number | null;
  createdAt: string;
};

/**
 * 一条一屏。四个字段直接可编辑 —— 「修改」不需要单独一个按钮，
 * 改完按确认就是修改，少一次模式切换。
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
  /** 顶部「存到」选的那个 —— 确认时就存这里 */
  categoryId: number | null;
}) {
  const router = useRouter();
  /**
   * 当前审到哪条，记的是 **id 不是下标**。
   *
   * 后台整理每完成一批就 `router.refresh()`，列表会在你（jimmy）审核的中途变。
   * 用下标的话：确认 A 后下标指向 B，刷新时 A 因为变成 processed 从列表里掉出去、
   * 整体左移一位，同一个下标就指到了 C —— **B 被静默跳过，永远审不到**。
   */
  const [currentId, setCurrentId] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [processed, setProcessed] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  /** 「停止」只对**还没发出去**的批次有效，在途的那批收到才停 */
  const stopped = useRef(false);
  /** 「全部确认」点第一次只是上膛，再点才真的写 —— 这一步不可逆，应用里没有撤销 */
  const [armed, setArmed] = useState(false);
  const [confirming, setConfirming] = useState<{ done: number; total: number } | null>(null);

  const idx = items.findIndex((i) => i.id === currentId);
  const safeIdx = idx >= 0 ? idx : 0;
  const current = items[safeIdx];

  /**
   * id → 改过的字段。**ref 不是 state** —— 每次按键都写，不需要触发重渲染。
   *
   * 存在这一层是因为 `ReviewCard` 用 `key={id}`，翻页就重新挂载、本地 state 全部重置。
   * 以前唯一的离开方式是确认或丢弃（走了不回来），无所谓；能左右翻之后，
   * 「改了第 3 条 → 往后看看 → 翻回来发现改动没了」会天天发生。
   */
  const edits = useRef(new Map<number, Draft>());
  const draftOf = (item: InboxItem) => edits.current.get(item.id) ?? item.draft!;

  function go(delta: number) {
    const next = items[safeIdx + delta];
    if (next) {
      setArmed(false); // 翻页就下膛，别让上膛状态跟着走到别的卡上
      setCurrentId(next.id);
    }
  }

  // 上了膛没接着按就自动下膛 —— 免得半小时后手滑碰一下就全写了
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 5000);
    return () => clearTimeout(timer);
  }, [armed]);

  // ← / → 翻页。光标在输入框里时不抢键 —— 否则在例句里挪光标会翻页
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

  /** 触摸滑动：左滑下一条、右滑上一条 */
  const touch = useRef<{ x: number; y: number } | null>(null);

  function onTouchStart(e: React.TouchEvent) {
    // 起点落在输入控件上时忽略 —— 那是在选文字 / 操作控件，不是在翻页
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
    // 横向位移要够大**且**压过纵向，否则会和竖向滚动打架
    if (Math.abs(dx) < SWIPE_THRESHOLD || Math.abs(dx) <= Math.abs(dy)) return;
    go(dx < 0 ? 1 : -1);
  }

  /**
   * 全部确认。**顺序发，不并发** —— confirm 里是一个事务
   *（find-or-create word → encounter → card），并发确认同一个 lemma 会创出两条 word。
   */
  async function confirmAll() {
    setArmed(false);
    setConfirming({ done: 0, total: items.length });
    setError('');
    setNotice('');

    let ok = 0;
    let skipped = 0;
    let lastError = '';

    // 分块顺序发。逐条发的话每条一个事务、9 个来回，135 条要两分钟
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
        lastError = data.error ?? '失败';
        break; // 整块是一个事务，失败就是整块没写，没必要继续
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
      `确认了 ${ok} 条` +
        (skipped > 0 ? `，${skipped} 条已经处理过了` : '') +
        (lastError ? `，剩下的没写` : ''),
    );
    router.refresh();
  }

  /**
   * 整理一批或整理到底。
   *
   * 「处理全部」也是**一批 10 条顺序发**，不是一次性把 N 条塞给 Claude ——
   * 分批第一批回来就能开始审，一次性发要等到最后才看得到任何东西。
   *
   * 顺序、不并发：`/api/inbox/process` 是「SELECT 10 行 → 调 Claude → UPDATE」，
   * 中间没有锁，并发会让两个请求捞到同一批行，白花钱。
   */
  async function runBatches(all: boolean) {
    stopped.current = false;
    setRunning(true);
    setError('');
    setNotice('');

    let total = 0;
    let left = unprocessed;
    // 跑飞防线。正常靠 processed === 0 退出，这个只防「某几行每次都失败」的死循环
    const maxRounds = Math.ceil(unprocessed / PROCESS_BATCH_SIZE) + 3;

    for (let round = 0; round < maxRounds; round++) {
      const response = await fetch('/api/inbox/process', { method: 'POST' });
      const data = (await response.json().catch(() => ({}))) as {
        processed?: number;
        error?: string;
      };

      if (!response.ok) {
        setError(data.error ?? '处理失败');
        break;
      }

      const done = data.processed ?? 0;
      total += done;
      left = Math.max(0, left - done);
      setProcessed(total);
      // 不 await —— 新草稿累积进列表，同时继续发下一批
      router.refresh();

      if (done === 0 || !all || stopped.current) break;
    }

    setRunning(false);
    setNotice(
      total === 0
        ? '这一批没有产出草稿，再点一次试试'
        : left > 0
          ? `已整理 ${total} 条，还剩 ${left} 条待整理`
          : `已整理 ${total} 条，全部整理完了`,
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
            正在整理…已完成 {processed} 条{unprocessed > 0 && `，还剩 ${unprocessed} 条`}
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="shrink-0 font-normal"
            onClick={() => {
              stopped.current = true;
            }}
          >
            停止
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
                ? `处理 ${PROCESS_BATCH_SIZE} 条`
                : `处理 ${unprocessed} 条待整理`}
            </Button>
            {/* 数量写在按钮上，点下去要花几次 Claude 调用一眼可见，不另做确认弹窗 */}
            {unprocessed > PROCESS_BATCH_SIZE && (
              <Button
                variant="outline"
                onClick={() => runBatches(true)}
                className="flex-1 font-normal"
              >
                处理全部（{unprocessed} 条）
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
          {unprocessed > 0 ? '点上面的按钮开始整理' : '收集箱是空的'}
        </p>
      ) : (
        <>
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              第 {safeIdx + 1} / {items.length} 条
            </span>
            {/* 手势在桌面不可发现，得有个看得见的入口 */}
            <div className="flex items-center gap-1">
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="上一条"
                disabled={safeIdx === 0}
                onClick={() => go(-1)}
              >
                <ChevronLeft className="size-4" />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="下一条"
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
  /** 已经改过的话是改过的版本，否则是原草稿 —— 由 ReviewList 决定 */
  draft: Draft;
  categories: CategoryOption[];
  categoryId: number | null;
  armed: boolean;
  /** 待确认总数 —— 全部确认按钮上要显示 */
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
  // 归类不在这里选，跟着顶部那个总开关走。改开关，这一行立刻变
  const categoryName = categories.find((c) => c.id === categoryId)?.name ?? null;
  const [sentence, setSentence] = useState(d.sentence ?? item.rawText);
  const [cloze, setCloze] = useState(d.cloze);
  // 词这时还不存在（确认的事务里才创建），所以只能攒在本地，随确认一起提交。
  // 初值来自 `carve (cave)` 那种写法里括号中的词 —— 捕获时写过就不用再敲一遍
  const [contrasts, setContrasts] = useState<string[]>(d.contrasts ?? []);
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
    contrasts,
  };

  /**
   * 每次改动都往上报一份完整的草稿，`ReviewList` 存进 `edits`。
   * 翻页时这张卡会被卸载，本地 state 全丢 —— 上报的这份是翻回来时的初值。
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
    setError(data.error ?? '失败');
    setPending(null);
  }

  return (
    <Card className="gap-5 border-0 bg-transparent p-0 ring-0">
      <div>
        <div className="mb-1 text-xs text-muted-foreground">
          原文 · {item.source} · {new Date(item.createdAt).toLocaleDateString()}
        </div>
        <p className="whitespace-pre-wrap font-serif text-[15px] leading-relaxed">{item.rawText}</p>
      </div>

      <Separator />

      <div className="space-y-3">
        <Field
          label="目标词"
          value={target}
          onChange={(v) => {
            setTarget(v);
            edit('target', v);
          }}
          serif
        />
        <Field
          label="词形还原"
          value={lemma}
          onChange={(v) => {
            setLemma(v);
            edit('lemma', v);
          }}
          serif
        />
        <Field
          label="释义"
          value={definition}
          onChange={(v) => {
            setDefinition(v);
            edit('definition', v);
          }}
        />

        {/* 只读 —— 归类是存入时定的。显示出来是因为「这条进了哪儿」不该是盲区 */}
        <div>
          <div className="mb-1 text-xs text-muted-foreground">归类</div>
          {categoryName ? (
            <p className="text-sm">{categoryName}</p>
          ) : (
            <p className="text-sm text-destructive">还没有分类，先去「分类」建一个</p>
          )}
        </div>

        <div>
          <div className="mb-1 text-xs text-muted-foreground">
            例句
            {d.generated && (
              <span className="ml-2 text-amber-600">⚠ AI 造的，不是你真实遇到的语境</span>
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
            挖空（复习时的正面）
            {noContext && <span className="ml-2 text-amber-600">⚠ 没挖空</span>}
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
            对比词（复习时在背面显示，AI 不填）
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
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Separator />

      <div className="flex gap-2">
        <Button
          variant="outline"
          onClick={() => send('discard')}
          disabled={pending !== null || confirming !== null}
        >
          {pending === 'discard' ? '…' : '丢弃'}
        </Button>
        {/*
          全部确认要点两次：第一次上膛只变文案，第二次才真的写。
          这一步不可逆地写 N 个词 + N 张卡，应用里没有撤销 ——
          误点一次的代价远大于多点一次。
        */}
        <Button
          variant={armed ? 'destructive' : 'outline'}
          className="font-normal"
          onClick={() => (armed ? onConfirmAll() : onArm())}
          disabled={pending !== null || confirming !== null || categoryId === null}
        >
          {confirming
            ? `正在确认…${confirming.done} / ${confirming.total}`
            : armed
              ? `确定？全部 ${total} 条`
              : `全部确认（${total}）`}
        </Button>
        <Button
          className="flex-1"
          onClick={() => send('confirm')}
          disabled={pending !== null || confirming !== null || categoryId === null}
        >
          {pending === 'confirm' ? '…' : '确认'}
        </Button>
      </div>
    </Card>
  );
}

function Field({
  label,
  value,
  onChange,
  /** 英文字段（目标词、词形还原）走衬线；中文释义不走 */
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
