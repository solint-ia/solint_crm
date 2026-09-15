import { NextResponse } from 'next/server';
import { sessionFromApiToken } from '@/infrastructure/auth/api-token';
import { container } from '@/infrastructure/container';
import {
  contentDispositionFor,
  RENDERABLE_MEDIA,
  respondWithMedia,
} from '@/infrastructure/whatsapp/media-response';
import { isSafeMediaId, mediaStore } from '@/infrastructure/whatsapp/wa-media-store';

export const dynamic = 'force-dynamic';

/** Fotos de perfil são regravadas periodicamente; midia de mensagem e imutavel. */
const cacheControlFor = (id: string): string =>
  id.startsWith('pp-')
    ? 'private, max-age=3600, must-revalidate'
    : 'private, max-age=31536000, immutable';

/**
 * Serve a midia do WhatsApp ja decifrada.
 *
 * O conteúdo pertence a uma conversa da conta, entao a rota exige sessão —
 * hoje a sessão de demonstracao e estatica, mas o ponto de verificacao precisa
 * existir para não virar um diretorio público quando a autenticacao real entrar.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isSafeMediaId(id)) {
    return NextResponse.json({ ok: false, error: 'Mídia inválida' }, { status: 400 });
  }

  // Conteudo de conversa de cliente: sem sessao, nao sai.
  //
  // Duas portas, e as duas provam a mesma coisa — a qual conta o requisitante
  // pertence. O cookie atende o navegador; o `Bearer` atende quem nao e
  // navegador. Sem a segunda, um fluxo de automacao que precise transcrever um
  // audio ou ler uma imagem recebida simplesmente nao tinha como baixar os
  // bytes: HTTP servidor-a-servidor nao carrega cookie de sessao.
  const cookieSession = await container.session.getSession();
  const session = cookieSession ?? (await sessionFromApiToken(request));
  if (!session) {
    return NextResponse.json({ ok: false, error: 'Não autenticado' }, { status: 401 });
  }

  // Navegadores ganham uma URL por conteúdo, e portanto um único item de
  // cache mesmo quando a figurinha aparece em dez mensagens. Integrações por
  // token continuam recebendo bytes aqui: alguns clientes descartam o
  // `Authorization` quando seguem redirecionamentos.
  if (cookieSession && !id.startsWith('pp-')) {
    const resolved = await mediaStore.resolveBlob(id, session.account.id);
    if (resolved && RENDERABLE_MEDIA.test(resolved.mimeType)) {
      return new Response(null, {
        status: 302,
        headers: {
          Location: `/api/whatsapp/media/b/${resolved.blobId}`,
          'Cache-Control': 'private, max-age=31536000, immutable',
        },
      });
    }
  }

  // Sessão válida diz *quem* é, não *de quem é o arquivo*. Sem o escopo abaixo,
  // qualquer pessoa autenticada — de qualquer empresa — baixava a mídia de
  // qualquer outra sabendo o id, que é o id da mensagem no WhatsApp. Mídia de
  // conta alheia responde 404: existir ou não é informação que também não lhe
  // pertence.
  const media = await mediaStore.read(id, { accountId: session.account.id });
  if (!media) {
    return NextResponse.json({ ok: false, error: 'Mídia não encontrada' }, { status: 404 });
  }

  // O fluxo vem do depósito: do cache em disco quando ele tem os bytes, da
  // memória quando vieram do Storage. Esta rota roda numa função serverless,
  // onde o cache nunca pode ser gravado — abrir o arquivo aqui era o que fazia
  // toda mídia responder `404` em produção.
  return respondWithMedia(request, media, {
    'Content-Type': media.mimeType,
    'Cache-Control': cacheControlFor(id),
    'Content-Disposition': contentDispositionFor(media.mimeType, media.fileName),
    'X-Content-Type-Options': 'nosniff',
  });
}
