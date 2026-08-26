/**
 * Migra os vínculos de equipe das colunas `Json` para as tabelas relacionais.
 *
 * **Por que um script, e não SQL dentro da migração.** O dado a migrar não é
 * uma cópia de coluna: `Team.inboxIds` guarda **nomes** de caixa (o formulário
 * da tela pedia texto livre separado por vírgula) e `Membership.teams` guarda
 * **nomes** de equipe. Resolver nome → id exige juntar três tabelas e decidir o
 * que fazer com o que não casar — e a resposta certa para isso não é "descarta
 * em silêncio", é "relata".
 *
 * Idempotente: reexecutar não duplica nada (`ON CONFLICT DO NOTHING`).
 *
 *   node --env-file=.env scripts/backfill-equipes.mjs
 */
import pg from 'pg';

const { Client } = pg;

const client = new Client({ connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL });

/** Sempre lista o que ficou de fora: um vínculo perdido é acesso perdido. */
const naoMapeado = { caixas: [], equipes: [] };

const asArray = (value) => (Array.isArray(value) ? value : []);

async function main() {
  await client.connect();

  const teams = (await client.query('SELECT id, "accountId", name, members, "inboxIds" FROM "Team"'))
    .rows;
  const inboxes = (await client.query('SELECT id, "accountId", name FROM "Inbox"')).rows;
  const memberships = (await client.query('SELECT "userId", "accountId", teams FROM "Membership"'))
    .rows;

  // Índices por conta: nome de caixa e nome de equipe só são únicos dentro dela.
  const inboxPorId = new Map(inboxes.map((row) => [`${row.accountId}:${row.id}`, row.id]));
  const inboxPorNome = new Map(inboxes.map((row) => [`${row.accountId}:${row.name}`, row.id]));
  const teamPorNome = new Map(teams.map((row) => [`${row.accountId}:${row.name}`, row.id]));

  let vinculosCaixa = 0;
  let vinculosMembro = 0;

  // 1. Team.inboxIds -> TeamInbox. O valor pode ser id (seed novo) ou nome
  //    (formulário antigo), então tenta os dois, nessa ordem.
  for (const team of teams) {
    for (const referencia of asArray(team.inboxIds)) {
      const inboxId =
        inboxPorId.get(`${team.accountId}:${referencia}`) ??
        inboxPorNome.get(`${team.accountId}:${referencia}`);

      if (!inboxId) {
        naoMapeado.caixas.push(`equipe "${team.name}" (${team.accountId}) -> "${referencia}"`);
        continue;
      }

      const { rowCount } = await client.query(
        'INSERT INTO "TeamInbox" ("teamId", "inboxId") VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [team.id, inboxId],
      );
      vinculosCaixa += rowCount;
    }
  }

  // 2. Membros vêm de duas origens que precisam ser unidas: `Team.members`
  //    (ids de usuário) e `Membership.teams` (nomes de equipe). Na base atual a
  //    primeira está sempre vazia e a segunda é que tem o dado — mas ambas são
  //    lidas, porque uma base que passou pela tela pode ter as duas.
  const paresMembro = new Set();

  for (const team of teams) {
    for (const userId of asArray(team.members)) {
      paresMembro.add(`${team.id}|${userId}`);
    }
  }

  for (const membership of memberships) {
    for (const nomeEquipe of asArray(membership.teams)) {
      const teamId = teamPorNome.get(`${membership.accountId}:${nomeEquipe}`);
      if (!teamId) {
        naoMapeado.equipes.push(
          `usuário ${membership.userId} (${membership.accountId}) -> equipe "${nomeEquipe}"`,
        );
        continue;
      }
      paresMembro.add(`${teamId}|${membership.userId}`);
    }
  }

  for (const par of paresMembro) {
    const [teamId, userId] = par.split('|');
    const { rowCount } = await client.query(
      'INSERT INTO "TeamMember" ("teamId", "userId") VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [teamId, userId],
    );
    vinculosMembro += rowCount;
  }

  console.log(`\nVínculos equipe->caixa gravados : ${vinculosCaixa}`);
  console.log(`Vínculos equipe->pessoa gravados: ${vinculosMembro}`);

  if (naoMapeado.caixas.length || naoMapeado.equipes.length) {
    console.warn('\nATENÇÃO — referências que não resolveram e ficaram de fora:');
    for (const item of naoMapeado.caixas) console.warn(`  caixa  : ${item}`);
    for (const item of naoMapeado.equipes) console.warn(`  equipe : ${item}`);
    console.warn(
      '\nCada linha acima é um acesso que a pessoa tinha e não terá. Corrija pela tela\n' +
        'de Configurações > Equipes antes de aplicar a migração que remove as colunas.',
    );
  } else {
    console.log('\nTudo resolvido: nenhuma referência ficou para trás.');
  }

  // Conferência final, já pelas tabelas novas.
  const conferencia = await client.query(`
    SELECT t.name AS equipe,
           count(DISTINCT ti."inboxId") AS caixas,
           count(DISTINCT tm."userId")  AS pessoas
    FROM "Team" t
    LEFT JOIN "TeamInbox" ti ON ti."teamId" = t.id
    LEFT JOIN "TeamMember" tm ON tm."teamId" = t.id
    GROUP BY t.id, t.name ORDER BY t.name`);
  console.log('\nEstado final:');
  console.table(conferencia.rows);

  await client.end();
}

main().catch(async (error) => {
  console.error('Falha no backfill:', error);
  await client.end().catch(() => undefined);
  process.exit(1);
});
