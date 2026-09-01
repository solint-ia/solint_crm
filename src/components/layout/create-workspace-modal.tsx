'use client';

import { useState, useTransition } from 'react';
import { MAX_WORKSPACES_POR_USUARIO, WORKSPACE_NAME_MAX } from '@/core/domain/account-provisioning';
import { Button } from '@/components/ui/button';
import { Field, TextInput } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { createWorkspaceAction } from './workspace-actions';

interface CreateWorkspaceModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

/**
 * Criação de workspace.
 *
 * Pede duas coisas e nada mais. O resto do cadastro de empresa (endereço,
 * formato de data, marca) mora em Configurações e pode esperar: o que decide se
 * o workspace serve para alguma coisa é parear um número de WhatsApp, e é para
 * lá que a ação leva assim que a conta existe.
 */
export function CreateWorkspaceModal({ open, onClose }: CreateWorkspaceModalProps) {
  const [name, setName] = useState('');
  const [document, setDocument] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [pending, startTransition] = useTransition();

  const fechar = () => {
    if (pending) return;
    setName('');
    setDocument('');
    setError(undefined);
    onClose();
  };

  const criar = () => {
    setError(undefined);
    startTransition(async () => {
      // Em caso de sucesso a ação redireciona e nada abaixo executa.
      const result = await createWorkspaceAction({ name, document });
      if (!result.ok) setError(result.error ?? 'Não foi possível criar o workspace.');
    });
  };

  return (
    <Modal
      open={open}
      onClose={fechar}
      title="Criar novo workspace"
      description="Um workspace tem contatos, conversas, funil e equipe próprios. Nada é compartilhado entre eles."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={fechar} disabled={pending}>
            Cancelar
          </Button>
          <Button size="sm" onClick={criar} disabled={pending || name.trim().length < 2}>
            {pending ? 'Criando...' : 'Criar e entrar'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <Field
          label="Nome do workspace"
          htmlFor="workspace-name"
          hint="É o nome que aparece no seletor do topo e nas mensagens da equipe."
          {...(error ? { error } : {})}
        >
          <TextInput
            id="workspace-name"
            value={name}
            maxLength={WORKSPACE_NAME_MAX}
            autoFocus
            placeholder="Clínica Bem Viver"
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && name.trim().length >= 2) criar();
            }}
          />
        </Field>

        <Field
          label="CNPJ ou CPF (opcional)"
          htmlFor="workspace-document"
          hint="Pode ficar em branco e ser preenchido depois em Configurações."
        >
          <TextInput
            id="workspace-document"
            value={document}
            maxLength={24}
            placeholder="00.000.000/0001-00"
            onChange={(event) => setDocument(event.target.value)}
          />
        </Field>

        <p className="text-meta text-dim">
          Você entra como administrador do workspace novo, e ele já nasce com uma caixa de entrada e
          um funil comercial prontos. Cada pessoa pode administrar até {MAX_WORKSPACES_POR_USUARIO}{' '}
          workspaces.
        </p>
      </div>
    </Modal>
  );
}
