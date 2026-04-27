# Live Server Inventory

Captured from `root@docs.hawaiidata.ai` on April 27, 2026.

## Host

- Hostname: `docs`
- Public IP: intentionally omitted from git
- OS: Ubuntu 25.10 (`questing`)
- Kernel: `6.17.0-20-generic`
- Uptime at capture: 20 days, 13 hours
- Disk: `/dev/vda2`, ext4, 23 GB total, 8.1 GB used
- Memory: 953 MiB RAM, 2.3 GiB swap

## Runtime

- Node.js: `v20.19.4`
- npm: `9.2.0`
- PostgreSQL: `17.9`
- nginx: `1.28.0`
- Certbot: `4.0.0`

## Running Services

Relevant active systemd units:

- `docs-hawaiidata.service`
- `nginx.service`
- `postgresql@17-main.service`
- `fail2ban.service`
- `ssh.service`
- `watchdog.service`
- `unattended-upgrades.service`

## Listening Ports

- `22`: sshd
- `80`: nginx
- `443`: nginx
- `3000`: Node app
- `5432`: PostgreSQL on localhost only
- `53`: systemd-resolved on localhost

## Application

- Directory: `/var/www/docs.hawaiidata.ai`
- Entrypoint: `server.js`
- Service file: `/etc/systemd/system/docs-hawaiidata.service`
- Service user: `root`
- Working directory: `/var/www/docs.hawaiidata.ai`
- ExecStart: `/usr/bin/node server.js`
- Environment from service: `NODE_ENV=production`
- App log line at capture: `docs.hawaiidata.ai running on port 3000`

## nginx

- Enabled site: `/etc/nginx/sites-enabled/docs.hawaiidata.ai`
- HTTP redirects to HTTPS.
- HTTPS terminates with Let's Encrypt files under `/etc/letsencrypt/live/docs.hawaiidata.ai/`.
- `client_max_body_size` is `50M`.
- All requests proxy to `http://127.0.0.1:3000`.
- Captured config is committed as `infra/nginx-docs.hawaiidata.ai.conf`.

Certificate at capture:

- Subject: `CN=docs.hawaiidata.ai`
- Issuer: Let's Encrypt `E7`
- Not before: April 7, 2026
- Not after: July 6, 2026
- Renewal timer: `certbot.timer`

## PostgreSQL

- Databases: `docs_hawaiidata`, `postgres`
- App role: `docsapp`
- Superuser role: `postgres`
- Database size at capture: `docs_hawaiidata` about 9 MB
- Extension: `plpgsql`

Tables in `docs_hawaiidata`:

- `audit_logs`: approximately 131 rows
- `documents`: approximately 40 rows
- `properties`: approximately 0 rows
- `secure_links`: approximately 0 rows
- `session`: approximately 4 rows
- `tenants`: approximately 7 rows
- `token_usage`: approximately 20 rows
- `users`: approximately 10 rows

No database dump or uploaded document files are committed because they may contain private customer data.

## Secrets And Runtime Data

The live `.env` contained keys for:

- SendGrid
- OpenAI
- Twilio
- PostgreSQL `DATABASE_URL`
- session secret
- Google OAuth
- Microsoft OAuth
- AES-256-GCM encryption key

Values are not stored in git. Use `.env.example` as the restore checklist.

Runtime data intentionally excluded from git:

- `/var/www/docs.hawaiidata.ai/.env`
- `/var/www/docs.hawaiidata.ai/node_modules`
- `/var/www/docs.hawaiidata.ai/uploads`
- `/var/www/docs.hawaiidata.ai/data/search-tokens`
- session rows and uploaded/customer document contents
