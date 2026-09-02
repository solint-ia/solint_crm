'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  CONVERSATION_ID_MAX_LENGTH,
  CONVERSATION_STATUSES,
  PRIORITIES,
  currentProtocol,
  type Protocol,
} from '@/core/domain/conversation';
import { hasVariables, interpolate } from '@/core/domain/message-variables';
import { previewOfMessage, type Message, type MessageContent } from '@/core/domain/message';
import {
  MAX_SCHEDULE_AHEAD_MS,
  MIN_SCHEDULE_LEAD_MS,
  type ScheduledMessage,
} from '@/core/domain/scheduled-message';
import { groupInboxIds, type Contact, type ContactPartner } from '@/core/domain/contact';
import { stageLabelIds } from '@/core/domain/pipeline';
import { can, canSeeInbox, withSignature, type Session } from '@/core/domain/user';
import { canSendFreeText, MAX_MESSAGE_LENGTH } from '@/core/use-cases/send-message';
import { container } from '@/infrastructure/container';
import { prisma, readJson } from '@/infrastructure/db/prisma';
import { dispararAutomacoes } from '@/infrastructure/automations/dispatch';
import type { DispatchResult } from '@/infrastructure/whatsapp/channel';
import { getWhatsAppChannel } from '@/infrastructure/whatsapp/channel-provider';
import { mediaStore } from '@/infrastructure/whatsapp/wa-media-store';
import {
  applyReaction,
  findContactConversation,
  openOutboundConversation,
} from '@/infrastructure/whatsapp/wa-store';
import { waEventBus } from '@/infrastructure/whatsapp/whatsapp-events';
import { writeAuditLog } from '@/infrastructure/audit/write-audit-log';
import { createNotification } from '@/infrastructure/notifications/create-notification';
import { abrirProtocolo, fecharProtocolo } from '@/infrastructure/conversations/protocols';
import type { ClosingResult } from '@/infrastructure/whatsapp/inbox-auto-messages';

export interface ActionResult {
  readonly ok: boolean;
  readonly error?: string;
}

/**
 * O que a tela diz depois de resolver um atendimento.
 *
 * Resolver dispara duas coisas invisíveis — o encerramento automático e a
 * pesquisa de satisfação — e as duas podiam não sair por motivos diferentes,
 * todos silenciosos. Quem clicava em "resolver" via o mesmo nada em qualquer
 * caso, e a conclusão natural era "o CSAT não funciona".
 */
export interface CsatAviso {
  readonly tone: 'sucesso' | 'info' | 'alerta';
  readonly text: string;
}

const MOTIVO_TEXTO: Readonly<Record<NonNullable<ClosingResult['motivo']>, CsatAviso>> = {
  desligado: {
    tone: 'info',
    text: 'Atendimento resolvido. A pesquisa de satisfação está desligada nesta caixa de entrada.',
  },
  ja_perguntou: {
    tone: 'info',
    text: 'Atendimento resolvido. A pesquisa não foi enviada de novo: já perguntamos há menos de 24 horas.',
  },
  ja_respondeu: {
    tone: 'info',
    text: 'Atendimento resolvido. O cliente já avaliou este atendimento.',
  },
  canal: {
    tone: 'alerta',
    text: 'Atendimento resolvido, mas a pesquisa não saiu: a caixa de entrada está desconectada.',
  },
  sem_caixa: {
    tone: 'alerta',
    text: 'Atendimento resolvido, mas não foi possível ler a configuração da caixa de entrada.',
  },
};

const avisoDeFechamento = (fechamento: ClosingResult): CsatAviso => {
  if (fechamento.csatEnviado) {
    return { tone: 'sucesso', text: 'Atendimento resolvido. Pesquisa de satisfação enviada.' };
  }
  if (fechamento.encerramentoFalhou) {
    return {
      tone: 'alerta',
      text: 'Atendimento resolvido, mas a mensagem de encerramento não chegou ao cliente.',
    };
  }
  return (
    (fechamento.motivo && MOTIVO_TEXTO[fechamento.motivo]) ?? {
      tone: 'sucesso',
      text: 'Atendimento resolvido.',
    }
  );
};

export interface SendMessageResult extends ActionResult {
  /** Mensagem persistida — o cliente troca a bolha otimista por esta. */
  readonly message?: Message;
}

/**
 * Traduz a resposta do canal para o estado da bolha na tela.
 *
 * Os tres caminhos de envio (texto, template, anexo) faziam esta mesma traducao
 * copiada. Agora ela mora num lugar so — inclusive o caso novo, `queued`.
 *
 * `queued` e o motor worker dizendo "aceitei, ainda nao enviei". A bolha fica em
 * "enviando" e quem a promove a "enviado" e o proprio worker, por um evento
 * `message_updated`, quando o WhatsApp confirmar. Tratar isso como sucesso
 * imediato exibiria um "enviado" que ninguem verificou.
 */
async function applyDispatch(
  accountId: string,
  conversationId: string,
  message: Message,
  sent: DispatchResult,
): Promise<{ message: Message; error?: string }> {
  if (sent.ok && sent.externalId) {
    await container.conversations.attachExternalId(
      accountId,
      conversationId,
      message.id,
      sent.externalId,
    );
    return { message: { ...message, externalId: sent.externalId, deliveryStatus: 'enviado' } };
  }

  if (sent.ok && sent.queued) {
    return { message: { ...message, deliveryStatus: 'enviando' } };
  }

  return {
    message: { ...message, deliveryStatus: 'falha' },
    ...(sent.error ? { error: sent.error } : {}),
  };
}

/**
 * Resolve `{{cliente.nome}}` e companhia para uma conversa.
 *
 * Só vai ao banco quando o texto de fato cita alguma variável: a esmagadora
 * maioria das mensagens é digitada sem nenhuma, e uma consulta a mais em todo
 * envio custaria uma travessia até o banco no caminho mais quente do produto.
 */
const interpolarParaConversa = async (
  session: Session,
  conversationId: string,
  texto: string,
): Promise<string> => {
  if (!hasVariables(texto)) return texto;

  const conversa = await prisma.conversation.findFirst({
    where: { id: conversationId, accountId: session.account.id },
    select: { protocols: true, contact: { select: { name: true } } },
  });

  return interpolate(texto, {
    clienteNome: conversa?.contact?.name ?? '',
    agenteNome: session.user.name,
    empresa: session.account.name,
    protocolo: currentProtocol(readJson<readonly Protocol[]>(conversa?.protocols, []))?.code ?? '',
  });
};

/**
 * Toda Server Action valida a entrada antes de tocar no dominio:
 * o cliente e sempre considerado não confiavel (REGRAS-GLOBAIS.md secao 6.1).
 */
const sendMessageSchema = z.object({
  conversationId: z.string().min(1).max(CONVERSATION_ID_MAX_LENGTH),
  text: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
  isPrivate: z.boolean(),
  /** Mensagem citada. Vem da timeline aberta, então é sempre um id do CRM. */
  replyToId: z.string().min(1).max(128).optional(),
});

