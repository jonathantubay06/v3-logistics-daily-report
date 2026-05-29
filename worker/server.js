import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { appendFile } from 'node:fs/promises';
import { config } from './config.js';
import { generateReport } from './dashboard.js';
import { buildHtmlEmail, buildEml, buildSubject } from './email.js';

async function logUsage(entry) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n';
  try { await appendFile('access.log', line); } catch {}
  console.log('[usage]', line.trim());
}

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(cors({ origin: config.allowedOrigins, credentials: false }));

function requireTeamPassword(req, res, next) {
  const token = req.headers['x-team-password'];
  if (!token || token !== config.teamPassword) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

app.get('/health', (req, res) => res.json({ ok: true }));

app.post('/generate/:scope', requireTeamPassword, async (req, res) => {
  const scope = req.params.scope;
  if (scope !== 'bol') {
    return res.status(400).json({ error: 'scope must be bol' });
  }
  const start = Date.now();
  const ua = req.headers['user-agent'] || '';
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip;
  try {
    const report = await generateReport(scope);
    const subject = buildSubject({ scope, report });
    const html = buildHtmlEmail({ scope, report });
    const eml = buildEml({ scope, report, html });
    res.json({ scope, generatedAt: report.generatedAt, subject, html, eml, images: report.images });
    logUsage({ scope, ok: true, durationMs: Date.now() - start, ip, ua });
  } catch (err) {
    console.error(`[generate/${scope}] failed:`, err);
    res.status(500).json({ error: err.message || 'generation failed' });
    logUsage({ scope, ok: false, durationMs: Date.now() - start, ip, ua, error: err.message });
  }
});

const port = process.env.PORT || 3002;
app.listen(port, () => {
  console.log(`v3-bol worker listening on :${port}`);
});
