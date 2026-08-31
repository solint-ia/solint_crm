'use client';

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

/**
 * Uma imagem sozinha, no centro da tela.
 *
 * Não usa o `Modal` de propósito. Aquele é um diálogo: tem título, moldura,
 * padding e fundo claro — tudo desenhado para conter texto e controles. Uma
 * foto ampliada não quer nada disso; quer o resto da tela apagado e ela no
 * meio. São dois componentes porque são duas intenções, e forçar a foto no
 * diálogo daria uma foto pequena dentro de uma caixa branca.
 */
interface ImageLightboxProps {
  readonly src: string;
  readonly alt: string;
  readonly onClose: () => void;
}

export function ImageLightbox({ src, alt, onClose }: ImageLightboxProps) {
  const fecharRef = useRef<HTMLButtonElement>(null);

  /**
   * Esc fecha, e a rolagem do fundo trava enquanto a foto está aberta.
   *
   * Sem a trava, rolar com a foto no meio move a conversa atrás dela — o
   * usuário volta para um lugar da timeline que não escolheu.
   */
  useEffect(() => {
    const aoTeclar = (evento: KeyboardEvent) => {
      if (evento.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', aoTeclar);

    const overflowAnterior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // O foco vai para o botão de fechar: quem navega por teclado precisa de um
    // ponto de partida dentro do que acabou de abrir.
    fecharRef.current?.focus();

    return () => {
      window.removeEventListener('keydown', aoTeclar);
      document.body.style.overflow = overflowAnterior;
    };
  }, [onClose]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      onClick={onClose}
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 p-6 backdrop-blur-sm animate-in fade-in duration-150"
    >
      <button
        ref={fecharRef}
        type="button"
        onClick={onClose}
        aria-label="Fechar"
        className="absolute right-4 top-4 flex size-9 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white/50"
      >
        <X className="size-5" />
      </button>

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        // O clique na própria imagem não fecha: fechar é o gesto do fundo e do
        // botão. Quem clica na foto quase sempre quer olhá-la, não sair dela.
        onClick={(evento) => evento.stopPropagation()}
        className="max-h-full max-w-full rounded-2xl object-contain shadow-2xl animate-in zoom-in-95 duration-150"
      />
    </div>,
    document.body,
  );
}
