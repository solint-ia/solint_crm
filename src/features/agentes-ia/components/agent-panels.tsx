import { FileText } from 'lucide-react';
import type { AiAgent } from '@/core/domain/ai-agent';
import { HANDOFF_RESULT_LABELS } from '@/core/domain/ai-agent';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyHint, EmptyState } from '@/components/ui/empty-state';
import { Field, TextArea, TextInput } from '@/components/ui/field';

export function AgentConfigPanel({ agent }: { readonly agent: AiAgent }) {
  return (
    <Card className="max-w-3xl">
      <CardHeader title="Configuração do agente" description="Persona, prompt e modelo" />
      <div className="flex flex-col gap-4">
        <Field label="Nome" htmlFor="agent-name">
          <TextInput id="agent-name" defaultValue={agent.name} />
        </Field>
        <Field label="Persona" htmlFor="agent-persona">
          <TextArea id="agent-persona" rows={2} defaultValue={agent.persona} />
        </Field>
        <Field
          label="Prompt de sistema"
          htmlFor="agent-prompt"
          hint="Nunca inclua segredos, chaves ou dados pessoais neste campo."
        >
          <TextArea id="agent-prompt" rows={6} defaultValue={agent.systemPrompt} />
        </Field>
        <Field label="Modelo" htmlFor="agent-model">
          <TextInput id="agent-model" defaultValue={agent.model} />
        </Field>
      </div>
    </Card>
  );
}

export function AgentKnowledgePanel({ agent }: { readonly agent: AiAgent }) {
  return (
    <Card className="max-w-3xl">
      <CardHeader
        title="Base de conhecimento"
        description="Documentos indexados para respostas com RAG"
      />
      {agent.knowledgeBase.length === 0 ? (
        <EmptyHint>
          Nenhum documento indexado. O agente responderá só com o prompt, sem consultar a base.
        </EmptyHint>
      ) : null}
      <ul className="flex flex-col gap-2">
        {agent.knowledgeBase.map((document) => (
          <li
            key={document.id}
            className="flex items-center gap-2.5 rounded-control border border-line px-3 py-2.5"
          >
            <FileText className="size-4 text-dim" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-body text-ink">{document.name}</span>
              <span className="block text-meta text-dim">{document.updatedLabel}</span>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function AgentLogsPanel({ agent }: { readonly agent: AiAgent }) {
  if (agent.logs.length === 0) {
    return (
      <EmptyState
        className="max-w-3xl"
        title="Este agente ainda não atendeu ninguém"
        description="Assim que ele conduzir a primeira conversa, o histórico e os motivos de transferência aparecem aqui."
      />
    );
  }

  return (
    <Card padded={false} className="max-w-3xl overflow-x-auto">
      <table className="w-full min-w-[480px] text-left text-body">
        <caption className="sr-only">Histórico de atendimentos do agente</caption>
        <thead className="border-b border-line text-meta tracking-wide text-dim uppercase">
          <tr>
            <th scope="col" className="px-4 py-3 font-semibold">Contato</th>
            <th scope="col" className="px-4 py-3 font-semibold">Data</th>
            <th scope="col" className="px-4 py-3 font-semibold">Resultado</th>
          </tr>
        </thead>
        <tbody>
          {agent.logs.map((log) => (
            <tr key={log.id} className="border-b border-line-soft last:border-0">
              <th scope="row" className="px-4 py-3 font-normal text-ink">
                {log.contactName}
              </th>
              <td className="px-4 py-3 text-muted">{log.date}</td>
              <td className="px-4 py-3">
                <Badge tone={log.result === 'concluido_ia' ? 'green' : 'amber'}>
                  {HANDOFF_RESULT_LABELS[log.result]}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
