'use client';

import { useState } from 'react';

export default function LoginPage() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError('');

    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });

    if (response.ok) {
      // proxy 重定向过来时带了 ?next=，登录后回到原来想去的页面
      const next = new URLSearchParams(window.location.search).get('next');
      window.location.replace(next?.startsWith('/') ? next : '/');
      return;
    }

    const data = (await response.json().catch(() => ({}))) as { error?: string };
    setError(data.error ?? '登录失败');
    setPending(false);
  }

  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <form onSubmit={handleSubmit} className="w-full max-w-xs space-y-4">
        <h1 className="text-lg font-medium">vocab</h1>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          autoComplete="current-password"
          placeholder="密码"
          className="w-full rounded-lg border border-black/15 px-3 py-2 text-base outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/50"
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={pending || password.length === 0}
          className="w-full rounded-lg bg-foreground px-3 py-2 text-background disabled:opacity-40"
        >
          {pending ? '…' : '进入'}
        </button>
      </form>
    </main>
  );
}
