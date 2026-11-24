import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Response, SidecarApp } from 'sidecar_sdk';
import {
  ensureCatalog,
  getGlobalSummary,
  getLatestMetrics,
  listRecentConversations,
} from '../../shared/ls-client.mjs';
import { getDefaultPricingConfig, getPricingConfig, resetPricingConfig, savePricingConfig } from '../../shared/pricing.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PID_FILE = join(tmpdir(), 'agy-token-monitor.pid');

function takeOverSingleInstance() {
  try {
    const raw = readFileSync(PID_FILE, 'utf8').trim();
    const oldPid = Number.parseInt(raw, 10);
    if (Number.isInteger(oldPid) && oldPid > 0 && oldPid !== process.pid) {
      try {
        process.kill(oldPid, 0);
        process.kill(oldPid);
      } catch {
        // old process already exited or inaccessible
      }
    }
  } catch {
    // pid file does not exist yet
  }
  try {
    writeFileSync(PID_FILE, String(process.pid), 'utf8');
  } catch {
    // ignore pid write failure
  }
}

function releasePidFile() {
  try {
    if (readFileSync(PID_FILE, 'utf8').trim() === String(process.pid)) {
      rmSync(PID_FILE, { force: true });
    }
  } catch {
    // ignore cleanup failure
  }
}

takeOverSingleInstance();
const ECHARTS_JS = readFileSync(join(HERE, 'vendor', 'echarts.min.js'), 'utf8');
const app = new SidecarApp();

app.page('/', () => new Response(readFileSync(join(HERE, 'index.html'), 'utf8'), {
  contentType: 'text/html; charset=utf-8',
}));

app.page('/echarts.min.js', () => new Response(ECHARTS_JS, {
  contentType: 'application/javascript; charset=utf-8',
  headers: { 'Cache-Control': 'public, max-age=86400' },
}));

app.api('/api/conversations', async () => {
  try {
    return { conversations: await listRecentConversations(30) };
  } catch (err) {
    return { error: 'failed', message: err.message, conversations: [] };
  }
}, 'GET');

app.api('/api/metrics', async (data) => {
  try {
    return await getLatestMetrics(data?.conversationId, { fallbackToLatest: false });
  } catch (err) {
    return { error: 'failed', message: err.message };
  }
}, 'GET');

app.api('/api/summary', async (data) => {
  try {
    const range = ['today', '7d', '30d', 'all'].includes(data?.range) ? data.range : 'today';
    const scope = data?.scope === 'all' ? 'all' : 'workspace';
    return await getGlobalSummary(range, scope);
  } catch (err) {
    return { error: 'failed', message: err.message };
  }
}, 'GET');

app.api('/api/pricing', async () => {
  try {
    return { config: getPricingConfig(), defaults: getDefaultPricingConfig() };
  } catch (err) {
    return { error: 'failed', message: err.message };
  }
}, 'GET');

app.api('/api/pricing', async (data) => {
  try {
    const config = savePricingConfig(data);
    return { ok: true, config };
  } catch (err) {
    return { error: 'failed', message: err.message };
  }
}, 'POST');

app.api('/api/pricing/reset', async () => {
  try {
    const config = resetPricingConfig();
    return { ok: true, config };
  } catch (err) {
    return { error: 'failed', message: err.message };
  }
}, 'POST');

app.run();
ensureCatalog();

function shutdown() {
  releasePidFile();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('exit', releasePidFile);
