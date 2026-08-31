'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Seletor de emoji sem dependência externa.
 *
 * As bibliotecas prontas de emoji custam entre 300 KB e 1 MB de dados — a lista
 * Unicode inteira, com traduções, tons de pele e índice de busca — e tudo isso
 * entra no pacote da tela de conversas, que é a tela mais aberta do produto.
 * Para escrever "obrigado 🙏" no meio de um atendimento, o conjunto curado
 * abaixo cobre o uso real e cabe em alguns quilobytes.
 *
 * A busca é em português porque quem digita aqui digita em português: procurar
 * por "coração" tem de achar ❤️, e nenhuma lista em inglês faz isso.
 */

interface Grupo {
  readonly id: string;
  readonly rotulo: string;
  /** Ícone da aba — um emoji do próprio grupo. */
  readonly icone: string;
  readonly itens: readonly (readonly [emoji: string, termos: string])[];
}

const GRUPOS: readonly Grupo[] = [
  {
    id: 'rostos',
    rotulo: 'Rostos e pessoas',
    icone: '😀',
    itens: [
      ['😀', 'sorriso feliz alegre'],
      ['😃', 'sorriso feliz alegre'],
      ['😄', 'sorriso feliz risada'],
      ['😁', 'sorriso dentes feliz'],
      ['😆', 'risada gargalhada'],
      ['😅', 'risada alivio suor'],
      ['😂', 'chorando de rir risada lagrimas'],
      ['🤣', 'rolando de rir gargalhada'],
      ['🙂', 'sorriso leve'],
      ['😉', 'piscada'],
      ['😊', 'sorriso timido feliz'],
      ['😇', 'anjo santo'],
      ['🥰', 'amor apaixonado coracoes'],
      ['😍', 'apaixonado amor olhos'],
      ['😘', 'beijo'],
      ['😗', 'beijo'],
      ['😋', 'delicia gostoso lingua'],
      ['😛', 'lingua brincadeira'],
      ['🤪', 'doido maluco'],
      ['🤨', 'desconfiado duvida'],
      ['🧐', 'analisando monoculo'],
      ['🤓', 'nerd estudioso'],
      ['😎', 'oculos estiloso legal'],
      ['🥳', 'festa comemoracao'],
      ['😏', 'malicioso ironico'],
      ['😒', 'desanimado chateado'],
      ['😞', 'triste decepcionado'],
      ['😔', 'triste pensativo'],
      ['😟', 'preocupado'],
      ['😕', 'confuso'],
      ['🙁', 'triste'],
      ['😣', 'perseverando esforco'],
      ['😖', 'frustrado'],
      ['😫', 'cansado exausto'],
      ['😩', 'cansado desanimado'],
      ['🥺', 'suplicante pedindo'],
      ['😢', 'chorando triste'],
      ['😭', 'chorando muito triste'],
      ['😤', 'irritado bufando'],
      ['😠', 'bravo irritado'],
      ['😡', 'furioso raiva'],
      ['🤬', 'xingando palavrao'],
      ['🤯', 'chocado explodindo'],
      ['😳', 'surpreso envergonhado'],
      ['🥵', 'calor quente'],
      ['🥶', 'frio congelando'],
      ['😱', 'medo grito susto'],
      ['😨', 'medo assustado'],
      ['😰', 'ansioso nervoso'],
      ['😥', 'aliviado triste'],
      ['😓', 'suando cansado'],
      ['🤗', 'abraco'],
      ['🤔', 'pensando duvida'],
      ['🤭', 'risada discreta ops'],
      ['🤫', 'silencio segredo'],
      ['🤥', 'mentira pinoquio'],
      ['😶', 'sem palavras mudo'],
      ['😐', 'neutro serio'],
      ['😑', 'inexpressivo'],
      ['😬', 'constrangido careta'],
      ['🙄', 'revirando os olhos'],
      ['😯', 'surpreso'],
      ['😦', 'espantado'],
      ['😮', 'uau surpreso boca aberta'],
      ['😲', 'chocado'],
      ['🥱', 'bocejo sono'],
      ['😴', 'dormindo sono'],
      ['🤤', 'babando'],
      ['😪', 'sono cansado'],
      ['😵', 'tonto'],
      ['🤐', 'boca fechada'],
      ['🥴', 'zonzo bebado'],
      ['🤢', 'enjoado nojo'],
      ['🤮', 'vomitando'],
      ['🤧', 'espirro resfriado'],
      ['😷', 'mascara doente'],
      ['🤒', 'febre doente'],
      ['🤕', 'machucado ferido'],
      ['🤑', 'dinheiro rico'],
      ['🤠', 'cowboy'],
      ['😈', 'diabo travesso'],
      ['💀', 'caveira morto'],
      ['👻', 'fantasma'],
      ['👽', 'alien'],
      ['🤖', 'robo bot'],
      ['👶', 'bebe'],
      ['🧑', 'pessoa'],
      ['👨', 'homem'],
      ['👩', 'mulher'],
      ['🧓', 'idoso'],
      ['👮', 'policial'],
      ['👷', 'obra trabalhador'],
      ['💼', 'trabalho maleta negocio'],
      ['🕵️', 'detetive investigando'],
    ],
  },
  {
    id: 'gestos',
    rotulo: 'Gestos',
    icone: '👍',
    itens: [
      ['👍', 'joinha positivo curtir ok legal'],
      ['👎', 'negativo nao gostei'],
      ['👌', 'ok certo perfeito'],
      ['🤌', 'italiano gesto'],
      ['✌️', 'paz vitoria'],
      ['🤞', 'dedos cruzados sorte'],
      ['🤟', 'te amo'],
      ['🤘', 'rock'],
      ['🤙', 'me liga'],
      ['👈', 'esquerda apontando'],
      ['👉', 'direita apontando'],
      ['👆', 'cima apontando'],
      ['👇', 'baixo apontando'],
      ['☝️', 'atencao um'],
      ['✋', 'mao parada'],
      ['🤚', 'mao levantada'],
      ['🖐️', 'mao dedos'],
      ['🖖', 'saudacao vulcano'],
      ['👋', 'oi tchau aceno ola'],
      ['🤝', 'aperto de mao acordo negocio'],
      ['🙏', 'obrigado por favor oracao gratidao'],
      ['✍️', 'escrevendo'],
      ['💪', 'forca musculo'],
      ['🦾', 'braco forca'],
      ['👏', 'palmas aplausos parabens'],
      ['🙌', 'comemorando maos'],
      ['👐', 'maos abertas'],
      ['🤲', 'maos pedindo'],
      ['🫶', 'coracao com as maos amor'],
      ['🤦', 'facepalm decepcao'],
      ['🤷', 'nao sei ombros'],
      ['💅', 'unhas'],
      ['👀', 'olhos olhando'],
      ['🧠', 'cerebro ideia'],
    ],
  },
  {
    id: 'coracoes',
    rotulo: 'Corações e símbolos',
    icone: '❤️',
    itens: [
      ['❤️', 'coracao amor vermelho'],
      ['🧡', 'coracao laranja'],
      ['💛', 'coracao amarelo'],
      ['💚', 'coracao verde'],
      ['💙', 'coracao azul'],
      ['💜', 'coracao roxo'],
      ['🖤', 'coracao preto'],
      ['🤍', 'coracao branco'],
      ['🤎', 'coracao marrom'],
      ['💔', 'coracao partido'],
      ['❣️', 'coracao exclamacao'],
      ['💕', 'dois coracoes amor'],
      ['💞', 'coracoes girando'],
      ['💓', 'coracao batendo'],
      ['💗', 'coracao crescendo'],
      ['💖', 'coracao brilhando'],
      ['💘', 'coracao flecha'],
      ['💝', 'coracao presente'],
      ['✨', 'brilho estrelas magia'],
      ['⭐', 'estrela'],
      ['🌟', 'estrela brilhante'],
      ['💫', 'tontura estrela'],
      ['🔥', 'fogo top incrivel'],
      ['💥', 'explosao'],
      ['💯', 'cem nota maxima perfeito'],
      ['✅', 'certo confirmado feito'],
      ['☑️', 'marcado'],
      ['❌', 'errado cancelar'],
      ['⚠️', 'atencao aviso cuidado'],
      ['❗', 'exclamacao importante'],
      ['❓', 'duvida pergunta'],
      ['🔔', 'sino aviso notificacao'],
      ['🔕', 'sino mudo silencio'],
      ['♻️', 'reciclar'],
      ['🆕', 'novo'],
      ['🆗', 'ok'],
      ['🔴', 'bolinha vermelha'],
      ['🟢', 'bolinha verde'],
      ['🟡', 'bolinha amarela'],
      ['🔵', 'bolinha azul'],
    ],
  },
  {
    id: 'trabalho',
    rotulo: 'Trabalho e objetos',
    icone: '📌',
    itens: [
      ['📌', 'fixar alfinete importante'],
      ['📎', 'anexo clipe'],
      ['📝', 'anotacao escrever nota'],
      ['📄', 'documento arquivo'],
      ['📁', 'pasta'],
      ['📊', 'grafico relatorio dados'],
      ['📈', 'crescimento subindo grafico'],
      ['📉', 'queda caindo grafico'],
      ['📅', 'calendario data agenda'],
      ['🗓️', 'calendario agenda'],
      ['⏰', 'alarme horario despertador'],
      ['⏳', 'ampulheta aguardando'],
      ['⌛', 'tempo esgotado'],
      ['🕐', 'relogio hora'],
      ['💰', 'dinheiro saco'],
      ['💵', 'dinheiro nota'],
      ['💳', 'cartao pagamento'],
      ['🧾', 'recibo nota fiscal'],
      ['🛒', 'carrinho compra'],
      ['🎁', 'presente'],
      ['📦', 'caixa pacote entrega'],
      ['🚚', 'entrega caminhao frete'],
      ['✈️', 'aviao viagem'],
      ['🏠', 'casa'],
      ['🏢', 'empresa predio escritorio'],
      ['🔑', 'chave acesso'],
      ['🔒', 'cadeado seguro bloqueado'],
      ['🔓', 'cadeado aberto'],
      ['📱', 'celular telefone'],
      ['💻', 'notebook computador'],
      ['⌨️', 'teclado'],
      ['🖨️', 'impressora'],
      ['📞', 'telefone ligacao'],
      ['📧', 'email mensagem'],
      ['💬', 'balao mensagem conversa'],
      ['🔗', 'link'],
      ['🔍', 'lupa buscar procurar'],
      ['💡', 'ideia lampada'],
      ['🎯', 'alvo meta objetivo'],
      ['🏆', 'trofeu vitoria premio'],
      ['🥇', 'primeiro lugar medalha'],
      ['🚀', 'foguete lancamento rapido'],
      ['⚡', 'raio rapido energia'],
      ['🛠️', 'ferramentas manutencao'],
      ['⚙️', 'configuracao engrenagem'],
    ],
  },
  {
    id: 'comida',
    rotulo: 'Comida e bebida',
    icone: '🍔',
    itens: [
      ['☕', 'cafe'],
      ['🍵', 'cha'],
      ['🥤', 'refrigerante bebida'],
      ['🍺', 'cerveja'],
      ['🍻', 'brinde cerveja'],
      ['🥂', 'brinde comemoracao'],
      ['🍷', 'vinho'],
      ['🍕', 'pizza'],
      ['🍔', 'hamburguer lanche'],
      ['🌭', 'cachorro quente'],
      ['🍟', 'batata frita'],
      ['🌮', 'taco'],
      ['🍜', 'macarrao sopa'],
      ['🍣', 'sushi'],
      ['🥗', 'salada'],
      ['🍞', 'pao'],
      ['🧀', 'queijo'],
      ['🍎', 'maca fruta'],
      ['🍌', 'banana'],
      ['🍓', 'morango'],
      ['🍉', 'melancia'],
      ['🍫', 'chocolate'],
      ['🍰', 'bolo fatia'],
      ['🎂', 'bolo aniversario'],
      ['🍦', 'sorvete'],
      ['🍪', 'biscoito cookie'],
      ['🍿', 'pipoca'],
    ],
  },
  {
    id: 'natureza',
    rotulo: 'Natureza e clima',
    icone: '🌱',
    itens: [
      ['🌱', 'muda planta crescimento'],
      ['🌳', 'arvore'],
      ['🌵', 'cacto'],
      ['🌸', 'flor cerejeira'],
      ['🌹', 'rosa flor'],
      ['🌻', 'girassol'],
      ['🍀', 'trevo sorte'],
      ['🍂', 'outono folhas'],
      ['☀️', 'sol dia'],
      ['🌤️', 'sol nuvem'],
      ['☁️', 'nuvem'],
      ['🌧️', 'chuva'],
      ['⛈️', 'tempestade'],
      ['❄️', 'neve frio'],
      ['🌈', 'arco iris'],
      ['🌊', 'onda mar'],
      ['🌙', 'lua noite'],
      ['🐶', 'cachorro'],
      ['🐱', 'gato'],
      ['🐭', 'rato'],
      ['🐦', 'passaro'],
      ['🐝', 'abelha'],
      ['🦋', 'borboleta'],
      ['🐢', 'tartaruga'],
      ['🐟', 'peixe'],
    ],
  },
  {
    id: 'festa',
    rotulo: 'Festa e atividades',
    icone: '🎉',
    itens: [
      ['🎉', 'festa comemoracao parabens'],
      ['🎊', 'confete festa'],
      ['🎈', 'balao festa'],
      ['🎄', 'natal arvore'],
      ['🎃', 'halloween abobora'],
      ['🎆', 'fogos de artificio'],
      ['🎵', 'musica nota'],
      ['🎶', 'musica notas'],
      ['🎤', 'microfone cantar'],
      ['🎧', 'fone de ouvido'],
      ['🎬', 'cinema filme'],
      ['📷', 'foto camera'],
      ['🎮', 'videogame jogo'],
      ['⚽', 'futebol bola'],
      ['🏀', 'basquete'],
      ['🏐', 'volei'],
      ['🎾', 'tenis'],
      ['🏋️', 'academia treino'],
      ['🚴', 'bicicleta ciclismo'],
      ['🏃', 'corrida correndo'],
      ['🧘', 'meditacao yoga calma'],
      ['🏖️', 'praia ferias'],
    ],
  },
];

