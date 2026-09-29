#!/usr/bin/env bash
# Script 2 of the hand deploy: runs ON THE BOX and brings the app up on the code that
# push-from-laptop.sh (script 1) just rsynced here.
#
#   cd /home/ec2-user/api && bash deploy/scripts/restart-on-box.sh
#
# It never builds. The laptop builds — that is the whole point of the split, because
# NEXT_PUBLIC_API_URL is inlined into the browser bundle at BUILD time and the box has no
# business deciding what the browser talks to. This script installs production dependencies when
# the manifests changed, migrates, restarts, and then proves both apps answer.
#
# It is for the load-balancer topology — TLS terminates at an AWS ALB routing
# <domain> -> :3000 and api.<domain> -> :4000 — so it never touches nginx or certbot. The
# nginx/systemd release path (deploy.sh + remote-release.sh) stays valid for anyone not behind a
# load balancer; see docs/deployment.md.
#
# Idempotent: run it twice in a row and the second run re-installs nothing, re-migrates (a no-op),
# restarts and re-checks. Nothing it does depends on state left by the previous run.
#
# Config comes from deploy/env/box-restart.env (copy the .example next to it). The operator edits
# env files, never this script.

set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${here}/../.." && pwd)"

ENV_DIR="${ENV_DIR:-${repo_root}/deploy/env}"
DEPLOY_ENV_FILE="${DEPLOY_ENV_FILE:-${ENV_DIR}/box-restart.env}"

# ---------------------------------------------------------------------------- output helpers

step() { printf '\n\033[1m=== %s\033[0m\n' "$*"; }
info() { printf '    %s\n' "$*"; }
ok() { printf '    \033[32mOK\033[0m   %s\n' "$*"; }
warn() { printf '    \033[33mWARN\033[0m %s\n' "$*"; }

# die <message...> — every failure names the thing that is missing or wrong, and what to do.
die() {
  printf '\n\033[31mFAILED\033[0m %s\n' "$1" >&2
  shift
  local line
  for line in "$@"; do printf '       %s\n' "${line}" >&2; done
  exit 1
}

# ---------------------------------------------------------------------------- env file helpers

# Values are written unquoted by render-env.sh and by hand, and a NEXTAUTH_SECRET may legally
# contain '#', spaces or '='. So parse line-wise and export the whole KEY=VALUE as one word
# rather than sourcing the file, which would treat those characters as shell syntax.
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

# env_value <file> <key> — read one value without exporting anything (used for comparisons).
env_value() {
  local file="$1" key="$2" line
  while IFS= read -r line || [ -n "${line}" ]; do
    line="${line%$'\r'}"
    case "${line}" in "${key}="*) printf '%s' "${line#*=}" ;; esac
  done <"${file}"
}

# ---------------------------------------------------------------------------- 0. configuration

[ -f "${DEPLOY_ENV_FILE}" ] || die "config file not found: ${DEPLOY_ENV_FILE}" \
  "Create it from the template:" \
  "  cp ${repo_root}/deploy/env/box-restart.env.example ${DEPLOY_ENV_FILE}" \
  "then edit it. Or point DEPLOY_ENV_FILE=... at your own copy."
load_env_file "${DEPLOY_ENV_FILE}"

API_ENV_FILE="${API_ENV_FILE:-${ENV_DIR}/api.env}"
WEB_ENV_FILE="${WEB_ENV_FILE:-${ENV_DIR}/web.env}"
POSTGRES_ENV_FILE="${POSTGRES_ENV_FILE:-${ENV_DIR}/postgres.env}"

API_PORT="${API_PORT:-4000}"
WEB_PORT="${WEB_PORT:-3000}"
NODE_MAJOR="${NODE_MAJOR:-22}"
# auto | systemd | background — "auto" uses systemd when both units are installed.
SERVICE_MODE="${SERVICE_MODE:-auto}"
SYSTEMD_API_UNIT="${SYSTEMD_API_UNIT:-planning-poker-api}"
SYSTEMD_WEB_UNIT="${SYSTEMD_WEB_UNIT:-planning-poker-web}"
RUN_DIR="${RUN_DIR:-${repo_root}/.deploy-run}"
LOG_DIR="${LOG_DIR:-${RUN_DIR}/logs}"
POSTGRES_WAIT_SECONDS="${POSTGRES_WAIT_SECONDS:-60}"
HEALTH_WAIT_SECONDS="${HEALTH_WAIT_SECONDS:-90}"
COMPOSE_SERVICE="${COMPOSE_SERVICE:-postgres}"
FORCE_INSTALL="${FORCE_INSTALL:-false}"

