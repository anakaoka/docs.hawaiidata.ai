# Snapshots — hawaii-01

Each subdirectory is a dated capture from
[`scripts/capture-server.sh`](../../../scripts/capture-server.sh).

## Layout per snapshot

```
YYYY-MM-DD/
├── MANIFEST.txt
├── host/        # identity, hardware, OS
├── network/     # interfaces, routes, firewall, listening ports
├── access/      # users, groups, sudoers, sshd_config, authorized_keys
├── packages/    # dpkg/rpm/snap/pip/npm/etc., runtime versions
├── systemd/     # unit lists + custom unit files
├── cron/        # system + per-user cron
├── web/         # nginx/apache/caddy configs (full effective config)
├── tls/         # cert metadata, letsencrypt renewal configs (NO private keys)
├── databases/   # database/user lists, redis info (NO data dumps)
├── containers/  # docker images/ps/volumes/inspect, compose file paths
├── fs/          # mounts, df, listings of /opt /srv /var/www
├── env/         # paths to .env files + REDACTED variable names
└── logs/        # last 1000 journal lines, recent service logs
```

## Procedure

1. On the server (as root):
   ```bash
   bash /path/to/capture-server.sh
   # → /root/server-snapshot-YYYY-MM-DD.tar.gz
   ```
2. Pull back to your laptop (IP from secret store):
   ```bash
   scp root@<server-ip>:/root/server-snapshot-YYYY-MM-DD.tar.gz .
   ```
3. Extract under this directory:
   ```bash
   tar xzf server-snapshot-YYYY-MM-DD.tar.gz \
     -C servers/hawaii-01/snapshots/
   ```
4. Run the secret check from
   [`../secrets.md`](../secrets.md#verification-before-commit) before
   committing.
5. Commit the extracted tree (NOT the `.tar.gz` — see `.gitignore`).
