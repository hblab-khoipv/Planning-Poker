#!/usr/bin/env bash
# Renders the three env files the EC2 box needs, from the workflow's secrets and variables.
#
# Always real, simulation included: rendering writes only into the staging directory, and doing it
# for real is how a simulated run proves the secret/variable wiring is complete. What is never
# real is the log — this script prints key NAMES and value LENGTHS only, never a value.
#
# NEXT_PUBLIC_API_URL is the one setting that also has to be present at BUILD time: Next.js inlines
# NEXT_PUBLIC_* into the client bundle, so the value in web.env only covers server-side rendering.
# See the build job in .github/workflows/deploy.yml.

set -euo pipefail

stage_dir="${1:?usage: render-env.sh <stage-dir>}"
env_dir="${stage_dir}/deploy/env"
mkdir -p "${env_dir}"

write_env() {
  local label="$1"
  local file="${env_dir}/${label}"
  shift
  : >"${file}"
  chmod 600 "${file}"
  local name value
  for name in "$@"; do
    value="${!name:-}"
    printf '%s=%s\n' "${name}" "${value}" >>"${file}"
    if [ -z "${value}" ]; then
      printf '  %-14s %-28s (empty — placeholder not filled in yet)\n' "${label}" "${name}"
    else
      printf '  %-14s %-28s set (%d chars, value redacted)\n' "${label}" "${name}" "${#value}"
    fi
  done
}

echo "Rendering env files into ${env_dir} (values redacted):"

NODE_ENV=production
PORT="${API_PORT:-4000}"

# The idle-room sweep (FR-10) runs in-process on this box, so its knobs belong in api.env. The
# defaults repeat apps/api/src/config.ts on purpose: an operator reading the rendered file should
# see what the box will actually do without going to the source for it.
ROOM_IDLE_HOURS="${ROOM_IDLE_HOURS:-24}"
ROOM_CLEANUP_INTERVAL_MS="${ROOM_CLEANUP_INTERVAL_MS:-300000}"
ROOM_CLEANUP_ENABLED="${ROOM_CLEANUP_ENABLED:-true}"

# apps/api — note PORT, not API_PORT: API_PORT is the repo variable, PORT is what config.ts reads.
write_env api.env NODE_ENV PORT DATABASE_URL CORS_ORIGIN SOCKET_DISCONNECT_GRACE_MS NEXTAUTH_SECRET \
  ROOM_IDLE_HOURS ROOM_CLEANUP_INTERVAL_MS ROOM_CLEANUP_ENABLED

# apps/web — NextAuth runs in the Next.js server runtime, so it needs the database too.
write_env web.env NODE_ENV NEXTAUTH_URL NEXTAUTH_SECRET DATABASE_URL NEXT_PUBLIC_API_URL \
  AUTH_COOKIE_DOMAIN GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET

# Postgres container on the same box (docker-compose.yml reads these).
POSTGRES_USER="${POSTGRES_USER:-planning_poker}"
POSTGRES_DB="${POSTGRES_DB:-planning_poker}"
write_env postgres.env POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB

echo "Rendered $(ls "${env_dir}" | wc -l | tr -d ' ') env files, mode 600."
