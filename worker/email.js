import { config } from './config.js';

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
  }[c]));
}

function fmtDate(iso) {
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}/${dd}/${d.getFullYear()}`;
}

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// Parse a YYYY-MM-DD string as a local date (no timezone shift).
function parseYMD(s) {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// Build a human period description from the applied range + dates.
// Returns { subjectSuffix, bodyPhrase }.
function describePeriod(report) {
  const range = report.range || 'mtd';
  const from = parseYMD(report.from);
  const to = parseYMD(report.to);

  // Whole-calendar-month detection (covers Last Month and any month-aligned range).
  const isFullMonth = from && to
    && from.getDate() === 1
    && from.getMonth() === to.getMonth()
    && from.getFullYear() === to.getFullYear()
    && to.getDate() === new Date(to.getFullYear(), to.getMonth() + 1, 0).getDate();

  if (range === 'mtd') {
    // Default: report reflects up to the previous day (data lags one day).
    const d = parseYMD(report.to) || new Date(report.generatedAt);
    const prev = new Date(d); prev.setDate(prev.getDate() - 1);
    return {
      subjectSuffix: `${MONTHS_SHORT[prev.getMonth()]} ${prev.getDate()}`,
      bodyPhrase: `as of midnight ${MONTHS[prev.getMonth()]} ${prev.getDate()}, ${prev.getFullYear()}`,
    };
  }

  if (isFullMonth || range === 'lastmonth') {
    const ref = to || from;
    return {
      subjectSuffix: `${MONTHS[ref.getMonth()]} ${ref.getFullYear()}`,
      bodyPhrase: `summary for ${MONTHS[ref.getMonth()]} ${ref.getFullYear()}`,
    };
  }

  if (range === 'year' && from) {
    return {
      subjectSuffix: `${from.getFullYear()}`,
      bodyPhrase: `summary for ${from.getFullYear()}`,
    };
  }

  // Generic date-range (7d, 30d, quarter, custom, etc.)
  if (from && to) {
    const sameYear = from.getFullYear() === to.getFullYear();
    const fromStr = `${MONTHS_SHORT[from.getMonth()]} ${from.getDate()}`;
    const toStr = sameYear
      ? `${MONTHS_SHORT[to.getMonth()]} ${to.getDate()}`
      : `${MONTHS_SHORT[to.getMonth()]} ${to.getDate()}, ${to.getFullYear()}`;
    return {
      subjectSuffix: `${fromStr} – ${toStr}`,
      bodyPhrase: `for ${fromStr} – ${toStr}, ${to.getFullYear()}`,
    };
  }

  // Fallback
  return {
    subjectSuffix: report.rangeLabel || 'Report',
    bodyPhrase: `for ${report.rangeLabel || 'the selected period'}`,
  };
}

function img(dataUri, alt) {
  if (!dataUri) return '';
  return `<div style="margin:16px 0;"><img src="${dataUri}" alt="${escapeHtml(alt)}" style="max-width:100%;height:auto;border:1px solid #eee;border-radius:8px;"/></div>`;
}

export function buildSubject({ scope, report }) {
  const { subjectSuffix } = describePeriod(report);
  return `BOL Report - ${subjectSuffix}`;
}

export function buildHtmlEmail({ scope, report }) {
  const images = report.images || {};
  const { bodyPhrase } = describePeriod(report);

  return `<!doctype html>
<html><body style="font:14px Arial,sans-serif;color:#222;">
  <p>Good morning team,</p>
  <p>Please see below for the BOL report ${bodyPhrase}:</p>
  ${img(images.dashboard, 'V3 Logistics — BOL Scorecard')}
</body></html>`;
}

// ---------- .eml builder ----------
function b64(buf) {
  return Buffer.from(buf).toString('base64').match(/.{1,76}/g).join('\r\n');
}
function dataUriToBuffer(uri) {
  const m = /^data:(.+?);base64,(.+)$/.exec(uri);
  if (!m) return null;
  return { mime: m[1], buf: Buffer.from(m[2], 'base64') };
}

export function buildEml({ scope, report, html }) {
  const recip = config.recipients[scope];
  const date = fmtDate(report.generatedAt);
  const subject = buildSubject({ scope, report });
  const boundary = `----=_Part_${Date.now()}`;
  const altBoundary = `----=_Alt_${Date.now()}`;

  const attachments = [];
  const cidHtml = html.replace(/src="(data:image\/[^"]+)"/g, (_, uri) => {
    const parsed = dataUriToBuffer(uri);
    if (!parsed) return `src=""`;
    const cid = `img${attachments.length}@v3.report`;
    attachments.push({ cid, mime: parsed.mime, buf: parsed.buf, filename: `image${attachments.length}.png` });
    return `src="cid:${cid}"`;
  });

  const headers = [
    `From: ${config.from}`,
    `To: ${recip.to.join(', ')}`,
    recip.cc.length ? `Cc: ${recip.cc.join(', ')}` : null,
    `Subject: ${subject}`,
    `Date: ${new Date(report.generatedAt).toUTCString()}`,
    `MIME-Version: 1.0`,
    attachments.length
      ? `Content-Type: multipart/related; boundary="${boundary}"; type="multipart/alternative"`
      : `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
  ].filter(Boolean).join('\r\n');

  const altPart =
`--${altBoundary}\r
Content-Type: text/plain; charset="utf-8"\r
Content-Transfer-Encoding: 7bit\r
\r
See HTML version.\r
\r
--${altBoundary}\r
Content-Type: text/html; charset="utf-8"\r
Content-Transfer-Encoding: 8bit\r
\r
${cidHtml}\r
\r
--${altBoundary}--\r
`;

  let body;
  if (attachments.length) {
    const imgParts = attachments.map(a =>
`--${boundary}\r
Content-Type: ${a.mime}; name="${a.filename}"\r
Content-Transfer-Encoding: base64\r
Content-ID: <${a.cid}>\r
Content-Disposition: inline; filename="${a.filename}"\r
\r
${b64(a.buf)}\r
`).join('');
    body =
`--${boundary}\r
Content-Type: multipart/alternative; boundary="${altBoundary}"\r
\r
${altPart}\r
${imgParts}--${boundary}--\r
`;
  } else {
    body = altPart;
  }

  return {
    filename: `v3-bol-${date.replace(/\//g, '-')}.eml`,
    content: Buffer.from(`${headers}\r\n\r\n${body}`).toString('base64'),
    mime: 'message/rfc822',
  };
}
