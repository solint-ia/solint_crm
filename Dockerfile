# syntax=docker/dockerfile:1
#
# Imagens do Solint CRM: dois alvos, uma árvore de dependências.
#
#   docker compose build web      -> site (next start)
#   docker compose build worker   -> worker de WhatsApp (node .worker/worker.mjs)
#
# Os dois alvos partem do mesmo estágio `source`, então o `npm ci` roda uma vez
# e fica em cache para ambos. Construir um não reconstrói o outro — é o que
# permite subir o site sem reiniciar o worker, que segura as sessões abertas.

FROM node:22-bookworm-slim AS base
# O WORKDIR é o mesmo em todos os estágios, e isso não é estética:
# `scripts/build-worker.mjs` grava no bundle o caminho ABSOLUTO do cliente
# Prisma gerado (`/app/src/generated/prisma`). Build e execução em diretórios
# diferentes fazem o worker morrer no boot sem achar o Prisma.
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# --- dependências: só invalida quando o lockfile ou o schema mudam ----------
FROM base AS deps
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
# Com os scripts ligados: o `postinstall` do projeto roda `prisma generate`, e
# por isso o schema e o `prisma.config.ts` entram antes do `npm ci`.
RUN npm ci --no-audit --no-fund

# --- código-fonte + cliente Prisma gerado para Linux -------------------------
FROM deps AS source
COPY . .
RUN npx prisma generate

# --- site --------------------------------------------------------------------
FROM source AS web
# Valores FICTÍCIOS, só para este passo, e não ficam na imagem.
#
# O `next build` importa os módulos das rotas para decidir o que é estático, e
# `infrastructure/db/prisma.ts` cria o cliente na importação — sem uma
# `DATABASE_URL` ele lança e o build morre. O adaptador `pg` não conecta antes
# da primeira consulta, então uma URL que não aponta para nada basta. O
# `AUTH_SECRET` é exigido com `NODE_ENV=production`, que o build liga sozinho.
#
# Os valores reais chegam em tempo de execução, pelo `env_file` do compose.
RUN DATABASE_URL="postgresql://build:build@127.0.0.1:1/build" \
    AUTH_SECRET="somente-para-o-build-nao-e-usado-em-execucao" \
    node_modules/.bin/next build
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
EXPOSE 3000
CMD ["node_modules/.bin/next", "start", "-p", "3000", "-H", "0.0.0.0"]

# --- worker de WhatsApp ------------------------------------------------------
FROM source AS worker
RUN node scripts/build-worker.mjs
ENV NODE_ENV=production PORT=10000
EXPOSE 10000
CMD ["node", ".worker/worker.mjs"]
