/**
 * Regras de upload de imagem — puras, sem I/O, compartilhadas entre o
 * servidor que grava e a rota que serve.
 *
 * Duas famílias, com regras deliberadamente diferentes: a foto de perfil de
 * uma pessoa e o logotipo da conta. Não são o mesmo tipo de arquivo — um
 * logotipo precisa de fundo transparente, uma foto de perfil não — e por isso
 * não compartilham a lista de formatos aceitos.
 */

/** Tipos aceitos para foto de perfil — os que todo navegador desenha sem plugin. */
export const ALLOWED_AVATAR_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
] as const;

export type AllowedAvatarMimeType = (typeof ALLOWED_AVATAR_MIME_TYPES)[number];

export const isAllowedAvatarMimeType = (mime: string): mime is AllowedAvatarMimeType =>
  (ALLOWED_AVATAR_MIME_TYPES as readonly string[]).includes(mime);

/** 5 MB cobre qualquer foto de celular comprimida; acima disso é o arquivo errado. */
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

/**
 * Tipos aceitos para o logotipo da conta.
 *
 * Sem `image/svg+xml`, embora seja o formato natural para um logo — e a tela
 * antiga chegou a anunciar "PNG ou SVG" no texto de ajuda, agora corrigido.
 * SVG é XML, e pode carregar `<script>` embutido: um `<img>` normal não o
 * executa, mas navegar direto para a URL do arquivo executaria, na origem da
 * própria aplicação — a mesma classe de risco que `/api/whatsapp/media/[id]`
 * já trata (ver o comentário `RENDERABLE` naquela rota). Sem editor de imagem
 * no servidor para neutralizar o SVG, a resposta mais simples é não aceitá-lo.
 * PNG e WEBP cobrem transparência sem esse risco.
 */
export const ALLOWED_LOGO_MIME_TYPES = ['image/png', 'image/webp'] as const;

export type AllowedLogoMimeType = (typeof ALLOWED_LOGO_MIME_TYPES)[number];

export const isAllowedLogoMimeType = (mime: string): mime is AllowedLogoMimeType =>
  (ALLOWED_LOGO_MIME_TYPES as readonly string[]).includes(mime);

/** Um logotipo é um ícone, não uma foto — 2 MB já é generoso. */
export const MAX_LOGO_BYTES = 2 * 1024 * 1024;

/**
 * As URLs guardam o tipo do arquivo e uma versão — não há coluna separada
 * para eles no banco.
 *
 * `t` é o `Content-Type` que a rota deve devolver. Ele nunca é confiado às
 * cegas na leitura — é revalidado contra a lista de tipos aceitos, porque é
 * parte da URL e qualquer um pode editá-la.
 *
 * `v` muda a cada envio para que o navegador nunca sirva, do próprio cache,
 * uma imagem que a pessoa acabou de trocar. Sem ele, o `<img>` continuaria
 * apontando para o mesmo endereço de sempre — o objeto no bucket teria
 * mudado, mas nem o React reagiria (a prop `src` não muda) nem o navegador
 * pediria de novo (o endereço é o mesmo que ele já tem em cache). Trocar a
 * imagem pareceria não ter feito nada.
 */
export const buildAvatarUrl = (userId: string, mimeType: string): string =>
  `/api/users/${userId}/avatar?t=${encodeURIComponent(mimeType)}&v=${Date.now()}`;

export const buildLogoUrl = (accountId: string, mimeType: string): string =>
  `/api/accounts/${accountId}/logo?t=${encodeURIComponent(mimeType)}&v=${Date.now()}`;
