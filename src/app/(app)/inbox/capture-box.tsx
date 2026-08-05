'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';

/**
 * 网页端手动添加。
 *
 * 存在的理由：macOS 的「服务」机制在这台机器上注册不上（Preview / Chrome 的服务菜单里
 * 始终看不到快捷指令，`pbs -dump` 注册表里 0 匹配），Mac 端的键盘快捷键这条路走不通。
 * iPhone 的分享表单不受影响，照常用。
 *
 * 走 cookie 鉴权，不是 token —— token 只留给快捷指令，别落进前端 JS。
 *
 * 默认**按行拆成多条**（一次录一串单词很常见）。但 PDF / 电子书复制过来的句子带的是
 * 排版折行，不是句子边界，拆了会变成残句 —— 所以给一个「整段当一条」的开关。
 */
export function CaptureBox() {
  const router = useRouter();
  const [text, setText] = useState('');
  const [asOne, setAsOne] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  const willSave = asOne ? (text.trim() ? 1 : 0) : lines.length;

  async function submit() {
    if (willSave === 0) return;
    setPending(true);
    setError('');

    const response = await fetch('/api/inbox', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw_text: text, source: 'web', split: !asOne }),
    });

    setPending(false);
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? '存入失败');
      return;
    }
    setText('');
    router.refresh();
  }

  return (
    <div className="mb-6">
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // ⌘Enter / Ctrl+Enter 直接提交，不用摸鼠标
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void submit();
          }
        }}
        rows={3}
        placeholder="粘贴英文句子，或一行一个单词…"
        className="resize-y"
      />

      <div className="mt-2 flex items-center justify-between gap-3">
        <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
          <Checkbox checked={asOne} onCheckedChange={(v) => setAsOne(v === true)} />
          整段当一条
        </label>

        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            {willSave > 0 ? `将存入 ${willSave} 条 · ⌘↩` : '⌘↩ 存入'}
          </span>
          <Button size="sm" onClick={submit} disabled={pending || willSave === 0}>
            {pending ? '…' : '存入'}
          </Button>
        </div>
      </div>

      {!asOne && lines.length > 1 && (
        <p className="mt-1.5 text-xs text-muted-foreground">
          从 PDF 或电子书复制的句子常带排版折行 —— 那种情况勾上「整段当一条」
        </p>
      )}

      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  );
}
