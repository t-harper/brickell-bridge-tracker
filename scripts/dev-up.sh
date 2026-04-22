#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "[1/4] starting Floci..."
podman-compose up -d

echo "[2/4] waiting for Floci to be ready on :4566..."
for i in {1..30}; do
  if curl -sf http://localhost:4566/_floci/health >/dev/null 2>&1 \
     || curl -sf http://localhost:4566/ >/dev/null 2>&1; then
    echo "  ok"
    break
  fi
  sleep 1
done

echo "[3/4] building Lambda bundles..."
npm run bundle

echo "[4/4] applying Terraform to Floci..."
cd infra
terraform init -input=false
terraform apply -input=false -auto-approve -var-file=envs/local.tfvars
cd ..

echo
echo "Ready. Run 'npm run dev' to start the poller + API + frontend."
