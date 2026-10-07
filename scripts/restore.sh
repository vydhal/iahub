#!/usr/bin/env bash
# Restaura um backup gerado por scripts/backup.sh. SUBSTITUI o banco e o storage atuais.
# Uso: scripts/restore.sh backups/20261007_120000
set -euo pipefail
cd "$(dirname "$0")/.."

DIR="${1:?Uso: scripts/restore.sh backups/AAAAMMDD_HHMMSS}"
[ -f "$DIR/database.dump" ] || { echo "Não achei $DIR/database.dump"; exit 1; }

echo "⚠️  Isso substitui o banco de dados e o storage de mídia atuais pelo conteúdo de $DIR."
read -r -p "Digite 'sim' para confirmar: " CONFIRM
[ "$CONFIRM" = "sim" ] || { echo "Cancelado."; exit 1; }

echo "→ Restaurando banco de dados..."
docker exec -i ai_creative_postgres pg_restore -U postgres -d aicreativestudio --clean --if-exists < "$DIR/database.dump"

if [ -f "$DIR/storage.tar.gz" ]; then
  echo "→ Restaurando storage..."
  rm -rf backend/storage
  tar -xzf "$DIR/storage.tar.gz" -C backend
fi

echo "✅ Restaurado de $DIR. Reinicie o backend: docker compose restart backend"
