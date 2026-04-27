# Restore Runbook

These notes rebuild the live `docs.hawaiidata.ai` service from this repository plus private runtime data.

## Inputs To Preserve Before Deprecation

Keep these outside git in a password manager or encrypted backup:

- Full `.env` from `/var/www/docs.hawaiidata.ai/.env`
- PostgreSQL dump of `docs_hawaiidata`, if customer data must be restorable
- `/var/www/docs.hawaiidata.ai/uploads`, if uploaded document files must be restorable
- DNS record for `docs.hawaiidata.ai`
- OAuth redirect URI settings in Google and Microsoft app registrations
- SendGrid sender/domain setup
- Twilio Verify service configuration
- SSH keys or cloud provider recovery access

Suggested backup commands on the old server:

```bash
install -d -m 700 /root/docs-hawaiidata-backup
cp /var/www/docs.hawaiidata.ai/.env /root/docs-hawaiidata-backup/env
sudo -u postgres pg_dump -Fc docs_hawaiidata > /root/docs-hawaiidata-backup/docs_hawaiidata.dump
tar -C /var/www/docs.hawaiidata.ai -czf /root/docs-hawaiidata-backup/uploads.tar.gz uploads
```

Move `/root/docs-hawaiidata-backup` to encrypted storage before destroying the machine.

## New Server Build

Install system dependencies:

```bash
apt-get update
apt-get install -y nginx postgresql nodejs npm certbot python3-certbot-nginx fail2ban ufw watchdog
```

Clone and install the app:

```bash
install -d /var/www
git clone https://github.com/anakaoka/docs.hawaiidata.ai.git /var/www/docs.hawaiidata.ai
cd /var/www/docs.hawaiidata.ai
cp .env.example .env
npm ci
```

Fill `.env` with the private values. Generate new secrets if you are not restoring old encrypted documents:

```bash
openssl rand -hex 32
openssl rand -base64 48
```

Create the database:

```bash
sudo -u postgres createuser docsapp --pwprompt
sudo -u postgres createdb docs_hawaiidata -O docsapp
psql "$DATABASE_URL" < config/schema.sql
```

If restoring a dump instead:

```bash
sudo -u postgres pg_restore --clean --if-exists -d docs_hawaiidata /path/to/docs_hawaiidata.dump
```

Restore uploaded files if needed:

```bash
tar -C /var/www/docs.hawaiidata.ai -xzf /path/to/uploads.tar.gz
```

## Service And nginx

Install systemd service:

```bash
cp infra/docs-hawaiidata.service /etc/systemd/system/docs-hawaiidata.service
systemctl daemon-reload
systemctl enable --now docs-hawaiidata.service
```

Install nginx site:

```bash
cp infra/nginx-docs.hawaiidata.ai.conf /etc/nginx/sites-available/docs.hawaiidata.ai
ln -sf /etc/nginx/sites-available/docs.hawaiidata.ai /etc/nginx/sites-enabled/docs.hawaiidata.ai
rm -f /etc/nginx/sites-enabled/default
certbot --nginx -d docs.hawaiidata.ai
nginx -t
systemctl reload nginx
```

## Health Checks

```bash
systemctl status docs-hawaiidata.service --no-pager
journalctl -u docs-hawaiidata.service -n 100 --no-pager
curl -I https://docs.hawaiidata.ai/
npm test
```

Optional authenticated check:

```bash
TEST_ADMIN_EMAIL='admin@example.com' TEST_ADMIN_PASSWORD='...' npm test
```

## Known Cleanup From The Live Snapshot

- The live server included one-off onboarding scripts with initial account passwords. They were intentionally omitted from this repo.
- The live `node_modules` directory included `archiver`, but `package.json` did not list it. The dependency is now declared because `routes/search.js` requires it for ZIP downloads.
- Uploaded files and token JSON files are runtime data, not source. Empty directories are represented by `.gitkeep` files.
