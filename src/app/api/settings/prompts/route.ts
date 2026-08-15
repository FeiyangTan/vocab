import { NextResponse } from 'next/server';
import { setPrompt } from '@/db/settings';
import { isValidPurpose } from '@/lib/models';
import { DEFAULT_PROMPT, validatePrompt } from '@/lib/prompts';

/**
 * 改某条 AI 路径的 system prompt。
 * `PUT /api/settings/prompts` body `{ purpose, prompt }`
 *
 * `prompt: null` = **恢复默认**（删掉库里那一行，不是写回默认文本，见 `setPrompt`）。
 *
 * 🔴 **空字符串挡在这里。** 传空的 system 给 API 不会报错，模型只是在没有任何
 * 指令的情况下自由发挥 —— 整理出来的东西看着像那么回事、字段却对不上，
 * 要等到审核页才发现。想回出厂设置有「恢复默认」，不是清空。
 */
export const dynamic = 'force-dynamic';

export async function PUT(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    purpose?: unknown;
    prompt?: unknown;
  } | null;

  if (!isValidPurpose(body?.purpose)) {
    return NextResponse.json({ error: 'Unknown purpose' }, { status: 400 });
  }

  if (body.prompt === null) {
    await setPrompt(body.purpose, null);
    return NextResponse.json({
      ok: true,
      purpose: body.purpose,
      prompt: DEFAULT_PROMPT[body.purpose],
      customized: false,
    });
  }

  const invalid = validatePrompt(body.prompt);
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

  const prompt = body.prompt as string;
  await setPrompt(body.purpose, prompt);
  return NextResponse.json({ ok: true, purpose: body.purpose, prompt, customized: true });
}