step 'Planning Poker — restart on the box'
info "repo         : ${repo_root}"
info "config       : ${DEPLOY_ENV_FILE}"
info "env dir      : ${ENV_DIR}"
info "ports        : web ${WEB_PORT}, api ${API_PORT}"
info "service mode : ${SERVICE_MODE}"

# ---------------------------------------------------------------------------- 1. prerequisites

step 'Step 1/7 — prerequisites'

command -v node >/dev/null || die 'node is not installed or not on PATH.' \
  "Amazon Linux 2023:  sudo dnf install -y nodejs${NODE_MAJOR} npm  (or use nvm/NodeSource)" \
  'Ubuntu:             curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs'
node_major="$(node -v | sed 's/^v//' | cut -d. -f1)"
[ "${node_major}" -ge "${NODE_MAJOR}" ] || die \
  "node ${NODE_MAJOR} or newer is required, but 'node -v' reports $(node -v)." \
  'Install a newer Node (nvm install 22) and re-run. next start and the API are built against it.'
ok "node $(node -v)"

command -v npm >/dev/null || die 'npm is not installed or not on PATH.' \
  'It normally ships with Node; reinstall Node, or install the nodejs-npm package.'
ok "npm $(npm -v)"

command -v docker >/dev/null || die 'docker is not installed or not on PATH.' \
  'Amazon Linux 2023:  sudo dnf install -y docker && sudo systemctl enable --now docker' \
  '                    sudo usermod -aG docker ec2-user   # then log out and back in' \
  'Postgres runs in the repo docker-compose.yml container on this box.'
docker info >/dev/null 2>&1 || die 'docker is installed but the daemon is not reachable.' \
  '  sudo systemctl enable --now docker' \
  'If it is running, this user is not in the docker group:  sudo usermod -aG docker ec2-user (then re-login).'
if docker compose version >/dev/null 2>&1; then
  compose=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  compose=(docker-compose)
else
  die 'neither "docker compose" (v2 plugin) nor docker-compose is available.' \
    'Amazon Linux 2023:  sudo dnf install -y docker-compose-plugin' \
    '                    (or drop the binary into ~/.docker/cli-plugins/docker-compose)'
fi
ok "docker $(docker --version | sed 's/,.*//') with ${compose[*]}"

missing=()
for f in "${API_ENV_FILE}" "${WEB_ENV_FILE}" "${POSTGRES_ENV_FILE}"; do
  [ -f "${f}" ] || missing+=("${f}")
