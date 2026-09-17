# Plano de implementação: mídia mais leve (vídeo sob demanda + deduplicação por SHA-256)

> Documento de trabalho para agente de código. Leia inteiro antes de começar.
> Não faça commit deste arquivo.

## 1. Contexto e números que motivam o plano

O Solint CRM guarda a mídia do WhatsApp num bucket OCI Object Storage, acessado por URL
pré-autenticada (PAR). O código está em `src/infrastructure/storage/supabase-storage.ts`
(o nome é histórico) e em `src/infrastructure/whatsapp/wa-media-store.ts`. Cada arquivo
tem uma linha em `MediaObject`, com `checksum` SHA-256 já preenchido em **todas** as
linhas.

Medição feita em produção (tabela `MediaObject`, `mediaKind = 'mensagem'`):

| Conta        | Objetos | Conteúdos únicos | Hoje   | Com dedup |
|--------------|---------|------------------|--------|-----------|
| acc-mtaj8qoj | 1134    | 739              | 281 MB | 161 MB    |
| acc-mtbnqt4e | 116     | 112              | 45 MB  | 44 MB     |

| mimeType      | Qtd | Total  | Média   |
|---------------|-----|--------|---------|
| image/webp    | 575 | 163 MB | 291 kB  |  ← quase tudo figurinha
| video/mp4     | 52  | 89 MB  | 1757 kB |
| image/jpeg    | 263 | 30 MB  | 115 kB  |
| application/pdf | 8 | 21 MB  | 2687 kB |
| audio/ogg     | 335 | 18 MB  | 54 kB   |

Conclusões que definem o escopo:

- **Deduplicação vale:** ~37% do volume é repetido (sobretudo figurinhas encaminhadas).
- **Miniatura de imagem não vale agora:** JPEG médio tem 115 kB. Fica fora do escopo (seção 8).
- **Vídeo é o maior custo de banda por bolha** (1,7 MB em média) e hoje é baixado sem
  necessidade. É a Fase 0.
- **O navegador baixa a mesma figurinha várias vezes**, porque cada mensagem tem uma URL
  diferente. A Fase 1 resolve isso com uma URL por conteúdo.

## 2. Regras obrigatórias

1. **Nunca** leia, imprima, copie ou faça commit do `.env` real. Testes nunca podem
   carregá-lo: `prisma.config.ts` e `prisma/seed.ts` importam `dotenv/config`, então use
   `DOTENV_CONFIG_PATH` apontando para um arquivo de teste (seção 7.1).
2. **Nunca** rode migração, backfill ou teste contra o banco de produção ou contra o bucket
   real. Tudo roda num Postgres descartável e num servidor HTTP falso que imita a PAR.
3. Não altere nem faça commit de `DEPLOY-ORACLE-CLOUD.md`. Não faça commit de arquivos `.md`.
4. Não faça commit nem push sem pedido explícito.
5. O estilo do repositório é de comentários em português explicando **por que**, não o
   quê. Siga a densidade e o tom dos arquivos vizinhos (ver `REGRAS-GLOBAIS.md`).
6. Módulos importados pelo worker não podem importar `server-only`: o worker é Node puro,
   e o pacote lança fora da condição `react-server`.
7. `PrismaPromise` é preguiçosa. `void prisma.x.update(...)` sem `await`, `.then` ou
   `.catch` **não executa**.
8. Scripts de teste que tocam `postgresPubSub` precisam terminar com `process.exit`,
   porque a conexão de `LISTEN` segura o processo aberto.
9. A URL pública de mídia já gravada em mensagens (`/api/whatsapp/media/<id>`) **não pode
   mudar nem quebrar**. Webhooks para o n8n e a API v1 dependem dela.
10. Validação final de cada fase: `npm run typecheck` e `npx eslint <arquivos alterados>`
    limpos, mais os testes da seção 7.

## 3. Visão geral das fases

| Fase | Entrega | Migração |
|------|---------|----------|
| 0 | Vídeo sob demanda: `Range` na rota, `preload="none"`, poster, GIF só quando visível | não |
| 1 | Deduplicação por conteúdo (`MediaBlob`) + URL por conteúdo para o navegador | sim (aditiva) |
| 2 | Backfill: vincular a mídia existente aos blobs, sem baixar nada | não |

Faça e valide na ordem. Cada fase tem de ser implantável sozinha.

---