export async function sendMessageAction(input: unknown): Promise<SendMessageResult> {
  const parsed = sendMessageSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'Não foi possível enviar: dados inválidos.' };
  }

  const session = await container.session.getCurrentSession();

  /**
   * As variáveis são resolvidas no servidor, e não só no compositor.
   *
   * O compositor já interpola ao inserir uma resposta rápida, para o atendente
   * ver o texto final. Isso não basta: `{{cliente.nome}}` digitado à mão, uma
   * mensagem agendada, uma macro ou a API pública nunca passaram por aquele
   * caminho, e o cliente recebia a chave crua. Aqui é o funil por onde todo
   * envio de texto passa, então é aqui que a garantia vale.
   */
  const interpolado = await interpolarParaConversa(
    session,
    parsed.data.conversationId,
    parsed.data.text,
  );

  /**
   * A assinatura entra aqui, antes de gravar — não na hora de despachar.
   *
   * Gravar o texto sem ela e mandar com ela deixaria a timeline do CRM
   * descrevendo uma mensagem que não é a que o cliente recebeu, e é justamente
   * a timeline que alguém abre para conferir o que foi dito.
   *
   * Nota interna nunca é assinada: ninguém de fora a lê, e não há a quem se
   * identificar. Template também não passa por aqui — o corpo dele é aprovado
   * pela Meta e uma linha a mais o invalidaria.
   */
  const text = parsed.data.isPrivate ? interpolado : withSignature(session.user, interpolado);

  /**
   * Os candidatos a menção são carregados só para nota interna.
   *
   * `settings.get` é a consulta mais cara do caminho, e mensagem pública não
   * tem menção nenhuma a resolver: pedi-la em todo envio custaria a leitura do
   * catálogo inteiro da conta para descartar o resultado.
   */
  const mentionCandidates =
    parsed.data.isPrivate && parsed.data.text.includes('@')
      ? (await container.settings.get(session.account.id)).members.map((membro) => ({
          id: membro.id,
          name: membro.name,
        }))
      : [];

  const result = await container.useCases.sendMessage({
    session,
    ...parsed.data,
    text,
    mentionCandidates,
  });

  if (!result.ok) {
    return { ok: false, error: result.error.message };
  }

  // A conversa vem do proprio caso de uso, que ja a carregou para checar a
  // janela HSM. Buscar de novo aqui era repetir a consulta mais cara do caminho
  // — ela traz a timeline junto.
  const { conversation } = result.value;
  let message = result.value.message;
  let dispatchError: string | undefined;

  // Nota interna nunca sai para o canal externo (REGRAS-GLOBAIS.md secao 4.1).
  if (!parsed.data.isPrivate) {
    if (conversation.channel === 'whatsapp') {
      const channel = await getWhatsAppChannel();
      const channelStatus = await channel.getStatus(session.account.id, conversation.inboxId);

      if (channelStatus.status === 'conectado') {
        /**
         * A citação só viaja se a citada existir **no canal**.
         *
         * `externalId` é o que o WhatsApp entende por "aquela mensagem"; uma
         * nota interna ou uma mensagem que nunca saiu não tem um, e mandar a
         * citação sem ele produziria uma citação quebrada no aparelho do
         * contato. Aqui a resposta simplesmente sai como mensagem normal — no
         * CRM ela continua ligada à original pelo `replyToId`.
         *
         * A busca vai ao banco em vez de varrer `conversation.timeline`: a
         * timeline que o caso de uso devolve é recortada nas últimas mensagens,
         * e responder a uma mais antiga — o caso em que citar é mais útil —
         * cairia fora dela sem aviso nenhum.
         */
        const quotedMessage = parsed.data.replyToId
          ? await container.conversations.findMessage(
              session.account.id,
              conversation.id,
              parsed.data.replyToId,
            )
          : null;

        const sent = await channel.sendText(
          {
            accountId: session.account.id,
            conversationId: conversation.id,
            messageId: message.id,
            inboxId: conversation.inboxId,
          },
          { channelThreadId: conversation.channelThreadId, phone: conversation.contact.phone },
          text,
          quotedMessage?.externalId && !quotedMessage.isPrivate
            ? {
                externalId: quotedMessage.externalId,
                fromMe: quotedMessage.author !== 'contact',
                text: previewOfMessage(quotedMessage),
              }
            : undefined,
        );
        const applied = await applyDispatch(session.account.id, conversation.id, message, sent);
        message = applied.message;
        dispatchError = applied.error;
      } else {
        dispatchError =
          channelStatus.error ?? 'WhatsApp desconectado: a mensagem não foi entregue.';
        message = { ...message, deliveryStatus: 'falha' };
      }
    }

    // Só a mensagem — deliberadamente sem `conversation`.
    //
    // Quem escuta substitui a conversa inteira quando ela vem no payload
    // (ver `use-inbox`), e a que temos aqui é o retrato de antes do envio: a
    // mensagem nova não está na timeline dela. Publicá-la faria a bolha recém
    // enviada desaparecer da tela de quem enviou. Sem ela, o cliente anexa a
    // mensagem à conversa que já tem — que é o comportamento correto para um
    // envio, e ainda poupa uma releitura do banco.
    waEventBus.emitConversation({
      type: 'new_message',
      accountId: session.account.id,
      conversationId: parsed.data.conversationId,
      messageId: message.id,
      message,
    });
  }

  /**
   * Cada pessoa mencionada recebe um aviso, e só ela.
   *
   * Quem se menciona sozinho não é avisado: é a mesma razão da atribuição a si
   * mesmo — a pessoa acabou de escrever a nota e sabe o que há nela.
   */
  for (const mencionadoId of result.value.message.mentions ?? []) {
    if (mencionadoId === session.user.id) continue;
    await createNotification({
      accountId: session.account.id,
      userId: mencionadoId,
      kind: 'mencao',
      text: `${session.user.name} mencionou você numa nota na conversa com ${conversation.contact.name}`,
      href: `/conversas/${parsed.data.conversationId}`,
      conversationId: parsed.data.conversationId,
      inboxId: conversation.inboxId,
    });
  }

  void writeAuditLog({
    accountId: session.account.id,
    actorId: session.user.id,
    actorName: session.user.name,
    action: 'mensagem.enviada',
    targetType: 'mensagem',
    targetId: parsed.data.conversationId,
    targetName: conversation.contact.name,
    metadata: {
      conversationId: parsed.data.conversationId,
      messageId: message.id,
      contactName: conversation.contact.name,
      contentType: message.content.type,
      isPrivate: parsed.data.isPrivate,
      length: text.length,
    },
  });

  return dispatchError ? { ok: false, error: dispatchError, message } : { ok: true, message };
}

const deleteMessageSchema = z.object({
  conversationId: z.string().min(1).max(CONVERSATION_ID_MAX_LENGTH),
  messageId: z.string().min(1).max(128),
});

/**
 * Apaga uma mensagem enviada — aqui e no aparelho do contato.
 *
 * Só o que **saiu daqui** pode ser apagado. O WhatsApp não permite remover
 * mensagem de terceiro do aparelho dele, e oferecer o botão assim mesmo criaria
 * a pior das situações: o operador acharia que removeu algo que o cliente
 * continua vendo.
 *
 * O canal vem antes do banco de propósito. Marcar como apagada e só então
 * descobrir que o WhatsApp recusou deixaria a tela dizendo "apagada" sobre uma
 * mensagem que ainda está lá do outro lado — e não há como voltar atrás sem o
 * texto, que este fluxo já teria destruído.
 */
export async function deleteMessageAction(input: unknown): Promise<ActionResult> {
  const parsed = deleteMessageSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Mensagem inválida.' };

  const session = await container.session.getCurrentSession();
  if (!can(session, 'conversas:responder')) {
    return { ok: false, error: 'Sem permissão para apagar mensagens.' };
  }

  const conversation = await container.conversations.findById(
    session.account.id,
    parsed.data.conversationId,
    session.inboxAccess,
  );
  if (!conversation) return { ok: false, error: 'Conversa não encontrada.' };

  const message = await container.conversations.findMessage(
    session.account.id,
    parsed.data.conversationId,
    parsed.data.messageId,
  );
  if (!message) return { ok: false, error: 'Mensagem não encontrada.' };
  if (message.deletedAt) return { ok: true };
  if (message.author === 'contact') {
    return { ok: false, error: 'Só é possível apagar mensagens enviadas por você.' };
  }

  // Nota interna nunca saiu para o canal: apagar é só aqui dentro.
  if (!message.isPrivate && message.externalId && conversation.channel === 'whatsapp') {
    const channel = await getWhatsAppChannel();
    const channelStatus = await channel.getStatus(session.account.id, conversation.inboxId);

    if (channelStatus.status !== 'conectado') {
      return {
        ok: false,
        error: 'WhatsApp desconectado: reconecte para apagar a mensagem também para o contato.',
      };
    }

    const removed = await channel.deleteMessage(
      {
        accountId: session.account.id,
        conversationId: conversation.id,
        messageId: message.id,
        inboxId: conversation.inboxId,
      },
      { channelThreadId: conversation.channelThreadId, phone: conversation.contact.phone },
      message.externalId,
    );

    // `queued` é o motor worker dizendo "aceitei". A exclusão sai da fila em
    // seguida, e não há recibo a esperar — diferente de um envio, aqui não há
    // id novo para carimbar.
    if (!removed.ok) {
      return { ok: false, error: removed.error ?? 'O WhatsApp recusou apagar a mensagem.' };
    }
  }

  const updated = await container.conversations.markMessageDeleted(
    session.account.id,
    parsed.data.conversationId,
    parsed.data.messageId,
  );

  waEventBus.emitConversation({
    type: 'conversation_updated',
    accountId: session.account.id,
    conversationId: parsed.data.conversationId,
    inboxId: conversation.inboxId,
    ...(updated ? { conversation: updated } : {}),
  });

  await writeAuditLog({
    accountId: session.account.id,
    actorId: session.user.id,
    actorName: session.user.name,
    action: 'mensagem.apagada',
    targetType: 'mensagem',
    targetId: parsed.data.conversationId,
    targetName: conversation.contact.name,
    metadata: { messageId: parsed.data.messageId },
  });

  return { ok: true };
}

