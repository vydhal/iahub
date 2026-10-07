#!/usr/bin/env bash
# Backup do banco (pg_dump formato custom) e do storage de mídia (uploads, capturas de RPA, logo da plataforma).
# Uso: scripts/backup.sh
set -euo pipefail
cd "$(dirname "$0")/.."

STAMP=$(date +%Y%m%d_%H%M%S)
OUT="backups/$STAMP"
mkdir -p "$OUT"

echo "→ Banco de dados..."
docker exec ai_creative_postgres pg_dump -U postgres -Fc aicreativestudio > "$OUT/database.dump"

echo "→ Storage (mídia, capturas de RPA, logo)..."
if [ -d backend/storage ]; then
  tar -czf "$OUT/storage.tar.gz" -C backend storage
else
  echo "  (backend/storage não existe ainda — nada para compactar)"
fi

echo "✅ Backup salvo em $OUT"
du -sh "$OUT"/* 2>/dev/null || true

# Mantém só os 14 backups mais recentes (ajuste conforme a retenção desejada).
ls -1dt backups/*/ 2>/dev/null | tail -n +15 | xargs -r rm -rf
