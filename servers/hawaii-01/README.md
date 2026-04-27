# hawaii-01 — `208.83.236.97`

Production server hosting docs.hawaiidata.ai. **Slated for deprecation.** This
directory is the rebuild record so it can be brought back at any time.

## At a glance

| | |
|---|---|
| Hostname | _to be filled from snapshot_ |
| Public IP | `208.83.236.97` |
| Role | Production web/app server for docs.hawaiidata.ai |
| Provider | _to be filled_ |
| OS | _to be filled from snapshot_ |
| Status | Active, pending deprecation |

## Access

- SSH: `ssh root@208.83.236.97` (key-based; password auth should be disabled —
  verify in [`snapshots/`](snapshots/) → `access/etc/sshd_config`).
- Authorized public keys: [`snapshots/2026-04-27/access/authorized_keys.txt`](snapshots/2026-04-27/access/authorized_keys.txt)
  (once captured).

## Documentation

- [`inventory.md`](inventory.md) — hardware, network, users, packages.
- [`services.md`](services.md) — systemd units, web stack, databases, cron.
- [`apps/`](apps/) — per-application notes.
- [`restore.md`](restore.md) — step-by-step rebuild procedure.
- [`secrets.md`](secrets.md) — what's secret, where it lives (NOT in git).
- [`snapshots/`](snapshots/) — raw capture output, dated.

## Snapshot procedure

To refresh the documentation snapshot, run on the server as root:

```bash
bash /path/to/scripts/capture-server.sh
# produces /root/server-snapshot-YYYY-MM-DD.tar.gz
```

Pull it back, extract under `snapshots/YYYY-MM-DD/`, then update the
human-readable docs in this directory.

**Before committing**: review `access/`, `env/`, `web/`, `tls/`, and `logs/`
for anything sensitive. The capture script intentionally skips private keys
and `.env` values, but always verify.

## Deprecation checklist

- [ ] Snapshot captured and reviewed
- [ ] Inventory written
- [ ] Services documented
- [ ] Per-app docs written
- [ ] Restore runbook tested (or at least dry-run reviewed)
- [ ] Secrets exported to password manager / secret store
- [ ] Database backups taken to encrypted off-server storage
- [ ] DNS plan: where `docs.hawaiidata.ai` will point next
- [ ] Final image / disk snapshot taken at provider
- [ ] Decommission date set
