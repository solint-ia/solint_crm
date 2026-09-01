/**
 * Marca um controle cuja funcionalidade ainda não foi construída.
 *
 * Um botão clicável que não responde quebra a confiança na tela inteira — o
 * usuário conclui que o sistema travou, não que o recurso não existe. Enquanto
 * a funcionalidade não chega, o controle fica visivelmente desabilitado e diz,
 * no `title`, exatamente o que fará.
 *
 * Uso: `<Button {...planned('Criar um contato manualmente')}>Novo contato</Button>`
 *
 * Para encontrar tudo que falta implementar: `grep -rn "planned(" src/`
 */
export const planned = (whatItWillDo: string) =>
  ({
    disabled: true,
    title: `${whatItWillDo}: em desenvolvimento, ainda não disponível.`,
  }) as const;
