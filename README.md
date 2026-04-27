# docs.hawaiidata.ai

Secure document intelligence platform — upload documents, extract data with AI,
search with natural language, and maintain full audit trails. Built for
regulated industries (title & escrow, medical billing, legal, construction,
insurance, accounting) that demand traceability.

Live site: <https://docs.hawaiidata.ai/>

## Why this exists

Document-heavy, compliance-driven workflows lose time and accuracy when files
sit in unsearchable PDFs and shared drives. We built docs.hawaiidata.ai to:

- Turn unstructured documents (PDF, TIFF, etc.) into structured, searchable
  data via OCR + AI extraction.
- Let people search the way they think — "show liens on this property" —
  instead of by filename.
- Keep a full audit trail (uploads, views, searches, report generation) so
  every extracted value links back to source document, page, timestamp, and
  the model that produced it.
- Deliver reports through secure, expiring links rather than email
  attachments, with tenant-level isolation.

## Capabilities

- **Document intelligence** — upload PDF/TIFF/etc., automatic OCR and
  extraction.
- **Natural-language search** — intent-aware search across all documents.
- **Automated reports** — title reports, summaries, billing validation; shared
  via secure expiring links.
- **Full audit trail** — login, upload, view, search, download all recorded
  with timestamps, user IDs, and metadata.
- **Security** — HTTPS in transit, encryption at rest, optional Twilio SMS 2FA,
  tenant-level data isolation.

## Industries served

| Industry | Examples |
|---|---|
| Title & escrow | Lien detection, chain of title, easements, property timelines |
| Medical billing | Daily scans, keyword validation, invoice standardization |
| Legal / contract review | Clause extraction, obligation/deadline tracking |
| Construction | Contract & subcontract tracking, change orders, permits |
| Insurance claims | Claim review, missing-doc detection, policy extraction |
| Accounting / audit | Financial doc organization, invoice validation |

## How it works

1. **Upload** — PDF, TIFF, or other formats through the secure interface.
2. **Extract** — OCR and AI pull text, metadata, and structured data.
3. **Search** — natural-language queries across the corpus.
4. **Deliver** — reports shared via secure, expiring, audited links.

## Repository contents

This is a public repository, so it holds only non-sensitive material.

- [`scripts/capture-server.sh`](scripts/capture-server.sh) — generic snapshot
  tool for documenting and deprecating a Linux server. Captures host,
  network, packages, services, web/TLS configs, database metadata,
  containers, and filesystem layout into a tarball; intentionally excludes
  private keys, `.env` values, and database dumps.

Operational documentation (server inventory, service map, restore runbooks,
secrets index) lives in a **private** location and is **not** published here.
