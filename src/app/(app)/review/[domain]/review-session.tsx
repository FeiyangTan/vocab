'use client';

import { Volume2 } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ContrastRow } from '@/components/contrast-row';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
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
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col p-4 md:p-8">
      <div className="mb-6 flex items-baseline justify-between">
        <h1 className="text-xl font-medium tracking-tight">{domain}</h1>
        <span className="text-sm text-muted-foreground">剩 {remaining} 张</span>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {loading && !card ? (
        <p className="py-24 text-center text-sm text-muted-foreground">…</p>
      ) : !card ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4">
          <p className="text-sm text-muted-foreground">这个队列复习完了</p>
          <Button asChild variant="outline">
            <Link href="/review">回队列列表</Link>
          </Button>
        </div>
      ) : (
        <>
          <div className="flex flex-1 flex-col justify-center gap-8">
            {/* 正面：挖空原句。对比词绝不出现在这里 */}
            <p className="text-center text-xl leading-relaxed">{card.clozeText}</p>

            {flipped ? (
              <Card className="gap-4 p-5">
                <div className="flex items-center justify-center gap-2">
                  <span className="text-2xl font-medium">{card.lemma}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="发音"
                    onClick={() => speak(card.lemma)}
                  >
                    <Volume2 className="size-4" />
                  </Button>
                </div>

                {card.note && <p className="text-center text-base">{card.note}</p>}

                <Separator />
                <ContrastRow
                  wordId={card.wordId}
                  contrasts={card.contrasts}
                  onChange={(next) => setCard({ ...card, contrasts: next })}
                />

                <Separator />
                <p className="text-center text-sm text-muted-foreground">{card.rawText}</p>
              </Card>
            ) : (
              <Button variant="outline" className="mx-auto" onClick={() => setFlipped(true)}>
                翻面 <span className="ml-1 text-xs opacity-50">空格</span>
              </Button>
            )}
          </div>

          {flipped && (
            <div className="grid grid-cols-4 gap-2 pt-8">
              {GRADES.map((g, i) => (
                <Button
                  key={g.grade}
                  variant="outline"
                  title={g.hint}
                  onClick={() => grade(g.grade)}
                  className="h-auto flex-col gap-0.5 py-3"
                >
                  <span>{g.label}</span>
                  <span className="text-xs text-muted-foreground">{i + 1}</span>
                </Button>
              ))}
            </div>
          )}
        </>
      )}
    </main>
  );
}
