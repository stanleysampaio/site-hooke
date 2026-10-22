#!/usr/bin/env bash
# Roda o pipeline num container Node 22: o Node instalado na EC2 é o 14 (do
# sistema) e não deve ser trocado. A EC2 é do ERP (2 GB de RAM, 1 CPU, containers
# sem limite), então o gerador fica sempre em segundo plano:
#   --memory 512m + heap do Node em 384 MB  -> teto de memória bem abaixo do livre
#   --oom-score-adj 1000                    -> se faltar memória, o kernel mata ele, não o ERP
#   --cpus 0.5 + --cpu-shares 256           -> no máximo meio núcleo e prioridade menor que o ERP
# O flock impede duas execuções ao mesmo tempo (diária + pedido do painel) e é
# liberado sozinho se o processo cair.
#
#   deploy/run.sh                 execução normal
#   deploy/run.sh --if-requested  só roda se houver pedido do painel
#   deploy/run.sh install         instala/atualiza as dependências
set -euo pipefail
cd "$(dirname "$0")/.."

IMAGE=node:22-slim
DOCKER=(docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp \
  -e NODE_OPTIONS=--max-old-space-size=384 \
  --memory=512m --memory-swap=512m --oom-score-adj=1000 \
  --cpus=0.5 --cpu-shares=256 \
  -v "$PWD":/app -w /app)

if [ "${1:-}" = "install" ]; then
  exec "${DOCKER[@]}" "$IMAGE" npm ci --omit=dev --no-audit --no-fund
fi

mkdir -p data
exec flock -n /tmp/hooke-news-pipeline.lock "${DOCKER[@]}" "$IMAGE" node src/run.js "$@"
