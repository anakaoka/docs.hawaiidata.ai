# docs.hawaiidata.ai

Secure, multi-tenant document intelligence platform for regulated, document-heavy workflows.

Live site: <https://docs.hawaiidata.ai/>

## Why This Exists

Document-heavy, compliance-driven workflows lose time and accuracy when files sit in unsearchable PDFs and shared drives. docs.hawaiidata.ai turns uploaded documents into structured, searchable data with AI extraction, natural-language search, secure delivery links, and full audit trails.

## Capabilities

- Upload PDFs and other documents into tenant-isolated workspaces.
- Extract document text and structured data with OpenAI.
- Search documents with natural-language queries.
- Generate secure, expiring download links for search results.
- Track uploads, views, searches, profile changes, downloads, and other activity in audit logs.
- Support password login, Google OAuth, Microsoft OAuth, and a Twilio Verify SMS demo.
- Show tenant, token usage, audit, document, upload, search, suggestions, and settings dashboards.

## Industries Served

| Industry | Examples |
|---|---|
| Title & escrow | Lien detection, chain of title, easements, property timelines |
| Medical billing | Daily scans, keyword validation, invoice standardization |
| Legal / contract review | Clause extraction, obligation/deadline tracking |
| Construction | Contract and subcontract tracking, change orders, permits |
| Insurance claims | Claim review, missing-doc detection, policy extraction |
| Accounting / audit | Financial document organization, invoice validation |

## Repository Contents

This repo now contains both the recovered application source and operational documentation for bringing the service back later.

- App source: Express/EJS/PostgreSQL app at the repo root.
- `config/schema.sql`: PostgreSQL schema.
- `infra/`: captured systemd and nginx config for the app.
- `docs/restore.md`: app-focused rebuild runbook.
- `docs/server-inventory.md`: app server inventory captured from the live host.
- `servers/`: per-server operational docs and snapshot notes from the server-documentation pass.
- `scripts/`: operational scripts such as server snapshot capture.

Runtime secrets, uploaded documents, session rows, generated search-token files, `node_modules`, and old one-off onboarding scripts with initial passwords are intentionally not committed.

## Live Server Snapshot

This repository was reconstructed from the live server at `/var/www/docs.hawaiidata.ai` on April 27, 2026.

- Hostname: `docs`
- Public IP: intentionally omitted from git
- OS: Ubuntu 25.10
- Node.js: `v20.19.4`
- npm: `9.2.0`
- PostgreSQL: `17.9`
- nginx: `1.28.0`
- Certbot: `4.0.0`
- App process: systemd service `docs-hawaiidata.service`
- App port: `3000`, proxied by nginx on `80` and `443`
- Database: `docs_hawaiidata`

## Restore Overview

1. Provision Ubuntu with Node.js 20, npm, PostgreSQL 17, nginx, Certbot, fail2ban, ufw, and watchdog.
2. Clone this repo to `/var/www/docs.hawaiidata.ai`.
3. Copy `.env.example` to `.env` and fill in real secrets.
4. Run `npm ci` or `npm install`.
5. Create PostgreSQL user/database and load `config/schema.sql`.
6. Install `infra/docs-hawaiidata.service` into `/etc/systemd/system/`.
7. Install `infra/nginx-docs.hawaiidata.ai.conf` into nginx sites and issue a Let's Encrypt cert.
8. Start the service and run `npm test`.

Detailed recovery notes live in [docs/restore.md](docs/restore.md). The broader server documentation is in [servers/hawaii-01/](servers/hawaii-01/).

## Local Development

```bash
cp .env.example .env
npm install
createdb docs_hawaiidata
psql docs_hawaiidata < config/schema.sql
npm run dev
```

The app defaults to `PORT=3000`.

## Verification

```bash
npm run check
npm test
```

`npm test` runs public smoke checks by default. Set `TEST_ADMIN_EMAIL` and `TEST_ADMIN_PASSWORD` to include the authenticated dashboard flow.
