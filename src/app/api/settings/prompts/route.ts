import { NextResponse } from 'next/server';
import { setPrompt } from '@/db/settings';
import { isValidPurpose } from '@/lib/models';
import { DEFAULT_PROMPT, validatePrompt } from '@/lib/prompts';

/**
 * Change one AI path's system prompt.
 * `PUT /api/settings/prompts` body `{ purpose, prompt }`
 *
 * `prompt: null` = **reset to default** (deletes the row rather than writing the default text
 * back — see `setPrompt`).
 *
 * 🔴 **Empty strings are blocked here.** Passing an empty system prompt to the API doesn't
 * error; the model simply improvises with no instructions at all, and what comes back looks
 * plausible while the fields don't line up — which you only discover at the review page. The
 * way back to factory settings is "Reset to default", not clearing the box.
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
