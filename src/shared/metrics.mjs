/**
 * Parse protobuf-JSON duration strings (e.g. "5.697521100s", "420ms") into seconds.
 * Returns null if missing or non-positive.
 */
export function parseDurationSec(raw) {
  if (raw == null) return null;
  if (typeof raw === 'number') return raw > 0 ? raw : null;
  const s = String(raw).trim();
  if (!s) return null;
  if (s.endsWith('ms')) {
    const v = Number(s.slice(0, -2));
    return Number.isFinite(v) && v > 0 ? v / 1000 : null;
  }
  if (s.endsWith('s')) {
    const v = Number(s.slice(0, -1));
    return Number.isFinite(v) && v > 0 ? v : null;
  }
  const v = Number(s);
  return Number.isFinite(v) && v > 0 ? v : null;
}

function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0;
}

function estimateTextTokens(text) {
  if (!text) return 0;
  const s = String(text);
  // Rough mixed CJK/ASCII token estimate (~3 chars per token on average)
  return Math.ceil(s.length / 3);
}

const TOOL_GROUPS = {
  command: { key: 'command', name: '命令执行', color: '#7dd3fc' },
  file_edit: { key: 'file_edit', name: '文件修改', color: '#f5a98b' },
  file_read: { key: 'file_read', name: '读取文件', color: '#fcd34d' },
  search: { key: 'search', name: '检索与网络', color: '#d6b89c' },
  agent: { key: 'agent', name: '代理协作', color: '#bef264' },
  model: { key: 'model', name: '模型回复', color: '#fca5a5' },
  other: { key: 'other', name: '其他工具', color: '#93c5fd' },
};

function classifyStepTool(step) {
  const toolName = String(step?.metadata?.toolCall?.name || '').toLowerCase();
  const st = String(step?.type || '');

  if (toolName) {
    if (toolName.includes('command') || toolName === 'run_command') return { group: 'command', tool: toolName };
    if (toolName.includes('edit') || toolName.includes('write') || toolName.includes('replace')) return { group: 'file_edit', tool: toolName };
    if (toolName.includes('read') || toolName.includes('view') || toolName.includes('list')) return { group: 'file_read', tool: toolName };
    if (toolName.includes('search') || toolName.includes('grep') || toolName.includes('find') || toolName.includes('mcp')) return { group: 'search', tool: toolName };
    if (toolName.includes('subagent') || toolName.includes('swarm') || toolName.includes('workflow') || toolName.includes('task')) return { group: 'agent', tool: toolName };
    return { group: 'other', tool: toolName };
  }

  if (st.includes('RUN_COMMAND') || st.includes('COMMAND_STATUS') || st.includes('SEND_COMMAND')) return { group: 'command', tool: 'run_command' };
  if (st.includes('CODE_ACTION') || st.includes('EDIT_FILE') || st.includes('WRITE_TO_FILE') || st.includes('PROPOSE_CODE')) {
    const isCreate = Boolean(step?.codeAction?.isArtifactFile || step?.codeAction?.actionSpec?.createFile);
    return { group: 'file_edit', tool: isCreate ? 'write_file' : 'edit_file' };
  }
  if (st.includes('VIEW_FILE') || st.includes('LIST_DIRECTORY') || st.includes('VIEW_CODE_ITEM') || st.includes('VIEW_CONTENT')) return { group: 'file_read', tool: 'read_file' };
  if (st.includes('SEARCH_WEB') || st.includes('GREP') || st.includes('FIND') || st.includes('READ_URL') || st.includes('MCP')) return { group: 'search', tool: st.includes('SEARCH_WEB') ? 'search_web' : 'search' };
  if (st.includes('SUBAGENT') || st.includes('SWARM')) return { group: 'agent', tool: 'subagent' };
  if (st === 'CORTEX_STEP_TYPE_PLANNER_RESPONSE') return { group: 'model', tool: '模型回复' };
  return { group: 'other', tool: st.replace('CORTEX_STEP_TYPE_', '').toLowerCase() || 'other' };
}

