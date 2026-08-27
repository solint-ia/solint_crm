import { createHash } from 'node:crypto';

import { PERMISSIONS, type Permission, type Session } from '@/core/domain/user';
import { prisma, readJson } from '@/infrastructure/db/prisma';

/**
 * Autenticação por token de API — a porta de entrada de quem não é navegador.
 *
 * **Por que existe.** A sessão do CRM mora num cookie assinado, e cookie
 * pressupõe navegador. Um fluxo do n8n fala HTTP servidor-a-servidor: não tem
 * cookie, não tem redirecionamento de login, não tem como se autenticar em
 * nenhuma rota que exista hoje. A tabela `ApiToken` e a tela que gera os
 * tokens já existiam — faltava alguém aceitá-los.
 *
 * **O token vale por uma conta, nunca por uma pessoa.** Ele nasce de um
 * cadastro no workspace, então a sessão sintética que ele produz carrega a
 * conta de verdade e um usuário que descreve o próprio token. Isso importa na
 * timeline: uma mensagem enviada por automação aparece assinada com o nome do
 * token ("Automação n8n"), e não fingindo ser uma pessoa da equipe.
 */

/** Prefixo obrigatório — o mesmo que `createApiToken` grava. */
const PREFIXO = 'sk_live_';

/**
 * Sessão sintética montada a partir do token.
 *
 * O `user.id` não é chave estrangeira em lugar nenhum: `appendMessage` só grava
 * `authorName`. Prefixar com `api-token:` deixa isso explícito em qualquer log
 * ou consulta futura, em vez de parecer um id de usuário que sumiu.
 */
const sessaoDoToken = (
  token: { id: string; name: string; permissions: unknown },
  account: { id: string; name: string; plan: string; document: string | null },
): Session => {
  const declaradas = readJson<readonly string[]>(token.permissions as never, []);

  // `['*']` é o padrão de `createApiToken` e significa "tudo que a conta pode".
  // Expandir aqui, e não guardar a lista inteira no banco, mantém o token
  // válido quando uma permissão nova for adicionada ao produto.
  const permissions: readonly Permission[] = declaradas.includes('*')
    ? PERMISSIONS
    : PERMISSIONS.filter((p) => declaradas.includes(p));

  return {
    user: {
      id: `api-token:${token.id}`,
      accountId: account.id,
      name: token.name,
      email: '',
      roleSlug: 'administrador',
      avatarTone: 'slate',
      availability: 'disponivel',
      teams: [],
      twoFactorEnabled: false,
    },
    account: {
      id: account.id,
      name: account.name,
      plan: account.plan as Session['account']['plan'],
      ...(account.document ? { document: account.document } : {}),
    },
    permissions,
    // Um token pertence à conta, não a uma equipe: restringir por caixa aqui
    // faria a automação enxergar menos do que a conta que a cadastrou.
    inboxAccess: 'todas',
    // O seletor de workspace é coisa de tela; um token nunca troca de conta.
    availableAccounts: [],
  };
};

/**
 * Lê o `Authorization: Bearer` e devolve a sessão que ele representa.
 *
 * `null` para qualquer falha — ausente, malformado, inexistente ou expirado.
 * Quem chama responde 401 sem distinguir os casos: dizer *qual* deles falhou
 * ajudaria mais quem está adivinhando tokens do que quem tem um válido.
 */
export const sessionFromApiToken = async (request: Request): Promise<Session | null> => {
  const header = request.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) return null;

  const raw = header.slice('Bearer '.length).trim();
  if (!raw.startsWith(PREFIXO)) return null;

  // O banco guarda o SHA-256, nunca o segredo. A busca é pelo hash — é por isso
  // que um token perdido não pode ser recuperado, só substituído.
  const tokenHash = createHash('sha256').update(raw).digest('hex');

  // tenant-ok: a conta e o resultado desta busca, nao um filtro dela. O token e
  // global por construcao — e o hash que diz a qual conta ele pertence, e e
  // dessa linha que sai o `accountId` de tudo o que vier depois.
  const token = await prisma.apiToken.findUnique({
    where: { tokenHash },
    include: { account: true },
  });
  if (!token) return null;

  if (token.expiresAt && token.expiresAt.getTime() < Date.now()) return null;

  // Fora do await: saber quando o token foi usado pela última vez é diagnóstico,
  // e não vale atrasar a resposta nem derrubá-la se a escrita falhar.
  void prisma.apiToken
    .update({ where: { id: token.id }, data: { lastUsedAt: new Date() } })
    .catch(() => undefined);

  return sessaoDoToken(token, token.account);
};
