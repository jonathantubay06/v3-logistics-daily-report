# V3 Logistics — BOL Daily Report Generator

One-click generator for Emmi's BOL daily report email. Logs into the V3 Logistics dashboard, captures the report sections that match Emmi's email (Daily Scorecard, Daily Loads activity trend, Revenue by Truck, Loads by Driver, Revenue & Gross Profit by Driver), and produces an HTML email ready to paste into Outlook — or downloads it as an `.eml`.

Patterned on the Intac Daily Report Generator. Listens on port **3002**.

## Architecture

```
You ──browser──▶ Netlify (frontend) ──fetch──▶ direct HTTPS via Caddy (v3.23-137-105-53.sslip.io; Tailscale Funnel :8443 is the slow fallback) ──▶ Advin VPS worker :3002 ──Playwright──▶ v3.sentryxp.com
```

- **`frontend/`** — static site served by Netlify (free tier). Login screen, `Generate BOL Report` button, preview, `Copy HTML` / `Download .eml` handoff. `config.js` holds the worker URL (the Funnel address above).
- **`worker/`** — Node + Express + Playwright. Runs on the Advin VPS at `/opt/reporttools/v3bol` as the systemd service `report-v3bol` (logs: `journalctl -u report-v3bol`). Signs into the V3 dashboard (`v3.sentryxp.com`) with the dashboard password, hides every page element that isn't in Emmi's email (V3 header, Awaiting Tickets widget, Outstanding BOLs banner, several extra chart cards, Driver Performance / Daily Load Detail tables, footer), then captures a full-page screenshot.
- **`launch.js` / `launch.bat`** — retired since 2026-08-25 (the old PC worker with a Cloudflare Quick Tunnel). Kept only for local development; the real worker is on the VPS. If the VPS is down, see [LOCAL-FALLBACK.md](LOCAL-FALLBACK.md).

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

Then from the repo root:

```bash
node launch.js
```

Or double-click `launch.bat`.

## When the V3 dashboard changes

If the screenshot starts including or missing something, the dashboard layout changed. Set `DEBUG_DUMP=1` in `worker/.env`, restart, click Generate. The worker writes `worker/debug-bol.html` with the current DOM — inspect, then update the hide list in [`worker/dashboard.js`](worker/dashboard.js) (the `page.evaluate(...)` block).

## Files

```
V3 BOL daily report/
├── README.md            ← you are here
├── launch.js / .bat     ← retired PC boot script (local dev only)
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
