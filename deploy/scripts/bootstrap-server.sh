#!/usr/bin/env bash
# First-time setup for a fresh Ubuntu 24.04 EC2 instance. Run ONCE, on the box, as root.
#
#   sudo APP_DOMAIN=poker.example.com LETSENCRYPT_EMAIL=you@example.com \
#        bash bootstrap-server.sh
#
# This file has never been executed by the agent that wrote it: task 10 was scoped to a simulated
# deploy, so no instance exists yet. Treat the first real run as a review, not a rubber stamp.
# Everything here is idempotent enough to re-run.

set -euo pipefail

APP_DOMAIN="${APP_DOMAIN:?APP_DOMAIN is required, e.g. poker.example.com}"
LETSENCRYPT_EMAIL="${LETSENCRYPT_EMAIL:?LETSENCRYPT_EMAIL is required}"
DEPLOY_PATH="${DEPLOY_PATH:-/opt/planning-poker}"
APP_USER="${APP_USER:-planningpoker}"
NODE_MAJOR="${NODE_MAJOR:-22}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "--> Packages"
apt-get update
apt-get install -y ca-certificates curl gnupg rsync nginx certbot python3-certbot-nginx

echo "--> Node ${NODE_MAJOR} (NodeSource)"
if ! command -v node >/dev/null || [ "$(node -v | cut -c2- | cut -d. -f1)" != "${NODE_MAJOR}" ]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi

echo "--> Docker (only Postgres runs in a container; the apps run under systemd)"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi

echo "--> Service account and directories"
id -u "${APP_USER}" >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin "${APP_USER}"
mkdir -p "${DEPLOY_PATH}/releases" "${DEPLOY_PATH}/env" /var/www/certbot
chown -R "${APP_USER}:${APP_USER}" "${DEPLOY_PATH}"
# The deploy user (EC2_USER) rsyncs into releases/ and runs remote-release.sh under sudo.
chmod 755 "${DEPLOY_PATH}"

echo "--> Postgres container"
install -m 600 /dev/null "${DEPLOY_PATH}/env/postgres.env" 2>/dev/null || true
cp "${here}/../docker-compose.yml" "${DEPLOY_PATH}/docker-compose.yml" 2>/dev/null || \
  echo "    (ship docker-compose.yml to ${DEPLOY_PATH} yourself, or point DATABASE_URL at RDS)"
echo "    then: cd ${DEPLOY_PATH} && docker compose --env-file env/postgres.env up -d"

echo "--> systemd units"
install -m 644 "${here}/systemd/planning-poker-api.service" /etc/systemd/system/
install -m 644 "${here}/systemd/planning-poker-web.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable planning-poker-api planning-poker-web

echo "--> Nginx"
sed "s/__APP_DOMAIN__/${APP_DOMAIN}/g" "${here}/nginx/planning-poker.conf.template" \
  > /etc/nginx/sites-available/planning-poker
ln -sfn /etc/nginx/sites-available/planning-poker /etc/nginx/sites-enabled/planning-poker
rm -f /etc/nginx/sites-enabled/default

echo "--> TLS certificate for ${APP_DOMAIN} and api.${APP_DOMAIN}"
# certbot --nginx needs a working :80 vhost, which the template above provides. Renewal is the
# certbot.timer unit the package installs; nothing else has to be scheduled.
certbot --nginx --non-interactive --agree-tos \
  -m "${LETSENCRYPT_EMAIL}" \
  -d "${APP_DOMAIN}" -d "api.${APP_DOMAIN}" \
  --redirect

nginx -t && systemctl reload nginx

cat <<NEXT

Bootstrap done. Remaining manual steps (see docs/deployment.md):
  1. Point DNS A records for ${APP_DOMAIN} and api.${APP_DOMAIN} at this instance's Elastic IP.
  2. Start Postgres:  cd ${DEPLOY_PATH} && docker compose --env-file env/postgres.env up -d
  3. Fill in the repository secrets/variables on GitHub.
  4. Set DEPLOY_SIMULATE=false and run the Deploy workflow.
NEXT
