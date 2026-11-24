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
export function startCdpInjector({ getMetrics, getQuota, getBoard, onSetBoardStatus, ports = CANDIDATE_PORTS }) {
  const sessions = new Map(); // wsUrl -> { session, conversationId, lastSerialized, lastBoardSerialized }
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
          if (onSetBoardStatus) {
            await session.call('Runtime.enable').catch(() => {});
            await session.call('Runtime.addBinding', { name: '__agyCtxSetBoardStatus' }).catch(() => {});
            session.onEvent(async (msg) => {
              if (msg.method !== 'Runtime.bindingCalled') return;
              if (msg.params?.name !== '__agyCtxSetBoardStatus') return;
              try {
                const payload = JSON.parse(String(msg.params?.payload || '{}'));
                if (payload && (payload.id || Array.isArray(payload.ids))) {
                  await Promise.resolve(onSetBoardStatus(payload));
                  await pushMetrics();
                }
              } catch (err) {
                await session
                  .evalJs(`if (window.__agyCtxBoardActionError) window.__agyCtxBoardActionError(${JSON.stringify(err?.message || '操作同步失败')});`)
                  .catch(() => {});
              }
            });
          }
          await session.evalJs(INLINE_BAR_SCRIPT);
          sessions.set(url, { session, conversationId: cid, lastSerialized: '', lastBoardSerialized: '' });
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
    const boardData = getBoard ? await getBoard().catch(() => null) : null;
    const boardPayload = boardData ? JSON.stringify(boardData) : '';
    for (const [url, entry] of sessions.entries()) {
      try {
        const stateRes = await entry.session.evalJs(
          '({ bootstrapped: Boolean(window.__agyCtxBarBootstrapped), href: location.href })',
        );
        const state = stateRes?.result?.value || {};
        if (!state.bootstrapped) {
          await entry.session.evalJs(INLINE_BAR_SCRIPT);
          entry.lastSerialized = '';
          entry.lastBoardSerialized = '';
        }

        const liveCid = extractConversationId(state.href);
        if (liveCid !== entry.conversationId) {
          entry.conversationId = liveCid;
          entry.lastSerialized = '';
          entry.lastUsageSig = '';
        }

        const metrics = entry.conversationId
          ? await getMetrics(entry.conversationId)
          : { empty: true, cascadeId: '' };
        const usageSig = metrics && !metrics.error && !metrics.empty
          ? `${metrics.turnCount ?? 0}:${metrics.totals?.all ?? 0}`
          : '';
        const usageChanged = Boolean(usageSig && entry.lastUsageSig && usageSig !== entry.lastUsageSig);
        if (usageSig) entry.lastUsageSig = usageSig;

        const quota = getQuota
          ? await getQuota({ force: usageChanged }).catch(() => null)
          : null;
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
        if (payload !== entry.lastSerialized) {
          entry.lastSerialized = payload;
          await entry.session.evalJs(`if (window.__agyCtxUpdate) window.__agyCtxUpdate(${payload});`);
        }

        if (boardPayload && boardPayload !== entry.lastBoardSerialized) {
          entry.lastBoardSerialized = boardPayload;
          await entry.session.evalJs(`if (window.__agyCtxUpdateBoard) window.__agyCtxUpdateBoard(${boardPayload});`);
        }
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