const changeStatusSchema = z.object({
  conversationId: z.string().min(1).max(CONVERSATION_ID_MAX_LENGTH),
  status: z.enum(CONVERSATION_STATUSES),
});

export interface ChangeStatusResult extends ActionResult {
  /** O que dizer sobre o encerramento automático e a pesquisa de satisfação. */
  readonly aviso?: CsatAviso;
}

export async function changeConversationStatusAction(input: unknown): Promise<ChangeStatusResult> {
  const parsed = changeStatusSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'Status inválido.' };
  }

  const session = await container.session.getCurrentSession();
  const result = await container.useCases.changeConversationStatus({ session, ...parsed.data });
  if (!result.ok) return { ok: false, error: result.error.message };

  // Mensagem automática de encerramento (e pesquisa de satisfação, se ligada).
  // A regra inteira mora em `inbox-auto-messages`, que é o mesmo caminho usado
  // pela ação `resolver_conversa` das automações — antes só o botão da tela
  // disparava o encerramento, e resolver por regra saía calado.
  let csatAviso: CsatAviso | undefined;
  if (parsed.data.status === 'resolvida') {
    try {
      const { runClosingAutoReply } = await import('@/infrastructure/whatsapp/inbox-auto-messages');
      const fechamento = await runClosingAutoReply(session.account.id, parsed.data.conversationId);
      csatAviso = avisoDeFechamento(fechamento);
    } catch (err) {
      console.warn('[conversas] Falha ao despachar mensagem automática de encerramento:', err);
      csatAviso = { tone: 'alerta', text: 'O encerramento automático não pôde ser enviado.' };
    }

    // O protocolo em aberto fecha junto com o atendimento. Antes ele nascia
    // "Em andamento" e ficava assim para sempre, inclusive em conversa
    // resolvida meses atrás.
    await fecharProtocolo(session.account.id, parsed.data.conversationId).catch((err) => {
      console.warn('[conversas] Falha ao fechar o protocolo:', err);
    });
  } else if (parsed.data.status === 'aberta') {
    // Reabrir é um atendimento novo, e atendimento novo tem protocolo novo.
    // `abrirProtocolo` é idempotente: se ainda houver um em aberto, ela o
    // devolve em vez de emitir outro número.
    await abrirProtocolo(session.account.id, parsed.data.conversationId).catch((err) => {
      console.warn('[conversas] Falha ao abrir o protocolo:', err);
    });
  }

  // Só dois dos status têm gatilho; os demais não disparam nada.
  const gatilho =
    parsed.data.status === 'pendente'
      ? ('conversa_pendente' as const)
      : parsed.data.status === 'resolvida'
        ? ('conversa_resolvida' as const)
        : undefined;

  if (gatilho) {
    await dispararAutomacoes({
      accountId: session.account.id,
      trigger: gatilho,
      conversationId: parsed.data.conversationId,
    });
  }

  waEventBus.emitConversation({
    type: 'conversation_updated',
    accountId: session.account.id,
    conversationId: parsed.data.conversationId,
    conversation: result.value,
  });

  // Mudar o status não vira linha de auditoria: resolver e reabrir é o trabalho
  // normal do atendimento, aparece na própria conversa e enchia o registro com
  // dezenas de linhas por dia, empurrando para fora da tela as que importam.
  return { ok: true, ...(csatAviso ? { aviso: csatAviso } : {}) };
}

const conversationIdSchema = z.object({
  conversationId: z.string().min(1).max(CONVERSATION_ID_MAX_LENGTH),
});

/** Abrir a conversa no CRM zera o não-lido e confirma a leitura no celular. */
export async function markConversationReadAction(input: unknown): Promise<ActionResult> {
  const parsed = conversationIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Conversa inválida.' };

  const session = await container.session.getCurrentSession();
  const conversation = await container.conversations.findById(
    session.account.id,
    parsed.data.conversationId,
    session.inboxAccess,
  );
  if (!conversation) return { ok: false, error: 'Conversa não encontrada.' };

  await container.conversations.markAsRead(session.account.id, conversation.id);
  if (conversation.channel === 'whatsapp') {
    const channel = await getWhatsAppChannel();
    await channel.markRead(session.account.id, conversation.id, conversation.inboxId);
  }

  // Os demais atendentes precisam ver que a conversa deixou de estar não lida.
  const updated = await container.conversations.findById(
    session.account.id,
    conversation.id,
    session.inboxAccess,
  );
  if (updated) {
    waEventBus.emitConversation({
      type: 'conversation_updated',
      accountId: session.account.id,
      conversationId: updated.id,
      conversation: updated,
    });
  }

  return { ok: true };
}

/* ==========================================================================
   Triagem: responsável, prioridade e etiquetas.
   ========================================================================== */

/** Depois de escrever, todo mundo precisa ver — inclusive quem não agiu. */
const broadcast = async (conversationId: string) => {
  const session = await container.session.getCurrentSession();
  const updated = await container.conversations.findById(
    session.account.id,
    conversationId,
    session.inboxAccess,
  );
  if (updated) {
    waEventBus.emitConversation({
      type: 'conversation_updated',
      accountId: session.account.id,
      conversationId: updated.id,
      conversation: updated,
    });
  }
  return updated;
};

const assignSchema = z.object({
  conversationId: z.string().min(1).max(CONVERSATION_ID_MAX_LENGTH),
  /** `null` devolve a conversa para a fila geral. */
  assigneeId: z.string().min(1).max(64).nullable(),
});

export async function assignConversationAction(input: unknown): Promise<ActionResult> {
  const parsed = assignSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Dados inválidos para transferência.' };

  const session = await container.session.getCurrentSession();

  // O nome vem do servidor, nunca do payload: o cliente poderia mandar
  // "Camila Reis" apontando para o id de outra pessoa.
  let assignee: { id: string; name: string } | null = null;
  if (parsed.data.assigneeId) {
    const settings = await container.settings.get(session.account.id);
    const member = settings.members.find((user) => user.id === parsed.data.assigneeId);
    if (!member) return { ok: false, error: 'Agente não encontrado nesta conta.' };
    assignee = { id: member.id, name: member.name };
  }

  const result = await container.useCases.assignConversation({
    session,
    conversationId: parsed.data.conversationId,
    assignee,
  });
  if (!result.ok) return { ok: false, error: result.error.message };

  await writeAuditLog({
    accountId: session.account.id,
    actorId: session.user.id,
    actorName: session.user.name,
    action: 'conversa.responsavel',
    targetType: 'conversa',
    targetId: parsed.data.conversationId,
    targetName: result.value.contact.name,
    metadata: assignee
      ? { detalhe: `atribuída a ${assignee.name}`, assigneeId: assignee.id, assigneeName: assignee.name }
      : { detalhe: 'devolvida para a fila' },
  });

  /**
   * O aviso vai para quem recebeu a conversa, e só para ele.
   *
   * Quem **atribuiu a si mesmo** não é avisado: ele acabou de clicar, e um
   * aviso sobre a própria ação é ruído que ensina a ignorar o sininho. Devolver
   * para a fila também não avisa ninguém — não há destinatário, e a conversa
   * volta a aparecer na lista de todos por si só.
   */
  if (assignee && assignee.id !== session.user.id) {
    await createNotification({
      accountId: session.account.id,
      userId: assignee.id,
      kind: 'atribuicao',
      text: `${session.user.name} atribuiu a você a conversa com ${result.value.contact.name}`,
      href: `/conversas/${parsed.data.conversationId}`,
      conversationId: parsed.data.conversationId,
      inboxId: result.value.inboxId,
    });
  }

  await broadcast(parsed.data.conversationId);
  return { ok: true };
}

