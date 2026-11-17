import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateGlobalStats, computeToolBreakdown, computeTrajectoryMetrics, parseDurationSec } from '../src/shared/metrics.mjs';

test('parseDurationSec parses s and ms strings', () => {
  assert.equal(parseDurationSec('5.5s'), 5.5);
  assert.equal(parseDurationSec('875ms'), 0.875);
  assert.equal(parseDurationSec('0s'), null);
  assert.equal(parseDurationSec(''), null);
  assert.equal(parseDurationSec(null), null);
});

test('computeTrajectoryMetrics aggregates usage, cache hit rate, speed, and context', () => {
  const sample = {
    status: 'CASCADE_RUN_STATUS_IDLE',
    numTotalSteps: 10,
    trajectory: {
      cascadeId: '162ee284-dce9-4118-b331-8f60b46a6ef5',
      generatorMetadata: [
        {
          stepIndices: [1, 2],
          chatModel: {
            model: 'MODEL_A',
            modelDisplayName: 'Gemini 4 Hydrogen (Medium)',
            timeToFirstToken: '4.0s',
            streamingDuration: '2.0s',
            chatStartMetadata: {
              contextWindowMetadata: {
                estimatedTokensUsed: 20000,
                maxContextTokens: 512000,
              },
            },
            usage: {
              inputTokens: '10000',
              cacheReadTokens: '0',
              outputTokens: '200',
              thinkingOutputTokens: '120',
              responseOutputTokens: '80',
            },
          },
        },
        {
          stepIndices: [3, 4],
          chatModel: {
            model: 'MODEL_A',
            modelDisplayName: 'Gemini 4 Hydrogen (Medium)',
            timeToFirstToken: '2.0s',
            streamingDuration: '1.0s',
            chatStartMetadata: {
              contextWindowMetadata: {
                estimatedTokensUsed: 30000,
                maxContextTokens: 512000,
              },
            },
            usage: {
              inputTokens: '2000',
              cacheReadTokens: '18000',
              outputTokens: '300',
              thinkingOutputTokens: '100',
              responseOutputTokens: '200',
            },
          },
        },
      ],
    },
  };

  const m = computeTrajectoryMetrics(sample);
  assert.equal(m.turnCount, 2);
  assert.equal(m.context.used, 30000);
  assert.equal(m.context.max, 512000);
  assert.equal(m.context.free, 482000);
  assert.equal(m.totals.uncachedInput, 12000);
  assert.equal(m.totals.cacheRead, 18000);
  assert.equal(m.totals.inputAll, 30000);
  assert.equal(m.totals.output, 500);
  assert.equal(m.totals.thinking, 220);
  assert.equal(m.totals.response, 280);
  assert.equal(m.cache.overallHitRate, 60);
  assert.equal(m.cache.latestHitRate, 90);
  assert.equal(m.speed.latestTokensPerSec, 200);
  assert.ok(Math.abs(m.speed.avgTokensPerSec - 280 / 3) < 1e-6);
  assert.equal(m.speed.latestTtftSec, 2.0);
  assert.equal(m.speed.avgTtftSec, 3.0);
  assert.equal(m.recentTurns[0].turnIndex, 2);
  assert.equal(m.allTurns.length, 2);
  assert.equal(m.breakdown.dots.length, 100);
  assert.ok(m.breakdown.categories.length > 0);
});

test('aggregateGlobalStats sums totals, merges subagents into root conversations, and builds timeline', () => {
  const agg = aggregateGlobalStats([
    {
      cascadeId: 'c1',
      title: 'Main Task',
      isSubagent: false,
      rootConversationId: '',
      lastModifiedTime: '2026-11-16T10:00:00Z',
      modelName: 'Model A',
      turnCount: 1,
      totals: { uncachedInput: 100, cacheRead: 900, cacheCreation: 0, inputAll: 1000, output: 200, thinking: 50, response: 150, all: 1200 },
      cache: { overallHitRate: 90 },
      allTurns: [{ modelName: 'Model A', createdAt: '2026-11-16T10:00:00Z', inputTokens: 100, cacheReadTokens: 900, outputTokens: 200, responseOutputTokens: 150, thinkingOutputTokens: 50, streamingSec: 1.5, ttftSec: 2.0 }],
    },
    {
      cascadeId: 'sub1',
      title: 'Worker',
      isSubagent: true,
      rootConversationId: 'c1',
      lastModifiedTime: '2026-11-16T10:05:00Z',
      modelName: 'Model A',
      turnCount: 1,
      totals: { uncachedInput: 200, cacheRead: 800, cacheCreation: 0, inputAll: 1000, output: 100, thinking: 0, response: 100, all: 1100 },
      cache: { overallHitRate: 80 },
      allTurns: [{ modelName: 'Model A', createdAt: '2026-11-16T10:05:00Z', inputTokens: 200, cacheReadTokens: 800, outputTokens: 100, responseOutputTokens: 100, thinkingOutputTokens: 0, streamingSec: 0.5, ttftSec: 1.0 }],
    },
    {
      cascadeId: 'c2',
      title: 'Second',
      isSubagent: false,
      rootConversationId: '',
      lastModifiedTime: '2026-11-16T11:00:00Z',
      modelName: 'Model B',
      turnCount: 1,
      totals: { uncachedInput: 500, cacheRead: 500, cacheCreation: 0, inputAll: 1000, output: 100, thinking: 0, response: 100, all: 1100 },
      cache: { overallHitRate: 50 },
      allTurns: [{ modelName: 'Model B', createdAt: '2026-11-16T11:00:00Z', inputTokens: 500, cacheReadTokens: 500, outputTokens: 100, responseOutputTokens: 100, thinkingOutputTokens: 0, streamingSec: 0.5, ttftSec: 1.0 }],
    },
  ], 'today');

  assert.equal(agg.conversations, 2);
  assert.equal(agg.turns, 3);
  assert.equal(agg.totals.all, 3400);
  assert.equal(agg.models.length, 2);
  assert.equal(agg.timeline.length, 2);
  assert.equal(agg.topConversations.length, 2);
  assert.equal(agg.topConversations[0].id, 'c1');
  assert.equal(agg.topConversations[0].totalTokens, 2300);
  assert.equal(agg.topConversations[0].subagentCount, 1);
});

test('computeToolBreakdown groups steps by tool category for treemap', () => {
  const steps = [
    { type: 'CORTEX_STEP_TYPE_USER_INPUT', userInput: { userResponse: 'hi' } },
    { type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE', plannerResponse: { response: 'ok' } },
    { type: 'CORTEX_STEP_TYPE_RUN_COMMAND', runCommand: { commandLine: 'ls' } },
    { type: 'CORTEX_STEP_TYPE_VIEW_FILE', viewFile: { absolutePath: 'a.js' } },
  ];
  const tb = {
    groups: [
      {
        type: 'TOKEN_TYPE_CHAT_MESSAGES',
        children: [
          { name: '0: USER_INPUT', numTokens: 10 },
          { name: '1: PLANNER_RESPONSE', numTokens: 100 },
          { name: '2: GENERIC', numTokens: 500 },
          { name: '3: GENERIC', numTokens: 200 },
        ],
      },
    ],
  };
  const res = computeToolBreakdown(steps, tb);
  assert.equal(res.totalTokens, 800);
  assert.equal(res.groups[0].key, 'command');
  assert.equal(res.groups[0].tokens, 500);
});