export function computeToolBreakdown(steps, tokenBreakdown) {
  const stepTokens = new Map();
  const groups = tokenBreakdown?.groups;
  if (Array.isArray(groups)) {
    const chatGroup = groups.find((g) => g?.type === 'TOKEN_TYPE_CHAT_MESSAGES');
    for (const ch of chatGroup?.children || []) {
      const m = String(ch?.name || '').match(/^(\d+):/);
      if (m) {
        stepTokens.set(Number(m[1]), toInt(ch?.numTokens));
      }
    }
  }

  const groupMap = new Map();
  let totalTokens = 0;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const st = step?.type || '';
    if (st === 'CORTEX_STEP_TYPE_USER_INPUT' || st === 'CORTEX_STEP_TYPE_SYSTEM_MESSAGE') continue;

    const tok = stepTokens.has(i)
      ? stepTokens.get(i)
      : estimateTextTokens(JSON.stringify(step?.plannerResponse || step?.codeAction || step?.runCommand || step?.viewFile || ''));
    if (tok <= 0) continue;

    const { group, tool } = classifyStepTool(step);
    const meta = TOOL_GROUPS[group] || TOOL_GROUPS.other;
    let gEntry = groupMap.get(meta.key);
    if (!gEntry) {
      gEntry = { ...meta, tokens: 0, count: 0, itemsMap: new Map() };
      groupMap.set(meta.key, gEntry);
    }
    gEntry.tokens += tok;
    gEntry.count += 1;
    totalTokens += tok;

    const prevItem = gEntry.itemsMap.get(tool) || { name: tool, tokens: 0, count: 0 };
    prevItem.tokens += tok;
    prevItem.count += 1;
    gEntry.itemsMap.set(tool, prevItem);
  }

  if (totalTokens <= 0) return { totalTokens: 0, groups: [] };

  const resultGroups = Array.from(groupMap.values())
    .map((g) => ({
      key: g.key,
      name: g.name,
      color: g.color,
      tokens: g.tokens,
      count: g.count,
      pct: (g.tokens / totalTokens) * 100,
      items: Array.from(g.itemsMap.values())
        .sort((a, b) => b.tokens - a.tokens)
        .map((it) => ({ ...it, pct: (it.tokens / totalTokens) * 100 })),
    }))
    .sort((a, b) => b.tokens - a.tokens);

  return { totalTokens, groups: resultGroups };
}

function buildDotGrid(categories, limit) {
  const totalDots = 100;
  let counts = categories.map((c) => (c.tokens <= 0 ? 0 : Math.max(1, Math.floor((c.tokens / limit) * totalDots))));
  const usedDots = counts.reduce((a, b) => a + b, 0);
  if (usedDots > totalDots) {
    counts = counts.map((n) => Math.floor((n * totalDots) / usedDots));
  }
  const dots = [];
  categories.forEach((c, idx) => {
    for (let i = 0; i < counts[idx]; i++) dots.push(c.color);
  });
  while (dots.length < totalDots) dots.push(null);
  return dots;
}

