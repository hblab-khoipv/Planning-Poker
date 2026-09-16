# Deploying Planning Poker to EC2

The deployment target is **one EC2 instance** running the Next.js web app, the Express + Socket.io
API and Postgres — the reason the project chose self-hosting over Supabase (see `README.md`).

There are two supported topologies for the TLS/routing layer in front of those two processes, and
they are the fork every other section branches on:

|                     | **A — Nginx on the box**                    | **B — AWS load balancer**                    |
| ------------------- | ------------------------------------------- | -------------------------------------------- |
| TLS terminates at   | Nginx + certbot on the instance             | an ALB, with an ACM certificate              |
| Routing by hostname | `deploy/nginx/planning-poker.conf.template` | ALB listener rules → target groups           |
| Ports 3000/4000     | loopback only                               | reachable from the ALB's security group      |
| OS assumed          | Ubuntu 24.04 (`bootstrap-server.sh`)        | any; the live box is Amazon Linux            |
| Set up by           | `deploy/scripts/bootstrap-server.sh`        | the AWS console/CLI, then §7's manual script |

**Topology B is what is live today** (`planningpoker.hblab.dev`, confirmed 2026-09-16). Topology A
is kept, unchanged and still valid, for anyone running without a load balancer. Nothing in `deploy/`
was deleted for B; §1 describes A, §1.1 describes B, and §7 is the one-command manual deploy that
was written for B.

> **Status of the CI deploy path.** `.github/workflows/deploy.yml` and `deploy/scripts/deploy.sh`
> were written and rehearsed under `DEPLOY_SIMULATE=true`. Read §5 before relying on them; the
> manual path in §7 is what a human runs on the box.

---

## 1. What the box looks like

```
                     :443  Nginx  ── poker.example.com ──────▶ 127.0.0.1:3000  Next.js (systemd)
  browser ──────────▶       └───── api.poker.example.com ────▶ 127.0.0.1:4000  Express + Socket.io
                                    (incl. /socket.io/ upgrade)       │
                                                                      ▼
                                                        127.0.0.1:5432  Postgres (docker compose)
```

**Why two hostnames.** The web app serves `/rooms/:code` as an HTML page and the API serves
`/rooms/:code` as JSON, so a single hostname cannot route both by path. The API gets
`api.<domain>`; `AUTH_COOKIE_DOMAIN=.<domain>` is what keeps NextAuth's session cookie reaching it
(`apps/web/src/server/auth/cookie-domain.ts`), which is what lets the API tell a signed-in member
from a guest.

**Why systemd and not pm2.** The instance already runs systemd, so it costs nothing extra: boot
ordering, restart-on-crash, journald logs and `systemctl status` all come for free, with no global
npm package and no supervisor-of-the-supervisor to keep alive. Units live in `deploy/systemd/`.

**Why Postgres in Docker.** One `docker compose up -d` with the repo's existing
`docker-compose.yml`, the same image and the same env names as local dev and CI. Swap
`DATABASE_URL` for an RDS endpoint later and nothing else changes.

---

## 1.1 Behind an AWS load balancer (topology B — the live setup)

```
                          ALB (TLS terminates here, ACM cert)
                           │  host planningpoker.hblab.dev      ──▶ target group :3000  Next.js
  browser ────── :443 ────▶┤
                           │  host api.planningpoker.hblab.dev  ──▶ target group :4000  Express + Socket.io
                                                                        │
                                                          127.0.0.1:5432  Postgres (docker compose)
```

**No Nginx and no certbot on the instance.** The ALB does what Nginx did: terminate TLS and route
by hostname. `deploy/nginx/` and the certbot half of `bootstrap-server.sh` do not apply here —
they stay in the repo for topology A.

**Listener rules.** One HTTPS:443 listener, two host-header rules:

