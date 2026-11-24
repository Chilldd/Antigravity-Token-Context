import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateGlobalStats, computeToolBreakdown, computeTrajectoryMetrics, computeTurnSpeed, parseDurationSec } from '../src/shared/metrics.mjs';

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
  assert.equal(m.speed.latestTokensPerSec, 300);
  assert.ok(Math.abs(m.speed.avgTokensPerSec - 500 / 3) < 1e-6);
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

test('computeTurnSpeed handles thinking streams, short bursts, and buffered flushes', () => {
  // Normal streaming turn includes thinking + response tokens
  const thinkingTurn = computeTurnSpeed(15264, 3.72, 72.34);
  assert.ok(Math.abs(thinkingTurn.tokensPerSec - 15264 / 72.34) < 1e-6);
  assert.equal(thinkingTurn.durationSec, 72.34);

  // Short burst (< 0.5s) falls back to end-to-end duration (ttft + streaming)
  const shortBurst = computeTurnSpeed(85, 4.35, 0.0363633);
  assert.ok(Math.abs(shortBurst.tokensPerSec - 85 / (4.35 + 0.0363633)) < 1e-6);
  assert.ok(shortBurst.tokensPerSec < 25);

  // Server-buffered flush (> 1000 tok/s even with >= 0.5s stream) falls back to end-to-end duration
  const bufferedFlush = computeTurnSpeed(3160, 14.82, 0.7);
  assert.ok(Math.abs(bufferedFlush.tokensPerSec - 3160 / (14.82 + 0.7)) < 1e-6);

  // Tiny stream without TTFT returns null instead of inflated speed
  assert.equal(computeTurnSpeed(100, null, 0.02), null);
  assert.equal(computeTurnSpeed(0, 2.0, 1.0), null);
});

