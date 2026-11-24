// Worker URL: direct HTTPS to the Advin VPS (Caddy, systemd report-v3bol on :3002), since 2026-11-24.
// Fallback: Tailscale Funnel https://alison-relay-vps.tailea90ac.ts.net:8443 reaches the same worker (bandwidth-limited).
// Override per-session via the "Worker URL" field on the sign-in screen.
window.__WORKER_URL__ = 'https://v3.23-137-105-53.sslip.io';
