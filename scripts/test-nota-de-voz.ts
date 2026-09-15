/**
 * Conversão de áudio para nota de voz do WhatsApp.
 *
 * Tranca o defeito do áudio que aparecia como "enviado" no CRM e nunca chegava:
 * a gravação do navegador (WebM no Chrome e no Edge, MP4 no Safari) precisa
 * virar OGG/Opus antes de sair.
 *
 * Sem ffmpeg na máquina, confere só as regras e a mensagem de erro. Com ffmpeg,
 * gera áudios de teste nos formatos que os navegadores produzem e converte cada
 * um. Não usa banco nem WhatsApp.
 *
 *   npx tsx scripts/test-nota-de-voz.ts
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  ConversaoDeAudioError,
  VOICE_NOTE_MIME,
  converterParaNotaDeVoz,
  duracaoDoLog,
  formaDeOndaDePcm,
  precisaConverterAudio,
} from '../src/infrastructure/whatsapp/wa-audio';

const falhas: string[] = [];
const check = (label: string, ok: boolean, detalhe = '') => {
  console.log(`  ${ok ? 'OK   ' : 'FALHA'} ${label}${detalhe ? ` (${detalhe})` : ''}`);
  if (!ok) falhas.push(label);
};

const ffmpeg = process.env.FFMPEG_PATH?.trim() || 'ffmpeg';
const temFfmpeg = spawnSync(ffmpeg, ['-version'], { windowsHide: true }).status === 0;

async function main() {
  console.log('\n1) Regras');
  check('nota de voz sempre converte', precisaConverterAudio('audio/ogg;codecs=opus', true));
  check('WebM anexado converte', precisaConverterAudio('audio/webm;codecs=opus', false));
  check('WAV anexado converte', precisaConverterAudio('audio/wav', false));
  check('MP3 anexado sai como está', !precisaConverterAudio('audio/mpeg', false));
  check('M4A anexado sai como está', !precisaConverterAudio('audio/x-m4a', false));
  check('tipo da nota de voz', VOICE_NOTE_MIME === 'audio/ogg; codecs=opus');
  check(
    'duração vem do último progresso, arredondada para o segundo mais próximo',
    duracaoDoLog('Duration: N/A\ntime=00:00:01.50 x\nsize=1kB time=00:00:03.02 bitrate') === 3,
  );
  check('meio segundo não vira zero', duracaoDoLog('time=00:00:00.40') === 1);
  check('sem progresso, sem duração', duracaoDoLog('Duration: N/A') === undefined);

  const pcm = Buffer.alloc(8000 * 2);
  for (let i = 0; i < 8000; i += 1) pcm.writeInt16LE(i < 4000 ? 1000 : 16000, i * 2);
  const onda = formaDeOndaDePcm(pcm);
  check('forma de onda tem 64 barras', onda?.length === 64);
  check(
    'barras vão de 0 a 100 e a maior é 100',
    Boolean(onda && Math.max(...onda) === 100 && onda.every((v) => v >= 0 && v <= 100)),
  );
  check('áudio curto demais não gera onda', formaDeOndaDePcm(Buffer.alloc(10)) === undefined);

  if (!temFfmpeg) {
    console.log('\n2) Sem ffmpeg nesta máquina');
    const erro = await converterParaNotaDeVoz(Buffer.from('qualquer coisa')).catch(
      (e: unknown) => e,
    );
    check(
      'falha com mensagem que nomeia o ffmpeg',
      erro instanceof ConversaoDeAudioError && erro.message.includes('ffmpeg'),
      erro instanceof Error ? erro.message : String(erro),
    );
    return;
  }

  console.log('\n2) Conversão real');
  const pasta = mkdtempSync(path.join(tmpdir(), 'teste-nota-'));
  try {
    const gerar = (nome: string, codec: string[]) => {
      const arquivo = path.join(pasta, nome);
      const r = spawnSync(
        ffmpeg,
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-y',
          '-f',
          'lavfi',
          '-i',
          'sine=frequency=440:duration=3',
          ...codec,
          arquivo,
        ],
        { windowsHide: true },
      );
      if (r.status !== 0) throw new Error(`Não gerou ${nome}: ${r.stderr.toString()}`);
      return readFileSync(arquivo);
    };

    const entradas: [string, Buffer][] = [
      ['WebM/Opus (Chrome, Edge)', gerar('chrome.webm', ['-c:a', 'libopus'])],
      ['MP4/AAC (Safari)', gerar('safari.m4a', ['-c:a', 'aac'])],
      ['WAV', gerar('audio.wav', ['-c:a', 'pcm_s16le'])],
    ];

    for (const [nome, bytes] of entradas) {
      const nota = await converterParaNotaDeVoz(bytes);
      check(`${nome}: vira OGG`, nota.data.subarray(0, 4).toString('latin1') === 'OggS');
      check(`${nome}: codec Opus`, nota.data.includes(Buffer.from('OpusHead', 'latin1')));
      check(`${nome}: duração de 3 s`, nota.seconds === 3, `seconds=${nota.seconds}`);
      check(`${nome}: forma de onda com 64 barras`, nota.waveform?.length === 64);
    }

    const invalido = await converterParaNotaDeVoz(Buffer.from('isto não é áudio')).catch(
      (e: unknown) => e,
    );
    check(
      'arquivo que não é áudio falha com erro claro',
      invalido instanceof ConversaoDeAudioError,
    );
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
}

main()
  .then(() => {
    if (falhas.length > 0) {
      console.error(`\n${falhas.length} falha(s): ${falhas.join('; ')}`);
      process.exit(1);
    }
    console.log(`\nTodos os testes de nota de voz passaram${temFfmpeg ? '' : ' (sem ffmpeg)'}.`);
  })
  .catch((erro) => {
    console.error('Erro no teste:', erro);
    process.exit(1);
  });
