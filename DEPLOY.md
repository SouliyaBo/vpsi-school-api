# Deploying the API to EC2

Target: `3.106.78.209` (an Elastic IP, so it survives a stop/start), in **ap-southeast-2 (Sydney)** — instance
`i-0fa4411b00cb39609`. The S3 buckets are in Singapore; the Console has to be
switched to Sydney before this box appears in it.

What runs on the box: Caddy, the API, the queue worker that shares its image,
and the Redis those two use. MongoDB stays on Atlas — there is no database to
move. Caddy is the only thing the internet reaches: HTTPS for
`api.vpsischool.com`, and the admin SPA's files at `vpsischool.com` — see
section 8.

```text
                          ┌─────────────────────────────────────────────┐
  https://vpsischool.com  │  caddy  ──► ./admin  (the SPA's files)      │
  https://api.vpsischool  │    │                                        │
          .com  ── :443 ─►│    └────► api      (node dist/main)         │
                          │           worker   (WORKER_MODE=true)  ─────┼──► Atlas
                          │           redis    (private)                │
                          └─────────────────────────────────────────────┘
```

---

## 1. Open the ports

In the EC2 security group, inbound:

| Port | Source | Why |
| --- | --- | --- |
| 22 | your IP only | SSH. Not `0.0.0.0/0`. |
| 80 | `0.0.0.0/0` | Let's Encrypt proves the domain over it; Caddy redirects the rest to 443. |
| 443 | `0.0.0.0/0` | Caddy — the admin and the API. |
| 3000 | nobody, once section 8 is done | The API in plain HTTP. Open only while the old S3 page still calls it. |

Redis is not published at all — only the two containers on the compose network
reach it.

In **Atlas → Network Access**, add the instance's public IP to the access list.
Without it the API hangs on connect and never passes readiness.

## 2. Install Docker on the instance

The instance logs in as `ubuntu`, so this is an Ubuntu AMI. From your laptop:

```bash
chmod 400 vpsi-api.pem          # ssh refuses a key others can read
ssh -i vpsi-api.pem ubuntu@3.106.78.209
```

Everything below runs on the server.

### 2a. Remove anything conflicting

Ubuntu's own `docker.io` / `docker-compose` packages are older and provide
`docker-compose` v1, which cannot read this project's compose file. They have to
go before Docker's own packages go on. Nothing here is installed on a fresh AMI,
so expect "not installed" messages — that is the intended outcome, not an error.

```bash
for pkg in docker.io docker-doc docker-compose docker-compose-v2 podman-docker containerd runc; do
  sudo apt-get remove -y $pkg
done
```

### 2b. Add Docker's apt repository

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl

sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update
```

`$(dpkg --print-architecture)` and `$VERSION_CODENAME` are read from the machine,
so the same block works on x86 or Graviton and on 22.04 or 24.04 without editing.

### 2c. Install the engine and the compose plugin

```bash
sudo apt-get install -y \
  docker-ce docker-ce-cli containerd.io \
  docker-buildx-plugin docker-compose-plugin
```

`docker-compose-plugin` is what provides `docker compose` (a subcommand, two
words). The old standalone `docker-compose` binary is a different, unsupported
tool — this project's compose file needs the plugin.

### 2d. Run docker without sudo

```bash
sudo usermod -aG docker $USER
```

Group membership is only read at login, so this does nothing to the current
shell. Log out and back in:

```bash
exit
ssh -i vpsi-api.pem ubuntu@3.106.78.209
```

### 2e. Verify

```bash
docker --version
docker compose version           # must print v2.x
systemctl is-enabled docker      # "enabled" — survives a reboot
systemctl is-active docker       # "active"
docker run --rm hello-world      # proves the daemon works without sudo
```

If `docker run` says `permission denied` on the socket, the re-login in 2d did
not take — check `groups` for `docker`.

### 2f. Add swap if the instance is small

```bash
free -h
```

Building the image runs `npm ci` and `nest build` in one container, and on a
1 GB instance (`t2.micro`, `t3.micro`) the compiler gets OOM-killed part way
through — which surfaces as a build that dies with no clear error. If `free -h`
shows less than about 2 GB total and no swap, add some:

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab   # survives reboot
free -h                                                       # confirm Swap: 2Gi
```

Skip this on a 2 GB instance or larger.

## 3. Copy the code up

There is no git remote for this project yet, so copy the directory. Run from
your laptop, in `VPSI-SCHOOL/`:

```bash
# `ubuntu@` on an Ubuntu AMI, `ec2-user@` on Amazon Linux — use whichever the
# instance was launched with, and the same user for every command below.
rsync -av --delete \
  --exclude node_modules --exclude dist --exclude coverage \
  --exclude .env --exclude .git \
  -e "ssh -i vpsi-api.pem" \
  vpsischool-api/ ubuntu@3.106.78.209:~/vpsischool-api/
```

`--exclude .env` is deliberate: that is the development file. The production one
is written directly on the server in the next step and never leaves it.

(Once the project is in git, replace this with a `git pull` on the server.)

## 4. Write the production env file

On the server:

```bash
cd ~/vpsischool-api
cp .env.production.example .env.production
```

Generate the secrets — three different values, never reused:

```bash
echo "REDIS_PASSWORD=$(openssl rand -hex 24)"
echo "JWT_ACCESS_SECRET=$(openssl rand -hex 48)"
echo "JWT_REFRESH_SECRET=$(openssl rand -hex 48)"
```

Paste those into `.env.production`, then fill in `MONGODB_URI`, the four `S3_*`
values, and `CORS_ORIGINS`. Every line still reading `CHANGE_ME` will fail the
container at boot.

```bash
chmod 600 .env.production
grep -c CHANGE_ME .env.production   # must print 0
```

### The S3 bucket

The API mints short-lived **signed** URLs for photos and documents, and an S3
signature covers the `Host` header — so the browser has to fetch the object from
exactly the host in `S3_ENDPOINT`. Real S3 gives you that; a MinIO container on
this same box does not, because from inside the instance a container cannot
reach the instance's own public IP (AWS does not hairpin it). Use S3 unless you
have a domain name to point at MinIO.

```bash
aws s3api create-bucket --bucket vpsi-school-images \
  --region ap-southeast-1 \
  --create-bucket-configuration LocationConstraint=ap-southeast-1
```

Keep the bucket private — the signed URLs are the access mechanism, and a public
bucket makes them pointless. Create an IAM user limited to
`s3:GetObject`/`PutObject`/`DeleteObject` on `arn:aws:s3:::vpsi-school-images/*`
plus `s3:ListBucket` on the bucket, and put its keys in `.env.production`.

The API starts and serves every non-file route even when the bucket is
unreachable, so you can defer this — uploads fail, nothing else does.

## 5. Build and start

The instance is 2 vCPU with 908 MiB of RAM (Ubuntu 26.04, amd64). Building there works — there is a
2 GB swapfile to fall back on — but `npm ci` followed by the TypeScript compiler
(measured at a 536 MB peak on its own) is slow and close to the edge. Building
elsewhere and shipping the image avoids it, and also means no source code and no
toolchain on the server.

### Option A — build on your machine, ship the image (recommended)

**Build for the server's architecture, not yours.** The instance is `amd64`; an
Apple Silicon Mac produces `arm64` by default, and the container then dies in a
restart loop with `exec /usr/local/bin/docker-entrypoint.sh: exec format error`.
The `--platform` flag is what prevents that:

```bash
# On your machine, in vpsischool-api/
docker buildx build --platform linux/amd64 --target production \
  -t vpsischool-api:prod --load .

# Sanity-check before spending time on the transfer
docker image inspect vpsischool-api:prod --format '{{.Os}}/{{.Architecture}}'
# must print linux/amd64
```

Then ship it — about 464 MB gzipped, most of it LibreOffice:

```bash
docker save vpsischool-api:prod | gzip -6 > api-prod.tar.gz
scp -i vpsi-api.pem -C api-prod.tar.gz ubuntu@3.106.78.209:~/

ssh -i vpsi-api.pem ubuntu@3.106.78.209 \
  'gunzip -c ~/api-prod.tar.gz | docker load && rm ~/api-prod.tar.gz'
```

**Not `/tmp`.** On this instance `/tmp` is a 455 MB tmpfs — a RAM disk, on a box
with 908 MB of RAM — so the image cannot land there at all. The transfer dies at
whatever percent fills it with `scp: write remote ...: Failure`, which after
several minutes of healthy progress reads as a network fault rather than a full
disk, and leaves a part-file holding onto the memory until somebody deletes it.
The home directory is on the root volume, which has about 5 GB free.

The size is worth knowing about: `libreoffice-draw` and `libreoffice-common` are
927 MB of the 1.2 GB image on their own. They are load-bearing — they are what
turns the WMF equations in an uploaded Word exam paper into PNGs — so this is a
cost rather than a mistake. It does mean every deploy re-sends layers the server
already has, which a registry (ECR) would avoid if the transfer ever becomes the
thing that hurts.

Only `docker-compose.prod.yml` and `.env.production` need to be on the server —
`--no-build` means the build context is never read:

```bash
cd ~/vpsischool-api
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --no-build
```