## 4. Fase 0: vídeo sob demanda

### 4.1 Suporte a `Range` na rota de mídia

**Por quê:** a rota `src/app/api/whatsapp/media/[id]/route.ts` sempre devolve o arquivo
inteiro, sem `Accept-Ranges`. Sem isso, `preload="metadata"` e o avanço na barra de tempo do
`<video>` obrigam o navegador a baixar o arquivo todo.

**Mudanças:**

- **`src/infrastructure/whatsapp/wa-media-store.ts`:** acrescentar a `StoredMedia` o método
  `streamRange(start: number, end: number): ReadableStream<Uint8Array>` (fim inclusivo).
  - Vindo do cache em disco: `fs.createReadStream(path, { start, end })`.
  - Vindo de buffer: `subarray(start, end + 1)`.
- **Novo módulo `src/infrastructure/whatsapp/media-response.ts`**, reutilizado pelas duas
  rotas de mídia (a da Fase 1 também):
  `respondWithMedia(request, media, headers): Response`.
  - Sem `Range`, ou com várias faixas (`bytes=0-1,5-9`): `200`, corpo inteiro,
    `Accept-Ranges: bytes`.
  - Uma faixa válida (`bytes=a-b`, `bytes=a-`, `bytes=-n`): `206`, com
    `Content-Range: bytes a-b/size`, `Content-Length` da faixa e `Accept-Ranges: bytes`.
  - Faixa fora do tamanho: `416`, com `Content-Range: bytes */size`.
  - Mantém os cabeçalhos de hoje: `Content-Type`, `Cache-Control`,
    `Content-Disposition` e `X-Content-Type-Options: nosniff`.
- A rota atual passa a usar esse helper. Autenticação e checagem de posse ficam como estão.

**Aceite:**

- `curl -H "Range: bytes=0-99"` devolve `206` com 100 bytes.
- Sem `Range` devolve `200` com `Accept-Ranges`.
- Faixa inválida devolve `416`.
- Mídia de outra conta continua `404`.

### 4.2 Poster do vídeo a partir do `jpegThumbnail` do WhatsApp

**Por quê:** o `videoMessage` do WhatsApp já traz uma miniatura JPEG embutida
(`jpegThumbnail`), sem download extra. Com ela, o vídeo pode ficar com `preload="none"` e
ainda mostrar uma capa.

**Mudanças:**

- **`src/core/domain/message.ts`:** o conteúdo `video` ganha `readonly posterUrl?: string`.
  É opcional, então mensagens antigas continuam válidas.
- **`src/infrastructure/whatsapp/wa-message-content.ts`:**
  - `MediaRef` ganha `readonly jpegThumbnail?: Uint8Array`, preenchido no ramo `videoMessage`
    quando `message.videoMessage.jpegThumbnail` tiver bytes.
  - `mediaContent(media, url, posterUrl?)` repassa `posterUrl` no conteúdo `video`.
- **`materializeMedia`** em `src/infrastructure/whatsapp/worker/session.ts` (motor worker, o
  de produção) e em `src/infrastructure/whatsapp/whatsapp-service.ts` (motor in-process,
  espelhar):
  - Quando `media.kind === 'video'` e houver `jpegThumbnail`, gravar o poster com
    `mediaStore.save(`${messageId}-poster`, Buffer.from(jpegThumbnail), { mimeType: 'image/jpeg' }, mesmoEscopo)`.
  - Conferir que `${messageId}-poster` passa em `isSafeMediaId` (até 128 caracteres,
    `[A-Za-z0-9_-]`). Se não passar, pular o poster.
  - No ramo "já guardada" (`mediaStore.has`), recuperar o poster com
    `mediaStore.publicId(`${messageId}-poster`, escopo)`.
  - **Best-effort:** qualquer falha do poster resulta em conteúdo sem `posterUrl`, nunca em
    erro na mensagem.
- Vídeo enviado pelo CRM (`sendMediaAction` em `src/app/(workspace)/conversas/actions.ts`)
  não tem `jpegThumbnail` e fica sem poster. Não gere frame no servidor: não há ffmpeg na
  imagem, e isso está fora do escopo.

### 4.3 Bolha de mensagem

Arquivo `src/features/conversas/components/message-bubble.tsx` (`MediaContent`):

- **Vídeo comum:** `<video preload="none" poster={content.posterUrl} controls playsInline>`.
  Sem poster, manter um fundo neutro com o ícone de play, para a bolha não virar um
  retângulo preto sem indicação.
