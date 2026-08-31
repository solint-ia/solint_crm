'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import {
  CalendarClock,
  CornerUpLeft,
  Loader2,
  Lock,
  Mic,
  Paperclip,
  Send,
  Smile,
  Square,
  X,
} from 'lucide-react';
import type { CannedResponse } from '@/core/domain/settings';
import { MIN_SCHEDULE_LEAD_MS } from '@/core/domain/scheduled-message';
import { MAX_MESSAGE_LENGTH } from '@/core/use-cases/send-message';
import { EmojiPicker } from '@/components/ui/emoji-picker';
import { cn } from '@/lib/cn';
import { agendamentoLabel, dataHoraLocalDe, isoDeDataHoraLocal } from '@/lib/datetime';

export type ComposerMode = 'publica' | 'nota';

export interface MediaResult {
  readonly ok: boolean;
  readonly error?: string;
}

interface ComposerProps {
  /**
   * Conversa a que este compositor pertence.
   *
   * O compositor guarda rascunho, anexo e gravação em estado local, e sem saber
   * de qual conversa esse estado é ele os carregava para a próxima: escolher um
   * vídeo, trocar de conversa e encontrar o mesmo vídeo pronto para ir para
   * **outra** pessoa. O anexo não é um rascunho do painel, é um rascunho
   * daquele atendimento.
   */
  readonly conversationId?: string;
  readonly disabledReason?: string;
  /**
   * Mensagem sendo respondida.
   *
   * Controlada de fora porque quem escolhe a citada é a timeline, não o
   * compositor — e porque trocar de conversa precisa limpá-la junto com o
   * resto.
   */
  readonly replyTo?: { readonly id: string; readonly author: string; readonly preview: string };
  readonly onCancelReply?: () => void;
  readonly onSend: (text: string, mode: ComposerMode, replyToId?: string) => void;
  readonly onSendMedia?: (form: FormData) => Promise<MediaResult>;
  readonly onTyping?: (isTyping: boolean) => void;
  readonly cannedResponses?: readonly CannedResponse[];
  readonly pending?: boolean;
  /**
   * Agenda o texto escrito para sair depois.
   *
   * Recebe o instante já em ISO: a conversão da hora digitada para o fuso de
   * exibição do produto acontece aqui dentro, uma vez, em vez de em cada
   * chamador — ver `isoDeDataHoraLocal`.
   */
  readonly onSchedule?: (input: {
    readonly text: string;
    readonly mode: ComposerMode;
    readonly scheduledFor: string;
    readonly replyToId?: string;
  }) => Promise<{ readonly ok: boolean; readonly error?: string }>;
}

/** Categoria do anexo a partir do tipo declarado pelo arquivo. */
const kindOf = (type: string): 'image' | 'video' | 'audio' | 'document' => {
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'audio';
  return 'document';
};

const humanSize = (bytes: number): string =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const clock = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/**
 * Mesmo teto de `sendMediaAction`, conferido antes da subida.
 *
 * Recusar aqui não é redundância: o arquivo grande custava a subida inteira
 * para receber a recusa no fim, e no caminho ainda esbarrava no limite de corpo
 * do Next — que falha sem devolver mensagem nenhuma para a tela.
 */
const MAX_UPLOAD_BYTES = 16 * 1024 * 1024;

const RECORDING_TYPES = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/webm'];

const pickRecordingType = (): string | undefined => {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return RECORDING_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
};

