import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CdpSession, discoverMainTargets, extractConversationId } from './client.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const INLINE_BAR_SCRIPT = readFileSync(join(HERE, 'inline-bar.js'), 'utf8');

const CANDIDATE_PORTS = process.env.ANTIGRAVITY_CDP_PORT
  ? [Number(process.env.ANTIGRAVITY_CDP_PORT)]
  : [9223, 9222, 9224, 9225];
const POLL_MS = 1000;
const DISCOVER_MS = 5000;

/**
 * Start background CDP injection loop. Fails silently when CDP port is not open.
 */
export function startCdpInjector({ getMetrics, getQuota, ports = CANDIDATE_PORTS }) {
  const sessions = new Map(); // wsUrl -> { session, conversationId, lastSerialized }
  let discovering = false;

  async function syncTargets() {
    if (discovering) return;
    discovering = true;
    try {
      const targets = await discoverMainTargets(ports);
      const activeUrls = new Set(targets.map((t) => t.webSocketDebuggerUrl));

      for (const [url, entry] of sessions.entries()) {
        if (!activeUrls.has(url) || !entry.session.connected) {
          entry.session.close();
          sessions.delete(url);
        }
      }

      for (const target of targets) {
        const url = target.webSocketDebuggerUrl;
        const cid = extractConversationId(target.url);
        const existing = sessions.get(url);
        if (existing) {
          existing.conversationId = cid;
          continue;
        }
        const session = new CdpSession(url);
        try {
          await session.connect();
          await session.evalJs(INLINE_BAR_SCRIPT);
          sessions.set(url, { session, conversationId: cid, lastSerialized: '' });
        } catch {
          session.close();
        }
      }
    } catch {
      for (const entry of sessions.values()) entry.session.close();
      sessions.clear();
    } finally {
      discovering = false;
    }
  }

  async function pushMetrics() {
    if (sessions.size === 0) return;
    for (const [url, entry] of sessions.entries()) {
      try {
        const stateRes = await entry.session.evalJs(
          '({ bootstrapped: Boolean(window.__agyCtxBarBootstrapped), href: location.href })',
        );
        const state = stateRes?.result?.value || {};
        if (!state.bootstrapped) {
          await entry.session.evalJs(INLINE_BAR_SCRIPT);
          entry.lastSerialized = '';
        }

        const liveCid = extractConversationId(state.href);
        if (liveCid !== entry.conversationId) {
          entry.conversationId = liveCid;
          entry.lastSerialized = '';
        }

        const [metrics, quota] = await Promise.all([
          entry.conversationId
            ? getMetrics(entry.conversationId)
            : Promise.resolve({ empty: true, cascadeId: '' }),
          getQuota ? getQuota().catch(() => null) : Promise.resolve(null),
        ]);
        const data = !metrics
          ? { empty: true, cascadeId: entry.conversationId }
          : metrics.error
            ? {
                cascadeId: entry.conversationId,
                error: metrics.error,
                message: metrics.message || metrics.error,
              }
            : {
                cascadeId: metrics.cascadeId,
                modelName: metrics.modelName,
                turnCount: metrics.turnCount,
                context: metrics.context,
                totals: metrics.totals,
                cache: metrics.cache,
                speed: metrics.speed,
              };
        if (quota) {
          data.quota = quota;
        }
        const payload = JSON.stringify(data);
        if (payload === entry.lastSerialized) continue;
        entry.lastSerialized = payload;

        await entry.session.evalJs(`if (window.__agyCtxUpdate) window.__agyCtxUpdate(${payload});`);
      } catch {
        entry.session.close();
        sessions.delete(url);
      }
    }
  }

  syncTargets().then(pushMetrics);
  const discoverTimer = setInterval(syncTargets, DISCOVER_MS);
  const pushTimer = setInterval(pushMetrics, POLL_MS);

  return () => {
    clearInterval(discoverTimer);
    clearInterval(pushTimer);
    for (const entry of sessions.values()) entry.session.close();
    sessions.clear();
  };
}