- **GIF do WhatsApp (`content.gif`):** extrair um componente `GifVideo`.
  - `muted`, `loop`, `playsInline`, `preload="none"` e `poster`.
  - Usa `IntersectionObserver` (limiar 0,5): `play()` ao entrar na tela, `pause()` ao sair.
  - Tratar a promessa de `play()` com `.catch(() => undefined)`, porque política de
    autoplay pode recusar.
  - Com `prefers-reduced-motion: reduce`, não tocar sozinho: mostrar o poster e tocar no
    clique.
- **Imagem e figurinha:** acrescentar `decoding="async"`. Nada mais muda.
- O lightbox (`src/components/ui/media-lightbox.tsx`) continua usando `content.url`.

**Aceite da Fase 0:**

- Abrir uma conversa com vídeos não gera download de `video/mp4` até o clique no play.
  Conferir na aba Network.
- GIF fora da tela não baixa nem toca.
- Avançar na barra do vídeo gera requisições `206`.

---

## 5. Fase 1: deduplicação por conteúdo

### 5.1 Decisões (já tomadas; não reabrir)

| Tema | Decisão | Motivo |
|------|---------|--------|
| Escopo | **Por conta**, cruzando caixas | Mantém o prefixo `accountId/` no bucket (checado em `read`) e a exclusão em cascata. Também não revela a uma empresa que outra tem o mesmo arquivo. |
| URL de mensagem | **Não muda** | A deduplicação é interna. O id público continua sendo `MediaObject.id`. |
| Avatares (`mediaKind = 'avatar'`) | **Fora da deduplicação** | A foto de perfil sobrescreve o mesmo caminho quando muda. Endereçar por conteúdo deixaria órfã cada foto antiga, e a PAR não apaga. |
| Hash usado | SHA-256 **dos bytes decifrados, calculado por nós** | Não use `fileSha256` do WhatsApp para pular o download: o valor vem do remetente, que poderia declarar o hash de outro arquivo da conta e fazê-lo aparecer na conversa. |
| Contagem de referências | Não criar coluna | Contar `MediaObject` por `blobId` não sai de sincronia, e só será preciso quando houver exclusão. |

### 5.2 Migração (aditiva)

Em `prisma/schema.prisma`:

```prisma
model MediaBlob {
  id         String   @id @default(cuid())
  accountId  String
  /// SHA-256 (hex) dos bytes decifrados.
  checksum   String
  /// Mesmo formato de `MediaObject.bucketPath`: "{bucket}/{caminho}".
  bucketPath String   @unique
  /// Do primeiro upload. Serve à extensão e à rota por conteúdo; cada mensagem
  /// mantém o próprio `mimeType`/`fileName` em `MediaObject`.
  mimeType   String
  sizeBytes  Int
  createdAt  DateTime @default(now())

  account Account       @relation(fields: [accountId], references: [id], onDelete: Cascade)
  objects MediaObject[]

  @@unique([accountId, checksum])
}
```

Em `MediaObject`:

- Adicionar `blobId String?` e `blob MediaBlob? @relation(fields: [blobId], references: [id], onDelete: SetNull)`.
- **Remover `@unique` de `bucketPath`** e adicionar `@@index([bucketPath])`. Várias linhas
  passam a apontar para o mesmo objeto.
- Adicionar `@@index([blobId])`.

Em `Account`, adicionar `mediaBlobs MediaBlob[]`.

Gerar a migração contra o **banco descartável** (seção 7.1), com
`npm run db:migrate -- media-blobs` (usa `scripts/new-migration.mjs`, que faz
`migrate diff` + `migrate deploy`). Conferir que o SQL gerado **só** cria a tabela e os
índices, adiciona a coluna e troca o índice único de `bucketPath` por um comum. Nada pode
ser apagado.

### 5.3 Gravação: `mediaStore.save` (`wa-media-store.ts`)

Só muda o caminho com Storage configurado **e** `mediaKindFor(scope) === 'mensagem'`. O modo
sem Storage (disco local) fica como está.

1. Validar a entrada, como hoje.
2. Calcular `checksum = sha256(data).hex` **antes** de qualquer upload.
3. Resolver `id` como hoje (reutiliza o id de uma linha existente do mesmo `sourceId`).
   - Se essa linha já existe **com o mesmo `checksum` e `blobId` preenchido**: não fazer
     upload nem escrever no banco. Apenas gravar o cache e devolver a URL.
