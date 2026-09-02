'use client';

import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, MessageCircle, Phone, Send } from 'lucide-react';
import type { Contact } from '@/core/domain/contact';
import { Button } from '@/components/ui/button';
import { Field, TextArea } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import {
  findContactConversationAction,
  startContactConversationAction,
  type CaixaDisponivel,
} from '@/app/(workspace)/conversas/actions';
import { cn } from '@/lib/cn';

/**
 * "Conversar" a partir da agenda.
 *
 * Antes este botão era um `<Link href="/conversas">`: levava para a caixa de
 * entrada e largava a pessoa lá, procurando na lista o contato em que ela
 * acabou de clicar. O contato que ele carregava não ia junto.
 *
 * Agora há dois destinos, e quem decide é o servidor, porque só ele sabe se
 * existe conversa:
 *
 *   - **Já conversamos:** navega direto para a conversa, com o histórico.
 *   - **Cadastrado à mão:** não há conversa nem caixa escolhida. Abre o modal,
 *     que pergunta as duas coisas que faltam — por qual número sai e o que
 *     dizer — antes de qualquer coisa ser enviada.
 *
 * A decisão não pode ficar aqui: o cliente não tem como saber se o contato tem
 * conversa sem perguntar, e chutar erra justamente no caso que importa.
 */