done
[ ${#missing[@]} -eq 0 ] || die "missing env file(s): ${missing[*]}" \
  'Each one is required. Templates and the full key list are in docs/deployment.md §4;' \
  'deploy/scripts/render-env.sh writes exactly these three files in the CI path.'
ok "env files present: $(basename "${API_ENV_FILE}"), $(basename "${WEB_ENV_FILE}"), $(basename "${POSTGRES_ENV_FILE}")"

require_key() {
  local file="$1" key="$2"
  [ -n "$(env_value "${file}" "${key}")" ] ||
    die "${key} is missing or empty in ${file}." 'See docs/deployment.md §4 for what it should be.'
}
require_key "${API_ENV_FILE}" DATABASE_URL
require_key "${API_ENV_FILE}" NEXTAUTH_SECRET
require_key "${API_ENV_FILE}" CORS_ORIGIN
require_key "${WEB_ENV_FILE}" DATABASE_URL
require_key "${WEB_ENV_FILE}" NEXTAUTH_SECRET
require_key "${WEB_ENV_FILE}" NEXTAUTH_URL
require_key "${WEB_ENV_FILE}" NEXT_PUBLIC_API_URL
require_key "${POSTGRES_ENV_FILE}" POSTGRES_PASSWORD

# The four cross-file agreements that have each cost real debugging time.

api_secret="$(env_value "${API_ENV_FILE}" NEXTAUTH_SECRET)"
web_secret="$(env_value "${WEB_ENV_FILE}" NEXTAUTH_SECRET)"
[ "${api_secret}" = "${web_secret}" ] || die \
  'NEXTAUTH_SECRET differs between api.env and web.env.' \
  'It must be byte-identical: apps/api decrypts the cookie apps/web issues (apps/api/src/http/session.ts).' \
  'When it does not match, the API sees every signed-in user as a guest — no error, just wrong data.' \
  'Watch for trailing whitespace and a missing final newline; both count as a difference.'
ok 'NEXTAUTH_SECRET is identical in api.env and web.env'

api_db="$(env_value "${API_ENV_FILE}" DATABASE_URL)"
web_db="$(env_value "${WEB_ENV_FILE}" DATABASE_URL)"
[ "${api_db}" = "${web_db}" ] ||
  warn 'DATABASE_URL differs between api.env and web.env — intentional only if NextAuth uses another database.'
ok 'DATABASE_URL present in both api.env and web.env (NextAuth adapter needs it too)'

# A password with @ : / # ? % in it silently truncates or mis-parses DATABASE_URL unless it is
# percent-encoded, and the failure looks like a wrong host or a wrong database name.
pg_password="$(env_value "${POSTGRES_ENV_FILE}" POSTGRES_PASSWORD)"
case "${pg_password}" in
  *[@:/\#?%]*)
    warn 'POSTGRES_PASSWORD contains one of @ : / # ? % — those MUST be percent-encoded inside'
    warn 'DATABASE_URL (@ -> %40, : -> %3A, / -> %2F, # -> %23, ? -> %3F, % -> %25).'
    warn 'Leave the raw password in postgres.env; encode only the copy inside the URL.'
    ;;
esac

cookie_domain="$(env_value "${WEB_ENV_FILE}" AUTH_COOKIE_DOMAIN)"
nextauth_url="$(env_value "${WEB_ENV_FILE}" NEXTAUTH_URL)"
case "${nextauth_url}" in
  https://*)
    [ -n "${cookie_domain}" ] ||
      warn 'AUTH_COOKIE_DOMAIN is empty while NEXTAUTH_URL is https — the session cookie will not
         reach api.<domain>, so the API will treat signed-in users as guests. Set it to the
         registrable domain (e.g. .planningpoker.hblab.dev).'
    ;;
  *)
    [ -z "${cookie_domain}" ] ||
      die 'AUTH_COOKIE_DOMAIN is set but NEXTAUTH_URL is not https.' \
        'A domain-scoped cookie is issued with the secure flag, so a plain-HTTP or bare-IP test never' \
        'receives it and sign-in silently fails. Blank AUTH_COOKIE_DOMAIN for HTTP testing.'
    ;;
esac
ok "AUTH_COOKIE_DOMAIN=${cookie_domain:-(empty)} is consistent with NEXTAUTH_URL=${nextauth_url}"

# ---------------------------------------------------------------------------- 2. dependencies

step 'Step 2/7 — release contents and production dependencies'

# This script does not build; the release rsynced from the laptop must already contain the output.
[ -f "${repo_root}/apps/api/dist/server.js" ] || die \
  'apps/api/dist/server.js is missing — this tree has not been built.' \
  'The build happens on the laptop. Run deploy/scripts/push-from-laptop.sh there; it stages the' \
  'compiled output and rsyncs it here.'
[ -d "${repo_root}/apps/web/.next" ] || die \
  'apps/web/.next is missing — this tree has not been built.' \
  'Run deploy/scripts/push-from-laptop.sh on the laptop.'
ok 'release contains apps/api/dist and apps/web/.next'

# The trap, checked rather than assumed: NEXT_PUBLIC_API_URL is inlined into the client bundle at
# build time, so the value in web.env is only what the SERVER sees. If the built bundle does not
# contain the configured URL, the browser is still calling whatever was set when `next build` ran.
expected_api_url="$(env_value "${WEB_ENV_FILE}" NEXT_PUBLIC_API_URL)"
if grep -rqlF -- "${expected_api_url}" "${repo_root}/apps/web/.next/static" 2>/dev/null; then
  ok "browser bundle was built with NEXT_PUBLIC_API_URL=${expected_api_url}"
else
  warn "the built bundle does not contain NEXT_PUBLIC_API_URL=${expected_api_url}."
  warn 'Next.js bakes that value in at BUILD time — editing web.env here cannot change it.'
  warn 'Rebuild on the laptop with the right value exported and push again.'
fi

# Install only when the manifests actually changed: `npm ci` wipes node_modules every time, which
# on a t3.small is minutes of downtime for nothing when the dependency tree is untouched.
mkdir -p "${RUN_DIR}"
deps_stamp="${RUN_DIR}/deps.sha"
if command -v sha256sum >/dev/null 2>&1; then sha=(sha256sum); else sha=(shasum -a 256); fi
deps_now="$(cat "${repo_root}/package-lock.json" "${repo_root}/package.json" \
  "${repo_root}"/apps/*/package.json "${repo_root}"/packages/*/package.json 2>/dev/null |
  "${sha[@]}" | cut -d' ' -f1)"

if [ "${FORCE_INSTALL}" = 'true' ] || [ ! -d "${repo_root}/node_modules" ] ||
  [ "$(cat "${deps_stamp}" 2>/dev/null || true)" != "${deps_now}" ]; then
  info 'manifests changed (or FORCE_INSTALL=true) — installing production dependencies'
  # --omit=dev keeps tsx/vitest/playwright off the box; everything here is already compiled.
  ( cd "${repo_root}" && npm ci --omit=dev --workspaces --include-workspace-root ) ||
    die 'npm ci --omit=dev failed.' \
      'A lockfile that does not match package.json is the usual cause — rebuild and push again.'
  printf '%s' "${deps_now}" >"${deps_stamp}"
  ok 'production dependencies installed'
else
  ok 'manifests unchanged since the last run — skipping npm ci (FORCE_INSTALL=true forces it)'
fi

[ -x "${repo_root}/node_modules/.bin/next" ] || die \
  'node_modules/.bin/next is missing after the install.' \
  'next is a production dependency of apps/web; if it is absent the install did not complete.'

# ---------------------------------------------------------------------------- 3. postgres

step 'Step 3/7 — Postgres'

( cd "${repo_root}" && "${compose[@]}" --env-file "${POSTGRES_ENV_FILE}" up -d "${COMPOSE_SERVICE}" ) ||
  die 'docker compose up failed for the postgres service.' \
    "Check: ${compose[*]} --env-file ${POSTGRES_ENV_FILE} logs ${COMPOSE_SERVICE}"

pg_user="$(env_value "${POSTGRES_ENV_FILE}" POSTGRES_USER)"
pg_db="$(env_value "${POSTGRES_ENV_FILE}" POSTGRES_DB)"
pg_user="${pg_user:-planning_poker}"
pg_db="${pg_db:-planning_poker}"

info "waiting up to ${POSTGRES_WAIT_SECONDS}s for Postgres to accept connections…"
waited=0
until ( cd "${repo_root}" && "${compose[@]}" --env-file "${POSTGRES_ENV_FILE}" \
  exec -T "${COMPOSE_SERVICE}" pg_isready -U "${pg_user}" -d "${pg_db}" ) >/dev/null 2>&1; do
  waited=$((waited + 2))
  [ "${waited}" -lt "${POSTGRES_WAIT_SECONDS}" ] || die \
    "Postgres was still not accepting connections after ${POSTGRES_WAIT_SECONDS}s." \
    "  ${compose[*]} --env-file ${POSTGRES_ENV_FILE} logs --tail=50 ${COMPOSE_SERVICE}" \
    'A container that restarts in a loop is usually a corrupt or half-initialised data volume.'
  sleep 2
done
ok "Postgres is accepting connections (pg_isready -U ${pg_user} -d ${pg_db})"

# ---------------------------------------------------------------------------- 4. migrations

step 'Step 4/7 — database migrations'

migrate_log="$(mktemp)"
trap 'rm -f "${migrate_log}"' EXIT

migrate_status=0
(
  load_env_file "${API_ENV_FILE}"
  cd "${repo_root}"
  node apps/api/dist/db/migrate-cli.js
) >"${migrate_log}" 2>&1 || migrate_status=$?

sed 's/^/    | /' "${migrate_log}"

if [ "${migrate_status}" -ne 0 ]; then
  if grep -qi 'password authentication failed' "${migrate_log}"; then
    die 'Postgres rejected the password in DATABASE_URL.' \
      'POSTGRES_PASSWORD is only ever applied when the data volume is FIRST initialised. Changing it' \
      'in postgres.env afterwards does nothing — the old password is still stored in the volume.' \
      'Two ways out:' \
      "  (a) keep the data — change the stored password to match:" \
      "      ${compose[*]} exec ${COMPOSE_SERVICE} psql -U ${pg_user} -d ${pg_db} \\" \
      "        -c \"ALTER USER ${pg_user} WITH PASSWORD '<the password in DATABASE_URL>';\"" \
      '  (b) throw the data away and re-initialise from scratch (DESTROYS the database):' \
      "      ${compose[*]} --env-file ${POSTGRES_ENV_FILE} down -v && re-run this script" \
      'Also check the password is percent-encoded inside DATABASE_URL if it contains @ : / # ? %.'
  fi
  die 'the migration run failed — see the output above.' \
    'Nothing was restarted, so the previous version is still serving.'
fi
ok 'migrations applied (or already up to date)'

# ---------------------------------------------------------------------------- 5. restart services

step 'Step 5/7 — restart the services'

has_unit() { systemctl list-unit-files "$1.service" >/dev/null 2>&1 && systemctl cat "$1.service" >/dev/null 2>&1; }

mode="${SERVICE_MODE}"
if [ "${mode}" = 'auto' ]; then
  if command -v systemctl >/dev/null 2>&1 && has_unit "${SYSTEMD_API_UNIT}" && has_unit "${SYSTEMD_WEB_UNIT}"; then
    mode='systemd'
  else
    mode='background'
  fi
  info "SERVICE_MODE=auto resolved to '${mode}'"
fi

sudo_maybe() {
  if [ "$(id -u)" -eq 0 ]; then "$@"; else sudo "$@"; fi
}

start_background() {
  # label, env file, working dir, argv…
  local label="$1" env_file="$2" workdir="$3"
  shift 3
  local pidfile="${RUN_DIR}/${label}.pid"
  local logfile="${LOG_DIR}/${label}.log"
  mkdir -p "${RUN_DIR}" "${LOG_DIR}"

  if [ -f "${pidfile}" ]; then
    local old
    old="$(cat "${pidfile}")"
    if [ -n "${old}" ] && kill -0 "${old}" 2>/dev/null; then
      info "stopping previous ${label} (pid ${old})"
      kill "${old}" 2>/dev/null || true
      local i=0
      while kill -0 "${old}" 2>/dev/null && [ "${i}" -lt 15 ]; do
        sleep 1
        i=$((i + 1))
      done
      kill -9 "${old}" 2>/dev/null || true
    fi
    rm -f "${pidfile}"
  fi

  (
    load_env_file "${env_file}"
    cd "${workdir}"
    exec nohup "$@" >>"${logfile}" 2>&1
  ) &
  local pid=$!
  echo "${pid}" >"${pidfile}"

  # Do not take "it launched" for "it is running": a port already held by an older process
  # (a hand-started `npm start`, a previous deploy this script did not know about) kills the new
  # one on EADDRINUSE within milliseconds, and the health check below would then happily pass
  # against the OLD server.
  sleep 3
  if ! kill -0 "${pid}" 2>/dev/null; then
    tail -n 30 "${logfile}" | sed 's/^/    | /'
    local port_hint="${WEB_PORT}"
    if [ "${label}" = 'api' ]; then port_hint="${API_PORT}"; fi
    die "${label} exited immediately after starting (pid ${pid})." \
      "Its last output is above; the full log is ${logfile}." \
      "EADDRINUSE means something else already holds port ${port_hint}:" \
      "  sudo lsof -nP -iTCP:${port_hint} -sTCP:LISTEN     # then stop it, or change the port" \
      'If systemd units are installed, they may already be running the app — set SERVICE_MODE=systemd.'
  fi
  info "${label} running (pid ${pid}, log ${logfile})"
}

case "${mode}" in
  systemd)
    sudo_maybe systemctl restart "${SYSTEMD_API_UNIT}" "${SYSTEMD_WEB_UNIT}" ||
      die "systemctl restart ${SYSTEMD_API_UNIT} ${SYSTEMD_WEB_UNIT} failed." \
        "  sudo journalctl -u ${SYSTEMD_API_UNIT} -n 50 --no-pager"
    sleep 2
    for unit in "${SYSTEMD_API_UNIT}" "${SYSTEMD_WEB_UNIT}"; do
      state="$(systemctl is-active "${unit}" 2>/dev/null || true)"
      if [ "${state}" = 'active' ]; then
        ok "${unit} is ${state}"
      else
        systemctl status "${unit}" --no-pager --lines=20 || true
        die "${unit} is '${state}', not 'active' after the restart." \
          "  sudo journalctl -u ${unit} -n 50 --no-pager"
      fi
    done
    ;;
  background)
    info 'no systemd units installed — running both apps as plain background processes.'
    info "Survives this shell but NOT a reboot. Install deploy/systemd/*.service for that."
    start_background api "${API_ENV_FILE}" "${repo_root}" node apps/api/dist/server.js
    start_background web "${WEB_ENV_FILE}" "${repo_root}/apps/web" \
      "${repo_root}/node_modules/.bin/next" start --port "${WEB_PORT}"
    ;;
  *)
    die "SERVICE_MODE='${SERVICE_MODE}' is not one of: auto, systemd, background."
    ;;
