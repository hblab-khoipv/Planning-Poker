#!/usr/bin/env bash
# Runs ON the EC2 box, as root, against a freshly uploaded release directory.
#
# Never executed from CI in simulation mode — deploy.sh only prints the ssh command that would
# invoke it. It is committed and shipped inside the release so the box never needs a git checkout
# or network access to GitHub.

set -euo pipefail

DEPLOY_PATH="${DEPLOY_PATH:-/opt/planning-poker}"
RELEASE_ID="${RELEASE_ID:?RELEASE_ID is required}"
release_dir="${DEPLOY_PATH}/releases/${RELEASE_ID}"
app_user="${APP_USER:-planningpoker}"

cd "${release_dir}"

echo "--> Installing production dependencies"
# --omit=dev keeps tsx/vitest/playwright off the box; the build output is already compiled.
npm ci --omit=dev --workspaces --include-workspace-root

echo "--> Installing env files"
install -o "${app_user}" -g "${app_user}" -m 600 deploy/env/api.env "${DEPLOY_PATH}/env/api.env"
install -o "${app_user}" -g "${app_user}" -m 600 deploy/env/web.env "${DEPLOY_PATH}/env/web.env"
install -o root -g root -m 600 deploy/env/postgres.env "${DEPLOY_PATH}/env/postgres.env"

echo "--> Applying database migrations"
# apps/api owns the schema (see AGENTS.md); the compiled migrate runner ships in dist.
set -a; . "${DEPLOY_PATH}/env/api.env"; set +a
node apps/api/dist/db/migrate-cli.js

echo "--> Swapping the current symlink"
ln -sfn "${release_dir}" "${DEPLOY_PATH}/current.new"
mv -Tf "${DEPLOY_PATH}/current.new" "${DEPLOY_PATH}/current"
chown -R "${app_user}:${app_user}" "${release_dir}"

echo "--> Restarting services"
systemctl restart planning-poker-api
systemctl restart planning-poker-web
systemctl --no-pager --lines=0 status planning-poker-api planning-poker-web

echo "--> Pruning old releases (keeping the 5 most recent)"
ls -1dt "${DEPLOY_PATH}/releases/"*/ | tail -n +6 | xargs -r rm -rf

echo "Release ${RELEASE_ID} is live."