function computeBreakdownFromServer(tokenBreakdown, contextUsed, contextMax) {
  const groups = tokenBreakdown?.groups;
  if (!Array.isArray(groups) || groups.length === 0) return null;

  let userTok = 0;
  let agentTok = 0;
  let toolTok = 0;
  let sysMsgTok = 0;
  let sysPromptTok = 0;
  let sysToolsTok = 0;
  let skillsTok = 0;
  let subagentsTok = 0;
  let otherTok = 0;

  for (const g of groups) {
    const gType = g?.type || '';
    const gTok = toInt(g?.numTokens);
    const children = Array.isArray(g?.children) ? g.children : [];

    if (gType === 'TOKEN_TYPE_SYSTEM_PROMPT') {
      let childSpecial = 0;
      for (const ch of children) {
        const cname = String(ch?.name || '').toLowerCase();
        const ctok = toInt(ch?.numTokens);
        if (cname === 'skills') {
          skillsTok += ctok;
          childSpecial += ctok;
        } else if (cname === 'subagents') {
          subagentsTok += ctok;
          childSpecial += ctok;
        }
      }
      sysPromptTok += Math.max(0, gTok - childSpecial);
    } else if (gType === 'TOKEN_TYPE_TOOLS' || gType === 'TOKEN_TYPE_MCP_TOOLS') {
      sysToolsTok += gTok;
    } else if (gType === 'TOKEN_TYPE_SKILLS') {
      skillsTok += gTok;
    } else if (gType === 'TOKEN_TYPE_SUBAGENTS') {
      subagentsTok += gTok;
    } else if (gType === 'TOKEN_TYPE_CHAT_MESSAGES') {
      if (children.length === 0) {
        agentTok += gTok;
      } else {
        for (const ch of children) {
          const cname = String(ch?.name || '').toUpperCase();
          const ctok = toInt(ch?.numTokens);
          if (cname.includes('USER_INPUT')) userTok += ctok;
          else if (cname.includes('PLANNER_RESPONSE')) agentTok += ctok;
          else if (cname.includes('SYSTEM_MESSAGE')) sysMsgTok += ctok;
          else toolTok += ctok;
        }
      }
    } else {
      otherTok += gTok;
    }
  }

  const used = contextUsed > 0 ? contextUsed : toInt(tokenBreakdown?.totalTokens);
  const limit = contextMax > 0 ? contextMax : Math.max(used, 1);

  const items = [
    { key: 'system', name: '系统提示词', color: '#9aa0a6', tokens: sysPromptTok },
    { key: 'systools', name: '内置工具定义', color: '#78716c', tokens: sysToolsTok },
    { key: 'skills', name: 'Skills', color: '#c084fc', tokens: skillsTok },
    { key: 'subagents', name: 'Subagents', color: '#a855f7', tokens: subagentsTok },
    { key: 'other', name: '规则与其它', color: '#a78bfa', tokens: otherTok },
    { key: 'sysmsg', name: '系统通知', color: '#f87171', tokens: sysMsgTok },
    { key: 'user', name: '用户消息 (User)', color: '#93c5fd', tokens: userTok },
    { key: 'agent', name: 'Agent 回复', color: '#3b82f6', tokens: agentTok },
    { key: 'tool', name: '工具调用 (Tools)', color: '#f59e0b', tokens: toolTok },
  ];

  const categories = items
    .filter((c) => c.tokens > 0)
    .map((c) => ({ ...c, pct: (c.tokens / limit) * 100 }));

  return {
    categories,
    dots: buildDotGrid(categories, limit),
    free: {
      tokens: contextMax > 0 ? Math.max(0, contextMax - used) : 0,
      pct: contextMax > 0 ? Math.max(0, ((contextMax - used) / contextMax) * 100) : 0,
    },
  };
}

