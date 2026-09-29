#!/usr/bin/env bash
# Script 1 of the hand deploy: runs on the OPERATOR'S LAPTOP. Builds here, ships the build to the
# EC2 box over SSH, and (unless told not to) runs script 2 — restart-on-box.sh — on the far side.
#
#   bash deploy/scripts/push-from-laptop.sh            # build, push, restart
#   bash deploy/scripts/push-from-laptop.sh --dry-run  # print the plan, rsync -n, touch nothing
#
# Why the build is here and not on the box: Next.js inlines NEXT_PUBLIC_* into the browser bundle
# at BUILD time, so whoever runs `next build` decides what URL the browser will call. Doing it on
# the laptop keeps that decision in the config file the operator edits, and keeps a t3.small from
# spending its RAM on a webpack build.
#
# What is shipped is the RELEASE TREE, not the repo: compiled output plus the manifests, assembled
# by deploy/scripts/stage-release.sh (the same staging the CI path uses — read it before adding
# anything here). node_modules, .git, sources and tests are never sent; the box runs
# `npm ci --omit=dev` against the shipped package-lock.json.
#
# Config comes from deploy/env/laptop-push.env (copy the .example next to it). Host, SSH user,
# key and remote path are all config — nothing about the captain's box is hard-coded here.

set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${here}/../.." && pwd)"

ENV_DIR="${ENV_DIR:-${repo_root}/deploy/env}"
PUSH_ENV_FILE="${PUSH_ENV_FILE:-${ENV_DIR}/laptop-push.env}"

dry_run=false
for arg in "$@"; do
  case "${arg}" in
    --dry-run | -n) dry_run=true ;;
    -h | --help)
      sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      printf 'unknown argument: %s (try --dry-run, --help)\n' "${arg}" >&2
      exit 2
      ;;
  esac
done

step() { printf '\n\033[1m=== %s\033[0m\n' "$*"; }
info() { printf '    %s\n' "$*"; }
ok() { printf '    \033[32mOK\033[0m   %s\n' "$*"; }
warn() { printf '    \033[33mWARN\033[0m %s\n' "$*"; }

die() {
  printf '\n\033[31mFAILED\033[0m %s\n' "$1" >&2
  shift
  local line
  for line in "$@"; do printf '       %s\n' "${line}" >&2; done
  exit 1
}

# Same line-wise parser as restart-on-box.sh: values are unquoted and may contain # or spaces.
load_env_file() {
  local file="$1" line
  while IFS= read -r line || [ -n "${line}" ]; do
    line="${line%$'\r'}"
    case "${line}" in '' | '#'*) continue ;; esac
    [ "${line#*=}" != "${line}" ] || continue
    # shellcheck disable=SC2163  # exporting a literal KEY=VALUE string is the point here
    export "${line}"
  done <"${file}"
}

[ -f "${PUSH_ENV_FILE}" ] || die "config file not found: ${PUSH_ENV_FILE}" \
  'Create it from the template:' \
  "  cp ${repo_root}/deploy/env/laptop-push.env.example ${PUSH_ENV_FILE}" \
  'then edit it (host, SSH user, key, remote path, NEXT_PUBLIC_API_URL).'
load_env_file "${PUSH_ENV_FILE}"

SSH_HOST="${SSH_HOST:-}"
SSH_USER="${SSH_USER:-ec2-user}"
SSH_KEY="${SSH_KEY:-}"
SSH_PORT="${SSH_PORT:-22}"
REMOTE_PATH="${REMOTE_PATH:-/home/ec2-user/api}"
NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-}"
STAGE_DIR="${STAGE_DIR:-${repo_root}/.deploy-stage}"
REMOTE_RESTART="${REMOTE_RESTART:-true}"
SKIP_BUILD="${SKIP_BUILD:-false}"
RSYNC_EXTRA_ARGS="${RSYNC_EXTRA_ARGS:-}"

