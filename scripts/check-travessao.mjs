/**
 * Guarda tipográfica: travessão não é vírgula.
 *
 * O produto usava `—` como pontuação em texto de interface ("não depende do
 * período — é o estado atual da fila"), onde a norma pede dois-pontos, vírgula,
 * parênteses ou ponto final. A limpeza foi feita à mão, uma frase de cada vez,
 * porque a substituição correta depende do que a frase quer dizer — e sem uma
 * guarda ela se degrada de volta na primeira tela nova.
 *
 * **O que este script NÃO proíbe**, e é a distinção que ele existe para fazer:
 *
 *  1. `'—'` sozinho é **valor de dado**, não pontuação: é o "sem valor" que o
 *     painel mostra onde não há número (CSAT sem nota, IP ausente, faturamento
 *     de conta que não assinou). Trocá-lo por `0` mentiria, e por vazio
 *     esconderia a coluna.
 *  2. Travessão em **comentário** de código. Comentário não é interface, e
 *     reescrever setecentos deles seria ruído de revisão sem ganho nenhum.
 *
 * Varre apenas `.tsx` (as telas) mais os poucos `.ts` que produzem texto que
 * chega à tela — descrições de indicador, dicas de permissão, sementes.
 *
 *   node scripts/check-travessao.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const TRAVESSAO = '\u2014';

/** Arquivos `.ts` que geram texto de interface. `.tsx` entra por extensão. */
const TS_COM_TEXTO_DE_TELA = [
  'src/infrastructure/repositories/prisma/analytics-repository.ts',
  'src/core/domain/permissions.ts',
  'src/core/domain/system-roles.ts',
  'src/core/domain/automation.ts',
  'src/core/domain/csat.ts',
  'src/infrastructure/seed/knowledge.ts',
  'src/components/ui/planned.ts',
];

const arquivos = [];
const varrer = (dir) => {
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    const alvo = path.join(dir, entrada.name);
    if (entrada.isDirectory()) {
      if (entrada.name === 'generated' || entrada.name === 'node_modules') continue;
      varrer(alvo);
    } else if (entrada.name.endsWith('.tsx')) {
      arquivos.push(alvo);
    }
  }
};
varrer('src');
for (const extra of TS_COM_TEXTO_DE_TELA) {
  if (fs.existsSync(extra)) arquivos.push(extra);
}

/**
 * Marca as linhas que são comentário, com estado entre elas.
 *
 * Olhar só o começo da linha não serve: a maioria dos comentários deste projeto
 * é de bloco e tem parágrafos inteiros no meio, e essas linhas do meio não
 * começam com `*` quando o texto quebra. Testando linha a linha, dezesseis
 * trechos de prosa de comentário apareciam como se fossem texto de tela.
 *
 * Um comentário de bloco vale até o `*\/`, e é isso que o estado guarda.
 * Comentário de linha (`//`) vale até o fim da própria linha.
 */
const linhasDeComentario = (linhas) => {
  const marcas = new Array(linhas.length).fill(false);
  let dentroDeBloco = false;

  linhas.forEach((linha, indice) => {
    if (dentroDeBloco) {
      marcas[indice] = true;
      if (linha.includes('*/')) {
        dentroDeBloco = false;
        // O que vier depois do fechamento ainda é código desta mesma linha.
        const resto = linha.slice(linha.lastIndexOf('*/') + 2);
        if (resto.includes(TRAVESSAO)) marcas[indice] = false;
      }
      return;
    }

    const abre = linha.indexOf('/*');
    const fecha = linha.lastIndexOf('*/');
    const barras = linha.indexOf('//');

    if (abre !== -1 && (fecha === -1 || fecha < abre)) {
      dentroDeBloco = true;
      // Só é comentário do `/*` em diante; antes dele pode haver código.
      marcas[indice] = !linha.slice(0, abre).includes(TRAVESSAO);
      return;
    }
    if (abre !== -1 && fecha > abre) {
      // Bloco que abre e fecha na mesma linha.
      const forade = linha.slice(0, abre) + linha.slice(fecha + 2);
      marcas[indice] = !forade.includes(TRAVESSAO);
      return;
    }
    if (barras !== -1) {
      marcas[indice] = !linha.slice(0, barras).includes(TRAVESSAO);
    }
  });

  return marcas;
};

/**
 * A ocorrência é o placeholder de "sem valor"?
 *
 * Reconhecido pela forma: o travessão sozinho entre aspas (`'—'`, `"—"`,
 * `` `—` ``) ou como único conteúdo de um elemento (`>—<`). Qualquer travessão
 * cercado de texto é pontuação, e é o que este script cobra.
 */
const ocorrenciasProibidas = (linha) => {
  const proibidas = [];
  for (let i = 0; i < linha.length; i += 1) {
    if (linha[i] !== TRAVESSAO) continue;
    const antes = linha[i - 1];
    const depois = linha[i + 1];
    const isolado =
      (antes === "'" && depois === "'") ||
      (antes === '"' && depois === '"') ||
      (antes === '`' && depois === '`') ||
      (antes === '>' && depois === '<');
    if (!isolado) proibidas.push(i + 1);
  }
  return proibidas;
};

const achados = [];
for (const arquivo of arquivos) {
  const linhas = fs.readFileSync(arquivo, 'utf-8').split(/\r?\n/);
  const comentario = linhasDeComentario(linhas);
  linhas.forEach((linha, indice) => {
    if (!linha.includes(TRAVESSAO) || comentario[indice]) return;
    for (const coluna of ocorrenciasProibidas(linha)) {
      achados.push({ arquivo, linha: indice + 1, coluna, texto: linha.trim() });
    }
  });
}

if (achados.length === 0) {
  console.log(`Tipografia: ${arquivos.length} arquivos verificados, nenhum travessão como pontuação.`);
  process.exit(0);
}

console.error(`FALHA - ${achados.length} travessão(ões) usados como pontuação:\n`);
for (const a of achados) {
  console.error(`  x ${a.arquivo}:${a.linha}:${a.coluna}`);
  console.error(`    ${a.texto.slice(0, 120)}`);
}
console.error(
  '\nTroque por dois-pontos, vírgula, parênteses ou ponto final, conforme o sentido.\n' +
    `Se for o "sem valor" do painel, use o travessão sozinho entre aspas ('${TRAVESSAO}').`,
);
process.exit(1);