### Option B — build on the server

Needs the source copied up (step 3) and the swapfile in place (step 2f):

```bash
cd ~/vpsischool-api
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

The `--env-file` flag is required on **every** compose command here. Without it
compose falls back to `.env`, which is the development configuration.

## 6. Check it came up

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml ps
```

`api` should read `healthy`, not just `running` — the healthcheck is what proves
Atlas is actually reachable.

```bash
# From the server
curl -s localhost:3000/v1/health
curl -s localhost:3000/v1/health/ready     # database: "connected"

# From your laptop
curl -s http://3.106.78.209:3000/v1/health
```

`/v1/health` and not `/health`: URI versioning applies even to the two routes
excluded from the global `api` prefix.

A real request, end to end:

```bash
curl -s -X POST http://3.106.78.209:3000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"..."}'
```

Then point the admin at it by setting `VITE_API_BASE_URL=http://3.106.78.209:3000/api/v1`
and adding that origin to `CORS_ORIGINS`.

## 7. Day-to-day

```bash
C="docker compose --env-file .env.production -f docker-compose.prod.yml"

$C logs -f api            # follow
$C logs --tail 200 worker
$C restart api
$C down                   # stop; the redis volume survives
$C down -v                # stop and delete the queue/cache too
```

Deploy a change, from your laptop in `vpsischool-api/`:

```bash
./deploy.sh
```

[deploy.sh](deploy.sh) is the Option A flow above — buildx for `linux/amd64`,
`docker save | gzip`, scp, `docker load`, `up -d --no-build` — with the checks
that are easy to forget: that the image really is amd64 before the transfer is
paid for, and that `/v1/health/ready` answers afterwards rather than the
container merely being up. It tags what is running as `vpsischool-api:previous`
first, so `./deploy.sh --rollback` is a way back. It asks before touching the
server, and the question it asks is whether the database work this release needs
has been done — that is the ordering this script cannot check for you.

Building on the server instead: rsync again, then

```bash
$C up -d --build
```

Compose replaces the containers whose image changed and leaves the rest running.

Roll back — images are tagged `vpsischool-api:prod`, so keep the previous one
before rebuilding if you want a way back:

```bash
docker tag vpsischool-api:prod vpsischool-api:previous   # before deploying
docker tag vpsischool-api:previous vpsischool-api:prod   # to revert
$C up -d --no-build
```

---

## Things to know before this is public

**Port 3000 is plain HTTP.** The login request and every bearer token after it
cross the network readable by anyone on the path. Section 8 puts HTTPS in front;
until `API_PUBLIC_PORT=127.0.0.1:3000` is set and 3000 is closed in the security
group, the plain door is still open beside it.

**Swagger is off.** `main.ts` serves it in non-production only — the schema maps
the entire attack surface. `/api/docs` will 404, which is intended.

**Do not run `npm run seed` on this deployment.** Atlas already holds the
school's data. The full seeder overwrites settings and the subject catalogue and
adds fixture teachers and classrooms. Only `npm run seed:roles` is safe on live
data, and it has already been run.

**Three bugs in the production build were fixed while preparing this.** Each one
stopped the container at startup, and none of them is visible from `npm run
build`, the test suite or the dev server — only from running the built image,
which nothing had done before:

- `nest build` emitted `dist/src/main.js`, because `tsconfig.json` includes
  `test/**/*` and TypeScript therefore inferred the project root as `rootDir`.
  The Dockerfile's `CMD ["node", "dist/main"]` and `npm run start:prod` both
  died with `Cannot find module '/app/dist/main'`. Added `tsconfig.build.json` —
  the standard Nest file this project was missing — which narrows the build to
  `src/` and keeps the specs out of the image as well.
- `all-exceptions.filter.ts` imported `MongoServerError` from `mongodb`, which
  is not a dependency of this project. It resolved locally only because the
  `mongodb-memory-server` devDependency hoisted a copy to the top of
  `node_modules`; `npm prune --omit=dev` in the build stage removes it, and the
  container died with `Cannot find module 'mongodb'`. It now comes from
  mongoose's own `mongo` re-export, which is also the more correct import —
  `instanceof` now compares against the class mongoose actually throws instead of
  a separately resolved copy that could never match.
- `npm run worker` pointed at `dist/worker`, an entrypoint no build produces. It
  now runs `WORKER_MODE=true node dist/main`, which is what `main.ts` supports
  and what the compose file uses.

The stack was then brought up end to end against the real Atlas cluster:
`/v1/health/ready` reported `database: connected`, a login returned a token, an
authenticated read came back correct, `/api/docs` 404'd as production intends,
and Redis was confirmed unpublished.