export function Composer({
  conversationId,
  disabledReason,
  replyTo,
  onCancelReply,
  onSend,
  onSendMedia,
  onTyping,
  cannedResponses = [],
  pending,
  onSchedule,
}: ComposerProps) {
  const [mode, setMode] = useState<ComposerMode>('publica');
  const [text, setText] = useState('');
  const [attachment, setAttachment] = useState<File | undefined>();
  const [recording, setRecording] = useState<{ readonly blob: Blob; readonly seconds: number } | undefined>();
  const [isRecording, setIsRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [mediaError, setMediaError] = useState<string | undefined>();
  const [cannedIndex, setCannedIndex] = useState(0);
  /**
   * Quantos "dragenter" estão abertos sem o "dragleave" correspondente.
   *
   * Um contador e não um booleano: arrastar por cima do compositor dispara
   * `dragleave` toda vez que o ponteiro cruza a borda de um filho (o textarea,
   * cada botão da barra), e com um booleano a moldura de "solte aqui" piscava
   * durante todo o percurso até sumir antes de a pessoa soltar o arquivo.
   */
  const [dragDepth, setDragDepth] = useState(0);
  /**
   * URL temporária da miniatura do anexo de imagem.
   *
   * `URL.createObjectURL` reserva memória até alguém revogar; um efeito com
   * limpeza é o que garante que trocar de anexo dez vezes não deixe dez
   * imagens presas na aba.
   */
  const [previewUrl, setPreviewUrl] = useState<string | undefined>();

  useEffect(() => {
    if (!attachment || !attachment.type.startsWith('image/')) {
      setPreviewUrl(undefined);
      return;
    }
    const url = URL.createObjectURL(attachment);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [attachment]);
  const [emojiAberto, setEmojiAberto] = useState(false);
  const [agendaAberta, setAgendaAberta] = useState(false);
  const [agendaQuando, setAgendaQuando] = useState('');
  const [agendaErro, setAgendaErro] = useState<string | undefined>();
  const [agendando, setAgendando] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const typingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isTypingRef = useRef(false);

  const isNote = mode === 'nota';
  const blocked = Boolean(disabledReason) && !isNote;
  const hasMedia = Boolean(attachment ?? recording);

  const cannedQuery = text.startsWith('/') && !text.includes('\n') ? text.slice(1) : undefined;
  const cannedMatches = useMemo(() => {
    if (cannedQuery === undefined) return [];
    const needle = cannedQuery.toLowerCase();
    return cannedResponses
      .filter(
        (response) =>
          response.shortcut.slice(1).toLowerCase().startsWith(needle) ||
          response.content.toLowerCase().includes(needle),
      )
      .slice(0, 6);
  }, [cannedQuery, cannedResponses]);

  useEffect(() => setCannedIndex(0), [cannedQuery]);

  useEffect(() => {
    if (!isRecording) return;
    const timer = setInterval(
      () => setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000)),
      250,
    );
    return () => clearInterval(timer);
  }, [isRecording]);

  const notifyTyping = useCallback(
    (typing: boolean) => {
      if (isNote) return;
      if (isTypingRef.current !== typing) {
        isTypingRef.current = typing;
        onTyping?.(typing);
      }
    },
    [isNote, onTyping],
  );

  useEffect(() => {
    return () => {
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      if (isTypingRef.current) {
        isTypingRef.current = false;
        onTyping?.(false);
      }
    };
  }, [conversationId, onTyping]);

  const handleTextChange = (value: string) => {
    setText(value);
    if (!onTyping || isNote || blocked || isRecording) return;

    if (value.trim().length > 0) {
      notifyTyping(true);
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      typingTimerRef.current = setTimeout(() => {
        notifyTyping(false);
      }, 3500);
    } else {
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      notifyTyping(false);
    }
  };

  useEffect(
    () => () => {
      recorderRef.current?.stream.getTracks().forEach((track) => track.stop());
    },
    [],
  );

  const applyCanned = (response: CannedResponse) => {
    handleTextChange(response.content);
    textareaRef.current?.focus();
  };

  /**
   * Insere o emoji **onde o cursor está**, não no fim do texto.
   *
   * Quem escolhe um emoji no meio de uma frase o quer no meio da frase. Anexar
   * ao fim parece um detalhe até a primeira vez que alguém volta o cursor para
   * corrigir algo e o emoji some lá para o final.
   */
  const inserirEmoji = (emoji: string) => {
    const campo = textareaRef.current;
    const inicio = campo?.selectionStart ?? text.length;
    const fim = campo?.selectionEnd ?? text.length;
    const proximo = `${text.slice(0, inicio)}${emoji}${text.slice(fim)}`;

    handleTextChange(proximo);
    setEmojiAberto(false);

    // O cursor precisa ir para depois do emoji, e só depois do React
    // reescrever o valor do campo.
    requestAnimationFrame(() => {
      const alvo = inicio + emoji.length;
      campo?.focus();
      campo?.setSelectionRange(alvo, alvo);
    });
  };

  /** Sugestão de horário: daqui a uma hora, arredondada para o minuto. */
  const abrirAgenda = () => {
    setAgendaErro(undefined);
    setAgendaQuando((atual) => atual || dataHoraLocalDe(new Date(Date.now() + 60 * 60 * 1000)));
    setAgendaAberta(true);
    setEmojiAberto(false);
  };

  const agendar = async () => {
    if (!onSchedule) return;
    const conteudo = text.trim();
    if (!conteudo) {
      setAgendaErro('Escreva a mensagem antes de agendar.');
      return;
    }

    const quando = isoDeDataHoraLocal(agendaQuando);
    if (!quando) {
      setAgendaErro('Escolha uma data e hora válidas.');
      return;
    }
    if (new Date(quando).getTime() - Date.now() < MIN_SCHEDULE_LEAD_MS) {
      setAgendaErro('Escolha um horário pelo menos um minuto à frente.');
      return;
    }

    setAgendando(true);
    setAgendaErro(undefined);
    try {
      const resultado = await onSchedule({
        text: conteudo,
        mode,
        scheduledFor: quando,
        ...(replyTo?.id ? { replyToId: replyTo.id } : {}),
      });
      if (!resultado.ok) {
        setAgendaErro(resultado.error ?? 'Não foi possível agendar a mensagem.');
        return;
      }
      setAgendaAberta(false);
      setAgendaQuando('');
      setText('');
      onCancelReply?.();
    } catch (error) {
      console.error('[Composer] Falha ao agendar:', error);
      setAgendaErro('Não foi possível agendar a mensagem.');
    } finally {
      setAgendando(false);
    }
  };

  const startRecording = async () => {
    setMediaError(undefined);
    const mimeType = pickRecordingType();
    if (!mimeType) {
      setMediaError('Este navegador não permite gravar áudio.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      startedAtRef.current = Date.now();

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunksRef.current, { type: mimeType });
        const seconds = Math.max(1, Math.floor((Date.now() - startedAtRef.current) / 1000));
        setRecording({ blob, seconds });
        setIsRecording(false);
        setElapsed(0);
      };

      recorderRef.current = recorder;
      recorder.start(250);
      setIsRecording(true);
      setElapsed(0);
      setAttachment(undefined);
    } catch {
      setMediaError('Acesso ao microfone foi negado.');
    }
  };

  const cancelRecording = () => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stream.getTracks().forEach((track) => track.stop());
      recorderRef.current.stop();
    }
    setIsRecording(false);
    setRecording(undefined);
    setElapsed(0);
  };

  const clearMedia = () => {
    setAttachment(undefined);
    setRecording(undefined);
    setMediaError(undefined);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  /**
   * Aceita um arquivo, venha ele de onde vier.
   *
   * O compositor tinha três caminhos possíveis para receber um anexo e só um
   * implementado: o seletor de arquivos. Colar (Ctrl+V) e arrastar para dentro
   * — os dois gestos que qualquer um tenta primeiro com um print de tela — não
   * faziam nada, sem mensagem nenhuma. As três entradas agora passam por aqui,
   * então a checagem de tamanho e a limpeza de estado valem para todas.
   */
  const aceitarArquivo = useCallback(
    (file: File | undefined | null): boolean => {
      if (!file || !onSendMedia) return false;
      if (blocked) {
        setMediaError(disabledReason ?? 'Não é possível anexar nesta conversa agora.');
        return false;
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        setAttachment(undefined);
        setMediaError(
          `${file.name || 'O arquivo'} tem ${humanSize(file.size)}. O limite é ${humanSize(MAX_UPLOAD_BYTES)}.`,
        );
        return false;
      }

      setRecording(undefined);
      setMediaError(undefined);
      setAttachment(file);
      return true;
    },
    [blocked, disabledReason, onSendMedia],
  );

  /**
   * Colar uma imagem no campo de texto.
   *
   * Um print colado chega em `clipboardData.files` sem nome de arquivo — o
   * navegador entrega `image.png` ou string vazia. Renomear com a hora torna o
   * anexo identificável na timeline e no depósito, em vez de uma fila de
   * `image.png` indistinguíveis.
   *
   * O `preventDefault` só acontece quando há mesmo um arquivo: colar texto
   * continua sendo colar texto.
   */
  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData?.files ?? []);
    const file = files[0];
    if (!file) return;

    event.preventDefault();
    const nomeado =
      file.name && file.name !== 'image.png'
        ? file
        : new File([file], `colado-${Date.now()}.${file.type.split('/')[1] || 'png'}`, {
            type: file.type,
          });
    aceitarArquivo(nomeado);
  };

  const handleDrop = (event: DragEvent<HTMLFormElement>) => {
    event.preventDefault();
    setDragDepth(0);
    aceitarArquivo(event.dataTransfer?.files?.[0]);
  };

  /** Só reage a arrasto que traz arquivo — texto selecionado não conta. */
  const arrastaArquivo = (event: DragEvent<HTMLFormElement>): boolean =>
    Array.from(event.dataTransfer?.types ?? []).includes('Files');

  /**
   * Trocar de conversa esvazia o compositor.
   *
   * O anexo é o caso visível — um vídeo escolhido para uma pessoa continuava
   * armado na caixa de qualquer outra —, mas rascunho, modo e erro carregavam
   * do mesmo jeito. Uma gravação em curso é interrompida junto: ela era do
   * atendimento que acabou de sair da tela.
   */
  useEffect(() => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stream.getTracks().forEach((track) => track.stop());
      recorderRef.current.stop();
    }
    recorderRef.current = null;
    chunksRef.current = [];
    setText('');
    setMode('publica');
    setAttachment(undefined);
    setRecording(undefined);
    setEmojiAberto(false);
    setAgendaAberta(false);
    setAgendaQuando('');
    setAgendaErro(undefined);
    if (fileInputRef.current) fileInputRef.current.value = '';

    // Auto-foca imediatamente no campo de texto ao clicar/trocar de conversa
    if (!blocked) {
      const timer = setTimeout(() => {
        textareaRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [conversationId, blocked]);

  /**
   * Sobe um anexo e limpa o compositor no sucesso.
   *
   * O `catch` é o ponto todo desta função. Sem ele, a promessa rejeitada — o
   * limite de corpo do Next, uma queda de rede no meio da subida — escapava do
   * `submit` sem virar nada na tela: o botão voltava ao normal, o anexo
   * continuava lá e nada dizia que o envio tinha falhado. Era exatamente esse o
   * "não envia e não fala nada" de vídeo e áudio.
   */
  const uploadMedia = async (build: () => FormData, fallbackError: string) => {
    if (!onSendMedia) return;
    setUploading(true);
    setMediaError(undefined);
    try {
      const res = await onSendMedia(build());
      if (!res.ok) {
        setMediaError(res.error || fallbackError);
        return;
      }
      clearMedia();
      setText('');
      // O anexo saiu citando: a citação já cumpriu o papel dela e some junto,
      // como some no envio de texto. Sem isto, ela ficava pendurada no
      // compositor e grudava na mensagem seguinte.
      onCancelReply?.();
    } catch (error) {
      console.error('[Composer] Falha ao enviar anexo:', error);
      setMediaError(
        error instanceof Error && /body|size|limit|413/i.test(error.message)
          ? `O arquivo é grande demais para o envio. O limite é ${humanSize(MAX_UPLOAD_BYTES)}.`
          : fallbackError,
      );
    } finally {
      setUploading(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (blocked || uploading || pending) return;

    if (attachment && onSendMedia) {
      if (attachment.size > MAX_UPLOAD_BYTES) {
        setMediaError(
          `O arquivo tem ${humanSize(attachment.size)}. O limite é ${humanSize(MAX_UPLOAD_BYTES)}.`,
        );
        return;
      }
      await uploadMedia(() => {
        const form = new FormData();
        form.set('file', attachment);
        // `kind` era calculado aqui só para aparecer no rótulo do anexo e nunca
        // ia no formulário. Do outro lado, `sendMediaAction` lê `kind` como a
        // primeira coisa que valida — recebia string vazia e recusava **todo**
        // anexo com "Tipo de anexo inválido", imagem inclusive.
        form.set('kind', kindOf(attachment.type));
        form.set('isPrivate', String(isNote));
        // A citação vale para o anexo como vale para o texto. Ela era montada
        // na tela, ficava visível acima do campo, e nunca entrava no formulário.
        if (replyTo?.id && !isNote) form.set('replyToId', replyTo.id);
        if (text.trim()) form.set('caption', text.trim());
        return form;
      }, 'Não foi possível enviar o anexo.');
      return;
    }

    if (recording && onSendMedia) {
      if (recording.blob.size > MAX_UPLOAD_BYTES) {
        setMediaError(
          `A gravação tem ${humanSize(recording.blob.size)}. O limite é ${humanSize(MAX_UPLOAD_BYTES)}.`,
        );
        return;
      }
      await uploadMedia(() => {
        const form = new FormData();
        const ext = recording.blob.type.includes('ogg') ? 'ogg' : 'webm';
        form.set('file', recording.blob, `audio-${Date.now()}.${ext}`);
        form.set('kind', 'audio');
        form.set('isPrivate', String(isNote));
        // `voice` separa a mensagem de voz do arquivo de áudio anexado: no
        // WhatsApp a primeira vira a bolha com a onda sonora, a segunda vira um
        // anexo. A duração é o que desenha essa onda antes de o áudio carregar.
        form.set('voice', 'true');
        form.set('durationSeconds', String(recording.seconds));
        if (text.trim()) form.set('caption', text.trim());
        return form;
      }, 'Não foi possível enviar o áudio.');
      return;
    }

    const trimmed = text.trim();
    if (!trimmed) return;
    notifyTyping(false);
    onSend(trimmed, mode, replyTo?.id);
    setText('');
    onCancelReply?.();
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (cannedMatches.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setCannedIndex((prev) => (prev + 1) % cannedMatches.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setCannedIndex((prev) => (prev - 1 + cannedMatches.length) % cannedMatches.length);
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        const match = cannedMatches[cannedIndex];
        if (match) applyCanned(match);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setText('');
        return;
      }
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submit(event as unknown as FormEvent);
    }
  };

  const canSubmit = hasMedia ? !uploading : text.trim().length > 0;
  const isBusy = uploading || pending;

  return (
    <form
      onSubmit={submit}
      onDragEnter={(event) => {
        if (!arrastaArquivo(event) || !onSendMedia) return;
        event.preventDefault();
        setDragDepth((atual) => atual + 1);
      }}
      onDragOver={(event) => {
        // Sem `preventDefault` no `dragover` o navegador recusa o soltar e abre
        // o arquivo numa aba nova, levando a pessoa para fora da conversa.
        if (arrastaArquivo(event) && onSendMedia) event.preventDefault();
      }}
      onDragLeave={() => setDragDepth((atual) => Math.max(0, atual - 1))}
      onDrop={handleDrop}
      className={cn(
        'relative flex flex-col gap-2 rounded-2xl border transition-all duration-200 p-2.5 sm:p-3 shadow-xs',
        isNote
          ? 'border-note-line bg-note'
          : 'border-line bg-surface focus-within:border-brand/50 focus-within:ring-2 focus-within:ring-brand/10',
        dragDepth > 0 && 'border-brand ring-2 ring-brand/20',
      )}
    >
      {/* Alvo de soltura. `pointer-events-none` é o que faz o `drop` chegar ao
          formulário: uma camada por cima capturaria o evento e o arquivo cairia
          num elemento que não sabe o que fazer com ele. */}
      {dragDepth > 0 && onSendMedia ? (
        <div className="pointer-events-none absolute inset-0 z-30 flex flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-brand bg-surface/95 backdrop-blur-xs">
          <Paperclip className="size-5 text-brand" />
          <span className="text-xs font-semibold text-ink">Solte para anexar</span>
          <span className="text-[11px] text-muted">
            Imagem, vídeo, áudio ou documento até {humanSize(MAX_UPLOAD_BYTES)}
          </span>
        </div>
      ) : null}
      {/* Respostas rápidas popup */}
      {cannedMatches.length > 0 && (
        <ul
          role="listbox"
          aria-label="Respostas rápidas"
          className="absolute bottom-full left-0 z-20 mb-2 w-[min(32rem,100%)] overflow-hidden rounded-xl border border-line bg-surface shadow-2xl backdrop-blur-md"
        >
          {cannedMatches.map((response, index) => (
            <li key={response.id}>
              <button
                type="button"
                role="option"
                aria-selected={index === cannedIndex}
                onMouseEnter={() => setCannedIndex(index)}
                onClick={() => applyCanned(response)}
                className={cn(
                  'flex w-full flex-col gap-0.5 border-b border-line-soft px-3.5 py-2.5 text-left last:border-0 transition-colors',
                  index === cannedIndex ? 'bg-brand/12 text-ink' : 'text-muted hover:bg-surface-2',
                )}
              >
                <span className="font-mono text-xs font-bold text-brand">
                  {response.shortcut}
                </span>
                <span className="line-clamp-2 text-xs text-muted">{response.content}</span>
              </button>
            </li>
          ))}
          <li className="bg-surface-2 px-3.5 py-1.5 text-[10px] text-muted font-mono">
            ↑↓ navega · Enter insere · Esc cancela
          </li>
        </ul>
      )}

      {/* Topo do compositor: Alternância de Modo */}
      <div className="flex items-center justify-between gap-2 border-b border-line-soft pb-2">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setMode('publica')}
            className={cn(
              'flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition-all',
              !isNote
                ? 'bg-brand/15 text-brand border border-brand/30 shadow-xs'
                : 'text-muted hover:bg-surface-2 hover:text-ink border border-transparent',
            )}
          >
            <span>Mensagem pública</span>
          </button>

          <button
            type="button"
            onClick={() => setMode('nota')}
            className={cn(
              'flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition-all',
              isNote
                ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/40'
                : 'text-muted hover:bg-surface-2 hover:text-ink border border-transparent',
            )}
          >
            <Lock className="size-3 text-amber-500" />
            <span>Nota interna</span>
          </button>
        </div>

        {cannedResponses.length > 0 && (
          <span className="hidden text-[11px] text-muted sm:block font-mono">
            Atalho <kbd className="rounded bg-surface-2 px-1 py-0.5 text-ink border border-line-soft">/</kbd>
          </span>
        )}
      </div>

      {blocked && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
          {disabledReason}
        </div>
      )}

      {/* A citada aparece acima do que está sendo escrito, com a mesma barra
          lateral do balão: é o mesmo objeto em dois lugares, e reconhecê-lo é
          o que evita responder a mensagem errada sem perceber. */}
      {replyTo && (
        <div className="flex items-start justify-between gap-2 rounded-lg border-l-2 border-l-brand bg-surface-2 px-3 py-2">
          <div className="flex min-w-0 items-start gap-2">
            <CornerUpLeft className="mt-0.5 size-3.5 shrink-0 text-brand" />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-ink">
                Respondendo {replyTo.author}
              </p>
              <p className="line-clamp-2 text-xs text-muted">{replyTo.preview}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancelReply}
            aria-label="Cancelar resposta"
            className="flex size-5 shrink-0 items-center justify-center rounded text-muted hover:text-red-500"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {/* Prévia de Anexo */}
      {attachment && (
        <div className="flex items-center justify-between rounded-lg border border-line-soft bg-surface-2 px-3 py-2 text-xs text-ink">
          <div className="flex min-w-0 items-center gap-2">
            {/* Uma imagem colada não tem nome que sirva de identificação — a
                miniatura é a única forma de conferir que é o print certo antes
                de mandá-lo para o cliente. */}
            {previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewUrl}
                alt={`Prévia de ${attachment.name}`}
                className="size-9 shrink-0 rounded-md border border-line-soft object-cover"
              />
            ) : (
              <Paperclip className="size-4 shrink-0 text-brand" />
            )}
            <span className="truncate font-medium">{attachment.name}</span>
            <span className="shrink-0 text-[10px] text-muted">
              ({kindOf(attachment.type)} · {humanSize(attachment.size)})
            </span>
          </div>
          <button
            type="button"
            onClick={clearMedia}
            aria-label="Remover anexo"
            className="flex size-5 items-center justify-center rounded text-muted hover:text-red-500"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {/* Prévia de Gravação */}
      {recording && (
        <div className="flex items-center justify-between rounded-lg border border-line-soft bg-surface-2 px-3 py-2 text-xs text-ink">
          <div className="flex items-center gap-2 min-w-0">
            <Mic className="size-4 shrink-0 text-brand" />
            <span className="truncate font-medium">Áudio gravado ({clock(recording.seconds)})</span>
            <span className="text-[10px] text-muted shrink-0">({humanSize(recording.blob.size)})</span>
          </div>
          <button
            type="button"
            onClick={clearMedia}
            aria-label="Descartar gravação"
            className="flex size-5 items-center justify-center rounded text-muted hover:text-red-500"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {mediaError && (
        <p role="alert" className="text-xs font-medium text-red-500">
          {mediaError}
        </p>
      )}

      {/* Painel Gravando Áudio */}
      {isRecording && (
        <div className="flex items-center gap-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3.5 py-2 text-xs text-red-600 dark:text-red-300">
          <span className="size-2 shrink-0 animate-pulse rounded-full bg-red-500" />
          <span className="font-mono font-bold text-red-600 dark:text-red-200 tabular-nums">
            {clock(elapsed)}
          </span>
          <span className="flex-1 font-medium">Gravando áudio...</span>
          <button
            type="button"
            onClick={cancelRecording}
            className="font-medium text-red-600 dark:text-red-300 hover:underline"
          >
            Descartar
          </button>
          <button
            type="button"
            onClick={() => recorderRef.current?.stop()}
            className="inline-flex items-center gap-1.5 rounded-md bg-red-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-red-500 transition-colors"
          >
            <Square className="size-3" />
            <span>Concluir</span>
          </button>
        </div>
      )}

      {/* Campo de Texto Principal */}
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(event) => handleTextChange(event.target.value)}
        onKeyDown={onKeyDown}
        onPaste={handlePaste}
        maxLength={MAX_MESSAGE_LENGTH}
        rows={2}
        disabled={blocked || isRecording}
        aria-label={isNote ? 'Nota interna' : 'Mensagem para o cliente'}
        placeholder={
          hasMedia
            ? 'Legenda do anexo (opcional)...'
            : isNote
              ? 'Escreva uma nota interna visível apenas para a equipe...'
              : 'Escreva sua mensagem... (Enter envia · cole ou arraste uma imagem para anexar)'
        }
        className="w-full resize-none bg-transparent px-1 py-1 text-sm text-ink placeholder:text-muted outline-none disabled:opacity-50 min-h-[44px] max-h-36 leading-relaxed"
      />

      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={(event) => {
          // O aviso de tamanho vem na hora de escolher, não depois da subida:
          // um vídeo de 40 MB não tem por que ocupar a rede para ser recusado
          // no fim. A regra vive em `aceitarArquivo`, junto com colar e soltar.
          if (!aceitarArquivo(event.target.files?.[0])) event.target.value = '';
        }}
      />

      {/* Barra de Ferramentas Inferior */}
      <div className="flex items-center justify-between gap-2 pt-1 border-t border-line-soft">
        <div className="flex items-center gap-1">
          <ToolbarButton
            label="Anexar arquivo"
            disabled={blocked || isRecording || !onSendMedia}
            onClick={() => fileInputRef.current?.click()}
          >
            <Paperclip className="size-4" />
          </ToolbarButton>

          <div className="relative">
            <ToolbarButton
              label="Inserir emoji"
              disabled={blocked || isRecording}
              active={emojiAberto}
              onClick={() => {
                setAgendaAberta(false);
                setEmojiAberto((valor) => !valor);
              }}
            >
              <Smile className="size-4" />
            </ToolbarButton>

            {emojiAberto ? (
              <EmojiPicker onPick={inserirEmoji} onClose={() => setEmojiAberto(false)} />
            ) : null}
          </div>

          <ToolbarButton
            label={isRecording ? 'Parar gravação' : 'Gravar áudio'}
            disabled={blocked || !onSendMedia}
            onClick={() => (isRecording ? recorderRef.current?.stop() : void startRecording())}
            active={isRecording}
          >
            <Mic className="size-4" />
          </ToolbarButton>

          <div className="relative">
            <ToolbarButton
              label="Agendar mensagem"
              disabled={blocked || isRecording || !onSchedule || hasMedia}
              active={agendaAberta}
              title={
                hasMedia
                  ? 'Anexos não podem ser agendados — envie agora ou remova o anexo.'
                  : 'Agendar mensagem'
              }
              onClick={() => (agendaAberta ? setAgendaAberta(false) : abrirAgenda())}
            >
              <CalendarClock className="size-4" />
            </ToolbarButton>

            {agendaAberta ? (
              <>
                <div
                  className="fixed inset-0 z-30"
                  onClick={() => setAgendaAberta(false)}
                  aria-hidden="true"
                />
                <div
                  role="dialog"
                  aria-label="Agendar mensagem"
                  className="absolute bottom-full left-0 z-40 mb-2 w-[min(20rem,calc(100vw-2rem))] rounded-2xl border border-line bg-surface p-3 shadow-2xl"
                >
                  <h3 className="mb-2 font-display text-xs font-semibold text-ink">
                    {isNote ? 'Agendar nota interna' : 'Agendar envio'}
                  </h3>

                  <label className="block text-[11px] font-medium text-muted" htmlFor="agenda-quando">
                    Data e hora
                  </label>
                  <input
                    id="agenda-quando"
                    type="datetime-local"
                    value={agendaQuando}
                    onChange={(event) => {
                      setAgendaQuando(event.target.value);
                      setAgendaErro(undefined);
                    }}
                    className="mt-1 w-full rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-xs text-ink outline-none focus:border-brand/50"
                  />

                  {/* O horário mostrado é sempre o do produto, não o do
                      navegador: é o mesmo relógio da timeline, e é o que evita
                      alguém em outro fuso agendar para uma hora que não é a que
                      leu na tela. */}
                  {agendaQuando && isoDeDataHoraLocal(agendaQuando) ? (
                    <p className="mt-1.5 text-[11px] text-muted">
                      Sai {agendamentoLabel(new Date(isoDeDataHoraLocal(agendaQuando) as string))}.
                    </p>
                  ) : null}

                  {agendaErro ? (
                    <p role="alert" className="mt-1.5 text-[11px] font-medium text-red-500">
                      {agendaErro}
                    </p>
                  ) : null}

                  <div className="mt-3 flex justify-end gap-2 border-t border-line-soft pt-2.5">
                    <button
                      type="button"
                      onClick={() => setAgendaAberta(false)}
                      className="rounded-lg border border-line bg-surface px-2.5 py-1 text-xs font-semibold text-ink transition-colors hover:bg-surface-2"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      disabled={agendando}
                      onClick={() => void agendar()}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:opacity-90 disabled:opacity-50"
                    >
                      {agendando ? <Loader2 className="size-3.5 animate-spin" /> : (
                        <CalendarClock className="size-3.5" />
                      )}
                      <span>Agendar</span>
                    </button>
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </div>

        {/* Botão de Envio */}
        <button
          type="submit"
          disabled={blocked || isBusy || !canSubmit}
          className={cn(
            'flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold text-white shadow-xs transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40',
            isNote
              ? 'bg-amber-600 hover:bg-amber-500 shadow-amber-600/25'
              : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 shadow-blue-600/30',
          )}
        >
          {isBusy ? (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              <span>Enviando...</span>
            </>
          ) : (
            <>
              <span>{isNote ? 'Salvar nota' : 'Enviar'}</span>
              <Send className="size-3.5" />
            </>
          )}
        </button>
      </div>
    </form>
  );
}

function ToolbarButton({
  children,
  label,
  disabled,
  active,
  onClick,
  title,
}: {
  readonly children: React.ReactNode;
  readonly label: string;
  readonly disabled?: boolean;
  readonly active?: boolean;
  readonly onClick?: () => void;
  readonly title?: string;
}) {
  return (
    <button
      type="button"
      title={title ?? label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex size-8 items-center justify-center rounded-lg transition-all text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-40 disabled:pointer-events-none',
        active && 'bg-red-500/20 text-red-500 border border-red-500/30',
      )}
    >
      {children}
    </button>
  );
}
