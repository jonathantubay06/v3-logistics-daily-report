import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
import { config } from './config.js';

// Set DEBUG_DUMP=1 in .env if you need to inspect the dashboard DOM
// (e.g. if a layout change breaks the hide-list in the screenshot step).
const DEBUG = process.env.DEBUG_DUMP === '1';
const NAV_TIMEOUT = 30_000;

const SEL = {
  loginPassword: 'input[type="password"]',
  loginSubmit: 'button:has-text("Sign In")',
};

export async function generateReport(scope) {
  if (!config.dashboardPassword) {
    throw new Error('DASHBOARD_PASSWORD not set');
  }

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1200 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();

  try {
    await login(page);

    // Charts render client-side after the SPA hydrates.
    await page.waitForLoadState('networkidle', { timeout: NAV_TIMEOUT }).catch(() => {});
    await page.waitForTimeout(1500); // chart paint buffer

    if (DEBUG) {
      const html = await page.content();
      await writeFile(`debug-${scope}.html`, html, 'utf8');
      console.log(`[debug] wrote debug-${scope}.html (${html.length} bytes)`);
    }

    // Hide everything that isn't in Emmi's BOL email. Keep only:
    //   Daily Scorecard, Daily Loads — Activity Trend,
    //   Revenue by Truck, Loads by Driver, Revenue & Gross Profit by Driver.
    await page.evaluate(() => {
      const hide = (sel) => document.querySelectorAll(sel).forEach(el => { el.style.display = 'none'; });

      // Top: brand header / date filters / Zoho badge
      hide('header');
      // "Outstanding BOLs — Action Required" yellow banner
      hide('.outstanding-card');
      // "23 BOLs Awaiting Tickets / Docs" pill row
      hide('.ob-wrap');
      // Driver Performance + Daily Load Detail tables
      hide('.table-card');
      // Footer (if any)
      hide('footer');

      // Hide chart-cards we don't want (Emmi's email omits these)
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
    });

    // Brief settle after layout shifts
    await page.waitForTimeout(200);

    const png = await page.screenshot({ fullPage: true, type: 'png' });
    const dashboardImg = `data:image/png;base64,${png.toString('base64')}`;

    return {
      scope,
      generatedAt: new Date().toISOString(),
      images: { dashboard: dashboardImg },
    };
  } finally {
    await ctx.close();
    await browser.close();
  }
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