const prioritySchema = z.object({
  conversationId: z.string().min(1).max(CONVERSATION_ID_MAX_LENGTH),
  priority: z.enum(PRIORITIES),
});

export async function changeConversationPriorityAction(input: unknown): Promise<ActionResult> {
  const parsed = prioritySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Prioridade inválida.' };

  const session = await container.session.getCurrentSession();
  const result = await container.useCases.changeConversationPriority({ session, ...parsed.data });
  if (!result.ok) return { ok: false, error: result.error.message };

  // Sem auditoria, pela mesma razão do status: é operação de fila, não acesso.
  await broadcast(parsed.data.conversationId);
  return { ok: true };
}

const labelsSchema = z.object({
  conversationId: z.string().min(1).max(CONVERSATION_ID_MAX_LENGTH),
  labelIds: z.array(z.string().min(1).max(64)).max(20),
});

export async function setConversationLabelsAction(input: unknown): Promise<ActionResult> {
  const parsed = labelsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Etiquetas inválidas.' };

  const session = await container.session.getCurrentSession();
  const settings = await container.settings.get(session.account.id);

  // Só etiquetas que existem nesta conta: o id chega do cliente.
  const labels = settings.labels.filter((label) => parsed.data.labelIds.includes(label.id));

  const result = await container.useCases.setConversationLabels({
    session,
    conversationId: parsed.data.conversationId,
    labels,
  });
  if (!result.ok) return { ok: false, error: result.error.message };

  // A etiqueta já está gravada; agora as regras que reagem a ela.
  await dispararAutomacoes({
    accountId: session.account.id,
    trigger: 'etiqueta_aplicada',
    conversationId: parsed.data.conversationId,
  });

  await broadcast(parsed.data.conversationId);
  return { ok: true };
}

const contactLabelsSchema = z.object({
  conversationId: z.string().min(1).max(CONVERSATION_ID_MAX_LENGTH),
  contactId: z.string().min(1).max(64),
  labelIds: z.array(z.string().min(1).max(64)).max(20),
});

/**
 * Etiquetas do contato — diferentes das da conversa.
 *
 * A da conversa descreve o atendimento ("Cobrança", "Urgente"); a do contato
 * descreve a pessoa ("VIP", "Revendedor") e vale para todos os atendimentos
 * dela. Por isso são dois controles, e não um.
 */
export async function setContactLabelsAction(input: unknown): Promise<ActionResult> {
  const parsed = contactLabelsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Etiquetas inválidas.' };

  const session = await container.session.getCurrentSession();
  if (!can(session, 'contatos:escrever')) {
    return { ok: false, error: 'Seu papel não permite editar contatos.' };
  }

  const settings = await container.settings.get(session.account.id);
  const labels = settings.labels.filter((label) => parsed.data.labelIds.includes(label.id));

  // Lido **antes** da escrita: o que decide a remoção do card é a etiqueta que
  // o contato tinha e deixou de ter. Depois da escrita esse dado já não existe.
  const anteriores = (
    await container.contacts.findById(session.account.id, parsed.data.contactId)
  )?.labels.map((label) => label.id);

  try {
    const contact = await container.contacts.update(session.account.id, parsed.data.contactId, {
      labels,
    });
    // A conversa carrega uma cópia do contato: sem propagar, a tela mentiria.
    await container.conversations.syncContact(session.account.id, contact);
    await pruneDealsSemEtiquetaDeEtapa(session.account.id, parsed.data.contactId, anteriores ?? []);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Erro ao etiquetar o contato.',
    };
  }

  // Etiqueta de contato também dispara: a regra "VIP → mover para Negociação"
  // deve valer quando a pessoa é marcada como VIP, não só a conversa.
  await dispararAutomacoes({
    accountId: session.account.id,
    trigger: 'etiqueta_aplicada',
    conversationId: parsed.data.conversationId,
  });

  await broadcast(parsed.data.conversationId);
  return { ok: true };
}

/**
 * Tira do funil o contato que perdeu a última etiqueta de etapa.
 *
 * Uma etapa pode declarar a etiqueta que a representa; o conjunto dessas
 * etiquetas é o que coloca um contato no quadro. Perder a última delas é
 * dizer que ele não está em etapa nenhuma — e um card fora de coluna não
 * existe, então ele é apagado.
 *
 * A condição é ter perdido, não estar sem: o card criado à mão para um contato
 * que nunca teve etiqueta de etapa continua onde está. Apagá-lo seria fazer um
 * card sumir logo depois de alguém criá-lo, sem que ninguém tivesse mexido em
 * etiqueta nenhuma.
 *
 * Silenciosa em caso de falha, e de propósito: etiquetar é a ação que a pessoa
 * pediu e ela deu certo. Recusar a ação inteira porque a limpeza do quadro
 * falhou trocaria um quadro desatualizado por uma etiqueta não aplicada.
 */
const pruneDealsSemEtiquetaDeEtapa = async (
  accountId: string,
  contactId: string,
  anteriores: readonly string[],
): Promise<void> => {
  try {
    const pipelines = await container.pipelines.listPipelines(accountId);
    const deEtapa = stageLabelIds(pipelines);
    if (deEtapa.size === 0) return;

    const tinha = anteriores.some((id) => deEtapa.has(id));
    if (!tinha) return;

    const contact = await container.contacts.findById(accountId, contactId);
    const continua = contact?.labels.some((label) => deEtapa.has(label.id)) ?? true;
    if (continua) return;

    const removidos = await container.pipelines.deleteDealsOfContact(accountId, contactId);
    if (removidos > 0) revalidatePath('/kanban');
  } catch (error) {
    console.error('[conversas] Falha ao remover os cards do contato sem etiqueta de etapa:', error);
  }
};

/* ==========================================================================
   Conversar com um contato a partir da agenda.

   Dois caminhos, e a diferença é quem começou: quem já nos escreveu tem
   conversa, e o botão só leva até ela. Quem foi cadastrado à mão nunca escreveu
   — não há conversa, não há caixa escolhida e não há mensagem. Aí é preciso
   dizer as três coisas antes de qualquer coisa sair.
   ========================================================================== */

/** Caixa de WhatsApp por onde uma mensagem pode sair. */
export interface CaixaDisponivel {
  readonly id: string;
  readonly name: string;
  /** O número pareado, quando há um. É por ele que a pessoa reconhece a caixa. */
  readonly identifier: string;
  readonly conectada: boolean;
}

export interface ContactConversationResult {
  readonly ok: boolean;
  readonly error?: string;
  /** Conversa que já existe — a tela navega direto para ela. */
  readonly conversationId?: string;
  /** Ausente a conversa, as caixas por onde a primeira mensagem pode sair. */
  readonly caixas?: readonly CaixaDisponivel[];
  /** Mais de um destinatário exige escolha antes de procurar/criar conversa. */
  readonly phoneSelectionRequired?: boolean;
  readonly phones?: readonly DestinoPossivel[];
}

/**
 * Um destinatário possível, com o dono e a classificação do número.
 *
 * Era uma lista de strings, e ela não respondia a pergunta de quem escolhe: numa
 * empresa com dois sócios e cinco telefones, cinco números soltos não dizem de
 * quem é cada um nem qual vale a pena tentar primeiro. O agrupamento por sócio
 * e a classificação do número são exatamente o critério da prospecção.
 */
export interface DestinoPossivel {
  readonly phone: string;
  /** Nome do sócio dono do número. Vazio quando é o telefone da empresa. */
  readonly partnerName: string;
  readonly classification: string;
}

const contactConversationSchema = z.object({
  contactId: z.string().min(1).max(64),
  recipientPhone: z.string().trim().max(30).optional(),
});

/**
 * Descreve cada número do contato com o dono e a classificação.
 *
 * **A lista de números continua sendo a autoridade.** Ela sai de
 * `phone`/`extraPhones`, que são as colunas contra as quais o envio valida o
 * destinatário; `partners` só acrescenta de quem é cada um. Um número que
 * estivesse em `partners` e não naquelas colunas não apareceria aqui, e é o
 * comportamento certo: oferecer um destino que o envio depois recusaria seria
 * pior que não oferecê-lo.
 *
 * A ordem agrupa por sócio, e o telefone da empresa vai para o fim: quem
 * prospecta quer falar com a pessoa, e o fixo da recepção é o último recurso.
 */