4. `blob = mediaBlob.findUnique({ accountId_checksum })`.
5. Se não existe blob:
   - fazer `storage.upload` no caminho por conteúdo:
     `objectPath = `${accountId}/blobs/${checksum.slice(0, 2)}/${checksum}.${extensionFor(mimeType)}``
     (bucket `BUCKETS.MEDIA`);
   - se o upload falhar, a mídia não é durável: mesmo comportamento de hoje, a função
     devolve `undefined` quando precisa ser durável;
   - criar o `MediaBlob`. Em erro de chave única (`P2002`, corrida entre dois saves do mesmo
     conteúdo), buscar de novo e reutilizar o vencedor. Os dois `PUT` gravam os mesmos
     bytes no mesmo caminho, então a corrida é inofensiva.
6. `mediaObject.upsert` como hoje, acrescentando `blobId: blob.id` e gravando
   `bucketPath: blob.bucketPath`.
   - **Motivo:** assim `read()` não muda, e um rollback do código continua lendo a mídia nova.
7. `durable = true`. O cache em disco e o retorno ficam como hoje.

**Avatares:** se já existe linha com o mesmo `checksum` e o mesmo `bucketPath`, pular o
`storage.upload`. Hoje a mesma foto é reenviada a cada renovação do avatar. O resto não muda.

### 5.4 URL por conteúdo, para o cache do navegador

**Por quê:** mesmo deduplicada no bucket, a figurinha repetida em 10 mensagens tem 10 URLs,
e o navegador faz 10 downloads.

- **Novo em `wa-media-store.ts`:**
  - `resolveBlob(id: string, accountId: string): Promise<{ blobId: string; mimeType: string } | null>`
    procura a linha por `{ id, accountId }` sem ler bytes, e só devolve quando houver `blobId`;
  - `readBlob(blobId: string, accountId: string): Promise<StoredMedia | null>`:
    - busca `MediaBlob` por `{ id: blobId, accountId }` (posse **antes** do cache, como em `read`);
    - usa o cache em disco sob a chave `blob-${blobId}`;
    - se não houver cache, baixa `bucketPath`, confere o prefixo `${accountId}/` e grava o cache.
- **Nova rota `src/app/api/whatsapp/media/b/[blobId]/route.ts`:**
  - autenticação idêntica à rota atual (cookie de sessão ou `Bearer` via `sessionFromApiToken`);
  - valida `isSafeMediaId(blobId)`;
  - blob de outra conta responde `404`;
  - responde com `respondWithMedia` (seção 4.1), `Content-Type: blob.mimeType` e
    `Cache-Control: private, max-age=31536000, immutable`;
  - `Content-Disposition` e `nosniff` seguem a mesma regra da rota atual (`RENDERABLE`).
- **Redirecionamento na rota atual `media/[id]`.** Responder `302` para
  `/api/whatsapp/media/b/<blobId>`, com `Cache-Control: private, max-age=31536000, immutable`,
  **somente se todas** as condições valerem:
  1. a sessão veio do **cookie** (não de `Bearer`), porque clientes HTTP de automação podem
     descartar `Authorization` ao seguir redirecionamento;
  2. o id não começa com `pp-` (avatar);
  3. `resolveBlob` achou um blob;
  4. o `mimeType` **da mensagem** casa com `RENDERABLE` (`image|video|audio`). Documento
     continua servido direto, porque o nome do arquivo (`Content-Disposition`) é da mensagem.

  Em qualquer outro caso, a rota se comporta como hoje.
- Nenhum componente do front muda. O navegador segue o redirecionamento sozinho, inclusive
  em `<video>` com `Range` e no `fetch` de download do lightbox.

**Aceite da Fase 1:**

- Duas mensagens com os mesmos bytes na mesma conta resultam em **1** `PUT`, 1 `MediaBlob` e
  2 `MediaObject`.
- As duas URLs de mensagem redirecionam para a **mesma** URL de blob.
- A API com `Bearer` recebe os bytes direto (`200`), sem `302`.

---

## 6. Fase 2: backfill (vincular o que já existe, sem baixar nada)

Script `scripts/backfill-media-blobs.ts`, no padrão dos outros `scripts/*.ts` (`npx tsx`,
saída legível, `process.exit` no fim).

