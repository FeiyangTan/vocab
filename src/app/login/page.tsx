'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

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
        <h1 className="text-center font-serif text-3xl font-medium tracking-tight">vocab</h1>
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          autoComplete="current-password"
          placeholder="密码"
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" className="w-full" disabled={pending || password.length === 0}>
          {pending ? '…' : '进入'}
        </Button>
      </form>
    </main>
  );
}
