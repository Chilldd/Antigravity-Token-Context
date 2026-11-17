import http from 'node:http';
import https from 'node:https';
import { getLocalGlobalSummary } from './local-store.mjs';
import { aggregateGlobalStats, computeTrajectoryMetrics } from './metrics.mjs';

const CATALOG_TTL_MS = 10 * 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let modelCatalog = {};
let catalogFetchedAt = 0;
const trajectoryStatsCache = new Map(); // cid -> { mtime, item }

export function lsRequest(method, body = {}) {
  const addr = (process.env.ANTIGRAVITY_LS_ADDRESS || '').trim();
  const csrf = (process.env.ANTIGRAVITY_CSRF_TOKEN || '').trim();
  if (!addr || !csrf) {
    return Promise.reject(new Error('Language server connection env vars are not set.'));
  }
  const base = new URL(addr.startsWith('http') ? addr : `http://${addr}`);
  const data = JSON.stringify(body);
  const transport = base.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const req = transport.request(
      {
        hostname: base.hostname,
        port: base.port,
        path: `/exa.language_server_pb.LanguageServerService/${method}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Connect-Protocol-Version': '1',
          'x-codeium-csrf-token': csrf,
          'Content-Length': Buffer.byteLength(data),
        },
        timeout: 6000,
        rejectUnauthorized: false,
      },
      (res) => {
        let text = '';
        res.on('data', (chunk) => { text += chunk; });
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`${method}: HTTP ${res.statusCode}`));
            return;
          }
          try {
            resolve(JSON.parse(text));
          } catch (err) {
            reject(err);
          }
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error(`${method}: timeout`)));
    req.on('error', reject);
    req.end(data);
  });
}

export async function ensureCatalog() {
  if (Date.now() - catalogFetchedAt < CATALOG_TTL_MS && Object.keys(modelCatalog).length > 0) {
    return modelCatalog;
  }
  try {
    const resp = await lsRequest('GetAvailableModels', {
      metadata: { ideName: 'antigravity', extensionName: 'antigravity' },
    });
    const models = resp?.response?.models || resp?.models || {};
    const next = {};
    for (const [id, m] of Object.entries(models)) {
      const maxTokens = Number(m?.maxTokens) || 0;
      const displayName = m?.displayName || '';
      if (maxTokens > 0 || displayName) {
        next[id] = { maxTokens, displayName };
      }
    }
    if (Object.keys(next).length > 0) {
      modelCatalog = next;
      catalogFetchedAt = Date.now();
    }
  } catch (err) {
    console.error('[token-monitor] GetAvailableModels failed:', err.message);
  }
  return modelCatalog;
}

export function findSubagentEntries(summaries, parentOrRootId) {
  if (!summaries || !parentOrRootId) return [];
  const results = [];
  for (const [id, info] of Object.entries(summaries)) {
    if (id === parentOrRootId) continue;
    const meta = info?.trajectoryMetadata || {};
    if (meta.rootConversationId === parentOrRootId || meta.parentConversationId === parentOrRootId) {
      const spec = meta.subagentSpec || {};
      const scriptName = meta.agentScript?.name || '';
      const role = spec.role || scriptName || spec.typeName || info?.summary || id.slice(0, 8);
      const isSwarm = spec.typeName === 'worker' || Boolean(scriptName);
      results.push({
        id,
        role,
        scriptName,
        typeName: spec.typeName || '',
        isSwarm,
        status: info?.status || '',
        killed: Boolean(info?.killed),
        nestingDepth: Number(meta.nestingDepth) || 1,
        lastModifiedTime: info?.lastModifiedTime || '',
      });
    }
  }
  return results.sort((a, b) => (b.lastModifiedTime || '').localeCompare(a.lastModifiedTime || ''));
}

export async function listRecentConversations(limit = 30) {
  const resp = await lsRequest('GetAllCascadeTrajectories', {});
  const summaries = resp?.trajectorySummaries || {};
  return Object.entries(summaries)
    .map(([id, info]) => {
      const meta = info?.trajectoryMetadata || {};
      const role = meta?.subagentSpec?.role || meta?.agentScript?.name || '';
      const isSubagent = Boolean(meta.parentConversationId);
      return {
        id,
        summary: info?.summary || role || id.slice(0, 8),
        stepCount: Number(info?.stepCount) || 0,
        lastModifiedTime: info?.lastModifiedTime || '',
        status: info?.status || '',
        isSubagent,
      };
    })
    .sort((a, b) => (b.lastModifiedTime || '').localeCompare(a.lastModifiedTime || ''))
    .slice(0, limit);
}

export async function getLatestMetrics(conversationId = '', { includeSubagents = true, fallbackToLatest = true } = {}) {
  let cid = (conversationId || '').trim();
  if (!UUID_RE.test(cid) && !fallbackToLatest) {
    return { error: 'no-conversation' };
  }
  const list = await lsRequest('GetAllCascadeTrajectories', {});
  const summaries = list?.trajectorySummaries || {};

  if (!UUID_RE.test(cid)) {
    const entries = Object.entries(summaries).sort((a, b) =>
      (b[1]?.lastModifiedTime || '').localeCompare(a[1]?.lastModifiedTime || ''),
    );
    if (entries.length === 0) {
      return { error: 'no-conversation' };
    }
    cid = entries[0][0];
  }

  const subagentEntries = includeSubagents ? findSubagentEntries(summaries, cid).slice(0, 20) : [];

  const [catalog, trajectoryResp, subagentMetrics] = await Promise.all([
    ensureCatalog(),
    lsRequest('GetCascadeTrajectory', { cascadeId: cid }),
    Promise.all(
      subagentEntries.map(async (sub) => {
        try {
          const subTraj = await lsRequest('GetCascadeTrajectory', { cascadeId: sub.id });
          const m = computeTrajectoryMetrics(subTraj, modelCatalog);
          return {
            id: sub.id,
            role: sub.role,
            scriptName: sub.scriptName,
            typeName: sub.typeName,
            isSwarm: sub.isSwarm,
            status: sub.status || m.status,
            killed: sub.killed,
            nestingDepth: sub.nestingDepth,
            modelName: m.modelName,
            turnCount: m.turnCount,
            context: m.context,
            totals: m.totals,
            cache: m.cache,
            speed: m.speed,
          };
        } catch {
          return {
            id: sub.id,
            role: sub.role,
            typeName: sub.typeName,
            status: sub.status,
            killed: sub.killed,
            nestingDepth: sub.nestingDepth,
            error: true,
          };
        }
      }),
    ),
  ]);

  const metrics = computeTrajectoryMetrics(trajectoryResp, catalog);
  const summaryMeta = summaries[cid]?.trajectoryMetadata || {};
  const trajMeta = trajectoryResp?.trajectory?.metadata || {};
  const parentConversationId = summaryMeta.parentConversationId || trajMeta.parentConversationId || '';
  const rootConversationId = summaryMeta.rootConversationId || trajMeta.rootConversationId || '';

  return {
    ...metrics,
    cascadeId: metrics.cascadeId || cid,
    parentConversationId,
    rootConversationId,
    subagents: subagentMetrics,
    updatedAt: new Date().toISOString(),
  };
}

function getRangeCutoffMs(range) {
  const now = new Date();
  if (range === 'today') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return start.getTime();
  }
  if (range === '7d') return Date.now() - 7 * 24 * 60 * 60 * 1000;
  if (range === '30d') return Date.now() - 30 * 24 * 60 * 60 * 1000;
  return 0;
}

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const idx = cursor++;
      results[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export async function getGlobalSummary(range = 'today', scope = 'workspace') {
  const cutoffMs = getRangeCutoffMs(range);
  if (scope === 'all') {
    const catalog = await ensureCatalog().catch(() => ({}));
    return getLocalGlobalSummary(range, cutoffMs, catalog);
  }

  const [catalog, list] = await Promise.all([
    ensureCatalog(),
    lsRequest('GetAllCascadeTrajectories', {}),
  ]);
  const summaries = list?.trajectorySummaries || {};

  const candidates = Object.entries(summaries)
    .map(([id, info]) => {
      const mtime = info?.lastModifiedTime || '';
      const ts = mtime ? Date.parse(mtime) : 0;
      const meta = info?.trajectoryMetadata || {};
      const role = meta?.subagentSpec?.role || meta?.agentScript?.name || '';
      const isSubagent = Boolean(meta.parentConversationId);
      return {
        id,
        mtime,
        ts: Number.isFinite(ts) ? ts : 0,
        title: info?.summary || role || id.slice(0, 8),
        isSubagent,
        rootConversationId: meta.rootConversationId || meta.parentConversationId || '',
      };
    })
    .filter((c) => cutoffMs === 0 || c.ts >= cutoffMs)
    .sort((a, b) => b.ts - a.ts);

  const items = await mapWithConcurrency(candidates, 8, async (c) => {
    const cached = trajectoryStatsCache.get(c.id);
    if (cached && cached.mtime === c.mtime) {
      return cached.item;
    }
    try {
      const traj = await lsRequest('GetCascadeTrajectory', { cascadeId: c.id });
      const m = computeTrajectoryMetrics(traj, catalog);
      const item = {
        cascadeId: c.id,
        title: c.title,
        isSubagent: c.isSubagent,
        rootConversationId: c.rootConversationId,
        lastModifiedTime: c.mtime,
        modelName: m.modelName,
        turnCount: m.turnCount,
        totals: m.totals,
        cache: m.cache,
        allTurns: m.allTurns,
      };
      trajectoryStatsCache.set(c.id, { mtime: c.mtime, item });
      return item;
    } catch {
      return null;
    }
  });

  const stats = aggregateGlobalStats(items, range);
  return {
    range,
    scope: 'workspace',
    ...stats,
    updatedAt: new Date().toISOString(),
  };
}
