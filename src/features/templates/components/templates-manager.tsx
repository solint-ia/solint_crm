'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { FileText, Plus, RefreshCw, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, Select, TextArea, TextInput } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { SectionTitle } from '@/components/ui/section';
import { renderTemplate } from '@/core/domain/campaign';

export interface TemplateInbox {
  readonly id: string;
  readonly name: string;
  readonly phone: string;
  readonly verifiedName?: string;
  readonly wabaId: string;
  readonly status: string;
}

export interface TemplateItem {
  readonly id: string;
  readonly name: string;
  readonly language: string;
  readonly category: string;
  readonly status: string;
  readonly body: string;
  readonly headerContent: string | null;
  readonly footer: string | null;
  readonly rejectedReason: string | null;
  /** Nulo nos templates locais, usados como texto pelo QR Code. */
  readonly wabaId: string | null;
  readonly createdAt: string;
}

const STATUS: Readonly<
  Record<string, { label: string; tone: 'green' | 'amber' | 'red' | 'slate' }>
> = {
  approved: { label: 'Aprovado', tone: 'green' },
  pending: { label: 'Em análise', tone: 'amber' },
  rejected: { label: 'Recusado', tone: 'red' },
  paused: { label: 'Pausado', tone: 'amber' },
  disabled: { label: 'Desativado', tone: 'slate' },
};

const CATEGORIA: Readonly<Record<string, string>> = {
  marketing: 'Marketing',
  utility: 'Utilidade',
  authentication: 'Autenticação',
};

const CONEXAO: Readonly<Record<string, { label: string; tone: 'green' | 'amber' | 'red' }>> = {
  conectado: { label: 'Conectada', tone: 'green' },
  conectando: { label: 'Aguardando a Meta', tone: 'amber' },
  pendente_registro: { label: 'Número não registrado', tone: 'amber' },
  erro: { label: 'Com erro', tone: 'red' },
};

