import type { Account } from '@/core/domain/user';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, TextInput } from '@/components/ui/field';
import { planned } from '@/components/ui/planned';

interface CompanySectionProps {
  readonly account: Account;
}

export function CompanySection({ account }: CompanySectionProps) {
  return (
    <div className="max-w-xl">
      <Card className="flex flex-col gap-4 p-6">
        <div>
          <h3 className="font-display text-title font-semibold text-ink">
            Dados da organização
          </h3>
          <p className="text-body text-muted">
            Essas informações são visíveis nos relatórios e para contatos externos.
          </p>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex size-14 items-center justify-center rounded-surface bg-brand-gradient font-display text-metric font-bold text-white shadow-xs">
            {account.name.charAt(0)}
          </div>
          <Button variant="secondary" size="sm" {...planned('Enviar um novo logotipo da empresa')}>
            Alterar logotipo
          </Button>
        </div>

        <Field label="Nome da empresa" htmlFor="company-name">
          <TextInput id="company-name" defaultValue={account.name} />
        </Field>

        <Field label="CNPJ / Documento" htmlFor="company-doc">
          <TextInput
            id="company-doc"
            defaultValue={account.document ?? '12.345.678/0001-90'}
          />
        </Field>

        <Field
          label="Domínio exclusivo do workspace"
          htmlFor="company-domain"
          hint="Usado para acesso direto e links públicos de atendimento."
        >
          <TextInput
            id="company-domain"
            defaultValue={`${account.name.toLowerCase().replace(/\s+/g, '')}.solint.app`}
            className="font-mono text-body"
          />
        </Field>

        <Field label="Fuso horário padrão" htmlFor="company-tz">
          <TextInput id="company-tz" defaultValue="GMT-3 · São Paulo (Horário de Brasília)" />
        </Field>

        <div className="mt-2 flex justify-end border-t border-line pt-4">
          <Button size="sm" {...planned('Salvar os dados da empresa')}>Salvar alterações</Button>
        </div>
      </Card>
    </div>
  );
}
