import {
  isJidGroup,
  isLidUser,
  normalizeMessageContent,
  proto,
  type WAMessage,
} from '@whiskeysockets/baileys';
import type { Message } from '@/core/domain/message';
import { seal } from '../auth/crypto';
import { isSupportedChatJid, type ChatIdentity } from '../wa-identity';
import {
  decodeWaMessage,
  deliveryStatusFrom,
  timestampOf,
  type MediaRef,
} from '../wa-message-content';
import { fallbackPersonName, nomeUtilizavel, timeLabel } from '../wa-format';
import {
  commitHistoryBatch,
  pendingContent,
  type HistoryCommitItem,
  type HistoryCommitReport,
} from '../wa-history-store';

export interface HistoryImportStats {
  conversasCriadas: number;
  conversasAtualizadas: number;
  mensagens: number;
  duplicadas: number;
  foraDoPrazo: number;
  grupos: number;
  lidSemTelefone: number;
  midiasPendentes: number;
  progresso: number;
  falhas: number;
}

export interface HistoryBlock {
  readonly chats?: readonly {
    readonly id?: string | null;
    readonly pnJid?: string | null;
    readonly lidJid?: string | null;
    readonly name?: string | null;
    readonly displayName?: string | null;
  }[];
  readonly messages?: readonly WAMessage[];
  readonly syncType?: number | null;
  readonly progress?: number | null;
  readonly peerDataRequestSessionId?: string | null;
}

export interface HistoryImporterDependencies {
  readonly accountId: string;
  readonly inboxId: string;
  readonly cutoff: Date;
  readonly resolveIdentity: (message: WAMessage) => Promise<ChatIdentity | null>;
  /**
   * Nome salvo na agenda do celular para algum destes JIDs, se a sessão já o
   * conhece. A agenda costuma chegar depois do pacote de histórico, então isto
   * só resolve quando ela já estava na memória (o mesmo número pareado de novo,
   * com a agenda restaurada do banco). O resto é resolvido ao fim da importação.
   */
  readonly agendaName?: (jids: readonly (string | null | undefined)[]) => string | undefined;
  /**
   * O grupo pode entrar no chat?
   *
   * A mesma regra do tempo real: só o grupo que o administrador marcou como
   * "Permitido no Chat" em Contatos grava mensagem. Ausente, nenhum grupo é
   * importado — é o comportamento de antes, e o que os testes sem banco esperam.
   */
  readonly isGroupAllowed?: (chat: ChatIdentity) => Promise<boolean>;
  /**
   * Quem escreveu numa mensagem de grupo: o `senderJid` que fica na linha e o
   * nome acima da bolha. Ausente, fica o `pushName` da mensagem ou o número.
   */
  readonly groupAuthor?: (
    chat: ChatIdentity,
    message: WAMessage,
  ) => Promise<{ readonly senderJid?: string; readonly authorName?: string }>;
  readonly decode?: typeof decodeWaMessage;
  readonly now?: () => Date;
  readonly onBatch?: (
    report: HistoryCommitReport,
    stats: Readonly<HistoryImportStats>,
  ) => Promise<void> | void;
}

const acceptedSyncType = (syncType: number | null | undefined): boolean =>
  syncType === proto.HistorySync.HistorySyncType.INITIAL_BOOTSTRAP ||
  syncType === proto.HistorySync.HistorySyncType.RECENT ||
  syncType === proto.HistorySync.HistorySyncType.FULL;

const mediaSubmessage = (message: WAMessage, kind: MediaRef['kind']) => {
  const content = normalizeMessageContent(message.message);
  if (!content) return undefined;
  switch (kind) {
    case 'image':
      return content.imageMessage ? { imageMessage: content.imageMessage } : undefined;
    case 'video':
      return content.videoMessage ? { videoMessage: content.videoMessage } : undefined;
    case 'audio':
      return content.audioMessage ? { audioMessage: content.audioMessage } : undefined;
    case 'document':
      return content.documentMessage ? { documentMessage: content.documentMessage } : undefined;
    case 'sticker':
      return content.stickerMessage ? { stickerMessage: content.stickerMessage } : undefined;
  }
};

const initialStats = (): HistoryImportStats => ({
  conversasCriadas: 0,
  conversasAtualizadas: 0,
  mensagens: 0,
  duplicadas: 0,
  foraDoPrazo: 0,
  grupos: 0,
  lidSemTelefone: 0,
  midiasPendentes: 0,
  progresso: 0,
  falhas: 0,
});

