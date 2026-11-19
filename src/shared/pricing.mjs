import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * Default reference API pricing table (USD per 1,000,000 tokens) & USD->CNY exchange rate.
 * Checked against official Gemini / Anthropic / OpenAI pricing and mid-market USD/CNY rate (2026-11).
 */
export const DEFAULT_USD_TO_CNY = 6.67;

export const DEFAULT_PRICING_RULES = [
  {
    id: 'gemini-4-neon',
    label: 'Gemini 4 Neon',
    keywords: ['neon'],
    input: 3.0,
    cacheRead: 0.15,
    cacheWrite: 3.0,
    output: 15.0,
  },
  {
    id: 'gemini-4-carbon',
    label: 'Gemini 4 Carbon',
    keywords: ['carbon'],
    input: 2.0,
    cacheRead: 0.1,
    cacheWrite: 2.0,
    output: 10.0,
  },
  {
    id: 'gemini-4-argon',
    label: 'Gemini 4 Argon / Orchestrator',
    keywords: ['argon', 'orchestrator'],
    input: 2.0,
    cacheRead: 0.1,
    cacheWrite: 2.0,
    output: 10.0,
  },
  {
    id: 'gemini-4-hydrogen',
    label: 'Gemini 4 Hydrogen',
    keywords: ['hydrogen'],
    input: 1.5,
    cacheRead: 0.075,
    cacheWrite: 1.5,
    output: 7.5,
  },
  {
    id: 'gemini-flash-lite',
    label: 'Gemini Flash-Lite',
    keywords: ['flash-lite', 'flash_lite', 'flash lite'],
    input: 0.3,
    cacheRead: 0.03,
    cacheWrite: 0.3,
    output: 2.5,
  },
  {
    id: 'gemini-flash',
    label: 'Gemini 3.8 Flash / Flash',
    keywords: ['flash'],
    input: 0.75,
    cacheRead: 0.075,
    cacheWrite: 0.75,
    output: 3.75,
  },
  {
    id: 'gemini-pro',
    label: 'Gemini Pro',
    keywords: ['gemini-3', 'gemini 3', 'gemini-2', 'gemini 2', 'gemini pro'],
    input: 2.0,
    cacheRead: 0.2,
    cacheWrite: 2.0,
    output: 12.0,
  },
  {
    id: 'claude-opus',
    label: 'Claude Opus 5.5',
    keywords: ['opus'],
    input: 4.0,
    cacheRead: 0.2,
    cacheWrite: 5.0,
    output: 20.0,
  },
  {
    id: 'claude-sonnet',
    label: 'Claude Sonnet 5.5',
    keywords: ['sonnet'],
    input: 2.0,
    cacheRead: 0.1,
    cacheWrite: 2.5,
    output: 10.0,
  },
  {
    id: 'claude-haiku',
    label: 'Claude Haiku 5.5',
    keywords: ['haiku'],
    input: 0.1,
    cacheRead: 0.01,
    cacheWrite: 0.125,
    output: 0.5,
  },
  {
    id: 'gpt-mini',
    label: 'GPT-4o mini / o4-mini',
    keywords: ['4o-mini', 'o3-mini', 'o4-mini', 'gpt-5-mini'],
    input: 0.15,
    cacheRead: 0.075,
    cacheWrite: 0.15,
    output: 0.6,
  },
  {
    id: 'gpt-flagship',
    label: 'GPT-4o / GPT-5 / o3',
    keywords: ['gpt-4o', 'gpt-5', 'o3'],
    input: 2.5,
    cacheRead: 1.25,
    cacheWrite: 2.5,
    output: 10.0,
  },
];

export function getDefaultPricingConfig() {
  return {
    usdToCny: DEFAULT_USD_TO_CNY,
    rules: DEFAULT_PRICING_RULES.map((r) => ({ ...r, keywords: [...r.keywords] })),
  };
}

export function resolvePricingConfigPath() {
  const override = (process.env.AGY_PRICING_CONFIG_PATH || '').trim();
  if (override) return override;
  const appDir = (process.env.ANTIGRAVITY_APP_DATA_DIR || '').trim() || join(homedir(), '.gemini', 'antigravity');
  return join(appDir, 'agy-context-panel-pricing.json');
}

function toNonNegNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function sanitizePricingConfig(raw) {
  const defaults = getDefaultPricingConfig();
  if (!raw || typeof raw !== 'object') return defaults;

  const rate = Number(raw.usdToCny);
  const usdToCny = Number.isFinite(rate) && rate > 0 ? Math.round(rate * 10000) / 10000 : defaults.usdToCny;

  let rules = defaults.rules;
  if (Array.isArray(raw.rules)) {
    const cleaned = [];
    for (let i = 0; i < raw.rules.length; i++) {
      const r = raw.rules[i];
      if (!r || typeof r !== 'object') continue;
      const keywords = (Array.isArray(r.keywords) ? r.keywords : String(r.keywords || '').split(/[,，]/))
        .map((k) => String(k || '').trim().toLowerCase())
        .filter(Boolean);
      const label = String(r.label || '').trim() || keywords[0] || `自定义模型 ${i + 1}`;
      if (keywords.length === 0) continue;
      const id = String(r.id || `custom-${i + 1}`).trim() || `custom-${i + 1}`;
      const input = toNonNegNumber(r.input, 0);
      cleaned.push({
        id,
        label,
        keywords,
        input,
        cacheRead: toNonNegNumber(r.cacheRead, 0),
        cacheWrite: toNonNegNumber(r.cacheWrite, input),
        output: toNonNegNumber(r.output, 0),
      });
    }
    if (cleaned.length > 0) {
      rules = cleaned;
    }
  }

  return { usdToCny, rules };
}

let cachedConfig = null;
let cachedConfigPath = '';

export function clearPricingCache() {
  cachedConfig = null;
  cachedConfigPath = '';
}

export function getPricingConfig() {
  const configPath = resolvePricingConfigPath();
  if (cachedConfig && cachedConfigPath === configPath) {
    return cachedConfig;
  }
  try {
    if (existsSync(configPath)) {
      const parsed = JSON.parse(readFileSync(configPath, 'utf8'));
      cachedConfig = sanitizePricingConfig(parsed);
      cachedConfigPath = configPath;
      return cachedConfig;
    }
  } catch {
    // Fall back to defaults on unreadable config
  }
  cachedConfig = getDefaultPricingConfig();
  cachedConfigPath = configPath;
  return cachedConfig;
}

export function savePricingConfig(nextRaw) {
  const configPath = resolvePricingConfigPath();
  const sanitized = sanitizePricingConfig(nextRaw);
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify(sanitized, null, 2), 'utf8');
  cachedConfig = sanitized;
  cachedConfigPath = configPath;
  return sanitized;
}

export function resetPricingConfig() {
  const configPath = resolvePricingConfigPath();
  try {
    if (existsSync(configPath)) {
      rmSync(configPath, { force: true });
    }
  } catch {
    // ignore
  }
  cachedConfig = getDefaultPricingConfig();
  cachedConfigPath = configPath;
  return cachedConfig;
}

/**
 * Resolve reference pricing for a model name / model ID.
 * Returns null if the model is unknown or a placeholder without pricing.
 */
export function resolveModelPricing(modelName = '', modelId = '', config = null) {
  const combined = `${modelName || ''} ${modelId || ''}`.toLowerCase().trim();
  if (!combined || combined === 'unknown' || combined.startsWith('model_placeholder_')) {
    return null;
  }
  const active = config || getPricingConfig();
  for (const rule of active.rules || []) {
    if ((rule.keywords || []).some((kw) => kw && combined.includes(kw))) {
      return {
        tier: rule.id,
        label: rule.label,
        input: rule.input,
        cacheRead: rule.cacheRead,
        cacheWrite: rule.cacheWrite,
        output: rule.output,
      };
    }
  }
  return null;
}

/**
 * Calculate estimated USD cost breakdown for a single turn or aggregated token counts.
 */
export function calculateTokenCost(
  { inputTokens = 0, cacheReadTokens = 0, cacheCreationTokens = 0, outputTokens = 0 },
  modelName = '',
  modelId = '',
  config = null,
) {
  const pricing = resolveModelPricing(modelName, modelId, config);
  if (!pricing) {
    return {
      priced: false,
      pricing: null,
      input: 0,
      cacheRead: 0,
      cacheWrite: 0,
      output: 0,
      total: 0,
      savedByCache: 0,
    };
  }

  const uncachedIn = Math.max(0, Number(inputTokens) || 0);
  const cacheRead = Math.max(0, Number(cacheReadTokens) || 0);
  const cacheWrite = Math.max(0, Number(cacheCreationTokens) || 0);
  const out = Math.max(0, Number(outputTokens) || 0);

  const inputCost = (uncachedIn / 1e6) * pricing.input;
  const cacheReadCost = (cacheRead / 1e6) * pricing.cacheRead;
  const cacheWriteCost = (cacheWrite / 1e6) * pricing.cacheWrite;
  const outputCost = (out / 1e6) * pricing.output;
  const total = inputCost + cacheReadCost + cacheWriteCost + outputCost;
  const savedByCache = (cacheRead / 1e6) * Math.max(0, pricing.input - pricing.cacheRead);

  return {
    priced: true,
    pricing,
    input: inputCost,
    cacheRead: cacheReadCost,
    cacheWrite: cacheWriteCost,
    output: outputCost,
    total,
    savedByCache,
  };
}
