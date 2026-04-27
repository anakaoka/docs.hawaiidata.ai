# Secrets — hawaii-01

**Nothing in this file is a secret.** This is the index of *what* is sensitive
on the server and *where* the actual values live (outside this repo).

## Rule

Secrets do not go in git. Period. The capture script is built to skip them,
but always verify before committing a snapshot. If you find a secret in a
committed snapshot, rotate it immediately and rewrite history.

## What's sensitive

| Item | Where on the server | Storage location for values |
|---|---|---|
| Public IP / hostname | n/a (public) | Treated as sensitive because this repo is public; values live in the password manager |
| SSH host private keys | `/etc/ssh/ssh_host_*_key` | New host generates fresh; old fingerprints recorded in restore log |
| SSH user private keys | `/root/.ssh/id_*`, `/home/*/.ssh/id_*` | Per-user password manager |
| Let's Encrypt private keys | `/etc/letsencrypt/live/*/privkey.pem` | Reissued on restore (preferred), or encrypted backup |
| Let's Encrypt account key | `/etc/letsencrypt/accounts/*/private_key.json` | Encrypted backup (avoids rate-limit hassle) |
| Application `.env` values | paths in `snapshots/<date>/env/files-found.txt` | Password manager / 1Password / Bitwarden vault |
| Database credentials | inside `.env` and `pg_hba.conf` | Password manager |
| API keys (OpenAI, Twilio, etc.) | inside `.env` | Password manager |
| OAuth client secrets | inside `.env` | Password manager |
| Database dumps | not on disk; must be exported on demand | Encrypted off-server storage (S3 + KMS, Backblaze B2, etc.) |
| Backup encryption keys | not on the server itself | Hardware token / offline backup |

## Variable names captured

The capture script records the *names* of environment variables (with values
redacted) under `snapshots/<date>/env/redacted-keys.txt`. Use that list as a
checklist when populating the secret store: every key listed there needs a
corresponding entry in your password manager.

## Recommended secret store layout

Create a vault item per service / `.env` file. Suggested naming:

```
hawaii-01 / <service-name> / .env
hawaii-01 / postgres / superuser
hawaii-01 / letsencrypt / account-key
hawaii-01 / ssh / host-keys (fingerprints + tarball)
hawaii-01 / backups / encryption-key
```

## Pre-deprecation export procedure

1. For each `.env` file in `env/files-found.txt`:
   - SSH to server, `cat` the file.
   - Create a corresponding password-manager entry, paste the contents.
   - Verify retrievable from another device.
2. Export `/etc/letsencrypt/` to encrypted archive; store in vault.
3. Take a final database dump for each engine to encrypted storage.
4. Record SSH host key fingerprints (`ssh-keygen -l -f /etc/ssh/<key>.pub`) so
   the next host can advertise the same identity if desired (or generate
   fresh ones — usually preferred).
5. Record the public IPs and DNS records affected, so cutover is mechanical.

## Verification before commit

Before committing any snapshot directory:

```bash
# from repo root
grep -RIE 'PRIVATE KEY|BEGIN OPENSSH|password|api[_-]?key|secret' \
  servers/hawaii-01/snapshots/<date>/ | grep -v REDACTED
```

Expect zero hits. If anything turns up, redact, and **rotate** that secret —
assume it leaked.
