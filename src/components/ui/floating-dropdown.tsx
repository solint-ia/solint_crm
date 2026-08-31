'use client';

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Um menu que não é recortado pelo contêiner de onde saiu.
 *
 * **O problema que ele resolve.** Um dropdown `absolute` só é visível dentro da
 * área de recorte do ancestral que rola. E basta um `overflow-x-auto` para
 * criar essa área: pela especificação, quando um eixo é `auto` ou `scroll`, o
 * outro deixa de ser `visible` e vira `auto` também — não existe "rola só na
 * horizontal". A tabela de contatos rola na horizontal (`min-w-[960px]`), logo
 * recorta na vertical, e ainda vive dentro de um `overflow-hidden` que arredonda
 * a borda do cartão.
 *
 * Com a lista cheia isso passava despercebido: sobrava tabela embaixo da linha,
 * e o menu cabia. Com **poucos contatos** o contêiner tem a altura de duas ou
 * três linhas, o menu nasce maior que ele e é cortado — sem rolagem possível,
 * porque quem corta de verdade é o `overflow-hidden` de fora.
 *
 * **A saída.** Sair da árvore. Em um portal no `body`, com posição `fixed`
 * calculada a partir do retângulo do botão, nenhum ancestral pode recortá-lo —
 * a altura da lista deixa de importar.
 */
interface FloatingDropdownProps {
  /** Retângulo do gatilho, capturado no clique que abriu o menu. */
  readonly anchor: DOMRect;
  readonly onClose: () => void;
  readonly children: ReactNode;
  /** Largura em px; o menu é alinhado pela direita do gatilho. */
  readonly width?: number;
}

/** Respiro entre o gatilho e o menu, e entre o menu e a borda da janela. */
const FOLGA = 4;
const MARGEM_JANELA = 8;

export function FloatingDropdown({
  anchor,
  onClose,
  children,
  width = 192,
}: FloatingDropdownProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [posicao, setPosicao] = useState<{ top: number; left: number } | null>(null);

  /**
   * A posição é calculada depois de medir, não antes.
   *
   * Só dá para saber se o menu cabe abaixo do botão depois que ele existe e tem
   * altura. Por isso o primeiro quadro sai invisível: medir, decidir o lado,
   * então mostrar. `useLayoutEffect` faz isso antes da pintura, então o usuário
   * nunca vê o menu no lugar errado.
   */
  useLayoutEffect(() => {
    const elemento = menuRef.current;
    if (!elemento) return;

    const altura = elemento.offsetHeight;
    const espacoAbaixo = window.innerHeight - anchor.bottom - FOLGA - MARGEM_JANELA;

    // Abre para cima quando não cabe embaixo — mas só se couber melhor lá.
    const paraCima = altura > espacoAbaixo && anchor.top - FOLGA - MARGEM_JANELA > espacoAbaixo;

    const top = paraCima
      ? Math.max(MARGEM_JANELA, anchor.top - altura - FOLGA)
      : Math.min(anchor.bottom + FOLGA, window.innerHeight - altura - MARGEM_JANELA);

    // Alinhado à direita do gatilho, sem deixar sair pela esquerda da janela.
    const left = Math.max(MARGEM_JANELA, anchor.right - width);

    setPosicao({ top, left });
  }, [anchor, width]);

  /**
   * Rolar ou redimensionar fecha o menu.
   *
   * Um menu `fixed` não acompanha a linha que o abriu: se a página rolasse, ele
   * ficaria parado no ar, apontando para um contato que já saiu de vista.
   * Fechar é mais honesto — e é o que o resto do sistema faz ao clicar fora.
   */
  useEffect(() => {
    const fechar = () => onClose();
    // `capture` porque a rolagem que importa é a do contêiner interno, e
    // eventos de rolagem não sobem por bolha.
    window.addEventListener('scroll', fechar, true);
    window.addEventListener('resize', fechar);
    return () => {
      window.removeEventListener('scroll', fechar, true);
      window.removeEventListener('resize', fechar);
    };
  }, [onClose]);

  useEffect(() => {
    const aoTeclar = (evento: KeyboardEvent) => {
      if (evento.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [onClose]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <>
      <div className="fixed inset-0 z-[60]" onClick={onClose} />
      <div
        ref={menuRef}
        role="menu"
        style={{
          position: 'fixed',
          width,
          top: posicao?.top ?? 0,
          left: posicao?.left ?? 0,
          visibility: posicao ? 'visible' : 'hidden',
          // Teto de segurança: um menu mais alto que a janela rola em si mesmo
          // em vez de escapar pelas bordas.
          maxHeight: `calc(100vh - ${MARGEM_JANELA * 2}px)`,
          overflowY: 'auto',
        }}
        className="z-[61] rounded-xl border border-line bg-surface p-1 shadow-xl animate-in fade-in-50 zoom-in-95 duration-100"
      >
        {children}
      </div>
    </>,
    document.body,
  );
}
