#!/bin/sh
# PENDING ONLY; no Docker command was run during R125 preparation.
set -eu
: "${R125_IMAGE:?immutable image@sha256 digest required}"
: "${R125_SOURCE:?complete clean public6f22 source directory}"
: "${R125_HARNESS:?verified extracted R125 bundle directory}"
: "${R125_DEPS:?readonly pinned Playwright1.62.1/chromium1234 directory}"
: "${R125_NODE:?readonly Node24.19 executable}"
: "${R125_SCRATCH:?fresh owned writable empty directory}"
: "${R125_CPUSET:?two allowed CPU IDs, e.g.0,1}"
: "${R125_NAME:?exclusive unique container name}"
cleanup() {
  # Exact owned name only. External container cleanup remains a separate gate.
  timeout 10s docker inspect --format '{{.Id}} {{.State.Running}} {{.State.ExitCode}} {{.State.OOMKilled}}' "$R125_NAME" > "$R125_SCRATCH/container-terminal.txt" 2>/dev/null || true
  timeout 15s docker rm --force "$R125_NAME" > "$R125_SCRATCH/container-removal.txt" 2>/dev/null || true
}
trap cleanup EXIT HUP INT TERM
# Root must independently validate image, mounts, quota, memory/swap, network,
# init, terminal state and exact-ID removal. Process exit is insufficient.
timeout --signal=TERM --kill-after=2s 215s docker run --name "$R125_NAME" \
 --init --cpus=2 --cpuset-cpus="$R125_CPUSET" --memory=6g --memory-swap=6g \
 --network=none --user="$(id -u):$(id -g)" --read-only --tmpfs=/tmp:rw,nosuid,nodev,size=256m \
 --mount="type=bind,src=$R125_SOURCE,dst=/source,readonly" \
 --mount="type=bind,src=$R125_HARNESS,dst=/harness,readonly" \
 --mount="type=bind,src=$R125_DEPS,dst=/deps,readonly" \
 --mount="type=bind,src=$R125_NODE,dst=/runtime/node,readonly" \
 --mount="type=bind,src=$R125_SCRATCH,dst=/scratch" \
 --env=R125_CONTAINER_GO=root-reviewed-docker-hard --env="R125_IMAGE_DIGEST=$R125_IMAGE" \
 --entrypoint=python3 "$R125_IMAGE" /harness/docker-hard-entry.py
