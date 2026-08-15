'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Eye, EyeOff, GripVertical, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { frequencyBand } from '@/lib/frequency';
import { speak } from '@/lib/speak';
import { cn } from '@/lib/utils';
import { type Encounter, WordDetail } from './word-detail';

export type Word = {
  id: number;
  lemma: string;
  category: string;
  contrasts: string[];
  remark: string | null;
  /** Word frequency (Zipf). null = not listed in SUBTLEX (phrases, proper nouns) */
  zipf: number | null;
  /** The most recent encounter's definition. Definitions hang off encounters, so the same
   *  word can be defined differently in different contexts */
  note: string | null;
  /** That encounter's part of speech, from the same source as the definition */
  pos: string | null;
};

/**
 * The paper look: no rounded box with a ring, separated instead by **one hairline rule plus
 * whitespace**.
 *
 * The category is **not shown** in the top right — a category name can be long
 * (《Hocus and Pocus》) and squeezes the word itself down to an ellipsis, when the word is the
 * thing on this card that most needs to be legible. Use the filter row above to see one
 * category's words.
 *
 * The detail **expands in place** rather than floating — a floating layer inevitably covers
 * the neighbouring cards. Expanding in place only pushes the rows below downward, so nothing
 * is ever obscured. Several cards can be expanded at once (each owns its own open state), and
 * they are deliberately not mutually exclusive: exclusivity would make comparing two words
 * side by side impossible.
 */
