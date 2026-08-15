'use client';

import { ChevronDown, Loader2, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { PURPOSE_LABEL, PURPOSES, type Purpose } from '@/lib/models';
import {
  CALL_PARAMS,
  DEFAULT_PROMPT,
  MAX_PROMPT_LENGTH,
  OUTPUT_SCHEMA,
  USER_TEMPLATE,
} from '@/lib/prompts';
import { cn } from '@/lib/utils';

export type PromptState = { text: string; customized: boolean };

/**
 * 看和改发给 Claude 的提示词。放在用量页、模型选择的正下方 ——
 * **这一页已经是「AI 的控制台」了**：用哪个模型、发什么指令、花了多少钱，
 * 是同一件事的三个面，改完提示词往下滚一屏就能看到它花了多少。
 *
 * 默认全部折叠：这两段东西加起来一百多行，摊开会把用量统计整个挤到屏幕外，
 * 而看花费的频率远高于改提示词。
 *
 * 🔴 **只有 system prompt 能改**，user 消息和输出 schema 是只读的 ——
 * 前者是数据信封，后者是和数据库列一一对应的接口契约，理由写在 `prompts.ts`。
 * 但两者都**显示出来**：问的是「看全所有提示词」，藏起来就没答上。
 */
export function PromptEditor({ current }: { current: Record<Purpose, PromptState> }) {
  return (
    <section>
      <div className="border-t border-border pt-4">
        <div className="mb-3 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
          Prompts
        </div>
        <div className="divide-y divide-border/60">
          {PURPOSES.map((purpose) => (
            <PromptRow key={purpose} purpose={purpose} initial={current[purpose]} />
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Sent with every call, so length costs money on each one. Takes effect on the{' '}
          <strong className="font-medium">next</strong> call (not cached). They are written in
          Chinese on purpose — they tell the model to write Chinese definitions.
        </p>
      </div>
    </section>
  );
}

function PromptRow({ purpose, initial }: { purpose: Purpose; initial: PromptState }) {
  const [open, setOpen] = useState(false);
  /** 已保存的那一版 —— 拿它和草稿比，判断「改了没有」 */
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState(initial.text);
  const [busy, setBusy] = useState<'save' | 'reset' | null>(null);
  const [error, setError] = useState('');

  const dirty = draft !== saved.text;
  const tooLong = draft.length > MAX_PROMPT_LENGTH;
  const params = CALL_PARAMS[purpose];

  async function submit(kind: 'save' | 'reset') {
    setBusy(kind);
    setError('');
    const response = await fetch('/api/settings/prompts', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ purpose, prompt: kind === 'reset' ? null : draft }),
    });
    setBusy(null);
    const data = (await response.json().catch(() => ({}))) as {
      error?: string;
      prompt?: string;
      customized?: boolean;
    };
    if (!response.ok || typeof data.prompt !== 'string') {
      setError(data.error ?? 'Failed to save');
      return;
    }
    // 服务端回的是真正生效的那一份 —— 恢复默认之后要用它把编辑框填回去
    setSaved({ text: data.prompt, customized: data.customized === true });
    setDraft(data.prompt);
  }

  return (
    <div className="py-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 text-left text-sm"
      >
        <ChevronDown
          className={cn(
            'size-3.5 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-180',
          )}
        />
        <span>{PURPOSE_LABEL[purpose]}</span>
        <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
          {saved.customized ? 'Edited' : 'Default'}
        </span>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {saved.text.length} chars
        </span>
      </button>

      {open && (
        <div className="mt-3 space-y-3 pl-5">
          <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            System · max_tokens {params.maxTokens} · effort {params.effort}
          </div>

          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
            aria-label={`${PURPOSE_LABEL[purpose]} system prompt`}
            /* 🔴 `max-h` 是必须的：`Textarea` 基类带 `field-sizing-content`，
               会撑到内容那么高 —— 整理那段两千多字，展开后能有九十来行，
               把保存按钮和下面整页用量统计全推到屏幕外。封顶之后自己出滚动条。 */
            className="max-h-[60vh] min-h-64 overflow-auto font-mono text-xs leading-relaxed"
          />

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <button
              type="button"
              onClick={() => void submit('save')}
              disabled={!dirty || tooLong || busy !== null}
              className="border-b-2 border-primary pb-0.5 font-medium text-primary transition-opacity disabled:border-transparent disabled:font-normal disabled:text-muted-foreground disabled:opacity-50"
            >
              {dirty ? 'Save' : 'Saved'}
            </button>

            {/* 只在真的有自定义时才给「恢复默认」—— 本来就是默认的时候，
                这个按钮点了什么也不会发生，摆着只会让人怀疑自己漏看了什么 */}
            {saved.customized && (
              <button
                type="button"
                onClick={() => void submit('reset')}
                disabled={busy !== null}
                className="inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
              >
                <RotateCcw className="size-3" />
                Reset to default
              </button>
            )}

            {busy && <Loader2 className="size-3 animate-spin text-muted-foreground" />}

            <span
              className={cn(
                'ml-auto text-xs tabular-nums',
                tooLong ? 'text-destructive' : 'text-muted-foreground',
              )}
            >
              {draft.length} / {MAX_PROMPT_LENGTH}
            </span>
          </div>

          {/* 改动没保存就离开这一屏很容易，给一句明确的提示，不做拦截 */}
          {dirty && !error && (
            <p className="text-xs text-muted-foreground">
              Unsaved — the next call still uses the saved version.
            </p>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}

          <ReadOnlyBlock label="User message" body={USER_TEMPLATE[purpose]} />
          <ReadOnlyBlock
            label="Output schema"
            body={JSON.stringify(OUTPUT_SCHEMA[purpose], null, 2)}
          />

          {/* 改坏了想对照原文时，不用去翻代码 */}
          {saved.customized && (
            <ReadOnlyBlock label="Default system prompt" body={DEFAULT_PROMPT[purpose]} />
          )}
        </div>
      )}
    </div>
  );
}

/** 只读的那几段：默认收起，`<details>` 就够了，不值得再上一套状态 */
function ReadOnlyBlock({ label, body }: { label: string; body: string }) {
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-[11px] uppercase tracking-[0.14em] text-muted-foreground marker:text-muted-foreground">
        {label} <span className="normal-case tracking-normal">(read-only)</span>
      </summary>
      {/* `overflow-x-auto`：schema 里有长行，窄屏上不给它自己的滚动条就会把整页撑宽 */}
      <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-sm border border-border bg-muted/30 p-2 font-mono leading-relaxed text-muted-foreground">
        {body}
      </pre>
    </details>
  );
}
