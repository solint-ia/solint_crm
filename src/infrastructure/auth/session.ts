import { randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
import { cache } from 'react';
import type {
  Account,
  InboxAccess,
  Permission,
  PermissionOverrides,
  Role,
  Session,
} from '@/core/domain/user';
import type { ActiveSession, CompanyProfile } from '@/core/domain/settings';
import type { Prisma } from '@/generated/prisma';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  effectivePermissions,
  SUPERADMIN_PERMISSIONS,
  type NotificationPreferences,
} from '@/core/domain/user';
import { prisma, readJson } from '@/infrastructure/db/prisma';
import { userRow } from '@/infrastructure/repositories/prisma/mappers';
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  signSessionToken,
  verifySessionToken,
  type SessionClaims,
} from './tokens';

const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/',
  // Em HTTP local o cookie `secure` simplesmente não é enviado, e o login
  // pareceria funcionar sem nunca autenticar.
  secure: process.env.NODE_ENV === 'production',
  maxAge: SESSION_TTL_SECONDS,
};

/**
 * Abre uma sessão: grava a linha de revogação, assina o token e põe o cookie.
 *
 * A linha em `AuthSession` é o que torna "sair de todas as sessões" possível.
 * Um JWT sozinho é irrevogável até expirar — quem quiser derrubar um acesso
 * roubado precisa de um registro para invalidar.
 */
export const createSession = async (
  userId: string,
  accountId: string,
  meta?: { readonly userAgent?: string; readonly ip?: string },
): Promise<void> => {
  const tokenId = randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);

  await prisma.authSession.create({
    data: {
      userId,
      tokenId,
      expiresAt,
      userAgent: meta?.userAgent?.slice(0, 300) ?? null,
      ip: meta?.ip?.slice(0, 60) ?? null,
    },
  });

  const token = await signSessionToken({ sub: userId, act: accountId, jti: tokenId });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, cookieOptions);
};

/**
 * Reassina o cookie apontando para outra conta, **sem** abrir sessão nova.
 *
 * É assim que trocar de workspace funciona. O `act` do token é o tenant de toda
 * requisição, e ele é assinado — trocar a conta ativa por um cookie separado,
 * não assinado, daria a qualquer um acesso a qualquer conta editando o
 * navegador. Reassinar é a única forma de mudar o tenant sem abrir esse buraco.
 *
 * O `jti` é **o mesmo de propósito**. `AuthSession` é do usuário, não da conta
 * (a tabela só tem `userId`): emitir um `jti` novo a cada troca encheria a lista
 * de "sessões ativas" de linhas que são o mesmo navegador, e faria "encerrar
 * esta sessão" derrubar só um workspace. Mantendo o `jti`, a revogação continua
 * valendo para o acesso da pessoa, que é o que ela significa.
 *
 * Quem chama é responsável por já ter conferido o vínculo com a conta de
 * destino — esta função assina o que mandarem.
 */
export const reissueSessionToken = async (
  userId: string,
  tokenId: string,
  accountId: string,
): Promise<void> => {
  const token = await signSessionToken({ sub: userId, act: accountId, jti: tokenId });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, cookieOptions);
};

/**
 * Põe o superadministrador dentro de uma conta, ou o traz de volta.
 *
 * `accountId` nomeia a conta a operar; `null` encerra a atuação e devolve a
 * sessão ao estado comum, que para quem administra a plataforma é uma sessão
 * sem conta nenhuma — ele volta para `/plataforma`.
 *
 * **A autorização é conferida aqui, não em quem chama.** Reassinar o cookie é
 * exatamente o poder que esta fase concede, e deixar a checagem do lado de fora
 * significaria que qualquer caminho novo até esta função precisaria lembrar de
 * repeti-la. O `jti` é preservado pelo mesmo motivo de `reissueSessionToken`: é
 * o mesmo navegador, e a revogação continua valendo para o acesso da pessoa.
 *
 * Devolve `false` sem tocar no cookie quando não há sessão, o token não vale, ou
 * o usuário não é (ou deixou de ser) superadministrador.
 */
