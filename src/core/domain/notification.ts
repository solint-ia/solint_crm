import type { Id } from './shared';

export type NotificationKind =
  | 'atribuicao'
  | 'sla'
  | 'mencao'
  | 'sistema'
  /**
   * Mensagem nova de um contato.
   *
   * Diferente das outras, esta não é gravada: nasce do barramento de tempo real
   * e vive enquanto a aba estiver aberta. Persistir uma linha por mensagem
   * recebida encheria a tabela com o que a própria caixa de entrada já mostra —
   * e o valor do aviso é chamar quem está noutra tela, agora.
   */
  | 'mensagem';

export interface AppNotification {
  readonly id: Id;
  readonly accountId: Id;
  readonly kind: NotificationKind;
  readonly text: string;
  readonly timeLabel: string;
  readonly read: boolean;
  readonly href?: string;
}
