import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * Áudio no formato que o WhatsApp aceita como nota de voz.
 *
 * **O defeito que isto corrige.** O navegador grava no formato que ele sabe
 * gravar: Chrome e Edge produzem `audio/webm;codecs=opus`, e o Safari produz
 * MP4/AAC. O arquivo era enviado assim, com `ptt: true`. O servidor do WhatsApp
 * aceitava o upload e confirmava o envio (o CRM mostrava "enviado"), mas os
 * aplicativos só tratam como nota de voz um **OGG com Opus**: o áudio nunca
 * aparecia para o contato. Texto, imagem e figurinha não passam por isto e
 * chegavam normalmente, o que escondia a causa.
 *
 * O README do próprio Baileys registra a regra ("Audio Message": converter com
 * ffmpeg para `libopus` em OGG). A conversão roda com o `ffmpeg` do sistema,
 * instalado na imagem Docker.
 */

/** O tipo declarado junto com o arquivo convertido. */
export const VOICE_NOTE_MIME = 'audio/ogg; codecs=opus';

/**
 * Formatos que o WhatsApp toca como **arquivo de áudio** sem conversão.
 *
 * Um MP3 ou M4A anexado pelo operador chega e toca como está. WebM, WAV e o
 * resto não têm essa garantia e passam pela mesma conversão da nota de voz.
 */
const TOCA_COMO_ARQUIVO = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/x-m4a',
  'audio/aac',
]);

/** Uma conversão que passa disso travou: o arquivo tem no máximo 16 MB. */
const LIMITE_MS = 60_000;

/** Quantas barras a forma de onda da nota de voz tem no WhatsApp. */
const AMOSTRAS_DA_ONDA = 64;

export class ConversaoDeAudioError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConversaoDeAudioError';
  }
}

export interface NotaDeVoz {
  readonly data: Buffer;
  /** Duração em segundos, arredondada para o mais próximo e nunca menor que 1. */
  readonly seconds?: number;
  /** 64 valores de 0 a 100: o desenho que o aplicativo mostra na bolha. */
  readonly waveform?: Uint8Array;
}

const baseMime = (mime: string): string => mime.split(';')[0]?.trim().toLowerCase() ?? '';

/** O áudio precisa ser convertido antes de sair? */
export const precisaConverterAudio = (mimeType: string, voz: boolean): boolean =>
  voz || !TOCA_COMO_ARQUIVO.has(baseMime(mimeType));

