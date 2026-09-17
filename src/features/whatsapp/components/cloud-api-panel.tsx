'use client';

import { useCallback, useEffect, useState } from 'react';
import { Copy, RefreshCw, ShieldCheck, Unplug } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, TextArea, TextInput } from '@/components/ui/field';
import type { WhatsAppStatusPayload } from '@/infrastructure/whatsapp/whatsapp-events';

interface TemplateRow {
  readonly id: string;
  readonly name: string;
  readonly language: string;
  readonly category: string;
  readonly status: string;
  readonly body: string;
  readonly rejectedReason: string | null;
}

const STATUS_TEMPLATE: Readonly<
  Record<string, { label: string; tone: 'green' | 'amber' | 'red' | 'slate' }>
> = {
  approved: { label: 'Aprovado', tone: 'green' },
  pending: { label: 'Em análise', tone: 'amber' },
  rejected: { label: 'Recusado', tone: 'red' },
  paused: { label: 'Pausado', tone: 'amber' },
  disabled: { label: 'Desativado', tone: 'slate' },
};

const QUALIDADE: Readonly<
  Record<string, { label: string; tone: 'green' | 'amber' | 'red' | 'slate' }>
> = {
  GREEN: { label: 'Alta', tone: 'green' },
  YELLOW: { label: 'Média', tone: 'amber' },
  RED: { label: 'Baixa', tone: 'red' },
};

function Copiavel({ label, value }: { readonly label: string; readonly value: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <Field label={label}>
      <div className="flex gap-2">
        <TextInput readOnly value={value} className="font-mono text-meta" />
        <Button
          variant="secondary"
          size="sm"
          icon={<Copy className="size-3.5" />}
          onClick={() => {
            void navigator.clipboard?.writeText(value).then(() => {
              setCopiado(true);
              setTimeout(() => setCopiado(false), 1500);
            });
          }}
        >
          {copiado ? 'Copiado' : 'Copiar'}
        </Button>
      </div>
    </Field>
  );
}

/**
 * Gestão de uma caixa conectada pela API oficial.
 *
 * Mostra o que a Meta diz do número (qualidade, limite), o webhook que precisa
 * estar configurado no app, e os templates — que são o único jeito de falar com
 * um cliente depois das 24 h.
 */
