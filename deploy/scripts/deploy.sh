#!/usr/bin/env bash
# Deploys a staged release to the single EC2 box.
#
# One script, two modes. DEPLOY_SIMULATE=true (the default) prints every host-touching command
# instead of running it; DEPLOY_SIMULATE=false runs the same commands for real. There is no
# separate "dry-run" implementation to drift out of sync — see deploy/scripts/lib.sh.

set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/scripts/lib.sh
source "${here}/lib.sh"

stage_dir="${1:?usage: deploy.sh <stage-dir>}"

EC2_USER="${EC2_USER:-ubuntu}"
DEPLOY_PATH="${DEPLOY_PATH:-/opt/planning-poker}"
APP_DOMAIN="${APP_DOMAIN:-}"
API_PORT="${API_PORT:-4000}"
WEB_PORT="${WEB_PORT:-3000}"
ssh_key="${RUNNER_TEMP:-/tmp}/planning-poker-deploy.key"
target="${EC2_USER}@${EC2_HOST:-EC2_HOST-not-set}"

log "Planning Poker deploy"
log "  mode         : $(simulating && echo 'SIMULATE (no host is contacted)' || echo 'LIVE')"
log "  host         : ${target}"
log "  remote path  : ${DEPLOY_PATH}"
log "  domain       : ${APP_DOMAIN:-(unset)}"
log "  ports        : web ${WEB_PORT}, api ${API_PORT}"
log "  stage dir    : ${stage_dir}"

if ! simulating; then
  require_var EC2_HOST
  require_var APP_DOMAIN
fi

step 'Step 1/6 — install the deploy SSH key'
run_step "install $(secret_ref EC2_SSH_PRIVATE_KEY) into ${ssh_key} (mode 600)" -- \
  bash -c 'umask 077; printf "%s\n" "${EC2_SSH_PRIVATE_KEY}" > "$1"' _ "${ssh_key}"

step 'Step 2/6 — trust the host key'
run_step "ssh-keyscan -H \$EC2_HOST >> ~/.ssh/known_hosts" -- \
  bash -c 'mkdir -p ~/.ssh && ssh-keyscan -H "${EC2_HOST}" >> ~/.ssh/known_hosts'

ssh_opts=(-i "${ssh_key}" -o StrictHostKeyChecking=yes -o BatchMode=yes)

step 'Step 3/6 — upload the release'
run_step "rsync -az --delete ${stage_dir}/ ${target}:${DEPLOY_PATH}/releases/${RELEASE_ID:-pending}/" -- \
  rsync -az --delete -e "ssh ${ssh_opts[*]}" \
    "${stage_dir}/" "${target}:${DEPLOY_PATH}/releases/${RELEASE_ID:-pending}/"

step 'Step 4/6 — activate the release on the box'
remote_cmd="sudo DEPLOY_PATH=${DEPLOY_PATH} RELEASE_ID=${RELEASE_ID:-pending} bash ${DEPLOY_PATH}/releases/${RELEASE_ID:-pending}/deploy/scripts/remote-release.sh"
log "  remote script: deploy/scripts/remote-release.sh"
log "  it will      : npm ci --omit=dev, run migrations, swap the 'current' symlink,"
log "                 then systemctl restart planning-poker-api planning-poker-web"
run_step "ssh ${target} '${remote_cmd}'" -- \
  ssh "${ssh_opts[@]}" "${target}" "${remote_cmd}"

step 'Step 5/6 — health check the API'
run_step "curl -fsS --retry 5 --retry-delay 3 https://api.${APP_DOMAIN:-APP_DOMAIN-not-set}/health/db" -- \
  curl -fsS --retry 5 --retry-delay 3 "https://api.${APP_DOMAIN}/health/db"

step 'Step 6/6 — health check the web app'
run_step "curl -fsS --retry 5 --retry-delay 3 -o /dev/null https://${APP_DOMAIN:-APP_DOMAIN-not-set}/" -- \
  curl -fsS --retry 5 --retry-delay 3 -o /dev/null "https://${APP_DOMAIN}/"

step 'Cleanup'
run_step "shred/remove ${ssh_key}" -- rm -f "${ssh_key}"

if simulating; then
  log ''
  log 'SIMULATED DEPLOY COMPLETE — no SSH connection was opened, no AWS resource was touched.'
  log 'Set the repository variable DEPLOY_SIMULATE=false to run the same steps for real.'
else
  log ''
  log "LIVE DEPLOY COMPLETE — https://${APP_DOMAIN}/"
fi
