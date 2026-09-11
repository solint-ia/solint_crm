# Deploy do Solint CRM na Oracle Cloud (Always Free)

Guia passo a passo para mover site, worker de WhatsApp, banco e mídia da
combinação atual (Vercel + Render + Supabase) para **uma única VM Ampere A1** do
plano gratuito da Oracle.

---

## 0. O que muda

| Peça | Hoje | Depois |
| --- | --- | --- |
| Site (Next 15) | Vercel, região `gru1` | contêiner `web` na VM |
| Worker (Baileys) | Render, réplica única | contêiner `worker` na mesma VM |
| Postgres | Supabase (pooler, ~15 sessões) | contêiner `postgres` na VM |
| Mídia | Supabase Storage | ver §2, decisão 2 |
| TLS / domínio | Vercel | Caddy na VM (Let's Encrypt automático) |

Três consequências boas, de graça:

1. **Acabam os limites de conexão.** O `connection_limit=1`, o pooler em modo
   transação e todo o cuidado descrito nas seções 1–3 do `.env.example` existem
   por causa do Supabase. Com o Postgres a um salto de rede do site, as três
   URLs viram a mesma coisa e o pool pode crescer.
2. **Acaba a latência de hemisfério.** Site e banco no mesmo host: ~0,2 ms em
   vez dos ~10 ms do melhor caso atual.
3. **O worker deixa de reiniciar por deploy do site** — não por convenção
   (`DEPLOY-WHATSAPP-WORKER.md`), mas porque são contêineres independentes.

E uma ruim, que precisa estar escrita: **é uma máquina só.** Se ela cair, cai
tudo — site, worker, banco e sessões de WhatsApp. O plano gratuito não tem SLA.

---

## 1. Fase 0 — o teste que decide se o plano é viável (faça ANTES de tudo)

O Ampere A1 é **ARM64**, não x86. Três dependências precisam ter binário arm64:

| Dependência | Risco | Observação |
| --- | --- | --- |
| `next` (SWC) | baixo | `@next/swc-linux-arm64-gnu` existe |
| `prisma` 7 + `@prisma/adapter-pg` | baixo | `linux-arm64-openssl-3.0.x` existe |
| `@whiskeysockets/baileys` 7 → **`whatsapp-rust-bridge` 0.5.4** | **desconhecido** | binário Rust nativo; o `package-lock.json` não lista pacotes por plataforma, então daqui não dá para saber se o arm64 vem no tarball |

Não migre nada antes de rodar isto numa VM recém-criada (leva 10 minutos):

```bash
sudo apt-get update && sudo apt-get install -y git curl build-essential
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
git clone <seu-repo> solint && cd solint
npm ci
npx prisma generate
node scripts/build-worker.mjs        # esbuild empacota o worker
node -e "import('@whiskeysockets/baileys').then(m => console.log('baileys OK', typeof m.default))"
```

- **Passou** → siga o guia inteiro.
- **Falhou** no `import` do Baileys (erro tipo `.node` não encontrado, `exec
  format error`, `unsupported platform`) → o worker **não roda em ARM**. Plano
  B: site + banco + mídia na Oracle, e o worker continua no Render (ou em
  qualquer host x86). Só o `WORKER_DATABASE_URL` muda, e ele passa a atravessar
  a internet até o banco da Oracle — o que exige abrir a porta 5432 para o IP do
  Render, com TLS obrigatório. É a única saída se o binário não existir.

> As duas micro-VMs AMD (x86) do plano gratuito têm 1 GB de RAM cada — não
> seguram uma sessão do Baileys com folga. Não conte com elas como plano B.

---

## 2. Três decisões antes de abrir o console

### Decisão 1 — região (irreversível)

A **home region** é escolhida no cadastro e **não pode ser trocada depois**, e
os recursos Always Free só existem nela. Para usuários no Brasil:
`sa-saopaulo-1` (São Paulo) ou `sa-vinhedo-1` (Vinhedo).

Vinhedo costuma ter mais capacidade A1 livre que São Paulo, e a diferença de
latência entre as duas é irrelevante. Se São Paulo recusar a criação da VM por
falta de capacidade, você não pode simplesmente mudar de região depois.

### Decisão 2 — onde a mídia do WhatsApp vai morar

Isto **não é opcional**: sem depósito durável, o worker recusa gravar a mídia
recebida e devolve `undefined` em vez de uma URL (ver o bloco
`precisaSerDuravel` em `src/infrastructure/whatsapp/wa-media-store.ts:382`).
Toda foto recebida sumiria em silêncio. Três caminhos:

| Opção | Mudança de código | Custo | Quando escolher |
| --- | --- | --- | --- |
| **A. Manter o Supabase Storage** | nenhuma | grátis até 1 GB | **Comece por aqui.** Só o banco migra; a mídia continua onde está. |
| **B. OCI Object Storage via PAR** | pequena (~20 linhas) | grátis até 20 GB | Quando o 1 GB do Supabase apertar. |
| **C. Volume Docker compartilhado** | pequena (1 variável) | grátis, limitado ao disco | Só com backup do volume resolvido. |

**Opção B, como funciona.** O adaptador em
`src/infrastructure/storage/supabase-storage.ts` faz três chamadas HTTP contra
`{url}/storage/v1/object/{bucket}/{caminho}` com `Authorization: Bearer`. O OCI
Object Storage tem **Pre-Authenticated Request (PAR)**: você cria um PAR de
bucket com permissão de leitura e escrita e recebe uma URL-prefixo onde
`PUT`/`GET`/`DELETE` de `{par}/{caminho}` funcionam **sem assinatura nenhuma**.
Ou seja: troca-se a URL base e removem-se os dois cabeçalhos. Não é preciso
implementar SigV4 nem trazer o SDK da Oracle.

**Opção C, por que é possível aqui.** As três camadas do `wa-media-store`
existem porque hoje o worker roda em outra máquina e o disco dele nunca é lido
por quem serve `/api/whatsapp/media/[id]`. Na Oracle os dois contêineres montam
o **mesmo volume**, então a premissa deixa de valer. A mudança é liberar
`precisaSerDuravel` quando uma variável nova (`SOLINT_MEDIA_LOCAL_DURABLE=1`)
estiver ligada. O preço é que o backup do volume passa a ser obrigatório: o
disco vira fonte da verdade, não cache.

### Decisão 3 — domínio

Você precisa de um domínio (ou subdomínio) apontando para o IP da VM para o
Caddy emitir o certificado. Sem isso, só HTTP em IP puro — o que quebra o
`Strict-Transport-Security` do `next.config.ts` e os cookies de sessão.

---

## 3. Fase 1 — criar a conta e a VM

1. **Cadastro** em <https://cloud.oracle.com>. Pede cartão de crédito para
   verificação (cobrança simbólica, estornada). Escolha a home region da
   Decisão 1.
2. **Instances → Create instance.**
   - *Image*: **Ubuntu 24.04** (confira que é a variante **aarch64**).
   - *Shape*: **Ampere → VM.Standard.A1.Flex** → 4 OCPUs e a RAM que o console
     oferecer no limite gratuito (24 GB no limite clássico; se o seu mostrar
     12 GB, segue igual — cabe, ver §11).
   - *Networking*: criar VCN nova, sub-rede **pública**, **Assign a public IPv4
     address = Yes**.
   - *SSH keys*: cole sua chave pública (`~/.ssh/id_ed25519.pub`). Se não tiver:
     `ssh-keygen -t ed25519`.
   - *Boot volume*: aumente para **100 GB** (o limite gratuito de block storage
     é 200 GB no total, e o boot volume conta).
3. **Se aparecer `Out of host capacity`** — é o erro mais comum do plano
   gratuito, e não é erro seu. Saídas, em ordem:
   - tente outro *Availability Domain* / *Fault Domain*;
   - tente de novo a cada poucas horas (a capacidade rotaciona);
   - **faça upgrade para Pay As You Go**: os recursos Always Free continuam
     gratuitos e contas PAYG têm prioridade de capacidade. É a saída que
     realmente funciona. Configure um *Budget Alert* de US$ 1 para dormir
     tranquilo.
4. **Reserve o IP público** (*Reserved Public IP*) se quiser que o endereço
   sobreviva a uma recriação da VM.
5. Aponte o DNS: registro **A** `crm.seudominio.com.br` → IP da VM.

---

## 4. Fase 2 — preparar o servidor

```bash
ssh ubuntu@SEU_IP

sudo apt-get update && sudo apt-get upgrade -y

# Swap — o build do Next é o pico de memória do sistema.
sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Docker
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu
newgrp docker
```

### O firewall que ninguém lembra (armadilha nº 1 da Oracle)

São **dois** firewalls, e abrir só um deixa a porta fechada sem nenhuma
mensagem de erro:

**(a) Na nuvem** — VCN → Security Lists (ou Network Security Group) → *Add
Ingress Rules*: `0.0.0.0/0`, TCP, portas **80** e **443**.

**(b) Na máquina** — a imagem Ubuntu da Oracle vem com regras `iptables` que só
liberam a 22:

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80  -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

> Não abra a 5432 para o mundo. No `docker-compose.yml` abaixo o Postgres é
> publicado em `127.0.0.1:5432`, acessível só por túnel SSH. E lembre que portas
> publicadas pelo Docker passam pela cadeia `DOCKER-USER`, não pela `INPUT` —
> regras de `ufw` não as bloqueiam.

---

## 5. Fase 3 — os arquivos de deploy

Crie os cinco arquivos abaixo na raiz do repositório.

### `.dockerignore`

```
node_modules
.next
.worker
.git
.media
.env
.env.*
!.env.example
*.log
*.tsbuildinfo
legado
scratchpad
```

### `Dockerfile.web`

```dockerfile
# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY package.json package-lock.json ./
# --ignore-scripts pula o postinstall (prisma generate); ele roda abaixo,
# quando o schema já foi copiado.
RUN npm ci --ignore-scripts

FROM deps AS build
COPY . .
RUN npx prisma generate && npx next build

FROM build AS runtime
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
CMD ["npx", "next", "start", "-p", "3000"]
```

> **Não use `npm run build` aqui.** O script do `package.json` é
> `prisma migrate deploy && prisma generate && next build`, e não existe banco
> durante o `docker build`. A migração roda no deploy, em passo separado (§8).

### `Dockerfile.worker`

```dockerfile
# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim
# O WORKDIR precisa ser IDÊNTICO no build e na execução: scripts/build-worker.mjs
# grava no bundle o caminho ABSOLUTO do cliente Prisma gerado
# (pathToFileURL(process.cwd() + '/src/generated/prisma')). Mudar o diretório
# entre uma coisa e outra faz o worker morrer no boot sem achar o Prisma.
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npx prisma generate && node scripts/build-worker.mjs

ENV NODE_ENV=production PORT=10000
EXPOSE 10000
CMD ["node", ".worker/worker.mjs"]
```

### `docker-compose.yml`

```yaml
services:
  postgres:
    image: postgres:17-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: solint
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?defina no .env}
      POSTGRES_DB: solint
    command: >
      postgres
      -c shared_buffers=2GB
      -c effective_cache_size=6GB
      -c work_mem=16MB
      -c maintenance_work_mem=512MB
      -c max_connections=100
      -c wal_compression=on
    volumes:
      - pgdata:/var/lib/postgresql/data
    ports:
      - "127.0.0.1:5432:5432"   # só via túnel SSH
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U solint -d solint"]
      interval: 10s
      timeout: 5s
      retries: 10

  web:
    build: { context: ., dockerfile: Dockerfile.web }
    restart: unless-stopped
    env_file: .env.production
    depends_on:
      postgres: { condition: service_healthy }
    volumes:
      - media:/app/.media
    expose: ["3000"]
    mem_limit: 3g

  worker:
    build: { context: ., dockerfile: Dockerfile.worker }
    restart: unless-stopped
    env_file: .env.production
    depends_on:
      postgres: { condition: service_healthy }
    volumes:
      - media:/app/.media
    stop_grace_period: 30s      # deixa a sessão do Baileys fechar limpa
    mem_limit: 3g

  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports: ["80:80", "443:443"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on: [web]

volumes:
  pgdata:
  media:
  caddy_data:
  caddy_config:
```

### `Caddyfile`

```
crm.seudominio.com.br {
	encode zstd gzip
	request_body {
		max_size 25MB
	}
	reverse_proxy web:3000 {
		header_up X-Forwarded-Proto {scheme}
	}
}
```

> O `25MB` acompanha o `serverActions.bodySizeLimit: '20mb'` do
> `next.config.ts`. Menor que isso e o envio de vídeo volta a falhar — só que
> agora no proxy, antes de chegar na Server Action.

### `.env.production` (na VM, **nunca** no git)

```bash
NODE_ENV=production

# Banco: as três URLs apontam para o mesmo Postgres local. Some o pooler,
# somem os cuidados das seções 1–3 do .env.example.
POSTGRES_PASSWORD="<senha forte>"
DATABASE_URL="postgresql://solint:<senha>@postgres:5432/solint?connection_limit=10"
DIRECT_URL="postgresql://solint:<senha>@postgres:5432/solint"
WORKER_DATABASE_URL="postgresql://solint:<senha>@postgres:5432/solint?connection_limit=10"

# Segredos — LEIA A NOTA ABAIXO
AUTH_SECRET="<o mesmo de hoje, se quiser manter as sessões abertas>"
WA_ENCRYPTION_KEY="<OBRIGATORIAMENTE o mesmo de hoje>"

WA_ENGINE="worker"
SOLINT_APP_URL="https://crm.seudominio.com.br"
NEXT_PUBLIC_APP_TIMEZONE="America/Sao_Paulo"
WA_LOG_LEVEL="info"

# Opção A da Decisão 2 — mídia continua no Supabase
SUPABASE_URL="https://PROJECT_REF.supabase.co"
SUPABASE_SECRET_KEY="<a mesma de hoje>"
```

> **`WA_ENCRYPTION_KEY` não pode mudar.** Ela é a chave AES-256-GCM que cifra o
> `creds.json` do Baileys guardado no banco. Com uma chave nova, as credenciais
> restauradas viram lixo ilegível e **todas as caixas pedem QR Code de novo**.
> `AUTH_SECRET` é mais barato: trocá-la só desloga todo mundo uma vez.

---

## 6. Fase 4 — migrar o banco do Supabase

Rode o `pg_dump` **dentro de um contêiner da mesma versão do servidor**; um
`pg_dump` mais antigo que o servidor recusa o dump, e é sempre nessa hora que se
descobre.

```bash
# 1. Dump (use a DIRECT_URL de hoje, porta 5432 — modo sessão)
docker run --rm -v "$PWD:/out" postgres:17-alpine \
  pg_dump "postgresql://postgres.PROJ:SENHA@aws-0-REGIAO.pooler.supabase.com:5432/postgres" \
  --schema=public --no-owner --no-privileges --no-comments -Fc -f /out/solint.dump

# 2. Suba só o banco
docker compose up -d postgres

# 3. Restaure
docker compose cp solint.dump postgres:/tmp/solint.dump
docker compose exec postgres pg_restore -U solint -d solint \
  --no-owner --no-privileges /tmp/solint.dump

# 4. Confirme que o schema está na última migração
docker compose run --rm --no-deps web npx prisma migrate deploy
```

O passo 4 deve responder *"No pending migrations"* — o dump trouxe a tabela
`_prisma_migrations` junto. Se ele tentar aplicar tudo do zero, o restore não
funcionou: pare e investigue antes de seguir.

**Conferência rápida:**

```bash
docker compose exec postgres psql -U solint -d solint -c \
  'select count(*) from "Message"' -c 'select count(*) from "Conversation"'
```

Compare com o Supabase. Números diferentes = restore incompleto.

---

## 7. Fase 5 — primeiro boot

```bash
docker compose build            # ~10-15 min na primeira vez (ARM, sem cache)
docker compose up -d
docker compose ps               # todos 'running'; postgres 'healthy'
docker compose logs -f caddy    # deve emitir o certificado em segundos
docker compose logs -f worker   # deve restaurar a sessão SEM pedir QR
```

**Checklist de validação — nesta ordem:**

1. `https://crm.seudominio.com.br` abre com cadeado válido.
2. Login funciona (se manteve o `AUTH_SECRET`, a sessão antiga até sobrevive).
3. `/configuracoes` carrega rápido — é a tela que mais sofria com a latência do
   pooler, e por isso é o termômetro do ganho.
4. **O worker não pediu QR Code.** Se pediu, a `WA_ENCRYPTION_KEY` está errada.
   Pare e corrija antes de parear de novo.
5. Envie uma mensagem de texto pelo CRM → chega no WhatsApp.
6. Receba uma **imagem** no WhatsApp → aparece na conversa. Este é o teste da
   Decisão 2; se a imagem não aparece, procure
   `[wa-media-store] Mídia ... não pôde ser guardada de forma durável` nos logs.
7. Envie um **vídeo** pelo CRM (testa o limite de 25 MB do Caddy).
8. Só então desligue Vercel e Render.

---

## 8. Fase 6 — rotina de deploy

O ponto central: **site e worker sobem separados**, e o comando é a garantia.

```bash
cd /opt/solint && git pull

# Só o site (não encosta no worker nem nas sessões de WhatsApp):
docker compose build web && docker compose up -d --no-deps web

# Worker (só quando mudar o motor de WhatsApp, banco ou rotinas dele):
docker compose build worker && docker compose up -d --no-deps worker

# Migração de banco (passo explícito, nunca dentro do build):
docker compose run --rm --no-deps web npx prisma migrate deploy
```

O `--no-deps` é o que impede o `compose` de reiniciar `postgres` e `worker`
junto com o `web`. Sem ele, todo deploy do site derruba a sessão do WhatsApp —
exatamente o que o `DEPLOY-WHATSAPP-WORKER.md` evitou no Render.

Ordem segura quando há migração: `migrate deploy` primeiro (migrações
aditivas), depois `build`/`up` do `web`.

---

## 9. Fase 7 — backup e monitoramento

### Backup do banco (obrigatório — agora o banco é seu)

`/opt/solint/backup.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
DEST=/opt/backups
STAMP=$(date +%F)
mkdir -p "$DEST"
docker compose -f /opt/solint/docker-compose.yml exec -T postgres \
  pg_dump -U solint -Fc solint > "$DEST/solint-$STAMP.dump"
find "$DEST" -name 'solint-*.dump' -mtime +14 -delete
# Cópia fora da máquina — 20 GB grátis no OCI Object Storage:
oci os object put -bn solint-backups --file "$DEST/solint-$STAMP.dump" --force
```

```bash
chmod +x /opt/solint/backup.sh
(crontab -l 2>/dev/null; echo "0 3 * * * /opt/solint/backup.sh >> /var/log/solint-backup.log 2>&1") | crontab -
```

**Backup local não é backup.** Se escolheu a Opção C da Decisão 2, o volume
`media` entra no mesmo ritual:

```bash
docker run --rm -v solint_media:/m -v /opt/backups:/b alpine \
  tar czf /b/media-$(date +%F).tgz -C /m .
```

Adicione também uma *Backup Policy* no Block Volume pelo console da Oracle
(snapshot semanal automático) — cinturão e suspensório.

### Monitoramento mínimo

- `restart: unless-stopped` já religa contêiner que morre.
- Um monitor externo grátis (UptimeRobot, Better Stack) batendo na página de
  login a cada 5 min avisa quando a VM cair.
- `docker compose logs --tail=200 worker` é o primeiro lugar a olhar em
  qualquer problema de WhatsApp.
- `docker system prune -af --filter "until=168h"` no cron semanal, ou o disco
  enche de imagens antigas de build.

---

## 10. Armadilhas específicas da Oracle Free Tier

1. **`Out of host capacity`** no A1 — o obstáculo mais comum. Ver §3.3.
2. **Dois firewalls.** VCN *e* `iptables` na máquina. Ver §4.
3. **Home region é definitiva.** Recursos Always Free só existem nela.
4. **Recuperação de instâncias ociosas.** Contas *Always Free* podem ter
   instâncias reclamadas após ~7 dias de uso baixo (CPU muito baixa, rede
   baixa). Um CRM com worker de WhatsApp ligado não fica ocioso, mas se isso
   preocupa, o upgrade para PAYG remove a política.
5. **ARM64.** Toda imagem Docker precisa ter tag `arm64`. `postgres`, `caddy` e
   `node` têm. Uma imagem de terceiro sem arm64 falha com `exec format error`.
6. **O IP efêmero muda** se a instância for terminada e recriada. Reserve o IP
   ou aceite reapontar o DNS.
7. **Confirme os limites no console.** A Oracle já mudou os números do plano
   gratuito mais de uma vez; trate os valores deste guia como referência, não
   como contrato.

---

## 11. Orçamento de memória

Com 12 GB (o pior caso do que o console pode oferecer):

| Serviço | Reservado | Observação |
| --- | --- | --- |
| `postgres` | ~3 GB | `shared_buffers=2GB` + conexões |
| `web` | ~1,5 GB | `mem_limit: 3g` cobre picos |
| `worker` | ~1,5 GB | ~200–400 MB por sessão de WhatsApp ativa |
| `caddy` | ~50 MB | |
| Sistema + build | ~2 GB | o `next build` é o pico |
| **Folga** | **~4 GB** | cabe o n8n, se quiser trazê-lo |

Com 24 GB, sobra espaço para subir `shared_buffers` para 4 GB e hospedar o n8n
confortavelmente no mesmo host.

Limites relevantes do plano gratuito (confira no console): 4 OCPU + até 24 GB de
Ampere A1, 200 GB de block storage no total, 20 GB de Object Storage e 10 TB/mês
de tráfego de saída.

---

## 12. Ordem recomendada de execução

1. Fase 0 — teste de ARM numa VM descartável. **Nada continua sem isso.**
2. Fases 1–2 — VM definitiva, firewall, Docker, swap.
3. Fase 3 — arquivos de deploy commitados no repositório.
4. Fase 4 — banco migrado, **com Vercel e Render ainda no ar**.
5. Fase 5 — validação completa num domínio de teste
   (`crm-novo.seudominio.com.br`).
6. Cortar o DNS do domínio real.
7. Fases 6–7 — rotina de deploy, backup e monitoramento.
8. Depois de uma semana estável, desligar Vercel e Render.
