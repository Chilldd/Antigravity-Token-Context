import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { applyBoardAction, ensureBoardInitialized, getBoardStateMap, setBoardCardColumn } from '../src/shared/board-store.mjs';
import { extractGeminiQuota, extractSubagentsFromTrajectory, findSubagentEntries, getGeminiQuotaSummary, getLatestMetrics, normalizeBoardStatus, parseCsrfTokenFromCommandLine } from '../src/shared/ls-client.mjs';
import { findLocalSubagentIds, getLocalGlobalSummary } from '../src/shared/local-store.mjs';

test('findSubagentEntries discovers child and root-linked subagents', () => {
  const summaries = {
    'root-1': {
      summary: 'Main Chat',
      trajectoryMetadata: { rootConversationId: 'root-1' },
    },
    'sub-1': {
      status: 'CASCADE_RUN_STATUS_IDLE',
      lastModifiedTime: '2026-11-16T07:42:05Z',
      trajectoryMetadata: {
        parentConversationId: 'root-1',
        rootConversationId: 'root-1',
        nestingDepth: 1,
        subagentSpec: { typeName: 'worker', role: 'Swarm Worker (engineer)' },
      },
    },
    'other-1': {
      summary: 'Unrelated Chat',
      trajectoryMetadata: { rootConversationId: 'other-1' },
    },
  };

  const subs = findSubagentEntries(summaries, 'root-1');
  assert.equal(subs.length, 1);
  assert.equal(subs[0].id, 'sub-1');
  assert.equal(subs[0].role, 'Swarm Worker (engineer)');
  assert.equal(subs[0].isSwarm, true);
  assert.equal(subs[0].nestingDepth, 1);
});

test('findSubagentEntries does not classify non-worker subagents with agentScript as swarm', () => {
  const summaries = {
    'root-1': {
      summary: 'Main Chat',
      trajectoryMetadata: { rootConversationId: 'root-1' },
    },
    'sub-research': {
      status: 'CASCADE_RUN_STATUS_IDLE',
      lastModifiedTime: '2026-11-16T07:42:05Z',
      trajectoryMetadata: {
        parentConversationId: 'root-1',
        rootConversationId: 'root-1',
        nestingDepth: 1,
        agentScript: { name: 'code-research' },
        subagentSpec: { typeName: 'research', role: 'Codebase Researcher' },
      },
    },
    'sub-worker': {
      status: 'CASCADE_RUN_STATUS_IDLE',
      lastModifiedTime: '2026-11-16T07:42:06Z',
      trajectoryMetadata: {
        parentConversationId: 'root-1',
        rootConversationId: 'root-1',
        nestingDepth: 1,
        agentScript: { name: 'ui-polish' },
        subagentSpec: { typeName: 'worker', role: 'UI Worker' },
      },
    },
  };

  const subs = findSubagentEntries(summaries, 'root-1');
  assert.equal(subs.length, 2);
  const worker = subs.find((s) => s.id === 'sub-worker');
  const research = subs.find((s) => s.id === 'sub-research');
  assert.equal(worker?.isSwarm, true);
  assert.equal(research?.isSwarm, false);
});

test('getLatestMetrics returns no-conversation when conversationId is empty and fallbackToLatest is false', async () => {
  const res = await getLatestMetrics('', { fallbackToLatest: false });
  assert.deepEqual(res, { error: 'no-conversation' });
});