export function WordCard({
  word,
  encounters,
  glosses,
  phonetic,
  revealed,
  onToggleReveal,
  expanded,
  onToggleExpand,
}: {
  word: Word;
  encounters: Encounter[];
  /** confusable → gloss, resolved on the server; shown on hover */
  glosses: Record<string, string>;
  /** US phonetics. null = display is switched off, or CMUdict has no entry (about 7%, mostly
   *  phrases) */
  phonetic: string | null;
  /** Whether the definition is visible. Hidden by default, which is what lets the words page
   *  double as self-testing */
  revealed: boolean;
  onToggleReveal: () => void;
  /** Whether the detail is expanded. The state lives on WordList — the "expand all" control
   *  at the top has to change every card at once */
  expanded: boolean;
  onToggleExpand: () => void;
}) {
  const [contrasts, setContrasts] = useState(word.contrasts);
  const [remark, setRemark] = useState(word.remark);
  /** The first tap on Delete only arms it — it takes the sentences and review progress with
   *  it, and there is no undo */
  const [armed, setArmed] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const router = useRouter();

  /*
   * Dragging is bound **to the handle only** (`listeners` go to the grip, not the whole card).
   * The card already carries six kinds of tappable thing — speak the word, speak a confusable,
   * the eye, expand, delete, and the editors inside the detail — and making the whole card
   * draggable would make every one of them harder to hit.
   */
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: word.id });

  // Disarm automatically if the second tap doesn't come, so a stray touch half an hour later
  // can't delete anything
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 5000);
    return () => clearTimeout(timer);
  }, [armed]);

  /**
   * Tapping the header toggles expansion. **Anything landing on an interactive element is
   * ignored** — the card has a drag handle, speak-the-word, the eye and delete, each with its
   * own job, and none of them should collapse the card as a side effect.
   */
  function toggleFromHeader(event: React.MouseEvent) {
    if ((event.target as HTMLElement).closest('button, a, input, textarea')) return;
    onToggleExpand();
  }

  async function remove() {
    if (!armed) {
      setArmed(true);
      return;
    }
    setDeleting(true);
    const response = await fetch(`/api/words/${word.id}`, { method: 'DELETE' });
    if (!response.ok) {
      setDeleting(false);
      setArmed(false);
      return;
    }
    router.refresh();
  }

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      /*
        A 2px outer border, one step heavier than the 1px hairlines inside the card, so the
        layers stay distinct.
        Not 1.5px: on a DPR-1 screen the browser floors it to 1px, matching the inner lines
        exactly, which makes it pointless.
      */
      className={cn('rounded-sm border-2 border-border p-4', isDragging && 'opacity-40')}
    >
      {/*
        Tapping the header area expands/collapses; there's no separate ⌄ button any more.
        **Bound to the header, not the whole card** — the expanded area is full of tappable
        things (edit the definition, add a confusable, write a note), and a whole-card handler
        would collapse it whenever you tapped a blank spot inside.
      */}
      <div
        onClick={toggleFromHeader}
        className="cursor-pointer"
        aria-expanded={expanded}
      >
      <div className="flex items-baseline justify-between gap-2">
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={`Drag ${word.lemma}`}
          className="-ml-1 shrink-0 cursor-grab touch-none self-center p-1 text-muted-foreground/40 transition-colors hover:text-muted-foreground active:cursor-grabbing"
        >
          <GripVertical className="size-3.5" />
        </button>
        {/*
          The word and its phonetics are bound together on the left so the phonetics sit
          **against** the word; flex-1 is applied to the pair rather than to the word itself —
          on the word it would stretch and push the phonetics off to the right.
        */}
        <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
          {/* The word is itself the speak button — a separate speaker icon beside it would
              be pure visual noise */}
          <button
            type="button"
            aria-label={`Speak ${word.lemma}`}
            onClick={() => speak(word.lemma)}
            className="min-w-0 truncate text-left font-serif text-xl font-medium transition-colors hover:text-primary"
          >
            {word.lemma}
          </button>
          {/* The phonetics speak too — same as tapping the word, either target works */}
          {phonetic && (
            <button
              type="button"
              aria-label={`Speak ${word.lemma}`}
              onClick={() => speak(word.lemma)}
              className="min-w-0 truncate text-xs text-muted-foreground/70 transition-colors hover:text-primary"
            >
              /{phonetic}/
            </button>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <FrequencyBar zipf={word.zipf} />
          <Button
            variant="ghost"
            size="icon-sm"
            className={cn('shrink-0', armed && 'text-destructive')}
            disabled={deleting}
            aria-label={armed ? `Confirm delete ${word.lemma}` : `Delete ${word.lemma}`}
            title={armed ? 'Tap again to delete (along with its examples and review progress)' : 'Delete this word'}
            onClick={() => void remove()}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>

      {/*
        The eye sits on the definition row — that row is what it governs, and putting it in the
        bottom row would take one more inference to connect.
        It follows the definition: while hidden there's nothing to its left so it falls
        naturally at the far left, and once revealed it sits to the right of the text.
      */}
      {word.note && (
        <div className="mt-1 flex items-start gap-1">
          {/* Nothing at all to the left while hidden. No blur and no placeholder — a short
              blurred gloss is still guessable */}
          {revealed && (
            <p className="line-clamp-2 text-sm text-muted-foreground">
              {word.pos && <span className="mr-1 text-muted-foreground/60">{word.pos}</span>}
              {word.note}
            </p>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            className="-mt-1 shrink-0"
            aria-pressed={revealed}
            aria-label={revealed ? 'Hide Chinese' : 'Show Chinese'}
            onClick={onToggleReveal}
          >
            {revealed ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
          </Button>
        </div>
      )}

      </div>

      {expanded && (
        <>
          <Separator className="my-3" />
          <WordDetail
            wordId={word.id}
            lemma={word.lemma}
            category={word.category}
            remark={remark}
            onRemarkChange={setRemark}
            encounters={encounters}
            contrasts={contrasts}
            onContrastsChange={setContrasts}
            glosses={glosses}
            zipf={word.zipf}
          />
        </>
      )}
    </div>
  );
}

/**
 * A five-cell band indicator — the more common the word, the fuller it is. It sits to the
 * right of the word, in the space freed when the "N times" counter was removed.
 * A word not in the corpus shows a dash rather than being forced to zero cells (which would
 * read as "rarest of all", and that's wrong).
 */
function FrequencyBar({ zipf }: { zipf: number | null }) {
  const band = frequencyBand(zipf);
  const title = zipf === null ? 'Frequency not listed' : `${band.label} · Zipf ${zipf.toFixed(2)}`;

  if (band.level === 0) {
    return (
      <span className="shrink-0 text-[11px] text-muted-foreground/40" title={title}>
        —
      </span>
    );
  }

  return (
    <span className="flex shrink-0 items-center gap-px" title={title} aria-label={title}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          className={cn(
            'h-2.5 w-1 rounded-px',
            n <= band.level ? 'bg-primary/70' : 'bg-muted-foreground/20',
          )}
        />
      ))}
    </span>
  );
}
