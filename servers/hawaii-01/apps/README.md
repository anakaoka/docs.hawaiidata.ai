# Apps on hawaii-01

One markdown file per discrete application/service running on the box. Fill
in once the snapshot is committed and we know what's actually there.

For each app, document:

- **Name & purpose** — one-liner.
- **Source** — git repo URL, branch, last-known commit.
- **Runtime** — language version, framework, package manager.
- **Install location** — `/opt/...`, `/srv/...`, etc.
- **Service** — systemd unit name(s) or container name(s).
- **Listening ports** — public and internal.
- **Dependencies** — databases, external APIs, other services on the box.
- **Config files** — paths, including `.env` (values redacted).
- **Data locations** — where persistent data lives.
- **How to restart** — exact commands.
- **Known quirks** — anything non-obvious about deploying or operating it.