const rodarFfmpeg = (
  args: readonly string[],
  limiteMs = LIMITE_MS,
): Promise<{ readonly stdout: Buffer; readonly stderr: string }> =>
  new Promise((resolve, reject) => {
    const binario = process.env.FFMPEG_PATH?.trim() || 'ffmpeg';
    const processo = spawn(binario, [...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const saida: Buffer[] = [];
    let erros = '';
    let terminou = false;

    const prazo = setTimeout(() => {
      if (terminou) return;
      terminou = true;
      processo.kill('SIGKILL');
      reject(new ConversaoDeAudioError(`A conversão de áudio passou de ${limiteMs / 1000}s.`));
    }, limiteMs);

    processo.stdout.on('data', (pedaco: Buffer) => saida.push(pedaco));
    processo.stderr.on('data', (pedaco: Buffer) => {
      erros += pedaco.toString('utf8');
      // Só o fim interessa: é onde ficam a duração final e a causa de um erro.
      if (erros.length > 20_000) erros = erros.slice(-20_000);
    });

    processo.on('error', (erro: NodeJS.ErrnoException) => {
      if (terminou) return;
      terminou = true;
      clearTimeout(prazo);
      reject(
        new ConversaoDeAudioError(
          erro.code === 'ENOENT'
            ? 'O ffmpeg não está instalado neste servidor, e o áudio não pode ser convertido para o formato do WhatsApp.'
            : `O ffmpeg não pôde ser iniciado: ${erro.message}`,
        ),
      );
    });

    processo.on('close', (codigo) => {
      if (terminou) return;
      terminou = true;
      clearTimeout(prazo);
      if (codigo === 0) {
        resolve({ stdout: Buffer.concat(saida), stderr: erros });
        return;
      }
      const causa = erros.trim().split('\n').slice(-3).join(' | ');
      reject(
        new ConversaoDeAudioError(`O ffmpeg não converteu o áudio (código ${codigo}): ${causa}`),
      );
    });
  });

/**
 * A duração lida do progresso final do ffmpeg.
 *
 * O cabeçalho da entrada não serve: a gravação do navegador sai sem duração
 * (`Duration: N/A`), porque o `MediaRecorder` escreve o arquivo enquanto grava.
 * O último `time=` é quanto de áudio foi de fato codificado.
 */
export const duracaoDoLog = (stderr: string): number | undefined => {
  const marcas = [...stderr.matchAll(/time=(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/g)];
  const ultima = marcas[marcas.length - 1];
  if (!ultima) return undefined;
  const segundos = Number(ultima[1]) * 3600 + Number(ultima[2]) * 60 + Number(ultima[3]);
  if (!Number.isFinite(segundos) || segundos <= 0) return undefined;
  // Para o segundo mais próximo, e não para cima: o Opus acrescenta alguns
  // milissegundos de enchimento, e um áudio de 3 s aparecia como 0:04.
  return Math.max(1, Math.round(segundos));
};

/**
 * A forma de onda no mesmo cálculo que o Baileys faria com `audio-decode`.
 *
 * O Baileys só a gera se esse pacote opcional estiver instalado, e ele não
 * está: sem isto a nota de voz chegaria com a barra lisa. Aqui o ffmpeg decodifica
 * para PCM e a média absoluta de cada um dos 64 blocos vira a altura da barra,
 * normalizada pela maior.
 */
export const formaDeOndaDePcm = (pcm: Buffer): Uint8Array | undefined => {
  const total = Math.floor(pcm.length / 2);
  const tamanhoDoBloco = Math.floor(total / AMOSTRAS_DA_ONDA);
  if (tamanhoDoBloco === 0) return undefined;

  const medias: number[] = [];
  for (let bloco = 0; bloco < AMOSTRAS_DA_ONDA; bloco += 1) {
    let soma = 0;
    for (let i = 0; i < tamanhoDoBloco; i += 1) {
      soma += Math.abs(pcm.readInt16LE((bloco * tamanhoDoBloco + i) * 2) / 32768);
    }
    medias.push(soma / tamanhoDoBloco);
  }

  const maior = Math.max(...medias);
  if (maior <= 0) return new Uint8Array(AMOSTRAS_DA_ONDA);
  return Uint8Array.from(medias.map((valor) => Math.floor((valor / maior) * 100)));
};

/**
 * Converte qualquer áudio que o ffmpeg leia para OGG/Opus mono de 48 kHz.
 *
 * Arquivo temporário, e não `pipe`: o MP4 do Safari guarda o índice no fim do
 * arquivo, e o ffmpeg não consegue lê-lo de um fluxo sem voltar atrás.
 */
export const converterParaNotaDeVoz = async (entrada: Buffer): Promise<NotaDeVoz> => {
  if (entrada.length === 0) throw new ConversaoDeAudioError('O áudio está vazio.');

  const pasta = await mkdtemp(path.join(tmpdir(), 'solint-audio-'));
  const origem = path.join(pasta, 'entrada');
  const destino = path.join(pasta, 'nota.ogg');

  try {
    await writeFile(origem, entrada);
    const { stderr } = await rodarFfmpeg([
      '-hide_banner',
      '-nostdin',
      '-y',
      '-i',
      origem,
      '-vn',
      '-map_metadata',
      '-1',
      '-ac',
      '1',
      '-ar',
      '48000',
      '-c:a',
      'libopus',
      '-b:a',
      '32k',
      '-application',
      'voip',
      '-avoid_negative_ts',
      'make_zero',
      '-f',
      'ogg',
      destino,
    ]);

    const data = await readFile(destino);
    // Conferir o resultado é barato, e um OGG vazio ou truncado seria outro
    // "enviado" que não chega.
    if (data.length < 64 || data.subarray(0, 4).toString('latin1') !== 'OggS') {
      throw new ConversaoDeAudioError('A conversão não produziu um arquivo OGG válido.');
    }
    if (!data.includes(Buffer.from('OpusHead', 'latin1'))) {
      throw new ConversaoDeAudioError('A conversão não produziu áudio Opus.');
    }

    const seconds = duracaoDoLog(stderr);
    // A onda é enfeite: sem ela a nota chega do mesmo jeito, só com a barra lisa.
    const waveform = await rodarFfmpeg(
      [
        '-hide_banner',
        '-nostdin',
        '-i',
        destino,
        '-ac',
        '1',
        '-ar',
        '8000',
        '-f',
        's16le',
        'pipe:1',
      ],
      20_000,
    )
      .then(({ stdout }) => formaDeOndaDePcm(stdout))
      .catch(() => undefined);

    return { data, ...(seconds ? { seconds } : {}), ...(waveform ? { waveform } : {}) };
  } finally {
    await rm(pasta, { recursive: true, force: true }).catch(() => undefined);
  }
};