- **Padrão é simulação.** Só escreve com `--apply`. Opções: `--account <id>` e
  `--verify` (faz um `GET` do objeto canônico antes de vincular; sem a opção, nada é baixado).
- **Seleção:** `MediaObject` com `mediaKind = 'mensagem'`, `blobId IS NULL` e
  `checksum IS NOT NULL`, agrupados por `(accountId, checksum)`, processados em lotes.
- **Para cada grupo, numa transação:**
  1. se já existe `MediaBlob` para `(accountId, checksum)`, criado pelo código novo, usar esse;
  2. senão, criar o blob com o objeto **mais antigo** do grupo como canônico
     (`bucketPath`, `mimeType` e `sizeBytes` dele). O caminho antigo vale como caminho do blob;
  3. vincular todas as linhas do grupo (`blobId`) e repontar o `bucketPath` delas para o do blob.
- **Idempotente:** rodar duas vezes seguidas não muda nada na segunda.
- **Nunca apaga nada do bucket.** Os caminhos que deixaram de ser referenciados são
  apenas relatados.
- **Relatório final:**
  - grupos;
  - linhas vinculadas;
  - blobs criados;
  - caminhos órfãos e bytes que eles ocupam;
  - com `--orphans-out <arquivo>`, a lista de órfãos em JSON, para uma limpeza futura (seção 8).

Resultado esperado em produção, pela medição da seção 1: ~395 linhas repontadas e ~120 MB
em caminhos órfãos na conta `acc-mtaj8qoj`.

---

## 7. Testes

### 7.1 Ambiente descartável (nunca produção)

```bash
docker run -d --name solint-teste-pg -e POSTGRES_USER=solint -e POSTGRES_PASSWORD=teste \
  -e POSTGRES_DB=solint_teste -p 55432:5432 postgres:17
```

Criar um arquivo de ambiente **fora do repositório**, por exemplo `/tmp/solint-teste.env`, com
valores fictícios:

```
DATABASE_URL=postgresql://solint:teste@127.0.0.1:55432/solint_teste
DIRECT_URL=postgresql://solint:teste@127.0.0.1:55432/solint_teste
WORKER_DATABASE_URL=postgresql://solint:teste@127.0.0.1:55432/solint_teste
WA_ENGINE=worker
AUTH_SECRET=segredo-de-teste-local
WA_ENCRYPTION_KEY=<32 bytes aleatórios em base64url>
SUPABASE_URL=
SUPABASE_SECRET_KEY=
OBJECT_STORAGE_PAR_URL=
```

Rodar tudo com as variáveis exportadas e `DOTENV_CONFIG_PATH` apontando para esse arquivo.
Abortar se `DATABASE_URL` não contiver `127.0.0.1:55432`:

```bash
set -a; . /tmp/solint-teste.env; set +a
export DOTENV_CONFIG_PATH=/tmp/solint-teste.env
case "$DATABASE_URL" in *127.0.0.1:55432*) ;; *) echo ABORTADO; exit 99;; esac
npx prisma migrate deploy
```

**OCI falso:** o cliente de Storage só faz `PUT`/`GET` em `{par}{objeto}` e lê
`OBJECT_STORAGE_PAR_URL` a cada chamada. O teste sobe um `http.createServer` local que
guarda os objetos num `Map`, **conta os `PUT`** e atende `GET`. Depois define
`process.env.OBJECT_STORAGE_PAR_URL = 'http://127.0.0.1:<porta>/p/'`.

**Chamar a rota ou a Server Action fora do Next:**

- trocar `server-only` pelo módulo vazio com `registerHooks` de `node:module`, resolvendo
  para `pathToFileURL(path.resolve('node_modules/server-only/empty.js')).href`
  (o `exports` do pacote não expõe esse arquivo);
- sobrescrever `container.session.getSession`/`getCurrentSession` com uma sessão fictícia.

O `scripts/test-marcar-lidas.ts` já faz as duas coisas e serve de referência.

Cada teste cria contas descartáveis (`Account` com cascata) e apaga no `finally`.

### 7.2 `scripts/test-media-range.ts` (Fase 0)

- Rota com `Range: bytes=0-99`: `206`, 100 bytes e `Content-Range` correto.
  Testar vindo do cache em disco e vindo do Storage.
