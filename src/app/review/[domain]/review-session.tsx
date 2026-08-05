'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ContrastRow } from '@/components/contrast-row';
import { speak } from '@/lib/speak';
import { GRADES } from '@/lib/sm2';

type Card = {
  id: number;
  clozeText: string;
  lemma: string;
  note: string | null;
  rawText: string;
  wordId: number;
  contrasts: string[];
};

/**
 * 复习一场。挖空句 → 翻面看答案 → 四个评分按钮。
 *
 * 每答一张立刻 POST 回服务端再取下一张 —— iOS 上 PWA 后台会被系统清掉，
 * 进度攒在内存里等结束再提交的话，切个 App 回来就没了。
 *
 * 对比词**只在背面显示**：正面是填空题，把相似词摆出来会退化成多选题，
 * 削弱开放回忆的效果。背面的作用是「答完之后提醒你别和 X 搞混」。
 */
export function ReviewSession({ domain }: { domain: 'work' | 'daily' }) {
  const [card, setCard] = useState<Card | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setFlipped(false);
    const response = await fetch(`/api/review?domain=${domain}`);
    const data = (await response.json().catch(() => ({}))) as {
      card?: Card | null;
      remaining?: number;
      error?: string;
    };
    setLoading(false);
    if (!response.ok) {
      setError(data.error ?? '加载失败');
      return;
    }
    setCard(data.card ?? null);
    setRemaining(data.remaining ?? 0);
  }, [domain]);

  useEffect(() => {
    void load();
  }, [load]);

  async function grade(g: number) {
    if (!card) return;
    const id = card.id;
    setCard(null); // 立刻切走，避免手快连点同一张
    await fetch(`/api/review/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grade: g }),
    });
    await load();
  }

  // 键盘：空格翻面，1–4 评分
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!card) return;
      // 正在输入对比词时不要抢键 —— 否则打 "courtesy" 里的字符会误触发评分
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;

      if (e.code === 'Space') {
        e.preventDefault();
        setFlipped((f) => !f);
        return;
      }
      if (flipped && e.key >= '1' && e.key <= '4') {
        void grade(Number(e.key) - 1);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col p-4">
      <header className="mb-6 flex items-baseline justify-between">
        <Link href="/review" className="text-sm opacity-60 hover:opacity-100">
          ← 复习
        </Link>
        <span className="text-sm opacity-60">
          {domain} · 剩 {remaining}
        </span>
      </header>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {loading && !card ? (
        <p className="py-24 text-center text-sm opacity-40">…</p>
      ) : !card ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4">
          <p className="text-sm opacity-60">这个队列复习完了</p>
          <Link href="/review" className="text-sm underline opacity-70">
            回队列列表
          </Link>
        </div>
      ) : (
        <>
          <div className="flex flex-1 flex-col justify-center gap-8">
            {/* 正面：挖空原句。对比词绝不出现在这里 */}
            <p className="text-center text-xl leading-relaxed">{card.clozeText}</p>

            {flipped ? (
              <div className="space-y-4 rounded-xl border border-black/10 p-4 dark:border-white/15">
                <div className="flex items-center justify-center gap-3">
                  <span className="text-2xl font-medium">{card.lemma}</span>
                  <button
                    onClick={() => speak(card.lemma)}
                    aria-label="发音"
                    className="rounded-full border border-black/15 px-2.5 py-1 text-sm dark:border-white/20"
                  >
                    🔊
                  </button>
                </div>

                {card.note && <p className="text-center text-base">{card.note}</p>}

                <div className="border-t border-black/10 pt-3 dark:border-white/15">
                  <ContrastRow
                    wordId={card.wordId}
                    contrasts={card.contrasts}
                    onChange={(next) => setCard({ ...card, contrasts: next })}
                  />
                </div>

                <p className="border-t border-black/10 pt-3 text-center text-sm opacity-50 dark:border-white/15">
                  {card.rawText}
                </p>
              </div>
            ) : (
              <button
                onClick={() => setFlipped(true)}
                className="mx-auto rounded-lg border border-black/15 px-6 py-2 text-sm dark:border-white/20"
              >
                翻面 <span className="ml-1 opacity-40">空格</span>
              </button>
            )}
          </div>

          {flipped && (
            <div className="grid grid-cols-4 gap-2 pb-6 pt-8">
              {GRADES.map((g, i) => (
                <button
                  key={g.grade}
                  onClick={() => grade(g.grade)}
                  title={g.hint}
                  className="rounded-lg border border-black/15 py-3 text-sm dark:border-white/20"
                >
                  <div>{g.label}</div>
                  <div className="mt-0.5 text-xs opacity-40">{i + 1}</div>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </main>
  );
}
