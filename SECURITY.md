# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in bridge-tracker, please report it
privately rather than opening a public issue.

**Preferred channel:** [GitHub Security Advisories](https://github.com/t-harper/brickell-bridge-tracker/security/advisories/new)
— click "Report a vulnerability".

This is a personal side project, so there's no formal SLA. Realistic
expectations:

- Acknowledgement within 7 days.
- A fix or written triage decision within 30 days for high-severity issues.
- Coordinated disclosure on request.

## Scope

In scope:
- The TypeScript Lambda handlers (`packages/poller`, `packages/api`).
- The React frontend (`packages/frontend`).
- The Terraform infrastructure (`infra/`).
- The CI/CD pipeline (`.github/workflows/`, `.github/dependabot.yml`).

Out of scope:
- Vulnerabilities in upstream FL511 (not under our control).
- Volumetric DoS against the public stats endpoints.
- Issues fixed in `main` that still exist in older commits.

## Defensive layers already in place

For context (and to save you time if you're considering reporting an issue):

- GitHub-native: secret scanning + push protection, Dependabot alerts +
  automated security fixes, code scanning (CodeQL).
- Workflows: `gitleaks` secret-scan, Checkov IaC scan, `npm audit` gate
  on every deploy, `dependency-review-action` on PRs, OpenSSF Scorecard.
- AWS: OIDC-only GitHub Actions auth into resource-scoped IAM roles;
  separate `apply` (main only) and `plan` (PRs, read-only) roles.
