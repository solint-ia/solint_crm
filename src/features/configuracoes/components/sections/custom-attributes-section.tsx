import { Plus } from 'lucide-react';
import type { CustomAttributeDefinition } from '@/core/domain/settings';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { planned } from '@/components/ui/planned';

interface CustomAttributesSectionProps {
  readonly attributes: readonly CustomAttributeDefinition[];
}

export function CustomAttributesSection({ attributes }: CustomAttributesSectionProps) {
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-display text-ui font-semibold text-ink">
            Atributos personalizados
          </h3>
          <p className="text-body text-muted">
            Campos adicionais para contatos e conversas mapeados em integrações e no painel lateral.
          </p>
        </div>
        <Button size="sm" icon={<Plus className="size-3.5" />} {...planned('Criar um atributo personalizado')}>
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
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {attributes.map((attr) => (
                <tr key={attr.id} className="hover:bg-surface-2 transition-colors">
                  <td className="px-4 py-3 font-semibold text-ink">{attr.name}</td>
                  <td className="px-4 py-3 font-mono text-body text-muted">{attr.key}</td>
                  <td className="px-4 py-3 capitalize text-muted">{attr.appliesTo}</td>
                  <td className="px-4 py-3">
                    <Badge tone="slate">{attr.type}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
