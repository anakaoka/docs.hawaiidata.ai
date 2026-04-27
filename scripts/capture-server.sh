#!/usr/bin/env bash
# capture-server.sh - snapshot a server for documentation / deprecation.
# Run as root on the target. Produces /root/server-snapshot-<DATE>.tar.gz
# Safe to re-run; each run overwrites the working dir.
#
# USAGE: sudo bash capture-server.sh
#
# WHAT IT CAPTURES
#   - Host identity, hardware, kernel, uptime
#   - Network: interfaces, routes, listening ports, firewall rules
#   - Users, groups, sudoers, SSH config, authorized_keys (public only)
#   - Installed packages (apt, snap, pip, npm, gem, cargo - if present)
#   - systemd units (enabled, running, failed) + unit file contents
#   - Cron jobs (system + per-user)
#   - Web stack configs: nginx, apache2, caddy, haproxy
#   - TLS/Let's Encrypt: cert inventory (NOT private keys)
#   - Databases: list databases/tables for postgres, mysql, redis, mongo, sqlite (NO data dumps)
#   - Containers: docker images/containers/volumes, compose files, podman if present
#   - Filesystem: mounts, disk usage, contents of /opt /srv /var/www, sizes only for /home
#   - Logs: last 1000 lines of journal + key service logs
#   - Env files: PATHS only (contents redacted - secrets never copied)
#
# WHAT IT EXCLUDES (intentionally)
#   - Private keys (/etc/ssh/*key, /etc/letsencrypt/live/**/privkey*, ~/.ssh/id_*)
#   - Database dumps (do those separately to encrypted storage)
#   - .env file CONTENTS (only paths + variable NAMES, never values)
#   - /home user data, /var/lib service data
#
# Adjust EXCLUDES below if you want to be even more restrictive.

set -uo pipefail

DATE="$(date -u +%Y-%m-%d)"
OUT="/root/server-snapshot-${DATE}"
ARCHIVE="/root/server-snapshot-${DATE}.tar.gz"

rm -rf "$OUT"
mkdir -p "$OUT"
cd "$OUT"

# ---------- helpers ----------
run() {
  # run "label" command...
  local label="$1"; shift
  local out="${label}.txt"
  {
    echo "# $*"
    echo "# captured: $(date -u +%FT%TZ)"
    echo "# ----"
    "$@" 2>&1
    echo
    echo "# exit=$?"
  } > "$out"
}

copy_if_exists() {
  # copy_if_exists src dest_subdir
  local src="$1" dest="$2"
  if [[ -e "$src" ]]; then
    mkdir -p "$dest"
    cp -aL "$src" "$dest/" 2>/dev/null || cp -a "$src" "$dest/" 2>/dev/null || true
  fi
}

have() { command -v "$1" >/dev/null 2>&1; }

# ---------- 1. host identity ----------
mkdir -p host
{
  echo "## hostname";       hostname -f 2>/dev/null || hostname
  echo; echo "## uname";    uname -a
  echo; echo "## os-release"; cat /etc/os-release 2>/dev/null
  echo; echo "## uptime";   uptime
  echo; echo "## date";     date -u +%FT%TZ
  echo; echo "## timezone"; timedatectl 2>/dev/null || cat /etc/timezone 2>/dev/null
  echo; echo "## machine-id"; cat /etc/machine-id 2>/dev/null
} > host/identity.txt

run host/cpuinfo      cat /proc/cpuinfo
run host/meminfo      cat /proc/meminfo
run host/lsblk        lsblk -f
run host/lscpu        lscpu
have lshw && run host/lshw lshw -short
have dmidecode && run host/dmidecode dmidecode -t system

# ---------- 2. network ----------
mkdir -p network
run network/ip-addr     ip -4 -o addr
run network/ip-addr6    ip -6 -o addr
run network/ip-route    ip route
run network/ip-route6   ip -6 route
run network/listening   ss -tulpn
run network/established ss -tnp state established
run network/resolv      cat /etc/resolv.conf
run network/hosts       cat /etc/hosts
copy_if_exists /etc/netplan       network/etc
copy_if_exists /etc/network       network/etc
copy_if_exists /etc/systemd/network network/etc
have ufw       && run network/ufw       ufw status verbose
have iptables  && run network/iptables  iptables-save
have nft       && run network/nft       nft list ruleset
have firewalld && run network/firewalld firewall-cmd --list-all-zones

