#!/bin/bash
# Deploy docs.hawaiidata.ai to Ubuntu server
set -e

SERVER="${DEPLOY_SERVER:?Set DEPLOY_SERVER, for example root@example.com}"
APP_DIR="/var/www/docs.hawaiidata.ai"

echo "=== Deploying docs.hawaiidata.ai ==="

# Create app directory on server
echo "Creating app directory..."
ssh $SERVER "mkdir -p $APP_DIR"

# Sync files (exclude node_modules, uploads, .git)
echo "Syncing files..."
rsync -avz --delete \
  --exclude 'node_modules' \
  --exclude 'uploads/*' \
  --exclude '.git' \
  --exclude '.claude' \
  ./ $SERVER:$APP_DIR/

echo "=== Files synced. Run setup on server. ==="
