import 'dotenv/config';
import { spawn } from 'node:child_process';

/**
 * Verifica que o worker sobe.
 *
 * Ele roda como **processo filho**, não como import, e isso é proposital: o
 * ponto de entrada é `src/worker.mts` justamente porque precisa do resolvedor
 * ESM (ver o comentário lá). Importá-lo daqui, de um script CommonJS, testaria
 * um caminho de carregamento que não é o usado de verdade — e foi assim que a
 * falha de boot do Baileys passou despercebida.
 */
async function main() {
  console.log('[TestWorker] Subindo worker como processo separado...');

  const child = spawn('npm', ['run', 'worker'], {
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  const collect = (chunk: unknown) => {
    output += String(chunk);
    process.stdout.write(String(chunk));
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);

  const ready = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(output.includes('[Worker] Pronto.')), 20_000);
    child.on('exit', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });

  child.kill('SIGINT');

  if (!ready) {
    console.error('\n[TestWorker] O worker não ficou pronto. Saída acima.');
    process.exit(1);
  }

  console.log('\n[TestWorker] Worker inicializado com sucesso!');
  process.exit(0);
}

main().catch((err) => {
  console.error('[TestWorker] Erro ao inicializar worker:', err);
  process.exit(1);
});
