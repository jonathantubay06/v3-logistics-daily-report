// Starts worker + Cloudflare Quick Tunnel, captures URL, writes it into
// frontend/config.js, commits + pushes so Netlify redeploys.
//
// Worker runs on port 3002 so it doesn't collide with the Intac worker (3001).

import { spawn, execSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(ROOT, 'frontend', 'config.js');
const CLOUDFLARED = process.env.CLOUDFLARED_PATH
  || 'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe';
const LOCAL_PORT = process.env.PORT || '3002';
// Quick-tunnel hostnames are always multi-word with hyphens (e.g.
// "groundwater-tests-apache-eden"). Require at least one hyphen so we never
// accidentally capture "api.trycloudflare.com" from other log lines.
const TUNNEL_URL_RE = /(https:\/\/[a-z0-9]+(?:-[a-z0-9]+)+\.trycloudflare\.com)/;

function log(tag, msg) {
  process.stdout.write(`[${tag}] ${msg.endsWith('\n') ? msg : msg + '\n'}`);
}

log('launch', 'starting v3-bol worker (node server.js)...');
const worker = spawn(process.execPath, ['server.js'], {
  cwd: path.join(ROOT, 'worker'),
  stdio: ['ignore', 'pipe', 'pipe'],
});
worker.stdout.on('data', d => process.stdout.write(`[worker] ${d}`));
worker.stderr.on('data', d => process.stderr.write(`[worker] ${d}`));
worker.on('exit', code => log('launch', `worker exited with code ${code}`));

log('launch', 'starting Cloudflare Quick Tunnel...');
const cf = spawn(CLOUDFLARED, ['tunnel', '--url', `http://localhost:${LOCAL_PORT}`, '--no-autoupdate'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});

let urlPushed = false;
cf.stdout.on('data', handleCfOutput);
cf.stderr.on('data', handleCfOutput);
cf.on('exit', code => log('launch', `tunnel exited with code ${code}`));

function handleCfOutput(data) {
  const s = data.toString();
  process.stdout.write(`[tunnel] ${s}`);
  if (urlPushed) return;
  const m = s.match(TUNNEL_URL_RE);
  if (m) {
    urlPushed = true;
    updateAndPush(m[1]).catch(err => log('launch', `update failed: ${err.message}`));
  }
}

async function updateAndPush(url) {
  log('launch', `>>> tunnel URL captured: ${url}`);
  const existing = await readFile(CONFIG_PATH, 'utf8');
  const next = existing.replace(
    /window\.__WORKER_URL__\s*=\s*'[^']*';/,
    `window.__WORKER_URL__ = '${url}';`
  );
  if (next === existing) {
    log('launch', 'config.js already up to date');
    return;
  }
  await writeFile(CONFIG_PATH, next);
  log('launch', 'wrote frontend/config.js, committing + pushing...');
  try {
    execSync('git add frontend/config.js', { cwd: ROOT, stdio: 'inherit' });
    execSync(
      'git -c user.email=launcher@local -c user.name=Launcher commit -m "Update tunnel URL"',
      { cwd: ROOT, stdio: 'inherit' }
    );
    execSync('git push', { cwd: ROOT, stdio: 'inherit' });
    log('launch', '>>> pushed. Netlify will redeploy in ~30-60s.');
  } catch (err) {
    log('launch', `git push failed: ${err.message}`);
    log('launch', 'tunnel still running; paste URL into the Worker URL field manually.');
  }
}

function shutdown() {
  log('launch', 'shutting down...');
  try { worker.kill(); } catch {}
  try { cf.kill(); } catch {}
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
