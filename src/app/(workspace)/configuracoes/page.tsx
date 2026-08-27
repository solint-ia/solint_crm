import type { Metadata } from 'next';
import { SETTINGS_SECTIONS, type SettingsSectionId } from '@/config/navigation';
import { CHANNELS, CHANNEL_REGISTRY } from '@/core/domain/channel';
import { PRIORITIES } from '@/core/domain/conversation';
import { PRIORITY_LABEL } from '@/components/domain/presentation-maps';
import { Topbar } from '@/components/layout/topbar';
import { SettingsNav } from '@/features/configuracoes/components/settings-nav';
import { AutomationsSection } from '@/features/configuracoes/components/sections/automations-section';
import { InboxesSection } from '@/features/configuracoes/components/sections/inboxes-section';
import { IntegrationsSection } from '@/features/configuracoes/components/sections/integrations-section';
import { KnowledgeSection } from '@/features/configuracoes/components/sections/knowledge-section';
import { TeamSection } from '@/features/configuracoes/components/sections/team-section';
import { LabelsSection } from '@/features/configuracoes/components/sections/labels-section';
import { CannedResponsesSection } from '@/features/configuracoes/components/sections/canned-responses-section';
import { CustomAttributesSection } from '@/features/configuracoes/components/sections/custom-attributes-section';
import { CompanySection } from '@/features/configuracoes/components/sections/company-section';
import { BillingSection } from '@/features/configuracoes/components/sections/billing-section';
import { SecuritySection } from '@/features/configuracoes/components/sections/security-section';
import { can } from '@/core/domain/user';
import { AccessDenied } from '@/components/layout/access-denied';
import { container } from '@/infrastructure/container';
import { parseOneOf } from '@/lib/search-params';

export const metadata: Metadata = { title: 'Configurações' };

const SECTION_IDS = SETTINGS_SECTIONS.map((s) => s.id);

export default async function ConfiguracoesPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const currentSection: SettingsSectionId = parseOneOf(params.secao, SECTION_IDS, 'automacoes');

  const session = await container.session.getCurrentSession();
  // A rail ja esconde o item; sem esta checagem, a URL direta entraria.
  if (!can(session, 'configuracoes:ler')) return <AccessDenied permission="configuracoes:ler" />;
  /**
   * Conversas e funis só alimentam o `vocabulary`, e o `vocabulary` só chega ao
   * construtor de automação. Carregá-los ao abrir "Respostas" ou "Etiquetas"
   * era varrer a caixa de entrada inteira para montar uma lista que aquela tela
   * nem recebe — e cada consulta a mais custa uma travessia até o banco.
   */
  const montaVocabulario = currentSection === 'automacoes';

  const [settings, notifications, conversations, pipelines] = await Promise.all([
    container.settings.get(session.account.id),
    container.notifications.list(session.account.id, session.user.id),
    montaVocabulario
      ? container.conversations.list(session.account.id, session.user.id, {
          scope: 'todas',
          inboxAccess: session.inboxAccess,
        })
      : Promise.resolve([]),
    montaVocabulario
      ? container.pipelines.listPipelines(session.account.id)
      : Promise.resolve([]),
  ]);

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
        <SettingsNav current={currentSection} />

        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          {currentSection === 'automacoes' ? (
            <AutomationsSection
              initialAutomations={settings.automations}
              macros={settings.macros}
              initialAssignmentMethod={settings.assignmentMethod}
              vocabulary={vocabulary}
            />
          ) : null}

          {currentSection === 'integracoes' ? (
            <IntegrationsSection
              connections={settings.connections}
              webhooks={settings.webhooks}
              apiTokens={settings.apiTokens}
            />
          ) : null}

          {currentSection === 'caixas' ? (
            <InboxesSection connections={settings.connections} />
          ) : null}

          {currentSection === 'conhecimento' ? (
            <KnowledgeSection knowledge={settings.knowledge} />
          ) : null}

          {currentSection === 'equipe' ? (
            <TeamSection
              members={settings.members}
              roles={settings.roles}
              teams={settings.teams}
              inboxes={settings.connections}
            />
          ) : null}

          {currentSection === 'etiquetas' ? <LabelsSection labels={settings.labels} /> : null}

          {currentSection === 'respostas' ? (
            <CannedResponsesSection cannedResponses={settings.cannedResponses} />
          ) : null}

          {currentSection === 'atributos' ? (
            <CustomAttributesSection attributes={settings.customAttributes} />
          ) : null}

          {currentSection === 'empresa' ? (
            <CompanySection account={session.account} company={settings.company} />
          ) : null}

          {currentSection === 'faturamento' ? <BillingSection billing={settings.billing} /> : null}

          {currentSection === 'seguranca' ? (
            <SecuritySection
              activeSessions={settings.activeSessions}
              auditLog={settings.auditLog}
            />
          ) : null}
        </main>
      </div>
    </>
  );
}