/** Variáveis `{{1}}`, `{{2}}`… na ordem, sem repetir. */
const variaveisDo = (texto: string): number[] => {
  const numeros = [...texto.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
  return [...new Set(numeros)].sort((a, b) => a - b);
};

const FORM_VAZIO = { name: '', category: 'UTILITY', language: 'pt_BR', body: '' };

/**
 * Gestão dos templates da API oficial.
 *
 * Uma WABA por vez: cada caixa oficial aponta para uma conta do WhatsApp
 * Business, e a lista da Meta é por conta. As ações (sincronizar, criar) usam
 * as rotas da caixa escolhida, que já conferem permissão e alcance da caixa no
 * servidor — nada aqui decide sozinho quem pode.
 */
export function TemplatesManager({
  inboxes,
  templates: iniciais,
}: {
  readonly inboxes: readonly TemplateInbox[];
  readonly templates: readonly TemplateItem[];
}) {
  const [inboxId, setInboxId] = useState(inboxes[0]?.id ?? '');
  const [templates, setTemplates] = useState(iniciais);
  const [pending, setPending] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [criando, setCriando] = useState(false);
  const [form, setForm] = useState(FORM_VAZIO);
  const [exemplos, setExemplos] = useState<readonly string[]>([]);

  const caixa = inboxes.find((item) => item.id === inboxId);
  const daWaba = useMemo(
    () => (caixa ? templates.filter((t) => t.wabaId === caixa.wabaId) : []),
    [caixa, templates],
  );
  const locais = useMemo(() => templates.filter((t) => !t.wabaId), [templates]);
  const variaveis = variaveisDo(form.body);

  const recarregar = useCallback(async () => {
    if (!inboxId) return;
    const response = await fetch(`/api/inboxes/${inboxId}/whatsapp/cloud/templates`, {
      cache: 'no-store',
    });
    const data = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      templates?: Omit<TemplateItem, 'wabaId' | 'createdAt' | 'headerContent' | 'footer'>[];
    };
    if (!data.ok || !data.templates || !caixa) return;
    const outros = templates.filter((t) => t.wabaId !== caixa.wabaId);
    const vindos: TemplateItem[] = data.templates.map((t) => ({
      ...t,
      headerContent: null,
      footer: null,
      wabaId: caixa.wabaId,
      createdAt: new Date().toISOString(),
    }));
    setTemplates([...outros, ...vindos]);
  }, [caixa, inboxId, templates]);

  const chamar = async (acao: string, url: string, body?: object): Promise<boolean> => {
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
      const data = (await response.json()) as {
        ok: boolean;
        error?: string;
        total?: number;
        status?: string;
      };
      if (!data.ok) {
        setError(data.error ?? 'A operação falhou.');
        return false;
      }
      if (typeof data.total === 'number') {
        setMessage(`${data.total} template(s) sincronizado(s) da Meta.`);
      }
      return true;
    } catch {
      setError('Não foi possível falar com o servidor.');
      return false;
    } finally {
      setPending(undefined);
    }
  };

  const sincronizar = () =>
    void chamar(
      'sincronizar',
      `/api/inboxes/${inboxId}/whatsapp/cloud/templates?acao=sincronizar`,
    ).then(async (ok) => {
      if (ok) await recarregar();
    });

  const criar = () =>
    void chamar('criar', `/api/inboxes/${inboxId}/whatsapp/cloud/templates`, {
      ...form,
      examples: variaveis.map((numero) => exemplos[numero - 1] ?? ''),
    }).then(async (ok) => {
      if (!ok) return;
      setCriando(false);
      setForm(FORM_VAZIO);
      setExemplos([]);
      setMessage('Template enviado para a análise da Meta. A aprovação chega pelo webhook.');
      await recarregar();
    });

  if (inboxes.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <EmptyState
          icon={<ShieldCheck className="size-8" />}
          title="Nenhuma caixa conectada pela API oficial"
          description="Templates são um recurso da API oficial da Meta. Conecte um número oficial em Configurações › Caixas de entrada para sincronizar os templates aprovados e criar novos."
          action={
            <Link href="/configuracoes?secao=caixas">
              <Button size="sm">Ir para Caixas de entrada</Button>
            </Link>
          }
        />
        {locais.length > 0 ? <TemplatesLocais templates={locais} /> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 border-b border-line pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1.5 sm:max-w-md sm:flex-1">
          <label htmlFor="tpl-inbox" className="text-meta font-semibold text-muted">
            Conta do WhatsApp Business
          </label>
          <Select id="tpl-inbox" value={inboxId} onChange={(e) => setInboxId(e.target.value)}>
            {inboxes.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · {item.phone}
                {item.verifiedName ? ` · ${item.verifiedName}` : ''}
              </option>
            ))}
          </Select>
          {caixa ? (
            <p className="flex flex-wrap items-center gap-2 text-meta text-muted">
              <span className="font-mono">WABA {caixa.wabaId}</span>
              <Badge tone={CONEXAO[caixa.status]?.tone ?? 'slate'} withDot>
                {CONEXAO[caixa.status]?.label ?? caixa.status}
              </Badge>
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            icon={<RefreshCw className="size-3.5" />}
            disabled={Boolean(pending) || !inboxId}
            onClick={sincronizar}
          >
            {pending === 'sincronizar' ? 'Sincronizando…' : 'Sincronizar com a Meta'}
          </Button>
          <Button
            size="sm"
            icon={<Plus className="size-3.5" />}
            disabled={Boolean(pending) || !inboxId}
            onClick={() => setCriando(true)}
          >
            Novo template
          </Button>
        </div>
      </div>

      {message ? <p className="text-body text-green-text">{message}</p> : null}
      {error ? <p className="text-body text-red-text">{error}</p> : null}

      <section>
        <SectionTitle
          title="Templates desta conta"
          hint={`${daWaba.length} ${daWaba.length === 1 ? 'modelo' : 'modelos'}`}
        />
        {daWaba.length === 0 ? (
          <EmptyState
            icon={<FileText className="size-8" />}
            title="Nenhum template sincronizado"
            description="Clique em “Sincronizar com a Meta” para trazer os templates já aprovados no painel da Meta, ou crie um novo e envie para aprovação."
          />
        ) : (
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {daWaba.map((tpl) => (
              <li key={tpl.id}>
                <TemplateCard template={tpl} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {locais.length > 0 ? <TemplatesLocais templates={locais} /> : null}

      <Modal
        open={criando}
        onClose={() => setCriando(false)}
        title="Novo template"
        description="O template vai para a análise da Meta e só pode ser usado depois de aprovado. Nome e texto não podem ser alterados depois do envio."
      >
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Nome" htmlFor="tpl-name" hint="minúsculas, números e _">
              <TextInput
                id="tpl-name"
                value={form.name}
                placeholder="confirmacao_pedido"
                onChange={(e) =>
                  setForm((v) => ({
                    ...v,
                    name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'),
                  }))
                }
              />
            </Field>
            <Field label="Categoria" htmlFor="tpl-category">
              <Select
                id="tpl-category"
                value={form.category}
                onChange={(e) => setForm((v) => ({ ...v, category: e.target.value }))}
              >
                <option value="UTILITY">Utilidade</option>
                <option value="MARKETING">Marketing</option>
                <option value="AUTHENTICATION">Autenticação</option>
              </Select>
            </Field>
            <Field label="Idioma" htmlFor="tpl-language">
              <Select
                id="tpl-language"
                value={form.language}
                onChange={(e) => setForm((v) => ({ ...v, language: e.target.value }))}
              >
                <option value="pt_BR">Português (Brasil)</option>
                <option value="pt_PT">Português (Portugal)</option>
                <option value="en_US">Inglês (EUA)</option>
                <option value="es">Espanhol</option>
              </Select>
            </Field>
          </div>

          <Field
            label="Texto"
            htmlFor="tpl-body"
            hint="Use {{1}}, {{2}}… para as partes que mudam a cada envio."
          >
            <TextArea
              id="tpl-body"
              rows={5}
              maxLength={1024}
              value={form.body}
              placeholder="Olá {{1}}, seu pedido {{2}} foi confirmado."
              onChange={(e) => setForm((v) => ({ ...v, body: e.target.value }))}
            />
          </Field>

          {variaveis.length > 0 ? (
            <div className="flex flex-col gap-2">
              <p className="text-meta font-semibold text-muted">
                Exemplos das variáveis
                <span className="ml-1 font-normal text-dim">
                  A Meta exige um exemplo real de cada uma para analisar.
                </span>
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {variaveis.map((numero) => (
                  <TextInput
                    key={numero}
                    aria-label={`Exemplo da variável ${numero}`}
                    placeholder={`Exemplo de {{${numero}}}`}
                    value={exemplos[numero - 1] ?? ''}
                    onChange={(e) =>
                      setExemplos((atuais) => {
                        // Indexado pelo número da variável: `renderTemplate`
                        // lê `values[n - 1]`, e a prévia precisa bater com o envio.
                        const proximos = [...atuais];
                        proximos[numero - 1] = e.target.value;
                        return proximos;
                      })
                    }
                  />
                ))}
              </div>
            </div>
          ) : null}

          {form.body.trim() ? (
            <div className="rounded-control border border-line bg-surface-2 p-3">
              <p className="mb-1 text-meta font-semibold text-muted">Como chega no cliente</p>
              <p className="whitespace-pre-wrap text-body text-ink">
                {renderTemplate(form.body, exemplos)}
              </p>
            </div>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setCriando(false)}>
              Cancelar
            </Button>
            <Button
              size="sm"
              disabled={
                Boolean(pending) ||
                !form.name ||
                !form.body.trim() ||
                variaveis.some((numero) => !exemplos[numero - 1]?.trim())
              }
              onClick={criar}
            >
              {pending === 'criar' ? 'Enviando…' : 'Enviar para aprovação'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function TemplateCard({ template }: { readonly template: TemplateItem }) {
  const st = STATUS[template.status] ?? { label: template.status, tone: 'slate' as const };
  return (
    <Card className="flex h-full flex-col gap-2">
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-mono text-body font-semibold text-ink">{template.name}</p>
          <p className="text-meta text-muted">
            {CATEGORIA[template.category.toLowerCase()] ?? template.category} · {template.language}
          </p>
        </div>
        <Badge tone={st.tone} withDot>
          {st.label}
        </Badge>
      </header>
      {template.headerContent ? (
        <p className="text-body font-semibold text-ink">{template.headerContent}</p>
      ) : null}
      <p className="line-clamp-5 whitespace-pre-wrap text-body text-muted">{template.body}</p>
      {template.footer ? <p className="text-meta text-dim">{template.footer}</p> : null}
      {template.rejectedReason ? (
        <p className="mt-auto rounded-control bg-red-soft px-2 py-1 text-meta text-red-text">
          Motivo da Meta: {template.rejectedReason}
        </p>
      ) : null}
    </Card>
  );
}

/**
 * Templates sem WABA: criados no CRM antes da API oficial e usados como texto
 * comum nas caixas de QR Code. Ficam visíveis para ninguém procurar por eles
 * na lista da Meta, mas não têm aprovação nem podem ser enviados para ela.
 */
function TemplatesLocais({ templates }: { readonly templates: readonly TemplateItem[] }) {
  return (
    <section>
      <SectionTitle
        title="Templates locais"
        hint="usados como texto nas caixas de QR Code; não passam pela Meta"
      />
      <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {templates.map((tpl) => (
          <li key={tpl.id}>
            <TemplateCard template={tpl} />
          </li>
        ))}
      </ul>
    </section>
  );
}
