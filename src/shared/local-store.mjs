import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { aggregateGlobalStats } from './metrics.mjs';

const localStatsCache = new Map(); // cid -> { mtime, item }
const utf8Decoder = new TextDecoder('utf-8');

function decodeUtf8(u8) {
  return utf8Decoder.decode(u8);
}

/**
 * Resolve Antigravity app data directory containing conversation_summaries.db and conversations/*.db.
 */
export function resolveAppDataDir() {
  return (process.env.ANTIGRAVITY_APP_DATA_DIR || '').trim() || join(homedir(), '.gemini', 'antigravity');
}

/**
 * Parse a protobuf binary buffer into an array of { field, wire, value } entries.
 * Uses multiplication instead of bitwise shift for varints to avoid 32-bit overflow.
 */
function parseProtoFields(buf) {
  const fields = [];
  let i = 0;
  const len = buf.length;

  while (i < len) {
    let tag = 0;
    let factor = 1;
    while (i < len) {
      const b = buf[i++];
      tag += (b & 0x7f) * factor;
      if ((b & 0x80) === 0) break;
      factor *= 128;
    }
    const field = Math.floor(tag / 8);
    const wire = tag % 8;

    if (wire === 0) {
      let val = 0;
      let vFactor = 1;
      while (i < len) {
        const b = buf[i++];
        val += (b & 0x7f) * vFactor;
        if ((b & 0x80) === 0) break;
        vFactor *= 128;
      }
      fields.push({ field, wire, value: val });
    } else if (wire === 1) {
      if (i + 8 > len) break;
      fields.push({ field, wire, value: buf.subarray(i, i + 8) });
      i += 8;
    } else if (wire === 2) {
      let slen = 0;
      let lFactor = 1;
      while (i < len) {
        const b = buf[i++];
        slen += (b & 0x7f) * lFactor;
        if ((b & 0x80) === 0) break;
        lFactor *= 128;
      }
      if (slen < 0 || i + slen > len) break;
      fields.push({ field, wire, value: buf.subarray(i, i + slen) });
      i += slen;
    } else if (wire === 5) {
      if (i + 4 > len) break;
      fields.push({ field, wire, value: buf.subarray(i, i + 4) });
      i += 4;
    } else {
      break;
    }
  }
  return fields;
}

function parseProtoDurationSec(buf) {
  let sec = 0;
  let nanos = 0;
  for (const { field, wire, value } of parseProtoFields(buf)) {
    if (wire === 0 && field === 1) sec = value;
    else if (wire === 0 && field === 2) nanos = value;
  }
  const total = sec + nanos / 1e9;
  return total > 0 ? total : null;
}

