#!/usr/bin/env bash
# Assembles the release tree that gets shipped to the EC2 box.
#
# This step is ALWAYS real, in simulation mode too: staging only writes into the workspace, so
# running it for real is what makes the simulated deploy a genuine exercise — if the build output
# is missing or a path moved, the simulated run fails here exactly as the real one would.
#
# The tree is build output plus the manifests, not sources: the box runs
# `npm ci --omit=dev` itself (see remote-release.sh), which is why package-lock.json ships.

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
stage_dir="${1:-${repo_root}/.deploy-stage}"

rm -rf "${stage_dir}"
mkdir -p "${stage_dir}"

copy() {
  local src="$1"
  local dest="${stage_dir}/$1"
  if [ ! -e "${repo_root}/${src}" ]; then
    echo "ERROR: expected build output '${src}' is missing — run 'npm run build' first." >&2
    exit 1
  fi
  mkdir -p "$(dirname "${dest}")"
  cp -R "${repo_root}/${src}" "${dest}"
}

copy package.json
copy package-lock.json
copy packages/shared/package.json
copy packages/shared/dist
copy apps/api/package.json
copy apps/api/dist
copy apps/web/package.json
copy apps/web/next.config.mjs
copy apps/web/.next
# The webpack cache is build-time only and is most of the tree's size; the box never rebuilds.
rm -rf "${stage_dir}/apps/web/.next/cache"
# `public/` is optional today; ship it when it appears rather than failing the deploy on it.
if [ -d "${repo_root}/apps/web/public" ]; then copy apps/web/public; fi

# The release carries the scripts that run ON the box, so the server never needs a git checkout.
mkdir -p "${stage_dir}/deploy"
cp -R "${repo_root}/deploy/scripts" "${stage_dir}/deploy/scripts"
cp -R "${repo_root}/deploy/systemd" "${stage_dir}/deploy/systemd"
cp -R "${repo_root}/deploy/nginx" "${stage_dir}/deploy/nginx"

echo "Staged release at ${stage_dir}"
du -sh "${stage_dir}" 2>/dev/null || true
