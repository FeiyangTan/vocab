'use client';

import { ChevronLeft, Trash2, Volume2 } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { speak } from '@/lib/speak';
import { cn } from '@/lib/utils';
import { WordDetail, type Encounter } from '../../../words/word-detail';

/** 音标开关存这儿。设置就该记住 —— 每进一次都要重按一遍不叫设置 */
const PHONETIC_KEY = 'vocab:triage:phonetic';

/** 滑多远算数。手机上一个拇指的自然行程大概这么多 */
const SWIPE_THRESHOLD = 70;
/** 超过这个位移就认定「这是一次滑动」，随后的 click 要挡掉（否则划过单词会顺带发音） */
const SLOP = 8;

type Word = {
  id: number;
  lemma: string;
  phonetic: string | null;
  remark: string | null;
  contrasts: string[];
  zipf: number | null;
  category: string;
  /** 同一个词的每一次遇到，各带各的释义和原句 */
  encounters: Encounter[];
};

/**
 * 「快速过词」一场。看单词 → 认识 / 不认识 / 删除，把整个分类刷空为一轮。
 *
 * 队列在服务端，这里**一次只拿一个词** —— 和挖空复习同一个道理，也顺带让
 * 「刷新不丢进度」成立：前端手里根本没有队列。
 *
 * 详情**默认藏着** —— 这个模式的意义就是先自测，答案得自己要。点开之后展示的
 * 和词汇页展开后**完全一样**（复用 `WordDetail`），包括原句和对比词：
 * 判断「认不认识」经常要靠原句才想得起来，看不到就只能靠猜。
 */
