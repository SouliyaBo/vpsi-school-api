# Deploying the API to EC2

Target: `18.140.239.33`, API only. The admin SPA is not part of this yet.

What runs on the box: the API, the queue worker that shares its image, and the
Redis those two use. MongoDB stays on Atlas — there is no database to move.

```text
                                  ┌──────────────────────────────┐
  browser / admin ──── :3000 ───► │  api      (node dist/main)   │
                                  │  worker   (WORKER_MODE=true) │──► Atlas
                                  │  redis    (private)          │
                                  └──────────────────────────────┘
```

---

## 1. Open the ports

In the EC2 security group, inbound:

| Port | Source | Why |
| --- | --- | --- |
| 22 | your IP only | SSH. Not `0.0.0.0/0`. |
| 3000 | where the admin will call from | The API. |

Redis is not published at all — only the two containers on the compose network
reach it.

In **Atlas → Network Access**, add the instance's public IP to the access list.
Without it the API hangs on connect and never passes readiness.

## 2. Install Docker on the instance

The instance logs in as `ubuntu`, so this is an Ubuntu AMI. From your laptop:

```bash
chmod 400 vpsi.school.pem          # ssh refuses a key others can read
ssh -i vpsi.school.pem ubuntu@18.140.239.33
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
ssh -i vpsi.school.pem ubuntu@18.140.239.33
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
  -e "ssh -i vpsi.school.pem" \
  vpsischool-api/ ubuntu@18.140.239.33:~/vpsischool-api/
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
aws s3api create-bucket --bucket vpsischool-files \
  --region ap-southeast-1 \
  --create-bucket-configuration LocationConstraint=ap-southeast-1
```

Keep the bucket private — the signed URLs are the access mechanism, and a public
bucket makes them pointless. Create an IAM user limited to
`s3:GetObject`/`PutObject`/`DeleteObject` on `arn:aws:s3:::vpsischool-files/*`
plus `s3:ListBucket` on the bucket, and put its keys in `.env.production`.

The API starts and serves every non-file route even when the bucket is
unreachable, so you can defer this — uploads fail, nothing else does.

## 5. Build and start

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
curl -s http://18.140.239.33:3000/v1/health
```

`/v1/health` and not `/health`: URI versioning applies even to the two routes
excluded from the global `api` prefix.

A real request, end to end:

```bash
curl -s -X POST http://18.140.239.33:3000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"..."}'
```

Then point the admin at it by setting `VITE_API_BASE_URL=http://18.140.239.33:3000/api/v1`
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

Deploy a change: rsync again, then

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

**There is no TLS.** Traffic to `:3000` is plain HTTP, and that includes the
login request and every bearer token after it — anyone on the path can read
them. This is fine for testing from a known address and not fine for a school's
real data. Fixing it needs a **domain name**; a certificate cannot be issued for
a bare IP. Once you have one, either:

- put an AWS Application Load Balancer with an ACM certificate in front and
  point the API at it (`API_PUBLIC_PORT` can then bind to localhost only), or
- add Caddy or nginx on the box with Let's Encrypt.

Say the word and I will write whichever you pick.

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
