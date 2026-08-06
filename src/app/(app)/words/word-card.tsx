'use client';

import { Volume2 } from 'lucide-react';
import { useState } from 'react';
import { ContrastRow } from '@/components/contrast-row';
import { Button } from '@/components/ui/button';
import { speak } from '@/lib/speak';

export type Word = {
  id: number;
  lemma: string;
  category: string;
  contrasts: string[];
  encounterCount: number;
  /** 最近一次 encounter 的释义。释义挂在 encounter 上，同一个词不同语境可以不同 */
  note: string | null;
};

/**
 * 纸质风：不用带 ring 的圆角盒子，靠**一条发丝顶线 + 留白**分隔。
 * 归类和次数也不用 Badge 胶囊，收成右上角一行小字 meta —— 像页边批注。
 */
export function WordCard({ word }: { word: Word }) {
  const [contrasts, setContrasts] = useState(word.contrasts);

  return (
    <div className="border-t border-border pt-4">
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex min-w-0 items-center gap-1">
          <span className="truncate font-serif text-xl font-medium">{word.lemma}</span>
          <Button
            variant="ghost"
            size="icon"
            className="size-6 shrink-0"
            aria-label="发音"
            onClick={() => speak(word.lemma)}
          >
            <Volume2 className="size-3.5" />
          </Button>
        </div>
        <span className="shrink-0 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
          {word.category} · {word.encounterCount}
        </span>
      </div>

      {word.note && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{word.note}</p>}

      <div className="mt-3">
        <ContrastRow wordId={word.id} contrasts={contrasts} onChange={setContrasts} compact />
      </div>
    </div>
  );
}
