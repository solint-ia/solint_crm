import type { Metadata } from 'next';
import {
  SETTINGS_SECTIONS,
  firstSettingsSectionFor,
  settingsSectionsFor,
  type SettingsSectionId,
} from '@/config/navigation';
import { CHANNELS, CHANNEL_REGISTRY } from '@/core/domain/channel';
import { PRIORITIES } from '@/core/domain/conversation';
import { PRIORITY_LABEL } from '@/components/domain/presentation-maps';
import { Topbar } from '@/components/layout/topbar';
import { SettingsNav } from '@/features/configuracoes/components/settings-nav';
import { AutomationsSection } from '@/features/configuracoes/components/sections/automations-section';
import { InboxesSection } from '@/features/configuracoes/components/sections/inboxes-section';
// import { KnowledgeSection } from '@/features/configuracoes/components/sections/knowledge-section';
import { TeamSection } from '@/features/configuracoes/components/sections/team-section';
import { LabelsSection } from '@/features/configuracoes/components/sections/labels-section';
import { CannedResponsesSection } from '@/features/configuracoes/components/sections/canned-responses-section';
import { CompanySection } from '@/features/configuracoes/components/sections/company-section';
import { BillingSection } from '@/features/configuracoes/components/sections/billing-section';
import { SecuritySection } from '@/features/configuracoes/components/sections/security-section';
import { AccessDenied } from '@/components/layout/access-denied';
import { container } from '@/infrastructure/container';
import {
  effectivePermissions,
  type Permission,
  type PermissionOverrides,
  type Role,
} from '@/core/domain/user';
import { prisma, readJson } from '@/infrastructure/db/prisma';
import { parseOneOf } from '@/lib/search-params';
import { listActiveSessions } from '@/infrastructure/auth/session';
import { PrismaAuditRepository } from '@/infrastructure/repositories/prisma/audit-repository';

/**
 * As permissões efetivas de cada membro da conta, por id de usuário.
 *
 * Uma consulta só para toda a lista, e o cruzamento com os papéis em memória:
 * perguntar o papel de cada pessoa em separado daria uma ida ao banco por linha
 * da tabela de membros.
 */
const permissoesEfetivasDaConta = async (
  accountId: string,
  roles: readonly Role[],
): Promise<Readonly<Record<string, readonly Permission[]>>> => {
  const vinculos = await prisma.membership.findMany({
    where: { accountId },
    select: { userId: true, roleSlug: true, permissionOverrides: true },
  });

  const porSlug = new Map(roles.map((role) => [role.slug, role.permissions]));
  return Object.fromEntries(
    vinculos.map((vinculo) => [
      vinculo.userId,
      effectivePermissions(
        porSlug.get(vinculo.roleSlug) ?? [],
        readJson<PermissionOverrides | null>(vinculo.permissionOverrides, null),
      ),
    ]),
  );
};

export const metadata: Metadata = { title: 'Configurações' };

