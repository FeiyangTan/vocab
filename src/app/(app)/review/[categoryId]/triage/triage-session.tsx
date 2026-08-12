'use client';

import { ChevronLeft, Trash2, Volume2 } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { speak } from '@/lib/speak';
import { cn } from '@/lib/utils';

/** 音标开关存这儿。设置就该记住 —— 每进一次都要重按一遍不叫设置 */
const PHONETIC_KEY = 'vocab:triage:phonetic';

type Word = {
  id: number;
  lemma: string;
  phonetic: string | null;
  note: string | null;
  pos: string | null;
  remark: string | null;
};

/**
 * 「快速过词」一场。看单词 → 认识 / 不认识 / 删除，把整个分类刷空为一轮。
 *
 * 队列在服务端，这里**一次只拿一个词** —— 和挖空复习同一个道理，也顺带让
 * 「刷新不丢进度」成立：前端手里根本没有队列。
 *
 * 故意**不显示原句、对比词**：那些是挖空复习背面的东西，堆进来这个模式就不快了。
 * 释义也默认藏着 —— 这个模式的意义就是先自测，答案得自己要。
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
   * 这个模式里音标是和单词一起摆在眼前的，不像释义那样藏在「看释义」后面 ——
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

  const load = useCallback(
    async (previousId?: number) => {
      setLoading(true);
      setRevealed(false);
      setArmed(false);
      const response = await fetch(`/api/triage?category=${scope}`);
      const data = (await response.json().catch(() => ({}))) as {
        word?: Word | null;
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
      setRemaining(data.remaining ?? 0);
      setRoundOver(Boolean(data.roundOver));
      setStuck(previousId !== undefined && next?.id === previousId);
    },
    [scope],
  );

  useEffect(() => {
    void load();
  }, [load]);

  async function judge(action: 'known' | 'unknown') {
    if (!word || busy) return;
    const id = word.id;
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

  // 键盘：空格看释义，1 不认识、2 认识。**删除没有快捷键** —— 不可逆的事不该一按就发生
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
          <div className="flex flex-1 flex-col justify-center gap-8">
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
              <div className="space-y-4">
                <Separator />
                <p className="text-center text-base">
                  {word.pos && <span className="mr-1 text-muted-foreground">{word.pos}</span>}
                  {word.note ?? <span className="text-muted-foreground">（没有释义）</span>}
                </p>
                {word.remark && (
                  <p className="text-center text-sm text-muted-foreground">{word.remark}</p>
                )}
              </div>
            ) : (
              <Button
                variant="outline"
                className="mx-auto h-auto px-6 py-2.5 font-normal"
                onClick={() => setRevealed(true)}
              >
                看释义 <span className="ml-1 text-xs opacity-50">空格</span>
              </Button>
            )}

            {stuck && (
              <p className="text-center text-xs text-muted-foreground">
                队列里只剩它了，标「不认识」还是它 —— 认识或删掉才能过完这一轮
              </p>
            )}
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
