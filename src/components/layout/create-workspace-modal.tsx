'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { ImagePlus, X } from 'lucide-react';
import { WORKSPACE_NAME_MAX, workspaceNameProblem } from '@/core/domain/account-provisioning';
import { ALLOWED_LOGO_MIME_TYPES, MAX_LOGO_BYTES } from '@/core/domain/image-upload';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Field, TextInput } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { createWorkspaceAction } from './workspace-actions';

interface CreateWorkspaceModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

/**
 * Criação de workspace: nome e, se quiser, a foto.
 *
 * No sucesso a action troca a sessão para o workspace novo e redireciona, então
 * o modal não precisa se fechar sozinho: a página inteira muda.
 */
export function CreateWorkspaceModal({ open, onClose }: CreateWorkspaceModalProps) {
  const [pending, startTransition] = useTransition();
  const [nome, setNome] = useState('');
  const [logo, setLogo] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | undefined>();
  const [erro, setErro] = useState<string | undefined>();
  const inputRef = useRef<HTMLInputElement>(null);

  // A URL de pré-visualização segura o arquivo na memória até ser revogada.
  useEffect(() => {
    if (!logo) {
      setPreview(undefined);
      return;
    }
    const url = URL.createObjectURL(logo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [logo]);

  const fechar = () => {
    if (pending) return;
    setNome('');
    setLogo(null);
    setErro(undefined);
    onClose();
  };

  const escolherLogo = (event: React.ChangeEvent<HTMLInputElement>) => {
    const arquivo = event.target.files?.[0];
    event.target.value = '';
    if (!arquivo) return;
    if (!(ALLOWED_LOGO_MIME_TYPES as readonly string[]).includes(arquivo.type)) {
      setErro('Envie uma imagem PNG ou WEBP.');
      return;
    }
    if (arquivo.size > MAX_LOGO_BYTES) {
      setErro('A imagem passou de 2 MB. Escolha um arquivo menor.');
      return;
    }
    setErro(undefined);
    setLogo(arquivo);
  };

  const criar = (event: React.FormEvent) => {
    event.preventDefault();
    const problema = workspaceNameProblem(nome);
    if (problema) {
      setErro(problema);
      return;
    }
    setErro(undefined);

    const formData = new FormData();
    formData.set('name', nome.trim());
    if (logo) formData.set('logo', logo);

    startTransition(async () => {
      const result = await createWorkspaceAction(formData);
      // Só chega aqui quando deu errado: o sucesso redireciona.
      if (!result.ok) setErro(result.error ?? 'Não foi possível criar o workspace.');
    });
  };

  return (
    <Modal
      open={open}
      onClose={fechar}
      title="Criar novo workspace"
      description="Cada workspace tem contatos, conversas, funil e números de WhatsApp próprios. Você entra nele como administrador."
    >
      <form onSubmit={criar} className="flex flex-col gap-4">
        <div className="flex items-center gap-4">
          <Avatar name={nome.trim() || 'Novo workspace'} src={preview} size="lg" />
          <div className="flex flex-col items-start gap-1.5">
            <input
              ref={inputRef}
              type="file"
              accept={ALLOWED_LOGO_MIME_TYPES.join(',')}
              className="hidden"
              onChange={escolherLogo}
            />
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                icon={<ImagePlus className="size-3.5" />}
                onClick={() => inputRef.current?.click()}
                disabled={pending}
              >
                {logo ? 'Trocar foto' : 'Escolher foto'}
              </Button>
              {logo ? (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<X className="size-3.5" />}
                  onClick={() => setLogo(null)}
                  disabled={pending}
                >
                  Remover
                </Button>
              ) : null}
            </div>
            <span className="text-meta text-dim">Opcional. PNG ou WEBP, até 2 MB.</span>
          </div>
        </div>

        <Field label="Nome do workspace" htmlFor="workspace-nome">
          <TextInput
            id="workspace-nome"
            value={nome}
            maxLength={WORKSPACE_NAME_MAX}
            placeholder="Ex.: Clínica Centro"
            onChange={(event) => setNome(event.target.value)}
            autoFocus
            required
          />
        </Field>

        {erro ? (
          <p
            role="alert"
            className="rounded-control border border-red-line bg-red-soft px-3 py-2 text-body text-red-text"
          >
            {erro}
          </p>
        ) : null}

        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button type="button" variant="secondary" onClick={fechar} disabled={pending}>
            Cancelar
          </Button>
          <Button type="submit" disabled={pending || nome.trim().length === 0}>
            {pending ? 'Criando…' : 'Criar e entrar'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
