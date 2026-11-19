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
