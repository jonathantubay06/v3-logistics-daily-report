# V3 Logistics — BOL Daily Report Generator

One-click generator for Emmi's BOL daily report email. Logs into the V3 Logistics dashboard, captures the report sections that match Emmi's email (Daily Scorecard, Daily Loads activity trend, Revenue by Truck, Loads by Driver, Revenue & Gross Profit by Driver), and produces an HTML email ready to paste into Outlook — or downloads it as an `.eml`.

Patterned on the Intac Daily Report Generator. Listens on port **3002**.

## Architecture

```
You ──browser──▶ Netlify (frontend) ──fetch──▶ direct HTTPS via Caddy (v3.23-137-105-53.sslip.io; Tailscale Funnel :8443 is the slow fallback) ──▶ Advin VPS worker :3002 ──Playwright──▶ v3.sentryxp.com
```

- **`frontend/`** — static site served by Netlify (free tier). Login screen, `Generate BOL Report` button, preview, `Copy HTML` / `Download .eml` handoff. `config.js` holds the worker URL (the Caddy host `https://v3.23-137-105-53.sslip.io`).
- **`worker/`** — Node + Express + Playwright. Runs on the Advin VPS at `/opt/reporttools/v3bol` as the systemd service `report-v3bol` (logs: `journalctl -u report-v3bol`). Signs into the V3 dashboard (`v3.sentryxp.com`) with the dashboard password, hides every page element that isn't in Emmi's email (V3 header, Awaiting Tickets widget, Outstanding BOLs banner, several extra chart cards, Driver Performance / Daily Load Detail tables, footer), then captures a full-page screenshot.
- If the VPS is down, see [LOCAL-FALLBACK.md](LOCAL-FALLBACK.md) (`worker/start-local-worker.bat`). The old PC launcher with a Cloudflare Quick Tunnel (`launch.js` / `launch.bat`) was removed on 2026-11-24.

## Daily flow

Nothing to start: the worker runs on the VPS all the time.

1. Open <https://v3-logistics-daily-reporting.netlify.app>, sign in with the team password, click `Generate BOL Report`.
3. `Copy HTML` → new Outlook message → Ctrl+V → fill in To/Cc → Send. Or `Download .eml` → opens in Outlook with everything pre-filled.

## Local development

```bash
cd worker
npm install
npx playwright install chromium
cp .env.example .env
# Fill DASHBOARD_PASSWORD, TEAM_PASSWORD
```

Then `node server.js` inside `worker/` (port 3002) and put `http://localhost:3002` in the page's worker URL box.

## When the V3 dashboard changes

If the screenshot starts including or missing something, the dashboard layout changed. Set `DEBUG_DUMP=1` in `worker/.env`, restart, click Generate. The worker writes `worker/debug-bol.html` with the current DOM — inspect, then update the hide list in [`worker/dashboard.js`](worker/dashboard.js) (the `page.evaluate(...)` block).

## Files

```
V3 BOL daily report/
├── README.md            ← you are here
├── LOCAL-FALLBACK.md    ← what to do if the VPS is down
├── netlify.toml         ← Netlify build config (publish frontend/)
├── frontend/
│   ├── index.html       ← login + Generate button + preview
│   ├── app.js
│   ├── config.js        ← worker URL (the VPS direct HTTPS address v3.23-137-105-53.sslip.io, never cached)
│   └── styles.css
└── worker/
    ├── server.js        ← Express, /generate/bol, usage log
    ├── dashboard.js     ← Playwright login + screenshot (with hide list)
    ├── email.js         ← HTML email + .eml builder
    ├── config.js        ← env + recipients
    ├── .env.example
    └── package.json
```

## Logs, time zones and safety (since 2026-11-24)

All of this lives in `worker/ops.js` (the same file in the Intac, V3 BOL and Kingdomland workers).

- **Time zones.** Dates the client sees (report "today", date ranges, email subject and body) use US Central (`REPORT_TIMEZONE`, default `America/Chicago`); the headless browser runs in that zone too. Log times are Philippine time (`LOG_TIMEZONE`, default `Asia/Manila`) for debugging.
- **Transaction log.** `worker/access.log` gets one JSON line per request (not `/health`): `ts` (UTC), `logTime`, `id`, `status`, `event` (`finish` or `aborted`), `user`, `userTz`, scope/range, `buildMs`, `totalMs`, `bytes`, `gzip`, `ip`, `ua`, `warnings`, `error`. The same `id` is returned as the `X-Request-Id` header and shown in page errors as "(ref ...)". On the VPS: `tail -f /opt/reporttools/<tool>/worker/access.log` or `journalctl -u report-<tool> -f`. The file is rotated weekly by `/etc/logrotate.d/reporttools`.
- **Alerts.** A failed report, a report that was built but never reached the page, a report with suspiciously small screenshots, and a blocked password guesser are sent to Jojo's alert hub on the VPS (`ALERT_HUB_KEY` in the worker `.env`); the hub handles muting and repeats.
- **Team password.** Checked in constant time; an address with 10 wrong passwords in an hour gets HTTP 429 for the rest of that hour (`LOGIN_FAIL_LIMIT`).
- **Smaller replies.** The web page sends `X-Eml-On-Demand: 1`, so the reply leaves out the `.eml` (and V3's raw images), which repeat every screenshot; Download fetches `GET /eml/<id>` (kept 30 minutes). Scripted callers without that header, such as Emmi's GitHub flow, still get the full reply. Replies are gzipped when the caller accepts gzip.
