'use client';

import { useState } from 'react';
import { ContrastRow } from '@/components/contrast-row';
import { LemmaRow } from '@/components/lemma-row';
import { NoteRow } from '@/components/note-row';
import { RemarkRow } from '@/components/remark-row';
import { Separator } from '@/components/ui/separator';
import { frequencyBand } from '@/lib/frequency';
import { speak } from '@/lib/speak';

export type Encounter = {
  id: number;
  /** An encounter stores the **sentence**, not the raw inbox input */
  rawText: string;
  note: string | null;
  pos: string | null;
  /** The front of the review card, with the target word replaced by `___` */
  clozeText: string;
};

/**
 * The expanded detail of a card. **Pure display, holding no interaction state** — the toggle
 * belongs to WordCard.
 *
 * This is the only place on `/words` where the **original sentence** is visible. "The time I
 * ran into it" is what the whole app stands on, yet the words page showed only the word and
 * its definition, with not a word of the sentence.
 */
export function WordDetail({
  wordId,
  lemma,
  category,
  remark,
  onRemarkChange,
  encounters,
  contrasts,
  onContrastsChange,
  glosses,
  zipf,
  showLemma = true,
}: {
  wordId: number;
  lemma: string;
  category: string;
  remark: string | null;
  onRemarkChange: (next: string | null) => void;
  encounters: Encounter[];
  contrasts: string[];
  onContrastsChange: (next: string[]) => void;
  glosses: Record<string, string>;
  zipf: number | null;
  /**
   * Whether to show the top "word + rename" row. On by default — the words page's card header
   * is the collapsed state, and the expanded view needs it.
   *
   * Quick pass passes false: that screen's subject is already the large word in the middle,
   * so another row with the same word right beneath it just repeats. (Renaming happens on the
   * words page.)
   */
  showLemma?: boolean;
}) {
  const [notes, setNotes] = useState<Record<number, string | null>>({});

  return (
    <div className="space-y-4 text-sm">
      {/* The word comes first — it is this card's trunk */}
      {showLemma && (
        <>
          <LemmaRow wordId={wordId} lemma={lemma} />
          <Separator />
        </>
      )}

      <div className="flex flex-wrap items-baseline gap-x-3 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
        <span>{category}</span>
        <span>
          Frequency {frequencyBand(zipf).label}
          {zipf !== null && ` · Zipf ${zipf.toFixed(2)}`}
        </span>
      </div>

      {encounters.map((e, i) => (
        <div key={e.id} className="space-y-1">
          {i > 0 && <Separator className="mb-3" />}

          {/* In the detail the definition is **always shown** (expanding *is* the request to
              see everything) and is editable — editing this encounter's definition, leaving
              the word's other encounters alone */}
          <NoteRow
            encounterId={e.id}
            pos={e.pos}
            note={notes[e.id] ?? e.note}
            onChange={(next) => setNotes((prev) => ({ ...prev, [e.id]: next }))}
          />

          {/* The sentence is itself the speak button, consistent with the word and the
              confusables */}
          <button
            type="button"
            aria-label="Speak the example"
            onClick={() => speak(e.rawText)}
            className="block w-full text-left font-serif text-[15px] leading-relaxed transition-colors hover:text-primary"
          >
            <Highlighted text={e.rawText} cloze={e.clozeText} lemma={lemma} />
          </button>

        </div>
      ))}

      {/* Confusables and the note are both hand-written annotations, so they follow the
          definition and the sentence */}
      <Separator />
      <ContrastRow
        wordId={wordId}
        contrasts={contrasts}
        onChange={onContrastsChange}
        glosses={glosses}
      />

      <Separator />
      <RemarkRow wordId={wordId} remark={remark} onChange={onRemarkChange} />
    </div>
  );
}

/**
 * Highlight the target word inside the original sentence.
 *
 * 🔴 **Located via the cloze, not by matching the lemma.** Words are often inflected in the
 * sentence (`guard` → `guarded`, `stripe` → `stripes`), so a whole-word match on the lemma
 * simply doesn't find them — 33 of the 224 encounters in the database are like this.
 *
 * The `cloze_text`, though, records exactly which span was cut: it differs from the sentence
 * in that one place, so aligning the common prefix and the common suffix leaves the span in
 * between. Measured: 224/224 align.
 *
 * When alignment fails (a cloze edited by hand), it falls back to a whole-word lemma match,
 * and failing that displays the sentence as-is rather than forcing something.
 */
function Highlighted({ text, cloze, lemma }: { text: string; cloze: string; lemma: string }) {
  const span = alignedSpan(text, cloze) ?? lemmaSpan(text, lemma);
  if (!span) return <>{text}</>;

  return (
    <>
      {text.slice(0, span.start)}
      <strong className="font-medium text-primary">{text.slice(span.start, span.end)}</strong>
      {text.slice(span.end)}
    </>
  );
}

/** The cloze and the sentence differ only at the target, so aligning the prefix and suffix
 *  brackets the span between them */
function alignedSpan(text: string, cloze: string): { start: number; end: number } | null {
  const blank = cloze.indexOf('___');
  if (blank < 0) return null;
  const before = cloze.slice(0, blank);
  const after = cloze.slice(blank + 3);
  if (!text.startsWith(before) || !text.endsWith(after)) return null;
  const start = before.length;
  const end = text.length - after.length;
  return end > start ? { start, end } : null;
}

/** The fallback: a case-insensitive whole-word match on the lemma */
function lemmaSpan(text: string, lemma: string): { start: number; end: number } | null {
  const escaped = lemma.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`\\b${escaped}\\b`, 'i').exec(text);
  return match ? { start: match.index, end: match.index + match[0].length } : null;
}