# ---------- 3. users / access ----------
mkdir -p access
run access/passwd     getent passwd
run access/group      getent group
run access/shadow-meta awk -F: '{print $1, $3, $4, $5, $6, $7, $8}' /etc/shadow  # ages, NOT hashes
run access/sudoers    cat /etc/sudoers
copy_if_exists /etc/sudoers.d access/etc
copy_if_exists /etc/ssh/sshd_config access/etc
copy_if_exists /etc/ssh/sshd_config.d access/etc
# authorized_keys: public keys only, list per user
{
  echo "## authorized_keys per user (public keys only)"
  for home in /root /home/*; do
    [[ -d "$home" ]] || continue
    user="$(basename "$home")"
    [[ "$user" == "root" ]] || user="$user"
    ak="$home/.ssh/authorized_keys"
    if [[ -f "$ak" ]]; then
      echo; echo "### $user ($ak)"
      cat "$ak"
    fi
  done
} > access/authorized_keys.txt
run access/last       last -n 50
run access/lastlog    lastlog

# ---------- 4. packages ----------
mkdir -p packages
have dpkg && run packages/dpkg dpkg -l
have apt  && run packages/apt-sources cat /etc/apt/sources.list
have apt  && copy_if_exists /etc/apt/sources.list.d packages/
have rpm  && run packages/rpm rpm -qa
have snap && run packages/snap snap list
have flatpak && run packages/flatpak flatpak list
have pip3 && run packages/pip3-global pip3 list
have pip  && run packages/pip-global  pip list
have npm  && run packages/npm-global  npm ls -g --depth=0
have gem  && run packages/gem-global  gem list
have cargo && run packages/cargo-installed cargo install --list
# language runtime versions
{
  for cmd in python python3 node npm yarn pnpm ruby go rustc java php perl psql mysql redis-cli mongo mongosh nginx apache2 httpd caddy docker podman; do
    if have "$cmd"; then
      echo "## $cmd"
      "$cmd" --version 2>&1 | head -3
      echo
    fi
  done
} > packages/runtime-versions.txt

# ---------- 5. systemd ----------
mkdir -p systemd
run systemd/list-unit-files   systemctl list-unit-files --no-pager
run systemd/list-units        systemctl list-units --all --no-pager
run systemd/failed            systemctl --failed --no-pager
run systemd/timers            systemctl list-timers --all --no-pager
# copy custom unit files (skip distro-shipped /lib units)
mkdir -p systemd/etc
copy_if_exists /etc/systemd/system systemd/etc
copy_if_exists /etc/systemd/user   systemd/etc

# ---------- 6. cron ----------
mkdir -p cron
copy_if_exists /etc/crontab     cron/
copy_if_exists /etc/cron.d      cron/
copy_if_exists /etc/cron.daily  cron/
copy_if_exists /etc/cron.hourly cron/
copy_if_exists /etc/cron.weekly cron/
copy_if_exists /etc/cron.monthly cron/
{
  for u in $(cut -d: -f1 /etc/passwd); do
    out="$(crontab -u "$u" -l 2>/dev/null)" || continue
    [[ -n "$out" ]] && { echo "### $u"; echo "$out"; echo; }
  done
} > cron/user-crontabs.txt

# ---------- 7. web servers ----------
mkdir -p web
copy_if_exists /etc/nginx     web/
copy_if_exists /etc/apache2   web/
copy_if_exists /etc/httpd     web/
copy_if_exists /etc/caddy     web/
copy_if_exists /etc/haproxy   web/
have nginx && run web/nginx-T nginx -T
have apache2ctl && run web/apache2-S apache2ctl -S
have caddy && run web/caddy-version caddy version

# ---------- 8. TLS / Let's Encrypt (PUBLIC certs only) ----------
mkdir -p tls
if [[ -d /etc/letsencrypt ]]; then
  # copy renewal configs and cert metadata; SKIP private keys
  mkdir -p tls/letsencrypt
  cp -a /etc/letsencrypt/renewal tls/letsencrypt/ 2>/dev/null || true
  cp -a /etc/letsencrypt/accounts tls/letsencrypt/ 2>/dev/null || true
  # list live certs (metadata only)
  if have openssl; then
    {
      for cert in /etc/letsencrypt/live/*/cert.pem; do
        [[ -f "$cert" ]] || continue
        echo "### $cert"
        openssl x509 -in "$cert" -noout -subject -issuer -dates -ext subjectAltName 2>&1
        echo
      done
    } > tls/cert-inventory.txt
  fi
fi
have certbot && run tls/certbot-certificates certbot certificates

# ---------- 9. databases (metadata only - NO dumps) ----------
mkdir -p databases
if have psql; then
  run databases/postgres-version psql --version
  sudo -u postgres psql -tAc "SELECT datname FROM pg_database WHERE datistemplate=false;" \
    > databases/postgres-databases.txt 2>&1 || true
  sudo -u postgres psql -tAc "SELECT usename, usesuper, usecreatedb FROM pg_user;" \
    > databases/postgres-users.txt 2>&1 || true