export function CloudApiPanel({
  inboxId,
  status,
  verifyToken,
  onChanged,
}: {
  readonly inboxId: string;
  readonly status: WhatsAppStatusPayload;
  /** Só logo depois de conectar: o verify token não fica guardado em claro. */
  readonly verifyToken?: string;
  readonly onChanged: () => void;
}) {
  const cloud = status.cloud;
  const [pending, setPending] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [templates, setTemplates] = useState<readonly TemplateRow[]>([]);
  const [novo, setNovo] = useState({ name: '', category: 'UTILITY', language: 'pt_BR', body: '' });

  const carregarTemplates = useCallback(async () => {
    const response = await fetch(`/api/inboxes/${inboxId}/whatsapp/cloud/templates`, {
      cache: 'no-store',
    });
    const data = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      templates?: TemplateRow[];
    };
    if (data.ok && data.templates) setTemplates(data.templates);
  }, [inboxId]);

  useEffect(() => {
    void carregarTemplates();
  }, [carregarTemplates]);

  const chamar = async (acao: string, url: string, body?: object) => {
    setPending(acao);
    setError(undefined);
    setMessage(undefined);
    try {
      const response = await fetch(url, {
        method: 'POST',
        ...(body
          ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
          : {}),
      });
      const data = (await response.json()) as { ok: boolean; error?: string; total?: number };
      if (!data.ok) {
        setError(data.error ?? 'A operação falhou.');
        return false;
      }
      if (typeof data.total === 'number') setMessage(`${data.total} template(s) sincronizado(s).`);
      return true;
    } catch {
      setError('Não foi possível falar com o servidor.');
      return false;
    } finally {
      setPending(undefined);
    }
  };

  const qualidade = cloud?.qualityRating ? QUALIDADE[cloud.qualityRating] : undefined;
  const semWebhook = cloud && !cloud.lastWebhookAt;

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex flex-col gap-2 rounded-surface border border-green-border/40 bg-green-soft/30 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <ShieldCheck className="size-5 text-green-text" />
          <span className="font-display text-ui font-semibold text-ink">
            API oficial do WhatsApp
          </span>
          <Badge tone={status.status === 'conectado' ? 'green' : 'red'} withDot>
            {status.status === 'conectado' ? 'Conectada' : 'Com erro'}
          </Badge>
          {cloud?.coexistence ? <Badge tone="blue">Coexistência</Badge> : null}
        </div>
        <p className="font-mono text-ui font-bold text-green-text">{status.phone}</p>
        {status.name ? <p className="text-body text-muted">{status.name}</p> : null}
        <div className="flex flex-wrap gap-3 text-meta text-muted">
          <span>
            Qualidade:{' '}
            {qualidade ? <Badge tone={qualidade.tone}>{qualidade.label}</Badge> : 'sem avaliação'}
          </span>
          {cloud?.messagingLimit ? <span>Limite: {cloud.messagingLimit}</span> : null}
        </div>
        {status.error ? <p className="text-meta text-red-text">{status.error}</p> : null}
      </div>

      {cloud?.webhookUrl ? (
        <div className="flex flex-col gap-3 rounded-control border border-line bg-surface p-3">
          {semWebhook ? (
            <p className="text-meta font-medium text-amber-text">
              A Meta ainda não mandou nenhum evento. Configure o webhook no app e assine o campo
              &ldquo;messages&rdquo;.
            </p>
          ) : (
            <p className="text-meta text-muted">
              Último evento da Meta: {new Date(cloud.lastWebhookAt ?? '').toLocaleString('pt-BR')}
            </p>
          )}
          <Copiavel label="URL de retorno (webhook)" value={cloud.webhookUrl} />
          {verifyToken ? (
            <Copiavel label="Verify token (aparece só agora)" value={verifyToken} />
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          size="sm"
          icon={<RefreshCw className="size-3.5" />}
          disabled={Boolean(pending)}
          onClick={() =>
            void chamar('testar', `/api/inboxes/${inboxId}/whatsapp/cloud/test`).then((ok) => {
              if (ok) {
                setMessage('Conexão conferida na Meta.');
                onChanged();
              }
            })
          }
        >
          {pending === 'testar' ? 'Testando…' : 'Testar conexão'}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          icon={<RefreshCw className="size-3.5" />}
          disabled={Boolean(pending)}
          onClick={() =>
            void chamar(
              'sincronizar',
              `/api/inboxes/${inboxId}/whatsapp/cloud/templates?acao=sincronizar`,
            ).then(async (ok) => {
              if (ok) await carregarTemplates();
            })
          }
        >
          {pending === 'sincronizar' ? 'Sincronizando…' : 'Sincronizar templates'}
        </Button>
        <Button
          variant="danger"
          size="sm"
          icon={<Unplug className="size-3.5" />}
          disabled={Boolean(pending)}
          onClick={() => {
            if (!window.confirm('Desconectar a API oficial desta caixa? O token será apagado.'))
              return;
            void chamar('desconectar', `/api/inboxes/${inboxId}/whatsapp/cloud/disconnect`).then(
              (ok) => {
                if (ok) onChanged();
              },
            );
          }}
        >
          {pending === 'desconectar' ? 'Desconectando…' : 'Desconectar'}
        </Button>
      </div>

      {message ? <p className="text-meta text-green-text">{message}</p> : null}
      {error ? <p className="text-meta text-red-text">{error}</p> : null}

      <div className="flex flex-col gap-2">
        <h4 className="font-display text-body font-semibold text-ink">Templates</h4>
        {templates.length === 0 ? (
          <p className="text-meta text-dim">Nenhum template desta conta ainda.</p>
        ) : (
          <ul className="flex max-h-48 flex-col gap-1.5 overflow-y-auto">
            {templates.map((tpl) => {
              const st = STATUS_TEMPLATE[tpl.status] ?? {
                label: tpl.status,
                tone: 'slate' as const,
              };
              return (
                <li
                  key={tpl.id}
                  className="rounded-control border border-line bg-surface px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-mono text-meta text-ink">
                      {tpl.name} · {tpl.language}
                    </span>
                    <Badge tone={st.tone}>{st.label}</Badge>
                  </div>
                  <p className="line-clamp-2 text-meta text-muted">{tpl.body}</p>
                  {tpl.rejectedReason ? (
                    <p className="text-meta text-red-text">Motivo: {tpl.rejectedReason}</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        <details className="rounded-control border border-line bg-surface-2 p-3">
          <summary className="cursor-pointer text-meta font-semibold text-ink">
            Criar template na Meta
          </summary>
          <div className="mt-3 flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Nome" htmlFor="tpl-name" hint="minúsculas e _">
                <TextInput
                  id="tpl-name"
                  value={novo.name}
                  onChange={(e) =>
                    setNovo((v) => ({
                      ...v,
                      name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'),
                    }))
                  }
                />
              </Field>
              <Field label="Categoria" htmlFor="tpl-category">
                <select
                  id="tpl-category"
                  value={novo.category}
                  onChange={(e) => setNovo((v) => ({ ...v, category: e.target.value }))}
                  className="h-9.5 rounded-control border border-line bg-surface px-2 text-body text-ink"
                >
                  <option value="UTILITY">Utilidade</option>
                  <option value="MARKETING">Marketing</option>
                  <option value="AUTHENTICATION">Autenticação</option>
                </select>
              </Field>
              <Field label="Idioma" htmlFor="tpl-language">
                <TextInput
                  id="tpl-language"
                  value={novo.language}
                  onChange={(e) => setNovo((v) => ({ ...v, language: e.target.value }))}
                />
              </Field>
            </div>
            <Field label="Texto" htmlFor="tpl-body" hint="Use {{1}}, {{2}} para as variáveis.">
              <TextArea
                id="tpl-body"
                rows={3}
                value={novo.body}
                onChange={(e) => setNovo((v) => ({ ...v, body: e.target.value }))}
              />
            </Field>
            <Button
              variant="primary"
              size="sm"
              disabled={Boolean(pending) || !novo.name || !novo.body.trim()}
              onClick={() =>
                void chamar('criar', `/api/inboxes/${inboxId}/whatsapp/cloud/templates`, novo).then(
                  (ok) => {
                    if (!ok) return;
                    setMessage('Template enviado para análise da Meta.');
                    setNovo({ name: '', category: 'UTILITY', language: 'pt_BR', body: '' });
                    void carregarTemplates();
                  },
                )
              }
            >
              {pending === 'criar' ? 'Enviando…' : 'Enviar para aprovação'}
            </Button>
          </div>
        </details>
      </div>
    </div>
  );
}