export function TriageSession({
  scope,
  name,
  pushBack,
}: {
  /** 分类 id 或 `'all'`。直接拼进查询串 / 请求体，所以是字符串不是数字 */
  scope: string;
  name: string;
  /** 「不认识」往后挪几位。由服务端传进来 —— `@/lib/triage` 带着 drizzle，不能进客户端包 */
  pushBack: number;
}) {
  const [word, setWord] = useState<Word | null>(null);
  /** 对比词 → 音标+中文，跟词一起从接口拿（表在服务端） */
  const [glosses, setGlosses] = useState<Record<string, string>>({});
  const [remaining, setRemaining] = useState(0);
  const [roundOver, setRoundOver] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  /** 删除点第一次只上膛 —— 连带删掉原句和复习进度，没有撤销 */
  const [armed, setArmed] = useState(false);
  /** 只剩一个词时按「不认识」，回来还是它。直说，别让人以为卡住了 */
  const [stuck, setStuck] = useState(false);
  /*
   * 要不要显示音标。**默认开**（就是原来的样子）。
   *
   * 这个模式里音标是和单词一起摆在眼前的，不像详情那样藏在「看详情」后面 ——
   * 想连读音一起自测（看着拼写自己念，再点单词听对不对）就关掉它。
   *
   * 初值给 true 而不是直接读 localStorage：服务端渲染时没有 localStorage，
   * 直接读会让首屏和水合后不一致。真实值在下面的 effect 里补上。
   */
  const [showPhonetic, setShowPhonetic] = useState(true);

  useEffect(() => {
    if (localStorage.getItem(PHONETIC_KEY) === 'off') setShowPhonetic(false);
  }, []);

  function togglePhonetic() {
    setShowPhonetic((v) => {
      localStorage.setItem(PHONETIC_KEY, v ? 'off' : 'on');
      return !v;
    });
  }

  /*
   * ---- 上下滑手势 ----
   *
   * 上滑 = 认识、下滑 = 不认识。**手机上的主路径**，底部按钮照旧保留。
   * 删除故意没有手势：不可逆的事不该一划就发生（它现在要点两次）。
   *
   * 用 Pointer Events 不用 Touch Events —— 触摸和鼠标走同一套，桌面上也能拖，
   * 顺带让我（Claude）在桌面浏览器里就能验。
   */

  /** 按下后的竖直位移。null = 没在拖 */
  const [dragY, setDragY] = useState<number | null>(null);
  /** 判定通过后卡片飞出的方向。null = 没在飞 */
  const [flying, setFlying] = useState<'up' | 'down' | null>(null);
  /*
   * 换过几张牌。挂在卡片的 `key` 上：数字一变 React 就重新挂载这个元素，
   * 进场的 keyframes 随之重放。
   *
   * 🔴 不能拿 `word.id` 当 key —— 只剩一个词时标「不认识」返回的还是它，
   * id 没变，动画就不会重放，看起来像卡住了。
   */
  const [dealt, setDealt] = useState(0);
  /**
   * 上一张是往哪个方向走的，决定下一张从哪边进场。
   * 用 ref 不用 state：它只在渲染时被读一次，进 state 会让 `load` 的依赖变脏。
   */
  const flew = useRef<'up' | 'down' | null>(null);
  const startY = useRef(0);
  /** 这一次交互是不是已经算「滑动」了。用来挡掉松手时那个 click */
  const swiping = useRef(false);
  /*
   * 正在拖 —— 🔴 **必须是 ref，不能拿 `dragY !== null` 判断。**
   *
   * `dragY` 是渲染闭包里的值：pointerdown 之后 React 还没重渲染时到来的
   * pointermove，看到的仍然是旧的 null，那一段位移就被整个丢掉。手指快速一甩
   * （down 和头几个 move 落在同一帧）正好是这种情况，滑动会莫名其妙失灵。
   * ref 是当场读当场写，没有这个时间差。
   */
  const dragging = useRef(false);

  /*
   * 🔴 **只在详情收起时接管手势。**
   *
   * 竖滑和页面滚动抢同一个动作。详情收起时这一屏根本不用滚，手势区给
   * `touch-action: none` 让浏览器彻底不插手（也顺带挡掉 iOS 的下拉刷新）；
   * 详情展开后内容变长、页面要能滚，这时就把手势关掉、用底部按钮。
   *
   * 每换一个词详情都会自动收起，所以绝大多数时间手势都是开着的。
   */
  const swipeEnabled = !revealed && !busy && !flying && word !== null;

  function onPointerDown(e: React.PointerEvent) {
    if (!swipeEnabled) return;
    startY.current = e.clientY;
    swiping.current = false;
    dragging.current = true;
    setDragY(0);
    /*
     * 捕获指针：手指划出这个元素也照样收得到事件。
     *
     * try 包着是因为 pointerId 不是"活跃指针"时它会抛 NotFoundError，
     * 抛出来就把整个 handler 带崩、手势直接失灵。捕获失败顶多是划出边界丢事件，
     * 不值得为它牺牲整个手势。
     */
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // 忽略：没捕获到也能用，只是划出元素外会断
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!dragging.current) return;
    const dy = e.clientY - startY.current;
    if (Math.abs(dy) > SLOP) swiping.current = true;
    setDragY(dy);
  }

  function onPointerUp(e: React.PointerEvent) {
    if (!dragging.current) return;
    dragging.current = false;
    // 位移也当场从事件算，不读 state —— 同上，state 可能还没跟上最后一次 move
    const dy = e.clientY - startY.current;
    setDragY(null);
    if (Math.abs(dy) < SWIPE_THRESHOLD) return; // 不够阈值，弹回原位

    const direction = dy < 0 ? 'up' : 'down';
    setFlying(direction);
    // 不等飞出动画放完再发请求 —— 网络往返本来就要 200~350ms，
    // 串起来会明显卡顿。动画和请求同时走，哪个先完都不影响结果。
    void judge(direction === 'up' ? 'known' : 'unknown');
  }

  /** 松手时浏览器还会补一个 click，滑动的话要挡掉，不然会触发单词发音 */
  function onClickCapture(e: React.MouseEvent) {
    if (!swiping.current) return;
    e.preventDefault();
    e.stopPropagation();
    swiping.current = false;
  }

  const load = useCallback(
    async (previousId?: number) => {
      setLoading(true);
      setRevealed(false);
      setArmed(false);
      const response = await fetch(`/api/triage?category=${scope}`);
      const data = (await response.json().catch(() => ({}))) as {
        word?: Word | null;
        glosses?: Record<string, string>;
        remaining?: number;
        roundOver?: boolean;
        error?: string;
      };
      setLoading(false);
      if (!response.ok) {
        setError(data.error ?? '加载失败');
        return;
      }
      const next = data.word ?? null;
      setWord(next);
      setGlosses(data.glosses ?? {});
      setRemaining(data.remaining ?? 0);
      setRoundOver(Boolean(data.roundOver));
      setStuck(previousId !== undefined && next?.id === previousId);
      // 新词到位：收掉飞出状态，换一张牌（key 变 → 进场动画重放）
      setFlying(null);
      setDealt((n) => n + 1);
    },
    [scope],
  );

  useEffect(() => {
    void load();
  }, [load]);

  async function judge(action: 'known' | 'unknown') {
    if (!word || busy) return;
    const id = word.id;
    // 进场方向跟着判定走，所以按钮、快捷键、手势三条路都有一样的动效
    flew.current = action === 'known' ? 'up' : 'down';
    setBusy(true);
    const response = await fetch(`/api/triage/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // scope 要一起发：「退后 10 位」是在**当前屏幕这个队列**里数的，
      // 在「全部」里退 10 位和在一个分类里退 10 位落点不一样
      body: JSON.stringify({ action, scope }),
    });
    setBusy(false);
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? '提交失败');
      return;
    }
    // 只有「不认识」才可能原地不动，「认识」一定换人，不用提示
    await load(action === 'unknown' ? id : undefined);
  }

  async function remove() {
    if (!word || busy) return;
    if (!armed) {
      setArmed(true);
      return;
    }
    setBusy(true);
    const response = await fetch(`/api/words/${word.id}`, { method: 'DELETE' });
    setBusy(false);
    if (!response.ok) {
      setArmed(false);
      setError('删除失败');
      return;
    }
    await load();
  }

  async function again() {
    setBusy(true);
    await fetch('/api/triage/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ categoryId: scope }),
    });
    setBusy(false);
    await load();
  }

  // 上了膛没接着点就自动下膛，免得停在这一屏时手滑碰一下就没了
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 5000);
    return () => clearTimeout(timer);
  }, [armed]);

  // 键盘：空格看详情，1 不认识、2 认识。**删除没有快捷键** —— 不可逆的事不该一按就发生
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!word) return;
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;

      if (e.code === 'Space') {
        e.preventDefault();
        setRevealed((r) => !r);
        return;
      }
      if (e.key === '1') void judge('unknown');
      if (e.key === '2') void judge('known');
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col p-4 md:p-8">
      <div className="mb-6 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1">
          <Button asChild variant="ghost" size="icon-sm" className="-ml-1 shrink-0">
            <Link href="/review" aria-label="回队列列表">
              <ChevronLeft className="size-4" />
            </Link>
          </Button>
          <h1 className="truncate font-serif text-2xl font-medium tracking-tight">{name}</h1>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <span className="text-sm text-muted-foreground">剩 {remaining} 个</span>
          {/* 音标开关。图标按钮不占地方 —— 这一屏的主角是中间那个词 */}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-pressed={showPhonetic}
            aria-label={showPhonetic ? '隐藏音标' : '显示音标'}
            title={showPhonetic ? '隐藏音标（美式，CMUdict）' : '显示音标（美式，CMUdict）'}
            onClick={togglePhonetic}
          >
            <Volume2 className={cn('size-4', !showPhonetic && 'opacity-40')} />
          </Button>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {loading && !word ? (
        <p className="py-24 text-center text-sm text-muted-foreground">…</p>
      ) : !word ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4">
          <p className="text-sm text-muted-foreground">
            {roundOver ? '这一轮过完了' : '这个分类还没有词'}
          </p>
          {roundOver && (
            <Button variant="outline" disabled={busy} onClick={() => void again()}>
              再来一轮
            </Button>
          )}
          <Button asChild variant="ghost" size="sm">
            <Link href="/review">回队列列表</Link>
          </Button>
        </div>
      ) : (
        <>
          {/*
            手势区 = 整个中间区域，不是只有单词那几十像素 —— 手机上得能随手一划，
            不能要求瞄准。`touch-action: none` **只在手势开着时**加：
            详情展开后内容变长、页面要能滚，那时候得把控制权还给浏览器。
          */}
          <div
            className={cn(
              'relative flex flex-1 flex-col justify-center overflow-hidden',
              swipeEnabled && 'touch-none select-none',
            )}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onClickCapture={onClickCapture}
          >
            {/* 上下两个提示。放在卡片**外面**，卡片跟手动它们不动 */}
            <SwipeHint label="认识" side="up" dy={dragY} />
            <SwipeHint label="不认识" side="down" dy={dragY} />

            <div
              key={dealt}
              style={{
                transform: flying
                  ? `translateY(${flying === 'up' ? '-120vh' : '120vh'})`
                  : dragY !== null
                    ? // 跟手位移 + 轻微缩小，划得越远越"脱手"
                      `translateY(${dragY}px) scale(${1 - Math.min(Math.abs(dragY), 240) / 2400})`
                    : undefined,
                opacity:
                  flying !== null
                    ? 0
                    : dragY !== null
                      ? 1 - Math.min(Math.abs(dragY), 300) / 600
                      : undefined,
                // 拖动中不能有 transition，否则跟不上手指
                transition: dragY !== null ? 'none' : undefined,
                animation:
                  flying === null && flew.current
                    ? `triage-enter-from-${flew.current === 'up' ? 'below' : 'above'} 180ms ease-out`
                    : undefined,
              }}
              className={cn(
                'flex flex-col justify-center gap-8',
                // 飞出 180ms 直出；松手没过阈值时弹回，带一点回弹更像实物
                flying
                  ? 'transition-[transform,opacity] duration-[180ms] ease-out'
                  : 'transition-[transform,opacity] duration-200 ease-[cubic-bezier(.2,1.3,.4,1)]',
              )}
            >
            {/* 词和音标绑在一起，音标贴着词 —— 和词汇页一致 */}
            <div className="flex flex-wrap items-baseline justify-center gap-x-2 gap-y-1">
              <button
                type="button"
                aria-label={`朗读 ${word.lemma}`}
                onClick={() => speak(word.lemma)}
                className="font-serif text-4xl font-medium transition-colors hover:text-primary"
              >
                {word.lemma}
              </button>
              {showPhonetic && word.phonetic && (
                <button
                  type="button"
                  aria-label={`朗读 ${word.lemma}`}
                  onClick={() => speak(word.lemma)}
                  className="text-sm text-muted-foreground/70 transition-colors hover:text-primary"
                >
                  /{word.phonetic}/
                </button>
              )}
            </div>

            {revealed ? (
              /*
               * 复用词汇页展开后的那个组件，**内容一模一样**：分类 + 词频、每条
               * encounter 的释义和高亮原句、对比词、备注。不另写一份 ——
               * 两处显示同一张卡，各写各的迟早对不上。
               *
               * `showLemma={false}`：词已经在上面大字摆着了。
               */
              <div className="space-y-4">
                <Separator />
                <WordDetail
                  wordId={word.id}
                  lemma={word.lemma}
                  category={word.category}
                  zipf={word.zipf}
                  encounters={word.encounters}
                  contrasts={word.contrasts}
                  onContrastsChange={(next) => setWord({ ...word, contrasts: next })}
                  glosses={glosses}
                  remark={word.remark}
                  onRemarkChange={(next) => setWord({ ...word, remark: next })}
                  showLemma={false}
                />
              </div>
            ) : (
              <Button
                variant="outline"
                className="mx-auto h-auto px-6 py-2.5 font-normal"
                onClick={() => setRevealed(true)}
              >
                看详情 <span className="ml-1 text-xs opacity-50">空格</span>
              </Button>
            )}

            {stuck && (
              <p className="text-center text-xs text-muted-foreground">
                队列里只剩它了，标「不认识」还是它 —— 认识或删掉才能过完这一轮
              </p>
            )}
            </div>
          </div>

          <div className="flex items-stretch gap-2 pt-10">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void judge('unknown')}
              className="h-auto flex-1 flex-col gap-0.5 rounded-sm py-3 font-normal"
              title={`往后挪 ${pushBack} 个，这一轮还会再碰到`}
            >
              <span>不认识</span>
              <span className="text-[11px] tabular-nums text-muted-foreground/60">1</span>
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void judge('known')}
              className="h-auto flex-1 flex-col gap-0.5 rounded-sm py-3 font-normal"
              title="本轮不再出现"
            >
              <span>认识</span>
              <span className="text-[11px] tabular-nums text-muted-foreground/60">2</span>
            </Button>
            {/* 删除和前两个不同量级 —— 不给等宽，也不给快捷键 */}
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void remove()}
              aria-label={armed ? `确认删除 ${word.lemma}` : `删除 ${word.lemma}`}
              title={armed ? '再点一次就删掉（连同原句和复习进度）' : '删除这个词'}
              className={`h-auto shrink-0 rounded-sm px-4 font-normal ${
                armed ? 'border-destructive text-destructive' : 'text-muted-foreground'
              }`}
            >
              <Trash2 className="size-4" />
              {armed && <span className="text-xs">再点一次</span>}
            </Button>
          </div>
        </>
      )}
    </main>
  );
}

/**
 * 滑动时浮在上/下方的提示，告诉你（jimmy）**松手会发生什么**。
 *
 * 只在往它那个方向划的时候出现：往上划只亮「认识」，往下划只亮「不认识」——
 * 两个一起亮的话等于没提示。
 *
 * 过阈值就变实心高亮，这一下视觉跳变就是「松手即生效」的信号，
 * 手机上没有 hover 可用，只能靠它。
 */
function SwipeHint({
  label,
  side,
  dy,
}: {
  label: string;
  side: 'up' | 'down';
  /** 当前竖直位移，null = 没在拖 */
  dy: number | null;
}) {
  const towards = dy !== null && (side === 'up' ? dy < 0 : dy > 0);
  const distance = towards ? Math.abs(dy) : 0;
  const past = distance >= SWIPE_THRESHOLD;

  return (
    <div
      aria-hidden
      className={cn(
        'pointer-events-none absolute inset-x-0 flex justify-center transition-opacity duration-100',
        side === 'up' ? 'top-0' : 'bottom-0',
      )}
      // 划到阈值时刚好全亮，之前按比例渐显
      style={{ opacity: Math.min(distance / SWIPE_THRESHOLD, 1) }}
    >
      <span
        className={cn(
          'rounded-full border px-4 py-1 text-sm transition-colors',
          past
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-border text-muted-foreground',
        )}
      >
        {label}
      </span>
    </div>
  );
}