- `bytes=-10` e `bytes=100-`: faixas certas.
- Várias faixas: `200` com o corpo inteiro.
- Faixa além do tamanho: `416`.
- Sem `Range`: `200` com `Accept-Ranges: bytes`.
- Mídia de outra conta: `404`, com ou sem `Range`.
- Decodificação: `videoMessage` com `jpegThumbnail` gera `MediaRef.jpegThumbnail`, e
  `mediaContent` inclui `posterUrl`.

### 7.3 `scripts/test-media-dedup.ts` (Fases 1 e 2)

**Gravação:**

- mesmos bytes, mesma conta, dois `sourceId`: 1 `PUT`, 1 blob, 2 `MediaObject` com o mesmo
  `blobId`, e os dois legíveis por `read`;
- mesmos bytes em caixas diferentes da mesma conta: 1 blob;
- mesmos bytes em contas diferentes: 2 blobs e 2 `PUT`, cada caminho com o prefixo da
  própria conta;
- mesmo conteúdo com `mimeType`/`fileName` diferentes: cada mensagem mantém os seus;
- 5 `save` concorrentes do mesmo conteúdo: 1 blob, nenhum erro, 5 URLs válidas;
- `save` repetido do mesmo `sourceId` com os mesmos bytes: nenhum `PUT` novo;
- avatar com checksum igual: nenhum `PUT`; avatar com foto nova: `PUT` no **mesmo** caminho
  e nenhum blob criado;
- falha no `PUT` (servidor falso devolve 500): `save` devolve `undefined` e não cria blob.

**Rotas:**

- `media/[id]` com sessão de cookie e mídia renderizável: `302` para `media/b/<blobId>`;
- duas mensagens duplicadas: o mesmo `Location`;
- `Bearer`, documento ou avatar: `200` direto;
- `media/b/[blobId]` de outra conta: `404`;
- da própria conta: `200` com `immutable`, e `206` com `Range`.

**Backfill:**

- linhas antigas duplicadas (sem `blobId`): a simulação não escreve nada e relata os números;
- com `--apply`: vincula e reponta;
- segunda execução: zero mudanças;
- `read` continua servindo todas as linhas;
- lista de órfãos correta.

**Regressão:**

- `scripts/test-media-storage.ts` continua passando. Ele só roda com
  `OBJECT_STORAGE_PAR_URL` definida (sem ela, para no primeiro `check`), então extraia o
  servidor falso para `scripts/fake-par-server.ts`, suba-o em outro terminal e exporte a
  URL dele antes de rodar o teste;
- `npm run typecheck` limpo;
- `npx eslint` nos arquivos alterados limpo.

Validação opcional de build:

```bash
docker build --target web -t solint-web:teste .
docker build --target worker -t solint-worker:teste .
```

---

## 8. Fora do escopo (não implementar)

- **Miniatura WebP de imagem:** o JPEG médio é de 115 kB, e o WebP é quase todo figurinha
  animada, que não pode virar imagem estática. Reavaliar se o JPEG médio passar de ~300 kB.
- **Apagar do bucket os caminhos órfãos do backfill:** a PAR não permite `DELETE`. Isso
  exigiria credencial assinada da OCI na VM, o que é decisão do dono do projeto. O
  `--orphans-out` deixa a lista pronta.
- Deduplicação entre contas.
- Usar `fileSha256` do WhatsApp para pular download (motivo na seção 5.1).
- Gerar frame de vídeo no servidor (ffmpeg).

## 9. Implantação (feita pelo dono do projeto, na VM)

Cada fase é implantável sozinha. A ordem para a Fase 1:

```bash
ssh ubuntu@129.148.61.254
cd /opt/solint && git pull
# 1. Migração primeiro (só aditiva)
docker compose run --rm --no-deps web npx prisma migrate deploy
# 2. Web e worker juntos
docker compose build web worker && docker compose up -d --no-deps web worker
# 3. Backfill: simulação, conferir o relatório, depois aplicar
docker compose run --rm --no-deps worker npx tsx scripts/backfill-media-blobs.ts
docker compose run --rm --no-deps worker npx tsx scripts/backfill-media-blobs.ts --apply
```

A Fase 0 não tem migração: basta `git pull`, o build e o `up` de web e worker.

**Rollback:** voltar o código é seguro. `MediaObject.bucketPath` continua preenchido, e o
código antigo não depende da unicidade removida. A tabela `MediaBlob` e a coluna `blobId`
podem ficar no banco sem uso.
