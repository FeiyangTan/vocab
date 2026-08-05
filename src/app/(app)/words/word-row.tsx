'use client';

import { Volume2 } from 'lucide-react';
import { useState } from 'react';
import { ContrastRow } from '@/components/contrast-row';
import { Button } from '@/components/ui/button';
import { speak } from '@/lib/speak';

type Word = {
  id: number;
  lemma: string;
  domain: 'work' | 'daily';
  contrasts: string[];
  encounterCount: number;
};

export function WordRow({ word }: { word: Word }) {
  const [contrasts, setContrasts] = useState(word.contrasts);

  return (
    <li className="py-3">
      <div className="mb-1.5 flex items-baseline gap-2">
        <span className="font-medium">{word.lemma}</span>
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          aria-label="发音"
          onClick={() => speak(word.lemma)}
        >
          <Volume2 className="size-3.5" />
        </Button>
        <span className="ml-auto text-xs text-muted-foreground">
          {word.domain} · {word.encounterCount} 次
        </span>
      </div>
      <ContrastRow wordId={word.id} contrasts={contrasts} onChange={setContrasts} compact />
    </li>
  );
}