fi
if have mysql; then
  run databases/mysql-version mysql --version
  mysql -e "SHOW DATABASES;" > databases/mysql-databases.txt 2>&1 || true
fi
if have redis-cli; then
  run databases/redis-info redis-cli INFO server
  run databases/redis-config redis-cli CONFIG GET '*'
fi
if have mongosh; then
  run databases/mongo-dbs mongosh --quiet --eval "db.adminCommand('listDatabases')"
fi
# sqlite files: just list them with sizes
find /opt /srv /var/lib /home -maxdepth 6 -type f \( -name '*.sqlite' -o -name '*.sqlite3' -o -name '*.db' \) \
  -printf '%s %p\n' 2>/dev/null > databases/sqlite-files.txt

# ---------- 10. containers ----------
mkdir -p containers
if have docker; then
  run containers/docker-version  docker version
  run containers/docker-info     docker info
  run containers/docker-images   docker images
  run containers/docker-ps       docker ps -a
  run containers/docker-volumes  docker volume ls
  run containers/docker-networks docker network ls
  # container inspect for running ones
  mkdir -p containers/inspect
  for cid in $(docker ps -aq 2>/dev/null); do
    docker inspect "$cid" > "containers/inspect/${cid}.json" 2>/dev/null || true
  done
  # find compose files
  find / -xdev -type f \( -name 'docker-compose.yml' -o -name 'compose.yml' -o -name 'docker-compose.yaml' \) \
    2>/dev/null > containers/compose-files.txt
fi
have podman && run containers/podman-ps podman ps -a

# ---------- 11. filesystem layout ----------
mkdir -p fs
run fs/mounts      mount
run fs/df          df -hT
run fs/fstab       cat /etc/fstab
# tree-ish listing (not full content) of common app dirs
for d in /opt /srv /var/www /usr/local; do
  [[ -d "$d" ]] || continue
  out="fs/listing-$(echo "$d" | tr / _).txt"
  find "$d" -maxdepth 4 -printf '%y %s %p\n' > "$out" 2>/dev/null
done
# /home - sizes only, no contents
du -sh /home/* /root 2>/dev/null > fs/home-sizes.txt
# largest 100 files outside system dirs
find /opt /srv /var/www /var/log /var/lib /home -xdev -type f -printf '%s %p\n' 2>/dev/null \
  | sort -rn | head -100 > fs/largest-files.txt

# ---------- 12. environment files (paths + var NAMES only, never values) ----------
mkdir -p env
{
  find /opt /srv /var/www /home /root -maxdepth 6 -type f \
    \( -name '.env' -o -name '.env.*' -o -name '*.env' -o -name 'config.json' -o -name 'settings.py' \) \
    2>/dev/null
} > env/files-found.txt
{
  while read -r f; do
    [[ -f "$f" ]] || continue
    echo "### $f"
    # extract just KEY= portion, redact value
    grep -E '^[A-Z_][A-Z0-9_]*=' "$f" 2>/dev/null | sed 's/=.*/=<REDACTED>/'
    echo
  done < env/files-found.txt
} > env/redacted-keys.txt

# ---------- 13. logs (recent only) ----------
mkdir -p logs
have journalctl && journalctl --no-pager -n 1000 > logs/journal-tail.txt 2>&1
have journalctl && journalctl --no-pager --list-boots > logs/journal-boots.txt 2>&1
for svc in nginx apache2 docker postgresql mysql redis-server caddy; do
  have systemctl || break
  systemctl is-enabled "$svc" >/dev/null 2>&1 || continue
  journalctl --no-pager -u "$svc" -n 200 > "logs/${svc}.log" 2>&1 || true
done

# ---------- 14. dns / public-facing summary ----------
mkdir -p public
{
  echo "## external IPs (best-effort, no outbound calls)"
  ip -4 -o addr | awk '{print $4}'
  ip -6 -o addr | awk '{print $4}'
} > public/ips.txt

# ---------- finalize ----------
{
  echo "# Server snapshot"
  echo "Captured: $(date -u +%FT%TZ)"
  echo "Host:     $(hostname -f 2>/dev/null || hostname)"
  echo "Script:   capture-server.sh"
  echo
  echo "## Contents"
  find . -type f | sort
} > MANIFEST.txt

cd /root
tar czf "$ARCHIVE" "server-snapshot-${DATE}"
chmod 600 "$ARCHIVE"

echo
echo "================================================================"
echo "Snapshot created: $ARCHIVE"
echo "Size: $(du -h "$ARCHIVE" | cut -f1)"
echo
echo "Pull it back to your laptop with:"
echo "  scp root@<this-host>:${ARCHIVE} ."
echo
echo "Review for any sensitive data BEFORE committing to git."
echo "Specifically inspect: access/, env/, web/, tls/, logs/"
echo "================================================================"