function computeContextBreakdown(steps, contextUsed, contextMax, tokenBreakdown = null) {
  const fromServer = computeBreakdownFromServer(tokenBreakdown, contextUsed, contextMax);
  if (fromServer) return fromServer;
  let rawUser = 0;
  let rawAgent = 0;
  let rawTool = 0;
  let rawSysMsg = 0;

  for (const step of steps) {
    const t = step?.type || '';
    if (t === 'CORTEX_STEP_TYPE_USER_INPUT') {
      rawUser += estimateTextTokens(step?.userInput?.userResponse || JSON.stringify(step?.userInput || ''));
    } else if (t === 'CORTEX_STEP_TYPE_PLANNER_RESPONSE') {
      const pr = step?.plannerResponse || {};
      rawAgent += estimateTextTokens(pr.response) + estimateTextTokens(pr.thinking);
      if (Array.isArray(pr.toolCalls) && pr.toolCalls.length > 0) {
        rawTool += estimateTextTokens(JSON.stringify(pr.toolCalls));
      }
    } else if (t === 'CORTEX_STEP_TYPE_SYSTEM_MESSAGE') {
      rawSysMsg += estimateTextTokens(JSON.stringify(step?.systemMessage || step));
    } else {
      // Tool execution steps (file read/write, command, search, etc.)
      const { metadata, type, status, ...payload } = step || {};
      rawTool += estimateTextTokens(JSON.stringify(payload));
    }
  }

  const rawConvTotal = rawUser + rawAgent + rawTool + rawSysMsg;
  const used = Math.max(0, contextUsed);
  // Reserve a baseline for system prompt + built-in tool schemas when conversation exceeds used (summarized history)
  const scale = rawConvTotal > used && used > 0 ? (used * 0.88) / rawConvTotal : 1;

  const userTok = Math.round(rawUser * scale);
  const agentTok = Math.round(rawAgent * scale);
  const toolTok = Math.round(rawTool * scale);
  const sysMsgTok = Math.round(rawSysMsg * scale);
  const convSum = userTok + agentTok + toolTok + sysMsgTok;
  const sysBaseTok = Math.max(0, used - convSum);

  const limit = contextMax > 0 ? contextMax : Math.max(used, 1);
  const items = [
    { key: 'system', name: '系统提示词与内置工具', color: '#9aa0a6', tokens: sysBaseTok },
  ];
  if (sysMsgTok > 0) {
    items.push({ key: 'sysmsg', name: '系统通知', color: '#f87171', tokens: sysMsgTok });
  }
  items.push(
    { key: 'user', name: '用户消息 (User)', color: '#93c5fd', tokens: userTok },
    { key: 'agent', name: 'Agent 回复', color: '#3b82f6', tokens: agentTok },
    { key: 'tool', name: '工具调用 (Tools)', color: '#f59e0b', tokens: toolTok },
  );

  const categories = items
    .filter((c) => c.tokens > 0)
    .map((c) => ({ ...c, pct: (c.tokens / limit) * 100 }));

  return {
    categories,
    dots: buildDotGrid(categories, limit),
    free: {
      tokens: contextMax > 0 ? Math.max(0, contextMax - used) : 0,
      pct: contextMax > 0 ? Math.max(0, ((contextMax - used) / contextMax) * 100) : 0,
    },
  };
}

/**
 * Compute context window, token usage, cache hit rate, and generation speed metrics
 * from a GetCascadeTrajectory response and an optional model catalog.
 */
