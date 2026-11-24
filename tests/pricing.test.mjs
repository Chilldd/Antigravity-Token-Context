import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import {
  DEFAULT_USD_TO_CNY,
  calculateTokenCost,
  clearPricingCache,
  getDefaultPricingConfig,
  getPricingConfig,
  resetPricingConfig,
  resolveModelPricing,
  savePricingConfig,
} from '../src/shared/pricing.mjs';
import { aggregateGlobalStats } from '../src/shared/metrics.mjs';

test('resolveModelPricing distinguishes Gemini 4 Neon/Carbon/Argon/Hydrogen and Claude 5.5 tiers', () => {
  const defaults = getDefaultPricingConfig();
  assert.equal(defaults.usdToCny, DEFAULT_USD_TO_CNY);
  assert.equal(defaults.usdToCny, 6.67);

  const neon = resolveModelPricing('Gemini 4 Neon (Medium)', '', defaults);
  const argon = resolveModelPricing('Gemini 4 Argon (Medium)', '', defaults);
  const orch = resolveModelPricing('Orchestrator (Argon)', '', defaults);
  const hydro = resolveModelPricing('Gemini 4 Hydrogen (Medium)', '', defaults);
  const flash = resolveModelPricing('Gemini 3.8 Flash (Medium)', '', defaults);
  const sonnet = resolveModelPricing('Claude Sonnet 5.5 (Medium)', '', defaults);
  const opus = resolveModelPricing('claude-opus-5-5-high', '', defaults);

  assert.equal(neon.tier, 'gemini-4-neon');
  assert.equal(neon.input, 3.0);
  assert.equal(neon.output, 15.0);

  assert.equal(argon.tier, 'gemini-4-argon');
  assert.equal(orch.tier, 'gemini-4-argon');
  assert.equal(argon.input, 2.0);
  assert.equal(argon.output, 10.0);

  assert.equal(hydro.tier, 'gemini-4-hydrogen');
  assert.equal(hydro.input, 1.5);
  assert.equal(hydro.output, 7.5);

  assert.equal(flash.tier, 'gemini-flash');
  assert.equal(flash.input, 0.75);
  assert.equal(flash.output, 3.75);

  assert.equal(sonnet.tier, 'claude-sonnet');
  assert.equal(sonnet.input, 2.0);
  assert.equal(sonnet.output, 10.0);

  assert.equal(opus.tier, 'claude-opus');
  assert.equal(opus.input, 4.0);
  assert.equal(opus.output, 20.0);

  assert.equal(resolveModelPricing('MODEL_PLACEHOLDER_M319', '', defaults), null);
  assert.equal(resolveModelPricing('Unknown', '', defaults), null);
});

test('calculateTokenCost computes input, cacheRead, output, and cache savings accurately', () => {
  const defaults = getDefaultPricingConfig();
  const res = calculateTokenCost(
    {
      inputTokens: 1_000_000,
      cacheReadTokens: 2_000_000,
      cacheCreationTokens: 0,
      outputTokens: 500_000,
    },
    'Claude Sonnet 5.5 (Medium)',
    '',
    defaults,
  );
  assert.equal(res.priced, true);
  // Sonnet 5.5: input $2, cacheRead $0.1, output $10
  assert.ok(Math.abs(res.input - 2.0) < 1e-9);
  assert.ok(Math.abs(res.cacheRead - 0.2) < 1e-9);
  assert.ok(Math.abs(res.output - 5.0) < 1e-9);
  assert.ok(Math.abs(res.total - 7.2) < 1e-9);
  // 2M cache read saved (2.0 - 0.1) * 2 = $3.8
  assert.ok(Math.abs(res.savedByCache - 3.8) < 1e-9);
});