/** Emojis usados recentemente, por navegador. */
const RECENTES_KEY = 'solint:emojis-recentes';
const MAX_RECENTES = 24;

const lerRecentes = (): readonly string[] => {
  try {
    const bruto = localStorage.getItem(RECENTES_KEY);
    const lista: unknown = bruto ? JSON.parse(bruto) : [];
    return Array.isArray(lista) ? lista.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    // Navegação privada, armazenamento bloqueado: a lista simplesmente não
    // existe. Um seletor sem "recentes" continua sendo um seletor.
    return [];
  }
};

const gravarRecentes = (lista: readonly string[]): void => {
  try {
    localStorage.setItem(RECENTES_KEY, JSON.stringify(lista.slice(0, MAX_RECENTES)));
  } catch {
    // Idem: gravar é conveniência, não requisito.
  }
};

/** Remove acentos para a busca casar "coracao" com "coração". */
const semAcento = (texto: string): string =>
  texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

interface EmojiPickerProps {
  readonly onPick: (emoji: string) => void;
  readonly onClose: () => void;
  /** Onde o painel encosta. `bottom` abre para cima (uso no compositor). */
  readonly align?: 'left' | 'right';
  readonly className?: string;
}

export function EmojiPicker({ onPick, onClose, align = 'left', className }: EmojiPickerProps) {
  const [busca, setBusca] = useState('');
  const [grupoAtivo, setGrupoAtivo] = useState<string>(GRUPOS[0]?.id ?? 'rostos');
  const [recentes, setRecentes] = useState<readonly string[]>([]);
  const painelRef = useRef<HTMLDivElement>(null);
  const buscaRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setRecentes(lerRecentes());
    buscaRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const termo = semAcento(busca.trim());

  const resultados = useMemo(() => {
    if (!termo) return null;
    const encontrados: string[] = [];
    for (const grupo of GRUPOS) {
      for (const [emoji, termos] of grupo.itens) {
        if (semAcento(termos).includes(termo)) encontrados.push(emoji);
      }
    }
    return encontrados;
  }, [termo]);

  const escolher = (emoji: string) => {
    const proximos = [emoji, ...recentes.filter((item) => item !== emoji)].slice(0, MAX_RECENTES);
    setRecentes(proximos);
    gravarRecentes(proximos);
    onPick(emoji);
  };

  const grupo = GRUPOS.find((item) => item.id === grupoAtivo) ?? GRUPOS[0];

  return (
    <>
      {/* Clique fora fecha. Fica atrás do painel e cobre a tela inteira. */}
      <div className="fixed inset-0 z-30" onClick={onClose} aria-hidden="true" />
      <div
        ref={painelRef}
        role="dialog"
        aria-label="Selecionar emoji"
        className={cn(
          'absolute bottom-full z-40 mb-2 w-[min(21rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl',
          align === 'right' ? 'right-0' : 'left-0',
          className,
        )}
      >
        <header className="flex items-center gap-2 border-b border-line-soft px-3 py-2">
          <Search className="size-3.5 shrink-0 text-muted" />
          <input
            ref={buscaRef}
            value={busca}
            onChange={(event) => setBusca(event.target.value)}
            placeholder="Buscar emoji..."
            aria-label="Buscar emoji"
            className="min-w-0 flex-1 bg-transparent text-xs text-ink placeholder:text-muted outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar seletor de emoji"
            className="flex size-5 shrink-0 items-center justify-center rounded text-muted transition-colors hover:text-ink"
          >
            <X className="size-3.5" />
          </button>
        </header>

        {resultados ? (
          <div className="max-h-56 overflow-y-auto p-2">
            {resultados.length === 0 ? (
              <p className="px-2 py-6 text-center text-xs text-muted">
                Nenhum emoji para “{busca.trim()}”.
              </p>
            ) : (
              <Grade emojis={resultados} onPick={escolher} />
            )}
          </div>
        ) : (
          <>
            <div className="max-h-56 overflow-y-auto p-2">
              {recentes.length > 0 ? (
                <section className="mb-2">
                  <h3 className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
                    Usados recentemente
                  </h3>
                  <Grade emojis={recentes} onPick={escolher} />
                </section>
              ) : null}

              {grupo ? (
                <section>
                  <h3 className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
                    {grupo.rotulo}
                  </h3>
                  <Grade emojis={grupo.itens.map(([emoji]) => emoji)} onPick={escolher} />
                </section>
              ) : null}
            </div>

            <nav
              aria-label="Categorias de emoji"
              className="flex items-center gap-0.5 border-t border-line-soft bg-surface-2 px-2 py-1.5"
            >
              {GRUPOS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setGrupoAtivo(item.id)}
                  title={item.rotulo}
                  aria-label={item.rotulo}
                  aria-pressed={item.id === grupoAtivo}
                  className={cn(
                    'flex size-7 items-center justify-center rounded-lg text-base transition-colors',
                    item.id === grupoAtivo ? 'bg-brand/15' : 'hover:bg-surface',
                  )}
                >
                  <span aria-hidden="true">{item.icone}</span>
                </button>
              ))}
            </nav>
          </>
        )}
      </div>
    </>
  );
}

function Grade({
  emojis,
  onPick,
}: {
  readonly emojis: readonly string[];
  readonly onPick: (emoji: string) => void;
}) {
  return (
    <div className="grid grid-cols-8 gap-0.5">
      {emojis.map((emoji, index) => (
        <button
          key={`${emoji}-${index}`}
          type="button"
          onClick={() => onPick(emoji)}
          className="flex size-8 items-center justify-center rounded-lg text-lg leading-none transition-transform hover:scale-110 hover:bg-surface-2"
        >
          <span aria-hidden="true">{emoji}</span>
        </button>
      ))}
    </div>
  );
}

/** Reações rápidas da bolha — as mesmas seis que o WhatsApp oferece. */
export const QUICK_REACTIONS: readonly string[] = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
