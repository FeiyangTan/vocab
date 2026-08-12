'use client';

import { Loader2, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ContrastEditor } from './contrast-editor';

/**
 * 对比词编辑器 + **立刻保存**。用在词已经存在的地方：复习页背面、词汇列表页。
 *
 * 收集箱审核页不能用这个 —— 那时词还没创建，没有 id 可 PUT，
 * 那边直接用 `ContrastEditor` 攒本地 state，随「确认」一起提交。
 */
export function ContrastRow({
  wordId,
  contrasts,
  onChange,
  compact = false,
  glosses,
}: {
  wordId: number;
  contrasts: string[];
  onChange: (next: string[]) => void;
  compact?: boolean;
  glosses?: Record<string, string>;
}) {
  const [pending, setPending] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [error, setError] = useState('');
  /** 「找了但一个都不合适」要说出来，不然点了没反应像是坏了 */
  const [notice, setNotice] = useState('');
  /** 新加的词的中文由接口一起返回，叠在服务端传下来的那份上 */
  const [extra, setExtra] = useState<Record<string, string>>({});

  /**
   * 让 Claude 找形近/音近的词直接加进来。**按次计费**，所以只在点按钮时才发，
   * 不做自动补全（进页面就调 = 每次浏览都在花钱）。
   */
  async function suggest() {
    setSuggesting(true);
    setError('');
    setNotice('');
    const response = await fetch(`/api/words/${wordId}/contrasts/suggest`, { method: 'POST' });
    setSuggesting(false);
    const data = (await response.json().catch(() => ({}))) as {
      contrasts?: string[];
      added?: string[];
      dropped?: number;
      glosses?: Record<string, string>;
      error?: string;
    };
    if (!response.ok) {
      setError(data.error ?? '匹配失败');
      return;
    }
    // 服务端已经和已有的取过并集、清洗过，直接用它的结果
    if (data.contrasts) onChange(data.contrasts);
    if (data.glosses) setExtra((prev) => ({ ...prev, ...data.glosses }));
    if (!data.added?.length) {
      setNotice(
        data.dropped
          ? `没找到够常用的对比词（${data.dropped} 个建议因为太生僻被滤掉）`
          : '没找到合适的对比词',
      );
    }
  }

  async function save(next: string[]) {
    setPending(true);
    const response = await fetch(`/api/words/${wordId}/contrasts`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contrasts: next }),
    });
    setPending(false);
    if (!response.ok) return;
    const data = (await response.json().catch(() => ({}))) as {
      contrasts?: string[];
      glosses?: Record<string, string>;
    };
    // 用服务端清洗后的结果，别用本地的 —— trim / 去重 / 上限都在那边
    onChange(data.contrasts ?? next);
    if (data.glosses) setExtra((prev) => ({ ...prev, ...data.glosses }));
  }

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-1">
        <ContrastEditor
          value={contrasts}
          onChange={save}
          compact={compact}
          busy={pending}
          glosses={{ ...glosses, ...extra }}
        />
        <Button
          variant="ghost"
          size="icon-xs"
          className="shrink-0 text-muted-foreground"
          aria-label="让 AI 匹配对比词"
          title="让 AI 找拼写相近 / 同音 / 发音易混的词，直接加进来"
          disabled={suggesting || pending}
          onClick={() => void suggest()}
        >
          {suggesting ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <Sparkles className="size-3" />
          )}
        </Button>
      </div>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      {notice && <p className="mt-1 text-xs text-muted-foreground">{notice}</p>}
    </div>
  );
}
