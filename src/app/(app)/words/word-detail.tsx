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
  /** encounter 存的是**句子**，不是 inbox 里的原始输入 */
  rawText: string;
  note: string | null;
  pos: string | null;
  /** 复习时的正面，目标词被替换成 `___` */
  clozeText: string;
};

/**
 * 卡片展开后的详情。**纯展示，不带交互状态** —— 开关由 WordCard 管。
 *
 * 这里是 `/words` 上唯一能看到**原句**的地方。「我遇到它的那一次」是整个应用的
 * 立足点，词汇页却一直只有单词和释义，原句一个字都看不到。
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
}) {
  const [notes, setNotes] = useState<Record<number, string | null>>({});

  return (
    <div className="space-y-4 text-sm">
      {/* 词本身放最前 —— 它是这张卡最主干的东西 */}
      <LemmaRow wordId={wordId} lemma={lemma} />

      <Separator />

      <div className="flex flex-wrap items-baseline gap-x-3 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
        <span>{category}</span>
        <span>
          词频 {frequencyBand(zipf).label}
          {zipf !== null && ` · Zipf ${zipf.toFixed(2)}`}
        </span>
      </div>

      {encounters.map((e, i) => (
        <div key={e.id} className="space-y-1">
          {i > 0 && <Separator className="mb-3" />}

          {/* 详情里的释义**固定显示**（展开本身就是「我要看全部」），而且可以改 ——
              改的是这一条 encounter 的释义，不影响同一个词的其它 encounter */}
          <NoteRow
            encounterId={e.id}
            pos={e.pos}
            note={notes[e.id] ?? e.note}
            onChange={(next) => setNotes((prev) => ({ ...prev, [e.id]: next }))}
          />

          {/* 原句本身就是发音按钮，和单词、对比词一致 */}
          <button
            type="button"
            aria-label="朗读例句"
            onClick={() => speak(e.rawText)}
            className="block w-full text-left font-serif text-[15px] leading-relaxed transition-colors hover:text-primary"
          >
            <Highlighted text={e.rawText} cloze={e.clozeText} lemma={lemma} />
          </button>

        </div>
      ))}

      {/* 对比词和备注都是手写的注解，放在释义原句之后 */}
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
 * 把原句里的目标词标出来。
 *
 * 🔴 **靠挖空句定位，不靠 lemma 匹配。** 词在句子里常常是变形的
 *（`guard` → `guarded`、`stripe` → `stripes`），拿 lemma 去整词匹配根本找不到 ——
 * 库里 224 条 encounter 有 33 条是这种。
 *
 * 而 `cloze_text` 里就精确记着当初挖掉的是哪一段：它和原句只差目标词那一处，
 * 对齐公共前缀和公共后缀，中间那段就是。实测 224/224 全部对得上。
 *
 * 对不齐时（挖空句被手工改过）退回 lemma 整词匹配，再不行就原样显示，不硬凑。
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

/** 挖空句和原句只差目标词那一处，前后缀对齐就能框出中间那段 */
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

/** 退路：lemma 的大小写不敏感整词匹配 */
function lemmaSpan(text: string, lemma: string): { start: number; end: number } | null {
  const escaped = lemma.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`\\b${escaped}\\b`, 'i').exec(text);
  return match ? { start: match.index, end: match.index + match[0].length } : null;
}
