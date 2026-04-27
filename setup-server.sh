#!/bin/bash
set -e

echo "=== Setting up docs.hawaiidata.ai ==="

: "${DOCSAPP_DB_PASSWORD:?Set DOCSAPP_DB_PASSWORD to the PostgreSQL password for docsapp}"
: "${SEED_USER_PASSWORD:?Set SEED_USER_PASSWORD for initial seeded users}"

# PostgreSQL setup
echo "Setting up PostgreSQL..."
sudo -u postgres psql -c "CREATE USER docsapp WITH PASSWORD '${DOCSAPP_DB_PASSWORD}';" 2>/dev/null || echo "User may already exist"
sudo -u postgres psql -c "CREATE DATABASE docs_hawaiidata OWNER docsapp;" 2>/dev/null || echo "Database may already exist"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE docs_hawaiidata TO docsapp;" 2>/dev/null || true

# Update pg_hba.conf for md5 auth
PGHBA="/etc/postgresql/17/main/pg_hba.conf"
if ! grep -q "docsapp" "$PGHBA"; then
  sed -i '/^local.*all.*all.*peer/i local   docs_hawaiidata docsapp                                md5' "$PGHBA"
  systemctl reload postgresql
  echo "PostgreSQL auth updated"
fi

# Test DB connection
PGPASSWORD="$DOCSAPP_DB_PASSWORD" psql -U docsapp -d docs_hawaiidata -c "SELECT 1;" && echo "DB connection OK"

# Run seed
cd /var/www/docs.hawaiidata.ai
SEED_USER_PASSWORD="$SEED_USER_PASSWORD" node config/seed.js

# Install fail2ban
echo "Installing fail2ban..."
apt-get install -y fail2ban

# Configure fail2ban with whitelist
cat > /etc/fail2ban/jail.local << 'JAILEOF'
[DEFAULT]
ignoreip = 127.0.0.1/8 ::1 ${FAIL2BAN_IGNORE_IPS:-}

[sshd]
enabled = true
port = ssh
filter = sshd
logpath = /var/log/auth.log
maxretry = 5
bantime = 3600
findtime = 600

[nginx-http-auth]
enabled = true
port = http,https
filter = nginx-http-auth
logpath = /var/log/nginx/error.log
maxretry = 5
bantime = 3600
JAILEOF

systemctl enable fail2ban
systemctl restart fail2ban
echo "fail2ban configured with whitelist"

# Set up systemd service for the app
cat > /etc/systemd/system/docs-hawaiidata.service << 'SVCEOF'
[Unit]
Description=docs.hawaiidata.ai
After=network.target postgresql.service

[Service]
Type=simple
User=root
WorkingDirectory=/var/www/docs.hawaiidata.ai
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
SVCEOF

systemctl daemon-reload
systemctl enable docs-hawaiidata
systemctl start docs-hawaiidata
echo "App service started"

# Configure Nginx
cat > /etc/nginx/sites-available/docs.hawaiidata.ai << 'NGXEOF'
server {
    listen 80;
    server_name docs.hawaiidata.ai;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl;
    server_name docs.hawaiidata.ai;

    ssl_certificate /etc/letsencrypt/live/docs.hawaiidata.ai/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/docs.hawaiidata.ai/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
NGXEOF

# Enable site and remove default
ln -sf /etc/nginx/sites-available/docs.hawaiidata.ai /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

nginx -t && systemctl reload nginx
echo "Nginx configured"

echo ""
echo "=== Setup complete! ==="
echo "Site: https://docs.hawaiidata.ai"
echo "Seed users were created with SEED_USER_PASSWORD."
