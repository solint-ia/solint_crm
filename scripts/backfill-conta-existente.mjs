/**
 * Conserta contas criadas antes das mudanças de equipes e expediente.
 *
 * Duas correções, ambas idempotentes — rodar de novo não faz nada:
 *
 *  1. **`Inbox.businessHours` com a forma errada.** O cadastro gravava
 *     `{ enabled, timezone, schedule: [] }`, mas o domínio espera
 *     `{ timezone, days: [...] }`. A tela de Configurações quebrava ao filtrar
 *     `days`, que não existia. Toda conta criada pelo cadastro nasceu assim.
 *
 *  2. **Papéis sem as permissões novas.** `caixas:todas` e
 *     `conversas:mover-caixa` entraram depois que estes papéis foram gravados.
 *     A segunda só tira uma ação do administrador; a primeira é séria — sem
 *     ela, o gestor que criar a primeira equipe se tranca do lado de fora das
 *     caixas que ele mesmo configurou.
 *
 *   node --env-file=.env scripts/backfill-conta-existente.mjs
 */
import pg from 'pg';

const { Client } = pg;

const client = new Client({ connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL });

const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];

const defaultBusinessHours = (timezone = 'America/Sao_Paulo') => ({
  timezone,
  days: WEEKDAYS.map((day) => ({
    day,
    enabled: day !== 'dom' && day !== 'sab',
    opensAt: '08:00',
    closesAt: '18:00',
  })),
});

/** Só o administrador ganha `caixas:todas`: é o papel que não pode se trancar. */
const FALTANTES = {
  administrador: ['caixas:todas', 'conversas:mover-caixa'],
  supervisor: ['conversas:mover-caixa'],
};

async function main() {
  await client.connect();

  // 1. Expediente com a forma errada
  const inboxes = (await client.query('SELECT id, name, "businessHours" FROM "Inbox"')).rows;
  let corrigidas = 0;

  for (const inbox of inboxes) {
    const bh = inbox.businessHours;
    if (bh && typeof bh === 'object' && Array.isArray(bh.days) && bh.days.length > 0) continue;

    const timezone = typeof bh?.timezone === 'string' ? bh.timezone : 'America/Sao_Paulo';
    await client.query('UPDATE "Inbox" SET "businessHours" = $1 WHERE id = $2', [
      JSON.stringify(defaultBusinessHours(timezone)),
      inbox.id,
    ]);
    console.log(`  expediente corrigido: ${inbox.id} ("${inbox.name}")`);
    corrigidas += 1;
  }
  console.log(`\nCaixas com expediente corrigido: ${corrigidas} de ${inboxes.length}`);

  // 2. Permissões que entraram depois
  const roles = (await client.query('SELECT id, "accountId", slug, permissions FROM "Role"')).rows;
  let papeisAtualizados = 0;

  for (const role of roles) {
    const faltantes = FALTANTES[role.slug];
    if (!faltantes) continue;

    const atuais = Array.isArray(role.permissions) ? role.permissions : [];
    const aAdicionar = faltantes.filter((permission) => !atuais.includes(permission));
    if (aAdicionar.length === 0) continue;

    await client.query('UPDATE "Role" SET permissions = $1 WHERE id = $2', [
      JSON.stringify([...atuais, ...aAdicionar]),
      role.id,
    ]);
    console.log(`  ${role.accountId} / ${role.slug}: + ${aAdicionar.join(', ')}`);
    papeisAtualizados += 1;
  }
  console.log(`Papéis atualizados: ${papeisAtualizados} de ${roles.length}`);

  console.log('\nEstado final:');
  console.table(
    (
      await client.query(`
      SELECT r."accountId", r.slug,
             (r.permissions)::jsonb ? 'caixas:todas' AS ve_todas_caixas,
             (r.permissions)::jsonb ? 'conversas:mover-caixa' AS move_caixa
      FROM "Role" r ORDER BY r."accountId", r.slug`)
    ).rows,
  );

  await client.end();
}

main().catch(async (error) => {
  console.error('Falha no backfill:', error);
  await client.end().catch(() => undefined);
  process.exit(1);
});
