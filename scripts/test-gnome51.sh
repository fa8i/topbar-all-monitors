#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
image="${TOPBAR_GNOME51_IMAGE:-topbar-gnome51-tests:51.1}"
results_dir="$(mktemp -d "${TMPDIR:-/tmp}/topbar-gnome51.XXXXXX")"
container=""
cleanup() {
    if [[ -n "$container" ]]; then
        docker cp "$container:/results/." "$results_dir/" >/dev/null 2>&1 || true
        docker rm -f "$container" >/dev/null
    fi
    echo "GNOME 51.1 test artifacts: $results_dir"
}
trap cleanup EXIT

if [[ -z "${TOPBAR_GNOME51_IMAGE:-}" ]]; then
    docker build -t "$image" -f "$project_dir/tests/gnome51/Dockerfile" \
        "$project_dir/tests/gnome51"
fi

# No host display, session/system bus, home directory, GPU or privileged mode.
# The repository is read-only; the extension is copied to a private home.
container="$(docker create --network none --shm-size 512m \
    --mount "type=bind,source=$project_dir,target=/src,readonly" "$image")"
docker start -a "$container" || true
exit "$(docker inspect --format '{{.State.ExitCode}}' "$container")"
