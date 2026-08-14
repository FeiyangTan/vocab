'use client';

import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  MODEL_CHOICES,
  PURPOSES,
  PURPOSE_LABEL,
  type ModelId,
  type Purpose,
} from '@/lib/models';
import { cn } from '@/lib/utils';

/**
 * 两条 AI 路径各用哪个模型。放在用量页最上面 —— **先看用什么，再看花了多少**，
 * 而且下面的花费本来就按模型分组，改完刷新就能直接对比。
 *
 * 两条路径分开选是有意的：整理草稿是质量关键路径（词形还原、按语境写释义、
 * 生成能和原句对齐的挖空句），对比词那条风险低得多（同音词已经不靠模型了）。
 */
export function ModelPicker({ current }: { current: Record<Purpose, ModelId> }) {
  const router = useRouter();
  // 乐观更新：点下去立刻变，请求失败再回滚
  const [value, setValue] = useState(current);
  const [busy, setBusy] = useState<Purpose | null>(null);
  const [error, setError] = useState('');

  async function pick(purpose: Purpose, model: ModelId) {
    if (value[purpose] === model || busy) return;
    const previous = value[purpose];
    setValue((v) => ({ ...v, [purpose]: model }));
    setBusy(purpose);
    setError('');
    const response = await fetch('/api/settings/models', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ purpose, model }),
    });
    setBusy(null);
    if (!response.ok) {
      setValue((v) => ({ ...v, [purpose]: previous }));
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? '保存失败');
      return;
    }
    // 下面的花费统计按模型分组，换完刷一下才对得上
    router.refresh();
  }

  return (
    <section>
      <div className="border-t border-border pt-4">
        <div className="mb-3 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
          模型
        </div>

        <div className="space-y-3">
          {PURPOSES.map((purpose) => (
            <div key={purpose} className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span className="w-20 shrink-0 text-sm">{PURPOSE_LABEL[purpose]}</span>
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                {MODEL_CHOICES.map((choice) => {
                  const active = value[purpose] === choice.id;
                  return (
                    <button
                      key={choice.id}
                      type="button"
                      disabled={busy !== null}
                      onClick={() => void pick(purpose, choice.id)}
                      title={`${choice.id} · ${choice.note}`}
                      aria-pressed={active}
                      className={cn(
                        'border-b-2 pb-0.5 text-sm transition-colors disabled:opacity-50',
                        active
                          ? 'border-primary font-medium text-primary'
                          : 'border-transparent text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {choice.tier}
                      <span className="ml-1.5 text-[11px] tabular-nums opacity-60">
                        {choice.note.split('（')[0]}
                      </span>
                    </button>
                  );
                })}
                {busy === purpose && (
                  <Loader2 className="size-3 animate-spin text-muted-foreground" />
                )}
              </div>
            </div>
          ))}
        </div>

        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

        <p className="mt-3 text-xs text-muted-foreground">
          改完<strong className="font-medium">下一次</strong>调用就生效（不缓存）。
          整理草稿是质量关键路径 —— 它要生成能和原句对齐的挖空句，降太狠会让句子里
          变形词的高亮失效；对比词那条风险低，同音词本来就不是模型算的。
        </p>
      </div>
    </section>
  );
}
