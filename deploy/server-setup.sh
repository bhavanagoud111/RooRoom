#!/usr/bin/env bash
# One-time setup of a fresh Ubuntu 24.04 VPS for RooRoom. Run ON the server:
#   sudo bash server-setup.sh <expected-hostname> [domain]
# Firewall (22/80/443 only), Docker, Caddy for HTTPS, fail2ban, automatic security updates, swap,
# no root login. Password login stays ON (owner's choice, 2026-11-11); fail2ban blocks guessing.
# Without a domain, Caddy is installed but not configured; rerun with the domain later.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Run with sudo." >&2; exit 1; }
EXPECTED="${1:?usage: server-setup.sh <expected-hostname> [domain]}"
DOMAIN="${2:-}"
[ "$(hostname)" = "$EXPECTED" ] || { echo "REFUSING: this is '$(hostname)', not $EXPECTED." >&2; exit 1; }
DEPLOY_USER="${SUDO_USER:-ubuntu}"

export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q ca-certificates curl ufw fail2ban unattended-upgrades python3 \
  docker.io docker-compose-v2 caddy
usermod -aG docker "$DEPLOY_USER"
systemctl enable --now docker fail2ban unattended-upgrades

# Firewall: SSH and web only. Postgres and storage have no public port anyway (see docker-compose.yml).
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# Swap, so a Next.js build cannot run the box out of memory.
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# Caddy gets the HTTPS certificate and forwards to the stack's gateway on 127.0.0.1:3300.
systemctl enable caddy
if [ -n "$DOMAIN" ]; then
  cat >/etc/caddy/Caddyfile <<EOF
${DOMAIN} {
	encode gzip
	reverse_proxy 127.0.0.1:3300
}
EOF
  systemctl reload caddy || systemctl restart caddy
fi

# Folders the deploy uses.
install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/rooroom" \
  "/home/$DEPLOY_USER/rooroom/releases" "/home/$DEPLOY_USER/rooroom/shared"

# No root login over SSH. Password login is left as the owner chose.
cat >/etc/ssh/sshd_config.d/00-rooroom-hardening.conf <<'EOF'
PermitRootLogin no
EOF
mkdir -p /run/sshd
sshd -t
systemctl restart ssh
echo "✅ Server set up. Log out and back in once so '$DEPLOY_USER' can use Docker."
