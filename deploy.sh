#!/usr/bin/env bash
#
# Build the API image and ship it to the EC2 box.
#
#   ./deploy.sh                 build, ship, restart, wait for healthy
#   ./deploy.sh --skip-build    ship the vpsischool-api:prod image already built
#   ./deploy.sh --yes           do not ask before touching the server
#   ./deploy.sh --rollback      put the previous image back and restart
#
# The long-form version is DEPLOY.md, section 5 Option A. This script is those
# steps plus the checks that are easy to forget — chiefly that the image is
# built for the server's architecture and not this laptop's, which otherwise
# shows up as a container restarting for ever with "exec format error".
set -euo pipefail

HOST=ubuntu@3.26.219.236
KEY=../vpsi-api.pem
IMAGE=vpsischool-api:prod
PREVIOUS=vpsischool-api:previous
COMPOSE='docker compose --env-file .env.production -f docker-compose.prod.yml'
REMOTE_DIR='~/vpsischool-api'
# Relative, so it lands in the login user's home — see the note by the transfer.
REMOTE_TARBALL='api-prod.tar.gz'

build=true
assume_yes=false
rollback=false
for arg in "$@"; do
  case "$arg" in
    --skip-build) build=false ;;
    --yes|-y)     assume_yes=true ;;
    --rollback)   rollback=true ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

cd "$(dirname "$0")"

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\n\033[31m%s\033[0m\n' "$*" >&2; exit 1; }
on_server() { ssh -i "$KEY" "$HOST" "$@"; }

[ -f "$KEY" ] || fail "the deploy key is not at $KEY (it belongs in VPSI-SCHOOL/, beside the two project folders)"

# ── Rollback is its own short path ──────────────────────────────────────────
if $rollback; then
  say "putting $PREVIOUS back"
  on_server "docker image inspect $PREVIOUS >/dev/null" \
    || fail "there is no $PREVIOUS on the server to go back to"
  on_server "docker tag $PREVIOUS $IMAGE && cd $REMOTE_DIR && $COMPOSE up -d --no-build"
  say "waiting for it to come up"
  on_server "sleep 12 && curl -fsS localhost:3000/v1/health/ready" || fail "it did not come back healthy"
  printf '\n\033[32mrolled back\033[0m\n'
  exit 0
fi

# ── Reachable? ──────────────────────────────────────────────────────────────
say "1/6  checking the server answers"
on_server 'echo "     $(hostname) up $(uptime | sed "s/.*up //;s/,.*user.*//")"' \
  || fail "cannot reach $HOST — check the security group still allows SSH from this address"

# A transfer that died half way leaves a part-file sitting on the disk, and the
# next run would be measuring its free space against it.
on_server "rm -f $REMOTE_TARBALL /tmp/api-prod.tar.gz"

# ── The thing this script exists to prevent ─────────────────────────────────
if $build; then
  say "2/6  building for linux/amd64"
  docker buildx build --platform linux/amd64 --target production -t "$IMAGE" --load .
else
  say "2/6  skipping the build, shipping the $IMAGE that is here"
fi

arch=$(docker image inspect "$IMAGE" --format '{{.Os}}/{{.Architecture}}' 2>/dev/null) \
  || fail "no local image $IMAGE — run without --skip-build"
[ "$arch" = "linux/amd64" ] \
  || fail "the image is $arch; the server is linux/amd64 and would restart for ever on it"
printf '     %s, %s\n' "$arch" "$(docker image inspect "$IMAGE" --format '{{.Id}}' | cut -c8-19)"

# ── Confirm, and say out loud what has to have happened first ───────────────
if ! $assume_yes; then
  cat <<EOF

  About to replace the API the school is using.

  Anything this release needs done to the database — a migrate:* script, or
  seed:roles for a new resource — has to have been run already. The API builds
  its indexes at boot and will fail on data the migration has not fixed yet.
EOF
  printf '\nGo ahead? [y/N] '
  read -r reply
  case "$reply" in [yY]*) ;; *) echo "stopped."; exit 1 ;; esac
fi

# ── Keep a way back ─────────────────────────────────────────────────────────
say "3/6  tagging what is running now as $PREVIOUS"
on_server "docker image inspect $IMAGE >/dev/null 2>&1 && docker tag $IMAGE $PREVIOUS && echo '     kept' || echo '     nothing running yet to keep'"

# ── Ship ────────────────────────────────────────────────────────────────────
# Into a temp file rather than the project folder: this is ~480 MB uncompressed
# and there is no reason for it to outlive the deploy.
say "4/6  shipping the image"
tarball=$(mktemp -t vpsi-api-XXXXXX).tar.gz
trap 'rm -f "$tarball"' EXIT
docker save "$IMAGE" | gzip -6 > "$tarball"

size_mb=$(( $(wc -c < "$tarball") / 1024 / 1024 ))
printf '     %s MB to send\n' "$size_mb"

# Staged in the home directory, not /tmp. On this instance /tmp is a 455 MB
# tmpfs — a RAM disk, on a box with 908 MB of RAM — so an image larger than that
# cannot land there at all: the transfer dies at whatever percent fills it, with
# "scp: write remote ...: Failure" after minutes of healthy-looking progress,
# which reads as a network fault rather than a full disk. The home directory is
# on the root volume, which has room to spare.
free_mb=$(on_server "df -Pm . | awk 'NR==2 {print \$4}'")
printf '     %s MB free on the server\n' "$free_mb"
if [ "$free_mb" -lt "$(( size_mb + 200 ))" ]; then
  fail "not enough room on the server: ${free_mb} MB free for a ${size_mb} MB image.
     'docker image prune -a' on the server clears images nothing is running."
fi

scp -i "$KEY" -C "$tarball" "$HOST:$REMOTE_TARBALL"
on_server "gunzip -c $REMOTE_TARBALL | docker load && rm -f $REMOTE_TARBALL"

# ── Start ───────────────────────────────────────────────────────────────────
# --env-file on every compose call: without it compose reads .env, which is the
# development configuration.
say "5/6  restarting"
on_server "cd $REMOTE_DIR && $COMPOSE up -d --no-build"

# ── Healthy, not merely running ─────────────────────────────────────────────
# /v1/health/ready is the one that actually talks to Atlas; a container can be
# 'running' and unable to reach the database.
say "6/6  waiting for the database to answer"
for attempt in $(seq 1 12); do
  if ready=$(on_server 'curl -fsS localhost:3000/v1/health/ready' 2>/dev/null); then
    printf '     %s\n' "$ready"
    printf '\n\033[32mdeployed\033[0m — http://3.26.219.236:3000/v1/health\n'
    exit 0
  fi
  printf '     not ready yet (%s/12)\n' "$attempt"
  sleep 5
done

on_server "cd $REMOTE_DIR && $COMPOSE logs --tail 40 api" || true
fail "it never reported ready. The log is above.

  Go back with:   ./deploy.sh --rollback"
