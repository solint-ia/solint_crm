/**
 * Interruptores de funcionalidades inteiras — não de permissão, de existência.
 *
 * A diferença importa: uma permissão decide *quem* vê algo que o produto
 * oferece; isto decide se o produto oferece aquilo **para qualquer pessoa**,
 * papel nenhum incluído. Campanhas e Agentes de IA foram construídos, mas não
 * são o foco da versão que vai para produção agora — ficam desligados aqui, e
 * não apagados, porque o código inteiro (domínio, banco, repositório)
 * continua existindo para quando a decisão for religar.
 *
 * Cada tela correspondente confere a flag **antes** de checar `can()` — uma
 * funcionalidade desligada não é "sem permissão", é "não existe hoje", e as
 * duas coisas merecem mensagens diferentes na tela.
 */
export const FEATURES = {
  campanhas: false,
  agentesIA: false,
} as const;
