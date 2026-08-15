import { NextResponse } from 'next/server';
import { setModel } from '@/db/settings';
import { isValidModel, isValidPurpose } from '@/lib/models';

/**
 * Change which model one AI path uses. `PUT /api/settings/models` body `{ purpose, model }`
 *
 * 🔴 **Both fields must be on the allow-list before anything is written.** Store a model id
 * that doesn't exist and the next AI call 500s outright — and it blows up when jimmy presses
 * Process, long after the setting was changed, which makes it hard to connect back to here.
 * Blocking it at the entrance is far cheaper.
 */
export const dynamic = 'force-dynamic';

export async function PUT(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    purpose?: unknown;
    model?: unknown;
  } | null;

  if (!isValidPurpose(body?.purpose)) {
    return NextResponse.json({ error: 'Unknown purpose' }, { status: 400 });
  }
  if (!isValidModel(body?.model)) {
    return NextResponse.json({ error: 'That model is not in the allowed list' }, { status: 400 });
  }

  await setModel(body.purpose, body.model);
  return NextResponse.json({ ok: true, purpose: body.purpose, model: body.model });
}
