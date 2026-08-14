import { NextResponse } from 'next/server';
import { setModel } from '@/db/settings';
import { isValidModel, isValidPurpose } from '@/lib/models';

/**
 * 改某条 AI 路径用的模型。`PUT /api/settings/models` body `{ purpose, model }`
 *
 * 🔴 **两个字段都要在白名单里才写。** 放一个不存在的 model id 进去，
 * 下一次 AI 调用就会直接 500 —— 而且是在你（jimmy）点「处理」的时候才炸，
 * 离改设置已经隔了很远，很难联想到是这儿的问题。挡在入口最省事。
 */
export const dynamic = 'force-dynamic';

export async function PUT(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    purpose?: unknown;
    model?: unknown;
  } | null;

  if (!isValidPurpose(body?.purpose)) {
    return NextResponse.json({ error: 'purpose 不认识' }, { status: 400 });
  }
  if (!isValidModel(body?.model)) {
    return NextResponse.json({ error: '这个模型不在可选列表里' }, { status: 400 });
  }

  await setModel(body.purpose, body.model);
  return NextResponse.json({ ok: true, purpose: body.purpose, model: body.model });
}
