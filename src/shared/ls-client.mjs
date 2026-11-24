import { execFile } from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import { promisify } from 'node:util';
import { ensureBoardInitialized, VALID_BOARD_COLUMNS } from './board-store.mjs';
import {
  collectLocalConversationItems,
  findLocalSubagentIds,
  getLocalGlobalSummary,
  listLocalRecentConversations,
  normalizeWorkspaceUriKey,
} from './local-store.mjs';
import { aggregateGlobalStats, computeTrajectoryMetrics } from './metrics.mjs';

const CATALOG_TTL_MS = 10 * 60 * 1000;
const QUOTA_TTL_MS = 5 * 1000;
const QUOTA_MIN_FORCE_MS = 800;
const LS_DISCOVER_TTL_MS = 15 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const execFileAsync = promisify(execFile);
let modelCatalog = {};
let catalogFetchedAt = 0;
let quotaCache = null;
let quotaFetchedAt = 0;
let quotaInFlight = null;
let discoveredLsCache = null; // { addr, csrf }
let lsDiscoverFailedAt = 0;
let lsDiscoverInFlight = null;
const trajectoryStatsCache = new Map(); // cid -> { mtime, item }

export function parseCsrfTokenFromCommandLine(commandLine) {
  const raw = String(commandLine || '');
  const m = raw.match(/--csrf_token(?:=|\s+)(?:"([^"]+)"|'([^']+)'|(\S+))/i);
  return m ? (m[1] || m[2] || m[3] || '').trim() : '';
}