export function computeTrajectoryMetrics(trajectoryResp, catalog = {}) {
  const trajectory = trajectoryResp?.trajectory || {};
  const genMeta = Array.isArray(trajectory.generatorMetadata) ? trajectory.generatorMetadata : [];
  const steps = Array.isArray(trajectory.steps) ? trajectory.steps : [];

  const turns = [];

  for (const gm of genMeta) {
    const cm = gm?.chatModel;
    if (!cm) continue;
    const usage = cm.usage || {};
    const ctxMeta = cm.chatStartMetadata?.contextWindowMetadata || {};

    const inputTokens = toInt(usage.inputTokens);
    const cacheReadTokens = toInt(usage.cacheReadTokens);
    const cacheCreationTokens = toInt(usage.cacheCreationTokens);
    const outputTokens = toInt(usage.outputTokens);
    const thinkingOutputTokens = toInt(usage.thinkingOutputTokens);
    const responseOutputTokens = toInt(usage.responseOutputTokens);

    const promptTotal = inputTokens + cacheReadTokens + cacheCreationTokens;
    const cacheHitRate = promptTotal > 0 ? (cacheReadTokens / promptTotal) * 100 : 0;

    const ttftSec = parseDurationSec(cm.timeToFirstToken);
    const streamingSec = parseDurationSec(cm.streamingDuration);
    // Thinking tokens are generated during TTFT before streamingDuration begins;
    // using total outputTokens / streamingDuration inflates speed when thinking >> response.
    const streamTokens = responseOutputTokens > 0
      ? responseOutputTokens
      : (thinkingOutputTokens === 0 ? outputTokens : 0);
    const tokensPerSec = streamingSec && streamTokens > 0
      ? streamTokens / streamingSec
      : (ttftSec && outputTokens > 0 ? outputTokens / (ttftSec + (streamingSec || 0)) : null);

    const modelId = cm.model || usage.model || '';
    const modelName = cm.modelDisplayName || catalog[modelId]?.displayName || cm.responseModel || modelId || 'Unknown';
    const maxContextTokens = toInt(ctxMeta.maxContextTokens) || toInt(catalog[modelId]?.maxTokens);
    const estimatedTokensUsed = toInt(ctxMeta.estimatedTokensUsed);
    const stepIndices = Array.isArray(gm.stepIndices) ? gm.stepIndices : [];
    const firstStepIdx = stepIndices[0];
    const createdAt = (firstStepIdx != null && steps[firstStepIdx]?.metadata?.createdAt) || '';

    turns.push({
      turnIndex: turns.length + 1,
      modelId,
      modelName,
      inputTokens,
      cacheReadTokens,
      cacheCreationTokens,
      promptTotal,
      outputTokens,
      thinkingOutputTokens,
      responseOutputTokens,
      cacheHitRate,
      ttftSec,
      streamingSec,
      tokensPerSec,
      estimatedTokensUsed,
      maxContextTokens,
      tokenBreakdown: ctxMeta.tokenBreakdown || null,
      createdAt,
      stepIndices,
    });
  }

  // Fallback to step metadata.modelUsage when generatorMetadata is empty
  if (turns.length === 0) {
    for (const step of steps) {
      const usage = step?.metadata?.modelUsage;
      if (!usage) continue;
      const inputTokens = toInt(usage.inputTokens);
      const cacheReadTokens = toInt(usage.cacheReadTokens);
      const cacheCreationTokens = toInt(usage.cacheCreationTokens);
      const outputTokens = toInt(usage.outputTokens);
      const thinkingOutputTokens = toInt(usage.thinkingOutputTokens);
      const responseOutputTokens = toInt(usage.responseOutputTokens);
      const promptTotal = inputTokens + cacheReadTokens + cacheCreationTokens;
      const cacheHitRate = promptTotal > 0 ? (cacheReadTokens / promptTotal) * 100 : 0;
      const modelId = usage.model || '';
      const modelName = catalog[modelId]?.displayName || modelId || 'Unknown';
      const maxContextTokens = toInt(catalog[modelId]?.maxTokens);

      turns.push({
        turnIndex: turns.length + 1,
        modelId,
        modelName,
        inputTokens,
        cacheReadTokens,
        cacheCreationTokens,
        promptTotal,
        outputTokens,
        thinkingOutputTokens,
        responseOutputTokens,
        cacheHitRate,
        ttftSec: null,
        streamingSec: null,
        tokensPerSec: null,
        estimatedTokensUsed: promptTotal,
        maxContextTokens,
        stepIndices: [],
      });
    }
  }

  let totalUncachedInput = 0;
  let totalCacheRead = 0;
  let totalCacheCreation = 0;
  let totalOutput = 0;
  let totalThinking = 0;
  let totalResponse = 0;
  let totalStreamingSec = 0;
  let totalTimedOutput = 0;
  let ttftSum = 0;
  let ttftCount = 0;

  for (const t of turns) {
    totalUncachedInput += t.inputTokens;
    totalCacheRead += t.cacheReadTokens;
    totalCacheCreation += t.cacheCreationTokens;
    totalOutput += t.outputTokens;
    totalThinking += t.thinkingOutputTokens;
    totalResponse += t.responseOutputTokens;
    if (t.streamingSec && t.responseOutputTokens > 0) {
      totalStreamingSec += t.streamingSec;
      totalTimedOutput += t.responseOutputTokens;
    } else if (t.streamingSec && t.thinkingOutputTokens === 0 && t.outputTokens > 0) {
      totalStreamingSec += t.streamingSec;
      totalTimedOutput += t.outputTokens;
    }
    if (t.ttftSec != null) {
      ttftSum += t.ttftSec;
      ttftCount += 1;
    }
  }

  const totalInputAll = totalUncachedInput + totalCacheRead + totalCacheCreation;
  const overallCacheHitRate = totalInputAll > 0 ? (totalCacheRead / totalInputAll) * 100 : 0;
  const avgTokensPerSec = totalStreamingSec > 0 ? totalTimedOutput / totalStreamingSec : null;
  const avgTtftSec = ttftCount > 0 ? ttftSum / ttftCount : null;

  const latest = turns.length > 0 ? turns[turns.length - 1] : null;
  const contextMax = latest?.maxContextTokens || 0;
  const contextUsed = latest
    ? (latest.estimatedTokensUsed > 0 ? latest.estimatedTokensUsed : latest.promptTotal)
    : 0;
  const contextPct = contextMax > 0 ? Math.min(100, (contextUsed / contextMax) * 100) : 0;
  const contextFree = contextMax > 0 ? Math.max(0, contextMax - contextUsed) : 0;

  const allTurnsDesc = turns.slice().reverse();
  const breakdown = computeContextBreakdown(steps, contextUsed, contextMax, latest?.tokenBreakdown || null);
  const toolTreemap = computeToolBreakdown(steps, latest?.tokenBreakdown || null);

  return {
    cascadeId: trajectory.cascadeId || '',
    status: trajectoryResp?.status || 'UNKNOWN',
    numTotalSteps: toInt(trajectoryResp?.numTotalSteps) || steps.length,
    turnCount: turns.length,
    modelName: latest?.modelName || 'Unknown',
    modelId: latest?.modelId || '',
    context: {
      used: contextUsed,
      estimatedUsed: latest?.estimatedTokensUsed || 0,
      latestPromptTokens: latest?.promptTotal || 0,
      max: contextMax,
      free: contextFree,
      pct: contextPct,
    },
    breakdown,
    toolTreemap,
    totals: {
      uncachedInput: totalUncachedInput,
      cacheRead: totalCacheRead,
      cacheCreation: totalCacheCreation,
      inputAll: totalInputAll,
      output: totalOutput,
      thinking: totalThinking,
      response: totalResponse,
      all: totalInputAll + totalOutput,
    },
    cache: {
      overallHitRate: overallCacheHitRate,
      latestHitRate: latest?.cacheHitRate ?? 0,
      savedInputTokens: totalCacheRead,
    },
    speed: {
      latestTokensPerSec: latest?.tokensPerSec ?? null,
      avgTokensPerSec,
      latestTtftSec: latest?.ttftSec ?? null,
      avgTtftSec,
      latestStreamingSec: latest?.streamingSec ?? null,
    },
    latestTurn: latest,
    recentTurns: allTurnsDesc.slice(0, 30),
    allTurns: allTurnsDesc,
  };
}