export class HistoryImporter {
  private readonly dependencies: HistoryImporterDependencies;
  private readonly decode: typeof decodeWaMessage;
  private readonly now: () => Date;
  private lane: Promise<void> = Promise.resolve();
  private pendingBlocks = 0;
  private stopped = false;
  private statsValue = initialStats();
  /**
   * Resposta de "este grupo pode?" por JID. Um grupo movimentado manda centenas
   * de mensagens no mesmo pacote, e a permissão não muda no meio da importação.
   */
  private readonly groupDecisions = new Map<string, Promise<boolean>>();

  constructor(dependencies: HistoryImporterDependencies) {
    this.dependencies = dependencies;
    this.decode = dependencies.decode ?? decodeWaMessage;
    this.now = dependencies.now ?? (() => new Date());
  }

  get stats(): Readonly<HistoryImportStats> {
    return this.statsValue;
  }

  stop(): void {
    this.stopped = true;
  }

  async drain(): Promise<void> {
    await this.lane;
  }

  async enqueue(block: HistoryBlock, options: { onDemand?: boolean } = {}): Promise<void> {
    const onDemand = options.onDemand === true;
    if (
      this.stopped ||
      (!onDemand && !acceptedSyncType(block.syncType)) ||
      (onDemand && block.syncType !== proto.HistorySync.HistorySyncType.ON_DEMAND)
    )
      return;
    // Teto real de memória: ao atingir vinte blocos, o listener espera a raia
    // esvaziar antes de aceitar mais um.
    const filtered: WAMessage[] = [];
    for (const message of block.messages ?? []) {
      const jid = message.key.remoteJid;
      if (!message.message || !isSupportedChatJid(jid)) continue;
      // Grupo não é descartado aqui: quem decide é a permissão do grupo em
      // Contatos, consultada em `processBlock`. Sem nenhum resolvedor, cai fora
      // já, para não pagar a decodificação de algo que não vai entrar.
      if ((isJidGroup(jid) || jid.endsWith('@g.us')) && !this.dependencies.isGroupAllowed) {
        this.statsValue = { ...this.statsValue, grupos: this.statsValue.grupos + 1 };
        continue;
      }
      if (!onDemand && new Date(timestampOf(message)) < this.dependencies.cutoff) {
        this.statsValue = { ...this.statsValue, foraDoPrazo: this.statsValue.foraDoPrazo + 1 };
        continue;
      }
      filtered.push(message);
    }
    const prepared = { ...block, messages: filtered };

    if (this.pendingBlocks >= 20) await this.lane;
    if (this.stopped) return;
    this.pendingBlocks += 1;
    this.lane = this.lane
      .then(() => this.processBlock(prepared))
      .catch((error) => {
        this.statsValue = { ...this.statsValue, falhas: this.statsValue.falhas + 1 };
        console.error('[HistoryImporter] Falha em bloco:', error);
      })
      .finally(() => {
        this.pendingBlocks -= 1;
      });
  }

  private groupAllowed(chat: ChatIdentity): Promise<boolean> {
    const resolver = this.dependencies.isGroupAllowed;
    if (!resolver) return Promise.resolve(false);
    let decisao = this.groupDecisions.get(chat.jid);
    if (!decisao) {
      decisao = resolver(chat).catch(() => false);
      this.groupDecisions.set(chat.jid, decisao);
    }
    return decisao;
  }

  private async groupAuthorOf(
    chat: ChatIdentity,
    message: WAMessage,
  ): Promise<{ readonly senderJid?: string; readonly authorName?: string }> {
    const participant = message.key.participant ?? undefined;
    const reserva = {
      ...(participant ? { senderJid: participant } : {}),
      authorName:
        nomeUtilizavel(message.pushName) ??
        (participant ? fallbackPersonName('', participant) : 'Participante'),
    };
    if (!this.dependencies.groupAuthor) return reserva;
    try {
      const resolvido = await this.dependencies.groupAuthor(chat, message);
      return {
        senderJid: resolvido.senderJid ?? reserva.senderJid,
        authorName: resolvido.authorName ?? reserva.authorName,
      };
    } catch {
      return reserva;
    }
  }

