import { NextResponse } from 'next/server';
import { z } from 'zod';
import { PhoneNumber } from '@/core/domain/contact';
import { lastMessageOf } from '@/core/domain/conversation';
import { can } from '@/core/domain/user';
import { container } from '@/infrastructure/container';

export const dynamic = 'force-dynamic';

const MAX_PER_GROUP = 5;

export interface SearchHit {
  readonly id: string;
  readonly kind: 'conversa' | 'contato';
  readonly title: string;
  readonly subtitle: string;
  readonly href: string;
}

const querySchema = z.object({ q: z.string().trim().min(2).max(64) });

const matches = (term: string, ...fields: readonly (string | undefined)[]): boolean =>
  fields.some((field) => field?.toLowerCase().includes(term));

/**
 * Busca global da topbar.
 *
 * Roda no servidor e filtra por `accountId` como qualquer outro acesso a
 * repositorio — a busca nao pode virar uma porta lateral para dados de outro
 * tenant. O RBAC tambem vale: quem nao le contatos nao encontra contatos.
 */
export async function GET(request: Request) {
  const parsed = querySchema.safeParse({
    q: new URL(request.url).searchParams.get('q') ?? '',
  });
  if (!parsed.success) {
    return NextResponse.json({ ok: true, hits: [] as SearchHit[] });
  }

  const term = parsed.data.q.toLowerCase();
  // Rota de API responde 401, nao redireciona: quem chama e o `fetch` da
  // paleta de comandos, que nao sabe interpretar uma pagina de login.
  const session = await container.session.getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: 'Nao autenticado' }, { status: 401 });
  }
  const hits: SearchHit[] = [];

  if (can(session, 'conversas:ler')) {
    const conversations = await container.conversations.list(
      session.account.id,
      session.user.id,
      { scope: 'todas' },
    );

    for (const conversation of conversations) {
      if (hits.length >= MAX_PER_GROUP) break;
      const last = lastMessageOf(conversation);
      const lastText = last?.content.type === 'text' ? last.content.text : undefined;
      if (!matches(term, conversation.contact.name, conversation.contact.phone, lastText)) continue;

      hits.push({
        id: conversation.id,
        kind: 'conversa',
        title: conversation.contact.name,
        subtitle: conversation.lastMessagePreview,
        href: `/conversas/${conversation.id}`,
      });
    }
  }

  if (can(session, 'contatos:ler')) {
    const contacts = await container.contacts.list(session.account.id, {});
    let added = 0;

    for (const contact of contacts) {
      if (added >= MAX_PER_GROUP) break;
      if (!matches(term, contact.name, contact.phone, contact.email, contact.company)) continue;

      hits.push({
        id: contact.id,
        kind: 'contato',
        title: contact.name,
        subtitle: contact.company ?? PhoneNumber.format(contact.phone) ?? '',
        href: `/contatos/${contact.id}`,
      });
      added += 1;
    }
  }

  return NextResponse.json({ ok: true, hits });
}
