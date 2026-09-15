'use client';

import { useState, useTransition } from 'react';
import { MIN_PASSWORD_LENGTH } from '@/core/domain/user';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { PasswordInput } from '@/components/ui/password-input';
import { useToast } from '@/components/ui/toast';
import { changePasswordAction } from '@/app/(workspace)/perfil/actions';

interface ChangePasswordModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

const VAZIO = { atual: '', nova: '', confirmacao: '' };

/**
 * Troca de senha com confirmação dupla.
 *
 * A tela confere o que dá para conferir sem o servidor (tamanho e se as duas
 * digitações batem) só para avisar cedo. A decisão é da Server Action, que
 * repete tudo e é a única que sabe se a senha atual está certa.
 */
export function ChangePasswordModal({ open, onClose }: ChangePasswordModalProps) {
  const { show } = useToast();
  const [pending, startTransition] = useTransition();
  const [campos, setCampos] = useState(VAZIO);
  const [erro, setErro] = useState<string | undefined>();

  const naoConfere = campos.confirmacao.length > 0 && campos.confirmacao !== campos.nova;
  const curta = campos.nova.length > 0 && campos.nova.length < MIN_PASSWORD_LENGTH;
  const podeEnviar =
    campos.atual.length > 0 &&
    campos.nova.length >= MIN_PASSWORD_LENGTH &&
    campos.confirmacao === campos.nova &&
    !pending;

  const fechar = () => {
    if (pending) return;
    setCampos(VAZIO);
    setErro(undefined);
    onClose();
  };

  const enviar = (event: React.FormEvent) => {
    event.preventDefault();
    if (!podeEnviar) return;
    setErro(undefined);

    startTransition(async () => {
      const result = await changePasswordAction({
        currentPassword: campos.atual,
        newPassword: campos.nova,
        confirmPassword: campos.confirmacao,
      });

      if (!result.ok) {
        setErro(result.error ?? 'Não foi possível trocar a senha.');
        return;
      }

      show({
        tone: 'sucesso',
        title: 'Senha alterada',
        description: 'As sessões abertas em outros dispositivos foram encerradas.',
      });
      setCampos(VAZIO);
      onClose();
    });
  };

  return (
    <Modal
      open={open}
      onClose={fechar}
      title="Alterar senha"
      description="Confirme a senha atual e digite a nova duas vezes."
    >
      <form id="form-alterar-senha" onSubmit={enviar} className="flex flex-col gap-4">
        <Field label="Senha atual" htmlFor="senha-atual">
          <PasswordInput
            id="senha-atual"
            autoComplete="current-password"
            value={campos.atual}
            onChange={(event) => setCampos((c) => ({ ...c, atual: event.target.value }))}
            required
          />
        </Field>

        <Field
          label="Nova senha"
          htmlFor="senha-nova"
          hint={`Pelo menos ${MIN_PASSWORD_LENGTH} caracteres, com letras e números.`}
          {...(curta
            ? { error: `A senha precisa de pelo menos ${MIN_PASSWORD_LENGTH} caracteres.` }
            : {})}
        >
          <PasswordInput
            id="senha-nova"
            autoComplete="new-password"
            value={campos.nova}
            onChange={(event) => setCampos((c) => ({ ...c, nova: event.target.value }))}
            required
          />
        </Field>

        <Field
          label="Confirmar nova senha"
          htmlFor="senha-confirmacao"
          {...(naoConfere ? { error: 'As senhas não conferem.' } : {})}
        >
          <PasswordInput
            id="senha-confirmacao"
            autoComplete="new-password"
            value={campos.confirmacao}
            onChange={(event) => setCampos((c) => ({ ...c, confirmacao: event.target.value }))}
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
          <Button type="submit" disabled={!podeEnviar}>
            {pending ? 'Salvando…' : 'Alterar senha'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
