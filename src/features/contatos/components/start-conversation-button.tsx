'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, MessageCircle, Phone, Send } from 'lucide-react';
import { PhoneNumber, type Contact } from '@/core/domain/contact';
import { renderTemplate } from '@/core/domain/campaign';
import { Button } from '@/components/ui/button';
import { Field, Select, TextArea, TextInput } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import {
  findContactConversationAction,
  startContactConversationAction,
  startContactTemplateConversationAction,
  type CaixaDisponivel,
  type DestinoPossivel,
  type TemplateDisponivel,
} from '@/app/(workspace)/conversas/actions';
import { cn } from '@/lib/cn';

/**
 * Junta os destinos pelo sócio dono, preservando a ordem que o servidor mandou.
 *
 * O servidor já ordena (sócios primeiro, empresa por último); aqui só se
 * agrupa, sem reordenar — a ordem é uma decisão de domínio e refazê-la na tela
 * abriria espaço para as duas divergirem.
 */
const agruparPorSocio = (
  destinos: readonly DestinoPossivel[],
): { nome: string; destinos: DestinoPossivel[] }[] => {
  const grupos: { nome: string; destinos: DestinoPossivel[] }[] = [];
  for (const destino of destinos) {
    const ultimo = grupos.at(-1);
    if (ultimo && ultimo.nome === destino.partnerName) ultimo.destinos.push(destino);
    else grupos.push({ nome: destino.partnerName, destinos: [destino] });
  }
  return grupos;
};

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
  const [templates, setTemplates] = useState<readonly TemplateDisponivel[]>([]);
  const [phoneOptions, setPhoneOptions] = useState<readonly DestinoPossivel[] | undefined>();
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
      setRecipientPhone(result.phones[0]?.phone ?? contact.phone);
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
    setTemplates(result.templates ?? []);
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
          templates={templates}
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
          title="Para quem você quer escrever?"
          description={`${contact.name} tem mais de um destinatário possível. Escolha o sócio e o número.`}
          className="max-w-lg"
        >
          <div className="flex flex-col gap-4 pt-1">
            {/* Agrupado por dono, e não uma lista de números soltos: numa
                empresa com dois sócios e cinco telefones, saber de quem é cada
                número é a informação que falta para escolher. A classificação
                vem junto porque é por ela que a prospecção prioriza. */}
            <div
              role="radiogroup"
              aria-label="Destinatário"
              className="flex max-h-80 flex-col gap-3 overflow-y-auto pr-1"
            >
              {agruparPorSocio(phoneOptions).map((grupo) => (
                <div key={grupo.nome || 'empresa'} className="flex flex-col gap-1">
                  <span className="px-0.5 text-[11px] font-semibold uppercase tracking-wide text-dim">
                    {grupo.nome || 'Telefone da empresa'}
                  </span>
                  {grupo.destinos.map((destino) => {
                    const escolhido = destino.phone === recipientPhone;
                    return (
                      <button
                        key={destino.phone}
                        type="button"
                        role="radio"
                        aria-checked={escolhido}
                        onClick={() => setRecipientPhone(destino.phone)}
                        className={cn(
                          'flex items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left transition-colors',
                          escolhido
                            ? 'border-brand bg-brand/5'
                            : 'border-line hover:border-brand/40 hover:bg-surface-2',
                        )}
                      >
                        <span className="font-mono text-body text-ink">
                          {PhoneNumber.format(destino.phone) || destino.phone}
                        </span>
                        {destino.classification ? (
                          <span className="shrink-0 rounded-md border border-line-soft bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-muted">
                            {destino.classification}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>

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
 *
 * Na caixa da API oficial o campo de texto dá lugar ao seletor de template:
 * quem nunca nos escreveu está fora da janela de 24 h, e a Meta só aceita
 * template aprovado como primeira mensagem. Oferecer texto livre ali seria
 * oferecer um envio que falha.
 */
function FirstMessageModal({
  contact,
  recipientPhone,
  caixas,
  templates,
  onClose,
  onSent,
}: {
  readonly contact: Contact;
  readonly recipientPhone: string;
  readonly caixas: readonly CaixaDisponivel[];
  readonly templates: readonly TemplateDisponivel[];
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
  const [templateId, setTemplateId] = useState('');
  const [values, setValues] = useState<readonly string[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const escolhida = caixas.find((caixa) => caixa.id === inboxId);
  const oficial = escolhida?.provider === 'cloud_api';
  const templatesDaCaixa = useMemo(
    () => (escolhida?.wabaId ? templates.filter((t) => t.wabaId === escolhida.wabaId) : []),
    [escolhida, templates],
  );
  const template =
    templatesDaCaixa.find((t) => t.id === templateId) ??
    (templateId === '' ? templatesDaCaixa[0] : undefined);
  const preview = template ? renderTemplate(template.body, values) : '';
  const faltaVariavel = template
    ? template.variables.some((_, index) => !values[index]?.trim())
    : true;
  const podeEnviar = oficial ? Boolean(template) && !faltaVariavel : Boolean(text.trim());

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (sending || !inboxId || !podeEnviar) return;

    setError(undefined);
    setSending(true);

    const result =
      oficial && template
        ? await startContactTemplateConversationAction({
            contactId: contact.id,
            inboxId,
            templateId: template.id,
            values: template.variables.map((_, index) => values[index] ?? ''),
            ...(recipientPhone ? { recipientPhone } : {}),
          })
        : await startContactConversationAction({
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
            onChange={(event) => {
              setInboxId(event.target.value);
              setTemplateId('');
              setValues([]);
            }}
            className="h-10 w-full rounded-xl border border-line bg-surface px-3 text-body text-ink outline-none transition-all focus:border-brand focus:ring-2 focus:ring-brand/20"
          >
            {caixas.map((caixa) => (
              <option key={caixa.id} value={caixa.id}>
                {caixa.name} · {caixa.identifier}
                {caixa.provider === 'cloud_api' ? ' · API oficial' : ''}
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

        {oficial ? (
          templatesDaCaixa.length === 0 ? (
            <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-meta text-amber-700 dark:text-amber-400">
              Esta caixa usa a API oficial, e a primeira mensagem para quem nunca escreveu precisa
              ser um template aprovado pela Meta. Não há nenhum aprovado para esta conta: sincronize
              ou crie um em Campanhas e templates.
            </p>
          ) : (
            <>
              <Field
                label="Template aprovado"
                htmlFor="first-message-template"
                hint="Na API oficial, a primeira mensagem para quem nunca escreveu é sempre um template."
              >
                <Select
                  id="first-message-template"
                  value={template?.id ?? ''}
                  onChange={(event) => {
                    setTemplateId(event.target.value);
                    setValues([]);
                  }}
                >
                  {templatesDaCaixa.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} · {item.language}
                    </option>
                  ))}
                </Select>
              </Field>

              {template && template.variables.length > 0 ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  {template.variables.map((variavel, index) => (
                    <Field key={variavel} label={variavel} htmlFor={`first-message-var-${index}`}>
                      <TextInput
                        id={`first-message-var-${index}`}
                        value={values[index] ?? ''}
                        placeholder={index === 0 ? contact.name.split(' ')[0] : undefined}
                        onChange={(event) =>
                          setValues((atuais) => {
                            const proximos = [...atuais];
                            proximos[index] = event.target.value;
                            return proximos;
                          })
                        }
                      />
                    </Field>
                  ))}
                </div>
              ) : null}

              {template ? (
                <div className="rounded-xl border border-line bg-surface-2/60 px-3 py-2">
                  <p className="mb-1 text-meta font-semibold text-muted">Como chega no cliente</p>
                  <p className="whitespace-pre-wrap text-body text-ink">{preview}</p>
                </div>
              ) : null}
            </>
          )
        ) : (
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
        )}

        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="submit"
            icon={sending ? undefined : <Send className="size-3.5" />}
            disabled={sending || !inboxId || !podeEnviar}
          >
            {sending ? 'Enviando…' : 'Enviar e abrir conversa'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
