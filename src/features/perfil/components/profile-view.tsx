'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import { BellOff, Inbox as InboxIcon, Volume2 } from 'lucide-react';
import type { AvailabilityStatus, NotificationPreferences, Session } from '@/core/domain/user';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, TextInput } from '@/components/ui/field';
import { Toggle } from '@/components/ui/toggle';
import { useToast } from '@/components/ui/toast';
import { UnsavedChangesBar } from '@/features/configuracoes/components/unsaved-changes-bar';
import { WhatsAppConnectionCard } from '@/features/whatsapp/components/whatsapp-connection-card';
import { WhatsAppModal } from '@/features/whatsapp/components/whatsapp-modal';
import { updateProfileAction, uploadProfilePhotoAction } from '@/app/(workspace)/perfil/actions';
import { ALLOWED_AVATAR_MIME_TYPES } from '@/core/domain/image-upload';
import { planned } from '@/components/ui/planned';
import { cn } from '@/lib/cn';

interface ProfileInbox {
  readonly id: string;
  readonly name: string;
}

interface ProfileViewProps {
  readonly session: Session;
  /** Caixas de WhatsApp que esta pessoa alcança — uma conexão por caixa. */
  readonly inboxes: readonly ProfileInbox[];
}

const AVAILABILITY_OPTIONS = [
  { id: 'disponivel', label: 'Disponível', dot: 'bg-green-text' },
  { id: 'ocupado', label: 'Ocupado', dot: 'bg-red-text' },
  { id: 'ausente', label: 'Ausente', dot: 'bg-amber-text' },
] as const;

const NOTIFICATION_ITEMS = [
  { key: 'assigned', label: 'Conversa atribuída diretamente a mim' },
  { key: 'mentions', label: 'Menções com @ em notas internas' },
  { key: 'sla', label: 'Aviso quando o prazo de resposta estiver acabando' },
  { key: 'campaigns', label: 'Notificar conclusão de campanhas em massa' },
] as const;