const destinosDe = (
  contact: { partners?: readonly ContactPartner[] },
  phones: readonly string[],
): readonly DestinoPossivel[] => {
  const dono = new Map<string, { partnerName: string; classification: string }>();
  for (const socio of contact.partners ?? []) {
    for (const telefone of socio.phones) {
      dono.set(telefone.phone, {
        partnerName: socio.name,
        classification: telefone.classification ?? '',
      });
    }
  }

  return phones
    .map((phone) => ({
      phone,
      partnerName: dono.get(phone)?.partnerName ?? '',
      classification: dono.get(phone)?.classification ?? '',
    }))
    .sort((a, b) => {
      if (!a.partnerName !== !b.partnerName) return a.partnerName ? -1 : 1;
      return a.partnerName.localeCompare(b.partnerName, 'pt-BR');
    });
};

/**
 * Existe conversa com este contato? Se não, por onde ela poderia começar.
 *
 * Uma chamada só devolve as duas respostas de propósito: são a mesma pergunta
 * do ponto de vista de quem clicou em "conversar", e separá-las faria a tela
 * decidir sozinha qual fazer — com o risco de perguntar a caixa para quem já
 * tem conversa aberta.
 */
export async function findContactConversationAction(
  input: unknown,
): Promise<ContactConversationResult> {
  const parsed = contactConversationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Contato inválido.' };

  const session = await container.session.getCurrentSession();
  if (!can(session, 'conversas:ler')) {
    return { ok: false, error: 'Seu papel não permite abrir conversas.' };
  }

  const contact = await container.contacts.findById(session.account.id, parsed.data.contactId);
  if (!contact) return { ok: false, error: 'Contato não encontrado.' };

  const phones = [...new Set([contact.phone, ...(contact.extraPhones ?? [])].filter(Boolean))];
  if (phones.length > 1 && !parsed.data.recipientPhone) {
    return { ok: true, phoneSelectionRequired: true, phones: destinosDe(contact, phones) };
  }

  const recipientPhone = parsed.data.recipientPhone ?? phones[0];
  if (recipientPhone && !phones.includes(recipientPhone)) {
    return { ok: false, error: 'O telefone escolhido não pertence a este contato.' };
  }

  const existente = await findContactConversation(
    session.account.id,
    contact.id,
    session.inboxAccess,
    recipientPhone,
  );
  if (existente) return { ok: true, conversationId: existente.id };

  if (!contact.phone.trim() && contact.kind !== 'grupo') {
    return { ok: false, error: 'Este contato não tem telefone cadastrado.' };
  }

  return { ok: true, caixas: await caixasDeWhatsApp(session, contact) };
}

/**
 * As caixas de WhatsApp que esta sessão alcança, com o estado da conexão.
 *
 * O estado acompanha a lista em vez de filtrar por ele: uma caixa
 * desconectada ainda é uma escolha legítima — a mensagem fica gravada e sai
 * quando o número voltar. Esconder a caixa faria a pessoa procurar por uma
 * opção que existe.
 */
const caixasDeWhatsApp = async (
  session: Awaited<ReturnType<typeof container.session.getCurrentSession>>,
  contact?: Pick<Contact, 'kind' | 'customFields'>,
): Promise<readonly CaixaDisponivel[]> => {
  const settings = await container.settings.get(session.account.id);

  /**
   * Num grupo, só entram as caixas cujo número é membro.
   *
   * Participar de um grupo é do número, não da conta — e o contato de grupo é
   * da conta. Oferecer todas as caixas levava a escolher um número que não
   * está no grupo: o WhatsApp recusava com `not-authorized` e a mensagem já
   * estava gravada na conversa. Aparecia como "envio não autorizado" sem
   * nenhuma pista de que o problema era o número escolhido.
   *
   * Lista vazia significa **desconhecido**, não "nenhuma": são os grupos
   * sincronizados antes deste campo existir. Para eles nada é filtrado — o
   * comportamento antigo continua até a próxima sincronização, que é quando a
   * informação passa a existir.
   */
  const doGrupo = contact?.kind === 'grupo' ? groupInboxIds(contact) : [];

  return settings.connections
    .filter(
      (connection) =>
        connection.channel === 'whatsapp' &&
        canSeeInbox(session, connection.id) &&
        (doGrupo.length === 0 || doGrupo.includes(connection.id)),
    )
    .map((connection) => ({
      id: connection.id,
      name: connection.name,
      identifier: connection.identifier,
      conectada: connection.status === 'conectado',
    }));
};

const startContactConversationSchema = z.object({
  contactId: z.string().min(1).max(64),
  inboxId: z.string().min(1).max(64),
  text: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
  recipientPhone: z.string().trim().min(8).max(30).optional(),
});

/**
 * Abre a conversa na caixa escolhida e manda a primeira mensagem.
 *
 * A caixa é escolhida, não adivinhada: ela é o número que aparece no telefone
 * de quem recebe. Com mais de um número conectado, deixar o sistema escolher
 * significa o cliente receber uma mensagem de um número que ele não conhece —
 * e responder para lá, onde ninguém está olhando.
 */
export async function startContactConversationAction(
  input: unknown,
): Promise<SendMessageResult & { readonly conversationId?: string }> {
  const parsed = startContactConversationSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'Dados inválidos para iniciar a conversa.' };
  }

  const session = await container.session.getCurrentSession();
  if (!can(session, 'conversas:responder')) {
    return { ok: false, error: 'Seu papel não permite enviar mensagens.' };
  }
  if (!canSeeInbox(session, parsed.data.inboxId)) {
    return { ok: false, error: 'Você não tem acesso a esta caixa de entrada.' };
  }

  const contact = await container.contacts.findById(session.account.id, parsed.data.contactId);
  if (!contact) return { ok: false, error: 'Contato não encontrado.' };

  const phones = [...new Set([contact.phone, ...(contact.extraPhones ?? [])].filter(Boolean))];
  if (contact.kind !== 'grupo' && !parsed.data.recipientPhone) {
    return { ok: false, error: 'Escolha o telefone que receberá a mensagem.' };
  }
  if (parsed.data.recipientPhone && !phones.includes(parsed.data.recipientPhone)) {
    return { ok: false, error: 'O telefone escolhido não pertence a este contato.' };
  }

  const settings = await container.settings.get(session.account.id);
  const inbox = settings.connections.find((item) => item.id === parsed.data.inboxId);
  if (!inbox || inbox.channel !== 'whatsapp') {
    return { ok: false, error: 'Caixa de entrada inválida para WhatsApp.' };
  }

  let conversationId: string;
  try {
    const aberta = await openOutboundConversation({
      accountId: session.account.id,
      inboxId: parsed.data.inboxId,
      contact,
      recipientPhone: parsed.data.recipientPhone,
    });
    conversationId = aberta.id;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Erro ao abrir a conversa.',
    };
  }

  // O envio reaproveita o caminho normal inteiro — janela de 24h, despacho
  // pelo canal, recibo, eventos de tempo real. Uma segunda implementação aqui
  // seria a que esquece metade dessas coisas.
  const enviado = await sendMessageAction({
    conversationId,
    text: parsed.data.text,
    isPrivate: false,
  });

  /**
   * Quem abriu a conversa com este cliente, e por qual número.
   *
   * É a pergunta que o histórico não respondia. Conversa recebida nasce de um
   * cliente que procurou a empresa; esta nasce de alguém aqui dentro decidindo
   * abordar alguém lá fora — numa base de prospecção, é a linha que diz quem
   * usou a lista e para qual telefone. `mensagem.enviada` registra o conteúdo,
   * mas não distingue a primeira mensagem da centésima.
   *
   * Depois do envio, e só quando ele deu certo: uma conversa aberta cuja
   * mensagem falhou não é abordagem nenhuma. `void` porque auditoria não
   * atrasa a resposta da tela.
   */
  if (enviado.ok) {
    void writeAuditLog({
      accountId: session.account.id,
      actorId: session.user.id,
      actorName: session.user.name,
      action: 'conversa.iniciada',
      targetType: 'conversa',
      targetId: conversationId,
      targetName: contact.name,
      metadata: {
        detalhe: `para ${parsed.data.recipientPhone ?? contact.phone}`,
        contactId: contact.id,
        inboxId: parsed.data.inboxId,
        ...(contact.company ? { empresa: contact.company } : {}),
      },
    });
  }

  revalidatePath('/conversas');
  revalidatePath('/contatos');

  return { ...enviado, conversationId };
}