test('computeTrajectoryMetrics detects orchestrator mode and aggregates per-model usage', () => {
  const catalog = {
    'MODEL_PLACEHOLDER_M533': { displayName: 'Gemini 4 Neon (Medium)', maxTokens: 1000000 },
    'MODEL_PLACEHOLDER_M526': { displayName: 'Gemini 4 Hydrogen (Medium)', maxTokens: 1000000 },
  };

  const orchResp = {
    status: 'CASCADE_RUN_STATUS_IDLE',
    trajectory: {
      cascadeId: 'orch-1',
      steps: [
        { type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE', metadata: { toolCall: { name: 'exit_plan_mode' } } },
      ],
      generatorMetadata: [
        {
          chatModel: {
            model: 'MODEL_PLACEHOLDER_M533',
            modelDisplayName: 'Gemini 4 Neon (Medium)',
            usage: { inputTokens: 1000, cacheReadTokens: 2000, outputTokens: 500 },
          },
          plannerConfig: {
            planModel: 'MODEL_PLACEHOLDER_M533',
            planExecuteConfig: { executionModel: 'MODEL_PLACEHOLDER_M526' },
            declarativeMixinConfig: {
              promptSections: [{ builtinName: 'plan_execute_protocol' }],
            },
          },
        },
        {
          chatModel: {
            model: 'MODEL_PLACEHOLDER_M526',
            modelDisplayName: 'Gemini 4 Hydrogen (Medium)',
            usage: { inputTokens: 500, cacheReadTokens: 4000, outputTokens: 1000 },
          },
        },
      ],
    },
  };

  const orchMetrics = computeTrajectoryMetrics(orchResp, catalog);
  assert.equal(orchMetrics.orchestrator.enabled, true);
  assert.equal(orchMetrics.orchestrator.planModelName, 'Gemini 4 Neon (Medium)');
  assert.equal(orchMetrics.orchestrator.executionModelName, 'Gemini 4 Hydrogen (Medium)');
  assert.equal(orchMetrics.modelBreakdown.length, 2);

  const execModel = orchMetrics.modelBreakdown.find((m) => m.role === 'execute');
  const planModel = orchMetrics.modelBreakdown.find((m) => m.role === 'plan');
  assert.equal(execModel.modelName, 'Gemini 4 Hydrogen (Medium)');
  assert.equal(execModel.tokens, 5500);
  assert.equal(execModel.input, 4500);
  assert.equal(execModel.cacheRead, 4000);
  assert.equal(execModel.output, 1000);
  assert.equal(planModel.modelName, 'Gemini 4 Neon (Medium)');
  assert.equal(planModel.tokens, 3500);
  assert.ok(Math.abs(execModel.pct - (5500 / 9000) * 100) < 1e-6);

  const regularResp = {
    status: 'CASCADE_RUN_STATUS_IDLE',
    trajectory: {
      cascadeId: 'reg-1',
      steps: [],
      generatorMetadata: [
        {
          chatModel: {
            model: 'MODEL_PLACEHOLDER_M526',
            modelDisplayName: 'Gemini 4 Hydrogen (Medium)',
            usage: { inputTokens: 200, outputTokens: 100 },
          },
          plannerConfig: { modelName: 'MODEL_PLACEHOLDER_M526' },
        },
      ],
    },
  };

  const regMetrics = computeTrajectoryMetrics(regularResp, catalog);
  assert.equal(regMetrics.orchestrator.enabled, false);
  assert.equal(regMetrics.modelBreakdown.length, 1);
  assert.equal(regMetrics.modelBreakdown[0].role, '');
});

test('empty trajectory and empty global stats return finite zeroes without NaN', () => {
  const emptyTraj = computeTrajectoryMetrics({ status: 'CASCADE_RUN_STATUS_IDLE', trajectory: { cascadeId: 'empty-1', steps: [], generatorMetadata: [] } });
  assert.equal(emptyTraj.turnCount, 0);
  assert.equal(emptyTraj.totals.all, 0);
  assert.equal(emptyTraj.totals.inputAll, 0);
  assert.equal(emptyTraj.totals.output, 0);
  assert.equal(emptyTraj.cache.overallHitRate, 0);
  assert.equal(emptyTraj.cache.latestHitRate, 0);
  assert.equal(emptyTraj.context.used, 0);
  assert.equal(emptyTraj.context.free, 0);
  assert.equal(emptyTraj.cost.total, 0);
  assert.equal(emptyTraj.breakdown.dots.length, 100);
  assert.equal(Number.isFinite(emptyTraj.cache.overallHitRate), true);

  const emptyAgg = aggregateGlobalStats([], 'today');
  assert.equal(emptyAgg.conversations, 0);
  assert.equal(emptyAgg.turns, 0);
  assert.equal(emptyAgg.totals.all, 0);
  assert.equal(emptyAgg.cache.hitRate, 0);
  assert.equal(emptyAgg.cost.total, 0);
  assert.equal(emptyAgg.cost.avgPerTurn, 0);
  assert.equal(emptyAgg.cost.avgPerConv, 0);
  assert.equal(emptyAgg.cost.pricedTurns, 0);
  assert.equal(emptyAgg.cost.unpricedTurns, 0);
  assert.deepEqual(emptyAgg.timeline, []);
  assert.deepEqual(emptyAgg.models, []);
  assert.deepEqual(emptyAgg.topConversations, []);
  assert.deepEqual(emptyAgg.topCostConversations, []);
});

test('aggregateGlobalStats preserves mathematical conservation invariants across ranges and weighted subagent cache hit rate', () => {
  const sampleItems = [
    {
      cascadeId: 'root-1',
      title: 'Root Conversation',
      isSubagent: false,
      rootConversationId: '',
      lastModifiedTime: '2026-11-23T09:15:00Z',
      modelName: 'Gemini 4 Hydrogen (Medium)',
      turnCount: 2,
      totals: { uncachedInput: 1000, cacheRead: 9000, cacheCreation: 500, inputAll: 10500, output: 1000, thinking: 400, response: 600, all: 11500 },
      allTurns: [
        { modelName: 'Gemini 4 Hydrogen (Medium)', createdAt: '2026-11-23T09:05:00Z', inputTokens: 600, cacheReadTokens: 4000, cacheCreationTokens: 500, outputTokens: 500, streamingSec: 2.0, ttftSec: 1.0 },
        { modelName: 'Gemini 4 Hydrogen (Medium)', createdAt: '2026-11-23T09:15:00Z', inputTokens: 400, cacheReadTokens: 5000, cacheCreationTokens: 0, outputTokens: 500, streamingSec: 2.0, ttftSec: 1.0 },
      ],
    },
    {
      cascadeId: 'sub-1',
      title: 'Worker',
      isSubagent: true,
      rootConversationId: 'root-1',
      lastModifiedTime: '2026-11-23T09:20:00Z',
      modelName: 'Gemini 4 Flash',
      turnCount: 1,
      totals: { uncachedInput: 2000, cacheRead: 2000, cacheCreation: 0, inputAll: 4000, output: 500, thinking: 0, response: 500, all: 4500 },
      allTurns: [
        { modelName: 'Gemini 4 Flash', createdAt: '2026-11-23T09:20:00Z', inputTokens: 2000, cacheReadTokens: 2000, cacheCreationTokens: 0, outputTokens: 500, streamingSec: 1.0, ttftSec: 0.5 },
      ],
    },
    {
      cascadeId: 'root-2',
      title: 'Standalone Conversation',
      isSubagent: false,
      rootConversationId: '',
      lastModifiedTime: '2026-11-24T10:30:00Z',
      modelName: 'Gemini 4 Neon (Medium)',
      turnCount: 1,
      totals: { uncachedInput: 3000, cacheRead: 1000, cacheCreation: 0, inputAll: 4000, output: 1000, thinking: 300, response: 700, all: 5000 },
      allTurns: [
        { modelName: 'Gemini 4 Neon (Medium)', createdAt: '2026-11-24T10:30:00Z', inputTokens: 3000, cacheReadTokens: 1000, cacheCreationTokens: 0, outputTokens: 1000, streamingSec: 2.5, ttftSec: 1.5 },
      ],
    },
  ];

  for (const range of ['today', '7d', '30d', 'all']) {
    const agg = aggregateGlobalStats(sampleItems, range);
    assert.equal(agg.conversations, 2);
    assert.equal(agg.turns, 4);
    assert.equal(agg.totals.inputAll, agg.totals.uncachedInput + agg.totals.cacheRead + agg.totals.cacheCreation);
    assert.equal(agg.totals.all, agg.totals.inputAll + agg.totals.output);

    const timelineSum = agg.timeline.reduce((s, b) => s + b.total, 0);
    const timelineCostSum = agg.timeline.reduce((s, b) => s + b.cost, 0);
    assert.equal(timelineSum, agg.totals.all);
    assert.ok(Math.abs(timelineCostSum - agg.cost.total) < 1e-9);

    const modelsTokSum = agg.models.reduce((s, m) => s + m.tokens, 0);
    const modelsPctSum = agg.models.reduce((s, m) => s + m.pct, 0);
    assert.equal(modelsTokSum, agg.totals.all);
    assert.ok(Math.abs(modelsPctSum - 100) < 1e-6);

    const topTokSum = agg.topConversations.reduce((s, c) => s + c.totalTokens, 0);
    assert.equal(topTokSum, agg.totals.all);
  }

  const agg = aggregateGlobalStats(sampleItems, '7d');
  const mergedRoot = agg.topConversations.find((c) => c.id === 'root-1');
  assert.equal(mergedRoot.turns, 3);
  assert.equal(mergedRoot.totalTokens, 16000);
  // Weighted cache hit rate across root + subagent: 11000 / (3000 + 11000) * 100
  assert.ok(Math.abs(mergedRoot.cacheHitRate - (11000 / 14000) * 100) < 1e-6);
});

test('computeTrajectoryMetrics context and multi-model breakdown conserve totals', () => {
  const catalog = {
    'M_PLAN': { displayName: 'Gemini 4 Neon (Medium)', maxTokens: 500000 },
    'M_EXEC': { displayName: 'Gemini 4 Hydrogen (Medium)', maxTokens: 500000 },
  };
  const resp = {
    status: 'CASCADE_RUN_STATUS_IDLE',
    trajectory: {
      cascadeId: 'conserve-1',
      steps: [],
      generatorMetadata: [
        {
          chatModel: {
            model: 'M_PLAN',
            modelDisplayName: 'Gemini 4 Neon (Medium)',
            chatStartMetadata: { contextWindowMetadata: { estimatedTokensUsed: 50000, maxContextTokens: 500000 } },
            usage: { inputTokens: 1000, cacheReadTokens: 2000, outputTokens: 500 },
          },
          plannerConfig: { planModel: 'M_PLAN', planExecuteConfig: { executionModel: 'M_EXEC' } },
        },
        {
          chatModel: {
            model: 'M_EXEC',
            modelDisplayName: 'Gemini 4 Hydrogen (Medium)',
            chatStartMetadata: { contextWindowMetadata: { estimatedTokensUsed: 120000, maxContextTokens: 500000 } },
            usage: { inputTokens: 2000, cacheReadTokens: 8000, outputTokens: 1500 },
          },
        },
      ],
    },
  };
  const m = computeTrajectoryMetrics(resp, catalog);
  assert.equal(m.context.used + m.context.free, m.context.max);
  assert.equal(m.breakdown.dots.length, 100);
  const mbSum = m.modelBreakdown.reduce((s, x) => s + x.tokens, 0);
  const mbPctSum = m.modelBreakdown.reduce((s, x) => s + x.pct, 0);
  assert.equal(mbSum, m.totals.all);
  assert.ok(Math.abs(mbPctSum - 100) < 1e-6);
});
