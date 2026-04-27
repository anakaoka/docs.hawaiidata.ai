# Restore runbook — hawaii-01

How to bring `docs.hawaiidata.ai` back from a fresh server. This is a template;
fill in specifics from the snapshot once captured.

## Prerequisites

- New host (cloud VM or bare metal) with the OS recorded in
  [`inventory.md`](inventory.md) — same major version recommended.
- DNS control over `hawaiidata.ai` to repoint `docs` once the new host is
  ready.
- Access to the encrypted secret store containing items listed in
  [`secrets.md`](secrets.md) (DB credentials, API keys, TLS private keys or
  certbot account, OAuth secrets, Twilio credentials, etc.).
- Most recent database dumps from off-server backup storage.
- This repository checked out locally.

## 1. Provision the host

1. Create a VM matching the inventory: same OS family/version, ≥ original CPU
   and RAM, disk ≥ used capacity from `fs/df.txt` plus 30% headroom.
2. Configure root SSH access with a key from
   [`snapshots/<date>/access/authorized_keys.txt`](snapshots/) (or a fresh
   admin key — recommended).
3. Set hostname to match `host/identity.txt`.

## 2. Base system

```bash
apt-get update && apt-get -y dist-upgrade
# install packages from snapshot
# generate restore list from packages/dpkg.txt:
#   awk '/^ii/ {print $2}' dpkg.txt > pkgs.txt
xargs -a pkgs.txt apt-get install -y
```

Add additional repos from `packages/sources.list.d/`.

## 3. Network & firewall

- Apply netplan config from `network/etc/netplan/` (adjust for new IP).
- Restore firewall rules from `network/{ufw,iptables,nft}.txt`.
- Verify `ss -tulpn` matches expected listeners after services come up.

## 4. Users & SSH

- Recreate users from `access/passwd.txt` (skip system users below UID 1000
  unless explicitly added).
- Drop `access/etc/sshd_config` and `access/etc/sshd_config.d/` into place;
  restart `sshd`.
- Restore each user's `~/.ssh/authorized_keys` from
  `access/authorized_keys.txt`.

## 5. Application code & data

For each app under [`apps/`](apps/), follow its specific notes. Generic flow:

1. Recreate the app directory (under `/opt`, `/srv`, or `/var/www` — see
   `fs/listing-*.txt`).
2. Pull source from its git repo.
3. Recreate `.env` files using the variable names from
   `env/redacted-keys.txt` and the values from the secret store.
4. Install language-level dependencies (`pip install`, `npm ci`, etc.).

## 6. Databases

1. Install engine versions matching `databases/*-version.txt`.
2. Recreate users and databases listed in `databases/postgres-{databases,users}.txt`
   (or equivalent).
3. Restore from your most recent off-server dumps. **The capture script does
   not include data dumps** — they must come from your backup pipeline.
4. Verify row counts against the most recent backup metadata.

## 7. systemd services

1. Drop custom unit files from `systemd/etc/system/` into `/etc/systemd/system/`.
2. `systemctl daemon-reload`
3. Enable units that were enabled per `systemd/list-unit-files.txt`
   (`state=enabled`).
4. Start services in dependency order; check `systemctl --failed`.

## 8. Web server & TLS

1. Restore `web/nginx/` (or apache/caddy) configs.
2. Reissue TLS certificates with `certbot` — the snapshot contains
   `tls/letsencrypt/renewal/` so domain configurations are preserved, but
   private keys must be regenerated:
   ```bash
   certbot --nginx -d docs.hawaiidata.ai
   ```
   Alternatively restore `/etc/letsencrypt/` from encrypted backup if you
   have it.
3. Reload the web server.

## 9. Containers (if applicable)

1. Install Docker (version from `containers/docker-version.txt`).
2. Restore compose files (paths in `containers/compose-files.txt`) along with
   their working directories.
3. Restore named volumes from off-server backup.
4. `docker compose up -d` per project.

## 10. Cron / timers

- Drop files from `cron/cron.d/`, `cron/cron.daily/`, etc.
- Restore each user's crontab from `cron/user-crontabs.txt`
  (`crontab -u <user> < file`).
- Re-enable systemd timers per `systemd/timers.txt`.

## 11. DNS cutover

1. Smoke-test the new host directly by IP (`curl --resolve` or hosts file).
2. Lower TTL on the DNS record 24h ahead of cutover.
3. Update `docs.hawaiidata.ai` A/AAAA records to the new IP.
4. Watch logs and certificate renewals for 48h.

## 12. Verification checklist

- [ ] `systemctl --failed` is empty
- [ ] All listening ports from `network/listening.txt` reproduced
- [ ] `https://docs.hawaiidata.ai/` returns expected page
- [ ] TLS certificate valid for the right SANs
- [ ] Login flow works end-to-end
- [ ] Document upload + extraction works
- [ ] Search works
- [ ] Audit log entries appearing
- [ ] Backups configured and first run successful

## Notes

- Always restore on a **staging** host first if possible.
- Keep the deprecated server running, in a powered-off "warm" state, for at
  least 30 days after cutover before destroying.