  private async processBlock(block: HistoryBlock): Promise<void> {
    if (this.stopped) return;
    const names = new Map<string, string>();
    for (const chat of block.chats ?? []) {
      // O WhatsApp manda o número mascarado ("+55 ∙∙∙∙∙∙∙ 45") como nome de quem
      // não está na agenda. Aceitá-lo gravava a máscara no cadastro, e ela não
      // era mais trocada por nome nenhum.
      const name = nomeUtilizavel(chat.name) ?? nomeUtilizavel(chat.displayName);
      if (!name) continue;
      if (chat.id) names.set(chat.id, name);
      if (chat.pnJid) names.set(chat.pnJid, name);
      if (chat.lidJid) names.set(chat.lidJid, name);
    }

    const accepted = [...(block.messages ?? [])].sort((a, b) => timestampOf(a) - timestampOf(b));
    for (let offset = 0; offset < accepted.length; offset += 200) {
      if (this.stopped) return;
      const input: HistoryCommitItem[] = [];
      for (const raw of accepted.slice(offset, offset + 200)) {
        const externalId = raw.key.id;
        if (!externalId) continue;
        const chat = await this.dependencies.resolveIdentity(raw);
        if (!chat) continue;
        if (chat.isGroup && !(await this.groupAllowed(chat))) {
          this.statsValue = { ...this.statsValue, grupos: this.statsValue.grupos + 1 };
          continue;
        }
        if (!chat.phone && !chat.isGroup && (isLidUser(chat.jid) || chat.jid.endsWith('@lid'))) {
          this.statsValue = {
            ...this.statsValue,
            lidSemTelefone: this.statsValue.lidSemTelefone + 1,
          };
          continue;
        }
        const decoded = this.decode(raw);
        if (!decoded) continue;
        const at = new Date(timestampOf(raw));
        const fromMe = raw.key.fromMe === true;
        const messageId = `msg-wa-${chat.conversationId}-${externalId}`;

        /**
         * O nome do contato, na ordem do WhatsApp: agenda, nome da conversa,
         * perfil, telefone formatado.
         *
         * O `pushName` de uma mensagem enviada por nós é o nome do **nosso**
         * perfil. Usá-lo batizava o contato com o nome da empresa, e a primeira
         * mensagem de uma conversa antiga costuma ser justamente nossa.
         */
        const nomeDaAgenda = this.dependencies.agendaName?.([
          chat.jid,
          raw.key.remoteJid,
          (raw.key as { remoteJidAlt?: string | null }).remoteJidAlt,
        ]);
        // Num grupo o contato é o grupo, e o `pushName` é de quem escreveu —
        // batizar o grupo com o nome de um participante trocaria o cadastro.
        const nomeReal = chat.isGroup
          ? names.get(chat.jid)
          : nomeDaAgenda ||
            names.get(chat.jid) ||
            (fromMe ? undefined : nomeUtilizavel(raw.pushName));
        const reserva = chat.isGroup
          ? 'Grupo do WhatsApp'
          : fallbackPersonName(chat.phone, chat.jid);
        const autor = chat.isGroup && !fromMe ? await this.groupAuthorOf(chat, raw) : undefined;
        let pendingMedia: HistoryCommitItem['pendingMedia'];
        let content = decoded.content;
        if (decoded.media) {
          const submessage = mediaSubmessage(raw, decoded.media.kind);
          if (!submessage) continue;
          const minimum = proto.WebMessageInfo.create({
            key: raw.key,
            messageTimestamp: raw.messageTimestamp,
            message: submessage,
          });
          const sealed = seal(
            Buffer.from(proto.WebMessageInfo.encode(minimum).finish()),
            messageId,
          );
          pendingMedia = {
            kind: decoded.media.kind,
            mimeType: decoded.media.mimeType,
            sizeBytes: decoded.media.fileLength,
            ...sealed,
          };
          content = pendingContent(decoded.media);
        }
        const message: Message = {
          id: messageId,
          conversationId: chat.conversationId,
          externalId,
          author: fromMe ? 'agent' : 'contact',
          authorName: fromMe ? 'Atendente' : autor?.authorName || nomeReal || reserva,
          ...(autor?.senderJid ? { senderJid: autor.senderJid } : {}),
          origin: 'historico',
          content,
          createdAt: at.toISOString(),
          time: timeLabel(at),
          ...(fromMe
            ? { deliveryStatus: deliveryStatusFrom(raw.status) ?? ('enviado' as const) }
            : {}),
          isPrivate: false,
        };
        input.push({
          chat,
          contactName: nomeReal || reserva,
          contactNameIsReal: Boolean(nomeReal),
          message,
          preview: decoded.preview,
          at,
          ...(pendingMedia ? { pendingMedia } : {}),
        });
      }
      if (input.length > 0) {
        const report = await commitHistoryBatch(
          this.dependencies.accountId,
          this.dependencies.inboxId,
          input,
          this.now(),
        );
        this.statsValue = {
          ...this.statsValue,
          conversasCriadas: this.statsValue.conversasCriadas + report.conversationsCreated,
          conversasAtualizadas: this.statsValue.conversasAtualizadas + report.conversationsUpdated,
          mensagens: this.statsValue.mensagens + report.messages,
          duplicadas: this.statsValue.duplicadas + report.duplicates,
          midiasPendentes: this.statsValue.midiasPendentes + report.mediaPending,
          progresso: Math.max(this.statsValue.progresso, Number(block.progress ?? 0)),
        };
        await this.dependencies.onBatch?.(report, this.statsValue);
      }
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }
}