| Host header    | Forward to                                   | Health check                        |
| -------------- | -------------------------------------------- | ----------------------------------- |
| `<domain>`     | target group on the instance's port **3000** | `HTTP :3000 /`, matcher `200`       |
| `api.<domain>` | target group on the instance's port **4000** | `HTTP :4000 /health`, matcher `200` |

Add an HTTP:80 listener that redirects to HTTPS if you want the bare-http convenience.

**Health check the API on `/health`, never on `/health/db`.** `/health` is liveness: it answers as
long as the process is up. `/health/db` queries Postgres (`apps/api/src/app.ts`), so a transient
database blip would fail the check and the ALB would pull the only instance out of service —
turning a recoverable database hiccup into a full outage. Use `/health/db` by hand, or from a
monitor that pages instead of one that deregisters.

**WebSockets.** Socket.io needs the HTTP upgrade to survive, so on the API target group:

- keep the protocol HTTP/1.1 (an ALB with HTTP/2 to the target breaks the upgrade);
- raise the idle timeout above Socket.io's ping interval (60s is comfortable; the default 60s is
  the floor, not a margin);
- deregistration delay of ~30s so a restart drains long-lived connections instead of cutting them.

**Sticky sessions.** With exactly one instance they are unnecessary. **The moment a second
instance joins the API target group they become mandatory** — Socket.io's HTTP long-polling
handshake makes several requests that must all land on the same process, and this app keeps room
presence in the process that owns the socket (`apps/api/src/realtime/presence.ts`), not in
Postgres or Redis. Without stickiness a second instance produces sockets that connect and
immediately drop, and rooms whose participant list depends on which instance answered. Enable
load-balancer-generated cookie stickiness on the API target group before scaling out.

**Security group.** The instance's group must allow **3000/tcp and 4000/tcp from the ALB's
security group** (source = the security group, not a CIDR), plus 22/tcp from your own network.
Ports 80/443 are on the ALB, not the instance, and 5432 stays closed — Postgres is on loopback.

**Cookies still need `AUTH_COOKIE_DOMAIN`.** Two hostnames is two hostnames regardless of what
terminates TLS: set it to the registrable domain (`.planningpoker.hblab.dev`) so NextAuth's
session cookie reaches `api.<domain>`. See the gotcha list in §7.

---

## 2. Provisioning the instance

