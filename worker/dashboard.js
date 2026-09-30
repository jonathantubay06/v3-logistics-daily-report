import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
import { config } from './config.js';

// Set DEBUG_DUMP=1 in .env if you need to inspect the dashboard DOM.
const DEBUG = process.env.DEBUG_DUMP === '1';
const NAV_TIMEOUT = 30_000;

const SEL = {
  loginPassword: 'input[type="password"]',
  loginSubmit: 'button:has-text("Sign In")',
  presetBtn: (key) => `.preset-btn[data-preset="${key}"]`,
  dateFrom: '#date-from',
  dateTo: '#date-to',
  loadingOverlay: '.loading-overlay',
  // Signals that real data has rendered:
  scorecardData: '#scorecard-section .sc-value',
  chartCanvas: '.chart-card canvas',
};

// Wait until the Zoho data fetch has actually finished rendering, rather than
// relying on a fixed timer. The dashboard shows a .loading-overlay during every
// fetch (initial load AND each range change), then replaces it with content.
async function waitForDataLoaded(page) {
  // Let a fetch kick off (overlay (re)appears) before we wait for it to clear.
  await page.waitForTimeout(400);
  // Overlay gone…
  await page.locator(SEL.loadingOverlay)
    .waitFor({ state: 'detached', timeout: NAV_TIMEOUT }).catch(() => {});
  // …and real scorecard numbers present…
  await page.locator(SEL.scorecardData).first()
    .waitFor({ state: 'visible', timeout: NAV_TIMEOUT }).catch(() => {});
  // …and at least one chart canvas mounted.
  await page.locator(SEL.chartCanvas).first()
    .waitFor({ state: 'visible', timeout: NAV_TIMEOUT }).catch(() => {});
  // Small buffer for chart animation to settle before the screenshot.
  await page.waitForTimeout(900);
  // A fixed buffer is not enough on the faster v3.sentryxp.com host (charts
  // were captured mid-animation), so jump every Chart.js chart to its final frame.
  await page.evaluate(() => {
    if (!window.Chart || !window.Chart.instances) return;
    Object.values(window.Chart.instances).forEach((c) => {
      c.options.animation = false;
      c.update('none');
    });
  }).catch(() => {});
}

// Valid dashboard presets (data-preset values) → short label used to rewrite
// the hardcoded "This Month" scorecard headings for non-MTD ranges.
const PRESET_LABELS = {
  mtd: null,                 // default view; no label rewrite needed
  lastmonth: 'Last Month',
  '7d': 'Last 7 Days',
  '30d': 'Last 30 Days',
  quarter: 'This Quarter',
  year: 'This Year',
  custom: 'Selected Range',
};

