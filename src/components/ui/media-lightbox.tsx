'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Download,
  ExternalLink,
  RotateCw,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

export interface LightboxMedia {
  readonly type: 'image' | 'video';
  readonly url: string;
  readonly caption?: string;
  readonly fileName?: string;
  readonly isGif?: boolean;
}

interface MediaLightboxProps {
  readonly media: LightboxMedia | null;
  readonly onClose: () => void;
}

export function MediaLightbox({ media, onClose }: MediaLightboxProps) {
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [isPanning, setIsPanning] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });

  const resetTransform = useCallback(() => {
    setZoom(1);
    setRotation(0);
    setPosition({ x: 0, y: 0 });
  }, []);

  useEffect(() => {
    if (media) {
      resetTransform();
    }
  }, [media, resetTransform]);

  // Teclas de atalho para navegação
  useEffect(() => {
    if (!media) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === '+' || e.key === '=') {
        setZoom((z) => Math.min(z + 0.25, 3.5));
      } else if (e.key === '-') {
        setZoom((z) => Math.max(z - 0.25, 0.5));
      } else if (e.key === '0') {
        resetTransform();
      } else if (e.key.toLowerCase() === 'r') {
        setRotation((r) => (r + 90) % 360);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [media, onClose, resetTransform]);

  if (!media) return null;

  const handleZoomIn = () => setZoom((z) => Math.min(z + 0.25, 3.5));
  const handleZoomOut = () => setZoom((z) => Math.max(z - 0.25, 0.5));
  const handleRotate = () => setRotation((r) => (r + 90) % 360);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (zoom > 1) {
      setIsPanning(true);
      setStartPos({ x: e.clientX - position.x, y: e.clientY - position.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isPanning && zoom > 1) {
      setPosition({
        x: e.clientX - startPos.x,
        y: e.clientY - startPos.y,
      });
    }
  };

  const handleMouseUp = () => setIsPanning(false);

  const downloadMedia = async () => {
    try {
      const response = await fetch(media.url);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = media.fileName ?? (media.type === 'video' ? 'video.mp4' : 'imagem.jpg');
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
    } catch {
      window.open(media.url, '_blank');
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Visualizador de Mídia"
      className="fixed inset-0 z-50 flex flex-col items-center justify-between bg-black/90 backdrop-blur-md select-none animate-in fade-in duration-200"
      onClick={onClose}
    >
      {/* Barra de Ferramentas Superior */}
      <header
        className="w-full flex items-center justify-between px-4 py-3 bg-gradient-to-b from-black/80 to-transparent z-10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 text-white/80 text-xs font-medium truncate max-w-[40%]">
          <span>{media.type === 'video' ? 'Vídeo' : 'Foto'}</span>
          {media.caption && (
            <>
              <span>·</span>
              <span className="truncate opacity-75">{media.caption}</span>
            </>
          )}
        </div>

        {/* Controles de Ação */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          {media.type === 'image' && (
            <>
              <button
                type="button"
                onClick={handleZoomOut}
                disabled={zoom <= 0.5}
                title="Diminuir zoom (-)"
                className="rounded-lg p-2 text-white/80 hover:bg-white/10 hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ZoomOut className="size-4" />
              </button>
              <button
                type="button"
                onClick={resetTransform}
                title="Tamanho original (0)"
                className="rounded-lg px-2.5 py-1 text-xs font-mono text-white/80 hover:bg-white/10 hover:text-white transition-colors"
              >
                {Math.round(zoom * 100)}%
              </button>
              <button
                type="button"
                onClick={handleZoomIn}
                disabled={zoom >= 3.5}
                title="Aumentar zoom (+)"
                className="rounded-lg p-2 text-white/80 hover:bg-white/10 hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ZoomIn className="size-4" />
              </button>
              <button
                type="button"
                onClick={handleRotate}
                title="Girar 90° (R)"
                className="rounded-lg p-2 text-white/80 hover:bg-white/10 hover:text-white transition-colors"
              >
                <RotateCw className="size-4" />
              </button>
            </>
          )}

          <button
            type="button"
            onClick={downloadMedia}
            title="Baixar arquivo"
            className="rounded-lg p-2 text-white/80 hover:bg-white/10 hover:text-white transition-colors"
          >
            <Download className="size-4" />
          </button>

          <a
            href={media.url}
            target="_blank"
            rel="noopener noreferrer"
            title="Abrir em nova aba"
            className="rounded-lg p-2 text-white/80 hover:bg-white/10 hover:text-white transition-colors"
          >
            <ExternalLink className="size-4" />
          </a>

          <div className="h-4 w-px bg-white/20 mx-1" />

          <button
            type="button"
            onClick={onClose}
            title="Fechar (Esc)"
            className="rounded-lg p-2 text-white/80 hover:bg-white/20 hover:text-white transition-colors"
          >
            <X className="size-5" />
          </button>
        </div>
      </header>

      {/* Área Central de Visualização */}
      <main
        className="flex-1 w-full flex items-center justify-center overflow-hidden p-4 relative"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onClick={(e) => e.stopPropagation()}
      >
        {media.type === 'image' ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={media.url}
            alt={media.caption ?? 'Foto ampliada'}
            draggable={false}
            style={{
              transform: `translate(${position.x}px, ${position.y}px) scale(${zoom}) rotate(${rotation}deg)`,
              cursor: zoom > 1 ? (isPanning ? 'grabbing' : 'grab') : 'default',
              transition: isPanning ? 'none' : 'transform 0.15s ease-out',
            }}
            className="max-h-[82vh] max-w-[92vw] object-contain rounded-lg shadow-2xl"
          />
        ) : (
          <video
            src={media.url}
            controls
            autoPlay
            loop={Boolean(media.isGif)}
            playsInline
            className="max-h-[82vh] max-w-[92vw] rounded-xl shadow-2xl bg-black/40"
          />
        )}
      </main>

      {/* Legenda na Base */}
      {media.caption && (
        <footer
          className="w-full flex justify-center px-4 py-3 bg-gradient-to-t from-black/80 to-transparent z-10"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="max-w-2xl rounded-xl bg-black/60 backdrop-blur-md px-4 py-2 text-center text-sm text-white/90 shadow-lg border border-white/10 leading-relaxed">
            {media.caption}
          </div>
        </footer>
      )}
    </div>
  );
}