esac

# ---------------------------------------------------------------------------- 6/7. health checks

# wait_http <label> <url> <extra-hint>
wait_http() {
  local label="$1" url="$2" hint="$3" waited=0
  info "checking ${label}: ${url}"
  assert_still_running "${label}"
  until curl -fsS -o /dev/null --max-time 5 "${url}"; do
    waited=$((waited + 3))
    if [ "${waited}" -ge "${HEALTH_WAIT_SECONDS}" ]; then
      printf '\n'
      show_logs
      die "${label} did not answer on ${url} within ${HEALTH_WAIT_SECONDS}s." "${hint}"
    fi
    sleep 3
  done
  ok "${label} answered 2xx on ${url}"
}

# In background mode a 2xx proves only that *something* is listening. Re-check the pid we
# started, so a stale server on the same port cannot make this deploy look successful.
assert_still_running() {
  local label="$1" pidfile pid
  [ "${mode}" = 'background' ] || return 0
  case "${label}" in API) pidfile="${RUN_DIR}/api.pid" ;; web) pidfile="${RUN_DIR}/web.pid" ;; *) return 0 ;; esac
  [ -f "${pidfile}" ] || return 0
  pid="$(cat "${pidfile}")"
  kill -0 "${pid}" 2>/dev/null || die \
    "the ${label} process this script started (pid ${pid}) is no longer running." \
    "Anything answering on that port now is a different, older process — see ${LOG_DIR}."
}