export async function generateReport(scope, opts = {}) {
  if (!config.dashboardPassword) {
    throw new Error('DASHBOARD_PASSWORD not set');
  }

  const range = opts.range && PRESET_LABELS.hasOwnProperty(opts.range) ? opts.range : 'mtd';

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1200 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();

  try {
    await login(page);
    // Wait for the initial (MTD) data load to finish rendering.
    await waitForDataLoaded(page);

    // Apply the requested range, then wait for the refetch + repaint.
    await applyRange(page, range, opts.from, opts.to);

    // Read back the dates the dashboard actually applied (drives subject/body).
    const appliedFrom = await page.locator(SEL.dateFrom).inputValue().catch(() => '');
    const appliedTo = await page.locator(SEL.dateTo).inputValue().catch(() => '');

    if (DEBUG) {
      const html = await page.content();
      await writeFile(`debug-${scope}.html`, html, 'utf8');
      console.log(`[debug] wrote debug-${scope}.html (${html.length} bytes)`);
    }

    const periodLabel = PRESET_LABELS[range];

    // Trim to Emmi's email sections + (for non-MTD) fix the "This Month" labels.
    await page.evaluate((label) => {
      const hide = (sel) => document.querySelectorAll(sel).forEach(el => { el.style.display = 'none'; });
      hide('header');
      hide('nav.topnav');   // app nav bar (added 2026-09-30 deploy)
      hide('.rq');          // internal "Invoice review queue" card (same deploy)
      hide('.outstanding-card');
      hide('.ob-wrap');
      hide('.table-card');
      hide('footer');

      const unwantedTitles = [
        'Daily Loads by Truck',
        'Weekly Revenue vs Gross Profit',
        'Gross Margin % by Load',
      ];
      document.querySelectorAll('.chart-card').forEach(card => {
        const h2 = card.querySelector('h2');
        if (h2 && unwantedTitles.some(t => h2.textContent.includes(t))) {
          card.style.display = 'none';
        }
      });

      // Rewrite hardcoded "This Month" headings to match the selected period.
      if (label) {
        document.querySelectorAll('.sc-label').forEach(el => {
          // Replace only the leading text node so the (?) tooltip span is preserved.
          for (const node of el.childNodes) {
            if (node.nodeType === Node.TEXT_NODE && /this month/i.test(node.textContent)) {
              node.textContent = node.textContent.replace(/this month/i, label);
            }
          }
        });
      }
    }, periodLabel);

    await page.waitForTimeout(200);

    const png = await page.screenshot({ fullPage: true, type: 'png' });
    const dashboardImg = `data:image/png;base64,${png.toString('base64')}`;

    return {
      scope,
      generatedAt: new Date().toISOString(),
      range,
      rangeLabel: periodLabel || 'Month to Date',
      from: appliedFrom,
      to: appliedTo,
      images: { dashboard: dashboardImg },
    };
  } finally {
    await ctx.close();
    await browser.close();
  }
}

// Start of this quarter / year through today, as YYYY-MM-DD (server local time,
// same clock the dashboard's own date inputs use in the headless browser).
function presetDates(range) {
  const now = new Date();
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (range === 'quarter') {
    return { from: ymd(new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1)), to: ymd(now) };
  }
  if (range === 'year') {
    return { from: ymd(new Date(now.getFullYear(), 0, 1)), to: ymd(now) };
  }
  return null;
}

async function applyRange(page, range, from, to) {
  if (range === 'custom') {
    if (!from || !to) throw new Error('Custom range requires both from and to dates');
    await page.locator(SEL.dateFrom).fill(from);
    await page.locator(SEL.dateTo).fill(to);
    // The dashboard listens for 'change' (debounced) to refetch.
    await page.locator(SEL.dateTo).dispatchEvent('change');
    await page.locator(SEL.dateFrom).dispatchEvent('change');
  } else if (range !== 'mtd') {
    // MTD is the default view on load; only click for the others.
    const btn = page.locator(SEL.presetBtn(range));
    if (await btn.count()) {
      await btn.click();
    } else {
      // The 2026-09-30 dashboard deploy dropped the quarter/year buttons;
      // fill the same span into the custom date inputs instead.
      const dates = presetDates(range);
      if (!dates) throw new Error(`Dashboard has no "${range}" preset`);
      await page.locator(SEL.dateFrom).fill(dates.from);
      await page.locator(SEL.dateTo).fill(dates.to);
      await page.locator(SEL.dateTo).dispatchEvent('change');
      await page.locator(SEL.dateFrom).dispatchEvent('change');
    }
  } else {
    // Already on MTD from initial load — nothing to re-apply.
    return;
  }
  // Wait for the data refetch + chart repaint to finish.
  await waitForDataLoaded(page);
}

async function login(page) {
  await page.goto(config.dashboardUrl, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
  await page.locator(SEL.loginPassword).fill(config.dashboardPassword);
  await page.locator(SEL.loginSubmit).click();

  await Promise.race([
    page.waitForURL((u) => !/login/i.test(u.toString()) && u.toString() !== config.dashboardUrl, { timeout: NAV_TIMEOUT }),
    page.locator(SEL.loginPassword).waitFor({ state: 'detached', timeout: NAV_TIMEOUT }),
  ]).catch(() => {});
}
