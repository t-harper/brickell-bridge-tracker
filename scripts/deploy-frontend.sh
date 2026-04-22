#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ "${FLOCI:-0}" == "1" ]]; then
  ENDPOINT_ARG="--endpoint-url http://localhost:4566"
  BUCKET="${FRONTEND_BUCKET:-bridge-tracker-frontend-local}"
  export AWS_ACCESS_KEY_ID=test
  export AWS_SECRET_ACCESS_KEY=test
  export AWS_REGION="${AWS_REGION:-us-east-1}"
else
  ENDPOINT_ARG=""
  BUCKET="${FRONTEND_BUCKET:?Set FRONTEND_BUCKET}"
fi

npm run build --workspace=@bridge-tracker/frontend
aws $ENDPOINT_ARG s3 sync packages/frontend/dist/ "s3://${BUCKET}/" --delete
echo "synced to s3://${BUCKET}/"
