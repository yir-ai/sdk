#!/usr/bin/env bash
# Run on de-ci against a reviewed, committed checkout. Requires Git and Docker.
set -euo pipefail
root=$(git -C "$(dirname "${BASH_SOURCE[0]}")/../.." rev-parse --show-toplevel)
revision=$(git -C "$root" rev-parse HEAD)
if [[ -n $(git -C "$root" status --porcelain) ]]; then
  echo 'Commit or stash changes before validating a release.' >&2
  exit 1
fi
mkdir -p "$root/typescript/.tmp"
scratch=$(mktemp -d "$root/typescript/.tmp/release-XXXXXX")
scratch=$(realpath "$scratch")
parent=$(realpath "$root/typescript/.tmp")
[[ $(dirname "$scratch") == "$parent" ]]
cleanup() {
  [[ $(dirname "$scratch") == "$parent" && $(realpath "$scratch") == "$scratch" ]] || return 1
  rm -rf -- "$scratch"
}
trap cleanup EXIT
mkdir "$scratch/source" "$scratch/go-module"
git -C "$root" archive "$revision" | tar -x -C "$scratch/source"
cp -a "$scratch/source/go/." "$scratch/go-module/"
# Sequential containers share no credentials, Docker socket, or host services.
docker run --rm --cpus=2 --memory=4g --pids-limit=256 \
  --cap-drop=ALL --security-opt=no-new-privileges \
  -v "$scratch/source:/sdk" -w /sdk/typescript node:22-bookworm-slim \
  sh -ec 'corepack enable; corepack prepare pnpm@10.30.1 --activate; pnpm install --frozen-lockfile; pnpm check'
docker run --rm --cpus=2 --memory=4g --pids-limit=256 \
  --cap-drop=ALL --security-opt=no-new-privileges \
  -e GOWORK=off -e GOMAXPROCS=2 -e GOTOOLCHAIN=local \
  -v "$scratch/go-module:/sdk" -w /sdk golang:1.25.1-bookworm \
  go test -p 2 ./...
printf 'Release checks passed for %s\n' "$revision"