export function StartConversationButton({
  contact,
  children,
  className,
  onNavigate,
}: {
  readonly contact: Contact;
  readonly children?: ReactNode;
  readonly className?: string;
  /** Chamado antes de navegar — para fechar a gaveta ou o menu que o contém. */
  readonly onNavigate?: () => void;
}) {
  const router = useRouter();
  const { show } = useToast();

  const [checking, setChecking] = useState(false);
  const [caixas, setCaixas] = useState<readonly CaixaDisponivel[] | undefined>();
  const [phoneOptions, setPhoneOptions] = useState<readonly string[] | undefined>();
  const [recipientPhone, setRecipientPhone] = useState(contact.phone);

  const resolveDestination = async (phone?: string) => {
    if (checking) return;
    setChecking(true);

    const result = await findContactConversationAction({
      contactId: contact.id,
      ...(phone ? { recipientPhone: phone } : {}),
    });
    setChecking(false);

    if (!result.ok) {
      show({
        tone: 'erro',
        title: 'Não foi possível abrir a conversa',
        description: result.error ?? 'Tente novamente.',
      });
      return;
    }

    if (result.phoneSelectionRequired && result.phones) {
      setRecipientPhone(result.phones[0] ?? contact.phone);
      setPhoneOptions(result.phones);
      return;
    }

    if (result.conversationId) {
      onNavigate?.();
      router.push(`/conversas/${result.conversationId}`);
      return;
    }

    if (!result.caixas || result.caixas.length === 0) {
      show({
        tone: 'erro',
        title: 'Nenhuma caixa de WhatsApp disponível',
        description: 'Conecte um número em Configurações › Caixas de entrada.',
      });
      return;
    }

    setRecipientPhone(phone ?? contact.phone);
    setCaixas(result.caixas);
  };

  const handleClick = () => void resolveDestination();

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={checking}
        className={cn('disabled:cursor-wait disabled:opacity-60', className)}
      >
        {checking ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <MessageCircle className="size-3.5" />
        )}
        {children ?? <span>Conversar no WhatsApp</span>}
      </button>

      {caixas ? (
        <FirstMessageModal
          contact={contact}
          recipientPhone={recipientPhone}
          caixas={caixas}
          onClose={() => setCaixas(undefined)}
          onSent={(conversationId) => {
            setCaixas(undefined);
            onNavigate?.();
            router.push(`/conversas/${conversationId}`);
          }}
        />
      ) : null}

      {phoneOptions ? (
        <Modal
          open
          onClose={() => setPhoneOptions(undefined)}
          title="Escolha o número do destinatário"
          description={`${contact.name} possui mais de um telefone. Selecione explicitamente qual receberá a conversa.`}
          className="max-w-md"
        >
          <div className="flex flex-col gap-4 pt-1">
            <Field label="Enviar para" htmlFor="recipient-phone">
              <select
                id="recipient-phone"
                value={recipientPhone}
                onChange={(event) => setRecipientPhone(event.target.value)}
                className="h-10 w-full rounded-xl border border-line bg-surface px-3 font-mono text-body text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
              >
                {phoneOptions.map((phone) => (
                  <option key={phone} value={phone}>
                    {phone}
                    {phone === contact.companyPhone ? ' · Empresa' : ''}
                    {phone === contact.partnerPhone ? ' · Sócio' : ''}
                  </option>
                ))}
              </select>
            </Field>
            <div className="flex justify-end gap-2 border-t border-line pt-4">
              <Button type="button" variant="secondary" onClick={() => setPhoneOptions(undefined)}>
                Cancelar
              </Button>
              <Button
                type="button"
                icon={checking ? undefined : <Phone className="size-3.5" />}
                disabled={checking || !recipientPhone}
                onClick={() => {
                  const selected = recipientPhone;
                  setPhoneOptions(undefined);
                  void resolveDestination(selected);
                }}
              >
                {checking ? 'Verificando…' : 'Continuar'}
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

/**
 * A primeira mensagem para quem nunca nos escreveu.
 *
 * A caixa vem primeiro e não tem "automático": ela é o número que aparece no
 * telefone de quem recebe. Com dois números conectados, deixar o sistema
 * escolher significa o cliente ver uma mensagem de um número que não conhece —
 * e responder para lá, onde ninguém está olhando.
 */
function FirstMessageModal({
  contact,
  recipientPhone,
  caixas,
  onClose,
  onSent,
}: {
  readonly contact: Contact;
  readonly recipientPhone: string;
  readonly caixas: readonly CaixaDisponivel[];
  readonly onClose: () => void;
  readonly onSent: (conversationId: string) => void;
}) {
  const { show } = useToast();
  // A única conectada já vem escolhida; com várias, escolher por ela seria
  // adivinhar o número que o cliente vai ver.
  const conectadas = caixas.filter((caixa) => caixa.conectada);
  const [inboxId, setInboxId] = useState(
    conectadas.length === 1 ? (conectadas[0]?.id ?? '') : (caixas[0]?.id ?? ''),
  );
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const escolhida = caixas.find((caixa) => caixa.id === inboxId);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (sending || !text.trim() || !inboxId) return;

    setError(undefined);
    setSending(true);

    const result = await startContactConversationAction({
      contactId: contact.id,
      inboxId,
      text: text.trim(),
      ...(recipientPhone ? { recipientPhone } : {}),
    });

    setSending(false);

    if (!result.ok || !result.conversationId) {
      setError(result.error ?? 'Não foi possível enviar a mensagem.');
      return;
    }

    show({
      tone: 'sucesso',
      title: 'Conversa iniciada',
      description: `A mensagem para ${contact.name} foi enviada.`,
    });

    onSent(result.conversationId);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Enviar mensagem para ${contact.name}`}
      description="Este contato ainda não tem conversa. Escolha por qual número enviar a primeira mensagem."
      className="max-w-md"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4 pt-1">
        {error ? (
          <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-meta text-red-600 dark:text-red-400">
            {error}
          </p>
        ) : null}

        <div className="rounded-xl border border-line bg-surface-2/60 px-3 py-2 text-meta text-muted">
          Para <strong className="text-ink">{contact.name}</strong> ·{' '}
          <span className="font-mono">{recipientPhone || 'Grupo do WhatsApp'}</span>
        </div>

        <Field label="Enviar pelo número" htmlFor="first-message-inbox">
          <select
            id="first-message-inbox"
            value={inboxId}
            onChange={(event) => setInboxId(event.target.value)}
            className="h-10 w-full rounded-xl border border-line bg-surface px-3 text-body text-ink outline-none transition-all focus:border-brand focus:ring-2 focus:ring-brand/20"
          >
            {caixas.map((caixa) => (
              <option key={caixa.id} value={caixa.id}>
                {caixa.name} · {caixa.identifier}
                {caixa.conectada ? '' : ' (desconectada)'}
              </option>
            ))}
          </select>
        </Field>

        {/* Caixa fora do ar não bloqueia o envio: a mensagem fica gravada na
            conversa e sai quando o número voltar. O aviso existe para a
            expectativa não ser "entregue agora". */}
        {escolhida && !escolhida.conectada ? (
          <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-meta text-amber-700 dark:text-amber-400">
            Esta caixa está desconectada. A mensagem fica registrada na conversa e só chega ao
            contato depois que o número reconectar.
          </p>
        ) : null}

        <Field label="Mensagem" htmlFor="first-message-text">
          <TextArea
            id="first-message-text"
            rows={4}
            maxLength={4096}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={`Olá ${contact.name.split(' ')[0] ?? ''}, tudo bem?`}
            autoFocus
          />
        </Field>

        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="submit"
            icon={sending ? undefined : <Send className="size-3.5" />}
            disabled={sending || !text.trim() || !inboxId}
          >
            {sending ? 'Enviando…' : 'Enviar e abrir conversa'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
