import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/infrastructure/db/prisma';
import {
  createCloudTemplate,
  syncCloudTemplates,
} from '@/infrastructure/whatsapp/cloud/cloud-onboarding';
import { cloudErrorResponse, guardCloudRoute } from '../_shared/guard';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ inboxId: string }> };

/** Templates da WABA desta caixa, como estão no CRM. */
export async function GET(_request: Request, props: Params) {
  const { inboxId } = await props.params;
  const ctx = await guardCloudRoute(inboxId);
  if (ctx instanceof NextResponse) return ctx;

  const conexao = await prisma.whatsAppCloudConnection.findFirst({
    where: { inboxId, accountId: ctx.session.account.id },
    select: { wabaId: true },
  });
  if (!conexao) return NextResponse.json({ ok: true, templates: [] });

  const templates = await prisma.messageTemplate.findMany({
    where: { accountId: ctx.session.account.id, wabaId: conexao.wabaId },
    select: {
      id: true,
      name: true,
      language: true,
      category: true,
      status: true,
      body: true,
      rejectedReason: true,
    },
    orderBy: [{ name: 'asc' }, { language: 'asc' }],
  });
  return NextResponse.json({ ok: true, templates });
}

const createSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(512)
    .regex(/^[a-z0-9_]+$/, 'Use só letras minúsculas, números e sublinhado.'),
  category: z.enum(['MARKETING', 'UTILITY', 'AUTHENTICATION']),
  language: z.string().trim().min(2).max(10),
  body: z.string().trim().min(1).max(1024),
  examples: z.array(z.string().trim().max(200)).max(20).default([]),
});

/** `?acao=sincronizar` traz da Meta; sem ação, cria um template novo lá. */
export async function POST(request: Request, props: Params) {
  const { inboxId } = await props.params;
  const ctx = await guardCloudRoute(inboxId);
  if (ctx instanceof NextResponse) return ctx;

  try {
    if (new URL(request.url).searchParams.get('acao') === 'sincronizar') {
      return NextResponse.json({
        ok: true,
        ...(await syncCloudTemplates(ctx.session.account.id, inboxId)),
      });
    }
    const parsed = createSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.issues[0]?.message ?? 'Template inválido.' },
        { status: 400 },
      );
    }
    return NextResponse.json({
      ok: true,
      ...(await createCloudTemplate(ctx.session.account.id, inboxId, parsed.data)),
    });
  } catch (error) {
    return cloudErrorResponse(error, 'Falha ao tratar os templates');
  }
}