[ -n "${SSH_HOST}" ] || die "SSH_HOST is empty in ${PUSH_ENV_FILE}." \
  'Set it to the box — an Elastic IP, or a DNS name that resolves to the INSTANCE.' \
  'It is not the load-balancer hostname: the ALB terminates HTTPS, it does not forward SSH.'
[ -n "${NEXT_PUBLIC_API_URL}" ] || die "NEXT_PUBLIC_API_URL is empty in ${PUSH_ENV_FILE}." \
  'e.g. https://api.planningpoker.hblab.dev — it is compiled into the browser bundle below.'

# Note the `if`s rather than `[ … ] && …` throughout: with `set -e`, a false test as a bare
# command is a non-zero status and would abort the script.
ssh_opts=(-p "${SSH_PORT}")
if [ -n "${SSH_KEY}" ]; then
  [ -f "${SSH_KEY}" ] || die "SSH_KEY points at a file that does not exist: ${SSH_KEY}"
  ssh_opts+=(-i "${SSH_KEY}")
fi
target="${SSH_USER}@${SSH_HOST}"
ssh_display="ssh ${ssh_opts[*]} ${target}"

# ------------------------------------------------------------------------------- the plan, first

step 'Planning Poker — push from laptop'
info "mode                : $([ "${dry_run}" = true ] && echo 'DRY RUN (nothing is uploaded or restarted)' || echo 'LIVE')"
info "config              : ${PUSH_ENV_FILE}"
info "repo                : ${repo_root}"
info "NEXT_PUBLIC_API_URL : ${NEXT_PUBLIC_API_URL}"
info "stage dir           : ${STAGE_DIR}"
info "target              : ${target}:${REMOTE_PATH} (port ${SSH_PORT})"
info "ssh key             : ${SSH_KEY:-(agent / default identity)}"
info "remote restart      : ${REMOTE_RESTART}"
printf '\n'
info 'It will:'
info "  1. npm ci && npm run build here, with NEXT_PUBLIC_API_URL exported first"
info "  2. deploy/scripts/stage-release.sh -> ${STAGE_DIR} (compiled output + manifests only)"
info "  3. rsync -az --delete ${STAGE_DIR}/ ${target}:${REMOTE_PATH}/"
if [ "${REMOTE_RESTART}" = 'true' ]; then
  info "  4. ${ssh_display} 'cd ${REMOTE_PATH} && bash deploy/scripts/restart-on-box.sh'"
else
  info '  4. (skipped — REMOTE_RESTART is not "true"; run restart-on-box.sh yourself)'
fi

# ------------------------------------------------------------------------------- 1. build

step 'Step 1/4 — build (on this laptop)'

# EXPORTED BEFORE THE BUILD, deliberately: `next build` reads NEXT_PUBLIC_* from the environment
# and writes the value into the client bundle. Setting it afterwards — in web.env, on the box,
# anywhere — cannot change what the browser was compiled to call.
export NEXT_PUBLIC_API_URL
info "NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} exported before npm run build"

if [ "${SKIP_BUILD}" = 'true' ]; then
  warn 'SKIP_BUILD=true — reusing whatever is already in dist/ and .next/.'
  warn 'The bundle keeps the NEXT_PUBLIC_API_URL of the build that produced it, not the one above.'
elif [ "${dry_run}" = true ]; then
  info '[dry-run] would run: npm ci && npm run build'
else
  ( cd "${repo_root}" && npm ci ) || die 'npm ci failed on the laptop.'
  ( cd "${repo_root}" && npm run build ) || die 'npm run build failed on the laptop.' \
    'Nothing has been uploaded; the box is still serving the previous version.'
  ok 'built packages/shared, apps/api (dist/) and apps/web (.next/)'
fi

# ------------------------------------------------------------------------------- 2. stage

step 'Step 2/4 — stage the release'

if [ "${dry_run}" = true ] && [ ! -d "${repo_root}/apps/api/dist" ]; then
  info "[dry-run] would run: deploy/scripts/stage-release.sh ${STAGE_DIR}"