/* ==========================================================================
   Template HSM — a saída do bloqueio de 24h.
   ========================================================================== */

const templateSchema = z.object({
  conversationId: z.string().min(1).max(CONVERSATION_ID_MAX_LENGTH),
  templateId: z.string().min(1).max(64),
  values: z.array(z.string().trim().max(300)).max(10),
});

export async function sendTemplateAction(input: unknown): Promise<SendMessageResult> {
  const parsed = templateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Dados inválidos para o template.' };

  const session = await container.session.getCurrentSession();
  const templates = await container.campaigns.listTemplates(session.account.id);
  const template = templates.find((item) => item.id === parsed.data.templateId);
  if (!template) return { ok: false, error: 'Template não encontrado.' };

  const conversation = await container.conversations.findById(
    session.account.id,
    parsed.data.conversationId,
    session.inboxAccess,
  );

  const result = await container.useCases.sendTemplate({
    session,
    conversationId: parsed.data.conversationId,
    template,
    values: parsed.data.values,
  });
  if (!result.ok) return { ok: false, error: result.error.message };

  let message = result.value;
  let dispatchError: string | undefined;

  if (conversation?.channel === 'whatsapp' && message.content.type === 'template') {
    const text = message.content.text;
    const channel = await getWhatsAppChannel();
    const channelStatus = await channel.getStatus(session.account.id, conversation.inboxId);

    if (channelStatus.status === 'conectado') {
      const sent = await channel.sendText(
        {
          accountId: session.account.id,
          conversationId: conversation.id,
          messageId: message.id,
          inboxId: conversation.inboxId,
        },
        { channelThreadId: conversation.channelThreadId, phone: conversation.contact.phone },
        text,
      );
      const applied = await applyDispatch(session.account.id, conversation.id, message, sent);
      message = applied.message;
      dispatchError = applied.error;
    } else {
      dispatchError = channelStatus.error ?? 'WhatsApp desconectado: o template não foi entregue.';
      message = { ...message, deliveryStatus: 'falha' };
    }
  }

  const updated = await container.conversations.findById(
    session.account.id,
    parsed.data.conversationId,
    session.inboxAccess,
  );
  waEventBus.emitConversation({
    type: 'new_message',
    accountId: session.account.id,
    conversationId: parsed.data.conversationId,
    messageId: message.id,
    message,
    conversation: updated ?? undefined,
  });

  // O template é uma mensagem que sai para o cliente como qualquer outra, e é
  // assim que a auditoria a registra. O que a distingue vai no metadata: só
  // pelo `templateId` dá para saber depois qual texto aprovado foi disparado.
  void writeAuditLog({
    accountId: session.account.id,
    actorId: session.user.id,
    actorName: session.user.name,
    action: 'mensagem.enviada',
    targetType: 'mensagem',
    targetId: parsed.data.conversationId,
    ...(conversation ? { targetName: conversation.contact.name } : {}),
    metadata: {
      conversationId: parsed.data.conversationId,
      messageId: message.id,
      ...(conversation ? { contactName: conversation.contact.name } : {}),
      contentType: message.content.type,
      isPrivate: false,
      templateId: parsed.data.templateId,
      templateName: template.name,
    },
  });

  return dispatchError ? { ok: false, error: dispatchError, message } : { ok: true, message };
}

/* ==========================================================================
   Anexos de saída.
   ========================================================================== */

/** 16 MB é o teto prático do WhatsApp para mídia comum. */
const MAX_UPLOAD_BYTES = 16 * 1024 * 1024;

const MEDIA_KINDS = ['image', 'video', 'audio', 'document'] as const;
type MediaKind = (typeof MEDIA_KINDS)[number];

/**
 * Tipos aceitos por categoria.
 *
 * Lista de permissão, não de bloqueio: o arquivo será servido de volta pela
 * rota de mídia, e qualquer coisa fora desta lista sai como download forçado
 * em vez de ser renderizada. `document` aceita o resto por eliminação.
 */
const ALLOWED_MIME: Readonly<Record<MediaKind, readonly string[]>> = {
  // `heic`/`heif` são o padrão da câmera do iPhone: sem eles, mandar uma foto
  // do celular — o caso mais comum de todos — era recusado.
  image: [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/heic',
    'image/heif',
    'image/bmp',
    'image/tiff',
  ],
  video: ['video/mp4', 'video/webm', 'video/quicktime', 'video/3gpp', 'video/x-matroska'],
  // `audio/x-m4a` e `audio/opus` aparecem conforme o navegador e o sistema:
  // o mesmo arquivo `.m4a` chega como `audio/mp4` no Chrome e `audio/x-m4a` no
  // Safari, e recusar um dos dois é recusar metade dos usuários.
  audio: [
    'audio/ogg',
    'audio/opus',
    'audio/mpeg',
    'audio/mp3',
    'audio/mp4',
    'audio/x-m4a',
    'audio/aac',
    'audio/webm',
    'audio/wav',
    'audio/x-wav',
  ],
  document: [
    'application/pdf',
    'application/zip',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'text/csv',
    'application/rtf',
    'application/x-rar-compressed',
    'application/vnd.rar',
    'application/x-7z-compressed',
    // Alguns navegadores não reconhecem a extensão e mandam o arquivo sem tipo;
    // `baseMimeOf` traduz isso para `application/octet-stream`. Recusar aí seria
    // recusar o arquivo por causa do palpite do navegador, não do conteúdo — e
    // documento é justamente a categoria que aceita qualquer coisa.
    'application/octet-stream',
  ],
};

/** Nome da categoria em português, para a mensagem de erro não falar em código. */
const KIND_LABEL: Readonly<Record<MediaKind, string>> = {
  image: 'imagem',
  video: 'vídeo',
  audio: 'áudio',
  document: 'documento',
};

/** O parâmetro `codecs=` faz parte do tipo, mas não da comparação. */
const baseMimeOf = (value: string): string => (value.split(';')[0] ?? '').trim().toLowerCase();

