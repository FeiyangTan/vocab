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
  /** 词频指标（Zipf）。null = SUBTLEX 未收录（词组、专名） */
  zipf: number | null;
  /** 最近一次 encounter 的释义。释义挂在 encounter 上，同一个词不同语境可以不同 */
  note: string | null;
  /** 那一次的词性，和释义同源 */
  pos: string | null;
};

/**
 * 纸质风：不用带 ring 的圆角盒子，靠**一条发丝顶线 + 留白**分隔。
 *
 * 右上角**不显示分类** —— 分类名可以很长（《Hocus and Pocus》），
 * 挤得单词本身只剩省略号，而单词才是这张卡上最该看清的东西。
 * 要看某个分类的词用上面那排筛选。
 *
 * 详情**就地展开**，不用浮层 —— 浮层必然盖住旁边的卡片。就地展开只会把下面几行
 * 往下推，任何时候都没有内容被遮住。多张卡可以同时展开（各自持有自己的 open），
 * 不做互斥：互斥会让「对着比较两个词」变得做不到。
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
  /** 对比词 → 中文，服务端查好的；hover 显示 */
  glosses: Record<string, string>;
  /** 美式音标。null = 关掉了显示，或 CMUdict 里查不到（约 7%，多为词组） */
  phonetic: string | null;
  /** 中文释义可不可见。默认藏着，词汇页因此能当自测用 */
  revealed: boolean;
  onToggleReveal: () => void;
  /** 详情展不展开。状态在 WordList 上 —— 顶部那个「全部展开」要能一把改掉所有卡 */
  expanded: boolean;
  onToggleExpand: () => void;
}) {
  const [contrasts, setContrasts] = useState(word.contrasts);
  const [remark, setRemark] = useState(word.remark);
  /** 删除点第一次只上膛 —— 连带删掉原句和复习进度，没有撤销 */
  const [armed, setArmed] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const router = useRouter();

  /*
   * 拖拽**只挂在手柄上**（`listeners` 给 grip，不给整张卡）。
   * 卡上已经有 6 类可点的东西 —— 单词发音、对比词发音、眼睛、展开、删除、
   * 详情里的编辑 —— 整卡可拖会把它们全部变得难点。
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

  // 上了膛没接着点就自动下膛，免得半小时后手滑碰一下就没了
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 5000);
    return () => clearTimeout(timer);
  }, [armed]);

  /**
   * 点头部切换展开。**落在任何可交互元素上就不管** —— 卡上有拖动手柄、
   * 单词发音、眼睛、删除，它们各有各的事，不能顺带把卡收起来。
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
        外框 2px，比卡片内部那些 1px 的发丝线粗一档，层次分得开。
        不用 1.5px：DPR 为 1 的屏上浏览器会把它向下取整成 1px，和内部线一样粗，等于白加。
      */
      className={cn('rounded-sm border-2 border-border p-4', isDragging && 'opacity-40')}
    >
      {/*
        点头部区域展开/收起，不再有单独的 ⌄ 按钮。
        **只挂在头部不挂整卡** —— 展开区里有一堆能点的东西（改释义、加对比词、
        写备注），整卡可点的话在里面点个空白就会把卡收起来。
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
          aria-label={`拖动 ${word.lemma}`}
          className="-ml-1 shrink-0 cursor-grab touch-none self-center p-1 text-muted-foreground/40 transition-colors hover:text-muted-foreground active:cursor-grabbing"
        >
          <GripVertical className="size-3.5" />
        </button>
        {/*
          单词和音标绑在一起占左边，让音标**贴着词**；
          flex-1 给的是这个组合而不是单词本身 —— 给单词的话它会撑开，把音标推到右边去。
        */}
        <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
          {/* 单词本身就是发音按钮 —— 旁边再挂个喇叭图标是多余的一次视觉噪音 */}
          <button
            type="button"
            aria-label={`朗读 ${word.lemma}`}
            onClick={() => speak(word.lemma)}
            className="min-w-0 truncate text-left font-serif text-xl font-medium transition-colors hover:text-primary"
          >
            {word.lemma}
          </button>
          {/* 音标也是发音按钮 —— 和点单词一样，点哪儿都能读 */}
          {phonetic && (
            <button
              type="button"
              aria-label={`朗读 ${word.lemma}`}
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
            aria-label={armed ? `确认删除 ${word.lemma}` : `删除 ${word.lemma}`}
            title={armed ? '再点一次就删掉（连同原句和复习进度）' : '删除这个词'}
            onClick={() => void remove()}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>

      {/*
        眼睛放在释义这一行 —— 它管的就是这行，放到底部那排还要多想一步。
        紧跟在释义后面：藏起来时左边没东西，它自然落在最左；点开后就在中文右边。
      */}
      {word.note && (
        <div className="mt-1 flex items-start gap-1">
          {/* 藏起来时左边什么都不放。不用 blur 也不用占位符 —— 糊的短中文还是能猜出来 */}
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
            aria-label={revealed ? '隐藏中文' : '显示中文'}
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
 * 五格档位条 —— 词越常见格子越满。放在单词右边（去掉「N 次」之后空出来的位置）。
 * 未收录的显示一个破折号，不硬凑成 0 格（那会读作「最罕见」，是错的）。
 */
function FrequencyBar({ zipf }: { zipf: number | null }) {
  const band = frequencyBand(zipf);
  const title = zipf === null ? '词频未收录' : `${band.label} · Zipf ${zipf.toFixed(2)}`;

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
