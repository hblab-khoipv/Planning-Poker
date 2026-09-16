#!/usr/bin/env bash
# Shared helpers for the deploy scripts.
#
# Everything that would touch the EC2 box goes through `run_step`, which is the one place that
# honours DEPLOY_SIMULATE. With simulation on (the default) a step prints the host, the path and
# the exact command it WOULD run and returns 0; with DEPLOY_SIMULATE=false the same array is
# executed. There is deliberately no second code path for "real" deploys — the simulated run
# exercises the identical script, so a bug in the plan is a bug you can see in the simulated log.
#
# Secret values must never reach the log. Commands are echoed from a *display* string that the
# caller builds with `secret_ref`, not from the executed argv.

set -euo pipefail

simulating() {
  # Anything other than the literal "false" keeps simulation on: a typo must not deploy.
  [ "${DEPLOY_SIMULATE:-true}" != "false" ]
}

log()  { printf '%s\n' "$*"; }
step() { printf '\n=== %s\n' "$*"; }

# Render a secret as a masked placeholder for the command echo: `secret_ref DATABASE_URL`
# prints `$DATABASE_URL«secret»`, naming which secret would be used without revealing it.
secret_ref() { printf '$%s«secret»' "$1"; }

# run_step <display-command> -- <argv...>
# Prints the plan, then executes argv only when simulation is off.
run_step() {
  local display="$1"
  shift
  [ "${1:-}" = '--' ] && shift
  log "  would run: ${display}"
  if simulating; then
    log "  [SIMULATED] skipped — DEPLOY_SIMULATE=true"
    return 0
  fi
  log "  [LIVE] executing"
  "$@"
}

# Fail fast with a readable message when a required variable is empty.
require_var() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    log "ERROR: required variable ${name} is empty. See docs/deployment.md."
    return 1
  fi
}
