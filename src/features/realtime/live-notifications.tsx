'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Conversation } from '@/core/domain/conversation';
import type { Message } from '@/core/domain/message';
import { previewOfMessage } from '@/core/domain/message';
import type { AppNotification } from '@/core/domain/notification';
import { horaLabel } from '@/lib/datetime';
import { useConversationEvents } from './conversation-events';
import { playNotificationSound } from './notification-sound';

/**
 * Mensagens novas viram aviso no sininho — não cartão flutuante.
 *
 * O aviso de mensagem aparecia como toast no canto inferior da tela: sumia
 * sozinho em sete segundos, e quem estivesse fora do computador nesse intervalo
 * nunca soube que a mensagem chegou. O sininho é o lugar onde um aviso **fica**
 * até alguém olhar, e é onde as pessoas procuram por ele.
 *
 * O estado vive aqui, no layout do workspace, e não dentro do sininho: o
 * sininho é remontado a cada navegação, e o que ele guardasse morreria na
 * primeira troca de tela.
 *
 * Nada disto é gravado no banco. Uma linha por mensagem recebida duplicaria o
 * que a caixa de entrada já mostra — e o valor do aviso é chamar quem está
 * noutra tela agora, não montar um segundo histórico.
 */

interface LiveNotificationsApi {
  readonly items: readonly AppNotification[];
  readonly markRead: (id: string) => void;
  readonly markAllRead: () => void;
  /** Abrir a conversa apaga os avisos dela. */
  readonly markConversationRead: (conversationId: string) => void;
  /**
   * Diz qual conversa está aberta na tela.
   *
   * Não é enfeite: sem isto, cada mensagem da conversa que a pessoa está
   * **lendo neste instante** virava um aviso não lido no sininho, e ela
   * terminava o atendimento com um selo aceso apontando para a tela em que já
   * estava. `undefined` quando nenhuma está aberta.
   */
  readonly setActiveConversation: (conversationId: string | undefined) => void;
}

const LiveNotificationsContext = createContext<LiveNotificationsApi | undefined>(undefined);

/** Teto da lista. Além disso ninguém rola — vira ruído com aparência de dado. */
const MAX_ITEMS = 20;

