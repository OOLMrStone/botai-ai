# Deployment

The test deployment: **https://api.botai-ege.ru**

One box, Ubuntu 24.04, 2 cores, 3.8 GB RAM. Docker Compose for the app, the
host's own Caddy for TLS and the password.

```
internet ──443──▶ caddy (host, systemd)          /etc/caddy/Caddyfile
                    │  TLS for api.botai-ege.ru
                    │  basic auth: everything except /health
                    ▼
                  127.0.0.1:8080  ──▶ ege-grading-api (docker)
                                          │
                                          ▼
                                     /srv/ege/reports   ← the deliverable
```

## Why the shape is this way

**Caddy belongs to the host, not the stack.** The team had already installed
it with the certificate for `api.botai-ege.ru`. A second Caddy in a container
could not bind :80 (which is how the first attempt failed) and would have had
to re-issue certificates it has no claim to.

**The app publishes to `127.0.0.1:8080`, never `0.0.0.0`.** Docker writes its
own iptables rules ahead of ufw, so a container that publishes a port is
reachable from the internet even when the firewall says otherwise. The
loopback bind is what actually keeps the app behind the password.

**One password over the whole site.** The service spends real money per
request against a paid DeepSeek key, so an open URL is an open wallet. The
same gate covers the debug surface testers need — the flag panel and the run
reports live under `/debug` and expose prompts and student work. `/health`
is deliberately outside it so uptime monitoring needs no credentials.

**`flush_interval -1` in the proxy.** Grading streams progress over SSE for
minutes. With response buffering the page would show an empty progress bar and
then everything at once, which is indistinguishable from a hang. The 30-minute
read/write timeouts stop the proxy cutting a run mid-stage.

**`APP_ENV=dev`, not `prod`.** `prod` force-disables the debug toolkit, and
testers need it. The name is honest: this is a test deployment.

## Credentials

| what | where |
|---|---|
| site password (`tester`) | given to Edward separately; bcrypt hash in `/etc/caddy/Caddyfile` |
| `DEBUG_TOKEN` | `/srv/ege/app/.env`, mode 600 |
| DeepSeek API key | `/srv/ege/app/.env`, mode 600 |

The page asks for the debug token once and keeps it in `localStorage`; testers
past the site password do not need to know it.

## Routine operations

```bash
ssh ege-server                       # alias added to ~/.ssh/config

cd /srv/ege/app/deploy
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f --tail=100 grading-api
docker compose -f docker-compose.prod.yml restart
```

**Deploying a change** — from the repo on your laptop:

```bash
rsync -az --delete \
  --exclude .venv --exclude .git --exclude __pycache__ \
  --exclude .env --exclude '*key*.txt' \
  ./ ege-server:/srv/ege/app/
ssh ege-server 'cd /srv/ege/app/deploy && \
  docker compose -f docker-compose.prod.yml up -d --build'
```

`.env` is excluded on purpose: the server's copy holds the real API key and
must not be overwritten by a laptop's.

**Editing a prompt** does still need the rebuild above — prompts are baked
into the `prod` image so the running container cannot be edited out from under
itself.

## Collecting the test session

```bash
./deploy/fetch-reports.sh              # → ./collected-reports + a summary
```

Reports are plain JSON, one file per run, grouped by date — copying them *is*
the collection step. The summary lists every run with its grades, which flags
were changed, and what the tester said, then calls out the disputed ones.

Nothing prunes `/srv/ege/reports`. They hold student work, so decide on a
retention window before this stops being a test deployment.

## After a reboot

Nothing to do: `docker` and `caddy` are both `systemctl enable`d and the
container is `restart: unless-stopped`.

## Known limits

* **No rate limiting.** The password is the only thing between a tester and
  the API balance. A tester in a loop could spend it.
* **Basic auth is one shared password.** No per-tester identity — the `кто`
  field on the feedback form is self-reported.
* **Reports are unbounded on disk** and contain photographs of student work.
* **The balance is finite.** ~$0.008 per photo run; check with
  `curl -s https://api.deepseek.com/user/balance -H "Authorization: Bearer $KEY"`.
* **One box, no backups.** `/srv/ege/reports` is the only state worth keeping;
  `fetch-reports.sh` is the backup.
