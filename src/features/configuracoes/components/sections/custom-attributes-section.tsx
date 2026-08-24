'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2 } from 'lucide-react';
import type { CustomAttributeDefinition } from '@/core/domain/settings';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Modal } from '@/components/ui/modal';
import {
  createCustomAttributeAction,
  deleteCustomAttributeAction,
} from '@/app/(workspace)/configuracoes/actions';

interface CustomAttributesSectionProps {
  readonly attributes: readonly CustomAttributeDefinition[];
}

export function CustomAttributesSection({ attributes }: CustomAttributesSectionProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [type, setType] = useState<CustomAttributeDefinition['type']>('texto');
  const [appliesTo, setAppliesTo] = useState<CustomAttributeDefinition['appliesTo']>('contato');
  const [error, setError] = useState<string | null>(null);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await createCustomAttributeAction({
        name,
        key: key.toLowerCase().replace(/[^a-z0-9_]/g, '_'),
        type,
        appliesTo,
      });
      if (res.ok) {
        setIsModalOpen(false);
        setName('');
        setKey('');
        router.refresh();
      } else {
        setError(res.error ?? 'Erro ao salvar atributo.');
      }
    });
  };

  const handleDelete = (attributeId: string) => {
    if (!confirm('Deseja realmente excluir este atributo?')) return;
    startTransition(async () => {
      await deleteCustomAttributeAction({ attributeId });
      router.refresh();
    });
  };

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <Modal
        open={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Novo atributo personalizado"
      >
        <form onSubmit={handleSave} className="flex flex-col gap-4">
          {error && (
            <div className="rounded-md bg-danger/10 p-3 text-body text-danger">
              {error}
            </div>
          )}
          <div>
            <label className="mb-1 block text-meta font-medium text-ink">Nome do atributo</label>
            <input
              type="text"
              required
              placeholder="Ex: CPF ou Código do Cliente"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (!key) {
                  setKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'));
                }
              }}
              className="w-full rounded-md border border-line bg-surface px-3 py-2 text-body text-ink focus:border-primary focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-meta font-medium text-ink">Chave identificadora (API)</label>
            <input
              type="text"
              required
              placeholder="ex: cpf ou codigo_cliente"
              value={key}
              onChange={(e) => setKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
              className="w-full rounded-md border border-line bg-surface px-3 py-2 font-mono text-body text-ink focus:border-primary focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-meta font-medium text-ink">Aplica-se a</label>
              <select
                value={appliesTo}
                onChange={(e) => setAppliesTo(e.target.value as CustomAttributeDefinition['appliesTo'])}
                className="w-full rounded-md border border-line bg-surface px-3 py-2 text-body text-ink focus:border-primary focus:outline-none"
              >
                <option value="contato">Contato</option>
                <option value="conversa">Oportunidade / Negócio</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-meta font-medium text-ink">Tipo do campo</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as CustomAttributeDefinition['type'])}
                className="w-full rounded-md border border-line bg-surface px-3 py-2 text-body text-ink focus:border-primary focus:outline-none"
              >
                <option value="texto">Texto</option>
                <option value="numero">Número</option>
                <option value="data">Data</option>
                <option value="booleano">Sim / Não (Booleano)</option>
              </select>
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2 border-t border-line-soft pt-3">
            <Button variant="ghost" type="button" onClick={() => setIsModalOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending || !name.trim() || !key.trim()}>
              {isPending ? 'Salvando...' : 'Criar atributo'}
            </Button>
          </div>
        </form>
      </Modal>

      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-display text-ui font-semibold text-ink">
            Atributos personalizados
          </h3>
          <p className="text-body text-muted">
            Campos adicionais para contatos e conversas mapeados em integrações e no painel lateral.
          </p>
        </div>
        <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setIsModalOpen(true)}>
          Novo atributo
        </Button>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-ui">
            <caption className="sr-only">Lista de atributos personalizados</caption>
            <thead className="border-b border-line bg-surface-2 text-meta font-semibold text-muted uppercase">
              <tr>
                <th scope="col" className="px-4 py-3">Nome</th>
                <th scope="col" className="px-4 py-3">Chave (API)</th>
                <th scope="col" className="px-4 py-3">Aplica-se a</th>
                <th scope="col" className="px-4 py-3">Tipo</th>
                <th scope="col" className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {attributes.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-4 text-center text-muted">Nenhum atributo cadastrado.</td>
                </tr>
              ) : (
                attributes.map((attr) => (
                  <tr key={attr.id} className="hover:bg-surface-2 transition-colors">
                    <td className="px-4 py-3 font-semibold text-ink">{attr.name}</td>
                    <td className="px-4 py-3 font-mono text-body text-muted">{attr.key}</td>
                    <td className="px-4 py-3 capitalize text-muted">{attr.appliesTo}</td>
                    <td className="px-4 py-3">
                      <Badge tone="slate">{attr.type}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(attr.id)}
                        icon={<Trash2 className="size-3.5 text-danger" />}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
