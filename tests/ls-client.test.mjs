import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { extractGeminiQuota, findSubagentEntries, getLatestMetrics } from '../src/shared/ls-client.mjs';
import { getLocalGlobalSummary } from '../src/shared/local-store.mjs';

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
  assert.equal(subs[0].nestingDepth, 1);
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
