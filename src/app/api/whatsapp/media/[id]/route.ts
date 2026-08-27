import { NextResponse } from 'next/server';
import { container } from '@/infrastructure/container';
import { isSafeMediaId, mediaStore } from '@/infrastructure/whatsapp/wa-media-store';

export const dynamic = 'force-dynamic';

/** Fotos de perfil são regravadas periodicamente; midia de mensagem e imutavel. */
const cacheControlFor = (id: string): string =>
  id.startsWith('pp-')
    ? 'private, max-age=3600, must-revalidate'
    : 'private, max-age=31536000, immutable';

/**
 * So imagem, video e áudio podem ser renderizados na propria origem.
 * Um "documento" recebido pode ser um HTML: exibi-lo inline o faria executar
 * no contexto da aplicacao. Qualquer outro tipo e forcado a virar download.
 */
const RENDERABLE = /^(image|video|audio)\//;

const dispositionFor = (mimeType: string, fileName?: string): string => {
  const mode = RENDERABLE.test(mimeType) ? 'inline' : 'attachment';
  return fileName ? `${mode}; filename*=UTF-8''${encodeURIComponent(fileName)}` : mode;
};

/**
 * Serve a midia do WhatsApp ja decifrada.
 *
 * O conteúdo pertence a uma conversa da conta, entao a rota exige sessão —
 * hoje a sessão de demonstracao e estatica, mas o ponto de verificacao precisa
 * existir para não virar um diretorio público quando a autenticacao real entrar.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isSafeMediaId(id)) {
    return NextResponse.json({ ok: false, error: 'Mídia inválida' }, { status: 400 });
  }

  // Conteudo de conversa de cliente: sem sessao, nao sai.
  const session = await container.session.getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: 'Não autenticado' }, { status: 401 });
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
  return new Response(media.stream(), {
    headers: {
      'Content-Type': media.mimeType,
      'Content-Length': String(media.size),
      'Cache-Control': cacheControlFor(id),
      'Content-Disposition': dispositionFor(media.mimeType, media.fileName),
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
