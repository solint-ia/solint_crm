import type { Id } from './shared';

/**
 * Menções com `@` em notas internas.
 *
 * Puro e sem I/O: a mesma função casa nomes no servidor (para decidir quem
 * notificar) e no navegador (para destacar o trecho na bolha). Duas
 * implementações divergiriam, e a divergência apareceria como um aviso que
 * chega a alguém cujo nome a tela não realçou.
 */

export interface MentionCandidate {
  readonly id: Id;
  readonly name: string;
}

const normalizar = (texto: string): string =>
  texto
    .normalize('NFD')
    // Sem acento e sem caixa: quem escreve `@joao` quer chamar a "João", e
    // exigir o acento certo no meio de um atendimento é exigir o impossível.
    // O intervalo vai escapado, e não com os caracteres literais: marcas de
    // combinação são invisíveis num editor e sobrevivem mal a uma cópia.
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR');

/**
 * Quem foi mencionado no texto.
 *
 * **Casa do nome mais longo para o mais curto**, e essa ordem é o núcleo da
 * regra: numa conta com "Ana" e "Ana Paula", `@Ana Paula` tem de resolver para
 * Ana Paula. Testando na ordem da lista, "Ana" casaria primeiro e a menção
 * apontaria para a pessoa errada — que num aviso de nota interna significa
 * mandar o assunto de alguém para outra pessoa.
 *
 * Devolve ids únicos, sem repetir quem foi citado duas vezes.
 */
export const extractMentions = (
  texto: string,
  candidatos: readonly MentionCandidate[],
): readonly Id[] => {
  if (!texto.includes('@')) return [];

  const alvo = normalizar(texto);
  const porTamanho = [...candidatos].sort((a, b) => b.name.length - a.name.length);
  const encontrados = new Set<Id>();

  for (const candidato of porTamanho) {
    const nome = normalizar(candidato.name.trim());
    if (!nome) continue;
    // A âncora à esquerda é o `@`; à direita basta não estar no meio de outra
    // palavra, para `@Ana` não casar dentro de "@Anabela".
    const posicao = alvo.indexOf(`@${nome}`);
    if (posicao === -1) continue;

    const seguinte = alvo[posicao + nome.length + 1];
    if (seguinte && /[\p{L}\p{N}]/u.test(seguinte)) continue;

    encontrados.add(candidato.id);
  }

  return [...encontrados];
};

/**
 * O trecho que o usuário está digitando depois de um `@`, para o autocomplete.
 *
 * Devolve `undefined` quando o cursor não está numa menção em andamento: sem
 * `@` antes, com espaço demais depois dele (uma menção não atravessa duas
 * palavras além do nome composto), ou com o `@` colado em outra palavra
 * (`email@empresa.com` não abre a lista).
 */
export const mentionQueryAt = (texto: string, cursor: number): string | undefined => {
  const antes = texto.slice(0, cursor);
  const arroba = antes.lastIndexOf('@');
  if (arroba === -1) return undefined;

  const anterior = antes[arroba - 1];
  if (anterior && !/\s/.test(anterior)) return undefined;

  const trecho = antes.slice(arroba + 1);
  if (trecho.includes('\n')) return undefined;
  // Até duas palavras: cobre "Ana Paula" e para antes de engolir a frase toda.
  if (trecho.split(/\s+/).length > 2) return undefined;

  return trecho;
};

/** Os candidatos que casam com o que já foi digitado, do mais provável ao menos. */
export const filterMentionCandidates = (
  consulta: string,
  candidatos: readonly MentionCandidate[],
  limite = 6,
): readonly MentionCandidate[] => {
  const alvo = normalizar(consulta.trim());
  if (!alvo) return candidatos.slice(0, limite);

  return candidatos
    .filter((candidato) => normalizar(candidato.name).includes(alvo))
    .sort((a, b) => {
      // Quem começa com o que foi digitado vem primeiro: é o que a pessoa
      // espera ver no topo ao digitar as primeiras letras.
      const aComeca = normalizar(a.name).startsWith(alvo) ? 0 : 1;
      const bComeca = normalizar(b.name).startsWith(alvo) ? 0 : 1;
      return aComeca - bComeca || a.name.localeCompare(b.name, 'pt-BR');
    })
    .slice(0, limite);
};

/**
 * Os trechos da nota, separando o que é menção do que é texto comum.
 *
 * A bolha desenha a partir disto: cada pedaço vira um `<span>` normal ou um
 * realce. Devolver pedaços, e não HTML, mantém a função pura e o React
 * responsável por escapar o conteúdo.
 */
export interface MentionSegment {
  readonly text: string;
  readonly mentionOf?: Id;
}

export const splitByMentions = (
  texto: string,
  candidatos: readonly MentionCandidate[],
): readonly MentionSegment[] => {
  if (!texto.includes('@')) return [{ text: texto }];

  const alvo = normalizar(texto);
  const porTamanho = [...candidatos].sort((a, b) => b.name.length - a.name.length);

  // Marca as faixas ocupadas por menções, do nome mais longo para o mais curto
  // pelo mesmo motivo de `extractMentions`.
  const faixas: { inicio: number; fim: number; id: Id }[] = [];
  const ocupado = (inicio: number, fim: number) =>
    faixas.some((faixa) => inicio < faixa.fim && fim > faixa.inicio);

  for (const candidato of porTamanho) {
    const nome = normalizar(candidato.name.trim());
    if (!nome) continue;
    let de = alvo.indexOf(`@${nome}`);
    while (de !== -1) {
      const ate = de + nome.length + 1;
      const seguinte = alvo[ate];
      if ((!seguinte || !/[\p{L}\p{N}]/u.test(seguinte)) && !ocupado(de, ate)) {
        faixas.push({ inicio: de, fim: ate, id: candidato.id });
      }
      de = alvo.indexOf(`@${nome}`, de + 1);
    }
  }

  if (faixas.length === 0) return [{ text: texto }];

  faixas.sort((a, b) => a.inicio - b.inicio);
  const pedacos: MentionSegment[] = [];
  let cursor = 0;
  for (const faixa of faixas) {
    if (faixa.inicio > cursor) pedacos.push({ text: texto.slice(cursor, faixa.inicio) });
    pedacos.push({ text: texto.slice(faixa.inicio, faixa.fim), mentionOf: faixa.id });
    cursor = faixa.fim;
  }
  if (cursor < texto.length) pedacos.push({ text: texto.slice(cursor) });
  return pedacos;
};
