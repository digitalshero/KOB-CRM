# KOB CRM — AWS staging deployment (backend)

Minimal, manual deployment setup for the Express backend on a single EC2
instance. No CI/CD pipeline, no containers — matches the current single-EC2
sizing already assumed in `backend/src/db/pool.ts`.

## Files here

- `kob-backend.service` — systemd unit. Install once to `/etc/systemd/system/kob-backend.service`.

## One-time EC2 setup

1. Create a dedicated `kob` system user to run the service (not root, not your personal SSH user).
2. `mkdir -p /opt/kob-backend` and deploy the built `backend/dist/` + `node_modules/` there (owned by `kob`).
3. Create `/etc/kob-backend/backend.env` (chmod 600, owned by `kob`) with the real staging values —
   **never git, never in the repo, never in `~/.pgpass_kob`.** Use `backend/.env.example` as the
   field reference; fill in `PGHOST` / `PGPASSWORD` / `DATABASE_SSL_CA_PATH` only in this file.
4. Copy `kob-backend.service` to `/etc/systemd/system/kob-backend.service`.
5. `systemctl daemon-reload && systemctl enable kob-backend`.

## Deploy / restart

```
systemctl stop kob-backend
# sync new backend/dist + node_modules into /opt/kob-backend
systemctl start kob-backend
systemctl status kob-backend
journalctl -u kob-backend -f   # tail logs
```

## Rollback

Keep the previous `dist/` build as `/opt/kob-backend-prev` before each deploy.
To roll back:

```
systemctl stop kob-backend
rm -rf /opt/kob-backend && mv /opt/kob-backend-prev /opt/kob-backend
systemctl start kob-backend
```

To roll back the data-backend flag alone without a redeploy, flip
`DATA_BACKEND` back to `supabase` in `/etc/kob-backend/backend.env` and
`systemctl restart kob-backend` — no code change needed, since every migrated
handler still carries its Supabase-path fallback.

## Frontend / Nginx

Not yet planned in this repo (`infra/nginx/` is still a placeholder) — out of
scope for this pass.