**Backups.** Atlas holds everything that matters; the only local state is the
Redis volume, which is a cache and a job queue and can be lost. Check that Atlas
has backups enabled for the cluster.

---

## 8. The domain and HTTPS

**Done 6 Nov 2026**: live on both names, 3000 bound to `127.0.0.1`, `CORS_ORIGINS`
down to `https://vpsischool.com`, and the old S3 address redirecting here. What
follows is how it was done — the record to repeat it from, on a new box.

`vpsischool.com` is registered at GoDaddy (DNS too — `ns17/ns18.domaincontrol.com`).
Caddy, a container in `docker-compose.prod.yml` configured by
[caddy/Caddyfile](caddy/Caddyfile), gets the certificates from Let's Encrypt and
renews them by itself. There is nothing to pay for and nothing to renew by hand.

| Name | Serves |
| --- | --- |
| `https://vpsischool.com` | the admin SPA, from `~/vpsischool-api/admin/` on the box |
| `https://www.vpsischool.com` | a redirect to the above |
| `https://api.vpsischool.com` | the API — `/api/v1/...`, `/v1/health` |

### Before anything on the box

1. **An Elastic IP**, allocated in **Sydney** and associated with the instance.
   An auto-assigned public IP changes whenever the instance is stopped, and DNS
   would then point at somebody else's machine. Add the Elastic IP to **Atlas →
   Network Access** *before* associating it: the moment it is associated the old
   IP is gone, and with it the API's route to the database.
2. **Security group**: 80 and 443 open to `0.0.0.0/0` (section 1).
3. **GoDaddy → Domain → DNS**: delete the parked `A @` records and add

   | Type | Name | Value |
   | --- | --- | --- |
   | A | `@` | the Elastic IP |
   | A | `api` | the Elastic IP |
   | CNAME | `www` | `@` |

   `dig +short vpsischool.com` and `dig +short api.vpsischool.com` must both
   print the Elastic IP before Caddy starts. Caddy retries if they do not, but
   Let's Encrypt's rate limits count the failures.

### Cutting over (once)

Not `./deploy.sh` — that ships a new API image as well, with whatever is
undeployed in this folder. The cut-over needs only the compose file and the
Caddyfile; the running image stays as it is, and compose leaves `api` and
`worker` alone because their configuration has not changed.

```bash
# from VPSI-SCHOOL/vpsischool-api, on your machine
rsync -a -e "ssh -i ../vpsi-api.pem" docker-compose.prod.yml caddy \
  ubuntu@3.106.78.209:~/vpsischool-api/
ssh -i ../vpsi-api.pem ubuntu@3.106.78.209
```

On the server:

```bash
cd ~/vpsischool-api
mkdir -p admin        # must exist before compose, or Docker creates it as root
C="docker compose --env-file .env.production -f docker-compose.prod.yml"

# the new admin origin, keeping the S3 one until nobody uses it
sed -i 's#^CORS_ORIGINS=.*#CORS_ORIGINS=https://vpsischool.com,http://vpsi-school-admin.s3-website-ap-southeast-1.amazonaws.com#' .env.production

$C up -d --no-build --force-recreate api   # re-reads CORS_ORIGINS
$C up -d --no-build                        # starts caddy
$C logs -f caddy                           # "certificate obtained successfully" × 3
```

Then from anywhere:

```bash
curl -s https://api.vpsischool.com/v1/health/ready
```

and deploy the admin to the box — `vpsischool-admin/deploy.sh`, see its
`DEPLOY.md`.

### Closing the old door

When `https://vpsischool.com` is what staff use:

```bash
sed -i 's#^API_PUBLIC_PORT=.*#API_PUBLIC_PORT=127.0.0.1:3000#' .env.production
sed -i 's#^CORS_ORIGINS=.*#CORS_ORIGINS=https://vpsischool.com#' .env.production
$C up -d --no-build --force-recreate api
```

and remove the 3000 rule from the security group. `deploy.sh` keeps working: it
checks readiness on `localhost:3000` from the box itself.

### What changes for the rest of the system

- **The guardian report link** is built from the admin's own origin, so it
  becomes `https://vpsischool.com/r#…` with nothing to change. This is the TLS
  that had to come before any real family gets one.
- **Web Push and a Telegram webhook** are now possible, both being HTTPS-only.
  The bot still long-polls, which keeps working as it is.
- **The Caddy volume holds the certificates.** `down -v` deletes it along with
  Redis, and Let's Encrypt issues the same certificate only five times a week.
- **Editing the Caddyfile** needs a reload, not a restart (deploy.sh does it):
  `$C exec caddy caddy reload --config /etc/caddy/Caddyfile`.

