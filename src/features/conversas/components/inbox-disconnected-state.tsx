import Link from 'next/link';
import { Inbox, Plus, Settings2 } from 'lucide-react';

/**
 * O que a tela de conversas mostra quando não há canal nenhum.
 *
 * Este componente já foi outra coisa: a parede de "Conectar WhatsApp", com QR
 * Code e botão de reconectar, mostrada sempre que o status da conta dizia
 * desconectado. Esse status vinha de uma caixa escolhida por ordem de id, e
 * numa conta com vários números bastava a sorteada estar fora do ar para o
 * atendimento inteiro desaparecer — inclusive as conversas dos canais que
 * estavam funcionando.
 *
 * Conexão virou assunto de cada canal: o ponto âmbar na coluna de canais, o
 * aviso na conversa aberta e o bloqueio do envio, que já era por caixa. Sobrou
 * para cá o único caso em que não há nada a mostrar — a conta ainda não tem
 * caixa de entrada, ou esta pessoa não alcança nenhuma.
 *
 * Não há botão de conectar aqui de propósito: sem caixa não há o que parear.
 * O passo que falta é criar a caixa, e é para lá que o link aponta.
 */
export function InboxDisconnectedState() {
  return (
    <div className="flex h-full flex-1 items-center justify-center bg-app p-6">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
          <Inbox className="size-7" />
        </div>

        <div>
          <h2 className="font-display text-lg font-bold text-ink">
            Nenhuma caixa de entrada por aqui
          </h2>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">
            As conversas chegam por uma caixa de entrada, e você ainda não alcança nenhuma. Crie
            uma e pareie um número de WhatsApp para começar a atender — ou peça ao administrador
            para incluir você numa equipe que já tenha canais.
          </p>
        </div>

        <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
          <Link
            href="/configuracoes"
            className="inline-flex items-center gap-2 rounded-control bg-brand px-4 py-2 text-ui font-semibold text-white shadow-xs transition-all hover:bg-brand-hover active:scale-[0.98]"
          >
            <Plus className="size-4" />
            <span>Criar caixa de entrada</span>
          </Link>

          <Link
            href="/configuracoes"
            className="inline-flex items-center gap-2 rounded-control border border-line bg-surface px-4 py-2 text-ui font-semibold text-ink shadow-xs transition-all hover:bg-surface-2 active:scale-[0.98]"
          >
            <Settings2 className="size-4" />
            <span>Ver configurações</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
