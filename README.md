# V3 Logistics — BOL Daily Report Generator

One-click generator for Emmi's BOL daily report email. Logs into the V3 Logistics dashboard, captures the report sections that match Emmi's email (Daily Scorecard, Daily Loads activity trend, Revenue by Truck, Loads by Driver, Revenue & Gross Profit by Driver), and produces an HTML email ready to paste into Outlook — or downloads it as an `.eml`.

Patterned on the Intac Daily Report Generator. Runs on port **3002** so both can coexist on the same machine.

## Architecture

```
You ──browser──▶ Netlify (frontend) ──fetch──▶ Cloudflare Quick Tunnel ──▶ Local PC :3002 ──Playwright──▶ v3-dashboard-production.up.railway.app
```

- **`frontend/`** — static site served by Netlify (free tier). Login screen, `Generate BOL Report` button, preview, `Copy HTML` / `Download .eml` handoff.
- **`worker/`** — Node + Express + Playwright. Runs locally on port 3002. Signs into V3 with the dashboard password, hides every page element that isn't in Emmi's email (V3 header, Awaiting Tickets widget, Outstanding BOLs banner, several extra chart cards, Driver Performance / Daily Load Detail tables, footer), then captures a full-page screenshot.
- **`launch.js` / `launch.bat`** — one-shot boot: starts the worker, starts a Cloudflare Quick Tunnel pointed at `localhost:3002`, captures the random `*.trycloudflare.com` URL, writes it into `frontend/config.js`, pushes so Netlify auto-redeploys.

## Daily flow

A Windows scheduled task (`V3BolReportLauncher`) runs `launch.bat` at user logon, so the worker + tunnel come up automatically. After login:

1. Console window opens (keep it minimized).
2. Open <https://v3-logistics-daily-reporting.netlify.app>, sign in with the team password, click `Generate BOL Report`.
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
├── launch.js / .bat     ← one-shot boot (worker + tunnel + push)
├── netlify.toml         ← Netlify build config (publish frontend/)
├── frontend/
│   ├── index.html       ← login + Generate button + preview
│   ├── app.js
│   ├── config.js        ← auto-updated tunnel URL (never cached)
│   └── styles.css
└── worker/
    ├── server.js        ← Express, /generate/bol, usage log
    ├── dashboard.js     ← Playwright login + screenshot (with hide list)
    ├── email.js         ← HTML email + .eml builder
    ├── config.js        ← env + recipients
    ├── .env.example
    └── package.json
```
