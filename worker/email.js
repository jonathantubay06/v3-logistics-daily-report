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

function asOfPhrase(iso) {
  const d = new Date(iso);
  // "Please see below for the BOL report as of midnight May 21, 2026"
  // BOL data reflects the previous day, so we say "midnight <yesterday>".
  d.setDate(d.getDate() - 1);
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function img(dataUri, alt) {
  if (!dataUri) return '';
  return `<div style="margin:16px 0;"><img src="${dataUri}" alt="${escapeHtml(alt)}" style="max-width:100%;height:auto;border:1px solid #eee;border-radius:8px;"/></div>`;
}

export function buildSubject({ scope, report }) {
  const recip = config.recipients[scope];
  return recip.subject(report.generatedAt);
}

export function buildHtmlEmail({ scope, report }) {
  const images = report.images || {};
  const asOf = asOfPhrase(report.generatedAt);

  return `<!doctype html>
<html><body style="font:14px Arial,sans-serif;color:#222;">
  <p>Good morning team,</p>
  <p>Please see below for the BOL report as of midnight ${asOf}:</p>
  ${img(images.dashboard, 'V3 Logistics — BOL Daily Scorecard')}
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
  const subject = recip.subject(report.generatedAt);
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