function rawLsRequest(addr, csrf, method, body = {}, timeoutMs = 6000) {
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
        timeout: timeoutMs,
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

async function runWindowsLsProbe() {
  if (process.platform !== 'win32') return [];
  const psScript = `
    $procs = Get-CimInstance Win32_Process -Filter "Name LIKE '%language_server%'" | Where-Object { $_.CommandLine -match 'antigravity|csrf_token' }
    $out = foreach ($p in $procs) {
      $ports = @(Get-NetTCPConnection -OwningProcess $p.ProcessId -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty LocalPort -Unique)
      [PSCustomObject]@{ pid = $p.ProcessId; cmd = $p.CommandLine; ports = $ports }
    }
    $out | ConvertTo-Json -Compress -Depth 3
  `;
  for (const shell of ['pwsh', 'powershell']) {
    try {
      const { stdout } = await execFileAsync(shell, ['-NoProfile', '-NonInteractive', '-Command', psScript], {
        timeout: 4500,
        windowsHide: true,
      });
      const trimmed = String(stdout || '').trim();
      if (!trimmed) return [];
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      // try fallback shell
    }
  }
  return [];
}

export async function discoverLocalLsConnection() {
  if (discoveredLsCache) return discoveredLsCache;
  if (Date.now() - lsDiscoverFailedAt < LS_DISCOVER_TTL_MS) return null;
  if (lsDiscoverInFlight) return lsDiscoverInFlight;

  lsDiscoverInFlight = (async () => {
    try {
      const candidates = await runWindowsLsProbe();
      for (const proc of candidates) {
        const csrf = parseCsrfTokenFromCommandLine(proc?.cmd);
        if (!csrf) continue;
        const ports = Array.isArray(proc?.ports) ? proc.ports : [];
        for (const port of ports) {
          const p = Number(port);
          if (!Number.isInteger(p) || p <= 0) continue;
          for (const proto of ['http', 'https']) {
            const addr = `${proto}://127.0.0.1:${p}`;
            try {
              await rawLsRequest(addr, csrf, 'GetAllCascadeTrajectories', {}, 1500);
              discoveredLsCache = { addr, csrf };
              return discoveredLsCache;
            } catch {
              // try next protocol or port
            }
          }
        }
      }
      lsDiscoverFailedAt = Date.now();
      return null;
    } finally {
      lsDiscoverInFlight = null;
    }
  })();

  return lsDiscoverInFlight;
}

export async function lsRequest(method, body = {}) {
  const envAddr = (process.env.ANTIGRAVITY_LS_ADDRESS || '').trim();
  const envCsrf = (process.env.ANTIGRAVITY_CSRF_TOKEN || '').trim();
  if (envAddr && envCsrf) {
    return rawLsRequest(envAddr, envCsrf, method, body);
  }

  const discovered = await discoverLocalLsConnection();
  if (!discovered) {
    throw new Error('Language server connection env vars are not set.');
  }
  try {
    return await rawLsRequest(discovered.addr, discovered.csrf, method, body);
  } catch (err) {
    discoveredLsCache = null;
    throw err;
  }
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

function buildSubagentMeta(spec = {}, agentScript = {}, fallbackLabel = '', nestingDepth = 1) {
  const scriptName = agentScript?.name || '';
  const typeName = String(spec?.typeName || '').trim();
  const typeLower = typeName.toLowerCase();
  const role = spec?.role || scriptName || typeName || fallbackLabel;
  const isSwarm = typeLower === 'worker' || (!typeLower && /^swarm\b/i.test(String(spec?.role || '')));
  return {
    role,
    scriptName,
    typeName,
    isSwarm,
    nestingDepth: Number(nestingDepth) || 1,
  };
}

export function findSubagentEntries(summaries, parentOrRootId) {
  if (!summaries || !parentOrRootId) return [];
  const results = [];
  for (const [id, info] of Object.entries(summaries)) {
    if (id === parentOrRootId) continue;
    const meta = info?.trajectoryMetadata || {};
    if (meta.rootConversationId === parentOrRootId || meta.parentConversationId === parentOrRootId) {
      const parsed = buildSubagentMeta(meta.subagentSpec, meta.agentScript, info?.summary || id.slice(0, 8), meta.nestingDepth);
      results.push({
        id,
        ...parsed,
        status: info?.status || '',
        killed: Boolean(info?.killed),
        lastModifiedTime: info?.lastModifiedTime || '',
      });
    }
  }
  return results.sort((a, b) => (b.lastModifiedTime || '').localeCompare(a.lastModifiedTime || ''));
}

export function extractSubagentsFromTrajectory(trajectoryResp, parentOrRootId) {
  const steps = trajectoryResp?.trajectory?.steps;
  if (!Array.isArray(steps) || steps.length === 0) return [];
  const byId = new Map();
  for (const step of steps) {
    const inv = step?.invokeSubagent;
    if (!inv || !Array.isArray(inv.results)) continue;
    const specs = Array.isArray(inv.subagents) ? inv.subagents : [];
    const lastModifiedTime = step?.metadata?.completedAt || step?.metadata?.createdAt || '';
    const status = step?.status === 'CORTEX_STEP_STATUS_RUNNING'
      ? 'CASCADE_RUN_STATUS_RUNNING'
      : (step?.status === 'CORTEX_STEP_STATUS_DONE' ? 'CASCADE_RUN_STATUS_IDLE' : '');
    for (let i = 0; i < inv.results.length; i += 1) {
      const id = inv.results[i]?.conversationId;
      if (!id || id === parentOrRootId) continue;
      const spec = specs[i] || specs[0] || {};
      const parsed = buildSubagentMeta(spec, null, id.slice(0, 8), 1);
      byId.set(id, {
        id,
        ...parsed,
        status,
        killed: false,
        lastModifiedTime,
      });
    }
  }
  return Array.from(byId.values()).sort((a, b) => (b.lastModifiedTime || '').localeCompare(a.lastModifiedTime || ''));
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

  const [catalog, trajectoryResp] = await Promise.all([
    ensureCatalog(),
    lsRequest('GetCascadeTrajectory', { cascadeId: cid }),
  ]);

  let subagentEntries = [];
  if (includeSubagents) {
    const merged = new Map();
    for (const item of findSubagentEntries(summaries, cid)) {
      merged.set(item.id, item);
    }
    for (const item of extractSubagentsFromTrajectory(trajectoryResp, cid)) {
      if (!merged.has(item.id)) merged.set(item.id, item);
    }
    for (const item of findLocalSubagentIds(cid)) {
      if (!merged.has(item.id)) {
        merged.set(item.id, {
          id: item.id,
          role: item.role,
          scriptName: '',
          typeName: '',
          isSwarm: false,
          status: '',
          killed: false,
          nestingDepth: 1,
          lastModifiedTime: item.lastModifiedTime,
        });
      }
    }
    subagentEntries = Array.from(merged.values())
      .sort((a, b) => (b.lastModifiedTime || '').localeCompare(a.lastModifiedTime || ''))
      .slice(0, 20);
  }

  const subagentMetrics = await Promise.all(
    subagentEntries.map(async (sub) => {
      try {
        const subTraj = await lsRequest('GetCascadeTrajectory', { cascadeId: sub.id });
        const m = computeTrajectoryMetrics(subTraj, catalog);
        const subMeta = subTraj?.trajectory?.metadata || {};
        const parsed = subMeta.subagentSpec || subMeta.agentScript
          ? buildSubagentMeta(subMeta.subagentSpec, subMeta.agentScript, sub.role, subMeta.nestingDepth ?? sub.nestingDepth)
          : null;
        return {
          id: sub.id,
          role: parsed?.role || sub.role,
          scriptName: parsed?.scriptName || sub.scriptName,
          typeName: parsed?.typeName || sub.typeName,
          isSwarm: parsed ? parsed.isSwarm : sub.isSwarm,
          status: sub.status || m.status,
          killed: sub.killed,
          nestingDepth: parsed?.nestingDepth || sub.nestingDepth,
          modelName: m.modelName,
          turnCount: m.turnCount,
          context: m.context,
          totals: m.totals,
          cache: m.cache,
          speed: m.speed,
          cost: m.cost,
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
  );

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

function extractWorkspaceUris(info) {
  const uris = [];
  if (Array.isArray(info?.workspaces)) {
    for (const ws of info.workspaces) {
      if (ws?.workspaceFolderAbsoluteUri) uris.push(ws.workspaceFolderAbsoluteUri);
    }
  }
  const metaUris = info?.trajectoryMetadata?.workspaceUris;
  if (Array.isArray(metaUris)) {
    for (const u of metaUris) {
      if (u) uris.push(u);
    }
  }
  return uris;
}

function uriToDisplayPath(uri) {
  if (!uri) return '';
  try {
    return decodeURIComponent(uri.replace(/^file:\/+([A-Za-z]:)/, '$1').replace(/^file:\/\//, ''));
  } catch {
    return uri;
  }
}

export function filterSummariesByWorkspace(summaries = {}, conversationId = '') {
  const entries = Object.entries(summaries || {});
  if (entries.length === 0) {
    return { filtered: {}, workspaceName: '', workspacePath: '', workspaceKeys: [] };
  }

  const resolveRootInfo = (cid) => {
    if (!cid || !summaries[cid]) return null;
    const info = summaries[cid];
    if (extractWorkspaceUris(info).length > 0) return info;
    const meta = info?.trajectoryMetadata || {};
    const parentId = meta.rootConversationId || meta.parentConversationId || '';
    if (parentId && summaries[parentId] && extractWorkspaceUris(summaries[parentId]).length > 0) {
      return summaries[parentId];
    }
    return info;
  };

  let targetInfo = resolveRootInfo(conversationId);
  if (!targetInfo || extractWorkspaceUris(targetInfo).length === 0) {
    const sorted = entries
      .filter(([, info]) => !info?.trajectoryMetadata?.parentConversationId && extractWorkspaceUris(info).length > 0)
      .sort((a, b) => (Date.parse(b[1]?.lastModifiedTime || '') || 0) - (Date.parse(a[1]?.lastModifiedTime || '') || 0));
    if (sorted.length > 0) {
      targetInfo = sorted[0][1];
    }
  }

  const targetUris = extractWorkspaceUris(targetInfo);
  const targetKeys = new Set(targetUris.map((u) => normalizeWorkspaceUriKey(u)).filter(Boolean));
  const workspaceName = extractWorkspaceDisplayName(targetInfo);
  const workspacePath = uriToDisplayPath(targetUris[0] || '');

  if (targetKeys.size === 0) {
    return { filtered: summaries, workspaceName, workspacePath, workspaceKeys: [] };
  }

  const rootMatched = new Set();
  for (const [id, info] of entries) {
    const keys = extractWorkspaceUris(info).map((u) => normalizeWorkspaceUriKey(u)).filter(Boolean);
    if (keys.some((k) => targetKeys.has(k))) {
      rootMatched.add(id);
    }
  }

  const filtered = {};
  for (const [id, info] of entries) {
    if (rootMatched.has(id)) {
      filtered[id] = info;
      continue;
    }
    const meta = info?.trajectoryMetadata || {};
    const rootId = meta.rootConversationId || '';
    const parentId = meta.parentConversationId || '';
    if ((rootId && rootMatched.has(rootId)) || (parentId && rootMatched.has(parentId))) {
      filtered[id] = info;
    }
  }

  return { filtered, workspaceName, workspacePath, workspaceKeys: Array.from(targetKeys) };
}

export async function getGlobalSummary(range = 'today', scope = 'workspace', { conversationId = '' } = {}) {
  const cutoffMs = getRangeCutoffMs(range);
  if (scope === 'all') {
    const catalog = await ensureCatalog().catch(() => ({}));
    return getLocalGlobalSummary(range, cutoffMs, catalog);
  }

  const [catalog, list] = await Promise.all([
    ensureCatalog(),
    lsRequest('GetAllCascadeTrajectories', {}),
  ]);
  const allSummaries = list?.trajectorySummaries || {};
  const { filtered: summaries, workspaceName, workspacePath, workspaceKeys } = filterSummariesByWorkspace(allSummaries, conversationId);

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

  let localItems = [];
  if (workspaceKeys.length > 0) {
    try {
      localItems = collectLocalConversationItems(cutoffMs, catalog, undefined, { workspaceKeys });
    } catch {
      localItems = [];
    }
  }

  const mergedMap = new Map();
  for (const item of localItems) {
    if (item?.cascadeId) mergedMap.set(item.cascadeId, item);
  }
  for (const item of items) {
    if (item?.cascadeId) mergedMap.set(item.cascadeId, item);
  }

  const stats = aggregateGlobalStats(Array.from(mergedMap.values()), range);
  return {
    range,
    scope: 'workspace',
    workspaceName,
    workspacePath,
    ...stats,
    updatedAt: new Date().toISOString(),
  };
}

function normalizeQuotaBucket(bucket) {
  if (!bucket || typeof bucket !== 'object') return null;
  const raw = Number(bucket.remainingFraction);
  if (!Number.isFinite(raw)) return null;
  const clamped = Math.max(0, Math.min(1, raw));
  return {
    pct: Math.round(clamped * 100),
    remainingFraction: clamped,
    resetTime: typeof bucket.resetTime === 'string' ? bucket.resetTime : '',
  };
}

/**
 * Extract the Gemini Models 5h and weekly quota buckets from RetrieveUserQuotaSummary response.
 */
export function extractGeminiQuota(resp) {
  const groups = resp?.response?.groups || resp?.groups || [];
  if (!Array.isArray(groups) || groups.length === 0) return null;

  const geminiGroup = groups.find((g) => {
    const buckets = Array.isArray(g?.buckets) ? g.buckets : [];
    if (buckets.some((b) => b?.bucketId === 'gemini-5h' || b?.bucketId === 'gemini-weekly')) {
      return true;
    }
    return String(g?.displayName || '').trim().toLowerCase() === 'gemini models';
  });
  if (!geminiGroup) return null;

  const buckets = Array.isArray(geminiGroup.buckets) ? geminiGroup.buckets : [];
  const fiveHourRaw = buckets.find((b) => b?.bucketId === 'gemini-5h' || b?.window === '5h');
  const weeklyRaw = buckets.find((b) => b?.bucketId === 'gemini-weekly' || b?.window === 'weekly');

  const fiveHour = normalizeQuotaBucket(fiveHourRaw);
  const weekly = normalizeQuotaBucket(weeklyRaw);
  if (!fiveHour && !weekly) return null;

  return { fiveHour, weekly };
}

/**
 * Fetch and cache the Gemini Models quota summary from the Language Server.
 */
export async function getGeminiQuotaSummary({ force = false } = {}) {
  const age = Date.now() - quotaFetchedAt;
  if (quotaCache && ((!force && age < QUOTA_TTL_MS) || (force && age < QUOTA_MIN_FORCE_MS))) {
    return quotaCache;
  }
  if (quotaInFlight) {
    return quotaInFlight;
  }
  quotaInFlight = (async () => {
    try {
      const resp = await lsRequest('RetrieveUserQuotaSummary', {
        forceRefresh: true,
      });
      const parsed = extractGeminiQuota(resp);
      if (parsed) {
        quotaCache = parsed;
        quotaFetchedAt = Date.now();
      }
      return parsed || quotaCache;
    } catch (err) {
      console.error('[token-monitor] RetrieveUserQuotaSummary failed:', err.message);
      return null;
    } finally {
      quotaInFlight = null;
    }
  })();
  return quotaInFlight;
}

function extractWorkspaceDisplayName(info) {
  const ws = Array.isArray(info?.workspaces) ? info.workspaces[0] : null;
  const uri = ws?.workspaceFolderAbsoluteUri || info?.trajectoryMetadata?.workspaceUris?.[0] || '';
  if (uri) {
    const cleaned = uri.replace(/\/+$/, '');
    try {
      const folder = decodeURIComponent(cleaned.split('/').pop() || '');
      if (folder) return folder;
    } catch {
      const folder = cleaned.split('/').pop() || '';
      if (folder) return folder;
    }
  }
  const repoName = ws?.repository?.computedName;
  if (repoName) return repoName.split('/').pop() || repoName;
  return '';
}

export function normalizeBoardStatus(status = '', terminationReason = '', opts = {}) {
  const s = String(status || '').toUpperCase();
  const reason = String(terminationReason || '').toUpperCase();
  if (/WAITING|CONFIRM|PENDING|NEEDS_INPUT|USER_INPUT/.test(s)) return 'waiting';
  if (/RUNNING|QUEUED|EXECUTING|GENERATING|IN_PROGRESS/.test(s) || opts?.notFullyIdle) return 'running';

  const manualCol = String(opts?.manualColumn || '').trim();
  if (manualCol && VALID_BOARD_COLUMNS.has(manualCol)) {
    return manualCol;
  }

  if (opts?.killed || /ERROR|FAILED|CANCELLED|ABORTED/.test(s)) return 'error';
  if (/ERROR|FAILED|CANCELLED|ABORTED/.test(reason) && !/IDLE|DONE|COMPLETED/.test(s)) return 'error';
  return 'idle';
}

function deriveBoardCardFlags({ status, terminationReason, killed, notFullyIdle, lastModifiedTime, cardState, initializedAt }) {
  const state = cardState && typeof cardState === 'object' ? cardState : {};
  const boardStatus = normalizeBoardStatus(status, terminationReason, {
    killed,
    notFullyIdle,
  });
  const starred = Boolean(state.starred);
  const lastMs = lastModifiedTime ? Date.parse(lastModifiedTime) : 0;

  let archived = false;
  if (state.archived && boardStatus !== 'waiting' && boardStatus !== 'running') {
    const archivedMs = Date.parse(state.archivedAt || state.updatedAt || '');
    if (!Number.isFinite(lastMs) || !Number.isFinite(archivedMs) || lastMs <= archivedMs + 2000) {
      archived = true;
    }
  }

  let isUnread = false;
  if (boardStatus === 'idle' && !archived && Number.isFinite(lastMs) && lastMs > 0) {
    const seenMs = state.seenAt ? Date.parse(state.seenAt) : 0;
    const initMs = initializedAt ? Date.parse(initializedAt) : 0;
    const baselineMs = (Number.isFinite(seenMs) && seenMs > 0) ? seenMs : (Number.isFinite(initMs) ? initMs : 0);
    if (baselineMs > 0 && lastMs > baselineMs + 2000) {
      isUnread = true;
    }
  }

  return {
    boardStatus,
    isManual: false,
    starred,
    archived,
    seenAt: state.seenAt || '',
    isUnread,
  };
}

export async function renameConversation(cascadeId, title) {
  const id = String(cascadeId || '').trim();
  const trimmed = String(title || '').trim();
  if (!id || !trimmed) return { ok: false, error: 'missing id or title' };

  let existingAnnotations = {};
  try {
    const resp = await lsRequest('GetAllCascadeTrajectories', {});
    const raw = resp?.trajectorySummaries?.[id]?.annotations;
    if (raw && typeof raw === 'object') existingAnnotations = raw;
  } catch {
    // ignore fetch error; proceed with title-only annotations
  }

  try {
    await lsRequest('UpdateConversationAnnotations', {
      cascadeId: id,
      annotations: {
        ...existingAnnotations,
        title: trimmed,
      },
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message || 'rename failed' };
  }
}

export async function getWorkspaceBoardData(limit = 120) {
  const byId = new Map();
  let currentWorkspaceName = '';
  const currentWorkspaceKeys = new Set();
  const { initializedAt, cards: manualMap } = ensureBoardInitialized();

  const localItems = listLocalRecentConversations(limit);
  for (const item of localItems) {
    const cardState = manualMap[item.id];
    const flags = deriveBoardCardFlags({
      status: item.status,
      terminationReason: '',
      killed: item.killed,
      notFullyIdle: item.notFullyIdle,
      lastModifiedTime: item.lastModifiedTime,
      cardState,
      initializedAt,
    });
    byId.set(item.id, {
      ...item,
      summary: cardState?.customTitle || item.summary,
      ...flags,
    });
  }

  try {
    const resp = await lsRequest('GetAllCascadeTrajectories', {});
    const summaries = resp?.trajectorySummaries || {};
    const subagentCountByRoot = new Map();

    for (const [id, info] of Object.entries(summaries)) {
      const meta = info?.trajectoryMetadata || {};
      const rootId = meta.rootConversationId || meta.parentConversationId;
      if (meta.parentConversationId && rootId && rootId !== id) {
        subagentCountByRoot.set(rootId, (subagentCountByRoot.get(rootId) || 0) + 1);
      }
      const ws = Array.isArray(info?.workspaces) ? info.workspaces[0] : null;
      const wsUri = ws?.workspaceFolderAbsoluteUri || meta?.workspaceUris?.[0] || '';
      const key = normalizeWorkspaceUriKey(wsUri);
      if (key) currentWorkspaceKeys.add(key);
    }

    for (const [id, info] of Object.entries(summaries)) {
      const meta = info?.trajectoryMetadata || {};
      if (meta.parentConversationId) continue;
      const wsName = extractWorkspaceDisplayName(info);
      if (wsName && !currentWorkspaceName) currentWorkspaceName = wsName;
      const ws = Array.isArray(info?.workspaces) ? info.workspaces[0] : null;
      const prev = byId.get(id);
      const status = info?.status || prev?.status || '';
      const terminationReason = info?.latestExecutorTerminationReason || '';
      const lastModifiedTime = info?.lastModifiedTime || prev?.lastModifiedTime || '';
      const cardState = manualMap[id];
      const flags = deriveBoardCardFlags({
        status,
        terminationReason,
        killed: prev?.killed,
        notFullyIdle: prev?.notFullyIdle,
        lastModifiedTime,
        cardState,
        initializedAt,
      });
      byId.set(id, {
        id,
        summary: info?.annotations?.title || cardState?.customTitle || info?.summary || prev?.summary || id.slice(0, 8),
        stepCount: Number(info?.stepCount) || prev?.stepCount || 0,
        lastModifiedTime,
        status,
        ...flags,
        subagentCount: Math.max(subagentCountByRoot.get(id) || 0, prev?.subagentCount || 0),
        workspaceName: wsName || prev?.workspaceName || '',
        workspaceKeys: prev?.workspaceKeys || [],
        branchName: ws?.branchName || prev?.branchName || '',
        isCurrentWorkspace: true,
        source: 'live',
      });
    }
  } catch {
    // LS unavailable; fall back to local SQLite index only
  }

  if (currentWorkspaceKeys.size > 0) {
    for (const item of byId.values()) {
      if (!item.isCurrentWorkspace && Array.isArray(item.workspaceKeys)) {
        if (item.workspaceKeys.some((k) => currentWorkspaceKeys.has(k))) {
          item.isCurrentWorkspace = true;
        }
      }
    }
  }

  const conversations = Array.from(byId.values())
    .sort((a, b) => (b.lastModifiedTime || '').localeCompare(a.lastModifiedTime || ''))
    .slice(0, limit)
    .map(({ workspaceKeys, killed, notFullyIdle, ...rest }) => rest);

  return {
    currentWorkspaceName,
    conversations,
    updatedAt: new Date().toISOString(),
  };
}