function encodeVarint(n) {
  const bytes = [];
  let v = n;
  while (v >= 0x80) {
    bytes.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  bytes.push(v);
  return Buffer.from(bytes);
}

function encodeField(field, wire, payload) {
  const tag = encodeVarint(field * 8 + wire);
  if (wire === 0) return Buffer.concat([tag, encodeVarint(payload)]);
  const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8');
  return Buffer.concat([tag, encodeVarint(buf.length), buf]);
}

test('getLocalGlobalSummary aggregates all conversations and merges subagents into root', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-ctx-test-'));
  try {
    mkdirSync(join(dir, 'conversations'), { recursive: true });
    const summaryDb = new DatabaseSync(join(dir, 'conversation_summaries.db'));
    summaryDb.exec(`
      CREATE TABLE conversation_summaries (
        conversation_id text PRIMARY KEY,
        title text,
        last_modified_time datetime,
        parent_conversation_id text
      );
      CREATE TABLE conversation_parents (
        conversation_id text PRIMARY KEY,
        parent_id text
      );
    `);
    summaryDb.prepare('INSERT INTO conversation_summaries VALUES (?, ?, ?, ?)').run('root-a', 'Root Task', '2026-11-16 10:00:00+00:00', '');
    summaryDb.prepare('INSERT INTO conversation_summaries VALUES (?, ?, ?, ?)').run('sub-a', '', '2026-11-16 10:05:00+00:00', 'root-a');
    summaryDb.prepare('INSERT INTO conversation_summaries VALUES (?, ?, ?, ?)').run('old-b', 'Old Task', '2026-10-01 10:00:00+00:00', '');
    summaryDb.close();

    const writeConv = (id, inputTok, cacheTok, outTok, model) => {
      const db = new DatabaseSync(join(dir, 'conversations', `${id}.db`));
      db.exec('CREATE TABLE gen_metadata (idx integer PRIMARY KEY, data blob); CREATE TABLE steps (idx integer PRIMARY KEY, metadata blob);');
      const usage = Buffer.concat([
        encodeField(2, 0, inputTok),
        encodeField(3, 0, outTok),
        encodeField(5, 0, cacheTok),
      ]);
      const chatModel = Buffer.concat([
        encodeField(4, 2, usage),
        encodeField(21, 2, model),
      ]);
      const gen = encodeField(1, 2, chatModel);
      db.prepare('INSERT INTO gen_metadata VALUES (?, ?)').run(0, gen);
      db.close();
    };

    writeConv('root-a', 100, 900, 50, 'Model X');
    writeConv('sub-a', 200, 800, 100, 'Model X');
    writeConv('old-b', 500, 0, 50, 'Model Y');

    const cutoff = Date.parse('2026-11-10T00:00:00Z');
    const summary = getLocalGlobalSummary('7d', cutoff, {}, dir);
    assert.equal(summary.scope, 'all');
    assert.equal(summary.conversations, 1);
    assert.equal(summary.turns, 2);
    assert.equal(summary.totals.all, 2150);
    assert.equal(summary.models[0].modelName, 'Model X');
    assert.equal(summary.topConversations.length, 1);
    assert.equal(summary.topConversations[0].id, 'root-a');
    assert.equal(summary.topConversations[0].modelName, 'Model X');
    assert.equal(summary.topConversations[0].subagentCount, 1);
    assert.equal(summary.topConversations[0].totalTokens, 2150);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('extractGeminiQuota extracts only Gemini Models 5h and weekly quota buckets', () => {
  const resp = {
    response: {
      groups: [
        {
          displayName: 'Gemini Models',
          buckets: [
            {
              bucketId: 'gemini-weekly',
              window: 'weekly',
              remainingFraction: 0.7524415,
              resetTime: '2026-11-25T01:23:08Z',
            },
            {
              bucketId: 'gemini-5h',
              window: '5h',
              remainingFraction: 0.93806,
              resetTime: '2026-11-19T11:12:09Z',
            },
          ],
        },
        {
          displayName: 'Claude and GPT models',
          buckets: [
            { bucketId: '3p-weekly', window: 'weekly', remainingFraction: 1, resetTime: '2026-11-26T06:27:47Z' },
            { bucketId: '3p-5h', window: '5h', remainingFraction: 1, resetTime: '2026-11-19T11:27:47Z' },
          ],
        },
        {
          displayName: 'Gemini 4 Argon',
          buckets: [
            { bucketId: 'gemini-argon-wtu-weekly', window: 'weekly', remainingFraction: 1, resetTime: '2026-11-26T06:27:47Z' },
          ],
        },
      ],
    },
  };

  const quota = extractGeminiQuota(resp);
  assert.deepEqual(quota, {
    fiveHour: {
      pct: 94,
      remainingFraction: 0.93806,
      resetTime: '2026-11-19T11:12:09Z',
    },
    weekly: {
      pct: 75,
      remainingFraction: 0.7524415,
      resetTime: '2026-11-25T01:23:08Z',
    },
  });
  assert.equal(extractGeminiQuota({ response: { groups: [] } }), null);
});

test('extractSubagentsFromTrajectory extracts invoked subagents from steps', () => {
  const trajectoryResp = {
    trajectory: {
      steps: [
        {
          type: 'CORTEX_STEP_TYPE_INVOKE_SUBAGENT',
          status: 'CORTEX_STEP_STATUS_DONE',
          metadata: { completedAt: '2026-11-18T08:28:00Z' },
          invokeSubagent: {
            subagents: [{ typeName: 'self', role: 'Design Review Assessor' }],
            results: [{ conversationId: 'sub-1' }],
          },
        },
        {
          type: 'CORTEX_STEP_TYPE_INVOKE_SUBAGENT',
          status: 'CORTEX_STEP_STATUS_RUNNING',
          metadata: { createdAt: '2026-11-18T08:29:00Z' },
          invokeSubagent: {
            subagents: [{ typeName: 'worker', role: 'Swarm Worker (ui)' }],
            results: [{ conversationId: 'sub-2' }],
          },
        },
      ],
    },
  };

  const subs = extractSubagentsFromTrajectory(trajectoryResp, 'root-1');
  assert.equal(subs.length, 2);
  assert.equal(subs[0].id, 'sub-2');
  assert.equal(subs[0].isSwarm, true);
  assert.equal(subs[0].status, 'CASCADE_RUN_STATUS_RUNNING');
  assert.equal(subs[1].id, 'sub-1');
  assert.equal(subs[1].isSwarm, false);
  assert.equal(subs[1].role, 'Design Review Assessor');
});

test('findLocalSubagentIds discovers direct and nested descendants from sqlite', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-ctx-sub-'));
  try {
    const summaryDb = new DatabaseSync(join(dir, 'conversation_summaries.db'));
    summaryDb.exec(`
      CREATE TABLE conversation_summaries (
        conversation_id text PRIMARY KEY,
        title text,
        last_modified_time datetime,
        parent_conversation_id text
      );
      CREATE TABLE conversation_parents (
        conversation_id text PRIMARY KEY,
        parent_id text
      );
    `);
    summaryDb.prepare('INSERT INTO conversation_summaries VALUES (?, ?, ?, ?)').run('root-1', 'Root', '2026-11-18 10:00:00+00:00', '');
    summaryDb.prepare('INSERT INTO conversation_summaries VALUES (?, ?, ?, ?)').run('child-1', 'Child', '2026-11-18 10:01:00+00:00', 'root-1');
    summaryDb.prepare('INSERT INTO conversation_summaries VALUES (?, ?, ?, ?)').run('grandchild-1', 'Grandchild', '2026-11-18 10:02:00+00:00', 'child-1');
    summaryDb.prepare('INSERT INTO conversation_summaries VALUES (?, ?, ?, ?)').run('other-1', 'Other', '2026-11-18 10:03:00+00:00', '');
    summaryDb.close();

    const subs = findLocalSubagentIds('root-1', dir);
    assert.deepEqual(subs.map((s) => s.id), ['grandchild-1', 'child-1']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('getGeminiQuotaSummary sends forceRefresh: true and refreshes every 5s', async (t) => {
  const requests = [];
  let pctFraction = 0.8;
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      requests.push({ url: req.url, body: JSON.parse(raw || '{}') });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        response: {
          groups: [
            {
              displayName: 'Gemini Models',
              buckets: [
                { bucketId: 'gemini-5h', window: '5h', remainingFraction: pctFraction, resetTime: '2026-11-23T15:00:00Z' },
              ],
            },
          ],
        },
      }));
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const prevAddr = process.env.ANTIGRAVITY_LS_ADDRESS;
  const prevCsrf = process.env.ANTIGRAVITY_CSRF_TOKEN;
  process.env.ANTIGRAVITY_LS_ADDRESS = `127.0.0.1:${port}`;
  process.env.ANTIGRAVITY_CSRF_TOKEN = 'test-csrf';

  let now = 1_700_000_000_000;
  t.mock.method(Date, 'now', () => now);

  try {
    const first = await getGeminiQuotaSummary();
    assert.equal(first.fiveHour.pct, 80);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, '/exa.language_server_pb.LanguageServerService/RetrieveUserQuotaSummary');
    assert.deepEqual(requests[0].body, { forceRefresh: true });

    pctFraction = 0.7;
    now += 4900;
    const cached = await getGeminiQuotaSummary();
    assert.equal(cached.fiveHour.pct, 80);
    assert.equal(requests.length, 1);

    now += 200;
    const refreshed = await getGeminiQuotaSummary();
    assert.equal(refreshed.fiveHour.pct, 70);
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[1].body, { forceRefresh: true });
  } finally {
    if (prevAddr === undefined) delete process.env.ANTIGRAVITY_LS_ADDRESS;
    else process.env.ANTIGRAVITY_LS_ADDRESS = prevAddr;
    if (prevCsrf === undefined) delete process.env.ANTIGRAVITY_CSRF_TOKEN;
    else process.env.ANTIGRAVITY_CSRF_TOKEN = prevCsrf;
    await new Promise((resolve) => server.close(resolve));
  }
});

test('normalizeBoardStatus maps LS status, killed flag, and manual override into kanban columns', () => {
  assert.equal(normalizeBoardStatus('CASCADE_RUN_STATUS_WAITING_FOR_USER'), 'waiting');
  assert.equal(normalizeBoardStatus('CASCADE_RUN_STATUS_RUNNING'), 'running');
  assert.equal(normalizeBoardStatus('CASCADE_RUN_STATUS_IDLE', '', { notFullyIdle: true }), 'running');
  assert.equal(normalizeBoardStatus('CASCADE_RUN_STATUS_IDLE', '', { killed: true }), 'error');
  assert.equal(normalizeBoardStatus('CASCADE_RUN_STATUS_IDLE', '', { manualColumn: 'starred' }), 'starred');
  assert.equal(normalizeBoardStatus('CASCADE_RUN_STATUS_IDLE', '', { manualColumn: 'waiting' }), 'waiting');
  assert.equal(normalizeBoardStatus('CASCADE_RUN_STATUS_RUNNING', '', { manualColumn: 'idle' }), 'running');
  assert.equal(normalizeBoardStatus('CASCADE_RUN_STATUS_IDLE'), 'idle');
  assert.equal(normalizeBoardStatus('CASCADE_RUN_STATUS_CANCELLED'), 'error');
  assert.equal(normalizeBoardStatus('', 'TERMINATION_REASON_ERROR'), 'error');
});

test('setBoardCardColumn persists and clears manual card states', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-board-store-'));
  const cfgPath = join(dir, 'board.json');
  try {
    setBoardCardColumn('conv-1', 'waiting', cfgPath);
    assert.equal(getBoardStateMap(cfgPath)['conv-1'].column, 'waiting');
    setBoardCardColumn('conv-1', 'auto', cfgPath);
    assert.equal(getBoardStateMap(cfgPath)['conv-1'], undefined);

    setBoardCardColumn('conv-2', 'starred', cfgPath);
    assert.equal(getBoardStateMap(cfgPath)['conv-2'].starred, true);
    assert.equal(getBoardStateMap(cfgPath)['conv-2'].column, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('applyBoardAction handles star, archive, batch archive, seenAt, and v1 migration', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-board-v2-'));
  const cfgPath = join(dir, 'board.json');
  try {
    writeFileSync(cfgPath, JSON.stringify({
      version: 1,
      cards: {
        'legacy-1': { column: 'starred', updatedAt: '2026-11-20T00:00:00.000Z' },
      },
    }), 'utf8');

    const init1 = ensureBoardInitialized(cfgPath);
    assert.ok(init1.initializedAt);
    assert.equal(init1.cards['legacy-1'].starred, true);
    assert.equal(init1.cards['legacy-1'].column, undefined);

    const init2 = ensureBoardInitialized(cfgPath);
    assert.equal(init2.initializedAt, init1.initializedAt);

    applyBoardAction({ action: 'star', id: 'c1', value: true }, cfgPath);
    assert.equal(getBoardStateMap(cfgPath)['c1'].starred, true);

    applyBoardAction({ action: 'star', id: 'c1', value: false }, cfgPath);
    assert.equal(getBoardStateMap(cfgPath)['c1'], undefined);

    applyBoardAction({ action: 'seen', id: 'c2', at: '2026-11-24T08:00:00.000Z' }, cfgPath);
    applyBoardAction({ action: 'seen', id: 'c2', at: '2026-11-24T07:00:00.000Z' }, cfgPath);
    assert.equal(getBoardStateMap(cfgPath)['c2'].seenAt, '2026-11-24T08:00:00.000Z');

    applyBoardAction({ action: 'archive', id: 'c2', value: true }, cfgPath);
    assert.equal(getBoardStateMap(cfgPath)['c2'].archived, true);
    assert.ok(getBoardStateMap(cfgPath)['c2'].archivedAt);

    applyBoardAction({ action: 'archive', id: 'c2', value: false }, cfgPath);
    assert.equal(getBoardStateMap(cfgPath)['c2'].archived, undefined);
    assert.equal(getBoardStateMap(cfgPath)['c2'].archivedAt, undefined);

    applyBoardAction({ action: 'archive_batch', ids: ['c3', 'c4'] }, cfgPath);
    const afterBatch = getBoardStateMap(cfgPath);
    assert.equal(afterBatch['c3'].archived, true);
    assert.equal(afterBatch['c4'].archived, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('parseCsrfTokenFromCommandLine extracts csrf token from = or space separated args', () => {
  assert.equal(parseCsrfTokenFromCommandLine('ls.exe --csrf_token=abc-123 --port 42'), 'abc-123');
  assert.equal(parseCsrfTokenFromCommandLine('ls.exe --csrf_token "tok-456" --standalone'), 'tok-456');
  assert.equal(parseCsrfTokenFromCommandLine('ls.exe --standalone'), '');
});