test('savePricingConfig persists custom rates and overrides defaults until resetPricingConfig', () => {
  const tempPath = join(tmpdir(), `agy-pricing-test-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  const prevEnv = process.env.AGY_PRICING_CONFIG_PATH;
  process.env.AGY_PRICING_CONFIG_PATH = tempPath;
  clearPricingCache();

  try {
    const saved = savePricingConfig({
      usdToCny: 7.05,
      rules: [
        { id: 'custom-argon', label: 'My Argon', keywords: ['argon'], input: 4.0, cacheRead: 0.2, cacheWrite: 4.0, output: 20.0 },
        ...getDefaultPricingConfig().rules,
      ],
    });
    assert.equal(saved.usdToCny, 7.05);

    clearPricingCache();
    const loaded = getPricingConfig();
    assert.equal(loaded.usdToCny, 7.05);
    const argonPrice = resolveModelPricing('Gemini 4 Argon (Medium)');
    assert.equal(argonPrice.tier, 'custom-argon');
    assert.equal(argonPrice.input, 4.0);

    const reset = resetPricingConfig();
    assert.equal(reset.usdToCny, 6.67);
    assert.equal(resolveModelPricing('Gemini 4 Argon (Medium)').tier, 'gemini-4-argon');
  } finally {
    clearPricingCache();
    try { rmSync(tempPath, { force: true }); } catch {}
    if (prevEnv === undefined) delete process.env.AGY_PRICING_CONFIG_PATH;
    else process.env.AGY_PRICING_CONFIG_PATH = prevEnv;
  }
});

test('aggregateGlobalStats aggregates model costs, timeline costs, and topCostConversations', () => {
  const tempPath = join(tmpdir(), `agy-pricing-agg-${Date.now()}.json`);
  const prevEnv = process.env.AGY_PRICING_CONFIG_PATH;
  process.env.AGY_PRICING_CONFIG_PATH = tempPath;
  clearPricingCache();

  try {
    const agg = aggregateGlobalStats(
      [
        {
          cascadeId: 'conv-flash',
          title: 'Bulk Flash Task',
          isSubagent: false,
          lastModifiedTime: '2026-11-19T08:00:00Z',
          modelName: 'Gemini 3.8 Flash (Medium)',
          turnCount: 2,
          totals: { uncachedInput: 1_000_000, cacheRead: 1_000_000, cacheCreation: 0, inputAll: 2_000_000, output: 200_000, all: 2_200_000 },
          allTurns: [
            { modelName: 'Gemini 3.8 Flash (Medium)', createdAt: '2026-11-19T08:00:00Z', inputTokens: 500_000, cacheReadTokens: 500_000, outputTokens: 100_000 },
            { modelName: 'Gemini 3.8 Flash (Medium)', createdAt: '2026-11-19T08:10:00Z', inputTokens: 500_000, cacheReadTokens: 500_000, outputTokens: 100_000 },
          ],
        },
        {
          cascadeId: 'conv-neon',
          title: 'Hard Neon Task',
          isSubagent: false,
          lastModifiedTime: '2026-11-19T09:00:00Z',
          modelName: 'Gemini 4 Neon (Medium)',
          turnCount: 1,
          totals: { uncachedInput: 200_000, cacheRead: 0, cacheCreation: 0, inputAll: 200_000, output: 100_000, all: 300_000 },
          allTurns: [
            { modelName: 'Gemini 4 Neon (Medium)', createdAt: '2026-11-19T09:00:00Z', inputTokens: 200_000, cacheReadTokens: 0, outputTokens: 100_000 },
          ],
        },
      ],
      'today',
    );

    // Flash: 1M*0.75 + 1M*0.075 + 0.2M*3.75 = 0.75 + 0.075 + 0.75 = $1.575
    // Neon: 0.2M*3.0 + 0.1M*15.0 = 0.6 + 1.5 = $2.10
    assert.ok(Math.abs(agg.cost.total - 3.675) < 1e-9);
    assert.equal(agg.cost.usdToCny, 6.67);
    assert.equal(agg.topConversations[0].id, 'conv-flash');
    assert.equal(agg.topCostConversations[0].id, 'conv-neon');
    const neonModel = agg.models.find((m) => m.modelName === 'Gemini 4 Neon (Medium)');
    assert.ok(neonModel);
    assert.ok(Math.abs(neonModel.cost - 2.1) < 1e-9);
    assert.ok(Math.abs(neonModel.costPerTurn - 2.1) < 1e-9);
    assert.ok(agg.timeline.every((b) => b.cost > 0));
  } finally {
    clearPricingCache();
    if (prevEnv === undefined) delete process.env.AGY_PRICING_CONFIG_PATH;
    else process.env.AGY_PRICING_CONFIG_PATH = prevEnv;
  }
});

test('aggregateGlobalStats handles all-unpriced and partially-unpriced models honestly without NaN', () => {
  const tempPath = join(tmpdir(), `agy-pricing-unpriced-${Date.now()}.json`);
  const prevEnv = process.env.AGY_PRICING_CONFIG_PATH;
  process.env.AGY_PRICING_CONFIG_PATH = tempPath;
  clearPricingCache();

  try {
    const allUnpriced = aggregateGlobalStats(
      [
        {
          cascadeId: 'u-1',
          title: 'Unknown Model Chat',
          isSubagent: false,
          lastModifiedTime: '2026-11-24T08:00:00Z',
          modelName: 'MODEL_PLACEHOLDER_M999',
          turnCount: 2,
          totals: { uncachedInput: 100_000, cacheRead: 200_000, cacheCreation: 0, inputAll: 300_000, output: 50_000, all: 350_000 },
          allTurns: [
            { modelName: 'MODEL_PLACEHOLDER_M999', createdAt: '2026-11-24T08:00:00Z', inputTokens: 50_000, cacheReadTokens: 100_000, outputTokens: 25_000 },
            { modelName: 'MODEL_PLACEHOLDER_M999', createdAt: '2026-11-24T08:05:00Z', inputTokens: 50_000, cacheReadTokens: 100_000, outputTokens: 25_000 },
          ],
        },
      ],
      'today',
    );
    assert.equal(allUnpriced.turns, 2);
    assert.equal(allUnpriced.cost.pricedTurns, 0);
    assert.equal(allUnpriced.cost.unpricedTurns, 2);
    assert.equal(allUnpriced.cost.total, 0);
    assert.equal(allUnpriced.cost.avgPerTurn, 0);
    assert.equal(allUnpriced.models[0].pricing, null);
    assert.equal(allUnpriced.models[0].costPct, 0);
    assert.equal(Number.isFinite(allUnpriced.cost.avgPerTurn), true);

    const partial = aggregateGlobalStats(
      [
        {
          cascadeId: 'p-known',
          title: 'Known Neon',
          isSubagent: false,
          lastModifiedTime: '2026-11-24T09:00:00Z',
          modelName: 'Gemini 4 Neon (Medium)',
          turnCount: 1,
          totals: { uncachedInput: 1_000_000, cacheRead: 0, cacheCreation: 0, inputAll: 1_000_000, output: 0, all: 1_000_000 },
          allTurns: [
            { modelName: 'Gemini 4 Neon (Medium)', createdAt: '2026-11-24T09:00:00Z', inputTokens: 1_000_000, cacheReadTokens: 0, outputTokens: 0 },
          ],
        },
        {
          cascadeId: 'p-unknown',
          title: 'Unknown Tier',
          isSubagent: false,
          lastModifiedTime: '2026-11-24T09:10:00Z',
          modelName: 'CustomExperimental-X',
          turnCount: 2,
          totals: { uncachedInput: 500_000, cacheRead: 0, cacheCreation: 0, inputAll: 500_000, output: 100_000, all: 600_000 },
          allTurns: [
            { modelName: 'CustomExperimental-X', createdAt: '2026-11-24T09:10:00Z', inputTokens: 250_000, cacheReadTokens: 0, outputTokens: 50_000 },
            { modelName: 'CustomExperimental-X', createdAt: '2026-11-24T09:12:00Z', inputTokens: 250_000, cacheReadTokens: 0, outputTokens: 50_000 },
          ],
        },
      ],
      'today',
    );
    assert.equal(partial.cost.pricedTurns, 1);
    assert.equal(partial.cost.unpricedTurns, 2);
    assert.equal(partial.cost.pricedTurns + partial.cost.unpricedTurns, partial.turns);
    assert.ok(Math.abs(partial.cost.total - 3.0) < 1e-9);
    const unknownModel = partial.models.find((m) => m.modelName === 'CustomExperimental-X');
    assert.equal(unknownModel.pricing, null);
    assert.equal(unknownModel.cost, 0);
  } finally {
    clearPricingCache();
    if (prevEnv === undefined) delete process.env.AGY_PRICING_CONFIG_PATH;
    else process.env.AGY_PRICING_CONFIG_PATH = prevEnv;
  }
});

test('calculateTokenCost accounts for cacheCreationTokens and non-negative savedByCache', () => {
  const defaults = getDefaultPricingConfig();
  const res = calculateTokenCost(
    {
      inputTokens: 500_000,
      cacheReadTokens: 1_000_000,
      cacheCreationTokens: 500_000,
      outputTokens: 200_000,
    },
    'Gemini 4 Hydrogen (Medium)',
    '',
    defaults,
  );
  // Hydrogen: input 1.5, cacheRead 0.075, cacheWrite 1.5, output 7.5
  // input cost = 0.5*1.5 = 0.75, cacheWrite cost = 0.5*1.5 = 0.75
  // cacheRead cost = 1.0*0.075 = 0.075
  // output cost = 0.2*7.5 = 1.5
  assert.equal(res.priced, true);
  assert.ok(Math.abs(res.input - 0.75) < 1e-9);
  assert.ok(Math.abs(res.cacheWrite - 0.75) < 1e-9);
  assert.ok(Math.abs(res.cacheRead - 0.075) < 1e-9);
  assert.ok(Math.abs(res.output - 1.5) < 1e-9);
  assert.ok(Math.abs(res.total - 3.075) < 1e-9);
  assert.ok(res.savedByCache >= 0);
  assert.ok(Math.abs(res.savedByCache - (1.5 - 0.075)) < 1e-9);
});