function parseProtoTimestampIso(buf) {
  let sec = 0;
  let nanos = 0;
  for (const { field, wire, value } of parseProtoFields(buf)) {
    if (wire === 0 && field === 1) sec = value;
    else if (wire === 0 && field === 2) nanos = value;
  }
  if (!sec) return '';
  const ms = sec * 1000 + Math.floor(nanos / 1e6);
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

function parseSqliteTimestampMs(raw) {
  if (!raw) return 0;
  const s = String(raw).trim().replace(' ', 'T');
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : 0;
}

function parseUsageFields(buf) {
  const usage = {
    inputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    outputTokens: 0,
    thinkingOutputTokens: 0,
    responseOutputTokens: 0,
  };
  for (const { field, wire, value } of parseProtoFields(buf)) {
    if (wire !== 0) continue;
    if (field === 2) usage.inputTokens = value;
    else if (field === 3) usage.outputTokens = value;
    else if (field === 4) usage.cacheCreationTokens = value;
    else if (field === 5) usage.cacheReadTokens = value;
    else if (field === 9) usage.thinkingOutputTokens = value;
    else if (field === 10) usage.responseOutputTokens = value;
  }
  return usage;
}

function parseGenMetadataTurn(buf, stepCreatedAtMap, catalog, turnIndex) {
  let chatModelBuf = null;
  for (const { field, wire, value } of parseProtoFields(buf)) {
    if (field === 1 && wire === 2) {
      chatModelBuf = value;
      break;
    }
  }
  if (!chatModelBuf) return null;

  let usage = null;
  let ttftSec = null;
  let streamingSec = null;
  let responseModel = '';
  let displayName = '';
  let modelEnum = '';
  let firstStepIdx = null;

  for (const { field, wire, value } of parseProtoFields(chatModelBuf)) {
    if (wire !== 2) continue;
    if (field === 4) {
      usage = parseUsageFields(value);
    } else if (field === 10 && firstStepIdx == null) {
      for (const sf of parseProtoFields(value)) {
        if (sf.field === 1 && sf.wire === 0) {
          firstStepIdx = sf.value;
          break;
        }
      }
    } else if (field === 11) {
      ttftSec = parseProtoDurationSec(value);
    } else if (field === 12) {
      streamingSec = parseProtoDurationSec(value);
    } else if (field === 19) {
      responseModel = decodeUtf8(value);
    } else if (field === 21) {
      displayName = decodeUtf8(value);
    } else if (field === 20) {
      let k = '';
      let v = '';
      for (const kv of parseProtoFields(value)) {
        if (kv.wire === 2 && kv.field === 1) k = decodeUtf8(kv.value);
        else if (kv.wire === 2 && kv.field === 2) v = decodeUtf8(kv.value);
      }
      if (k === 'model_enum' && v) modelEnum = v;
    }
  }

  if (!usage) return null;

  const modelId = modelEnum || responseModel || '';
  const modelName = displayName || catalog[modelId]?.displayName || responseModel || modelId || 'Unknown';
  const promptTotal = usage.inputTokens + usage.cacheReadTokens + usage.cacheCreationTokens;
  const createdAt = firstStepIdx != null ? (stepCreatedAtMap.get(firstStepIdx) || '') : '';

  return {
    turnIndex,
    modelId,
    modelName,
    inputTokens: usage.inputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheCreationTokens: usage.cacheCreationTokens,
    promptTotal,
    outputTokens: usage.outputTokens,
    thinkingOutputTokens: usage.thinkingOutputTokens,
    responseOutputTokens: usage.responseOutputTokens,
    ttftSec,
    streamingSec,
    createdAt,
  };
}

function readConversationItemFromDb(convDbPath, meta, catalog) {
  if (!existsSync(convDbPath)) return null;
  let db;
  try {
    db = new DatabaseSync(convDbPath, { readOnly: true });
    const genRows = db.prepare('SELECT idx, data FROM gen_metadata ORDER BY idx').all();
    if (!genRows || genRows.length === 0) return null;

    const stepCreatedAtMap = new Map();
    const stepRows = db.prepare('SELECT idx, metadata FROM steps WHERE metadata IS NOT NULL').all();
    for (const row of stepRows) {
      for (const { field, wire, value } of parseProtoFields(row.metadata)) {
        if (field === 1 && wire === 2) {
          const iso = parseProtoTimestampIso(value);
          if (iso) stepCreatedAtMap.set(row.idx, iso);
          break;
        }
      }
    }

    const turns = [];
    let uncachedInput = 0;
    let cacheRead = 0;
    let cacheCreation = 0;
    let output = 0;
    let thinking = 0;
    let response = 0;

    for (const row of genRows) {
      const turn = parseGenMetadataTurn(row.data, stepCreatedAtMap, catalog, turns.length + 1);
      if (!turn) continue;
      turns.push(turn);
      uncachedInput += turn.inputTokens;
      cacheRead += turn.cacheReadTokens;
      cacheCreation += turn.cacheCreationTokens;
      output += turn.outputTokens;
      thinking += turn.thinkingOutputTokens;
      response += turn.responseOutputTokens;
    }

    if (turns.length === 0) return null;

    const inputAll = uncachedInput + cacheRead + cacheCreation;
    const latest = turns[turns.length - 1];

    return {
      cascadeId: meta.id,
      title: meta.title,
      isSubagent: meta.isSubagent,
      rootConversationId: meta.rootConversationId,
      lastModifiedTime: meta.mtimeIso,
      modelName: latest.modelName,
      turnCount: turns.length,
      totals: {
        uncachedInput,
        cacheRead,
        cacheCreation,
        inputAll,
        output,
        thinking,
        response,
        all: inputAll + output,
      },
      cache: {
        overallHitRate: inputAll > 0 ? (cacheRead / inputAll) * 100 : 0,
        latestHitRate: latest.promptTotal > 0 ? (latest.cacheReadTokens / latest.promptTotal) * 100 : 0,
        savedInputTokens: cacheRead,
      },
      allTurns: turns.slice().reverse(),
    };
  } catch {
    return null;
  } finally {
    try { db?.close(); } catch {}
  }
}

function resolveRootConversationId(cid, parentMap) {
  let cur = cid;
  const visited = new Set([cur]);
  while (parentMap.has(cur)) {
    const parent = parentMap.get(cur);
    if (!parent || visited.has(parent)) break;
    visited.add(parent);
    cur = parent;
  }
  return cur;
}

function readSummaryIndex(appDataDir = resolveAppDataDir()) {
  const summaryDbPath = join(appDataDir, 'conversation_summaries.db');
  if (!existsSync(summaryDbPath)) {
    return null;
  }

  let summaryDb;
  let rows = [];
  const parentMap = new Map();
  try {
    summaryDb = new DatabaseSync(summaryDbPath, { readOnly: true });
    rows = summaryDb.prepare(`
      SELECT conversation_id, title, last_modified_time, parent_conversation_id
      FROM conversation_summaries
    `).all();

    try {
      const parentRows = summaryDb.prepare('SELECT conversation_id, parent_id FROM conversation_parents').all();
      for (const pr of parentRows) {
        if (pr.conversation_id && pr.parent_id) {
          parentMap.set(pr.conversation_id, pr.parent_id);
        }
      }
    } catch {
      // conversation_parents table may not exist in older versions
    }
  } finally {
    try { summaryDb?.close(); } catch {}
  }

  for (const r of rows) {
    if (r.conversation_id && r.parent_conversation_id && !parentMap.has(r.conversation_id)) {
      parentMap.set(r.conversation_id, r.parent_conversation_id);
    }
  }

  return { rows, parentMap };
}

/**
 * Find all descendant subagent conversation IDs for a parent/root conversation from local SQLite index.
 */
export function findLocalSubagentIds(parentOrRootId, appDataDir = resolveAppDataDir()) {
  if (!parentOrRootId) return [];
  let index;
  try {
    index = readSummaryIndex(appDataDir);
  } catch {
    return [];
  }
  if (!index) return [];

  const { rows, parentMap } = index;
  const rowMap = new Map();
  for (const r of rows) {
    if (r.conversation_id) rowMap.set(r.conversation_id, r);
  }

  const childrenMap = new Map();
  for (const [cid, pid] of parentMap.entries()) {
    if (!pid || cid === pid) continue;
    let list = childrenMap.get(pid);
    if (!list) {
      list = [];
      childrenMap.set(pid, list);
    }
    list.push(cid);
  }

  const visited = new Set([parentOrRootId]);
  const queue = [parentOrRootId];
  const results = [];

  while (queue.length > 0) {
    const cur = queue.shift();
    const children = childrenMap.get(cur) || [];
    for (const childId of children) {
      if (visited.has(childId)) continue;
      visited.add(childId);
      queue.push(childId);
      const row = rowMap.get(childId);
      const ts = parseSqliteTimestampMs(row?.last_modified_time);
      results.push({
        id: childId,
        role: row?.title || childId.slice(0, 8),
        lastModifiedTime: ts > 0 ? new Date(ts).toISOString() : '',
      });
    }
  }

  return results.sort((a, b) => (b.lastModifiedTime || '').localeCompare(a.lastModifiedTime || ''));
}

/**
 * Aggregate global token usage across ALL workspaces by reading Antigravity's local SQLite databases.
 */
export function getLocalGlobalSummary(range = 'today', cutoffMs = 0, catalog = {}, appDataDir = resolveAppDataDir()) {
  const index = readSummaryIndex(appDataDir);
  if (!index) {
    throw new Error('未找到本地全局索引数据库 conversation_summaries.db');
  }
  const { rows, parentMap } = index;

  const candidates = [];
  for (const r of rows) {
    const id = r.conversation_id;
    if (!id) continue;
    const ts = parseSqliteTimestampMs(r.last_modified_time);
    if (cutoffMs > 0 && ts < cutoffMs) continue;
    const isSubagent = parentMap.has(id);
    const rootId = isSubagent ? resolveRootConversationId(id, parentMap) : id;
    const mtimeIso = ts > 0 ? new Date(ts).toISOString() : '';
    candidates.push({
      id,
      mtime: String(r.last_modified_time || ''),
      mtimeIso,
      ts,
      title: r.title || id.slice(0, 8),
      isSubagent,
      rootConversationId: rootId,
    });
  }

  candidates.sort((a, b) => b.ts - a.ts);

  const conversationsDir = join(appDataDir, 'conversations');
  const items = [];
  for (const c of candidates) {
    const cached = localStatsCache.get(c.id);
    if (cached && cached.mtime === c.mtime) {
      items.push(cached.item);
      continue;
    }
    const item = readConversationItemFromDb(join(conversationsDir, `${c.id}.db`), c, catalog);
    if (item) {
      localStatsCache.set(c.id, { mtime: c.mtime, item });
      items.push(item);
    }
  }

  const stats = aggregateGlobalStats(items, range);
  return {
    range,
    scope: 'all',
    ...stats,
    updatedAt: new Date().toISOString(),
  };
}
