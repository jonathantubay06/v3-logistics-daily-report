# V3 Logistics — BOL Daily Report Generator

Generates Emmi's BOL Report email with one click. Logs into the V3 Logistics dashboard, screenshots the report sections, and hands off as a polished HTML email ready to paste into Outlook.

Patterned on the Intac Daily Report Generator. Runs on a different port (3002) so both can coexist on the same machine.

## Architecture

```
You ──browser──▶ Netlify site ──fetch──▶ Cloudflare Tunnel ──▶ Your PC :3002 ──Playwright──▶ V3 Dashboard
```

- `worker/` — Node + Express + Playwright (port 3002)
- `frontend/` — static site (Netlify), single "Generate BOL Report" button
- `launch.js` / `launch.bat` — one-click start of worker + tunnel + auto-push tunnel URL

## Local quickstart

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

## Status

v0 scaffold. Selectors in [`worker/dashboard.js`](worker/dashboard.js) are placeholders — first Generate writes `worker/debug-bol.html` so they can be pinned against the real DOM.
