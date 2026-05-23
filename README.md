# Bridge Tracker — Brickell Avenue Bridge (Miami)

Tracks the live up/down status of the Brickell Avenue Bridge by polling [FL511](https://fl511.com/list/bridge), records status-change history, and serves it to a React frontend.

**Stack:** TypeScript • AWS Lambda + API Gateway • DynamoDB + S3 • EventBridge • React + Vite • Terraform • Podman + [Floci](https://floci.io/) (local AWS emulator).

## Prerequisites

- Node.js 20+
- Podman + podman-compose, with the rootless podman socket running
  (`systemctl --user enable --now podman.socket`)
- Terraform
- AWS CLI (for poking at Floci directly)

Floci uses real containers for Lambda and reads its Docker-compatible socket
from the host; rootless podman's socket is mounted in `podman-compose.yml`.

## Quick start (local)

```sh
# 1. start Floci (local AWS emulator) on :4566
podman-compose up -d

# 2. install deps, bundle Lambda artifacts
npm install
npm run bundle

# 3. apply local infra to Floci
cd infra
terraform init
terraform apply -var-file=envs/local.tfvars -auto-approve
cd ..

# 4. run the in-process poller + frontend
npm run dev
```

Open http://localhost:5173 — you should see the current bridge status. The poller ticks once a minute and writes state to Floci's DynamoDB + S3.

You can also exercise the deployed Lambda directly:

```sh
AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test AWS_REGION=us-east-1 \
  aws --endpoint-url http://localhost:4566 lambda invoke \
  --function-name bridge-tracker-poller-local \
  --payload '{}' --cli-binary-format raw-in-base64-out /tmp/out.json && cat /tmp/out.json
```

## Floci notes

- Lambdas reach Floci via `host.containers.internal:4566` (Floci's Lambda
  containers run on a different podman network from the Floci service
  container). See `infra/lambda.tf`.
- `aws_apigatewayv2_api` updates fail on Floci with a 405 — fine to ignore on
  repeat `terraform apply` runs; creation works and routes are reachable.
- Lambda bundles are uploaded via an S3 artifacts bucket (Floci's Lambda
  service reads zips from S3, not from a host path).

## Deploy to real AWS

**Automatic** — push to `main` triggers `.github/workflows/deploy.yml`, which:
typechecks → tests → bundles the Lambdas → builds the frontend →
`terraform apply` → syncs the SPA to S3 → invalidates CloudFront. PR builds
run `plan.yml` and post the plan as a comment.

GitHub Actions authenticates via OIDC into two IAM roles:
- `bridge-tracker-gha-apply` — trusted only from `refs/heads/main`
- `bridge-tracker-gha-plan`  — trusted only from `pull_request` events
  (`ReadOnlyAccess` + state bucket + lock table)

Remote state lives in `s3://bridge-tracker-tfstate-831473839640/env:/prod/`
with locking in DynamoDB table `bridge-tracker-tflock`.

**Manual** (same workflow, from your laptop):

```sh
cd infra
terraform init
terraform workspace select prod
terraform apply -var-file=envs/prod.tfvars
```

**Local floci dev** — the S3 backend is hardcoded for CI. For floci, init
against a throwaway local state file:

```sh
cd infra
terraform init -backend=false
terraform apply -var-file=envs/local.tfvars
```

## Inspect state

```sh
# Current state
aws --endpoint-url http://localhost:4566 dynamodb get-item \
  --table-name bridge-tracker-current-local \
  --key '{"pk":{"S":"BRICKELL"}}'

# Recent polls
aws --endpoint-url http://localhost:4566 s3 ls \
  s3://bridge-tracker-history-local/polls/brickell/ --recursive

# Status-change events
aws --endpoint-url http://localhost:4566 s3 ls \
  s3://bridge-tracker-history-local/events/brickell/ --recursive
```

## Layout

- `packages/shared` — typed contracts (`BridgeState`, `BridgeEvent`, `FL511Bridge`).
- `packages/poller` — Lambda that polls FL511 every minute, updates current state, appends history, sends Live Activity pushes on status changes.
- `packages/api` — Lambda behind API Gateway HTTP API v2 serving `/api/bridges/brickell/{status,history,stats}` and `/api/devices/…` registration.
- `packages/frontend` — React + Vite SPA.
- `ios/` — native SwiftUI app, Live Activities, widgets, App Intents, MapKit (see `ios/README.md`).
- `infra/` — Terraform module (single root, Floci-or-real-AWS switch, optional APNs wiring).
- `scripts/` — dev and deploy helpers.
