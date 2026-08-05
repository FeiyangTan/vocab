'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * 网页端手动添加。
 *
 * 存在的理由：macOS 的「服务」机制在这台机器上注册不上（Preview / Chrome 的服务菜单里
 * 始终看不到快捷指令，`pbs -dump` 注册表里 0 匹配），Mac 端的键盘快捷键这条路走不通。
 * iPhone 的分享表单不受影响，照常用。
 *
 * 走 cookie 鉴权，不是 token —— token 只留给快捷指令，别落进前端 JS。
 */
export function CaptureBox() {
  const router = useRouter();
  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    const raw = text.trim();
    if (!raw) return;
    setPending(true);
    setError('');

    const response = await fetch('/api/inbox', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw_text: text, source: 'web' }),
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
      <textarea
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
        placeholder="粘贴一句含生词的英文…"
        className="w-full resize-y rounded-lg border border-black/15 px-3 py-2 text-sm outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/50"
      />
      <div className="mt-2 flex items-center justify-between">
        <span className="text-xs opacity-40">⌘↩ 存入</span>
        <button
          onClick={submit}
          disabled={pending || text.trim().length === 0}
          className="rounded-lg bg-foreground px-4 py-1.5 text-sm text-background disabled:opacity-30"
        >
          {pending ? '…' : '存入'}
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
