#!/usr/bin/env node
/**
 * Sobe o site e o worker de WhatsApp juntos.
 *
 * O motor `worker` precisa de dois processos no ar. Deixar isso a cargo de dois
 * terminais é onde o erro acontece: esquece-se o worker, a tela fica em
 * "conectando" e a culpa parece ser do código.
 *
 * Sem dependência nova de propósito — `concurrently` resolveria isto, mas não
 * vale uma dependência a mais no projeto por trinta linhas de `spawn`.
 */
import { spawn } from 'node:child_process';

const children = [];
let shuttingDown = false;

/** Prefixo por processo: sem isso as duas saídas viram uma só, ilegível. */
const run = (name, command, args, env) => {
  const child = spawn(command, args, {
    // `shell: true` porque no Windows os executáveis do npm são `.cmd`, e o
    // `spawn` cru não os encontra sem passar pelo shell.
    shell: true,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const prefix = (stream, chunk) => {
    for (const line of String(chunk).split('\n')) {
      if (line.trim()) stream.write(`[${name}] ${line}\n`);
    }
  };

  child.stdout.on('data', (chunk) => prefix(process.stdout, chunk));
  child.stderr.on('data', (chunk) => prefix(process.stderr, chunk));

  child.on('exit', (code) => {
    if (shuttingDown) return;
    console.error(`[dev:all] "${name}" encerrou com código ${code}. Derrubando o restante.`);
    shutdown(code ?? 1);
  });

  children.push(child);
  return child;
};

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    child.kill('SIGINT');
  }
  // Dá ao worker a chance de encerrar as sessões do WhatsApp com ordem antes de
  // o processo morrer — desligar no tapa deixa o lock preso até expirar.
  setTimeout(() => process.exit(code), 3000).unref();
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

console.log('[dev:all] Subindo site + worker (WA_ENGINE=worker).');

// A variável vale para os dois: o site precisa saber que deve enfileirar em vez
// de abrir a própria sessão, e o worker precisa saber que é o worker.
run('site', 'npm', ['run', 'dev'], { WA_ENGINE: 'worker' });
run('worker', 'npm', ['run', 'worker'], { WA_ENGINE: 'worker' });
