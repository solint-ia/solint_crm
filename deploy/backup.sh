#!/usr/bin/env bash
# Backup do Postgres: 14 dias na VM + cópia fora dela (bucket de backups).
#
# Agendar (todo dia às 3h):
#   (crontab -l 2>/dev/null; echo "0 3 * * * /bin/bash /opt/solint/deploy/backup.sh >> /opt/backups/backup.log 2>&1") | crontab -
#
# Restaurar um dump:
#   docker compose exec -T postgres pg_restore -U solint -d solint --clean --if-exists < arquivo.dump
set -euo pipefail

cd "$(dirname "$0")/.."
DEST=/opt/backups
STAMP=$(date +%F-%H%M)
FINAL="$DEST/solint-$STAMP.dump"
mkdir -p "$DEST"

# Grava num temporário e só renomeia no fim: um dump interrompido nunca fica
# com cara de backup válido.
docker compose exec -T postgres pg_dump -U solint -Fc solint > "$FINAL.tmp"
mv "$FINAL.tmp" "$FINAL"
find "$DEST" -name 'solint-*.dump' -mtime +14 -delete

# Lido do .env sem `source`: as URLs têm `?` e `&`, que o shell interpretaria.
BACKUP_PAR_URL=$(grep -E '^BACKUP_PAR_URL=' .env | head -1 | cut -d= -f2- || true)
if [ -n "$BACKUP_PAR_URL" ]; then
  curl --fail --silent --show-error --retry 3 -X PUT \
    --data-binary @"$FINAL" "${BACKUP_PAR_URL%/}/$(basename "$FINAL")"
  echo "$(date -Is) backup ok, local e no bucket: $(basename "$FINAL")"
else
  echo "$(date -Is) backup ok, SÓ local (BACKUP_PAR_URL vazio): $(basename "$FINAL")"
fi
