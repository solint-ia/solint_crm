'use client';

import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  CircleDot,
  CornerDownRight,
  Flag,
  GitBranch,
  HelpCircle,
  MessageSquare,
  Plus,
  Trash2,
  UserPlus,
} from 'lucide-react';
import type { AgentFlowBlock, FlowBlockType } from '@/core/domain/ai-agent';
import {
  FLOW_BLOCK_LABELS,
  FLOW_BLOCK_TYPES,
  isTerminalBlock,
  validateAgentFlow,
} from '@/core/domain/ai-agent';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Select, TextInput } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import { saveAgentFlowAction } from '@/app/(workspace)/agentes-ia/actions';

const BLOCK_ICON: Readonly<Record<FlowBlockType, typeof CircleDot>> = {
  inicio: CircleDot,
  mensagem: MessageSquare,
  pergunta: HelpCircle,
  consultar_base: BookOpen,
  condicao: GitBranch,
  transferir: UserPlus,
  encerrar: Flag,
};

/** Cor por papel do bloco: entrada, trabalho, desvio, saída. */
const BLOCK_TONE: Readonly<Record<FlowBlockType, string>> = {
  inicio: 'text-brand',
  mensagem: 'text-blue-text',
  pergunta: 'text-blue-text',
  consultar_base: 'text-violet-text',
  condicao: 'text-amber-text',
  transferir: 'text-amber-text',
  encerrar: 'text-dim',
};

const DEFAULT_TITLE: Readonly<Record<FlowBlockType, string>> = {
  inicio: 'Início da conversa',
  mensagem: 'Enviar mensagem',
  pergunta: 'Fazer uma pergunta',
  consultar_base: 'Consultar a base de conhecimento',
  condicao: 'Verificar uma condição',
  transferir: 'Transferir para atendente',
  encerrar: 'Encerrar atendimento',
};

const DEFAULT_BRANCHES: Readonly<Record<FlowBlockType, readonly string[]>> = {
  inicio: ['Seguir'],
  mensagem: ['Seguir'],
  pergunta: ['Respondeu'],
  consultar_base: ['Encontrou', 'Não encontrou'],
  condicao: ['Sim', 'Não'],
  transferir: [],
  encerrar: [],
};

interface FlowBuilderProps {
  readonly agentId: string;
  readonly initialFlow: readonly AgentFlowBlock[];
  readonly canEdit: boolean;
}

/**
 * Construtor do fluxo do agente (§9).
 *
 * O que existia era um `<ol>` de quatro rótulos fixos: não tinha ramificação,
 * não tinha fim e não correspondia a agente nenhum. Um fluxo de atendimento é
 * um grafo — a pergunta leva a caminhos diferentes — e é isso que precisa ser
 * editável.
 *
 * A ligação entre blocos é feita por seleção, não por arrastar. Arrastar linha
 * é bonito e é inacessível pelo teclado; um `select` com os blocos existentes
 * faz a mesma ligação, funciona no celular e não deixa saída pendurada sem que
 * o validador perceba.
 */
