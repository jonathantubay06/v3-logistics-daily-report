import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { gzipSync } from 'node:zlib';
import { config } from './config.js';
import { generateReport } from './dashboard.js';
import { buildHtmlEmail, buildEml, buildSubject } from './email.js';
import { transactionLog, REPORT_TZ } from './request-log.js';

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(cors({ origin: config.allowedOrigins, credentials: false }));
// One log line per request (see request-log.js): UTC + Philippine time, user, timings, size, errors.
app.use(transactionLog('v3bol'));

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
  const { range, from, to } = req.body || {};
  req.ctx.extra = { scope, range: range || 'mtd', from, to };
  const start = Date.now();
  try {
    // Dates the client sees (dashboard "today", subject, "as of midnight") are US Central; see request-log.js.
    const report = await generateReport(scope, { range, from, to, timeZone: REPORT_TZ });
    req.ctx.buildMs = Date.now() - start;
    req.ctx.extra.range = report.range;
    const subject = buildSubject({ scope, report });
    const html = buildHtmlEmail({ scope, report });
    const eml = buildEml({ scope, report, html });
    // Reply carries large inline screenshots: gzip it (only when the client accepts gzip) so it downloads faster.
    const payload = Buffer.from(JSON.stringify({ scope, generatedAt: report.generatedAt, range: report.range, rangeLabel: report.rangeLabel, from: report.from, to: report.to, requestId: req.ctx.id, subject, html, eml, images: report.images }));
    res.set('Content-Type', 'application/json; charset=utf-8');
    if (/gzip/.test(req.headers['accept-encoding'] || '')) {
      res.set('Content-Encoding', 'gzip');
      res.send(gzipSync(payload));
    } else {
      res.send(payload);
    }
  } catch (err) {
    console.error(`[generate/${scope}] ${req.ctx.id} failed:`, err);
    req.ctx.buildMs = Date.now() - start;
    req.ctx.error = err.message || 'generation failed';
    res.status(500).json({ error: req.ctx.error, requestId: req.ctx.id });
  }
});

const port = process.env.PORT || 3002;
app.listen(port, () => {
  console.log(`v3-bol worker listening on :${port}`);
});
