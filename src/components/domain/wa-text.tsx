import type { ReactNode } from 'react';

/**
 * Texto do WhatsApp, com a formatação que o WhatsApp usa.
 *
 * `*negrito*`, `_itálico_`, `~riscado~` e ```` ```mono``` ```` não são
 * convenção nossa: são o que o aplicativo interpreta, e portanto o que chega
 * escrito nas mensagens que recebemos e o que precisa sair nas que enviamos.
 * Sem esta tradução, a bolha mostrava os asteriscos crus — e a assinatura, que
 * existe justamente para sair em negrito do outro lado, aparecia aqui como
 * `*Rafael Souza*`.
 *
 * A saída é sempre nó React, nunca HTML: não há caminho para injeção mesmo
 * quando o texto vem de um desconhecido pela internet.
 */

/** Um marcador por vez, sem cruzar linha — igual ao analisador do WhatsApp. */
const TOKEN = /(```[\s\S]+?```|\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~)/g;

/**
 * Profundidade máxima do aninhamento.
 *
 * `*_texto_*` é comum e vale a pena resolver. Além disso o ganho some e o custo
 * — uma recursão guiada por texto de terceiro — deixa de valer a pena.
 */
const MAX_DEPTH = 3;

const render = (text: string, depth: number): ReactNode[] => {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let key = 0;

  for (const match of text.matchAll(TOKEN)) {
    const token = match[0];
    const start = match.index ?? 0;

    if (start > cursor) nodes.push(text.slice(cursor, start));
    cursor = start + token.length;

    // Monoespaçado é literal por definição: o que está dentro da cerca não é
    // reinterpretado, ou um trecho de código com `*` viraria negrito.
    if (token.startsWith('```')) {
      nodes.push(
        <code key={`m${key++}`} className="rounded bg-black/10 px-1 font-mono text-[0.9em] dark:bg-white/15">
          {token.slice(3, -3)}
        </code>,
      );
      continue;
    }

    const inner = token.slice(1, -1);
    const children = depth < MAX_DEPTH ? render(inner, depth + 1) : inner;

    if (token.startsWith('*')) nodes.push(<strong key={`b${key++}`}>{children}</strong>);
    else if (token.startsWith('_')) nodes.push(<em key={`i${key++}`}>{children}</em>);
    else nodes.push(<s key={`s${key++}`}>{children}</s>);
  }

  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
};

export function WaText({ text }: { readonly text: string }) {
  return <>{render(text, 0)}</>;
}
