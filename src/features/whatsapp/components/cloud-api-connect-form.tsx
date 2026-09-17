'use client';

import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, TextInput } from '@/components/ui/field';
import { EmbeddedSignupButton } from './embedded-signup-button';

export interface CloudConnectResult {
  readonly displayPhoneNumber: string;
  readonly verifiedName?: string;
  readonly verifyToken?: string;
  readonly webhookUrl?: string;
}

/**
 * Conexão pela API oficial no modo manual: a empresa usa o próprio app da Meta.
 *
 * Os campos seguem a ordem em que aparecem no painel da Meta (WhatsApp › Configuração
 * da API), para quem está copiando de lá não precisar ir e voltar.
 */
export function CloudApiConnectForm({
  inboxId,
  onConnected,
}: {
  readonly inboxId: string;
  readonly onConnected: (result: CloudConnectResult) => void;
}) {
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [wabaId, setWabaId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [pin, setPin] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  const conectar = async () => {
    setError(undefined);
    setPending(true);
    try {
      const response = await fetch(`/api/inboxes/${inboxId}/whatsapp/cloud/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phoneNumberId,
          wabaId,
          accessToken,
          appSecret,
          ...(pin.trim() ? { pin: pin.trim() } : {}),
        }),
      });
      const data = (await response.json()) as { ok: boolean; error?: string } & CloudConnectResult;
      if (!data.ok) {
        setError(data.error ?? 'Não foi possível conectar a API oficial.');
        return;
      }
      // O token sai da memória da tela assim que o servidor o guardou cifrado.
      setAccessToken('');
      setAppSecret('');
      setPin('');
      onConnected(data);
    } catch {
      setError('Não foi possível falar com o servidor.');
    } finally {
      setPending(false);
    }
  };

  const pronto = phoneNumberId.trim() && wabaId.trim() && accessToken.trim() && appSecret.trim();

  return (
    <div className="flex w-full flex-col gap-4">
      <EmbeddedSignupButton
        inboxId={inboxId}
        onConnected={() => onConnected({ displayPhoneNumber: '' })}
      />

      <div className="rounded-control border border-line bg-surface-2 p-3 text-meta leading-relaxed text-muted">
        <p className="font-semibold text-ink">Conectar com o app da sua empresa na Meta</p>
        <ol className="mt-1 list-decimal space-y-0.5 pl-5">
          <li>No Meta for Developers, abra o app e vá em WhatsApp › Configuração da API.</li>
          <li>Copie o ID do número de telefone e o ID da conta do WhatsApp Business.</li>
          <li>
            Em Configurações do negócio, crie um usuário do sistema com as permissões
            whatsapp_business_messaging e whatsapp_business_management e gere um token permanente.
          </li>
          <li>Copie a chave secreta do app em Configurações do app › Básico.</li>
          <li>
            Depois de conectar, cole a URL e o verify token mostrados aqui em WhatsApp ›
            Configuração › Webhook.
          </li>
        </ol>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="ID do número de telefone" htmlFor="cloud-phone-number-id">
          <TextInput
            id="cloud-phone-number-id"
            inputMode="numeric"
            value={phoneNumberId}
            onChange={(e) => setPhoneNumberId(e.target.value)}
            autoComplete="off"
          />
        </Field>
        <Field label="ID da conta do WhatsApp Business" htmlFor="cloud-waba-id">
          <TextInput
            id="cloud-waba-id"
            inputMode="numeric"
            value={wabaId}
            onChange={(e) => setWabaId(e.target.value)}
            autoComplete="off"
          />
        </Field>
      </div>
      <Field
        label="Token de acesso permanente"
        htmlFor="cloud-token"
        hint="Fica guardado cifrado e nunca volta para a tela."
      >
        <TextInput
          id="cloud-token"
          type="password"
          value={accessToken}
          onChange={(e) => setAccessToken(e.target.value)}
          autoComplete="off"
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Chave secreta do app" htmlFor="cloud-app-secret">
          <TextInput
            id="cloud-app-secret"
            type="password"
            value={appSecret}
            onChange={(e) => setAppSecret(e.target.value)}
            autoComplete="off"
          />
        </Field>
        <Field
          label="PIN de 6 dígitos (se ainda não registrado)"
          htmlFor="cloud-pin"
          hint="Verificação em duas etapas do número."
        >
          <TextInput
            id="cloud-pin"
            inputMode="numeric"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            autoComplete="off"
          />
        </Field>
      </div>

      {error ? (
        <p className="rounded-control border border-red-line bg-red-soft px-3 py-2 text-body text-red-text">
          {error}
        </p>
      ) : null}

      <Button
        variant="primary"
        size="md"
        onClick={() => void conectar()}
        disabled={pending || !pronto}
        icon={<KeyRound className="size-4" />}
      >
        {pending ? 'Validando na Meta…' : 'Conectar API oficial'}
      </Button>
    </div>
  );
}