else
  # stage-release.sh already ships exactly what the box needs — package.json, package-lock.json,
  # packages/shared/dist, apps/api/dist, apps/web/.next (minus the webpack cache) and the deploy
  # scripts. It is reused rather than reimplemented so the two deploy paths cannot drift.
  bash "${here}/stage-release.sh" "${STAGE_DIR}" || die 'staging failed.' \
    'Most often: the build output is missing. Run without SKIP_BUILD=true.'
fi
# The box needs restart-on-box.sh and its config template, which live under deploy/ in the stage.
[ -f "${STAGE_DIR}/deploy/scripts/restart-on-box.sh" ] ||
  warn 'restart-on-box.sh is not in the staged tree — check deploy/scripts/stage-release.sh.'
ok "staged tree ready at ${STAGE_DIR}"

# ------------------------------------------------------------------------------- 3. rsync

step 'Step 3/4 — upload'

# --delete keeps the box's tree identical to the stage, so a file deleted in the release is
# deleted there too. The exclusions protect what lives on the box and must survive a deploy:
# the env files the operator wrote, node_modules the box installed itself, and the run state.
# --stats, not --info=stats1: macOS still ships rsync 2.6.9, which does not know --info at all
# and aborts with "unrecognized option". Every flag used here works on 2.6.9 and on rsync 3.x.
rsync_args=(-az --delete --stats
  --exclude 'deploy/env/'
  --exclude 'node_modules/'
  --exclude '.deploy-run/')
if [ -n "${RSYNC_EXTRA_ARGS}" ]; then
  read -r -a extra <<<"${RSYNC_EXTRA_ARGS}"
  rsync_args+=("${extra[@]}")
fi
if [ "${dry_run}" = true ]; then
  rsync_args+=(--dry-run --itemize-changes)
fi

command -v rsync >/dev/null || die 'rsync is not installed on this laptop.' \
  'macOS: brew install rsync (the system one works too, but is ancient).'

info "rsync ${rsync_args[*]} -e \"ssh ${ssh_opts[*]}\" ${STAGE_DIR}/ ${target}:${REMOTE_PATH}/"
rsync "${rsync_args[@]}" -e "ssh ${ssh_opts[*]}" "${STAGE_DIR}/" "${target}:${REMOTE_PATH}/" ||
  die 'rsync failed.' \
    "Check SSH first:  ${ssh_display} 'echo ok'" \
    'A "Permission denied (publickey)" means SSH_KEY/SSH_USER are wrong; the box uses ec2-user.' \
    "A missing ${REMOTE_PATH} is fine — rsync creates the last component, not the whole path."
ok "$([ "${dry_run}" = true ] && echo 'dry-run upload listed above — nothing was written' || echo "uploaded to ${target}:${REMOTE_PATH}")"

# ------------------------------------------------------------------------------- 4. restart

step 'Step 4/4 — restart on the box'

remote_cmd="cd ${REMOTE_PATH} && bash deploy/scripts/restart-on-box.sh"
if [ "${REMOTE_RESTART}" != 'true' ]; then
  info 'REMOTE_RESTART is not "true" — skipping. Run it yourself:'
  info "  ${ssh_display} '${remote_cmd}'"
elif [ "${dry_run}" = true ]; then
  info "[dry-run] would run: ${ssh_display} '${remote_cmd}'"
else
  info "${ssh_display} '${remote_cmd}'"
  # -t so the remote script's output streams as it happens and sudo can prompt if systemd is used.
  ssh -t "${ssh_opts[@]}" "${target}" "${remote_cmd}" || die \
    'the restart on the box failed — its output is above.' \
    'The new code is uploaded; the box may be running the old processes or none at all.' \
    "Re-run just the restart:  ${ssh_display} '${remote_cmd}'"
  ok 'the box reported both apps healthy'
fi

step 'Push complete'
if [ "${dry_run}" = true ]; then
  info 'DRY RUN — nothing was uploaded and nothing was restarted.'
else
  info 'Verify through the load balancer, not just the box:'
  info "  curl -fsS ${NEXT_PUBLIC_API_URL}/health"
fi