const humanSize = (bytes: number): string =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const secondsLabel = (seconds: number): string => {
  const whole = Math.max(1, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};

/**
 * Envia um anexo.
 *
 * Recebe `FormData` porque o arquivo nunca deve passar por base64 num payload
 * JSON: inflaria 33% e ainda teria de ser decodificado do outro lado.
 */
export async function sendMediaAction(form: FormData): Promise<SendMessageResult> {
  const conversationId = String(form.get('conversationId') ?? '');
  const kindRaw = String(form.get('kind') ?? '');
  const caption = String(form.get('caption') ?? '')
    .trim()
    .slice(0, 1024);
  const isPrivate = form.get('isPrivate') === 'true';
  const voice = form.get('voice') === 'true';
  const durationSeconds = Number(form.get('durationSeconds') ?? 0);
  // Responder com anexo é responder. O compositor já mostrava a citação em cima
  // do campo ao anexar uma imagem, e ela era descartada em silêncio no envio:
  // este campo nunca era lido, e `sendMedia` nem o aceitava.
  const replyToIdRaw = String(form.get('replyToId') ?? '').trim();
  const replyToId = replyToIdRaw && replyToIdRaw.length <= 128 ? replyToIdRaw : undefined;
  const file = form.get('file');

  if (!conversationId || conversationId.length > 64) {
    return { ok: false, error: 'Conversa inválida.' };
  }
  if (!MEDIA_KINDS.includes(kindRaw as MediaKind)) {
    // A mensagem nomeia o que chegou porque o valor vem do formulário: quando
    // ela apareceu em produção para **todo** anexo, o motivo era o campo vindo
    // vazio, e um "tipo inválido" sem o valor não deixava isso visível.
    return {
      ok: false,
      error: `Tipo de anexo inválido${kindRaw ? `: "${kindRaw}"` : ' (categoria não informada)'}.`,
    };
  }
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: 'Nenhum arquivo recebido.' };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      error: `O arquivo tem ${humanSize(file.size)}. O limite é ${humanSize(MAX_UPLOAD_BYTES)}.`,
    };
  }

  const kind = kindRaw as MediaKind;
  const mimeType = baseMimeOf(file.type) || 'application/octet-stream';
  if (!ALLOWED_MIME[kind].includes(mimeType)) {
    return {
      ok: false,
      error: `Arquivos ${mimeType} não são aceitos como ${KIND_LABEL[kind]}.`,
    };
  }

  const session = await container.session.getCurrentSession();
  const conversation = await container.conversations.findById(
    session.account.id,
    conversationId,
    session.inboxAccess,
  );
  if (!conversation) return { ok: false, error: 'Conversa não encontrada.' };

  // Anexo público fora da janela HSM é tão bloqueado quanto texto livre.
  if (!isPrivate && !canSendFreeText(conversation)) {
    return {
      ok: false,
      error: 'Janela de 24h encerrada: envie um template aprovado antes de mandar anexos.',
    };
  }

  const data = Buffer.from(await file.arrayBuffer());
  const mediaId = `out-${randomUUID()}`;
  // O anexo enviado tambem vai para o Storage: e o que permite o worker — que
  // roda noutro processo, e pode rodar noutra maquina — ler os bytes que esta
  // requisicao acabou de receber.
  const url = await mediaStore.save(
    mediaId,
    data,
    { mimeType, fileName: file.name },
    { accountId: session.account.id, inboxId: conversation.inboxId, kind: 'mensagem' },
  );
  if (!url) return { ok: false, error: 'Não foi possível guardar o anexo.' };

  const content: MessageContent =
    kind === 'image'
      ? { type: 'image', url, ...(caption ? { caption } : {}) }
      : kind === 'video'
        ? { type: 'video', url, mimeType, ...(caption ? { caption } : {}) }
        : kind === 'audio'
          ? {
              type: 'audio',
              duration: secondsLabel(durationSeconds),
              url,
              mimeType,
              ...(voice ? { voice: true } : {}),
            }
          : {
              type: 'document',
              fileName: file.name || 'arquivo',
              size: humanSize(file.size),
              url,
            };

  const result = await container.useCases.sendMedia({
    session,
    conversationId,
    content,
    isPrivate,
    ...(replyToId ? { replyToId } : {}),
  });
  if (!result.ok) return { ok: false, error: result.error.message };

  let message = result.value;
  let dispatchError: string | undefined;

  // Nota interna nunca sai para o canal externo — vale para anexo também.
  if (!isPrivate && conversation.channel === 'whatsapp') {
    const channel = await getWhatsAppChannel();
    const channelStatus = await channel.getStatus(session.account.id, conversation.inboxId);

    if (channelStatus.status === 'conectado') {
      // Mesma regra do envio de texto: a citação só viaja se a citada existir
      // no canal (`externalId`) e não for nota interna — ver `sendMessageAction`.
      const quotedMessage = replyToId
        ? await container.conversations.findMessage(session.account.id, conversation.id, replyToId)
        : null;

      // Só o identificador viaja para o canal: os bytes já estão no depósito
      // (`mediaStore.save` acima), e é de lá que os dois motores os leem.
      const sent = await channel.sendMedia(
        {
          accountId: session.account.id,
          conversationId: conversation.id,
          messageId: message.id,
          inboxId: conversation.inboxId,
        },
        { channelThreadId: conversation.channelThreadId, phone: conversation.contact.phone },
        {
          kind,
          mediaId,
          mimeType: file.type || mimeType,
          ...(file.name ? { fileName: file.name } : {}),
          ...(caption ? { caption } : {}),
          ...(voice ? { voice: true } : {}),
        },
        quotedMessage?.externalId && !quotedMessage.isPrivate
          ? {
              externalId: quotedMessage.externalId,
              fromMe: quotedMessage.author !== 'contact',
              text: previewOfMessage(quotedMessage),
            }
          : undefined,
      );
      const applied = await applyDispatch(session.account.id, conversation.id, message, sent);
      message = applied.message;
      dispatchError = applied.error;
    } else {
      dispatchError = channelStatus.error ?? 'WhatsApp desconectado: o anexo não foi entregue.';
      message = { ...message, deliveryStatus: 'falha' };
    }
  }

  const updated = await container.conversations.findById(
    session.account.id,
    conversationId,
    session.inboxAccess,
  );
  waEventBus.emitConversation({
    type: 'new_message',
    accountId: session.account.id,
    conversationId,
    messageId: message.id,
    message,
    conversation: updated ?? undefined,
  });

  return dispatchError ? { ok: false, error: dispatchError, message } : { ok: true, message };
}

/* ==========================================================================
   Mover o atendimento de caixa de entrada.
   ========================================================================== */

const moveInboxSchema = z.object({
  conversationId: z.string().min(1).max(CONVERSATION_ID_MAX_LENGTH),
  inboxId: z.string().min(1).max(64),
});

/**
 * Move a conversa para outra caixa.
 *
 * Toda a regra vive no caso de uso — inclusive a decisão de desatribuir quem
 * não alcança a caixa de destino. Aqui só entra a validação da entrada e o
 * anúncio: a conversa muda de lugar, e as telas abertas precisam saber.
 *
 * O evento carrega a conversa já atualizada; quem estiver com a caixa de origem
 * aberta e não alcançar o destino simplesmente para de recebê-la — o filtro da
 * rota de SSE cuida disso.
 */
export async function moveConversationToInboxAction(input: unknown): Promise<ActionResult> {
  const parsed = moveInboxSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Dados inválidos para mover a conversa.' };

  const session = await container.session.getCurrentSession();
  const result = await container.useCases.moveConversationInbox({
    session,
    conversationId: parsed.data.conversationId,
    targetInboxId: parsed.data.inboxId,
  });
  if (!result.ok) return { ok: false, error: result.error.message };

  waEventBus.emitConversation({
    type: 'conversation_updated',
    accountId: session.account.id,
    conversationId: parsed.data.conversationId,
    inboxId: parsed.data.inboxId,
    conversation: result.value,
  });

  return { ok: true };
}

/* ==========================================================================
   Notificação de digitação do atendente para o contato (presença).
   ========================================================================== */

const setTypingSchema = z.object({
  conversationId: z.string().min(1).max(CONVERSATION_ID_MAX_LENGTH),
  isTyping: z.boolean(),
});

export async function setOperatorTypingAction(input: unknown): Promise<ActionResult> {
  const parsed = setTypingSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Dados inválidos.' };

  const session = await container.session.getCurrentSession();
  if (!session?.account?.id) return { ok: false, error: 'Sessão inválida.' };

  const conversation = await container.conversations.findById(
    session.account.id,
    parsed.data.conversationId,
    session.inboxAccess,
  );
  if (!conversation || conversation.channel !== 'whatsapp') return { ok: true };

  const channel = await getWhatsAppChannel();
  if (channel.sendPresence) {
    await channel.sendPresence(
      {
        accountId: session.account.id,
        inboxId: conversation.inboxId,
        conversationId: conversation.id,
      },
      {
        channelThreadId: conversation.channelThreadId,
        phone: conversation.contact.phone,
      },
      parsed.data.isTyping ? 'composing' : 'paused',
    );
  }

  return { ok: true };
}

/* ==========================================================================
   Reações
   ========================================================================== */

const reactSchema = z.object({
  conversationId: z.string().min(1).max(CONVERSATION_ID_MAX_LENGTH),
  messageId: z.string().min(1).max(128),
  /**
   * Vazio **retira** a reação.
   *
   * Não é um caso de borda inventado aqui: é como o WhatsApp representa a
   * remoção — a mesma mensagem de reação, com texto vazio. Um endpoint separado
   * para tirar seria um segundo caminho para a mesma coisa.
   */
  emoji: z.string().max(24),
});