export default async function ConfiguracoesPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const session = await container.session.getCurrentSession();

  /**
   * Configurações não é mais uma porta só.
   *
   * Não existe uma permissão que signifique "entra em Configurações": existe
   * uma por sub-seção. Quem não alcança nenhuma delas não tem o que fazer aqui;
   * quem alcança alguma entra na primeira que alcança, e não numa fixa que
   * jogaria metade das pessoas numa tela de acesso negado logo ao clicar.
   */
  const alcancadas = settingsSectionsFor(session.permissions);
  const primeira = firstSettingsSectionFor(session.permissions);
  if (!primeira) return <AccessDenied permission="config.caixas:ler" />;

  /**
   * `?secao=` é escolha do usuário, mas também é URL editável à mão.
   *
   * Por isso o parse considera **só** as seções alcançáveis: uma seção pedida
   * que a pessoa não alcança não vira acesso negado, vira a primeira seção
   * dela — o mesmo que teria acontecido se ela tivesse clicado no menu.
   */
  const currentSection: SettingsSectionId = parseOneOf(
    params.secao,
    alcancadas.map((secao) => secao.id),
    primeira,
  );
  /**
   * Conversas e funis só alimentam o `vocabulary`, e o `vocabulary` só chega ao
   * construtor de automação. Carregá-los ao abrir "Respostas" ou "Etiquetas"
   * era varrer a caixa de entrada inteira para montar uma lista que aquela tela
   * nem recebe — e cada consulta a mais custa uma travessia até o banco.
   */
  const montaVocabulario = currentSection === 'automacoes';

  const [settings, notifications, conversations, pipelines, activeSessions, auditRecords] = await Promise.all([
    container.settings.get(session.account.id),
    container.notifications.list(session.account.id, session.user.id),
    montaVocabulario
      ? container.conversations.list(session.account.id, session.user.id, {
          scope: 'todas',
          inboxAccess: session.inboxAccess,
        })
      : Promise.resolve([]),
    montaVocabulario ? container.pipelines.listPipelines(session.account.id) : Promise.resolve([]),
    currentSection === 'seguranca'
      ? listActiveSessions(session.user.id, session.tokenId)
      : Promise.resolve([]),
    currentSection === 'seguranca'
      ? new PrismaAuditRepository().list(session.account.id, { limit: 100 })
      : Promise.resolve([]),
  ]);

  /**
   * O efetivo de cada pessoa — papel mais a personalização dela.
   *
   * Calculado só quando a aba de equipe está aberta e quem olha pode
   * personalizar: é uma consulta a mais ao banco, e ela não serve a nenhuma
   * outra seção. A tela precisa do efetivo, e não do papel, porque é ele que a
   * grade de caixinhas mostra pré-marcado.
   */
  const podeEditarPapeis = session.permissions.includes('config.equipe.papeis:escrever');
  const memberPermissions =
    currentSection === 'equipe' && podeEditarPapeis
      ? await permissoesEfetivasDaConta(session.account.id, settings.roles)
      : {};

  const activeSectionMeta = SETTINGS_SECTIONS.find((s) => s.id === currentSection);

  /**
   * As sugestões do construtor de automação vêm do workspace real — filas que
   * existem, etiquetas cadastradas, equipes montadas. Uma lista inventada
   * ensinaria o usuário a escrever regras que nunca casam com nada.
   */
  const vocabulary = {
    channels: CHANNELS.map((channel) => CHANNEL_REGISTRY[channel].label),
    labels: settings.labels.map((label) => label.name),
    queues: [...new Set(conversations.map((conversation) => conversation.queue))].sort(),
    priorities: PRIORITIES.map((priority) => PRIORITY_LABEL[priority]),
    teams: settings.teams.map((team) => team.name),
    agents: settings.members.map((member) => member.name),
    // Nomes de etapa de todos os funis, sem repetir: a ação de mover casa por
    // nome, e dois funis podem ter uma etapa chamada igual.
    stages: [
      ...new Set(pipelines.flatMap((pipeline) => pipeline.stages.map((stage) => stage.name))),
    ].sort(),
  };

  return (
    <>
      <Topbar
        title="Configurações e preferências"
        subtitle={activeSectionMeta?.label ?? 'Configurações'}
        account={session.account}
        accounts={session.availableAccounts}
        notifications={notifications}
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
        <SettingsNav current={currentSection} sections={alcancadas} />

        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          {currentSection === 'automacoes' ? (
            <AutomationsSection initialAutomations={settings.automations} vocabulary={vocabulary} />
          ) : null}

          {currentSection === 'caixas' ? (
            <InboxesSection
              connections={settings.connections}
              canDelete={session.permissions.includes('config.caixas:excluir')}
            />
          ) : null}

          {/* Base de conhecimento (desativada/comentada para reutilização futura) */}
          {/* currentSection === ('conhecimento' as string) ? (
            <KnowledgeSection knowledge={settings.knowledge} />
          ) : null */}

          {currentSection === 'equipe' ? (
            <TeamSection
              members={settings.members}
              roles={settings.roles}
              teams={settings.teams}
              inboxes={settings.connections}
              canEditRoles={podeEditarPapeis}
              memberPermissions={memberPermissions}
            />
          ) : null}

          {currentSection === 'etiquetas' ? <LabelsSection labels={settings.labels} /> : null}

          {currentSection === 'respostas' ? (
            <CannedResponsesSection cannedResponses={settings.cannedResponses} />
          ) : null}

          {currentSection === 'empresa' ? (
            <CompanySection account={session.account} company={settings.company} />
          ) : null}

          {currentSection === 'faturamento' ? <BillingSection billing={settings.billing} /> : null}

          {currentSection === 'seguranca' ? (
            <SecuritySection
              activeSessions={activeSessions}
              auditLog={auditRecords}
            />
          ) : null}
        </main>
      </div>
    </>
  );
}