show_logs() {
  if [ "${mode}" = 'systemd' ]; then
    sudo_maybe journalctl -u "${SYSTEMD_API_UNIT}" -n 30 --no-pager || true
    sudo_maybe journalctl -u "${SYSTEMD_WEB_UNIT}" -n 30 --no-pager || true
  else
    tail -n 30 "${LOG_DIR}/api.log" "${LOG_DIR}/web.log" 2>/dev/null || true
  fi
}

step 'Step 6/7 — API health check'
# /health, not /health/db: the ALB target group uses the same path, and a liveness check that
# queries Postgres would pull the instance out of service on a transient database blip.
wait_http 'API' "http://127.0.0.1:${API_PORT}/health" \
  "It is the same path the ALB target group checks. Inspect the log above; ${API_ENV_FILE} is what it loaded."

step 'Step 7/7 — web health check'
wait_http 'web' "http://127.0.0.1:${WEB_PORT}/" \
  "next start serves the .next build; a missing build or a port clash on ${WEB_PORT} is the usual cause."

# A readiness probe on top of liveness: this one really does touch Postgres. It is reported, not
# enforced as a gate for the ALB — see the comment above.
if curl -fsS -o /dev/null --max-time 5 "http://127.0.0.1:${API_PORT}/health/db"; then
  ok "readiness: /health/db reached Postgres"
else
  warn "/health/db did not return 2xx — the API is up but cannot query Postgres. Check DATABASE_URL."
fi

step 'Deploy complete'
info "API  http://127.0.0.1:${API_PORT}/health   (ALB target group :${API_PORT})"
info "web  http://127.0.0.1:${WEB_PORT}/         (ALB target group :${WEB_PORT})"
if [ "${mode}" = 'background' ]; then
  info "logs ${LOG_DIR}/api.log, ${LOG_DIR}/web.log"
fi
info 'Public URLs are served by the load balancer; see docs/deployment.md §7.'