function formatBucketKey(iso, range) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n) => String(n).padStart(2, '0');
  if (range === 'today') {
    const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}`;
    return { key, label: `${pad(d.getHours())}:00`, sortKey: key };
  }
  const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return { key, label: `${pad(d.getMonth() + 1)}/${pad(d.getDate())}`, sortKey: key };
}

/**
 * Aggregate multiple trajectory metric summaries into a time-range global overview.
 */
export function aggregateGlobalStats(items, range = 'today') {
  let conversations = 0;
  let turns = 0;
  let uncachedInput = 0;
  let cacheRead = 0;
  let cacheCreation = 0;
  let output = 0;
  let thinking = 0;
  let response = 0;
  let timedOutput = 0;
  let streamingSec = 0;
  let ttftSum = 0;
  let ttftCount = 0;

  const byModel = new Map();
  const byBucket = new Map();
  const byRootConv = new Map();

  for (const item of items) {
    if (!item || !item.turnCount) continue;
    if (!item.isSubagent) conversations += 1;
    turns += item.turnCount;

    const t = item.totals || {};
    uncachedInput += t.uncachedInput || 0;
    cacheRead += t.cacheRead || 0;
    cacheCreation += t.cacheCreation || 0;
    output += t.output || 0;
    thinking += t.thinking || 0;
    response += t.response || 0;

    for (const turn of item.allTurns || []) {
      const mName = turn.modelName || 'Unknown';
      const entry = byModel.get(mName) || { modelName: mName, turns: 0, tokens: 0, input: 0, output: 0 };
      const turnUncached = (turn.inputTokens || 0) + (turn.cacheCreationTokens || 0);
      const turnCache = turn.cacheReadTokens || 0;
      const turnIn = turnUncached + turnCache;
      const turnOut = turn.outputTokens || 0;
      entry.turns += 1;
      entry.input += turnIn;
      entry.output += turnOut;
      entry.tokens += turnIn + turnOut;
      byModel.set(mName, entry);

      const bucketInfo = formatBucketKey(turn.createdAt || item.lastModifiedTime, range);
      if (bucketInfo) {
        const b = byBucket.get(bucketInfo.key) || {
          key: bucketInfo.key,
          label: bucketInfo.label,
          uncachedInput: 0,
          cacheRead: 0,
          output: 0,
          total: 0,
          turns: 0,
        };
        b.uncachedInput += turnUncached;
        b.cacheRead += turnCache;
        b.output += turnOut;
        b.total += turnIn + turnOut;
        b.turns += 1;
        byBucket.set(bucketInfo.key, b);
      }

      const streamTok = turn.responseOutputTokens > 0
        ? turn.responseOutputTokens
        : (turn.thinkingOutputTokens === 0 ? turn.outputTokens : 0);
      if (turn.streamingSec && streamTok > 0) {
        streamingSec += turn.streamingSec;
        timedOutput += streamTok;
      }
      if (turn.ttftSec != null) {
        ttftSum += turn.ttftSec;
        ttftCount += 1;
      }
    }

    const rootId = item.rootConversationId || item.cascadeId;
    const grp = byRootConv.get(rootId) || {
      id: rootId,
      title: rootId.slice(0, 8),
      modelName: item.modelName || 'Unknown',
      turns: 0,
      subagentCount: 0,
      totalTokens: 0,
      uncachedInput: 0,
      cacheRead: 0,
      output: 0,
      lastModifiedTime: '',
    };
    if (!item.isSubagent) {
      grp.title = item.title || grp.title;
      grp.modelName = item.modelName || grp.modelName;
    } else {
      grp.subagentCount += 1;
    }
    grp.turns += item.turnCount;
    grp.totalTokens += t.all || 0;
    grp.uncachedInput += t.uncachedInput || 0;
    grp.cacheRead += t.cacheRead || 0;
    grp.output += t.output || 0;
    if ((item.lastModifiedTime || '') > grp.lastModifiedTime) {
      grp.lastModifiedTime = item.lastModifiedTime || '';
    }
    byRootConv.set(rootId, grp);
  }

  const inputAll = uncachedInput + cacheRead + cacheCreation;
  const totalAll = inputAll + output;
  const cacheHitRate = inputAll > 0 ? (cacheRead / inputAll) * 100 : 0;
  const avgTokensPerSec = streamingSec > 0 ? timedOutput / streamingSec : null;
  const avgTtftSec = ttftCount > 0 ? ttftSum / ttftCount : null;

  const models = Array.from(byModel.values())
    .sort((a, b) => b.tokens - a.tokens)
    .map((m) => ({ ...m, pct: totalAll > 0 ? (m.tokens / totalAll) * 100 : 0 }));

  const timeline = Array.from(byBucket.values())
    .sort((a, b) => a.key.localeCompare(b.key))
    .slice(-16);

  const topConversations = Array.from(byRootConv.values())
    .map((g) => {
      const gIn = g.uncachedInput + g.cacheRead;
      return {
        ...g,
        cacheHitRate: gIn > 0 ? (g.cacheRead / gIn) * 100 : 0,
      };
    })
    .sort((a, b) => b.totalTokens - a.totalTokens)
    .slice(0, 12);

  if (conversations === 0) conversations = byRootConv.size;

  return {
    conversations,
    turns,
    totals: {
      uncachedInput,
      cacheRead,
      cacheCreation,
      inputAll,
      output,
      thinking,
      response,
      all: totalAll,
    },
    cache: {
      hitRate: cacheHitRate,
      savedInputTokens: cacheRead,
    },
    speed: {
      avgTokensPerSec,
      avgTtftSec,
    },
    models,
    timeline,
    topConversations,
  };
}