export function LiveNotificationsProvider({
  soundEnabled,
  accountId,
  currentUserId,
  children,
}: {
  readonly soundEnabled: boolean;
  /** Conta ativa: trocar de workspace esvazia a lista acumulada. */
  readonly accountId: string;
  /** Quem está olhando: decide quais avisos dirigidos são dele. */
  readonly currentUserId: string;
  readonly children: ReactNode;
}) {
  const [items, setItems] = useState<readonly AppNotification[]>([]);

  /**
   * Os avisos vivos são da conta em que nasceram.
   *
   * Eles moram só na memória desta aba, e a troca de workspace não remonta este
   * provider — a navegação do App Router preserva o layout. Sem isto, o sininho
   * continuaria mostrando mensagens do workspace anterior, com links para
   * conversas que a pessoa não alcança mais: clicar levaria a um "não
   * encontrado", e o selo contaria o que não existe ali.
   */
  const contaAnterior = useRef(accountId);
  if (contaAnterior.current !== accountId) {
    contaAnterior.current = accountId;
    // Durante o render, e não num efeito: o efeito só rodaria depois de um
    // quadro com a lista errada já desenhada na tela.
    setItems([]);
  }

  /**
   * A preferência entra por `ref` porque o handler do barramento é registrado
   * uma vez: lida direto da prop, ele congelaria no valor do primeiro render e
   * desligar o som só teria efeito depois de recarregar a página.
   */
  const somLigado = useRef(soundEnabled);
  somLigado.current = soundEnabled;

  /**
   * A conversa aberta agora, por `ref` pelo mesmo motivo do som: o handler do
   * barramento é registrado uma vez e leria um valor congelado.
   */
  const conversaAberta = useRef<string | undefined>(undefined);

  /**
   * Quem está olhando, por `ref` pelo mesmo motivo dos anteriores.
   *
   * A conexão de tempo real é por caixa, não por pessoa: dois agentes da mesma
   * equipe recebem os mesmos eventos. Sem esta comparação, o aviso de "a
   * conversa foi atribuída a você" acenderia o sininho dos dois.
   */
  const usuarioAtual = useRef(currentUserId);
  usuarioAtual.current = currentUserId;

  useConversationEvents((payload) => {
    // "Digitando" e recibo de entrega não são novidade para ninguém.
    if (payload.type === 'typing' || payload.type === 'message_updated') return;

    /**
     * Aviso gravado pelo servidor: atribuição, menção, prazo estourando.
     *
     * Diferente dos demais eventos, este já vem pronto — não há mensagem para
     * inspecionar nem preview a montar. A rota de SSE já recortou por conta e
     * por caixa; o que falta é o recorte por pessoa, porque um aviso pode ser
     * de alguém específico e a conexão é compartilhada por todos que alcançam
     * aquela caixa.
     */
    if (payload.type === 'notification') {
      const destinatario = (payload as { userId?: string }).userId;
      if (destinatario && destinatario !== usuarioAtual.current) return;

      const aviso = (payload as { notification?: AppNotification }).notification;
      if (!aviso) return;

      setItems((current) => {
        if (current.some((item) => item.id === aviso.id)) return current;
        return [aviso, ...current].slice(0, MAX_ITEMS);
      });
      if (somLigado.current) playNotificationSound();
      return;
    }

    const conversation = payload.conversation as Conversation | undefined;
    const message =
      (payload.message as Message | undefined) ??
      [...(conversation?.timeline ?? [])].reverse().find((item) => item.kind === 'message')
        ?.message;

    // O eco das nossas próprias mensagens não avisa nada a quem as escreveu.
    if (!message || message.author !== 'contact' || message.deletedAt) return;

    /**
     * Nada a anunciar sobre a conversa que está aberta na frente da pessoa.
     *
     * A mensagem já apareceu na timeline no mesmo instante; um aviso por cima
     * disso não informa nada e deixa o sininho aceso apontando para onde ela
     * já está. A aba escondida é a exceção — ali a timeline não está à vista, e
     * o aviso é justamente o que chama de volta.
     */
    if (
      conversaAberta.current === payload.conversationId &&
      (typeof document === 'undefined' || document.visibilityState === 'visible')
    ) {
      return;
    }

    const quem = conversation?.contact.name ?? message.authorName ?? 'Novo contato';
    const nova = payload.type === 'new_conversation';

    setItems((current) => {
      /**
       * Um aviso por conversa, sempre o mais recente.
       *
       * Sem isto, alguém mandando cinco linhas seguidas enterraria as outras
       * conversas sob cinco cópias de si mesmo — e o sininho passaria a medir
       * quem escreve mais, não quantos estão esperando.
       */
      const semDuplicata = current.filter(
        (item) => item.href !== `/conversas/${payload.conversationId}`,
      );
      const aviso: AppNotification = {
        id: `live-${payload.conversationId}-${message.id}`,
        accountId: payload.accountId,
        kind: 'mensagem',
        text: nova ? `${quem} iniciou uma conversa` : `${quem}: ${previewOfMessage(message)}`,
        timeLabel: horaLabel(new Date()),
        read: false,
        href: `/conversas/${payload.conversationId}`,
      };
      return [aviso, ...semDuplicata].slice(0, MAX_ITEMS);
    });

    if (somLigado.current) playNotificationSound();
  });

  const markRead = useCallback((id: string) => {
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, read: true } : item)),
    );
  }, []);

  const markAllRead = useCallback(() => {
    setItems((current) => current.map((item) => ({ ...item, read: true })));
  }, []);

  const markConversationRead = useCallback((conversationId: string) => {
    const alvo = `/conversas/${conversationId}`;
    setItems((current) => {
      // Sem nada a mudar, devolve o mesmo array: um novo dispararia render em
      // todo mundo que ouve o contexto, a cada troca de conversa.
      if (!current.some((item) => item.href === alvo && !item.read)) return current;
      return current.map((item) => (item.href === alvo ? { ...item, read: true } : item));
    });
  }, []);

  const setActiveConversation = useCallback((conversationId: string | undefined) => {
    conversaAberta.current = conversationId;
  }, []);

  const api = useMemo<LiveNotificationsApi>(
    () => ({ items, markRead, markAllRead, markConversationRead, setActiveConversation }),
    [items, markRead, markAllRead, markConversationRead, setActiveConversation],
  );

  return (
    <LiveNotificationsContext.Provider value={api}>{children}</LiveNotificationsContext.Provider>
  );
}

/**
 * O que se usa fora do provider.
 *
 * Constante, e não um objeto novo a cada chamada: os efeitos que dependem
 * destas funções rodariam de novo a cada render se a identidade mudasse.
 */
const VAZIO: LiveNotificationsApi = {
  items: [],
  markRead: () => undefined,
  markAllRead: () => undefined,
  markConversationRead: () => undefined,
  setActiveConversation: () => undefined,
};

/**
 * Fora do provider devolve uma lista vazia em vez de explodir: um sininho sem
 * avisos ao vivo é um defeito pequeno; uma tela em branco, um grande.
 */
export function useLiveNotifications(): LiveNotificationsApi {
  return (
    useContext(LiveNotificationsContext) ?? VAZIO
  );
}
