'use client';

import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { MAX_CONTRASTS } from '@/lib/contrasts';
import { speak } from '@/lib/speak';

/**
 * 对比词 chip 编辑器 —— **纯 UI，不碰网络**。
 *
 * 拆成这一层是因为有两种保存时机：
 * - 复习页 / 词汇页：词已存在，改一下就立刻 PUT（外面包一层 ContrastRow）
 * - 收集箱审核页：词**还不存在**（确认的事务里才创建），只能先攒在本地 state，
 *   随「确认」一起提交
 */
export function ContrastEditor({
  value,
  onChange,
  compact = false,
  busy = false,
  readOnly = false,
  glosses,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  /** 词汇列表页一行一个词，「对比词」这个标签就省了 */
  compact?: boolean;
  busy?: boolean;
  /**
   * 只显示不编辑：保留词和**朗读**（发音不是编辑，而且带读是对比词当初的核心要求），
   * 去掉删除和添加。词汇页主卡片用这个，增删在展开的详情里。
   */
  readOnly?: boolean;
  /**
   * 词 → 中文，**服务端查好传下来的**（`src/lib/dictionary.ts`）。
   * 只含查得到的那些；查不到的不给 title，不显示空气泡。
   */
  glosses?: Record<string, string>;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');

  function add() {
    const word = draft.trim();
    setDraft('');
    setAdding(false);
    if (!word || value.includes(word)) return;
    onChange([...value, word]);
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {!compact && value.length > 0 && (
        <span className="text-xs text-muted-foreground">对比词</span>
      )}

      {/*
        不用 Badge 的灰底胶囊 —— 对比词是全站最像「纸上批注」的一处，
        衬线斜体 + 墨绿下划线比方块 chip 更贴纸质风。
      */}
      {value.map((word) => (
        /* `flex-wrap` + `min-w-0`：展开释义后这个 chip 可能比一行还宽，
           得允许它在内部折行，否则窄屏上整页会被撑出横向滚动条 */
        <span key={word} className="inline-flex min-w-0 flex-wrap items-center gap-0.5">
          {/*
            词本身就是发音按钮 —— 旁边再挂个喇叭图标是多余的一次视觉噪音。
            hover 显示中文用 Tooltip 不用原生 `title`：后者要静止 1–2 秒才弹，
            稍微动一下就不出，实际用起来常常以为没有提示。
          */}
          <ChipButton word={word} gloss={glosses?.[word]} />
          {!readOnly && (
            <button
              type="button"
              onClick={() => onChange(value.filter((w) => w !== word))}
              aria-label={`删除 ${word}`}
              disabled={busy}
              className="px-0.5 text-muted-foreground/50 hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          )}
        </span>
      ))}

      {readOnly ? null : adding ? (
        <Input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={add}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
            if (e.key === 'Escape') {
              setDraft('');
              setAdding(false);
            }
          }}
          placeholder="相近的词"
          className="h-7 w-32 rounded-sm px-2 font-serif text-[15px] italic"
        />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          disabled={busy || value.length >= MAX_CONTRASTS}
          aria-label="添加对比词"
          className="inline-flex items-center gap-1 rounded-sm border border-dashed px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
        >
          <Plus className="size-3" />
          {value.length === 0 && '对比词'}
        </button>
      )}
    </div>
  );
}

/**
 * 一个对比词 chip：**点一下 = 发音 + 就地展开音标和中文**，再点收起。
 *
 * 🔴 为什么不是「点击改成看释义」：点击原本就是发音，那不能丢 —— 对比词很多是
 * **读音**相近才容易混（crispy / crisis），光看拼写体会不出来。所以两件事一起做。
 *
 * 🔴 为什么展开在行内而不是弹气泡：手机上 Radix 的 `Tooltip` 设计上就不响应触摸，
 * 换 `Popover` 又要处理定位、层级、点外面关闭，而且快速过词那个手势容器是
 * `overflow-hidden`，浮层容易被截。行内不依赖任何这些，各端行为完全一致。
 * 代价是那一行会重排，可以接受。
 *
 * 桌面的 hover 气泡照旧保留 —— 悬停比点击更省事。**但展开之后就不再弹**，
 * 否则同一句话在屏幕上出现两遍。
 */
function ChipButton({ word, gloss }: { word: string; gloss?: string }) {
  const [open, setOpen] = useState(false);

  const button = (
    <button
      type="button"
      onClick={() => {
        speak(word);
        // 查不到中文的词只发音，不留一个点了没反应的展开态
        if (gloss) setOpen((v) => !v);
      }}
      aria-label={gloss ? `朗读 ${word}，并${open ? '收起' : '展开'}释义` : `朗读 ${word}`}
      aria-expanded={gloss ? open : undefined}
      className="font-serif text-[15px] italic text-primary underline decoration-border underline-offset-4 transition-colors hover:decoration-primary"
    >
      {word}
    </button>
  );

  // 查不到中文的词不套 Tooltip —— 不弹空气泡
  if (!gloss) return button;

  return (
    <>
      {open ? (
        button
      ) : (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>{button}</TooltipTrigger>
            <TooltipContent>{gloss}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
      {open && (
        /* 弱化样式：它是注解，别和斜体的词本身抢。
           **不加 `whitespace-nowrap`** —— 释义能有二三十个字符
           （`/ˈkraɪsɪs/ n. 危机, 危险期, 决定性时刻`），窄屏上不让它折行就会横向溢出 */
        <span className="min-w-0 text-xs text-muted-foreground">{gloss}</span>
      )}
    </>
  );
}