export const setPlatformActuation = async (accountId: string | null): Promise<boolean> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return false;

  const claims = await verifySessionToken(token);
  if (!claims) return false;

  const user = await prisma.user.findUnique({
    where: { id: claims.sub },
    select: { isSuperAdmin: true },
  });
  if (!user?.isSuperAdmin) return false;

  const novo = await signSessionToken({
    sub: claims.sub,
    jti: claims.jti,
    act: accountId ?? '',
    ...(accountId ? { sa: true as const } : {}),
  });
  jar.set(SESSION_COOKIE, novo, cookieOptions);
  return true;
};

/** Encerra a sessão atual: revoga no banco e apaga o cookie. */
export const destroyCurrentSession = async (): Promise<void> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;

  if (token) {
    const claims = await verifySessionToken(token);
    if (claims) {
      await prisma.authSession.updateMany({
        where: { tokenId: claims.jti, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
  }

  jar.delete(SESSION_COOKIE);
};

/** Derruba todos os acessos do usuário, inclusive o atual. */
export const revokeAllSessions = async (userId: string): Promise<number> => {
  const { count } = await prisma.authSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return count;
};

const deviceLabel = (userAgent: string | null): string => {
  if (!userAgent) return 'Dispositivo desconhecido';
  const browser = userAgent.includes('Edg/')
    ? 'Edge'
    : userAgent.includes('Firefox/')
      ? 'Firefox'
      : userAgent.includes('Chrome/')
        ? 'Chrome'
        : userAgent.includes('Safari/')
          ? 'Safari'
          : 'Navegador';
  const system = userAgent.includes('Windows')
    ? 'Windows'
    : userAgent.includes('Android')
      ? 'Android'
      : userAgent.includes('iPhone') || userAgent.includes('iPad')
        ? 'iOS'
        : userAgent.includes('Mac OS')
          ? 'macOS'
          : userAgent.includes('Linux')
            ? 'Linux'
            : 'Sistema desconhecido';
  return `${browser} · ${system}`;
};

export const listActiveSessions = async (
  userId: string,
  currentTokenId: string,
): Promise<readonly ActiveSession[]> => {
  const rows = await prisma.authSession.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map((row) => ({
    id: row.tokenId,
    device: deviceLabel(row.userAgent),
    location: row.ip ?? 'Localização indisponível',
    lastActive: row.createdAt.toLocaleString('pt-BR'),
    current: row.tokenId === currentTokenId,
  }));
};

export const revokeSession = async (
  userId: string,
  tokenId: string,
  currentTokenId: string,
): Promise<boolean> => {
  if (tokenId === currentTokenId) return false;
  const result = await prisma.authSession.updateMany({
    where: { userId, tokenId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count === 1;
};

export const revokeOtherSessions = async (
  userId: string,
  currentTokenId: string,
): Promise<number> => {
  const result = await prisma.authSession.updateMany({
    where: { userId, tokenId: { not: currentTokenId }, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
};

const toDomainAccount = (row: {
  id: string;
  name: string;
  plan: string;
  document: string | null;
  settings?: { company: Prisma.JsonValue } | null;
}): Account => {
  // A marca vive dentro do JSON de configurações; aqui ela é achatada para os
  // dois campos que o domínio expõe. Ver a nota em `Account`.
  const company = readJson<CompanyProfile>(row.settings?.company, {});

  return {
    id: row.id,
    name: row.name,
    plan: row.plan as Account['plan'],
    ...(row.document ? { document: row.document } : {}),
    ...(company.logoUrl ? { logoUrl: company.logoUrl } : {}),
    ...(company.brandColor ? { brandColor: company.brandColor } : {}),
  };
};

/**
 * Resolve a sessão a partir do cookie.
 *
 * Três checagens, nesta ordem: assinatura válida, registro não revogado nem
 * expirado, usuário ainda existente. A segunda é a que o middleware não
 * consegue fazer — ele roda no Edge, sem banco.
 *
 * Devolve `null` em vez de lançar: quem chama decide se redireciona (páginas)
 * ou responde 401 (rotas de API).
 *
 * Memorizado por requisição com `cache()`. Uma única tela resolve a sessão
 * várias vezes — o layout, a página e cada Server Action disparada por ela — e
 * com o banco a ~130ms de distância isso custava mais do que o trabalho que a
 * requisição vinha fazer. O `cache()` do React vive no escopo da requisição:
 * duas requisições nunca compartilham sessão, e uma revogação passa a valer na
 * requisição seguinte.
 *
 * Dentro da função, o que não depende de nada vai junto (ver abaixo): eram
 * quatro idas ao banco em série, hoje são duas.
 */
/**
 * A sessão do superadministrador operando dentro de uma conta.
 *
 * O caminho comum de `readSession()` exige `Membership` e devolve `null` sem
 * ele. Quem administra a plataforma não é membro de conta nenhuma, e criar um
 * vínculo de mentira para ele resolveria o problema sujando o dado do
 * inquilino: apareceria na lista de membros do cliente, viraria destinatário de
 * atribuição e entraria na contagem de assentos do plano.
 *
 * **Três guardas, e as três precisam passar.** A sessão não pode estar revogada
 * nem expirada; o usuário precisa existir e ainda ter `isSuperAdmin`; e a conta
 * alvo precisa existir. Reler a marca aqui, e não confiar no token, é o que faz
 * a revogação valer no mesmo instante — desligar `isSuperAdmin` no banco
 * derruba a atuação na requisição seguinte.
 */
const platformSession = async (claims: SessionClaims): Promise<Session | null> => {
  const [authSession, user, account] = await Promise.all([
    prisma.authSession.findUnique({ where: { tokenId: claims.jti } }),
    prisma.user.findUnique({ where: { id: claims.sub } }),
    // tenant-ok: a atuação de plataforma escolhe a conta de propósito — é
    // exatamente o que ela existe para fazer. Quem pode escolher é decidido
    // logo abaixo, por `isSuperAdmin`. Ver REGRAS-GLOBAIS.md §4.4.
    prisma.account.findUnique({
      where: { id: claims.act },
      include: { settings: { select: { company: true } } },
    }),
  ]);

  if (!authSession || authSession.revokedAt || authSession.expiresAt.getTime() < Date.now()) {
    return null;
  }
  if (!user?.isSuperAdmin || !account) return null;
  // Nem a atuação de plataforma entra numa conta excluída. Suspensa ele entra:
  // suspender é medida administrativa dele, e ter de reativar a conta para
  // conferir por que a suspendeu inverteria o sentido da medida.
  if (account.status === 'excluida') return null;

  const domainAccount = toDomainAccount(account);

  return {
    tokenId: claims.jti,
    /**
     * O `User` do domínio exige `accountId` e `roleSlug`, que vêm do vínculo.
     * Sem vínculo, os dois são sintetizados: a conta é a que ele está operando,
     * e o papel é `administrador` porque é o que descreve o que ele pode fazer
     * ali — toda tela que decide por papel vai ler exatamente isso.
     */
    user: {
      id: user.id,
      accountId: domainAccount.id,
      name: user.name,
      email: user.email,
      roleSlug: 'administrador',
      avatarTone: user.avatarTone,
      ...(user.avatarUrl ? { avatarUrl: user.avatarUrl } : {}),
      availability: 'disponivel',
      teams: [],
      signatureEnabled: user.signatureEnabled,
      notifications: {
        ...DEFAULT_NOTIFICATION_PREFERENCES,
        ...readJson<Partial<NotificationPreferences>>(user.notificationPrefs, {}),
      },
      twoFactorEnabled: user.twoFactorEnabled,
      ...(user.signature ? { signature: user.signature } : {}),
      ...(user.lastActiveAt ? { lastActiveAt: user.lastActiveAt } : {}),
    },
    account: domainAccount,
    permissions: SUPERADMIN_PERMISSIONS,
    /**
     * Uma opção só no seletor, e não todas as contas do sistema.
     *
     * O seletor de workspace é do usuário comum e troca entre workspaces em que
     * ele atende. Enchê-lo com as contas de todos os clientes transformaria um
     * menu de duas linhas numa lista de centenas, e daria dois caminhos
     * diferentes para a mesma coisa. Quem administra a plataforma navega pelo
     * console, que é onde a escolha de conta tem contexto.
     */
    availableAccounts: [domainAccount],
    // A restrição por caixa é organizacional, e esta identidade está fora da
    // organização: não há equipe que a limite.
    inboxAccess: 'todas',
    platformActor: { id: user.id, name: user.name, email: user.email },
  };
};

export const readSession = cache(async (): Promise<Session | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const claims = await verifySessionToken(token);
  if (!claims) return null;

  // Dois caminhos, e só a reivindicação do token separa os dois. O de
  // plataforma dispensa o vínculo; o comum o exige. Ver `platformSession`.
  if (claims.sa) return platformSession(claims);

  // As três consultas partem do mesmo token e não dependem entre si: a linha de
  // revogação vem de `jti`, o vínculo de `sub`+`act`, e a lista de workspaces de
  // `sub`. Em série custavam três idas ao banco; juntas, uma. Só o papel precisa
  // esperar, porque a chave dele sai do vínculo.
  const [authSession, membership, all, teamsDaConta] = await Promise.all([
    prisma.authSession.findUnique({ where: { tokenId: claims.jti } }),
    prisma.membership.findUnique({
      where: { userId_accountId: { userId: claims.sub, accountId: claims.act } },
      // As configurações vêm junto por causa da marca da conta — logo e cor —,
      // que o seletor de workspace desenha. É um `LEFT JOIN` na mesma consulta
      // que já buscava a conta; pedi-las depois seria uma ida a mais ao banco
      // em todo carregamento de tela.
      include: { user: true, account: { include: { settings: { select: { company: true } } } } },
    }),
    // Todas as contas em que esta pessoa atende. É o que alimenta o seletor de
    // workspace — que até aqui devolvia `[account]` porque não havia como saber.
    // tenant-ok: deliberadamente entre contas — e a lista de workspaces da pessoa
    // que alimenta o seletor. Escopar por conta aqui devolveria sempre uma opcao.
    prisma.membership.findMany({
      // Só as ativas: uma conta suspensa no seletor é uma opção que, ao ser
      // escolhida, devolve a pessoa para o login sem explicação.
      where: { userId: claims.sub, account: { status: 'ativa' } },
      include: { account: { include: { settings: { select: { company: true } } } } },
      orderBy: { createdAt: 'asc' },
    }),
    // Equipes desta conta que têm caixa vinculada, com a informação de o
    // usuário pertencer a elas. Uma consulta só resolve as duas perguntas que
    // o acesso por caixa faz: "a conta organizou equipes?" e "de quais eu
    // participo?". Perguntá-las em separado custaria uma ida a mais ao banco em
    // todo carregamento de tela.
    prisma.team.findMany({
      where: { accountId: claims.act, teamInboxes: { some: {} } },
      select: {
        teamInboxes: { select: { inboxId: true } },
        teamMembers: { where: { userId: claims.sub }, select: { userId: true } },
      },
    }),
  ]);

  if (!authSession || authSession.revokedAt || authSession.expiresAt.getTime() < Date.now()) {
    return null;
  }

  // O `act` do token diz em que conta a sessão foi aberta; o vínculo é o que
  // autoriza. Sem ele a pessoa não atende mais naquele workspace, e o token
  // deixa de valer ali — mesmo com assinatura boa e sessão não revogada.
  if (!membership) return null;

  /**
   * Conta suspensa não resolve sessão.
   *
   * A checagem mora aqui porque este é o único ponto por onde toda requisição
   * do CRM passa — página, Server Action e rota de API. Espalhá-la pelas telas
   * significaria que a próxima rota criada nasceria sem ela, e suspender uma
   * conta deixaria de valer justamente para o caminho que ninguém lembrou.
   *
   * Vale na requisição seguinte à suspensão, sem depender de expirar cookie: o
   * `cache()` do React vive dentro de uma requisição só.
   */
  if (membership.account.status !== 'ativa') return null;

  const role: Role | null = await prisma.role
    .findUnique({
      where: { accountId_slug: { accountId: membership.accountId, slug: membership.roleSlug } },
    })
    .then((row) =>
      row
        ? {
            id: row.id,
            accountId: row.accountId,
            slug: row.slug,
            name: row.name,
            description: row.description,
            permissions: readJson<readonly Permission[]>(row.permissions, []),
            isSystem: row.isSystem,
          }
        : null,
    );

  // Sem papel cadastrado o usuário fica sem permissão nenhuma. É o padrão
  // seguro: um papel apagado não deve virar acesso irrestrito.
  //
  // A personalização individual entra aqui, e não na tela: é o único ponto por
  // onde toda requisição passa, então `can()` responde o efetivo desta pessoa
  // sem que nenhum componente precise saber que overrides existem.
  const permissions = effectivePermissions(
    role?.permissions ?? [],
    readJson<PermissionOverrides | null>(membership.permissionOverrides, null),
  );

  return {
    tokenId: claims.jti,
    user: userRow(membership.user, membership),
    account: toDomainAccount(membership.account),
    permissions,
    availableAccounts: all.map((row) => toDomainAccount(row.account)),
    inboxAccess: resolveInboxAccess(permissions, teamsDaConta),
  };
});

/** Quem administra a plataforma, sem passar por conta nenhuma. */
export interface SuperAdminUser {
  readonly id: string;
  readonly name: string;
  readonly email: string;
}

/**
 * Resolve o superadministrador a partir do mesmo cookie de login.
 *
 * Existe em separado de `readSession()` porque aquela função exige `Membership`
 * ativa na conta do token e devolve `null` sem ela — e quem administra a
 * integração de todas as contas normalmente não é membro de nenhuma. As duas
 * checagens de segurança que importam continuam idênticas: assinatura válida e
 * registro de sessão não revogado nem expirado.
 *
 * Devolve `null` para todo o resto (sem cookie, token inválido, sessão
 * revogada, usuário sem a flag) — quem chama decide entre redirecionar e
 * responder 401.
 */
export const readSuperAdmin = cache(async (): Promise<SuperAdminUser | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const claims = await verifySessionToken(token);
  if (!claims) return null;

  const [authSession, user] = await Promise.all([
    prisma.authSession.findUnique({ where: { tokenId: claims.jti } }),
    // tenant-ok: a área de plataforma é, por definição, fora de conta — a flag
    // é do usuário, e as consultas que ela autoriza continuam escopadas por
    // `accountId` uma a uma.
    prisma.user.findUnique({
      where: { id: claims.sub },
      select: { id: true, name: true, email: true, isSuperAdmin: true },
    }),
  ]);

  if (!authSession || authSession.revokedAt || authSession.expiresAt.getTime() < Date.now()) {
    return null;
  }
  if (!user?.isSuperAdmin) return null;

  return { id: user.id, name: user.name, email: user.email };
});

/**
 * Quais caixas esta pessoa alcança.
 *
 * Três caminhos, nesta ordem — e a ordem importa:
 *
 *  1. `caixas:todas` no papel: enxerga tudo. É o gestor, e é o que o impede de
 *     se trancar do lado de fora ao criar a primeira equipe.
 *  2. Conta sem nenhuma equipe com caixa vinculada: ninguém é restringido. É a
 *     trava que mantém funcionando quem usa o sistema com um número só — a
 *     restrição por caixa liga no dia em que o gestor a configura, não antes.
 *  3. Caso contrário: a união das caixas das equipes de que a pessoa participa.
 *     Quem não participa de nenhuma fica com a lista vazia e não vê conversa
 *     nenhuma — que é o correto, e é visível na tela como tal.
 */
const resolveInboxAccess = (
  permissions: readonly Permission[],
  teams: readonly {
    readonly teamInboxes: readonly { readonly inboxId: string }[];
    readonly teamMembers: readonly { readonly userId: string }[];
  }[],
): InboxAccess => {
  if (permissions.includes('caixas:todas')) return 'todas';
  if (teams.length === 0) return 'todas';

  const alcancadas = new Set<string>();
  for (const team of teams) {
    if (team.teamMembers.length === 0) continue;
    for (const link of team.teamInboxes) alcancadas.add(link.inboxId);
  }
  return [...alcancadas];
};

/** Marca a atividade do usuário. Falha em silêncio: é dado auxiliar. */
export const touchUser = async (userId: string): Promise<void> => {
  try {
    await prisma.user.update({ where: { id: userId }, data: { lastActiveAt: 'agora' } });
  } catch {
    // Não vale derrubar um login porque o carimbo de atividade não gravou.
  }
};
