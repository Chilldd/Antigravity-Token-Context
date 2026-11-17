(() => {
  const SCRIPT_VERSION = '9';
  if (window.__agyCtxBarVersion === SCRIPT_VERSION) return 'already-bootstrapped';
  window.__agyCtxBarVersion = SCRIPT_VERSION;
  window.__agyCtxBarBootstrapped = true;

  if (window.__agyCtxObserver) {
    try { window.__agyCtxObserver.disconnect(); } catch {}
  }
  document.querySelectorAll('#agy-ctx-inline-bar, #agy-ctx-inline-popover, #agy-ctx-inline-style').forEach((el) => el.remove());

  const BAR_ID = 'agy-ctx-inline-bar';
  const POPOVER_ID = 'agy-ctx-inline-popover';
  const STYLE_ID = 'agy-ctx-inline-style';
  const CID_RE = /\/c\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
  const metricsByCid = new Map();
  let activeCid = '';
  let lastData = null;
  let mountScheduled = false;

  function getCurrentCid() {
    const m = location.href.match(CID_RE);
    return m ? m[1] : '';
  }

  function isLightSurface() {
    let el = document.getElementById(BAR_ID) || document.body;
    while (el) {
      const bg = getComputedStyle(el).backgroundColor || '';
      const m = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
      if (m) {
        const alpha = m[4] === undefined ? 1 : Number(m[4]);
        if (alpha > 0.1) {
          const lum = (0.299 * Number(m[1]) + 0.587 * Number(m[2]) + 0.114 * Number(m[3])) / 255;
          return lum > 0.5;
        }
      }
      el = el.parentElement;
    }
    return !window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function ensureStyle() {
    const existing = document.getElementById(STYLE_ID);
    if (existing && existing.dataset.version === SCRIPT_VERSION) return;
    document.querySelectorAll('#' + STYLE_ID).forEach((el) => el.remove());
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.dataset.version = SCRIPT_VERSION;
    style.textContent = `
      #${BAR_ID} {
        position: relative;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        flex: 0 1 auto;
        min-width: 0;
        max-width: 100%;
        height: 22px;
        margin: 0 auto 0 6px;
        padding: 0 9px 0 6px;
        border-radius: 999px;
        background: color-mix(in srgb, currentColor 5%, transparent);
        border: 1px solid color-mix(in srgb, currentColor 11%, transparent);
        font-size: 11px;
        line-height: 1;
        color: var(--muted-foreground, #6e7681);
        font-variant-numeric: tabular-nums;
        user-select: none;
        cursor: default;
        white-space: nowrap;
        transition: background-color 0.15s ease, border-color 0.15s ease;
      }
      #${BAR_ID}:hover {
        background: color-mix(in srgb, currentColor 9%, transparent);
        border-color: color-mix(in srgb, currentColor 20%, transparent);
      }
      #${BAR_ID}.agy-warn {
        background: rgba(245, 158, 11, 0.10);
        border-color: rgba(245, 158, 11, 0.45);
        color: #d97706;
      }
      #${BAR_ID}.agy-warn:hover {
        background: rgba(245, 158, 11, 0.16);
        border-color: rgba(245, 158, 11, 0.65);
      }
      #${BAR_ID}.agy-crit {
        background: rgba(239, 68, 68, 0.12);
        border-color: rgba(239, 68, 68, 0.55);
        color: #ef4444;
        animation: agy-pulse-crit 2.2s ease-in-out infinite;
      }
      #${BAR_ID}.agy-crit:hover {
        background: rgba(239, 68, 68, 0.18);
        border-color: rgba(239, 68, 68, 0.75);
      }
      @keyframes agy-pulse-crit {
        0%, 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.28); }
        50% { box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.08); }
      }
      #${BAR_ID} .agy-ctx-alert {
        font-size: 10px;
        font-weight: 600;
        padding: 1px 5px;
        border-radius: 999px;
        background: currentColor;
        line-height: 1.25;
      }
      #${BAR_ID} .agy-ctx-alert > span {
        color: #ffffff;
      }
      #${BAR_ID}.agy-warn .agy-ctx-strong { color: #d97706; }
      #${BAR_ID}.agy-crit .agy-ctx-strong { color: #ef4444; }
      #${BAR_ID} .agy-ring-wrap {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        flex: none;
      }
      #${BAR_ID} svg.agy-ring {
        width: 14px;
        height: 14px;
        transform: rotate(-90deg);
        flex: none;
      }
      #${BAR_ID} .agy-ctx-strong {
        color: var(--foreground, inherit);
        font-weight: 600;
      }
      #${BAR_ID} .agy-ctx-div {
        width: 1px;
        height: 10px;
        background: color-mix(in srgb, currentColor 18%, transparent);
        flex: none;
      }
      #${BAR_ID} .agy-ctx-item {
        overflow: hidden;
        text-overflow: ellipsis;
        flex: 0 1 auto;
      }
      #${POPOVER_ID} {
        position: fixed;
        z-index: 999999;
        width: 256px;
        padding: 11px 12px 10px;
        border-radius: 12px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 11px;
        line-height: 1.35;
        font-variant-numeric: tabular-nums;
        pointer-events: none;
        opacity: 0;
        transform: translateY(4px) scale(0.985);
        transition: opacity 0.14s ease, transform 0.14s ease;
        box-sizing: border-box;
      }
      #${POPOVER_ID}.light {
        background: #ffffff;
        color: #18181b;
        border: 1px solid rgba(15, 23, 42, 0.1);
        box-shadow: 0 12px 32px rgba(15, 23, 42, 0.12), 0 2px 6px rgba(15, 23, 42, 0.05);
        --pop-dim: #71717a;
        --pop-cell: #f4f4f5;
        --pop-track: #e4e4e7;
        --pop-line: rgba(15, 23, 42, 0.07);
      }
      #${POPOVER_ID}.dark {
        background: #1e2024;
        color: #f4f4f5;
        border: 1px solid rgba(255, 255, 255, 0.12);
        box-shadow: 0 14px 36px rgba(0, 0, 0, 0.5);
        --pop-dim: #a1a1aa;
        --pop-cell: rgba(255, 255, 255, 0.06);
        --pop-track: rgba(255, 255, 255, 0.12);
        --pop-line: rgba(255, 255, 255, 0.08);
      }
      #${POPOVER_ID}.visible {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
      #${POPOVER_ID} .agy-pop-head {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
        font-weight: 600;
        font-size: 12px;
        margin-bottom: 8px;
      }
      #${POPOVER_ID} .agy-pop-model {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      #${POPOVER_ID} .agy-pop-badge {
        font-size: 11px;
        font-weight: 600;
        padding: 2px 7px;
        border-radius: 999px;
        flex: none;
      }
      #${POPOVER_ID} .agy-pop-bar {
        height: 4px;
        border-radius: 999px;
        background: var(--pop-track);
        overflow: hidden;
        margin: 5px 0 9px;
      }
      #${POPOVER_ID} .agy-pop-bar > div {
        height: 100%;
        border-radius: 999px;
      }
      #${POPOVER_ID} .agy-pop-grid {
        display: grid !important;
        grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
        gap: 6px;
      }
      #${POPOVER_ID} .agy-pop-cell {
        padding: 7px 8px;
        border-radius: 8px;
        background: var(--pop-cell);
      }
      #${POPOVER_ID} .agy-pop-k {
        font-size: 10.5px;
        font-weight: 500;
        letter-spacing: 0.01em;
        color: var(--pop-dim);
      }
      #${POPOVER_ID} .agy-pop-v {
        font-size: 13.5px;
        font-weight: 700;
        margin-top: 2px;
      }
      #${POPOVER_ID} .agy-pop-sub {
        font-size: 10px;
        color: var(--pop-dim);
        margin-top: 2px;
      }
      #${POPOVER_ID} .agy-pop-foot {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-top: 8px;
        padding-top: 7px;
        border-top: 1px solid var(--pop-line);
        font-size: 10.5px;
        color: var(--pop-dim);
      }
      #${POPOVER_ID} .agy-pop-row {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        padding: 2px 0;
        font-size: 11px;
      }
      #${POPOVER_ID} .agy-pop-dim {
        color: var(--pop-dim);
      }
      #${POPOVER_ID} .agy-pop-alert {
        margin-bottom: 8px;
        padding: 5px 8px;
        border-radius: 7px;
        font-size: 10.5px;
        font-weight: 600;
        line-height: 1.35;
      }
      #${POPOVER_ID} .agy-pop-alert.warn {
        background: rgba(245, 158, 11, 0.12);
        color: #d97706;
        border: 1px solid rgba(245, 158, 11, 0.35);
      }
      #${POPOVER_ID} .agy-pop-alert.crit {
        background: rgba(239, 68, 68, 0.14);
        color: #ef4444;
        border: 1px solid rgba(239, 68, 68, 0.4);
      }
      @media (max-width: 720px) {
        #${BAR_ID} .agy-ctx-hide-sm { display: none; }
      }
    `;
    document.head.appendChild(style);
  }

  function ensurePopover() {
    let pop = document.getElementById(POPOVER_ID);
    if (pop && pop.dataset.version !== SCRIPT_VERSION) {
      pop.remove();
      pop = null;
    }
    if (!pop) {
      pop = document.createElement('div');
      pop.id = POPOVER_ID;
      pop.setAttribute('translate', 'no');
      pop.classList.add('notranslate');
      pop.dataset.version = SCRIPT_VERSION;
      document.body.appendChild(pop);
    }
    const light = isLightSurface();
    pop.classList.toggle('light', light);
    pop.classList.toggle('dark', !light);
    return pop;
  }

  function fmtTok(n) {
    const v = Number(n) || 0;
    if (v >= 1e6) return (v / 1e6).toFixed(v % 1e6 === 0 ? 0 : 1) + 'M';
    if (v >= 1e3) return (v / 1e3).toFixed(1) + 'k';
    return String(Math.round(v));
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function findChatInput() {
    const candidates = Array.from(document.querySelectorAll('textarea, [contenteditable="true"]'));
    let best = null;
    let bestScore = -1;
    for (const el of candidates) {
      const r = el.getBoundingClientRect();
      if (r.width < 160 || r.height < 16) continue;
      if (r.top < window.innerHeight * 0.35) continue;
      const score = r.top + r.width * 0.2;
      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }
    return best;
  }

  function findBottomToolbar() {
    const input = findChatInput();
    if (!input) return null;
    const inputRect = input.getBoundingClientRect();

    let card = input.parentElement;
    for (let depth = 0; depth < 7 && card; depth++, card = card.parentElement) {
      const cardRect = card.getBoundingClientRect();
      if (cardRect.height > 420) break;
      const buttons = Array.from(card.querySelectorAll('button'));
      const bottomButtons = buttons.filter((b) => {
        const br = b.getBoundingClientRect();
        return br.width > 0 && br.height > 0 && br.top >= inputRect.bottom - 10;
      });
      if (bottomButtons.length >= 2) {
        let row = bottomButtons[0].parentElement;
        while (row && row !== card) {
          if (bottomButtons.every((b) => row.contains(b))) {
            const style = getComputedStyle(row);
            if (style.display.includes('flex')) {
              return { row };
            }
          }
          row = row.parentElement;
        }
      }
    }
    return null;
  }

  function positionPopover(bar, pop) {
    const br = bar.getBoundingClientRect();
    const popWidth = 256;
    const left = Math.max(8, Math.min(window.innerWidth - popWidth - 8, br.left));
    pop.style.left = left + 'px';
    pop.style.bottom = (window.innerHeight - br.top + 8) + 'px';
    pop.style.top = 'auto';
  }

  function mountBar() {
    ensureStyle();
    const existing = document.getElementById(BAR_ID);
    const found = findBottomToolbar();
    if (!found) return null;
    const { row } = found;
    if (existing && existing.dataset.version === SCRIPT_VERSION && row.contains(existing)) {
      return existing;
    }
    if (existing) existing.remove();

    const bar = document.createElement('div');
    bar.id = BAR_ID;
    bar.dataset.version = SCRIPT_VERSION;

    bar.addEventListener('mouseenter', () => {
      if (!lastData || lastData.error || lastData.empty) return;
      const pop = ensurePopover();
      renderPopover(pop, lastData);
      positionPopover(bar, pop);
      pop.classList.add('visible');
    });
    bar.addEventListener('mouseleave', () => {
      const pop = document.getElementById(POPOVER_ID);
      if (pop) pop.classList.remove('visible');
    });

    const children = Array.from(row.children);
    if (children.length >= 2) {
      row.insertBefore(bar, children[children.length - 1]);
    } else {
      row.appendChild(bar);
    }
    return bar;
  }

  function renderPopover(pop, data) {
    const ctx = data.context || {};
    const speed = data.speed || {};
    const cache = data.cache || {};
    const totals = data.totals || {};

    const pct = Math.max(0, Math.min(100, Number(ctx.pct) || 0));
    const light = isLightSurface();
    const color = pct >= 90 ? (light ? '#dc2626' : '#ef4444') : pct >= 70 ? (light ? '#d97706' : '#f59e0b') : (light ? '#2563eb' : '#60a5fa');
    const badgeBg = pct >= 90 ? (light ? '#fef2f2' : 'rgba(239,68,68,0.16)') : pct >= 70 ? (light ? '#fffbeb' : 'rgba(245,158,11,0.16)') : (light ? '#eff6ff' : 'rgba(59,130,246,0.18)');
    const latestSpeed = speed.latestTokensPerSec != null ? speed.latestTokensPerSec.toFixed(0) + ' t/s' : '-';
    const avgSpeed = speed.avgTokensPerSec != null ? speed.avgTokensPerSec.toFixed(0) + ' avg' : '-';
    const ttft = speed.latestTtftSec != null ? speed.latestTtftSec.toFixed(1) + 's' : '-';
    const hitAll = cache.overallHitRate != null ? cache.overallHitRate.toFixed(1) + '%' : '-';
    const hitLast = cache.latestHitRate != null ? cache.latestHitRate.toFixed(1) + '%' : '-';

    const alertHtml = pct >= 90
      ? `<div class="agy-pop-alert crit">上下文已达 ${pct.toFixed(0)}%，建议立即执行 /compact 或开启新对话</div>`
      : (pct >= 85
          ? `<div class="agy-pop-alert warn">上下文已达 ${pct.toFixed(0)}%，可考虑执行 /compact 压缩</div>`
          : '');

    pop.innerHTML = `
      <div class="agy-pop-head">
        <span class="agy-pop-model">${esc(data.modelName || 'Context')}</span>
        <span class="agy-pop-badge" style="color:${color};background:${badgeBg}">${pct.toFixed(1)}%</span>
      </div>
      <div class="agy-pop-row">
        <span class="agy-pop-dim">Context</span>
        <span><b>${fmtTok(ctx.used)}</b> / ${ctx.max ? fmtTok(ctx.max) : '?'}</span>
      </div>
      <div class="agy-pop-bar"><div style="width:${pct.toFixed(1)}%;background:${color}"></div></div>
      ${alertHtml}
      <div class="agy-pop-grid">
        <div class="agy-pop-cell">
          <div class="agy-pop-k">Speed</div>
          <div class="agy-pop-v">${latestSpeed}</div>
          <div class="agy-pop-sub">${avgSpeed} · ${ttft}</div>
        </div>
        <div class="agy-pop-cell">
          <div class="agy-pop-k">Cache Hit</div>
          <div class="agy-pop-v">${hitAll}</div>
          <div class="agy-pop-sub">last ${hitLast}</div>
        </div>
        <div class="agy-pop-cell">
          <div class="agy-pop-k">Input</div>
          <div class="agy-pop-v">${fmtTok(totals.inputAll)}</div>
          <div class="agy-pop-sub">${fmtTok(totals.uncachedInput)} new</div>
        </div>
        <div class="agy-pop-cell">
          <div class="agy-pop-k">Output</div>
          <div class="agy-pop-v">${fmtTok(totals.output)}</div>
          <div class="agy-pop-sub">${fmtTok(totals.thinking)} think</div>
        </div>
      </div>
      <div class="agy-pop-foot">
        <span>Total ${fmtTok(totals.all)}</span>
        <span>${data.turnCount || 0} turns</span>
      </div>
    `;
  }

  function renderData(data) {
    lastData = data;
    const bar = mountBar();
    if (!bar || !data) return;

    if (data.empty || data.error) {
      bar.classList.remove('agy-warn', 'agy-crit');
      const r = 5.5;
      bar.innerHTML = `
        <span class="agy-ring-wrap">
          <svg class="agy-ring" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="8" cy="8" r="${r}" fill="none" stroke="color-mix(in srgb, currentColor 22%, transparent)" stroke-width="2"></circle>
          </svg>
          <span class="agy-ctx-strong">0%</span>
        </span>
        <span class="agy-ctx-div"></span>
        <span class="agy-ctx-item">-</span>
        <span class="agy-ctx-div agy-ctx-hide-sm"></span>
        <span class="agy-ctx-item agy-ctx-hide-sm">0 tok</span>
      `;
      const pop = document.getElementById(POPOVER_ID);
      if (pop) pop.classList.remove('visible');
      return;
    }

    const ctx = data.context || {};
    const speed = data.speed || {};
    const totals = data.totals || {};

    const pct = Math.max(0, Math.min(100, Number(ctx.pct) || 0));
    const color = pct >= 90 ? '#ef4444' : pct >= 70 ? '#f59e0b' : '#3b82f6';
    bar.classList.toggle('agy-crit', pct >= 90);
    bar.classList.toggle('agy-warn', pct >= 85 && pct < 90);
    const alertTag = pct >= 90
      ? '<span class="agy-ctx-alert"><span>快满 · /compact</span></span>'
      : (pct >= 85 ? '<span class="agy-ctx-alert"><span>建议 /compact</span></span>' : '');
    const r = 5.5;
    const circ = 2 * Math.PI * r;
    const offset = circ * (1 - pct / 100);

    const tokSpeed = speed.latestTokensPerSec != null ? speed.latestTokensPerSec.toFixed(0) + ' t/s' : '-';
    const totalTok = fmtTok(totals.all);

    bar.innerHTML = `
      <span class="agy-ring-wrap">
        <svg class="agy-ring" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r="${r}" fill="none" stroke="color-mix(in srgb, currentColor 22%, transparent)" stroke-width="2"></circle>
          <circle cx="8" cy="8" r="${r}" fill="none" stroke="${color}" stroke-width="2"
            stroke-linecap="round" stroke-dasharray="${circ.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}"></circle>
        </svg>
        <span class="agy-ctx-strong">${pct.toFixed(0)}%</span>
      </span>
      ${alertTag}
      <span class="agy-ctx-div"></span>
      <span class="agy-ctx-item">${tokSpeed}</span>
      <span class="agy-ctx-div agy-ctx-hide-sm"></span>
      <span class="agy-ctx-item agy-ctx-hide-sm">${totalTok}</span>
    `;

    const pop = document.getElementById(POPOVER_ID);
    if (pop && pop.classList.contains('visible')) {
      renderPopover(pop, data);
      positionPopover(bar, pop);
    }
  }

  function onUpdate(data) {
    if (!data) return;
    if (data.cascadeId) {
      metricsByCid.set(data.cascadeId, data);
    }
    const curCid = getCurrentCid();
    activeCid = curCid;
    if (!curCid) {
      if (!data.empty) return;
    } else if (data.cascadeId && data.cascadeId !== curCid) {
      return;
    }
    renderData(data);
  }

  function handleRouteChange() {
    const nextCid = getCurrentCid();
    if (nextCid === activeCid) return;
    activeCid = nextCid;
    const cached = nextCid ? metricsByCid.get(nextCid) : null;
    renderData(cached || { empty: true, cascadeId: nextCid });
  }

  const origPushState = history.pushState.bind(history);
  history.pushState = function (...args) {
    const ret = origPushState(...args);
    queueMicrotask(handleRouteChange);
    return ret;
  };
  const origReplaceState = history.replaceState.bind(history);
  history.replaceState = function (...args) {
    const ret = origReplaceState(...args);
    queueMicrotask(handleRouteChange);
    return ret;
  };
  window.addEventListener('popstate', handleRouteChange);

  window.__agyCtxUpdate = onUpdate;

  const observer = new MutationObserver(() => {
    handleRouteChange();
    if (mountScheduled) return;
    mountScheduled = true;
    requestAnimationFrame(() => {
      mountScheduled = false;
      const existing = document.getElementById(BAR_ID);
      if (!existing || !existing.isConnected) {
        if (lastData) renderData(lastData);
        else mountBar();
      }
    });
  });
  window.__agyCtxObserver = observer;
  observer.observe(document.body, { childList: true, subtree: true });

  return 'bootstrapped';
})();
