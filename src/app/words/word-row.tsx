'use client';

import { useState } from 'react';
import { ContrastRow } from '@/components/contrast-row';
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
        <button
          onClick={() => speak(word.lemma)}
          aria-label="发音"
          className="text-sm opacity-50 hover:opacity-100"
        >
          🔊
        </button>
        <span className="ml-auto text-xs opacity-40">
          {word.domain} · {word.encounterCount} 次
        </span>
      </div>
      <ContrastRow wordId={word.id} contrasts={contrasts} onChange={setContrasts} compact />
    </li>
  );
}
