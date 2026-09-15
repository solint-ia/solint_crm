import http, { type IncomingMessage } from 'node:http';

export interface FakeParServer {
  readonly url: string;
  readonly objects: Map<string, Buffer>;
  readonly putCounts: Map<string, number>;
  readonly getCounts: Map<string, number>;
  readonly totalPuts: () => number;
  readonly failNextPuts: (count?: number) => void;
  readonly close: () => Promise<void>;
}

const bodyOf = async (request: IncomingMessage): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
};

/** OCI PAR mínima: guarda PUTs em memória e os devolve por GET. */
export const startFakeParServer = async (port = 0): Promise<FakeParServer> => {
  const objects = new Map<string, Buffer>();
  const putCounts = new Map<string, number>();
  const getCounts = new Map<string, number>();
  let pendingPutFailures = 0;

  const server = http.createServer(async (request, response) => {
    const path = decodeURI(new URL(request.url ?? '/', 'http://127.0.0.1').pathname).replace(
      /^\/p\//,
      '',
    );

    if (request.method === 'PUT' || request.method === 'POST') {
      if (pendingPutFailures > 0) {
        pendingPutFailures -= 1;
        response.writeHead(500, { 'Content-Type': 'text/plain' });
        response.end('falha simulada');
        return;
      }
      objects.set(path, await bodyOf(request));
      putCounts.set(path, (putCounts.get(path) ?? 0) + 1);
      response.writeHead(200);
      response.end();
      return;
    }

    if (request.method === 'GET') {
      const data = objects.get(path);
      if (!data) {
        response.writeHead(404);
        response.end();
        return;
      }
      getCounts.set(path, (getCounts.get(path) ?? 0) + 1);
      response.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(data.length),
      });
      response.end(data);
      return;
    }

    response.writeHead(405);
    response.end();
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Porta falsa não disponível.');

  return {
    url: `http://127.0.0.1:${address.port}/p/`,
    objects,
    putCounts,
    getCounts,
    totalPuts: () => [...putCounts.values()].reduce((total, count) => total + count, 0),
    failNextPuts: (count = 1) => {
      pendingPutFailures += count;
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
};

if (process.argv[1]?.endsWith('fake-par-server.ts')) {
  startFakeParServer(Number(process.env.FAKE_PAR_PORT ?? 0))
    .then((server) => {
      console.log(`PAR falsa disponível em ${server.url}`);
      const autoCloseMs = Number(process.env.FAKE_PAR_AUTO_CLOSE_MS ?? 0);
      if (autoCloseMs > 0) {
        setTimeout(() => void server.close(), autoCloseMs);
      }
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