export function FlowBuilder({ agentId, initialFlow, canEdit }: FlowBuilderProps) {
  const [blocks, setBlocks] = useState<readonly AgentFlowBlock[]>(initialFlow);
  const [saving, setSaving] = useState(false);
  const { show } = useToast();

  const problems = useMemo(() => validateAgentFlow(blocks), [blocks]);
  const dirty = JSON.stringify(blocks) !== JSON.stringify(initialFlow);

  const problemsOf = (blockId: string) =>
    problems.filter((problem) => problem.blockId === blockId);

  const patchBlock = (id: string, patch: Partial<AgentFlowBlock>) =>
    setBlocks((current) =>
      current.map((block) => (block.id === id ? { ...block, ...patch } : block)),
    );

  const addBlock = (type: FlowBlockType) => {
    const id = `fb-${Date.now().toString(36)}`;
    setBlocks((current) => [
      ...current,
      {
        id,
        type,
        title: DEFAULT_TITLE[type],
        branches: DEFAULT_BRANCHES[type].map((label) => ({ label })),
      },
    ]);
  };

  /** Remover um bloco solta quem apontava para ele — melhor mostrar isso que esconder. */
  const removeBlock = (id: string) =>
    setBlocks((current) =>
      current
        .filter((block) => block.id !== id)
        .map((block) => ({
          ...block,
          branches: block.branches.map((branch) =>
            branch.targetId === id ? { label: branch.label } : branch,
          ),
        })),
    );

  const handleSave = async () => {
    setSaving(true);
    const result = await saveAgentFlowAction({ agentId, blocks });
    setSaving(false);

    if (result.ok) {
      show({
        tone: problems.length > 0 ? 'alerta' : 'sucesso',
        title: 'Fluxo salvo',
        description:
          problems.length > 0
            ? `Salvo com ${problems.length} ${problems.length === 1 ? 'pendência' : 'pendências'}: o agente pode travar nesses pontos.`
            : `${blocks.length} blocos, sem pendências.`,
      });
    } else {
      show({ tone: 'erro', title: 'Não foi possível salvar', description: result.error });
    }
  };

  if (blocks.length === 0) {
    return (
      <div className="max-w-3xl">
        <EmptyState
          icon={<GitBranch className="size-5" />}
          title="Este agente ainda não tem fluxo"
          description="Sem fluxo, o agente responde só pelo prompt. Um fluxo define a sequência: saudação, pergunta, consulta à base e o momento de passar para um humano."
          action={
            canEdit ? (
              <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => addBlock('inicio')}>
                Começar pelo bloco de início
              </Button>
            ) : null
          }
        />
      </div>
    );
  }

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      {problems.length > 0 ? (
        <div className="flex items-start gap-3 rounded-surface border border-note-line bg-note p-3.5 text-body text-note-text">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-text" />
          <div>
            <p className="font-bold">
              {problems.length === 1
                ? '1 ponto onde a conversa pode travar'
                : `${problems.length} pontos onde a conversa pode travar`}
            </p>
            <ul className="mt-1.5 flex flex-col gap-1">
              {problems.map((problem, index) => (
                <li key={index} className="text-meta leading-relaxed">
                  {problem.message}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : (
        <p className="text-meta text-green-text">
          Todos os caminhos terminam: nenhum bloco fica sem saída ou fora de alcance.
        </p>
      )}

      <ol className="flex flex-col">
        {blocks.map((block, index) => {
          const Icon = BLOCK_ICON[block.type];
          const terminal = isTerminalBlock(block.type);
          const blockProblems = problemsOf(block.id);

          return (
            <li key={block.id} className="relative pl-8">
              {/* Trilho de conexão: o fio é a estrutura, não decoração. */}
              {index < blocks.length - 1 ? (
                <span
                  aria-hidden="true"
                  className="absolute top-8 bottom-0 left-[15px] w-px bg-line"
                />
              ) : null}
              <span
                aria-hidden="true"
                className={cn(
                  'absolute top-4 left-2 flex size-4 items-center justify-center rounded-full border-2 border-surface bg-surface',
                  BLOCK_TONE[block.type],
                )}
              >
                <Icon className="size-3.5" />
              </span>

              <div
                className={cn(
                  'mb-2 rounded-surface border bg-surface p-3.5',
                  blockProblems.length > 0 ? 'border-note-line' : 'border-line',
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      'text-micro font-semibold tracking-wide uppercase',
                      BLOCK_TONE[block.type],
                    )}
                  >
                    {FLOW_BLOCK_LABELS[block.type]}
                  </span>
                  {terminal ? (
                    <span className="text-micro text-dim">fim deste caminho</span>
                  ) : null}

                  {canEdit ? (
                    <button
                      type="button"
                      aria-label={`Remover bloco ${block.title}`}
                      onClick={() => removeBlock(block.id)}
                      className="ml-auto rounded-control p-1 text-dim transition-colors hover:bg-red-soft hover:text-red-text"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  ) : null}
                </div>

                {canEdit ? (
                  <TextInput
                    aria-label={`Título do bloco ${index + 1}`}
                    className="mt-1.5"
                    value={block.title}
                    maxLength={120}
                    onChange={(event) => patchBlock(block.id, { title: event.target.value })}
                  />
                ) : (
                  <p className="mt-1 text-ui font-semibold text-ink">{block.title}</p>
                )}

                {block.detail ? (
                  <p className="mt-1.5 text-meta leading-relaxed text-muted">{block.detail}</p>
                ) : null}

                {/* ---------- Saídas ---------- */}
                {block.branches.length > 0 ? (
                  <ul className="mt-3 flex flex-col gap-1.5 border-t border-line-soft pt-2.5">
                    {block.branches.map((branch, branchIndex) => {
                      const target = blocks.find((item) => item.id === branch.targetId);
                      return (
                        <li key={branchIndex} className="flex flex-wrap items-center gap-2">
                          <CornerDownRight className="size-3 shrink-0 text-dim" />
                          <span className="min-w-16 text-meta font-semibold text-muted">
                            {branch.label}
                          </span>

                          {canEdit ? (
                            <Select
                              aria-label={`Destino da saída ${branch.label} de ${block.title}`}
                              className="h-8 w-auto min-w-48 flex-1 text-body"
                              value={branch.targetId ?? ''}
                              onChange={(event) =>
                                patchBlock(block.id, {
                                  branches: block.branches.map((item, position) =>
                                    position === branchIndex
                                      ? event.target.value
                                        ? { ...item, targetId: event.target.value }
                                        : { label: item.label }
                                      : item,
                                  ),
                                })
                              }
                            >
                              <option value="">(não ligado)</option>
                              {blocks
                                .filter((item) => item.id !== block.id)
                                .map((item) => (
                                  <option key={item.id} value={item.id}>
                                    {item.title}
                                  </option>
                                ))}
                            </Select>
                          ) : (
                            <span
                              className={cn(
                                'text-body',
                                target ? 'text-ink' : 'font-semibold text-red-text',
                              )}
                            >
                              {target ? target.title : 'não ligado'}
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                ) : null}

                {canEdit && !terminal ? (
                  <button
                    type="button"
                    onClick={() =>
                      patchBlock(block.id, {
                        branches: [
                          ...block.branches,
                          { label: `Saída ${block.branches.length + 1}` },
                        ],
                      })
                    }
                    className="mt-2 text-meta font-semibold text-brand hover:underline"
                  >
                    + Adicionar saída
                  </button>
                ) : null}

                {blockProblems.length > 0 ? (
                  <p className="mt-2 text-meta font-medium text-amber-text">
                    {blockProblems.map((problem) => problem.message).join(' ')}
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>

      {canEdit ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
          <Select
            aria-label="Adicionar bloco ao fluxo"
            className="w-auto"
            value=""
            onChange={(event) => {
              if (event.target.value) addBlock(event.target.value as FlowBlockType);
            }}
          >
            <option value="">+ Adicionar bloco…</option>
            {FLOW_BLOCK_TYPES.filter(
              (type) => type !== 'inicio' || !blocks.some((block) => block.type === 'inicio'),
            ).map((type) => (
              <option key={type} value={type}>
                {FLOW_BLOCK_LABELS[type]}
              </option>
            ))}
          </Select>

          <Button onClick={handleSave} disabled={!dirty || saving}>
            {saving ? 'Salvando…' : 'Salvar fluxo'}
          </Button>
          <span className="text-meta text-dim">
            {dirty ? 'Há alterações não salvas.' : 'Tudo salvo.'}
          </span>
        </div>
      ) : (
        <p className="border-t border-line pt-4 text-meta text-dim">
          Seu papel permite ver o fluxo, mas não editá-lo.
        </p>
      )}
    </div>
  );
}
