# Services — hawaii-01

Stub — populate from the next snapshot.

## systemd units

- Enabled units: _from `systemd/list-unit-files.txt`_
- Active units: _from `systemd/list-units.txt`_
- Failed units: _from `systemd/failed.txt`_
- Timers: _from `systemd/timers.txt`_
- Custom unit files: _under `systemd/etc/`_

For each non-default unit, document below: name, what it does, where its
binaries/configs live, and any dependencies.

| Unit | Purpose | Binary / WorkingDirectory | Notes |
|---|---|---|---|
| _e.g. docs-hawaiidata.service_ | _serves the app_ | _/opt/docs-hawaiidata_ | _depends on postgres_ |

## Web stack

- Server: _nginx / apache / caddy — see `web/`_
- Resolved config: _`web/nginx-T.txt` (full effective config)_
- Virtual hosts / sites: _list each `server_name` with upstream_
- TLS: _from `tls/cert-inventory.txt` and `tls/letsencrypt/renewal/`_

| Hostname | Port | Upstream / docroot | TLS cert |
|---|---|---|---|
| docs.hawaiidata.ai | 443 | _e.g. http://127.0.0.1:8000_ | _Let's Encrypt_ |

## Databases

Capture script records metadata only — full backups happen separately (see
[`restore.md`](restore.md) and [`secrets.md`](secrets.md)).

- PostgreSQL: _from `databases/postgres-databases.txt`, `databases/postgres-users.txt`_
- MySQL: _from `databases/mysql-databases.txt`_
- Redis: _from `databases/redis-info.txt`, `databases/redis-config.txt`_
- SQLite: _from `databases/sqlite-files.txt`_

| Engine | Database | Owner | Used by |
|---|---|---|---|
| | | | |

## Containers

- Docker images: _from `containers/docker-images.txt`_
- Running containers: _from `containers/docker-ps.txt`_
- Volumes: _from `containers/docker-volumes.txt`_
- Compose files: _list paths from `containers/compose-files.txt`_

## Scheduled jobs

- System cron: _under `cron/`_
- User crontabs: _from `cron/user-crontabs.txt`_
- systemd timers: _from `systemd/timers.txt`_

| When | Command | Owner | Purpose |
|---|---|---|---|
| | | | |
