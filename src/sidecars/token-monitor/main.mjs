import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Response, SidecarApp } from 'sidecar_sdk';
import { startCdpInjector } from '../../statusline/injector.mjs';
import { ensureCatalog, getGlobalSummary, getLatestMetrics, listRecentConversations } from '../../shared/ls-client.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
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

app.run();
ensureCatalog();
startCdpInjector({ getMetrics: (cid) => getLatestMetrics(cid, { includeSubagents: false, fallbackToLatest: false }) });
