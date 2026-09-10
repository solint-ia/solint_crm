# Deploy na Oracle Cloud — uma VM, tudo junto

```
internet ──443──▶ caddy ──▶ web (Next)  ─┐
                                        ├──▶ postgres (só na VM)
                  worker (WhatsApp) ────┘
web e worker ──▶ OCI Object Storage (mídia, por URL pré-autenticada)
```

Arquivos: `Dockerfile` (alvos `web` e `worker`), `docker-compose.yml`, `deploy/Caddyfile`,
`deploy/env.production.example`, `deploy/backup.sh`, `deploy/copy-storage.mjs`.

Pré-requisito: a VM preparada (Docker, swap, portas 80/443 nos dois firewalls) e o
repositório clonado em `/opt/solint`.

---

## 1. Object Storage (console da Oracle)

**Armazenamento → Buckets → Criar Bucket**, duas vezes, ambos com *Standard* e
visibilidade **privada**:

| Bucket | Solicitação pré-autenticada (PAR) | Vai para |
| --- | --- | --- |
| `solint-media` | Destino **Bucket**, acesso **"Permitir leituras e gravações de objetos"**, **sem** listagem | `OBJECT_STORAGE_PAR_URL` |
| `solint-backups` | Destino **Bucket**, acesso **"Permitir gravações de objetos"** (só gravar) | `BACKUP_PAR_URL` |

Para cada bucket: abra-o → **Solicitações Pré-Autenticadas** → **Criar**, com validade
longa (ex.: 5 anos) — e **anote a data de vencimento**. A URL (termina em `/o/`)
**só aparece uma vez**: copie na hora. Ela é um segredo — quem a tem lê e grava o bucket.

A PAR de backups é só de gravação de propósito: se a VM for comprometida, ela não
serve para ler os backups antigos.

## 2. Congelar a produção antiga (antes de reativar o Supabase)

**Render → serviço do worker → Settings → Suspend Service.**

Quando o Supabase voltar, o worker do Render reconecta sozinho e retoma as sessões
do WhatsApp. Com ele e o da Oracle usando as mesmas credenciais, os dois se derrubam
(código 440), e o que ele gravar no Supabase depois do dump se perde. Pelo mesmo
motivo, não use o site da Vercel durante a migração.

## 3. Reativar o Supabase (só para a migração)

1. No painel do Supabase, abra o projeto pausado → **Restore project**. Leva alguns
   minutos.
2. **Connect → Session pooler**: copie a string (porta **5432**,
   usuário `postgres.<ref>`). Use o *pooler*, não o *direct*: a conexão direta do
   Supabase é só IPv6 e a VM só tem IPv4. Se a senha tiver caracteres especiais,
   codifique-os na URL (`@` → `%40`, `#` → `%23`).
3. **Project Settings → API Keys**: a URL do projeto e a chave secreta (`sb_secret_...`).

Traga também do **painel do Render** (worker → Environment) os valores de
`AUTH_SECRET` e `WA_ENCRYPTION_KEY`.

## 4. `.env` na VM

```bash
cd /opt/solint && git pull
cp deploy/env.production.example .env && chmod 600 .env

# Senha do Postgres (em POSTGRES_PASSWORD e nas três URLs de uma vez):
sed -i "s/TROQUE/$(openssl rand -hex 24)/g" .env

# Endereço sslip.io a partir do IP público da VM:
sed -i "s/129-146-10-20\.sslip\.io/$(curl -s https://ifconfig.me | tr . -).sslip.io/g" .env

nano .env   # preencha AUTH_SECRET, WA_ENCRYPTION_KEY, OBJECT_STORAGE_PAR_URL, BACKUP_PAR_URL
grep -E '^(SITE_ADDRESS|SOLINT_APP_URL)=' .env   # confira o endereço
```

## 5. Imagens (10–15 min na primeira vez)

```bash
docker compose build
```

## 6. Banco: Supabase → VM

```bash
sudo mkdir -p /opt/backups && sudo chown ubuntu:ubuntu /opt/backups

# 6.1 Dump (cole a string do Session pooler entre as aspas simples)
SUPA='postgresql://postgres.REF:SENHA@aws-0-REGIAO.pooler.supabase.com:5432/postgres'
docker run --rm -v /opt/backups:/out postgres:17-alpine \
  pg_dump "$SUPA" --schema=public --no-owner --no-privileges -Fc -f /out/supabase.dump
ls -lh /opt/backups/supabase.dump

# 6.2 Sobe só o banco e restaura
docker compose up -d postgres
docker compose exec -T postgres pg_restore -U solint -d solint \
  --no-owner --no-privileges < /opt/backups/supabase.dump
```