export async function reactToMessageAction(input: unknown): Promise<ActionResult> {
  const parsed = reactSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Reação inválida.' };

  const session = await container.session.getCurrentSession();
  if (!can(session, 'conversas:responder')) {
    return { ok: false, error: 'Sem permissão para reagir a mensagens.' };
  }

  const conversation = await container.conversations.findById(
    session.account.id,
    parsed.data.conversationId,
    session.inboxAccess,
  );
  if (!conversation) return { ok: false, error: 'Conversa não encontrada.' };

  const message = await container.conversations.findMessage(
    session.account.id,
    conversation.id,
    parsed.data.messageId,
  );
  if (!message) return { ok: false, error: 'Mensagem não encontrada.' };
  if (message.deletedAt) return { ok: false, error: 'Esta mensagem foi apagada.' };
  if (message.isPrivate) {
    return { ok: false, error: 'Notas internas não recebem reação.' };
  }

  const emoji = parsed.data.emoji.trim();

  // Só sai para o canal o que existe **no canal**. Uma mensagem que nunca foi
  // entregue não tem chave lá fora, e reagir a ela é um gesto interno.
  if (message.externalId && conversation.channel === 'whatsapp') {
    const channel = await getWhatsAppChannel();
    const channelStatus = await channel.getStatus(session.account.id, conversation.inboxId);

    if (channelStatus.status !== 'conectado') {
      return {
        ok: false,
        error: 'WhatsApp desconectado: reconecte para reagir à mensagem.',
      };
    }

    const sent = await channel.sendReaction(
      {
        accountId: session.account.id,
        conversationId: conversation.id,
        messageId: message.id,
        inboxId: conversation.inboxId,
      },
      { channelThreadId: conversation.channelThreadId, phone: conversation.contact.phone },
      {
        externalId: message.externalId,
        fromMe: message.author !== 'contact',
        // Em grupo, a chave precisa dizer quem escreveu a mensagem reagida.
        ...(message.senderJid ? { participant: message.senderJid } : {}),
      },
      emoji,
    );

    if (!sent.ok) {
      return { ok: false, error: sent.error ?? 'O WhatsApp recusou a reação.' };
    }
  }

  /**
   * A gravação local acontece **sempre**, inclusive quando o motor worker só
   * enfileirou o envio.
   *
   * O eco do WhatsApp devolve a mesma reação em seguida, e `applyReaction` é
   * idempotente: aplicar duas vezes o mesmo emoji do mesmo autor não muda nada
   * e não republica evento. O que se ganha é a reação aparecendo na tela no
   * instante do clique, em vez de depois da ida e volta ao servidor do
   * WhatsApp.
   */
  await applyReaction(message.externalId ?? message.id, {
    emoji,
    actorId: 'me',
    by: 'agent',
    authorName: session.user.name,
  });

  return { ok: true };
}

/* ==========================================================================
   Mensagens agendadas
   ========================================================================== */

const scheduleSchema = z.object({
  conversationId: z.string().min(1).max(CONVERSATION_ID_MAX_LENGTH),
  text: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
  isPrivate: z.boolean(),
  replyToId: z.string().min(1).max(128).optional(),
  /** Instante do disparo em ISO — a tela converte do campo local para cá. */
  scheduledFor: z.string().min(1).max(40),
});

export interface ScheduledMessagesResult extends ActionResult {
  readonly items?: readonly ScheduledMessage[];
}

const scheduledRow = (row: {
  id: string;
  conversationId: string;
  text: string;
  isPrivate: boolean;
  scheduledFor: Date;
  status: string;
  userName: string;
  error: string | null;
}): ScheduledMessage => ({
  id: row.id,
  conversationId: row.conversationId,
  text: row.text,
  isPrivate: row.isPrivate,
  scheduledFor: row.scheduledFor.toISOString(),
  status: row.status as ScheduledMessage['status'],
  authorName: row.userName,
  ...(row.error ? { error: row.error } : {}),
});

const SCHEDULED_SELECT = {
  id: true,
  conversationId: true,
  text: true,
  isPrivate: true,
  scheduledFor: true,
  status: true,
  userName: true,
  error: true,
} as const;

export async function scheduleMessageAction(input: unknown): Promise<ScheduledMessagesResult> {
  const parsed = scheduleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Dados inválidos para o agendamento.' };

  const session = await container.session.getCurrentSession();
  if (!can(session, 'conversas:responder')) {
    return { ok: false, error: 'Sem permissão para agendar mensagens.' };
  }

  const quando = new Date(parsed.data.scheduledFor);
  if (Number.isNaN(quando.getTime())) {
    return { ok: false, error: 'Data e hora inválidas.' };
  }

  const daqui = quando.getTime() - Date.now();
  if (daqui < MIN_SCHEDULE_LEAD_MS) {
    return { ok: false, error: 'Escolha um horário pelo menos um minuto à frente.' };
  }
  if (daqui > MAX_SCHEDULE_AHEAD_MS) {
    return { ok: false, error: 'O agendamento não pode passar de um ano.' };
  }

  const conversation = await container.conversations.findById(
    session.account.id,
    parsed.data.conversationId,
    session.inboxAccess,
  );
  if (!conversation) return { ok: false, error: 'Conversa não encontrada.' };

  /**
   * A assinatura entra agora, não na hora de enviar.
   *
   * É a mesma razão de `sendMessageAction`: o texto guardado tem de ser o texto
   * que o cliente vai receber. Se a pessoa desligar a assinatura amanhã, a
   * mensagem que ela revisou hoje continua sendo a que sai.
   */
  const text = parsed.data.isPrivate
    ? parsed.data.text
    : withSignature(session.user, parsed.data.text);

  await prisma.scheduledMessage.create({
    data: {
      accountId: session.account.id,
      conversationId: conversation.id,
      inboxId: conversation.inboxId,
      userId: session.user.id,
      userName: session.user.name,
      text,
      isPrivate: parsed.data.isPrivate,
      replyToId: parsed.data.replyToId ?? null,
      scheduledFor: quando,
      status: 'pending',
    },
  });

  return listScheduledMessagesAction({ conversationId: conversation.id });
}

export async function listScheduledMessagesAction(
  input: unknown,
): Promise<ScheduledMessagesResult> {
  const parsed = conversationIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Conversa inválida.' };

  const session = await container.session.getCurrentSession();
  const conversation = await container.conversations.findById(
    session.account.id,
    parsed.data.conversationId,
    session.inboxAccess,
  );
  if (!conversation) return { ok: false, error: 'Conversa não encontrada.' };

  // Só o que ainda vai acontecer. O que já saiu virou mensagem na timeline, e
  // repeti-lo aqui mostraria a mesma coisa duas vezes.
  const rows = await prisma.scheduledMessage.findMany({
    where: {
      accountId: session.account.id,
      conversationId: conversation.id,
      status: { in: ['pending', 'sending'] },
    },
    orderBy: { scheduledFor: 'asc' },
    select: SCHEDULED_SELECT,
  });

  return { ok: true, items: rows.map(scheduledRow) };
}

const cancelScheduleSchema = z.object({
  conversationId: z.string().min(1).max(CONVERSATION_ID_MAX_LENGTH),
  scheduledMessageId: z.string().min(1).max(64),
});

export async function cancelScheduledMessageAction(
  input: unknown,
): Promise<ScheduledMessagesResult> {
  const parsed = cancelScheduleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Agendamento inválido.' };

  const session = await container.session.getCurrentSession();
  if (!can(session, 'conversas:responder')) {
    return { ok: false, error: 'Sem permissão para cancelar agendamentos.' };
  }

  const conversation = await container.conversations.findById(
    session.account.id,
    parsed.data.conversationId,
    session.inboxAccess,
  );
  if (!conversation) return { ok: false, error: 'Conversa não encontrada.' };

  /**
   * Só cancela o que ainda está `pending`.
   *
   * O `updateMany` condicional é a trava: entre a tela mostrar o botão e o
   * clique chegar aqui, o varredor pode ter pegado a linha. Cancelar uma
   * mensagem que já saiu seria apagar do CRM algo que o cliente recebeu.
   */
  const { count } = await prisma.scheduledMessage.updateMany({
    where: {
      id: parsed.data.scheduledMessageId,
      accountId: session.account.id,
      conversationId: conversation.id,
      status: 'pending',
    },
    data: { status: 'canceled' },
  });

  const atual = await listScheduledMessagesAction({ conversationId: conversation.id });
  if (count === 0) {
    return { ...atual, ok: false, error: 'Este agendamento já saiu e não pode ser cancelado.' };
  }
  return atual;
}
