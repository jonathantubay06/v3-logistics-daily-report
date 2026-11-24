import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { gzipSync } from 'node:zlib';
import { config } from './config.js';
import { generateReport } from './dashboard.js';
import { buildHtmlEmail, buildEml, buildSubject } from './email.js';
import {
  transactionLog, teamPasswordGuard, REPORT_TZ,
  stashEml, emlRoute, wantsEmlOnDemand, checkImages, runExclusive,
} from './ops.js';

const TOOL = 'v3bol';
const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(cors({ origin: config.allowedOrigins, credentials: false }));
// One log line per request, alerts on failures (see ops.js).
app.use(transactionLog(TOOL));
const requireTeamPassword = teamPasswordGuard(TOOL, config.teamPassword);

// Large replies (screenshots): gzip when the client accepts it.
function sendJson(req, res, obj) {
  const payload = Buffer.from(JSON.stringify(obj));
  res.set('Content-Type', 'application/json; charset=utf-8');
  if (/gzip/.test(req.headers['accept-encoding'] || '')) {
    res.set('Content-Encoding', 'gzip');
    return res.send(gzipSync(payload));
  }
  return res.send(payload);
}

app.get('/health', (req, res) => res.json({ ok: true }));

app.get('/eml/:id', requireTeamPassword, emlRoute);

app.post('/generate/:scope', requireTeamPassword, async (req, res) => {
  const scope = req.params.scope;
  if (scope !== 'bol') {
    return res.status(400).json({ error: 'scope must be bol' });
  }
  const { range, from, to } = req.body || {};
  req.ctx.extra = { scope, range: range || 'mtd', from, to };
  const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  if (range === 'custom' && (!isDate(from) || !isDate(to) || from > to)) {
    return res.status(400).json({ error: 'custom range needs from and to as YYYY-MM-DD, with from on or before to' });
  }
  const start = Date.now();
  try {
    // Dates the client sees (dashboard "today", subject, "as of midnight") are US Central; see ops.js.
    // One report at a time per worker; a second request waits for the first.
    const report = await runExclusive(() => generateReport(scope, { range, from, to, timeZone: REPORT_TZ }));
    req.ctx.buildMs = Date.now() - start;
    req.ctx.extra.range = report.range;
    req.ctx.warnings.push(...checkImages(report.images));
    const subject = buildSubject({ scope, report });
    const html = buildHtmlEmail({ scope, report });
    const eml = buildEml({ scope, report, html });
    const reply = {
      scope, generatedAt: report.generatedAt, range: report.range, rangeLabel: report.rangeLabel,
      from: report.from, to: report.to, requestId: req.ctx.id, warnings: req.ctx.warnings, subject, html,
    };
    if (wantsEmlOnDemand(req)) {
      // The web page: no .eml and no raw images (both repeat the screenshot already inside html).
      stashEml(req.ctx.id, eml);
      reply.emlId = req.ctx.id;
    } else {
      // Scripted callers (Emmi's GitHub flow) keep the full reply.
      reply.eml = eml;
      reply.images = report.images;
    }
    sendJson(req, res, reply);
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