| Item       | Value                                                                                                         |
| ---------- | ------------------------------------------------------------------------------------------------------------- |
| AMI        | Ubuntu Server 24.04 LTS (x86_64)                                                                              |
| Type       | `t3.small` (2 GB RAM — `next start` plus the API plus Postgres does not fit comfortably in `t3.micro`'s 1 GB) |
| Storage    | 20 GB gp3                                                                                                     |
| Elastic IP | yes — DNS points at it, so it must survive a stop/start                                                       |
| Key pair   | a dedicated deploy key; its **private** half becomes `EC2_SSH_PRIVATE_KEY`                                    |

Security group — inbound:

| Port    | Source                                    | Why                                                   |
| ------- | ----------------------------------------- | ----------------------------------------------------- |
| 22/tcp  | your office/VPN CIDR, **not** `0.0.0.0/0` | SSH for the deploy and for you                        |
| 80/tcp  | `0.0.0.0/0`                               | HTTP→HTTPS redirect and certbot's `http-01` challenge |
| 443/tcp | `0.0.0.0/0`                               | the app                                               |

Nothing else. Postgres (5432), the web app (3000) and the API (4000) are **not** exposed — Nginx
reaches them on loopback. Outbound: default allow-all (apt, NodeSource, Docker Hub, Let's Encrypt).

DNS: `A` records for `<domain>` **and** `api.<domain>` pointing at the Elastic IP. Both must
resolve before certbot runs, or the certificate request fails.

---

## 3. First-time setup, on the box

```bash
ssh ubuntu@<elastic-ip>
# copy this repo's deploy/ directory over, or clone the repo once:
git clone https://github.com/hblab-khoipv/Planning-Poker.git /tmp/pp && cd /tmp/pp

sudo APP_DOMAIN=poker.example.com LETSENCRYPT_EMAIL=you@example.com \
     bash deploy/scripts/bootstrap-server.sh
```

> **`bootstrap-server.sh` is Ubuntu-only, and topology-A-only.** It calls `apt-get` and
> `deb.nodesource.com` directly, and it installs Nginx + certbot. On **Amazon Linux** (SSH user
> `ec2-user`) it will fail on the first `apt-get` line, and behind a load balancer you would not
> want its second half anyway. See the Amazon Linux steps below.

`deploy/scripts/bootstrap-server.sh` installs Node 22, Docker, Nginx and certbot; creates the
`planningpoker` service account and `/opt/planning-poker/{releases,env}`; installs both systemd
units; renders `deploy/nginx/planning-poker.conf.template` for your domain; and requests one
certificate covering `<domain>` and `api.<domain>`. Renewal is certbot's own systemd timer.

### Amazon Linux 2023, behind the load balancer

There is no bootstrap script for this path — it is short enough to be a checklist, and every step
is idempotent:

```bash
sudo dnf install -y git docker
sudo systemctl enable --now docker
sudo usermod -aG docker ec2-user          # log out and back in for this to take effect

# Node 22 (NodeSource has an el9 repo; nvm works just as well for a single-user box)
curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -
sudo dnf install -y nodejs

# The box does not need a git checkout — the laptop rsyncs a built release into this directory.
mkdir -p /home/ec2-user/api/deploy/env
# Write api.env, web.env and postgres.env there by hand (§4 lists every key), plus
# box-restart.env from deploy/env/box-restart.env.example once the first push has landed.
```

The env files live **only** on the box: the push in §7 excludes `deploy/env/` from its rsync, so
they survive every deploy and never travel over the wire.

No Nginx, no certbot, no DNS-before-certificate ordering: the ALB owns all of that. Installing the
systemd units is optional and independent — see §7.

Then start the database:

```bash
cd /opt/planning-poker
sudo docker compose --env-file env/postgres.env up -d
```

The script has **never been executed** — no instance exists. Read it before the first run.

---

## 4. Secrets and variables

Create these on `hblab-khoipv/Planning-Poker` (Settings → Secrets and variables → Actions). Every
one already exists with a placeholder; replace the placeholders with real values.

### Secrets — never echoed by the workflow

| Secret                 | What it is                                                                                                                                                                   |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EC2_SSH_PRIVATE_KEY`  | Private half of the deploy key pair, full PEM including the BEGIN/END lines. Used to rsync the release and run `remote-release.sh`.                                          |
| `EC2_HOST`             | The instance's Elastic IP or DNS name. A secret rather than a variable so the host is not in public logs.                                                                    |
| `DATABASE_URL`         | `postgresql://planning_poker:<POSTGRES_PASSWORD>@localhost:5432/planning_poker`. Read by **both** apps — the API owns the schema, NextAuth's adapter uses the same database. |
| `NEXTAUTH_SECRET`      | JWT/JWE signing secret (`openssl rand -base64 32`). `apps/api` verifies the session cookie with the _same_ value; they must match or every signed-in caller becomes a guest. |
| `POSTGRES_PASSWORD`    | Password for the Postgres container. Must be the same password embedded in `DATABASE_URL`.                                                                                   |
| `GOOGLE_CLIENT_ID`     | Google OAuth client id. Leave the placeholder to ship without the Google button — the app boots fine with email/password only.                                               |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret. Same.                                                                                                                                            |

Google's authorized redirect URI must be `https://<domain>/api/auth/callback/google`.

### Variables — safe in logs

| Variable                     | Placeholder           | What it is                                                                                                                                                                                               |
| ---------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DEPLOY_SIMULATE`            | `true`                | **The switch.** `true` prints every host-touching command instead of running it. Set to `false` for a real deploy. Anything other than the literal `false` keeps simulation on, so a typo cannot deploy. |
| `AWS_REGION`                 | `REPLACE_ME`          | Region the instance lives in. Recorded for operators and future AWS-CLI steps.                                                                                                                           |
| `EC2_USER`                   | `ubuntu`              | SSH user on the box (`ubuntu` for the Ubuntu AMI).                                                                                                                                                       |
| `APP_DOMAIN`                 | `REPLACE_ME`          | Apex hostname, e.g. `poker.example.com`. The API is always `api.<APP_DOMAIN>`.                                                                                                                           |
| `NEXT_PUBLIC_API_URL`        | `REPLACE_ME`          | `https://api.<APP_DOMAIN>`. **Baked into the browser bundle at build time**, so changing it needs a rebuild, not just a restart.                                                                         |
| `NEXTAUTH_URL`               | `REPLACE_ME`          | `https://<APP_DOMAIN>`. NextAuth builds its callback URLs from this.                                                                                                                                     |
| `AUTH_COOKIE_DOMAIN`         | `REPLACE_ME`          | `.<APP_DOMAIN>` (leading dot). Widens the session cookie to the API subdomain. Empty ⇒ NextAuth defaults ⇒ signed-in users look like guests to the API.                                                  |
| `CORS_ORIGIN`                | `REPLACE_ME`          | `https://<APP_DOMAIN>`. Comma-separated list the API accepts for REST and Socket.io.                                                                                                                     |
| `API_PORT`                   | `4000`                | Loopback port for the API. Written into `api.env` as `PORT`, which is what `apps/api/src/config.ts` reads.                                                                                               |
| `SOCKET_DISCONNECT_GRACE_MS` | `5000`                | How long a dropped socket keeps its seat online before it counts as leaving (PRD §12).                                                                                                                   |
| `ROOM_IDLE_HOURS`            | `24`                  | How long a room may sit unused before the in-process sweep deletes it and everything in it (FR-10). Unset ⇒ 24h.                                                                                         |
| `ROOM_CLEANUP_INTERVAL_MS`   | `300000`              | How often that sweep runs. Unset ⇒ 5 minutes.                                                                                                                                                            |
| `ROOM_CLEANUP_ENABLED`       | `true`                | Set to `false` to run a box that never deletes rooms. Unset ⇒ enabled.                                                                                                                                   |
| `DEPLOY_PATH`                | `/opt/planning-poker` | Release root on the box.                                                                                                                                                                                 |

A worked example for `poker.example.com`:

```
APP_DOMAIN            poker.example.com
NEXT_PUBLIC_API_URL   https://api.poker.example.com
NEXTAUTH_URL          https://poker.example.com
AUTH_COOKIE_DOMAIN    .poker.example.com
CORS_ORIGIN           https://poker.example.com
```

---

## 5. The deploy workflow

`.github/workflows/deploy.yml`, triggered on push to `main`, on `workflow_dispatch`, and on pull
requests that touch the deployment machinery.

```
build            npm ci → npm run build (shared, api, web, with NEXT_PUBLIC_API_URL)
                 → deploy/scripts/stage-release.sh  → release artifact (~4 MB)
deploy           download artifact
                 → resolve mode (DEPLOY_SIMULATE, PR runs are always simulated)
                 → deploy/scripts/render-env.sh     (real in both modes; logs key names only)
                 → deploy/scripts/deploy.sh         (6 steps, gated)
```

The six gated steps: install the SSH key → `ssh-keyscan` the host → `rsync` the release →
`ssh … remote-release.sh` → health-check `https://api.<domain>/health/db` → health-check
`https://<domain>/`.

**One script, two modes.** `deploy/scripts/lib.sh`'s `run_step` is the only place `DEPLOY_SIMULATE`
is consulted; it prints the host, path and exact command and returns 0, or executes the very same
argv. There is no separate dry-run implementation that could drift, so a simulated run is a real
rehearsal — the build genuinely builds, staging genuinely fails if a build artifact is missing, and
the env rendering genuinely fails if a value is malformed.

**Secrets never reach the log.** The echo is built from a display string using `secret_ref`, which
prints `$NAME«secret»`, not the value; `render-env.sh` prints names and character counts only.

### Going live

1. Fill in every secret and variable above with real values.
2. Provision the instance and run the bootstrap (sections 2–3).
3. Set `DEPLOY_SIMULATE` to **`false`**.
4. Run the **Deploy** workflow (`workflow_dispatch`) — or push to `main`.
5. Watch the six steps switch from `[SIMULATED] skipped` to `[LIVE] executing`.

A `workflow_dispatch` run can tick **Simulate** to rehearse even when the repository variable says
`false`; the reverse is impossible on purpose — going live has to be the repository's decision.
Pull-request runs are forced to simulate regardless.

### Rolling back

Releases are kept under `/opt/planning-poker/releases/<sha>/` (the five most recent). To roll back,
re-point the symlink and restart:

```bash
sudo ln -sfn /opt/planning-poker/releases/<previous-sha> /opt/planning-poker/current.new
sudo mv -Tf /opt/planning-poker/current.new /opt/planning-poker/current
sudo systemctl restart planning-poker-api planning-poker-web
```

Migrations are not rolled back — check what the newer release applied before going backwards.

---

## 6. Operating the box

```bash
sudo systemctl status planning-poker-api planning-poker-web
sudo journalctl -u planning-poker-api -f
sudo journalctl -u planning-poker-web -f
sudo nginx -t && sudo systemctl reload nginx
sudo certbot renew --dry-run
curl -s https://api.<domain>/health      # liveness
curl -s https://api.<domain>/health/db   # readiness — actually queries Postgres
```

Database backups are **not** set up. `docker compose` keeps the data in the `postgres-data` volume
on the instance's EBS disk; take EBS snapshots, or move to RDS, before anything real depends on it.

---

## 7. The hand deploy (what the captain runs today)

Two scripts, one on each side. This is the **primary path**; the CI workflow in §5 is back in
simulation (`DEPLOY_SIMULATE=true`) and merging to `main` does not touch the server.

```
  LAPTOP                                                    BOX (ec2-user@…, Amazon Linux)
  deploy/scripts/push-from-laptop.sh                        deploy/scripts/restart-on-box.sh
    1 npm ci && npm run build                                 1 prerequisites + env sanity checks
      (NEXT_PUBLIC_API_URL exported FIRST)                     2 npm ci --omit=dev if manifests changed
    2 stage-release.sh  → build output + manifests             3 docker compose up postgres, wait for it
    3 rsync -az --delete  ───────────────────────────────▶     4 node apps/api/dist/db/migrate-cli.js
    4 ssh … restart-on-box.sh  ──────────────────────────▶     5 restart: systemd units, else background
                                                               6 curl :4000/health   — fail loudly
                                                               7 curl :3000/         — fail loudly
```

### One-time setup

```bash
# on the laptop
cp deploy/env/laptop-push.env.example deploy/env/laptop-push.env   # SSH_HOST, SSH_KEY, NEXT_PUBLIC_API_URL
# on the box, once (see §3): deploy/env/{api,web,postgres}.env, then after the first push:
cp deploy/env/box-restart.env.example deploy/env/box-restart.env
```

Both config files are git-ignored, and every value either script needs lives in one of them —
neither script hard-codes a host, a path or a port.

### Every deploy

```bash
bash deploy/scripts/push-from-laptop.sh --dry-run   # prints the plan, rsync -n, changes nothing
bash deploy/scripts/push-from-laptop.sh             # build → stage → rsync → restart → health check
```

`--dry-run` still contacts the box (rsync's own `-n`), so it is also the cheapest check that SSH,
the user and the remote path are right before a real push.

What is shipped is the release tree from `deploy/scripts/stage-release.sh` — `package.json`,
`package-lock.json`, `docker-compose.yml`, `packages/shared/dist`, `apps/api/dist`,
`apps/web/.next` (minus the webpack cache) and `deploy/`, about 4.4 MB. Never `node_modules`,
`.git`, sources or tests: the box runs `npm ci --omit=dev` against the shipped lockfile.
`deploy/env/`, `node_modules/` and `.deploy-run/` are excluded from the `--delete`, so what the
box owns survives the sync.

### Restarting without pushing

`restart-on-box.sh` is safe to run on its own and to run twice in a row:

```bash
ssh ec2-user@<box> 'cd /home/ec2-user/api && bash deploy/scripts/restart-on-box.sh'
```

It picks its own process shape: **systemd** when both units from `deploy/systemd/` are installed
(`sudo install -m 644 deploy/systemd/*.service /etc/systemd/system/ && sudo systemctl daemon-reload`),
otherwise **plain background processes** with pidfiles and logs under `.deploy-run/`. Background
processes survive the SSH session but **not a reboot** — install the units when you want the box
to come back up on its own. Either way the script verifies afterwards: it re-checks the pid it
started and fails if the health check would otherwise be answered by an older process on the same
port.

### Health checks are the finish line, not a flourish

The script ends on `GET :4000/health` and `GET :3000/`, retried for `HEALTH_WAIT_SECONDS`, and
fails with the last 30 lines of the app's log if either does not answer. `/health/db` is then
reported separately as readiness. Nothing prints "done" without those two 2xx responses.

### The traps this deployment has actually hit

| Symptom                                                                                | Cause                                                                                                                         | Fix                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser calls the wrong API host, but `web.env` looks right                            | `NEXT_PUBLIC_*` is inlined into the browser bundle by `next build`; the runtime value never reaches the client                | Set `NEXT_PUBLIC_API_URL` in `laptop-push.env` and **rebuild**. `restart-on-box.sh` greps `.next/static` for the configured value and warns when the shipped bundle disagrees.                             |
| Signed-in users look like guests to the API                                            | `NEXTAUTH_SECRET` differs between `api.env` and `web.env` — the API decrypts the cookie the web app issued                    | Make them byte-identical (watch trailing whitespace). Checked before anything else runs.                                                                                                                   |
| NextAuth cannot reach the database                                                     | `DATABASE_URL` set in `api.env` only                                                                                          | It belongs in **both**: NextAuth's Postgres adapter runs in the Next.js server runtime.                                                                                                                    |
| Sign-in silently fails over plain HTTP or a bare IP                                    | `AUTH_COOKIE_DOMAIN` forces a `secure` cookie                                                                                 | Leave it **empty** for any HTTP/IP test; set it to the registrable domain (`.planningpoker.hblab.dev`) for the real ALB setup.                                                                             |
| `password authentication failed for user "planning_poker"` after changing the password | `POSTGRES_PASSWORD` is only applied when the data volume is **first** initialised; editing it later changes nothing           | Either `ALTER USER planning_poker WITH PASSWORD '…';` inside the container, or `docker compose down -v` to re-initialise (**destroys the database**). The script detects this exact error and prints both. |
| Postgres unreachable, or reaching the wrong database name                              | A password containing `@ : / # ? %` inside `DATABASE_URL`                                                                     | Percent-encode it in the URL (`@`→`%40`, `:`→`%3A`, `/`→`%2F`, `#`→`%23`, `?`→`%3F`, `%`→`%25`); leave the raw value in `postgres.env`. The script warns when it sees such a character.                    |
| Restart "succeeds" but the old code is still serving                                   | Something else already holds 3000/4000 (a hand-started `npm start`, or systemd units running while `SERVICE_MODE=background`) | The script now fails on this instead of reporting success; `sudo lsof -nP -iTCP:4000 -sTCP:LISTEN` names the holder.                                                                                       |