O `pg_restore` pode terminar com *"errors ignored on restore"*. Aviso sobre
`schema "public" already exists` ou sobre papéis do Supabase (`anon`,
`authenticated`, `service_role`) é esperado e inofensivo. Qualquer outro, pare e
investigue.

```bash
# 6.3 Aplica por cima dos dados as migrações que o Supabase não recebeu
docker compose run --rm --no-deps web node_modules/.bin/prisma migrate deploy

# 6.4 Confere (compare com o que você esperava ver)
docker compose exec postgres psql -U solint -d solint \
  -c 'select count(*) as mensagens from "Message"' \
  -c 'select count(*) as conversas from "Conversation"' \
  -c 'select name from "Inbox"'
```

A ordem do 6.2 → 6.3 importa: migrações como a da pausa de 10 minutos alteram
**dados** existentes, e precisam rodar depois que os dados chegaram.

## 7. Mídia: Supabase Storage → Object Storage

```bash
docker run --rm --env-file .env \
  -e SUPABASE_URL='https://REF.supabase.co' -e SUPABASE_SECRET_KEY='sb_secret_...' \
  -v /opt/solint/deploy:/deploy:ro node:22-bookworm-slim node /deploy/copy-storage.mjs
```

Termina com a contagem por bucket. Se algo falhar, rode de novo: o que já foi
copiado é sobrescrito, e o que faltou é completado.

## 8. Subir e validar

```bash
docker compose up -d
docker compose ps                 # postgres e worker "healthy" (o worker leva ~1 min)
docker compose logs -f caddy      # certificado emitido em segundos
docker compose logs -f worker     # sessões restauradas — idealmente sem pedir QR
```

Nesta ordem:

1. `https://<ip-com-hífens>.sslip.io` abre com cadeado válido, e o login funciona.
2. **O worker não pediu QR.** Se pediu para todas as caixas, a `WA_ENCRYPTION_KEY`
   não é a mesma do Render — corrija antes de parear de novo. Se pediu só para
   algumas, o WhatsApp pode ter desconectado o aparelho enquanto a produção estava
   parada: pareie de novo essas caixas.
3. Imagens **antigas** de conversas aparecem (a cópia do passo 7 funcionou).
4. Mande uma mensagem pelo CRM → chega no WhatsApp.
5. Receba uma **imagem** → aparece na conversa (a gravação no Object Storage funcionou).
6. Envie um vídeo pelo CRM (o limite de 25 MB do Caddy).

## 9. Backup diário

```bash
bash deploy/backup.sh     # primeira execução, à mão, para ver funcionar
(crontab -l 2>/dev/null; echo "0 3 * * * /bin/bash /opt/solint/deploy/backup.sh >> /opt/backups/backup.log 2>&1") | crontab -
```

## 10. Rotina de deploy

```bash
cd /opt/solint && git pull

# Site — não encosta no worker nem nas sessões do WhatsApp:
docker compose build web \
  && docker compose run --rm --no-deps web node_modules/.bin/prisma migrate deploy \
  && docker compose up -d --no-deps web

# Worker — só quando mudar o motor do WhatsApp ou algo que ele usa:
docker compose build worker && docker compose up -d --no-deps worker
```

O `--no-deps` é o que impede o compose de reiniciar o `postgres` e o `worker` junto.
`docker system prune -af --filter "until=168h"` de vez em quando, ou o disco enche
de imagens antigas.

## 11. Depois da migração

- **Domínio definitivo**: aponte um registro A para o IP da VM, troque `SITE_ADDRESS`
  e `SOLINT_APP_URL` no `.env` e rode `docker compose up -d caddy web`.
- **GitHub → Actions → "Deploy WhatsApp worker" → Disable workflow.** Ele ainda chama
  o deploy do Render a cada push.
- Deixe o Supabase quieto por uma semana como rede de segurança (ele volta a pausar
  sozinho), e só então apague o projeto, o serviço do Render e o projeto da Vercel.
