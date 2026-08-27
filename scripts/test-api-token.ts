/**
 * Teste da autenticação por token de API.
 *
 * Cria um token real pela mesma função que a tela usa, e confere que a sessão
 * sintética sai com a conta certa, as permissões certas, e que token inválido,
 * expirado ou mal formado não abre porta nenhuma.
 */
import { prisma } from '../src/infrastructure/db/prisma';
import { sessionFromApiToken } from '../src/infrastructure/auth/api-token';
import { container } from '../src/infrastructure/container';

const falhas: string[] = [];
const check = (label: string, ok: boolean, detalhe = '') => {
  console.log(`  ${ok ? 'OK  ' : 'FALHA'} ${label}${detalhe ? ` — ${detalhe}` : ''}`);
  if (!ok) falhas.push(label);
};

const req = (auth?: string): Request =>
  new Request('https://exemplo.test/api/v1/mensagens', {
    method: 'POST',
    ...(auth ? { headers: { authorization: auth } } : {}),
  });

async function main() {
  const account = await prisma.account.findFirst({ select: { id: true, name: true } });
  if (!account) throw new Error('Nenhuma conta no banco.');

  console.log('\n1) Token válido abre sessão da conta certa');
  const criado = await container.settings.createApiToken(account.id, {
    name: 'Teste automatizado n8n',
  });
  const segredo = criado.rawSecret;

  try {
    const sessao = await sessionFromApiToken(req(`Bearer ${segredo}`));
    check('sessão criada', Boolean(sessao));
    check('conta correta', sessao?.account.id === account.id, sessao?.account.id ?? '-');
    check('nome do token vira autor', sessao?.user.name === 'Teste automatizado n8n');
    check('id de usuário é marcado como token', sessao?.user.id.startsWith('api-token:') === true);
    check('alcança todas as caixas', sessao?.inboxAccess === 'todas');
    check(
      'permissão de responder concedida',
      sessao?.permissions.includes('conversas:responder') === true,
    );

    console.log('\n2) Entradas inválidas não abrem porta');
    check('sem cabeçalho', (await sessionFromApiToken(req())) === null);
    check('esquema errado', (await sessionFromApiToken(req(`Basic ${segredo}`))) === null);
    check('prefixo errado', (await sessionFromApiToken(req('Bearer abc123'))) === null);
    check(
      'token inexistente',
      (await sessionFromApiToken(req('Bearer sk_live_naoexisteesse'))) === null,
    );

    console.log('\n3) Token expirado é recusado');
    await prisma.apiToken.update({
      where: { id: criado.token.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    check('expirado recusado', (await sessionFromApiToken(req(`Bearer ${segredo}`))) === null);

    console.log('\n4) lastUsedAt é carimbado');
    await prisma.apiToken.update({
      where: { id: criado.token.id },
      data: { expiresAt: null, lastUsedAt: null },
    });
    await sessionFromApiToken(req(`Bearer ${segredo}`));
    // A gravação é fora do await de propósito; dá um instante para concluir.
    await new Promise((r) => setTimeout(r, 400));
    const depois = await prisma.apiToken.findUnique({ where: { id: criado.token.id } });
    check('lastUsedAt gravado', Boolean(depois?.lastUsedAt));

    console.log('\n5) Permissões restritas são respeitadas');
    await prisma.apiToken.update({
      where: { id: criado.token.id },
      data: { permissions: ['conversas:ler'] },
    });
    const restrito = await sessionFromApiToken(req(`Bearer ${segredo}`));
    check('só a permissão declarada', restrito?.permissions.length === 1, `${restrito?.permissions}`);
    check(
      'responder NÃO concedido',
      restrito?.permissions.includes('conversas:responder') === false,
    );
  } finally {
    await prisma.apiToken.delete({ where: { id: criado.token.id } }).catch(() => undefined);
  }
}

main()
  .then(async () => {
    console.log(
      falhas.length === 0
        ? '\nTodos os testes passaram.\n'
        : `\n${falhas.length} falha(s): ${falhas.join(', ')}\n`,
    );
    await prisma.$disconnect();
    process.exit(falhas.length === 0 ? 0 : 1);
  })
  .catch(async (err) => {
    console.error('\nErro no teste:', err);
    await prisma.$disconnect();
    process.exit(1);
  });
