# Deploying Planning Poker to EC2

The deployment target is **one EC2 instance** running the Next.js web app, the Express + Socket.io
API, Nginx and Postgres — the reason the project chose self-hosting over Supabase (see `README.md`).

> **Status: nothing has been provisioned.** Task 10 was scoped to a _simulated_ deploy. No EC2
> instance, security group, Elastic IP, DNS record or certificate exists, and no host has ever been
> contacted from CI. Everything below is the machinery, committed and rehearsed in simulation,
> waiting for real values.

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

`deploy/scripts/bootstrap-server.sh` installs Node 22, Docker, Nginx and certbot; creates the
`planningpoker` service account and `/opt/planning-poker/{releases,env}`; installs both systemd
units; renders `deploy/nginx/planning-poker.conf.template` for your domain; and requests one
certificate covering `<domain>` and `api.<domain>`. Renewal is certbot's own systemd timer.

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