export function ProfileView({ session, inboxes }: ProfileViewProps) {
  const { user, account, availableAccounts } = session;
  const { show } = useToast();
  const [saving, startSaving] = useTransition();

  const [name, setName] = useState(user.name);
  const [availability, setAvailability] = useState<AvailabilityStatus>(user.availability);
  const [signature, setSignature] = useState(user.signature ?? '');
  const [signatureEnabled, setSignatureEnabled] = useState(user.signatureEnabled);
  const [notifications, setNotifications] = useState<NotificationPreferences>(user.notifications);
  const [pairingInbox, setPairingInbox] = useState<ProfileInbox | null>(null);
  const [error, setError] = useState<string | undefined>();

  /**
   * A foto é enviada na hora, fora do "salvar" geral.
   *
   * As outras alterações desta tela ficam pendentes até o botão "Salvar" —
   * mas uma foto escolhida e não enviada é um estado estranho de se abandonar
   * ("descartar alterações" apagaria a escolha, sem nunca ter mostrado nada na
   * tela para descartar). Upload de arquivo é, em toda parte da web, uma ação
   * imediata; esta tela não quebra essa expectativa.
   */
  const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState<string | undefined>();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handlePhotoChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Sempre limpo, mesmo em erro: sem isto, escolher o mesmo arquivo duas
    // vezes seguidas (para tentar de novo) não disparava `onChange` — o
    // navegador só avisa quando o valor do campo muda.
    event.target.value = '';
    if (!file) return;

    setPhotoError(undefined);
    setUploadingPhoto(true);
    try {
      const formData = new FormData();
      formData.set('photo', file);
      const result = await uploadProfilePhotoAction(formData);

      if (!result.ok) {
        setPhotoError(result.error);
        show({
          tone: 'erro',
          title: 'Não foi possível enviar a foto',
          description: result.error ?? 'Tente novamente.',
        });
        return;
      }

      // Pré-visualização imediata a partir do próprio arquivo escolhido — não
      // espera o servidor confirmar para a pessoa ver o resultado. A URL real
      // (servida por `/api/users/.../avatar`) chega no próximo carregamento da
      // página, via `revalidatePath` dentro da action.
      setAvatarUrl(URL.createObjectURL(file));
      show({ tone: 'sucesso', title: 'Foto de perfil atualizada' });
    } catch {
      setPhotoError('Erro ao enviar a imagem.');
      show({ tone: 'erro', title: 'Erro ao enviar a imagem', description: 'Tente novamente.' });
    } finally {
      setUploadingPhoto(false);
    }
  };

  const patchNotifications = (patch: Partial<NotificationPreferences>) =>
    setNotifications((current) => ({ ...current, ...patch }));

  const dirty = useMemo(
    () =>
      name.trim() !== user.name ||
      availability !== user.availability ||
      signature.trim() !== (user.signature ?? '') ||
      signatureEnabled !== user.signatureEnabled ||
      JSON.stringify(notifications) !== JSON.stringify(user.notifications),
    [name, availability, signature, signatureEnabled, notifications, user],
  );

  const handleDiscard = () => {
    setName(user.name);
    setAvailability(user.availability);
    setSignature(user.signature ?? '');
    setSignatureEnabled(user.signatureEnabled);
    setNotifications(user.notifications);
    setError(undefined);
  };

  const handleSave = () => {
    setError(undefined);
    startSaving(async () => {
      const result = await updateProfileAction({
        name: name.trim(),
        availability,
        signature: signature.trim(),
        signatureEnabled,
        notifications: {
          ...notifications,
          dailySummaryEmail: notifications.dailySummaryEmail?.trim() ?? '',
        },
      });

      if (!result.ok) {
        setError(result.error);
        show({
          tone: 'erro',
          title: 'Não foi possível salvar',
          description: result.error ?? 'Confira os campos e tente de novo.',
        });
        return;
      }

      show({ tone: 'sucesso', title: 'Perfil atualizado' });
    });
  };

  return (
    <div className="grid max-w-5xl gap-5 pb-20 md:grid-cols-2">
      <WhatsAppModal
        open={Boolean(pairingInbox)}
        onClose={() => setPairingInbox(null)}
        {...(pairingInbox ? { inboxId: pairingInbox.id, inboxName: pairingInbox.name } : {})}
      />

      {/* DADOS PESSOAIS */}
      <Card className="flex flex-col gap-4 p-5">
        <h3 className="font-display text-title font-bold text-ink tracking-tight">
          Dados pessoais
        </h3>

        <div className="flex items-center gap-4">
          <Avatar
            name={name || user.name}
            tone={user.avatarTone}
            src={avatarUrl}
            size="lg"
            availability={availability}
          />
          <div className="flex flex-col gap-1">
            <input
              ref={fileInputRef}
              type="file"
              accept={ALLOWED_AVATAR_MIME_TYPES.join(',')}
              className="hidden"
              onChange={handlePhotoChange}
            />
            <Button
              variant="secondary"
              size="sm"
              disabled={uploadingPhoto}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploadingPhoto ? 'Enviando…' : 'Alterar foto'}
            </Button>
            <span className="text-[11px] text-muted">JPG, PNG, WEBP ou GIF, até 5 MB.</span>
            {photoError ? <span className="text-[11px] text-red-text">{photoError}</span> : null}
          </div>
        </div>

        <Field label="Nome completo" htmlFor="profile-name">
          <TextInput
            id="profile-name"
            value={name}
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>

        {/* O email é a identidade de login, única no sistema inteiro: trocá-lo é
            um fluxo com confirmação de senha, não um campo que se salva junto
            com a preferência de som. Editável aqui, ele aceitava a digitação e
            descartava em silêncio. */}
        <Field
          label="Email institucional"
          htmlFor="profile-email"
          hint="É o seu login. Para trocar, fale com quem administra a conta."
        >
          <TextInput id="profile-email" type="email" value={user.email} readOnly />
        </Field>
      </Card>

      {/* CANAIS DE ATENDIMENTO VINCULADOS */}
      <div className="flex flex-col gap-5">
        {inboxes.length > 0 ? (
          inboxes.map((inbox) => (
            <WhatsAppConnectionCard
              key={inbox.id}
              user={user}
              inboxId={inbox.id}
              inboxName={inbox.name}
              onOpenPairing={() => setPairingInbox(inbox)}
            />
          ))
        ) : (
          <Card className="flex flex-col items-start gap-2 p-5">
            <span className="flex size-10 items-center justify-center rounded-surface bg-accent-soft text-brand">
              <InboxIcon className="size-5" />
            </span>
            <h3 className="font-display text-title font-bold text-ink tracking-tight">
              Nenhuma caixa de WhatsApp
            </h3>
            <p className="text-body text-muted">
              As conexões aparecem aqui assim que existir uma caixa de entrada de WhatsApp na
              conta.
            </p>
          </Card>
        )}

        <Card className="p-5">
          <h3 className="mb-3 font-display text-title font-bold text-ink tracking-tight">
            Disponibilidade de atendimento
          </h3>
          <div className="grid grid-cols-3 gap-2">
            {AVAILABILITY_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setAvailability(option.id)}
                className={cn(
                  'flex items-center justify-center gap-2 rounded-control border py-2 text-body font-semibold transition-all duration-150',
                  availability === option.id
                    ? 'border-brand bg-selected text-ink shadow-2xs'
                    : 'border-line text-muted hover:bg-surface-2',
                )}
              >
                <span className={cn('size-2 rounded-full', option.dot)} />
                {option.label}
              </button>
            ))}
          </div>
        </Card>

        {/* ASSINATURA DE MENSAGEM */}
        <Card className="flex flex-col gap-3 p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="font-display text-title font-bold text-ink tracking-tight">
                Assinatura de mensagem
              </h3>
              <p className="mt-0.5 text-meta text-muted">
                Vai em negrito, numa linha acima de tudo que você enviar pelo CRM. Notas internas
                nunca a recebem.
              </p>
            </div>
            <Toggle
              checked={signatureEnabled}
              onChange={setSignatureEnabled}
              label="Ativar assinatura nas mensagens enviadas"
            />
          </div>

          <textarea
            rows={2}
            value={signature}
            maxLength={120}
            placeholder={`${user.name} · ${account.name}`}
            onChange={(event) => setSignature(event.target.value)}
            className="w-full rounded-control border border-line bg-surface p-2.5 text-body text-ink outline-none focus:border-brand"
          />

          <div className="flex items-center justify-between gap-2">
            <span
              className={cn(
                'text-meta font-semibold',
                signatureEnabled ? 'text-green-text' : 'text-dim',
              )}
            >
              {signatureEnabled ? 'Ativa' : 'Inativa'}
            </span>
            <span className="font-mono text-[10px] text-dim tabular-nums">
              {signature.length}/120
            </span>
          </div>

          {/* A prévia existe porque a assinatura não é um campo de cadastro: é
              uma linha que o cliente vai ler. Ver como ela chega do outro lado é
              o que evita descobrir o resultado no primeiro atendimento. */}
          {signatureEnabled && signature.trim() ? (
            <div className="rounded-control border border-line-soft bg-surface-2/60 p-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-dim">
                Como o cliente recebe
              </p>
              <p className="mt-1.5 text-body leading-relaxed text-ink">
                <strong>{signature.trim()}</strong>
                <br />
                <span className="text-muted">Boa tarde! Já estou verificando por aqui.</span>
              </p>
            </div>
          ) : null}
        </Card>

        <Card className="flex items-center justify-between gap-4 p-5">
          <div>
            <h3 className="font-display text-title font-bold text-ink tracking-tight">
              Senha de acesso
            </h3>
            <p className="mt-0.5 text-meta text-muted">Última alteração realizada há 3 meses</p>
          </div>
          <Button variant="secondary" size="sm" {...planned('Alterar a senha de acesso')}>
            Alterar senha
          </Button>
        </Card>
      </div>

      {/* NOTIFICAÇÕES E PREFERÊNCIAS */}
      <Card className="flex flex-col gap-4 p-5">
        <h3 className="font-display text-title font-bold text-ink tracking-tight">
          Notificações pessoais
        </h3>

        {/* O som fica destacado do resto porque é a única preferência que age
            no navegador, agora, em toda mensagem que chega — e a única que
            alguém procura com pressa quando o escritório está cheio. */}
        <div
          className={cn(
            'flex items-center justify-between gap-3 rounded-surface border p-3.5 transition-colors',
            notifications.sound ? 'border-brand/40 bg-selected' : 'border-line bg-surface-2',
          )}
        >
          <div className="flex items-center gap-3 min-w-0">
            <span
              className={cn(
                'flex size-9 shrink-0 items-center justify-center rounded-control',
                notifications.sound ? 'bg-accent-soft text-brand' : 'bg-surface text-dim',
              )}
            >
              {notifications.sound ? (
                <Volume2 className="size-4" />
              ) : (
                <BellOff className="size-4" />
              )}
            </span>
            <div className="min-w-0">
              <p className="text-body font-semibold text-ink">
                {notifications.sound ? 'Com som' : 'Modo mudo'}
              </p>
              <p className="text-meta text-muted">
                {notifications.sound
                  ? 'O navegador emite um toque quando chega mensagem nova.'
                  : 'Os avisos continuam no sininho, sem som nenhum.'}
              </p>
            </div>
          </div>
          <Toggle
            checked={notifications.sound}
            onChange={(sound) => patchNotifications({ sound })}
            label="Emitir som ao receber mensagem"
          />
        </div>

        <div className="divide-y divide-line-soft">
          {NOTIFICATION_ITEMS.map((item) => (
            <div key={item.key} className="flex items-center justify-between gap-3 py-2.5">
              <span className="text-body text-ink">{item.label}</span>
              <Toggle
                checked={notifications[item.key]}
                onChange={(value) => patchNotifications({ [item.key]: value })}
                label={item.label}
              />
            </div>
          ))}

          <div className="flex flex-col gap-2.5 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <span className="text-body text-ink">Receber resumo diário de atividades</span>
              <Toggle
                checked={notifications.dailySummary}
                onChange={(dailySummary) => patchNotifications({ dailySummary })}
                label="Receber resumo diário de atividades por email"
              />
            </div>

            {/* O campo só existe quando há resumo para mandar. Fora disso ele
                pediria uma decisão sobre algo desligado. */}
            {notifications.dailySummary ? (
              <Field
                label="Enviar o resumo para"
                htmlFor="daily-summary-email"
                hint={`Em branco, vai para ${user.email}.`}
              >
                <TextInput
                  id="daily-summary-email"
                  type="email"
                  placeholder={user.email}
                  value={notifications.dailySummaryEmail ?? ''}
                  onChange={(event) =>
                    patchNotifications({ dailySummaryEmail: event.target.value })
                  }
                />
              </Field>
            ) : null}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 border-t border-line-soft pt-4">
          <Field label="Idioma da interface">
            <TextInput defaultValue="Português (Brasil)" readOnly />
          </Field>
          <Field label="Fuso horário pessoal">
            <TextInput defaultValue="GMT-3 · São Paulo" readOnly />
          </Field>
        </div>
      </Card>

      {/* WORKSPACES / CONTAS VINCULADAS */}
      <Card className="flex flex-col gap-4 p-5">
        <h3 className="font-display text-title font-bold text-ink tracking-tight">
          Workspaces vinculados
        </h3>
        <p className="text-body text-muted">
          Você pode alternar entre contas a qualquer momento.
        </p>

        <div className="overflow-hidden rounded-surface border border-line bg-surface shadow-xs">
          <div className="divide-y divide-line-soft">
            {availableAccounts.map((acc) => {
              const isCurrent = acc.id === account.id;
              return (
                <div
                  key={acc.id}
                  className={cn(
                    'flex items-center justify-between gap-3 p-3.5 transition-colors',
                    isCurrent
                      ? 'bg-selected border-l-3 border-l-brand pl-3'
                      : 'hover:bg-surface-2/60',
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div className="flex size-8.5 items-center justify-center rounded-control bg-brand-gradient font-display text-body font-bold text-white shadow-xs">
                      {acc.name.charAt(0)}
                    </div>
                    <div>
                      <div className="text-ui font-bold text-ink tracking-tight">{acc.name}</div>
                      <div className="text-meta capitalize text-muted">Plano {acc.plan}</div>
                    </div>
                  </div>
                  {isCurrent ? (
                    <Badge tone="blue">Workspace ativo</Badge>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      {...planned('Trocar para este workspace')}
                    >
                      Alternar
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </Card>

      {error ? (
        <p
          role="alert"
          className="rounded-control border border-red-line bg-red-soft px-3 py-2 text-body text-red-text md:col-span-2"
        >
          {error}
        </p>
      ) : null}

      <UnsavedChangesBar
        show={dirty}
        isSaving={saving}
        onSave={handleSave}
        onDiscard={handleDiscard}
        message="Alterações não salvas no seu perfil."
      />
    </div>
  );
}
