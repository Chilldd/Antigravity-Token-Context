(() => {
  const SCRIPT_VERSION = '37';
  if (window.__agyCtxBarVersion === SCRIPT_VERSION) return 'already-bootstrapped';
  window.__agyCtxBarVersion = SCRIPT_VERSION;
  window.__agyCtxBarBootstrapped = true;

  if (window.__agyCtxObserver) {
    try { window.__agyCtxObserver.disconnect(); } catch {}
  }
  if (window.__agyDemoWorkspaceCleanup) {
    try { window.__agyDemoWorkspaceCleanup(); } catch {}
    delete window.__agyDemoWorkspaceCleanup;
  }
  if (window.__agyWsCleanup) {
    try { window.__agyWsCleanup(); } catch {}
    delete window.__agyWsCleanup;
  }
  document.querySelectorAll(
    '#agy-ctx-inline-bar, #agy-ctx-inline-popover, #agy-quota-inline-bar, #agy-quota-inline-popover, #agy-ctx-inline-style, #agy-ws-menu, #agy-ws-view, #agy-ws-style, #agy-demo-workspace-menu, #agy-demo-workspace-view, #agy-demo-workspace-style',
  ).forEach((el) => el.remove());

  const BAR_ID = 'agy-ctx-inline-bar';
  const POPOVER_ID = 'agy-ctx-inline-popover';
  const QUOTA_BAR_ID = 'agy-quota-inline-bar';
  const QUOTA_POP_ID = 'agy-quota-inline-popover';
  const STYLE_ID = 'agy-ctx-inline-style';
  const CID_RE = /\/c\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
  const metricsByCid = new Map();
  let activeCid = '';
  let lastData = null;
  let lastRenderKey = '';
  let lastQuotaKey = '';
  let mountScheduled = false;
  let popPinned = false;
  let quotaPopPinned = false;
  let compactFeedbackTimer = null;

  function getCurrentCid() {
    const m = location.href.match(CID_RE);
    return m ? m[1] : '';
  }

  function isLightSurface() {
    const bar = document.getElementById(BAR_ID);
    const qBar = document.getElementById(QUOTA_BAR_ID);
    let el = (bar && bar.parentElement) || (qBar && qBar.parentElement) || document.body;
    while (el) {
      if (el !== bar && el !== qBar) {
        const bg = getComputedStyle(el).backgroundColor || '';
        const m = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
        if (m) {
          const alpha = m[4] === undefined ? 1 : Number(m[4]);
          if (alpha >= 0.75) {
            const lum = (0.299 * Number(m[1]) + 0.587 * Number(m[2]) + 0.114 * Number(m[3])) / 255;
            return lum > 0.5;
          }
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
      #${BAR_ID},
      #${QUOTA_BAR_ID} {
        --bar-accent: #6b93f2;
        --bar-accent-bg: rgba(107, 147, 242, 0.14);
        --bar-accent-border: rgba(107, 147, 242, 0.42);
        --bar-ok: #4fd1af;
        --bar-warn: #e0a043;
        --bar-warn-fg: #f0b95e;
        --bar-warn-bg: rgba(224, 160, 67, 0.13);
        --bar-warn-border: rgba(224, 160, 67, 0.42);
        --bar-danger: #e46464;
        --bar-danger-fg: #f28484;
        --bar-danger-bg: rgba(228, 100, 100, 0.14);
        --bar-danger-border: rgba(228, 100, 100, 0.48);
      }
      #${BAR_ID}.agy-light,
      #${QUOTA_BAR_ID}.agy-light {
        --bar-accent: #3b6ce7;
        --bar-accent-bg: rgba(59, 108, 231, 0.10);
        --bar-accent-border: rgba(59, 108, 231, 0.36);
        --bar-ok: #0b7258;
        --bar-warn: #c9821e;
        --bar-warn-fg: #9a5b0c;
        --bar-warn-bg: rgba(201, 130, 30, 0.10);
        --bar-warn-border: rgba(201, 130, 30, 0.36);
        --bar-danger: #cf3a3a;
        --bar-danger-fg: #b42828;
        --bar-danger-bg: rgba(207, 58, 58, 0.10);
        --bar-danger-border: rgba(207, 58, 58, 0.40);
      }
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
        color: var(--muted-foreground, #6b7280);
        font-variant-numeric: tabular-nums;
        font-feature-settings: "tnum" 1;
        user-select: none;
        white-space: nowrap;
        transition: background-color 0.15s ease, border-color 0.15s ease;
      }
      #${BAR_ID} .agy-ctx-main {
        appearance: none;
        background: transparent;
        border: none;
        padding: 0;
        margin: 0;
        font: inherit;
        color: inherit;
        line-height: 1;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
        cursor: pointer;
        border-radius: 999px;
        transition: transform 0.1s ease;
      }
      #${BAR_ID} .agy-ctx-main:active {
        transform: scale(0.97);
      }
      #${BAR_ID} .agy-ctx-main * {
        cursor: pointer;
      }
      #${BAR_ID}:hover {
        background: color-mix(in srgb, currentColor 9%, transparent);
        border-color: color-mix(in srgb, currentColor 20%, transparent);
      }
      #${BAR_ID}.agy-pinned {
        background: var(--bar-accent-bg);
        border-color: var(--bar-accent-border);
      }
      #${BAR_ID} .agy-ctx-main:focus-visible {
        outline: 2px solid var(--bar-accent);
        outline-offset: 2px;
      }
      #${BAR_ID}.agy-err {
        border-style: dashed;
        opacity: 0.9;
      }
      #${BAR_ID}.agy-warn {
        background: var(--bar-warn-bg);
        border-color: var(--bar-warn-border);
        color: var(--bar-warn-fg);
      }
      #${BAR_ID}.agy-warn:hover {
        background: color-mix(in srgb, var(--bar-warn) 16%, transparent);
        border-color: var(--bar-warn);
      }
      #${BAR_ID}.agy-crit {
        background: var(--bar-danger-bg);
        border-color: var(--bar-danger-border);
        color: var(--bar-danger-fg);
        animation: agy-pulse-crit 2.4s ease-in-out infinite;
      }
      #${BAR_ID}.agy-crit:hover {
        background: color-mix(in srgb, var(--bar-danger) 18%, transparent);
        border-color: var(--bar-danger);
      }
      @keyframes agy-pulse-crit {
        0%, 100% { border-color: var(--bar-danger-border); }
        50% { border-color: var(--bar-danger); }
      }
      @media (prefers-reduced-motion: reduce) {
        #${BAR_ID},
        #${BAR_ID} .agy-ctx-main,
        #${BAR_ID} svg.agy-ring circle:nth-child(2),
        #${POPOVER_ID},
        #${POPOVER_ID} .agy-pop-bar > div,
        #${QUOTA_POP_ID},
        #${QUOTA_POP_ID} .agy-qpop-bar > div {
          transition: none;
        }
        #${BAR_ID} .agy-ctx-main:active {
          transform: none;
        }
        #${BAR_ID}.agy-crit {
          animation: none;
        }
      }
      #${BAR_ID}.agy-warn .agy-ctx-strong { color: var(--bar-warn-fg); }
      #${BAR_ID}.agy-crit .agy-ctx-strong { color: var(--bar-danger-fg); }
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
      #${BAR_ID} svg.agy-ring .agy-ring-prog {
        stroke: var(--bar-accent);
        transition: stroke-dashoffset 0.55s cubic-bezier(0.25, 1, 0.5, 1), stroke 0.25s ease;
      }
      #${BAR_ID}.agy-warn svg.agy-ring .agy-ring-prog {
        stroke: var(--bar-warn);
      }
      #${BAR_ID}.agy-crit svg.agy-ring .agy-ring-prog {
        stroke: var(--bar-danger);
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
      #${BAR_ID}.agy-has-quota {
        margin-right: 0;
      }
      #${BAR_ID} .agy-ctx-item {
        overflow: hidden;
        text-overflow: ellipsis;
        flex: 0 1 auto;
      }
      #${QUOTA_BAR_ID} {
        position: relative;
        display: inline-flex;
        align-items: center;
        flex: 0 0 auto;
        height: 22px;
        margin: 0 auto 0 6px;
        padding: 0 8px;
        border-radius: 999px;
        background: color-mix(in srgb, currentColor 5%, transparent);
        border: 1px solid color-mix(in srgb, currentColor 11%, transparent);
        font-size: 11px;
        line-height: 1;
        color: var(--muted-foreground, #6b7280);
        font-variant-numeric: tabular-nums;
        font-feature-settings: "tnum" 1;
        user-select: none;
        white-space: nowrap;
        transition: background-color 0.15s ease, border-color 0.15s ease;
      }
      #${QUOTA_BAR_ID}:hover {
        background: color-mix(in srgb, currentColor 9%, transparent);
        border-color: color-mix(in srgb, currentColor 20%, transparent);
      }
      #${QUOTA_BAR_ID}.agy-pinned {
        background: var(--bar-accent-bg);
        border-color: var(--bar-accent-border);
      }
      #${QUOTA_BAR_ID} .agy-quota-btn {
        appearance: none;
        background: transparent;
        border: none;
        padding: 0;
        margin: 0;
        font: inherit;
        color: inherit;
        line-height: 1;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        cursor: pointer;
        border-radius: 999px;
      }
      #${QUOTA_BAR_ID} .agy-quota-btn * {
        cursor: pointer;
      }
      #${QUOTA_BAR_ID} .agy-quota-btn:focus-visible {
        outline: 2px solid var(--bar-accent);
        outline-offset: 2px;
      }
      #${QUOTA_BAR_ID} .agy-quota-lbl {
        opacity: 0.78;
      }
      #${QUOTA_BAR_ID}.agy-light .agy-quota-lbl {
        color: #575f6d;
        opacity: 1;
      }
      #${QUOTA_BAR_ID} .agy-quota-val {
        color: var(--foreground, inherit);
        font-weight: 600;
      }
      #${QUOTA_BAR_ID} .agy-quota-val.low { color: var(--bar-warn-fg); }
      #${QUOTA_BAR_ID} .agy-quota-val.crit { color: var(--bar-danger-fg); }
      #${QUOTA_BAR_ID} .agy-quota-sep {
        opacity: 0.42;
      }
      #${POPOVER_ID},
      #${QUOTA_POP_ID} {
        position: fixed;
        z-index: 999999;
        width: 276px;
        padding: 12px;
        border-radius: 10px;
        background: var(--pop-bg);
        color: var(--pop-fg);
        border: 1px solid var(--pop-border);
        box-shadow: var(--pop-shadow);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
        font-size: 11.5px;
        line-height: 1.4;
        font-variant-numeric: tabular-nums;
        font-feature-settings: "tnum" 1;
        pointer-events: none;
        opacity: 0;
        transform: translateY(4px) scale(0.985);
        transition: opacity 0.22s ease, transform 0.22s cubic-bezier(0.25, 1, 0.5, 1);
        box-sizing: border-box;
      }
      #${QUOTA_POP_ID} {
        width: 236px;
      }
      #${POPOVER_ID}.visible,
      #${QUOTA_POP_ID}.visible {
        opacity: 1;
        transform: translateY(0) scale(1);
        pointer-events: auto;
      }
      #${POPOVER_ID}.light,
      #${QUOTA_POP_ID}.light {
        --pop-bg: #ffffff;
        --pop-fg: #111827;
        --pop-dim: #6b7280;
        --pop-cell: #f7f8fa;
        --pop-cell-border: rgba(15, 23, 42, 0.06);
        --pop-track: #e6e9f0;
        --pop-line: rgba(15, 23, 42, 0.07);
        --pop-border: rgba(15, 23, 42, 0.09);
        --pop-shadow: 0 4px 12px -2px rgba(15, 23, 42, 0.08), 0 12px 24px -6px rgba(15, 23, 42, 0.11);
        --pop-accent: #3b6ce7;
        --pop-accent-fg: #2c56c8;
        --pop-accent-bg: rgba(59, 108, 231, 0.09);
        --pop-ok: #0f8b6c;
        --pop-ok-fg: #0b7258;
        --pop-ok-bg: rgba(15, 139, 108, 0.09);
        --pop-warn: #c9821e;
        --pop-warn-fg: #9a5b0c;
        --pop-warn-bg: rgba(201, 130, 30, 0.10);
        --pop-warn-border: rgba(201, 130, 30, 0.28);
        --pop-danger: #cf3a3a;
        --pop-danger-fg: #b42828;
        --pop-danger-bg: rgba(207, 58, 58, 0.09);
        --pop-danger-border: rgba(207, 58, 58, 0.28);
      }
      #${POPOVER_ID}.dark,
      #${QUOTA_POP_ID}.dark {
        --pop-bg: #1a1d24;
        --pop-fg: #eef1f6;
        --pop-dim: #8b94a5;
        --pop-cell: #222630;
        --pop-cell-border: rgba(255, 255, 255, 0.06);
        --pop-track: rgba(255, 255, 255, 0.10);
        --pop-line: rgba(255, 255, 255, 0.08);
        --pop-border: rgba(255, 255, 255, 0.11);
        --pop-shadow: 0 8px 24px rgba(0, 0, 0, 0.48), 0 2px 6px rgba(0, 0, 0, 0.28);
        --pop-accent: #6b93f2;
        --pop-accent-fg: #8cb0f8;
        --pop-accent-bg: rgba(107, 147, 242, 0.15);
        --pop-ok: #2cb593;
        --pop-ok-fg: #4fd1af;
        --pop-ok-bg: rgba(44, 181, 147, 0.14);
        --pop-warn: #e0a043;
        --pop-warn-fg: #f0b95e;
        --pop-warn-bg: rgba(224, 160, 67, 0.15);
        --pop-warn-border: rgba(224, 160, 67, 0.34);
        --pop-danger: #e46464;
        --pop-danger-fg: #f28484;
        --pop-danger-bg: rgba(228, 100, 100, 0.16);
        --pop-danger-border: rgba(228, 100, 100, 0.36);
      }
      #${POPOVER_ID} .agy-u,
      #${QUOTA_POP_ID} .agy-u {
        font-size: 0.74em;
        font-weight: 500;
        color: var(--pop-dim);
        margin-left: 1px;
      }
      #${POPOVER_ID} .agy-u-sp {
        font-size: 0.66em;
      }
      #${POPOVER_ID} .agy-tone-accent,
      #${QUOTA_POP_ID} .agy-tone-accent {
        color: var(--pop-accent-fg);
        background: var(--pop-accent-bg);
      }
      #${POPOVER_ID} .agy-tone-ok,
      #${QUOTA_POP_ID} .agy-tone-ok {
        color: var(--pop-ok-fg);
        background: var(--pop-ok-bg);
      }
      #${POPOVER_ID} .agy-tone-warn,
      #${QUOTA_POP_ID} .agy-tone-warn {
        color: var(--pop-warn-fg);
        background: var(--pop-warn-bg);
      }
      #${POPOVER_ID} .agy-tone-crit,
      #${QUOTA_POP_ID} .agy-tone-crit {
        color: var(--pop-danger-fg);
        background: var(--pop-danger-bg);
      }
      #${POPOVER_ID} .agy-fill-accent,
      #${QUOTA_POP_ID} .agy-fill-accent { background: var(--pop-accent); }
      #${POPOVER_ID} .agy-fill-ok,
      #${QUOTA_POP_ID} .agy-fill-ok { background: var(--pop-ok); }
      #${POPOVER_ID} .agy-fill-warn,
      #${QUOTA_POP_ID} .agy-fill-warn { background: var(--pop-warn); }
      #${POPOVER_ID} .agy-fill-crit,
      #${QUOTA_POP_ID} .agy-fill-crit { background: var(--pop-danger); }
      #${QUOTA_POP_ID} .agy-text-ok { color: var(--pop-ok-fg); }
      #${QUOTA_POP_ID} .agy-text-warn { color: var(--pop-warn-fg); }
      #${QUOTA_POP_ID} .agy-text-crit { color: var(--pop-danger-fg); }
      #${POPOVER_ID} .agy-pop-head,
      #${QUOTA_POP_ID} .agy-qpop-head {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
        font-weight: 600;
        font-size: 12px;
        margin-bottom: 9px;
      }
      #${POPOVER_ID} .agy-pop-model {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      #${POPOVER_ID} .agy-pop-badge,
      #${QUOTA_POP_ID} .agy-qpop-badge {
        font-size: 10.5px;
        font-weight: 600;
        padding: 2px 7px;
        border-radius: 999px;
        flex: none;
      }
      #${POPOVER_ID} .agy-pop-bar,
      #${QUOTA_POP_ID} .agy-qpop-bar {
        height: 4px;
        border-radius: 999px;
        background: var(--pop-track);
        overflow: hidden;
      }
      #${POPOVER_ID} .agy-pop-bar {
        margin: 5px 0 9px;
      }
      #${QUOTA_POP_ID} .agy-qpop-bar {
        margin: 5px 0 4px;
      }
      #${POPOVER_ID} .agy-pop-bar > div,
      #${QUOTA_POP_ID} .agy-qpop-bar > div {
        height: 100%;
        border-radius: 999px;
        transition: width 0.55s cubic-bezier(0.25, 1, 0.5, 1);
      }
      #${POPOVER_ID} .agy-pop-grid {
        display: grid !important;
        grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
        gap: 6px;
      }
      #${POPOVER_ID} .agy-pop-cell,
      #${QUOTA_POP_ID} .agy-qpop-item {
        padding: 8px 9px;
        border-radius: 7px;
        background: var(--pop-cell);
        border: 1px solid var(--pop-cell-border);
      }
      #${QUOTA_POP_ID} .agy-qpop-item {
        margin-bottom: 6px;
      }
      #${QUOTA_POP_ID} .agy-qpop-item:last-of-type {
        margin-bottom: 0;
      }
      #${POPOVER_ID} .agy-pop-k {
        font-size: 10.5px;
        font-weight: 500;
        letter-spacing: 0.01em;
        color: var(--pop-dim);
      }
      #${POPOVER_ID} .agy-pop-v {
        font-size: 14px;
        font-weight: 700;
        letter-spacing: -0.02em;
        margin-top: 2px;
      }
      #${POPOVER_ID} .agy-pop-sub {
        font-size: 10px;
        color: var(--pop-dim);
        margin-top: 2px;
      }
      #${POPOVER_ID} .agy-pop-foot,
      #${QUOTA_POP_ID} .agy-qpop-foot {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-top: 9px;
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
      #${QUOTA_POP_ID} .agy-qpop-row {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 8px;
        font-size: 11px;
      }
      #${QUOTA_POP_ID} .agy-qpop-name {
        font-weight: 600;
      }
      #${QUOTA_POP_ID} .agy-qpop-pct {
        font-size: 12.5px;
        font-weight: 700;
      }
      #${QUOTA_POP_ID} .agy-qpop-reset {
        font-size: 10px;
        color: var(--pop-dim);
      }
      #${POPOVER_ID} .agy-pop-alert {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 8px;
        padding: 6px 8px;
        border-radius: 7px;
        font-size: 10.5px;
        font-weight: 600;
        line-height: 1.35;
      }
      #${POPOVER_ID} .agy-pop-alert.warn {
        background: var(--pop-warn-bg);
        color: var(--pop-warn-fg);
        border: 1px solid var(--pop-warn-border);
      }
      #${POPOVER_ID} .agy-pop-alert.crit {
        background: var(--pop-danger-bg);
        color: var(--pop-danger-fg);
        border: 1px solid var(--pop-danger-border);
      }
      #${POPOVER_ID} .agy-pop-err-msg {
        padding: 7px 8px;
        border-radius: 7px;
        background: var(--pop-danger-bg);
        border: 1px solid var(--pop-danger-border);
        color: var(--pop-danger-fg);
        font-size: 11px;
        line-height: 1.45;
        word-break: break-word;
        margin-bottom: 8px;
      }
      #${POPOVER_ID} .agy-pop-err-tip {
        font-size: 11px;
        color: var(--pop-dim);
        line-height: 1.45;
        margin-bottom: 9px;
      }
      #${POPOVER_ID} .agy-pop-action {
        flex: none;
        border: 1px solid currentColor;
        background: transparent;
        color: inherit;
        font: inherit;
        font-size: 10px;
        font-weight: 600;
        padding: 2px 7px;
        border-radius: 5px;
        cursor: pointer;
      }
      #${POPOVER_ID} .agy-pop-action:hover {
        background: color-mix(in srgb, currentColor 14%, transparent);
      }
      @media (max-width: 720px) {
        #${BAR_ID} .agy-ctx-hide-sm { display: none; }
      }
    `;
    document.head.appendChild(style);
  }

  function ensurePopover(id = POPOVER_ID) {
    let pop = document.getElementById(id);
    if (pop && pop.dataset.version !== SCRIPT_VERSION) {
      pop.remove();
      pop = null;
    }
    if (!pop) {
      pop = document.createElement('div');
      pop.id = id;
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
    if (v >= 1e6) return (v / 1e6).toFixed(v % 1e6 === 0 ? 0 : 2) + 'M';
    if (v >= 1e3) return (v / 1e3).toFixed(1) + 'k';
    return String(Math.round(v));
  }

  function fmtTokHtml(n) {
    const v = Number(n) || 0;
    if (v >= 1e6) {
      return `${(v / 1e6).toFixed(v % 1e6 === 0 ? 0 : 2)}<span class="agy-u">M</span>`;
    }
    if (v >= 1e3) {
      return `${(v / 1e3).toFixed(1)}<span class="agy-u">k</span>`;
    }
    return String(Math.round(v));
  }

  function fmtPctHtml(v) {
    if (v == null || !Number.isFinite(Number(v))) return '-';
    return `${Number(v).toFixed(1)}<span class="agy-u">%</span>`;
  }

  function fmtSpeedHtml(v) {
    if (v == null || !Number.isFinite(Number(v))) return '-';
    return `${Number(v).toFixed(0)}<span class="agy-u agy-u-sp"> tok/s</span>`;
  }

  function fmtResetRemain(resetTime) {
    if (!resetTime) return '';
    const diffMs = Date.parse(resetTime) - Date.now();
    if (!Number.isFinite(diffMs)) return '';
    if (diffMs <= 0) return '即将重置';
    const totalMin = Math.floor(diffMs / 60000);
    const days = Math.floor(totalMin / (24 * 60));
    const hours = Math.floor((totalMin % (24 * 60)) / 60);
    const mins = totalMin % 60;
    if (days > 0) return `${days}d${hours}h`;
    if (hours > 0) return `${hours}h${mins}m`;
    return `${Math.max(1, mins)}m`;
  }

  function quotaLevelClass(pct) {
    if (pct <= 5) return 'crit';
    if (pct <= 20) return 'low';
    return '';
  }

  function getQuotaKey(quota) {
    if (!quota) return '';
    const h5 = quota.fiveHour ? String(quota.fiveHour.pct) : '';
    const d7 = quota.weekly ? String(quota.weekly.pct) : '';
    return `${h5}:${d7}`;
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
        if (b.id === BAR_ID || b.closest('#' + BAR_ID)) return false;
        if (b.id === QUOTA_BAR_ID || b.closest('#' + QUOTA_BAR_ID)) return false;
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

  function positionPopover(bar, pop, popWidth = 276) {
    const br = bar.getBoundingClientRect();
    const left = Math.max(8, Math.min(window.innerWidth - popWidth - 8, br.left));
    pop.style.left = left + 'px';
    pop.style.bottom = (window.innerHeight - br.top + 8) + 'px';
    pop.style.top = 'auto';
  }

  function showPopover(bar) {
    if (!lastData || lastData.empty) return;
    if (!quotaPopPinned) hideQuotaPopover(false);
    const pop = ensurePopover(POPOVER_ID);
    renderPopover(pop, lastData);
    positionPopover(bar, pop, 276);
    pop.classList.add('visible');
    const mainBtn = bar.querySelector('.agy-ctx-main');
    if (mainBtn) mainBtn.setAttribute('aria-expanded', 'true');
    bar.classList.toggle('agy-pinned', popPinned);
  }

  function hidePopover(force = false) {
    if (popPinned && !force) return;
    popPinned = false;
    const pop = document.getElementById(POPOVER_ID);
    if (pop) pop.classList.remove('visible');
    const bar = document.getElementById(BAR_ID);
    if (bar) {
      const mainBtn = bar.querySelector('.agy-ctx-main');
      if (mainBtn) mainBtn.setAttribute('aria-expanded', 'false');
      bar.classList.remove('agy-pinned');
    }
  }

  function showQuotaPopover(qBar) {
    const quota = lastData?.quota;
    if (!quota || (!quota.fiveHour && !quota.weekly)) return;
    if (!popPinned) hidePopover(false);
    const pop = ensurePopover(QUOTA_POP_ID);
    renderQuotaPopover(pop, quota);
    positionPopover(qBar, pop, 236);
    pop.classList.add('visible');
    const btn = qBar.querySelector('.agy-quota-btn');
    if (btn) btn.setAttribute('aria-expanded', 'true');
    qBar.classList.toggle('agy-pinned', quotaPopPinned);
  }

  function hideQuotaPopover(force = false) {
    if (quotaPopPinned && !force) return;
    quotaPopPinned = false;
    const pop = document.getElementById(QUOTA_POP_ID);
    if (pop) pop.classList.remove('visible');
    const qBar = document.getElementById(QUOTA_BAR_ID);
    if (qBar) {
      const btn = qBar.querySelector('.agy-quota-btn');
      if (btn) btn.setAttribute('aria-expanded', 'false');
      qBar.classList.remove('agy-pinned');
    }
  }

  function showCompactFeedback(feedbackEl, msg) {
    if (!feedbackEl) return;
    if (!feedbackEl.dataset.origText) {
      feedbackEl.dataset.origText = feedbackEl.textContent;
    }
    feedbackEl.textContent = msg;
    clearTimeout(compactFeedbackTimer);
    compactFeedbackTimer = setTimeout(() => {
      if (feedbackEl.isConnected && feedbackEl.dataset.origText != null) {
        feedbackEl.textContent = feedbackEl.dataset.origText;
        delete feedbackEl.dataset.origText;
      }
    }, 1800);
  }

  async function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {}
    }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      ta.style.top = '0';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return Boolean(ok);
    } catch {
      return false;
    }
  }

  function insertCompactCommand(feedbackEl) {
    const cmd = '/compact';
    const input = findChatInput();
    if (input) {
      const isTextInput = input.tagName === 'TEXTAREA' || input.tagName === 'INPUT';
      const currentRaw = isTextInput
        ? (input.value ?? '')
        : (input.isContentEditable ? (input.textContent ?? '') : '');
      const currentTrimmed = currentRaw.trim();

      if (currentTrimmed.startsWith(cmd)) {
        try { input.focus(); } catch {}
        showCompactFeedback(feedbackEl, '输入框已有 /compact');
        return;
      }

      if (currentTrimmed === '') {
        let inserted = false;
        try {
          input.focus();
          if (isTextInput) {
            const proto = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value');
            if (proto && proto.set) proto.set.call(input, cmd);
            else input.value = cmd;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            inserted = true;
          } else if (input.isContentEditable) {
            input.textContent = cmd;
            input.dispatchEvent(new InputEvent('input', { bubbles: true, data: cmd, inputType: 'insertText' }));
            inserted = true;
          }
        } catch {}
        if (inserted) {
          showCompactFeedback(feedbackEl, '已填入 /compact');
          return;
        }
      } else {
        copyToClipboard(cmd).then((copied) => {
          showCompactFeedback(
            feedbackEl,
            copied ? '草稿已保留 · 已复制 /compact' : '草稿已保留 · 请手动输入 /compact',
          );
        });
        return;
      }
    }

    copyToClipboard(cmd).then((copied) => {
      showCompactFeedback(feedbackEl, copied ? '已复制 /compact' : '请手动输入 /compact');
    });
  }

  function bindDocumentDismiss() {
    if (window.__agyCtxDocBound === SCRIPT_VERSION) return;
    window.__agyCtxDocBound = SCRIPT_VERSION;
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        hidePopover(true);
        hideQuotaPopover(true);
      }
    });
    document.addEventListener('click', (e) => {
      if (popPinned) {
        const bar = document.getElementById(BAR_ID);
        const pop = document.getElementById(POPOVER_ID);
        if (!(bar && bar.contains(e.target)) && !(pop && pop.contains(e.target))) {
          hidePopover(true);
        }
      }
      if (quotaPopPinned) {
        const qBar = document.getElementById(QUOTA_BAR_ID);
        const qPop = document.getElementById(QUOTA_POP_ID);
        if (!(qBar && qBar.contains(e.target)) && !(qPop && qPop.contains(e.target))) {
          hideQuotaPopover(true);
        }
      }
    });
  }

  function mountBar() {
    ensureStyle();
    bindDocumentDismiss();
    const existing = document.getElementById(BAR_ID);
    if (existing && existing.dataset.version === SCRIPT_VERSION && existing.isConnected) {
      return existing;
    }
    const found = findBottomToolbar();
    if (!found) return null;
    const { row } = found;
    if (existing) existing.remove();

    const bar = document.createElement('div');
    bar.id = BAR_ID;
    bar.dataset.version = SCRIPT_VERSION;
    bar.classList.toggle('agy-light', isLightSurface());
    ensureBarStructure(bar);

    const mainBtn = bar.querySelector('.agy-ctx-main');

    mainBtn.addEventListener('mouseenter', () => showPopover(bar));
    mainBtn.addEventListener('focus', () => showPopover(bar));
    bar.addEventListener('mouseleave', () => {
      setTimeout(() => {
        const pop = document.getElementById(POPOVER_ID);
        if (pop && pop.matches(':hover')) return;
        hidePopover(false);
      }, 90);
    });
    mainBtn.addEventListener('blur', () => {
      setTimeout(() => {
        const pop = document.getElementById(POPOVER_ID);
        if (pop && pop.contains(document.activeElement)) return;
        if (bar.contains(document.activeElement)) return;
        hidePopover(false);
      }, 90);
    });
    mainBtn.addEventListener('click', () => {
      if (!lastData || lastData.empty) return;
      popPinned = !popPinned;
      if (popPinned) {
        hideQuotaPopover(true);
        showPopover(bar);
      } else {
        hidePopover(true);
      }
    });

    const children = Array.from(row.children);
    if (children.length >= 2) {
      row.insertBefore(bar, children[children.length - 1]);
    } else {
      row.appendChild(bar);
    }
    return bar;
  }

  function mountQuotaBar() {
    ensureStyle();
    bindDocumentDismiss();
    const existing = document.getElementById(QUOTA_BAR_ID);
    if (existing && existing.dataset.version === SCRIPT_VERSION && existing.isConnected) {
      return existing;
    }
    const found = findBottomToolbar();
    if (!found) return null;
    const { row } = found;
    if (existing) existing.remove();

    const qBar = document.createElement('div');
    qBar.id = QUOTA_BAR_ID;
    qBar.dataset.version = SCRIPT_VERSION;
    qBar.classList.toggle('agy-light', isLightSurface());
    qBar.style.display = 'none';
    qBar.innerHTML = '<button type="button" class="agy-quota-btn" aria-expanded="false" aria-label="Gemini 剩余额度"></button>';

    const btn = qBar.querySelector('.agy-quota-btn');
    btn.addEventListener('mouseenter', () => showQuotaPopover(qBar));
    btn.addEventListener('focus', () => showQuotaPopover(qBar));
    qBar.addEventListener('mouseleave', () => {
      setTimeout(() => {
        const pop = document.getElementById(QUOTA_POP_ID);
        if (pop && pop.matches(':hover')) return;
        hideQuotaPopover(false);
      }, 90);
    });
    btn.addEventListener('blur', () => {
      setTimeout(() => {
        const pop = document.getElementById(QUOTA_POP_ID);
        if (pop && pop.contains(document.activeElement)) return;
        if (qBar.contains(document.activeElement)) return;
        hideQuotaPopover(false);
      }, 90);
    });
    btn.addEventListener('click', () => {
      const quota = lastData?.quota;
      if (!quota || (!quota.fiveHour && !quota.weekly)) return;
      quotaPopPinned = !quotaPopPinned;
      if (quotaPopPinned) {
        hidePopover(true);
        showQuotaPopover(qBar);
      } else {
        hideQuotaPopover(true);
      }
    });

    const ctxBar = document.getElementById(BAR_ID);
    if (ctxBar && ctxBar.parentElement === row) {
      ctxBar.insertAdjacentElement('afterend', qBar);
    } else {
      const children = Array.from(row.children);
      if (children.length >= 2) row.insertBefore(qBar, children[children.length - 1]);
      else row.appendChild(qBar);
    }
    return qBar;
  }

  function renderQuotaPopover(pop, quota) {
    const fiveHour = quota?.fiveHour;
    const weekly = quota?.weekly;
    const minPct = Math.min(
      fiveHour ? fiveHour.pct : 100,
      weekly ? weekly.pct : 100,
    );
    const statusText = minPct <= 5 ? '紧张' : (minPct <= 20 ? '偏低' : '充裕');
    const headTone = minPct <= 5 ? 'crit' : (minPct <= 20 ? 'warn' : 'ok');

    const renderBucket = (label, bucket) => {
      if (!bucket) return '';
      const pct = Math.max(0, Math.min(100, Number(bucket.pct) || 0));
      const level = pct <= 5 ? 'crit' : (pct <= 20 ? 'warn' : 'ok');
      const reset = fmtResetRemain(bucket.resetTime);
      return `
        <div class="agy-qpop-item">
          <div class="agy-qpop-row">
            <span class="agy-qpop-name">${label}</span>
            <span class="agy-qpop-pct agy-text-${level}">${pct}<span class="agy-u">%</span></span>
          </div>
          <div class="agy-qpop-bar"><div class="agy-fill-${level}" style="width:${pct}%"></div></div>
          <div class="agy-qpop-reset">${reset ? `${reset} 后重置` : '重置时间未知'}</div>
        </div>
      `;
    };

    pop.innerHTML = `
      <div class="agy-qpop-head">
        <span>Gemini 额度</span>
        <span class="agy-qpop-badge agy-tone-${headTone}">${statusText}</span>
      </div>
      ${renderBucket('5 小时额度', fiveHour)}
      ${renderBucket('7 天额度', weekly)}
      <div class="agy-qpop-foot">
        <span>Gemini Models</span>
        <span>${quotaPopPinned ? '已固定' : '点击固定'}</span>
      </div>
    `;

    pop.onmouseleave = () => {
      setTimeout(() => {
        const qBar = document.getElementById(QUOTA_BAR_ID);
        if (qBar && qBar.matches(':hover')) return;
        hideQuotaPopover(false);
      }, 90);
    };
  }

  function renderPopover(pop, data) {
    if (data.error) {
      const errMsg = (typeof data.error === 'string' && data.error)
        ? data.error
        : (data.message || '连接已断开');
      pop.innerHTML = `
        <div class="agy-pop-head">
          <span class="agy-pop-model">连接异常</span>
          <span class="agy-pop-badge agy-tone-crit">离线</span>
        </div>
        <div class="agy-pop-err-msg">${esc(errMsg)}</div>
        <div class="agy-pop-err-tip">请检查语言服务器或 CDP 调试端口是否已启动，或打开右侧 Token 监控面板点击「刷新」；状态栏将在连接恢复后自动更新。</div>
        <div class="agy-pop-foot">
          <span>${popPinned ? '已固定' : '点击固定'}</span>
          <span>恢复后自动更新</span>
        </div>
      `;
      pop.onmouseleave = () => {
        setTimeout(() => {
          const bar = document.getElementById(BAR_ID);
          if (bar && bar.matches(':hover')) return;
          hidePopover(false);
        }, 90);
      };
      return;
    }

    const ctx = data.context || {};
    const speed = data.speed || {};
    const cache = data.cache || {};
    const totals = data.totals || {};

    const pct = Math.max(0, Math.min(100, Number(ctx.pct) || 0));
    const level = pct >= 90 ? 'crit' : (pct >= 75 ? 'warn' : 'accent');
    const latestSpeedHtml = fmtSpeedHtml(speed.latestTokensPerSec);
    const avgSpeed = speed.avgTokensPerSec != null ? '均值 ' + speed.avgTokensPerSec.toFixed(0) + ' tok/s' : '均值 -';
    const ttft = speed.latestTtftSec != null ? '首字 ' + speed.latestTtftSec.toFixed(1) + 's' : '首字 -';
    const hitAllHtml = fmtPctHtml(cache.overallHitRate);
    const hitLast = cache.latestHitRate != null ? '本轮 ' + cache.latestHitRate.toFixed(1) + '%' : '本轮 -';

    const alertHtml = pct >= 90
      ? `<div class="agy-pop-alert crit"><span>已达 ${pct.toFixed(0)}%，建议压缩或开新对话</span><button type="button" class="agy-pop-action" data-compact>填入 /compact</button></div>`
      : (pct >= 75
          ? `<div class="agy-pop-alert warn"><span>已达 ${pct.toFixed(0)}%，建议适时压缩上下文</span><button type="button" class="agy-pop-action" data-compact>填入 /compact</button></div>`
          : '');

    pop.innerHTML = `
      <div class="agy-pop-head">
        <span class="agy-pop-model">${esc(data.modelName || '当前上下文')}</span>
        <span class="agy-pop-badge agy-tone-${level}">${pct.toFixed(1)}<span class="agy-u">%</span></span>
      </div>
      <div class="agy-pop-row">
        <span class="agy-pop-dim">上下文占用</span>
        <span><b>${fmtTokHtml(ctx.used)}</b> <span class="agy-pop-dim">/ ${ctx.max ? fmtTok(ctx.max) : '?'}</span></span>
      </div>
      <div class="agy-pop-bar"><div class="agy-fill-${level}" style="width:${pct.toFixed(1)}%"></div></div>
      ${alertHtml}
      <div class="agy-pop-grid">
        <div class="agy-pop-cell">
          <div class="agy-pop-k">生成速度</div>
          <div class="agy-pop-v">${latestSpeedHtml}</div>
          <div class="agy-pop-sub">${avgSpeed}<br>${ttft}</div>
        </div>
        <div class="agy-pop-cell">
          <div class="agy-pop-k">缓存命中</div>
          <div class="agy-pop-v">${hitAllHtml}</div>
          <div class="agy-pop-sub">${hitLast}</div>
        </div>
        <div class="agy-pop-cell">
          <div class="agy-pop-k">累计输入</div>
          <div class="agy-pop-v">${fmtTokHtml(totals.inputAll)}</div>
          <div class="agy-pop-sub">新 ${fmtTok(totals.uncachedInput)}</div>
        </div>
        <div class="agy-pop-cell">
          <div class="agy-pop-k">累计输出</div>
          <div class="agy-pop-v">${fmtTokHtml(totals.output)}</div>
          <div class="agy-pop-sub">思考 ${fmtTok(totals.thinking)}</div>
        </div>
      </div>
      <div class="agy-pop-foot">
        <span>总计 ${fmtTok(totals.all)}</span>
        <span>${data.turnCount || 0} 轮${popPinned ? ' · 已固定' : ' · 点击固定'}</span>
      </div>
    `;

    pop.onmouseleave = () => {
      setTimeout(() => {
        const bar = document.getElementById(BAR_ID);
        if (bar && bar.matches(':hover')) return;
        hidePopover(false);
      }, 90);
    };
    const compactBtn = pop.querySelector('[data-compact]');
    if (compactBtn) {
      compactBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        insertCompactCommand(compactBtn);
      });
    }
  }

  function ensureBarStructure(bar) {
    if (bar.dataset.built === '1') return;
    bar.dataset.built = '1';
    const r = 5.5;
    const circ = (2 * Math.PI * r).toFixed(2);
    bar.innerHTML = `
      <button type="button" class="agy-ctx-main" aria-expanded="false" aria-label="上下文与 Token 状态">
        <span class="agy-ring-wrap">
          <svg class="agy-ring" viewBox="0 0 16 16" aria-hidden="true">
            <circle class="agy-ring-track" cx="8" cy="8" r="${r}" fill="none" stroke="color-mix(in srgb, currentColor 22%, transparent)" stroke-width="2"></circle>
            <circle class="agy-ring-prog" cx="8" cy="8" r="${r}" fill="none" stroke-width="2"
              stroke-linecap="round" stroke-dasharray="${circ}" stroke-dashoffset="${circ}"></circle>
          </svg>
          <span class="agy-ctx-strong" data-slot="pct">0%</span>
        </span>
        <span class="agy-ctx-div"></span>
        <span class="agy-ctx-item" data-slot="speed">待命中</span>
        <span class="agy-ctx-div agy-ctx-hide-sm" data-slot="div2"></span>
        <span class="agy-ctx-item agy-ctx-hide-sm" data-slot="total">0 tok</span>
      </button>
    `;
  }

  function renderQuotaBar(quota) {
    const qBar = mountQuotaBar();
    const ctxBar = document.getElementById(BAR_ID);
    const fiveHour = quota?.fiveHour;
    const weekly = quota?.weekly;
    const hasQuota = Boolean(fiveHour || weekly);

    if (ctxBar) ctxBar.classList.toggle('agy-has-quota', hasQuota && Boolean(qBar));
    if (!qBar) return;

    qBar.classList.toggle('agy-light', isLightSurface());
    if (!hasQuota) {
      lastQuotaKey = '';
      qBar.style.display = 'none';
      hideQuotaPopover(true);
      return;
    }

    const qKey = getQuotaKey(quota);
    qBar.style.display = '';
    if (qKey !== lastQuotaKey) {
      lastQuotaKey = qKey;
      const parts = [];
      const ariaParts = [];
      if (fiveHour) {
        const cls = quotaLevelClass(fiveHour.pct);
        parts.push(`<span class="agy-quota-lbl">5h</span><span class="agy-quota-val ${cls}">${fiveHour.pct}%</span>`);
        ariaParts.push(`5小时 ${fiveHour.pct}%`);
      }
      if (weekly) {
        const cls = quotaLevelClass(weekly.pct);
        parts.push(`<span class="agy-quota-lbl">7d</span><span class="agy-quota-val ${cls}">${weekly.pct}%</span>`);
        ariaParts.push(`7天 ${weekly.pct}%`);
      }
      const btn = qBar.querySelector('.agy-quota-btn');
      if (btn) {
        btn.innerHTML = parts.join('<span class="agy-quota-sep">·</span>');
        btn.setAttribute('aria-label', `Gemini 剩余额度：${ariaParts.join('，')}，点击展开或固定详情`);
      }
    }

    const qPop = document.getElementById(QUOTA_POP_ID);
    if (qPop && qPop.classList.contains('visible')) {
      renderQuotaPopover(qPop, quota);
      positionPopover(qBar, qPop, 236);
    }
  }

  function renderData(data) {
    lastData = data;
    const bar = mountBar();
    renderQuotaBar(data?.quota);
    if (!bar || !data) return;

    bar.classList.toggle('agy-light', isLightSurface());
    const mainBtn = bar.querySelector('.agy-ctx-main');
    const r = 5.5;
    const circ = 2 * Math.PI * r;
    let renderKey = '';

    if (data.error) {
      const errMsg = (typeof data.error === 'string' && data.error) ? data.error : (data.message || '连接已断开');
      renderKey = `err:${errMsg}`;
      if (renderKey !== lastRenderKey || bar.dataset.built !== '1') {
        lastRenderKey = renderKey;

        ensureBarStructure(bar);
        bar.classList.remove('agy-warn', 'agy-crit', 'agy-pinned');
        bar.classList.add('agy-err');
        if (mainBtn) {
          mainBtn.setAttribute('aria-label', `上下文监控连接异常：${errMsg}`);
          mainBtn.title = `连接异常：${errMsg}`;
        }

        const track = bar.querySelector('.agy-ring-track');
        const prog = bar.querySelector('.agy-ring-prog');
        if (track) track.setAttribute('stroke-dasharray', '2 2');
        if (prog) prog.style.display = 'none';
        bar.querySelector('[data-slot="pct"]').textContent = '--%';
        bar.querySelector('[data-slot="speed"]').textContent = '连接异常';
        bar.querySelector('[data-slot="div2"]').style.display = 'none';
        bar.querySelector('[data-slot="total"]').style.display = 'none';
      }

      const pop = document.getElementById(POPOVER_ID);
      if (pop && pop.classList.contains('visible')) {
        renderPopover(pop, data);
        positionPopover(bar, pop, 276);
      }
      return;
    }

    bar.classList.remove('agy-err');
    if (mainBtn) mainBtn.removeAttribute('title');

    if (data.empty) {
      renderKey = 'empty';
      if (renderKey === lastRenderKey && bar.dataset.built === '1') return;
      lastRenderKey = renderKey;

      ensureBarStructure(bar);
      bar.classList.remove('agy-warn', 'agy-crit', 'agy-pinned');
      const track = bar.querySelector('.agy-ring-track');
      const prog = bar.querySelector('.agy-ring-prog');
      if (track) track.removeAttribute('stroke-dasharray');
      if (prog) {
        prog.style.display = '';
        prog.setAttribute('stroke-dashoffset', circ.toFixed(2));
      }
      if (mainBtn) mainBtn.setAttribute('aria-label', '上下文与 Token 状态：暂无对话数据');
      bar.querySelector('[data-slot="pct"]').textContent = '0%';
      bar.querySelector('[data-slot="speed"]').textContent = '待命中';
      bar.querySelector('[data-slot="div2"]').style.display = '';
      const totalEl = bar.querySelector('[data-slot="total"]');
      totalEl.style.display = '';
      totalEl.textContent = '0 tok';
      hidePopover(true);
      return;
    }

    const ctx = data.context || {};
    const speed = data.speed || {};
    const totals = data.totals || {};

    const pct = Math.max(0, Math.min(100, Number(ctx.pct) || 0));
    const pctRounded = pct.toFixed(0);
    const tokSpeed = speed.latestTokensPerSec != null ? speed.latestTokensPerSec.toFixed(0) + ' tok/s' : '-';
    const totalTok = fmtTok(totals.all);

    renderKey = `ok:${pctRounded}|${tokSpeed}|${totalTok}`;
    if (renderKey !== lastRenderKey || bar.dataset.built !== '1') {
      lastRenderKey = renderKey;
      ensureBarStructure(bar);
      bar.classList.toggle('agy-crit', pct >= 90);
      bar.classList.toggle('agy-warn', pct >= 75 && pct < 90);
      if (mainBtn) mainBtn.setAttribute('aria-label', `上下文占用 ${pctRounded}%，点击展开或固定详情`);

      const track = bar.querySelector('.agy-ring-track');
      const prog = bar.querySelector('.agy-ring-prog');
      if (track) track.removeAttribute('stroke-dasharray');
      if (prog) {
        prog.style.display = '';
        prog.setAttribute('stroke-dashoffset', (circ * (1 - pct / 100)).toFixed(2));
      }

      bar.querySelector('[data-slot="pct"]').textContent = `${pctRounded}%`;
      bar.querySelector('[data-slot="speed"]').textContent = tokSpeed;
      bar.querySelector('[data-slot="div2"]').style.display = '';
      const totalEl = bar.querySelector('[data-slot="total"]');
      totalEl.style.display = '';
      totalEl.textContent = totalTok;
    }

    const pop = document.getElementById(POPOVER_ID);
    if (pop && pop.classList.contains('visible')) {
      renderPopover(pop, data);
      positionPopover(bar, pop, 276);
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

  // =========================================================================
  // Session Kanban Board (Sidebar Menu + Center Conversation Overlay)
  // =========================================================================
  const WS_MENU_ID = 'agy-ws-menu';
  const WS_VIEW_ID = 'agy-ws-view';
  const WS_STYLE_ID = 'agy-ws-style';
  const WS_LANES = [
    { key: 'starred', label: '关注', emptyText: '点击卡片星标即可集中关注' },
    { key: 'attention', label: '需处理', emptyText: '暂无待确认或异常的会话' },
    { key: 'running', label: '进行中', emptyText: '当前没有运行中的会话' },
    { key: 'done', label: '已完成', emptyText: '暂无已完成的会话' },
  ];

  let wsOpen = false;
  let wsQuery = '';
  let wsScope = 'all'; // 'workspace' | 'all'
  let wsBoardData = null;
  let wsLastRenderKey = '';
  let wsEditingCid = '';
  let wsBoardOpenedAt = 0;
  let wsLoadingTimer = null;
  let wsToastTimer = null;
  let wsProjectMenuOpen = false;
  let wsProjectFilter = '';
  let wsLastFocusedEl = null;
  const wsExpandedGroups = new Set(); // 'week' | 'older' | 'archived'

  function ensureWsStyle() {
    const existing = document.getElementById(WS_STYLE_ID);
    if (existing && existing.dataset.version === SCRIPT_VERSION) return;
    document.querySelectorAll('#' + WS_STYLE_ID).forEach((el) => el.remove());
    const style = document.createElement('style');
    style.id = WS_STYLE_ID;
    style.dataset.version = SCRIPT_VERSION;
    style.textContent = `
      #${WS_MENU_ID}.agy-ws-menu-active {
        background: color-mix(in srgb, currentColor 8%, transparent) !important;
        color: var(--foreground, inherit) !important;
        font-weight: 500;
      }
      #${WS_MENU_ID} .ws-menu-badge {
        margin-left: auto;
        min-width: 16px;
        height: 16px;
        padding: 0 5px;
        border-radius: 999px;
        font-size: 11px;
        font-weight: 600;
        line-height: 16px;
        text-align: center;
        font-variant-numeric: tabular-nums;
        display: none;
      }
      #${WS_MENU_ID} .ws-menu-badge.is-visible {
        display: inline-block;
      }
      #${WS_MENU_ID} .ws-menu-badge.is-warn {
        background: rgba(224, 160, 67, 0.18);
        color: var(--ws-badge-warn-fg, #f0b95e);
      }
      #${WS_MENU_ID} .ws-menu-badge.is-unread {
        background: rgba(79, 209, 175, 0.16);
        color: var(--ws-badge-unread-fg, #4fd1af);
      }
      #${WS_MENU_ID}.agy-light .ws-menu-badge.is-warn {
        background: rgba(201, 130, 30, 0.14);
        --ws-badge-warn-fg: #9a5b0c;
      }
      #${WS_MENU_ID}.agy-light .ws-menu-badge.is-unread {
        background: rgba(15, 139, 108, 0.12);
        --ws-badge-unread-fg: #0b7258;
      }
      #${WS_VIEW_ID} {
        --ws-canvas: #13151a;
        --ws-surface: #1a1d24;
        --ws-surface-alt: #222630;
        --ws-col-bg: rgba(255, 255, 255, 0.025);
        --ws-col-head: rgba(255, 255, 255, 0.04);
        --ws-ink: #eef1f6;
        --ws-secondary: #c4cad6;
        --ws-muted: #8b94a5;
        --ws-border: rgba(238, 241, 246, 0.10);
        --ws-border-strong: rgba(238, 241, 246, 0.18);
        --ws-shadow: 0 1px 2px rgba(0, 0, 0, 0.24);
        --ws-pop-shadow: 0 6px 18px rgba(0, 0, 0, 0.45);
        --ws-cobalt: #6b93f2;
        --ws-cobalt-bg: rgba(107, 147, 242, 0.12);
        --ws-emerald: #4fd1af;
        --ws-emerald-bg: rgba(79, 209, 175, 0.11);
        --ws-amber: #f0b95e;
        --ws-amber-bg: rgba(224, 160, 67, 0.11);
        --ws-crimson: #f28484;
        --ws-crimson-bg: rgba(228, 100, 100, 0.11);
        position: absolute;
        inset: 0;
        z-index: 40;
        display: none;
        flex-direction: column;
        overflow: hidden;
        background: var(--ws-canvas);
        color: var(--ws-ink);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif;
        font-size: 12.5px;
        line-height: 1.45;
      }
      #${WS_VIEW_ID}.agy-light {
        --ws-canvas: #f7f8fa;
        --ws-surface: #ffffff;
        --ws-surface-alt: #f3f5f8;
        --ws-col-bg: #f1f3f7;
        --ws-col-head: #eaedf2;
        --ws-ink: #111827;
        --ws-secondary: #4b5563;
        --ws-muted: #6b7280;
        --ws-border: rgba(17, 24, 39, 0.09);
        --ws-border-strong: rgba(17, 24, 39, 0.17);
        --ws-shadow: 0 1px 2px rgba(17, 24, 39, 0.05);
        --ws-pop-shadow: 0 4px 12px -2px rgba(15, 23, 42, 0.08), 0 12px 24px -6px rgba(15, 23, 42, 0.10);
        --ws-cobalt: #3b6ce7;
        --ws-cobalt-bg: rgba(59, 108, 231, 0.09);
        --ws-emerald: #0b7258;
        --ws-emerald-bg: rgba(15, 139, 108, 0.09);
        --ws-amber: #9a5b0c;
        --ws-amber-bg: rgba(201, 130, 30, 0.09);
        --ws-crimson: #b42828;
        --ws-crimson-bg: rgba(207, 58, 58, 0.09);
      }
      #${WS_VIEW_ID}.agy-ws-open {
        display: flex;
      }
      #${WS_VIEW_ID} ::selection {
        background: var(--ws-cobalt-bg);
        color: var(--ws-ink);
      }
      #${WS_VIEW_ID} .num {
        font-variant-numeric: tabular-nums;
        font-feature-settings: "tnum" 1;
      }
      #${WS_VIEW_ID} .ws-topbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
        padding: 10px clamp(20px, 7vw, 92px) 10px 20px;
        background: var(--ws-surface);
        border-bottom: 1px solid var(--ws-border);
        flex-shrink: 0;
      }
      #${WS_VIEW_ID} .ws-topbar-left,
      #${WS_VIEW_ID} .ws-topbar-right {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
      }
      #${WS_VIEW_ID} .ws-heading {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        font-size: 12.5px;
        font-weight: 600;
        letter-spacing: -0.005em;
        color: var(--ws-ink);
        margin: 0;
      }
      #${WS_VIEW_ID} .ws-seg {
        display: inline-flex;
        align-items: center;
        padding: 2px;
        border-radius: 8px;
        background: var(--ws-surface-alt);
        border: 1px solid var(--ws-border);
      }
      #${WS_VIEW_ID} .ws-seg-btn {
        appearance: none;
        border: none;
        background: transparent;
        color: var(--ws-muted);
        font-size: 11.5px;
        font-weight: 500;
        padding: 3px 9px;
        border-radius: 6px;
        cursor: pointer;
        transition: color 0.15s ease, background-color 0.15s ease, transform 0.1s ease;
      }
      #${WS_VIEW_ID} .ws-seg-btn:hover {
        color: var(--ws-ink);
      }
      #${WS_VIEW_ID} .ws-seg-btn[aria-pressed="true"] {
        background: var(--ws-surface);
        color: var(--ws-ink);
        box-shadow: var(--ws-shadow);
      }
      #${WS_VIEW_ID} .ws-search-wrap {
        position: relative;
        display: inline-flex;
        align-items: center;
      }
      #${WS_VIEW_ID} .ws-search-icon {
        position: absolute;
        left: 8px;
        color: var(--ws-muted);
        pointer-events: none;
      }
      #${WS_VIEW_ID} .ws-search {
        height: 26px;
        width: 210px;
        padding: 0 8px 0 26px;
        border-radius: 6px;
        border: 1px solid var(--ws-border);
        background: var(--ws-canvas);
        color: var(--ws-ink);
        font-size: 12px;
        outline: none;
        transition: border-color 0.15s ease;
      }
      #${WS_VIEW_ID} .ws-search::placeholder {
        color: var(--ws-muted);
      }
      #${WS_VIEW_ID} .ws-search:focus {
        border-color: var(--ws-cobalt);
      }
      #${WS_VIEW_ID} .ws-total {
        font-size: 11.5px;
        color: var(--ws-muted);
      }
      #${WS_VIEW_ID} .ws-btn {
        appearance: none;
        display: inline-flex;
        align-items: center;
        gap: 5px;
        height: 26px;
        padding: 0 10px;
        border-radius: 7px;
        border: 1px solid var(--ws-border);
        background: var(--ws-surface);
        color: var(--ws-secondary);
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        transition: border-color 0.15s ease, color 0.15s ease, background-color 0.15s ease, transform 0.1s ease;
      }
      #${WS_VIEW_ID} .ws-btn:hover {
        border-color: var(--ws-border-strong);
        color: var(--ws-ink);
      }
      #${WS_VIEW_ID} .ws-btn-primary {
        background: var(--ws-cobalt);
        border-color: var(--ws-cobalt);
        color: #ffffff;
      }
      #${WS_VIEW_ID} .ws-btn-primary:hover {
        color: #ffffff;
        opacity: 0.92;
      }
      #${WS_VIEW_ID} .ws-split-wrap {
        position: relative;
        display: inline-flex;
        align-items: center;
      }
      #${WS_VIEW_ID} .ws-split-main {
        border-top-right-radius: 0;
        border-bottom-right-radius: 0;
        padding-right: 8px;
      }
      #${WS_VIEW_ID} .ws-split-trigger {
        appearance: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        height: 26px;
        width: 24px;
        padding: 0;
        border: 1px solid var(--ws-cobalt);
        border-left: 1px solid rgba(255, 255, 255, 0.25);
        border-radius: 0 7px 7px 0;
        background: var(--ws-cobalt);
        color: #ffffff;
        cursor: pointer;
        transition: opacity 0.15s ease, transform 0.1s ease;
      }
      #${WS_VIEW_ID} .ws-split-trigger:hover {
        opacity: 0.92;
      }
      #${WS_VIEW_ID} .ws-project-popover {
        position: absolute;
        top: calc(100% + 6px);
        right: 0;
        width: 240px;
        padding: 6px;
        border-radius: 10px;
        background: var(--ws-surface);
        border: 1px solid var(--ws-border-strong);
        box-shadow: var(--ws-pop-shadow);
        z-index: 60;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      #${WS_VIEW_ID} .ws-project-popover[hidden] {
        display: none;
      }
      #${WS_VIEW_ID} .ws-project-filter {
        width: 100%;
        height: 26px;
        padding: 0 8px;
        border-radius: 6px;
        border: 1px solid var(--ws-border);
        background: var(--ws-canvas);
        color: var(--ws-ink);
        font-size: 11.5px;
        outline: none;
        box-sizing: border-box;
      }
      #${WS_VIEW_ID} .ws-project-filter:focus {
        border-color: var(--ws-cobalt);
      }
      #${WS_VIEW_ID} .ws-project-list {
        max-height: 240px;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      #${WS_VIEW_ID} .ws-project-item {
        appearance: none;
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 6px 8px;
        border: none;
        border-radius: 6px;
        background: transparent;
        color: var(--ws-ink);
        font-size: 12px;
        text-align: left;
        cursor: pointer;
        transition: background-color 0.12s ease;
      }
      #${WS_VIEW_ID} .ws-project-item:hover {
        background: var(--ws-surface-alt);
      }
      #${WS_VIEW_ID} .ws-project-item-name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      #${WS_VIEW_ID} .ws-project-item-badge {
        font-size: 11px;
        color: var(--ws-cobalt);
        font-weight: 600;
        flex-shrink: 0;
      }
      #${WS_VIEW_ID} .ws-btn:active,
      #${WS_VIEW_ID} .ws-seg-btn:active,
      #${WS_VIEW_ID} .ws-col-action:active,
      #${WS_VIEW_ID} .ws-op-btn:active,
      #${WS_VIEW_ID} .ws-split-trigger:active {
        transform: scale(0.97);
      }
      #${WS_VIEW_ID} .ws-btn:focus-visible,
      #${WS_VIEW_ID} .ws-seg-btn:focus-visible,
      #${WS_VIEW_ID} .ws-split-trigger:focus-visible,
      #${WS_VIEW_ID} .ws-project-item:focus-visible,
      #${WS_VIEW_ID} .ws-card-main:focus-visible,
      #${WS_VIEW_ID} .ws-op-btn:focus-visible,
      #${WS_VIEW_ID} .ws-group-toggle:focus-visible,
      #${WS_VIEW_ID} .ws-col-action:focus-visible,
      #${WS_VIEW_ID} .ws-notice-btn:focus-visible,
      #${WS_VIEW_ID} .ws-toast-btn:focus-visible {
        outline: 2px solid var(--ws-cobalt);
        outline-offset: 1px;
      }
      #${WS_VIEW_ID} .ws-board-scroll {
        flex: 1;
        min-height: 0;
        overflow: auto;
        padding: 14px 20px 24px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      #${WS_VIEW_ID} .ws-board-scroll::-webkit-scrollbar,
      #${WS_VIEW_ID} .ws-project-list::-webkit-scrollbar {
        width: 6px;
        height: 6px;
      }
      #${WS_VIEW_ID} .ws-board-scroll::-webkit-scrollbar-thumb,
      #${WS_VIEW_ID} .ws-project-list::-webkit-scrollbar-thumb {
        background: var(--ws-border-strong);
        border-radius: 999px;
      }
      #${WS_VIEW_ID} .ws-scope-notice {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 7px 12px;
        border-radius: 8px;
        background: var(--ws-cobalt-bg);
        border: 1px solid color-mix(in srgb, var(--ws-cobalt) 28%, transparent);
        color: var(--ws-ink);
        font-size: 12px;
        flex-shrink: 0;
      }
      #${WS_VIEW_ID} .ws-notice-btn {
        appearance: none;
        border: none;
        background: transparent;
        color: var(--ws-cobalt);
        font-size: 11.5px;
        font-weight: 600;
        cursor: pointer;
        padding: 2px 6px;
        border-radius: 5px;
      }
      #${WS_VIEW_ID} .ws-notice-btn:hover {
        background: var(--ws-surface);
      }
      #${WS_VIEW_ID} .ws-empty-lanes-strip {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        flex-shrink: 0;
      }
      #${WS_VIEW_ID} .ws-empty-lane-pill {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px 10px;
        border-radius: 999px;
        background: var(--ws-surface);
        border: 1px solid var(--ws-border);
        color: var(--ws-muted);
        font-size: 11.5px;
      }
      #${WS_VIEW_ID} .ws-board {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      #${WS_VIEW_ID} .ws-col {
        display: flex;
        flex-direction: column;
        min-height: 0;
        border-radius: 10px;
        background: var(--ws-col-bg);
        border: 1px solid var(--ws-border);
        overflow: hidden;
      }
      #${WS_VIEW_ID} .ws-col-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 9px 12px;
        background: var(--ws-col-head);
        border-bottom: 1px solid var(--ws-border);
        flex-shrink: 0;
      }
      #${WS_VIEW_ID} .ws-col-head-right {
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }
      #${WS_VIEW_ID} .ws-col-action {
        appearance: none;
        border: 1px solid var(--ws-border);
        background: var(--ws-surface);
        color: var(--ws-secondary);
        font-size: 11px;
        font-weight: 500;
        padding: 2px 7px;
        border-radius: 6px;
        cursor: pointer;
        transition: border-color 0.15s ease, color 0.15s ease, background-color 0.15s ease, transform 0.1s ease;
      }
      #${WS_VIEW_ID} .ws-col-action:hover {
        border-color: var(--ws-border-strong);
        color: var(--ws-ink);
      }
      #${WS_VIEW_ID} .ws-col-title {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        font-size: 12px;
        font-weight: 600;
        color: var(--ws-ink);
      }
      #${WS_VIEW_ID} .ws-dot {
        width: 7px;
        height: 7px;
        border-radius: 999px;
        flex-shrink: 0;
      }
      #${WS_VIEW_ID} .ws-star-head {
        color: var(--ws-amber);
        flex-shrink: 0;
      }
      #${WS_VIEW_ID} .ws-dot-attention { background: var(--ws-amber); }
      #${WS_VIEW_ID} .ws-dot-attention.is-error-only { background: var(--ws-crimson); }
      #${WS_VIEW_ID} .ws-dot-running {
        background: var(--ws-cobalt);
        animation: agyWsPulse 1.8s ease-in-out infinite;
      }
      #${WS_VIEW_ID} .ws-dot-done { background: var(--ws-emerald); }
      @keyframes agyWsPulse {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.45; transform: scale(0.85); }
      }
      @media (prefers-reduced-motion: reduce) {
        #${WS_VIEW_ID} .ws-dot-running,
        #${WS_VIEW_ID} .ws-state-pill-dot {
          animation: none;
        }
        #${WS_VIEW_ID} .ws-card:hover {
          transform: none;
        }
      }
      #${WS_VIEW_ID} .ws-col-count {
        font-size: 11px;
        font-weight: 600;
        color: var(--ws-muted);
        padding: 1px 7px;
        border-radius: 999px;
        background: var(--ws-surface);
        border: 1px solid var(--ws-border);
      }
      #${WS_VIEW_ID} .ws-col-body {
        padding: 8px;
        display: flex;
        flex-direction: column;
        gap: 7px;
      }
      #${WS_VIEW_ID} .ws-cards-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(min(275px, 100%), 1fr));
        gap: 8px;
      }
      #${WS_VIEW_ID} .ws-card {
        position: relative;
        width: 100%;
        text-align: left;
        display: flex;
        flex-direction: column;
        gap: 7px;
        padding: 10px 11px 10px 12px;
        border-radius: 10px;
        background: var(--ws-surface);
        border: 1px solid var(--ws-border);
        border-left: 3px solid transparent;
        box-shadow: var(--ws-shadow);
        color: var(--ws-ink);
        cursor: pointer;
        box-sizing: border-box;
        transition: border-color 0.15s ease, background-color 0.15s ease, transform 0.15s ease, opacity 0.15s ease;
      }
      #${WS_VIEW_ID} .ws-card:hover {
        border-color: var(--ws-border-strong);
        transform: translateY(-1px);
      }
      #${WS_VIEW_ID} .ws-card.is-waiting {
        border-left-color: var(--ws-amber);
        background: color-mix(in srgb, var(--ws-amber-bg) 38%, var(--ws-surface));
      }
      #${WS_VIEW_ID} .ws-card.is-error {
        border-left-color: var(--ws-crimson);
        background: color-mix(in srgb, var(--ws-crimson-bg) 38%, var(--ws-surface));
      }
      #${WS_VIEW_ID} .ws-card.is-running {
        border-left-color: var(--ws-cobalt);
        background: color-mix(in srgb, var(--ws-cobalt-bg) 35%, var(--ws-surface));
      }
      #${WS_VIEW_ID} .ws-card.is-unread {
        border-left-color: var(--ws-emerald);
        background: color-mix(in srgb, var(--ws-emerald-bg) 28%, var(--ws-surface));
      }
      #${WS_VIEW_ID} .ws-card.is-done {
        border-left-width: 1px;
        border-left-color: var(--ws-border);
      }
      #${WS_VIEW_ID} .ws-card.is-archived {
        opacity: 0.72;
        background: var(--ws-surface-alt);
      }
      #${WS_VIEW_ID} .ws-card.is-archived:hover {
        opacity: 0.96;
      }
      #${WS_VIEW_ID} .ws-card.is-current {
        border-color: var(--ws-cobalt);
      }
      #${WS_VIEW_ID} .ws-card-top {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 8px;
      }
      #${WS_VIEW_ID} .ws-card-title-wrap {
        display: flex;
        align-items: flex-start;
        gap: 5px;
        min-width: 0;
        flex: 1;
      }
      #${WS_VIEW_ID} .ws-card-main {
        appearance: none;
        border: none;
        background: transparent;
        padding: 0;
        margin: 0;
        font: inherit;
        color: inherit;
        text-align: left;
        cursor: pointer;
        width: 100%;
      }
      #${WS_VIEW_ID} .ws-card-main::after {
        content: '';
        position: absolute;
        inset: 0;
        z-index: 1;
        border-radius: 10px;
      }
      #${WS_VIEW_ID} .ws-card.is-renaming .ws-card-main::after {
        display: none;
      }
      #${WS_VIEW_ID} .ws-card-title {
        font-size: 12.5px;
        font-weight: 500;
        line-height: 1.4;
        color: var(--ws-ink);
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
        word-break: break-word;
      }
      #${WS_VIEW_ID} .ws-rename-input {
        position: relative;
        z-index: 3;
        width: 100%;
        height: 24px;
        padding: 0 6px;
        border-radius: 6px;
        border: 1px solid var(--ws-cobalt);
        background: var(--ws-canvas);
        color: var(--ws-ink);
        font-family: inherit;
        font-size: 12.5px;
        font-weight: 500;
        outline: none;
        box-sizing: border-box;
      }
      #${WS_VIEW_ID} .ws-rename-hint {
        position: relative;
        z-index: 3;
        margin-top: 3px;
        font-size: 11px;
        color: var(--ws-muted);
      }
      #${WS_VIEW_ID} .ws-card-right {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        flex-shrink: 0;
      }
      #${WS_VIEW_ID} .ws-card-ops {
        position: relative;
        z-index: 2;
        display: inline-flex;
        align-items: center;
        gap: 2px;
      }
      #${WS_VIEW_ID} .ws-op-btn {
        appearance: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 22px;
        height: 22px;
        padding: 0;
        border: 1px solid transparent;
        border-radius: 5px;
        background: transparent;
        color: var(--ws-muted);
        cursor: pointer;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.12s ease, color 0.12s ease, background-color 0.12s ease, border-color 0.12s ease, transform 0.1s ease;
      }
      #${WS_VIEW_ID} .ws-op-btn.is-star-idle {
        opacity: 0.42;
        pointer-events: auto;
      }
      #${WS_VIEW_ID} .ws-card:hover .ws-op-btn,
      #${WS_VIEW_ID} .ws-card:focus-within .ws-op-btn,
      #${WS_VIEW_ID} .ws-op-btn.is-always {
        opacity: 1;
        pointer-events: auto;
      }
      #${WS_VIEW_ID} .ws-op-btn:hover {
        background: var(--ws-surface-alt);
        border-color: var(--ws-border);
        color: var(--ws-ink);
      }
      #${WS_VIEW_ID} .ws-op-btn.is-starred {
        color: var(--ws-amber);
      }
      #${WS_VIEW_ID} .ws-state-pill {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        flex-shrink: 0;
        font-size: 11px;
        font-weight: 600;
        padding: 1px 6px;
        border-radius: 999px;
        border: 1px solid transparent;
      }
      #${WS_VIEW_ID} .ws-state-pill.tone-waiting {
        background: var(--ws-amber-bg);
        color: var(--ws-amber);
        border-color: color-mix(in srgb, var(--ws-amber) 30%, transparent);
      }
      #${WS_VIEW_ID} .ws-state-pill.tone-error {
        background: var(--ws-crimson-bg);
        color: var(--ws-crimson);
        border-color: color-mix(in srgb, var(--ws-crimson) 30%, transparent);
      }
      #${WS_VIEW_ID} .ws-state-pill.tone-running {
        background: var(--ws-cobalt-bg);
        color: var(--ws-cobalt);
        border-color: color-mix(in srgb, var(--ws-cobalt) 28%, transparent);
      }
      #${WS_VIEW_ID} .ws-state-pill.tone-unread {
        background: var(--ws-emerald-bg);
        color: var(--ws-emerald);
        border-color: color-mix(in srgb, var(--ws-emerald) 30%, transparent);
      }
      #${WS_VIEW_ID} .ws-state-pill.tone-archived {
        background: var(--ws-surface-alt);
        color: var(--ws-muted);
        border-color: var(--ws-border);
      }
      #${WS_VIEW_ID} .ws-state-pill-dot {
        width: 5px;
        height: 5px;
        border-radius: 50%;
        background: currentColor;
        animation: agyWsPulse 1.8s ease-in-out infinite;
      }
      #${WS_VIEW_ID} .ws-current-pill {
        flex-shrink: 0;
        font-size: 11px;
        font-weight: 600;
        padding: 1px 6px;
        border-radius: 999px;
        background: var(--ws-cobalt-bg);
        color: var(--ws-cobalt);
      }
      #${WS_VIEW_ID} .ws-card-meta {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        font-size: 11px;
        color: var(--ws-muted);
      }
      #${WS_VIEW_ID} .ws-card-tags {
        display: inline-flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 5px;
        min-width: 0;
        flex: 1;
      }
      #${WS_VIEW_ID} .ws-tag {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        min-width: 0;
        max-width: 130px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        padding: 1px 6px;
        border-radius: 5px;
        background: var(--ws-surface-alt);
        color: var(--ws-secondary);
        font-size: 11px;
      }
      #${WS_VIEW_ID} .ws-project-tag {
        max-width: 160px;
      }
      #${WS_VIEW_ID} .ws-tag.is-ctx-warn {
        background: var(--ws-amber-bg);
        color: var(--ws-amber);
        font-weight: 600;
      }
      #${WS_VIEW_ID} .ws-tag.is-ctx-crit {
        background: var(--ws-crimson-bg);
        color: var(--ws-crimson);
        font-weight: 600;
      }
      #${WS_VIEW_ID} .ws-group-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      #${WS_VIEW_ID} .ws-group-label {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 4px 4px 1px;
        font-size: 11px;
        font-weight: 600;
        color: var(--ws-muted);
      }
      #${WS_VIEW_ID} .ws-group-label.is-unread {
        color: var(--ws-emerald);
      }
      #${WS_VIEW_ID} .ws-group-toggle {
        appearance: none;
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 6px 10px;
        border-radius: 8px;
        border: 1px dashed var(--ws-border);
        background: transparent;
        color: var(--ws-muted);
        font-size: 11.5px;
        font-weight: 500;
        cursor: pointer;
        text-align: left;
        transition: border-color 0.15s ease, color 0.15s ease, background-color 0.15s ease;
      }
      #${WS_VIEW_ID} .ws-group-toggle:hover {
        border-color: var(--ws-border-strong);
        color: var(--ws-ink);
        background: var(--ws-surface);
      }
      #${WS_VIEW_ID} .ws-group-toggle-left {
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }
      #${WS_VIEW_ID} .ws-center-state {
        margin: 48px auto;
        max-width: 420px;
        padding: 24px 20px;
        border-radius: 10px;
        background: var(--ws-surface);
        border: 1px solid var(--ws-border);
        text-align: center;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 10px;
        color: var(--ws-secondary);
      }
      #${WS_VIEW_ID} .ws-center-state-title {
        font-size: 12.5px;
        font-weight: 600;
        color: var(--ws-ink);
      }
      #${WS_VIEW_ID} .ws-skeleton-grid {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      #${WS_VIEW_ID} .ws-skeleton-col {
        height: 120px;
        border-radius: 10px;
        background: var(--ws-col-bg);
        border: 1px solid var(--ws-border);
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      #${WS_VIEW_ID} .ws-skeleton-bar {
        height: 44px;
        border-radius: 8px;
        background: var(--ws-surface-alt);
        opacity: 0.7;
      }
      #${WS_VIEW_ID} .ws-toast {
        position: absolute;
        left: 50%;
        bottom: 18px;
        transform: translateX(-50%);
        z-index: 70;
        display: inline-flex;
        align-items: center;
        gap: 10px;
        padding: 8px 12px;
        border-radius: 8px;
        background: var(--ws-surface);
        border: 1px solid var(--ws-border-strong);
        box-shadow: var(--ws-pop-shadow);
        color: var(--ws-ink);
        font-size: 12px;
      }
      #${WS_VIEW_ID} .ws-toast[hidden] {
        display: none;
      }
      #${WS_VIEW_ID} .ws-toast.is-error {
        border-color: color-mix(in srgb, var(--ws-crimson) 45%, transparent);
        color: var(--ws-crimson);
      }
      #${WS_VIEW_ID} .ws-toast-btn {
        appearance: none;
        border: 1px solid var(--ws-border);
        background: var(--ws-surface-alt);
        color: var(--ws-cobalt);
        font-size: 11.5px;
        font-weight: 600;
        padding: 2px 8px;
        border-radius: 6px;
        cursor: pointer;
      }
      #${WS_VIEW_ID} .ws-toast-btn:hover {
        border-color: var(--ws-cobalt);
      }
    `;
    document.head.appendChild(style);
  }

  function formatRelativeTime(iso) {
    if (!iso) return '';
    const ts = Date.parse(iso);
    if (!Number.isFinite(ts)) return '';
    const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (diffSec < 60) return '刚刚';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}分钟前`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour}小时前`;
    const diffDay = Math.floor(diffHour / 24);
    if (diffDay === 1) return '昨天';
    if (diffDay < 7) return `${diffDay}天前`;
    const d = new Date(ts);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }

  function escapeHtml(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function findSidebarMenuAnchor() {
    const customLink = document.querySelector('a[href="/customizations"]');
    if (customLink && customLink.parentElement) {
      return { list: customLink.parentElement, refNode: customLink };
    }
    const candidates = Array.from(document.querySelectorAll('a, button'));
    const fallback = candidates.find((el) => {
      const t = (el.innerText || '').trim();
      return t === '自定义' || t === 'Customizations';
    });
    if (fallback && fallback.parentElement) {
      return { list: fallback.parentElement, refNode: fallback };
    }
    return null;
  }

  function findWorkspaceMainPane() {
    const anchor = findSidebarMenuAnchor();
    if (!anchor) return null;
    let el = anchor.list;
    while (el && el.parentElement) {
      if (String(el.parentElement.className || '').includes('relative flex w-full h-full outline-none')) {
        const siblings = Array.from(el.parentElement.children);
        return siblings[siblings.length - 1] || null;
      }
      el = el.parentElement;
    }
    return null;
  }

  function navigateToConversation(cid) {
    if (!cid) return;
    markConversationSeen(cid);
    setWorkspaceOpen(false);
    const link = document.querySelector(`a[href*="/c/${cid}"]`);
    if (link) {
      link.click();
      return;
    }
    const url = new URL(location.href);
    const nextPath = `/c/${cid}${url.search}`;
    try {
      history.pushState({}, '', nextPath);
      window.dispatchEvent(new PopStateEvent('popstate'));
    } catch {
      location.href = nextPath;
    }
  }

  function triggerNewConversation() {
    setWorkspaceOpen(false);
    const newBtn = document.querySelector('a[href="/"]');
    if (newBtn) newBtn.click();
  }

  function collectSidebarProjects() {
    const view = document.getElementById(WS_VIEW_ID);
    const seen = new Map(); // projectId -> { id, name, href, aria }
    const anchors = Array.from(document.querySelectorAll('a[href]'));
    for (const a of anchors) {
      if (view && view.contains(a)) continue;
      const href = a.getAttribute('href') || '';
      if (!href.startsWith('/?project=')) continue;
      let projectId = '';
      try {
        projectId = new URL(href, location.origin).searchParams.get('project') || '';
      } catch {
        continue;
      }
      if (!projectId) continue;

      const aria = a.getAttribute('aria-label') || '';
      const isNewChatLink = !/^Project:/i.test(aria);
      let name = '';
      const p2 = a.parentElement?.parentElement;
      if (p2) {
        const lines = (p2.innerText || '')
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter((s) => s && s !== '/');
        if (lines.length > 0) name = lines[0];
      }
      if (!name && /^Project:\s*/i.test(aria)) {
        name = aria.replace(/^Project:\s*/i, '').trim();
      }
      if (!name) name = projectId;

      const existing = seen.get(projectId);
      if (!existing) {
        seen.set(projectId, { id: projectId, name, href, isNewChatLink });
      } else {
        if (isNewChatLink && !existing.isNewChatLink) {
          existing.href = href;
          existing.isNewChatLink = true;
        }
        if (existing.name === projectId && name !== projectId) {
          existing.name = name;
        }
      }
    }
    return Array.from(seen.values());
  }

  function triggerNewConversationInProject(projectId, href) {
    setWorkspaceOpen(false);
    const view = document.getElementById(WS_VIEW_ID);
    const anchors = Array.from(document.querySelectorAll('a[href]')).filter((a) => {
      if (view && view.contains(a)) return false;
      const h = a.getAttribute('href') || '';
      if (!h.startsWith('/?project=')) return false;
      try {
        return new URL(h, location.origin).searchParams.get('project') === projectId;
      } catch {
        return false;
      }
    });
    const preferred = anchors.find((a) => !/^Project:/i.test(a.getAttribute('aria-label') || '')) || anchors[0];
    if (preferred) {
      preferred.click();
      return;
    }
    const targetHref = href || `/?project=${encodeURIComponent(projectId)}`;
    try {
      history.pushState({}, '', targetHref);
      window.dispatchEvent(new PopStateEvent('popstate'));
    } catch {
      location.href = targetHref;
    }
  }

  function hideWsToast() {
    if (wsToastTimer) {
      clearTimeout(wsToastTimer);
      wsToastTimer = null;
    }
    const toast = document.querySelector(`#${WS_VIEW_ID} [data-role="ws-toast"]`);
    if (toast) {
      toast.hidden = true;
      toast.classList.remove('is-error');
      toast.innerHTML = '';
    }
  }

  function showWsToast(message, options = {}) {
    const view = document.getElementById(WS_VIEW_ID);
    const toast = view?.querySelector('[data-role="ws-toast"]');
    if (!toast) return;
    if (wsToastTimer) {
      clearTimeout(wsToastTimer);
      wsToastTimer = null;
    }
    toast.classList.toggle('is-error', options.tone === 'error');
    const undoHtml = options.undoLabel
      ? `<button type="button" class="ws-toast-btn" data-action="toast-undo">${escapeHtml(options.undoLabel)}</button>`
      : '';
    toast.innerHTML = `<span>${escapeHtml(message)}</span>${undoHtml}`;
    toast.hidden = false;

    const undoBtn = toast.querySelector('[data-action="toast-undo"]');
    if (undoBtn && typeof options.onUndo === 'function') {
      undoBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        hideWsToast();
        options.onUndo();
      });
    }

    const duration = options.durationMs ?? 5000;
    wsToastTimer = setTimeout(() => {
      hideWsToast();
    }, duration);
  }

  function renderProjectPopoverList(view) {
    const listEl = view?.querySelector('[data-role="ws-project-list"]');
    if (!listEl) return;
    const projects = collectSidebarProjects();
    let currentProjectId = '';
    try {
      currentProjectId = new URL(location.href).searchParams.get('project') || '';
    } catch {}
    const q = wsProjectFilter.trim().toLowerCase();
    const sorted = projects.slice().sort((a, b) => {
      if (a.id === currentProjectId && b.id !== currentProjectId) return -1;
      if (b.id === currentProjectId && a.id !== currentProjectId) return 1;
      return 0;
    });
    const matched = q
      ? sorted.filter((p) => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q))
      : sorted;

    if (!matched.length) {
      listEl.innerHTML = '<div style="padding:10px 8px;text-align:center;font-size:11.5px;color:var(--ws-muted);">无匹配项目</div>';
      return;
    }

    listEl.innerHTML = matched
      .map(
        (p) => `
          <button type="button" class="ws-project-item" role="menuitem" data-project-id="${escapeHtml(p.id)}" data-project-href="${escapeHtml(p.href)}">
            <span class="ws-project-item-name">${escapeHtml(p.name)}</span>
            ${p.id === currentProjectId ? '<span class="ws-project-item-badge">当前</span>' : ''}
          </button>
        `,
      )
      .join('');

    listEl.querySelectorAll('.ws-project-item').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        setProjectMenuOpen(false);
        const pid = btn.dataset.projectId || '';
        const href = btn.dataset.projectHref || '';
        if (pid) triggerNewConversationInProject(pid, href);
      });
    });
  }

  function setProjectMenuOpen(next) {
    const view = document.getElementById(WS_VIEW_ID);
    const pop = view?.querySelector('[data-role="ws-project-popover"]');
    const trigger = view?.querySelector('[data-action="new-menu"]');
    wsProjectMenuOpen = Boolean(next);
    if (trigger) trigger.setAttribute('aria-expanded', String(wsProjectMenuOpen));
    if (!pop) return;
    pop.hidden = !wsProjectMenuOpen;
    if (wsProjectMenuOpen) {
      wsProjectFilter = '';
      const filterInput = pop.querySelector('.ws-project-filter');
      if (filterInput) filterInput.value = '';
      renderProjectPopoverList(view);
      requestAnimationFrame(() => filterInput?.focus());
    }
  }

  function buildWsShell(view) {
    view.innerHTML = `
      <div class="ws-topbar">
        <div class="ws-topbar-left">
          <h2 class="ws-heading">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <rect x="3" y="3" width="7" height="7" rx="1"></rect>
              <rect x="14" y="3" width="7" height="7" rx="1"></rect>
              <rect x="14" y="14" width="7" height="7" rx="1"></rect>
              <rect x="3" y="14" width="7" height="7" rx="1"></rect>
            </svg>
            <span>会话看板</span>
          </h2>
          <div class="ws-seg" role="group" aria-label="会话范围">
            <button type="button" class="ws-seg-btn" data-scope="workspace" aria-pressed="${wsScope === 'workspace'}">当前项目</button>
            <button type="button" class="ws-seg-btn" data-scope="all" aria-pressed="${wsScope === 'all'}">全部项目</button>
          </div>
          <label class="ws-search-wrap">
            <svg class="ws-search-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
            <input class="ws-search" type="search" placeholder="筛选会话、分支或项目 (按 / 聚焦)" aria-label="筛选会话">
          </label>
        </div>
        <div class="ws-topbar-right">
          <span class="ws-total num" data-role="ws-total"></span>
          <div class="ws-split-wrap">
            <button class="ws-btn ws-btn-primary ws-split-main" data-action="new" type="button">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
              <span>新建对话</span>
            </button>
            <button class="ws-split-trigger" data-action="new-menu" type="button" aria-haspopup="menu" aria-expanded="false" aria-label="选择项目新建对话" title="选择项目新建对话">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
            </button>
            <div class="ws-project-popover" data-role="ws-project-popover" role="menu" aria-label="选择项目新建对话" hidden>
              <input class="ws-project-filter" type="search" placeholder="搜索项目名…" aria-label="搜索项目名">
              <div class="ws-project-list" data-role="ws-project-list"></div>
            </div>
          </div>
          <button class="ws-btn" data-action="close" type="button">返回对话</button>
        </div>
      </div>
      <div class="ws-board-scroll" data-role="ws-scroll">
        <div class="ws-scope-notice" data-role="ws-scope-notice" hidden></div>
        <div class="ws-empty-lanes-strip" data-role="ws-empty-strip" hidden></div>
        <div class="ws-board" data-role="ws-board"></div>
      </div>
      <div class="ws-toast" data-role="ws-toast" role="status" aria-live="polite" hidden></div>
    `;

    view.querySelectorAll('.ws-seg-btn[data-scope]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const nextScope = btn.dataset.scope === 'all' ? 'all' : 'workspace';
        if (wsScope === nextScope) return;
        wsScope = nextScope;
        view.querySelectorAll('.ws-seg-btn[data-scope]').forEach((b) => {
          b.setAttribute('aria-pressed', String(b.dataset.scope === wsScope));
        });
        wsLastRenderKey = '';
        renderWorkspaceBoard();
      });
    });

    const searchInput = view.querySelector('.ws-search');
    if (searchInput) {
      searchInput.value = wsQuery;
      searchInput.addEventListener('input', () => {
        wsQuery = searchInput.value || '';
        wsLastRenderKey = '';
        renderWorkspaceBoard();
      });
    }

    const projectFilterInput = view.querySelector('.ws-project-filter');
    if (projectFilterInput) {
      projectFilterInput.addEventListener('input', () => {
        wsProjectFilter = projectFilterInput.value || '';
        renderProjectPopoverList(view);
      });
    }

    view.querySelector('[data-action="new"]')?.addEventListener('click', triggerNewConversation);
    view.querySelector('[data-action="new-menu"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      setProjectMenuOpen(!wsProjectMenuOpen);
    });
    view.querySelector('[data-action="close"]')?.addEventListener('click', () => setWorkspaceOpen(false));
    view.addEventListener('click', (e) => {
      if (wsProjectMenuOpen && e.target instanceof Element && !e.target.closest('.ws-split-wrap')) {
        setProjectMenuOpen(false);
      }
    });
  }

  const wsPendingActions = new Map(); // cid -> { until, patch }

  function sendBoardAction(payload) {
    if (typeof window.__agyCtxSetBoardStatus !== 'function') {
      showWsToast('本地连接未就绪，操作未能同步', { tone: 'error' });
      return false;
    }
    try {
      window.__agyCtxSetBoardStatus(JSON.stringify(payload));
      return true;
    } catch {
      showWsToast('操作发送失败，稍后将恢复原状态', { tone: 'error' });
      return false;
    }
  }

  window.__agyCtxBoardActionError = (msg) => {
    showWsToast(msg || '操作同步失败，已恢复原状态', { tone: 'error' });
  };

  function applyPendingActionsToData(boardData) {
    if (!boardData || !Array.isArray(boardData.conversations) || wsPendingActions.size === 0) return;
    const now = Date.now();
    for (const [cid, entry] of wsPendingActions.entries()) {
      if (now > entry.until) {
        wsPendingActions.delete(cid);
        continue;
      }
      const item = boardData.conversations.find((c) => c.id === cid);
      if (!item) continue;
      Object.assign(item, entry.patch);
    }
  }

  function setPendingPatch(cid, patch) {
    const prev = wsPendingActions.get(cid);
    wsPendingActions.set(cid, {
      until: Date.now() + 2500,
      patch: { ...(prev?.patch || {}), ...patch },
    });
  }

  function performBoardAction(payload) {
    if (!payload || typeof payload !== 'object') return;
    const action = payload.action || '';
    if ((action === 'archive_batch' || action === 'unarchive_batch') && Array.isArray(payload.ids)) {
      const idSet = new Set(payload.ids);
      const nowIso = new Date().toISOString();
      const toArchived = action === 'archive_batch';
      if (Array.isArray(wsBoardData?.conversations)) {
        for (const item of wsBoardData.conversations) {
          if (!idSet.has(item.id)) continue;
          if (toArchived) {
            item.archived = true;
            item.isUnread = false;
            item.seenAt = nowIso;
            setPendingPatch(item.id, { archived: true, isUnread: false, seenAt: nowIso });
          } else {
            item.archived = false;
            setPendingPatch(item.id, { archived: false });
          }
        }
      }
      wsLastRenderKey = '';
      renderWorkspaceBoard();
      updateWorkspaceMenuBadge();
      const ok = sendBoardAction(payload);
      if (ok && toArchived && payload.ids.length > 0 && !payload.silentToast) {
        const undoIds = payload.ids.slice();
        showWsToast(`已归档 ${undoIds.length} 条已读会话`, {
          undoLabel: '撤销',
          onUndo: () => performBoardAction({ action: 'unarchive_batch', ids: undoIds, silentToast: true }),
        });
      }
      return;
    }

    const cid = payload.id;
    if (!cid) return;
    const target = Array.isArray(wsBoardData?.conversations)
      ? wsBoardData.conversations.find((c) => c.id === cid)
      : null;

    if (action === 'star') {
      const next = Boolean(payload.value);
      if (target) target.starred = next;
      setPendingPatch(cid, { starred: next });
    } else if (action === 'archive') {
      const next = Boolean(payload.value);
      const nowIso = new Date().toISOString();
      const patch = next
        ? { archived: true, isUnread: false, seenAt: nowIso }
        : { archived: false };
      if (target) Object.assign(target, patch);
      setPendingPatch(cid, patch);
    } else if (action === 'seen') {
      const nowIso = new Date().toISOString();
      const patch = { isUnread: false, seenAt: nowIso };
      if (target) Object.assign(target, patch);
      setPendingPatch(cid, patch);
    } else if (action === 'rename') {
      const nextTitle = typeof payload.title === 'string' ? payload.title.trim() : '';
      if (nextTitle) {
        const patch = { summary: nextTitle };
        if (target) Object.assign(target, patch);
        setPendingPatch(cid, patch);
      }
    }

    wsLastRenderKey = '';
    renderWorkspaceBoard();
    updateWorkspaceMenuBadge();
    const ok = sendBoardAction(payload);
    if (ok && action === 'archive' && payload.value === true && !payload.silentToast) {
      showWsToast('已归档该会话', {
        undoLabel: '撤销',
        onUndo: () => performBoardAction({ action: 'archive', id: cid, value: false, silentToast: true }),
      });
    }
  }

  function markConversationSeen(cid) {
    if (!cid || !Array.isArray(wsBoardData?.conversations)) return;
    const target = wsBoardData.conversations.find((c) => c.id === cid);
    if (!target) return;
    if (target.isUnread || (target.boardStatus === 'idle' && !target.seenAt)) {
      performBoardAction({ action: 'seen', id: cid });
    }
  }

  function getScopedBoardItems(q) {
    const list = Array.isArray(wsBoardData?.conversations) ? wsBoardData.conversations : [];
    const hasCurrentWs = list.some((i) => i.isCurrentWorkspace);
    let fallbackReason = '';
    if (wsScope === 'workspace') {
      if (q && hasCurrentWs) fallbackReason = 'search';
      else if (!hasCurrentWs && list.length > 0) fallbackReason = 'empty-workspace';
    }
    const useWorkspaceScope = wsScope === 'workspace' && hasCurrentWs && !q;
    const items = list.filter((item) => {
      if (useWorkspaceScope && !item.isCurrentWorkspace) return false;
      if (!q) return true;
      return (
        String(item.summary || '').toLowerCase().includes(q) ||
        String(item.branchName || '').toLowerCase().includes(q) ||
        String(item.workspaceName || '').toLowerCase().includes(q) ||
        String(item.id || '').toLowerCase().includes(q)
      );
    });
    return { items, fallbackReason };
  }

  function computeBoardRenderKey(filtered, q, currentCid, fallbackReason, loadingElapsed) {
    const stateTag = wsBoardData === null ? (loadingElapsed ? 'timeout' : 'loading') : wsBoardData?.error ? 'error' : 'ready';
    return JSON.stringify([
      stateTag,
      q,
      wsScope,
      fallbackReason,
      currentCid,
      Array.from(wsExpandedGroups).sort(),
      filtered.map((i) => {
        const m = metricsByCid.get(i.id);
        const pct = typeof m?.context?.pct === 'number' ? m.context.pct : '';
        return `${i.id}:${i.summary}:${i.boardStatus}:${i.starred ? 1 : 0}:${i.archived ? 1 : 0}:${i.isUnread ? 1 : 0}:${i.subagentCount}:${i.lastModifiedTime}:${pct}`;
      }),
    ]);
  }

  function sortBoardCards(items) {
    return items.slice().sort((a, b) => {
      if (Boolean(a.starred) !== Boolean(b.starred)) return a.starred ? -1 : 1;
      return (b.lastModifiedTime || '').localeCompare(a.lastModifiedTime || '');
    });
  }

  function getTodayStartMs() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  function updateWorkspaceMenuBadge() {
    const menu = document.getElementById(WS_MENU_ID);
    if (!menu) return;
    menu.classList.toggle('agy-light', isLightSurface());
    const badge = menu.querySelector('.ws-menu-badge');
    if (!badge) return;
    const list = Array.isArray(wsBoardData?.conversations) ? wsBoardData.conversations : [];
    const currentCid = getCurrentCid();
    const hasCurrentWs = list.some((i) => i.isCurrentWorkspace);
    const scoped = hasCurrentWs ? list.filter((i) => i.isCurrentWorkspace) : list;
    let attentionCount = 0;
    let unreadCount = 0;
    for (const item of scoped) {
      if (item.boardStatus === 'waiting' || item.boardStatus === 'error') {
        attentionCount += 1;
      } else if (item.boardStatus === 'idle' && !item.archived && item.isUnread && item.id !== currentCid) {
        unreadCount += 1;
      }
    }
    const total = attentionCount + unreadCount;
    badge.classList.remove('is-visible', 'is-warn', 'is-unread');
    if (total <= 0) {
      badge.textContent = '';
      menu.setAttribute('aria-label', '会话看板');
      return;
    }
    badge.textContent = total > 99 ? '99+' : String(total);
    badge.classList.add('is-visible', attentionCount > 0 ? 'is-warn' : 'is-unread');
    menu.setAttribute('aria-label', `会话看板，${total} 条待处理或未读`);
  }

  function renderWorkspaceBoard() {
    const view = document.getElementById(WS_VIEW_ID);
    if (!view || !wsOpen || wsEditingCid) return;
    view.classList.toggle('agy-light', isLightSurface());

    if (!view.querySelector('[data-role="ws-board"]')) {
      buildWsShell(view);
    }

    const currentCid = getCurrentCid();
    const q = wsQuery.trim().toLowerCase();
    const { items: filtered, fallbackReason } = getScopedBoardItems(q);
    const loadingElapsed = wsBoardData === null && wsBoardOpenedAt > 0 && Date.now() - wsBoardOpenedAt >= 4000;

    const renderKey = computeBoardRenderKey(filtered, q, currentCid, fallbackReason, loadingElapsed);
    if (renderKey === wsLastRenderKey) return;
    wsLastRenderKey = renderKey;

    const noticeEl = view.querySelector('[data-role="ws-scope-notice"]');
    const stripEl = view.querySelector('[data-role="ws-empty-strip"]');
    const boardEl = view.querySelector('[data-role="ws-board"]');
    const totalEl = view.querySelector('[data-role="ws-total"]');
    if (!boardEl) return;

    if (wsBoardData === null) {
      if (noticeEl) noticeEl.hidden = true;
      if (stripEl) stripEl.hidden = true;
      if (totalEl) totalEl.textContent = '加载中…';
      if (loadingElapsed) {
        boardEl.innerHTML = `
          <div class="ws-center-state">
            <div class="ws-center-state-title">暂未收到本地会话数据</div>
            <div>请确认 Antigravity 后台语言服务正常运行，稍后会自动同步。</div>
          </div>
        `;
      } else {
        boardEl.innerHTML = `
          <div class="ws-skeleton-grid" aria-label="正在加载会话看板">
            <div class="ws-skeleton-col"><div class="ws-skeleton-bar"></div><div class="ws-skeleton-bar"></div></div>
            <div class="ws-skeleton-col"><div class="ws-skeleton-bar"></div><div class="ws-skeleton-bar"></div></div>
          </div>
        `;
      }
      return;
    }

    if (wsBoardData?.error) {
      if (noticeEl) noticeEl.hidden = true;
      if (stripEl) stripEl.hidden = true;
      if (totalEl) totalEl.textContent = '';
      boardEl.innerHTML = `
        <div class="ws-center-state">
          <div class="ws-center-state-title">会话数据读取失败</div>
          <div>${escapeHtml(wsBoardData.message || wsBoardData.error)}</div>
        </div>
      `;
      return;
    }

    if (noticeEl) {
      if (fallbackReason === 'search') {
        noticeEl.hidden = false;
        noticeEl.innerHTML = `
          <span>当前搜索已自动覆盖全部项目中的会话</span>
          <button type="button" class="ws-notice-btn" data-action="clear-search">清空搜索</button>
        `;
      } else if (fallbackReason === 'empty-workspace') {
        noticeEl.hidden = false;
        noticeEl.innerHTML = `
          <span>未匹配到当前项目会话，已展示全部项目</span>
          <button type="button" class="ws-notice-btn" data-action="switch-all">切换至全部项目</button>
        `;
      } else {
        noticeEl.hidden = true;
        noticeEl.innerHTML = '';
      }
      noticeEl.querySelector('[data-action="clear-search"]')?.addEventListener('click', () => {
        wsQuery = '';
        const input = view.querySelector('.ws-search');
        if (input) input.value = '';
        wsLastRenderKey = '';
        renderWorkspaceBoard();
      });
      noticeEl.querySelector('[data-action="switch-all"]')?.addEventListener('click', () => {
        wsScope = 'all';
        view.querySelectorAll('.ws-seg-btn[data-scope]').forEach((b) => {
          b.setAttribute('aria-pressed', String(b.dataset.scope === 'all'));
        });
        wsLastRenderKey = '';
        renderWorkspaceBoard();
      });
    }

    const starredItems = [];
    const attentionItems = [];
    const runningItems = [];
    const doneItems = [];

    for (const item of filtered) {
      if (item.starred && !item.archived) {
        starredItems.push(item);
      } else if (item.boardStatus === 'waiting' || item.boardStatus === 'error') {
        attentionItems.push(item);
      } else if (item.boardStatus === 'running') {
        runningItems.push(item);
      } else {
        doneItems.push(item);
      }
    }

    const sortedStarred = starredItems.slice().sort((a, b) => {
      const rank = (x) => {
        if (x.boardStatus === 'waiting' || x.boardStatus === 'error') return 0;
        if (x.boardStatus === 'running') return 1;
        if (x.boardStatus === 'idle' && x.isUnread && x.id !== currentCid) return 2;
        return 3;
      };
      const ra = rank(a);
      const rb = rank(b);
      if (ra !== rb) return ra - rb;
      return (b.lastModifiedTime || '').localeCompare(a.lastModifiedTime || '');
    });
    const sortedAttention = sortBoardCards(attentionItems);
    const sortedRunning = sortBoardCards(runningItems);

    const todayStartMs = getTodayStartMs();
    const sevenDaysAgoMs = todayStartMs - 6 * 24 * 60 * 60 * 1000;

    const doneGroups = {
      unread: [],
      today: [],
      week: [],
      older: [],
      archived: [],
    };
    const batchArchivableIds = [];

    for (const item of doneItems) {
      const isCurrent = currentCid && item.id === currentCid;
      if (item.archived) {
        doneGroups.archived.push(item);
        continue;
      }
      if (item.isUnread && !isCurrent) {
        doneGroups.unread.push(item);
        continue;
      }
      if (!item.starred && !isCurrent) {
        batchArchivableIds.push(item.id);
      }
      const ts = item.lastModifiedTime ? Date.parse(item.lastModifiedTime) : 0;
      if (item.starred || isCurrent || (Number.isFinite(ts) && ts >= todayStartMs)) {
        doneGroups.today.push(item);
      } else if (Number.isFinite(ts) && ts >= sevenDaysAgoMs) {
        doneGroups.week.push(item);
      } else {
        doneGroups.older.push(item);
      }
    }

    for (const key of Object.keys(doneGroups)) {
      doneGroups[key] = sortBoardCards(doneGroups[key]);
    }

    if (totalEl) {
      const activeDoneCount = doneItems.length - doneGroups.archived.length;
      const parts = [];
      if (sortedStarred.length > 0) parts.push(`关注 ${sortedStarred.length}`);
      if (sortedAttention.length > 0) parts.push(`需处理 ${sortedAttention.length}`);
      if (sortedRunning.length > 0) parts.push(`进行中 ${sortedRunning.length}`);
      parts.push(`共 ${sortedStarred.length + sortedAttention.length + sortedRunning.length + activeDoneCount}`);
      totalEl.textContent = parts.join(' · ');
    }

    if (q && filtered.length === 0) {
      if (stripEl) stripEl.hidden = true;
      boardEl.innerHTML = `
        <div class="ws-center-state">
          <div class="ws-center-state-title">未找到包含“${escapeHtml(wsQuery.trim())}”的会话</div>
          <div>可以尝试搜索项目名、分支名或清空筛选条件。</div>
          <button type="button" class="ws-btn" data-action="clear-search-empty">清空筛选</button>
        </div>
      `;
      boardEl.querySelector('[data-action="clear-search-empty"]')?.addEventListener('click', () => {
        wsQuery = '';
        const input = view.querySelector('.ws-search');
        if (input) input.value = '';
        wsLastRenderKey = '';
        renderWorkspaceBoard();
      });
      return;
    }

    if (!q && filtered.length === 0) {
      if (stripEl) stripEl.hidden = true;
      boardEl.innerHTML = `
        <div class="ws-center-state">
          <div class="ws-center-state-title">暂无会话记录</div>
          <div>点击右上角或下方按钮即可发起新的对话。</div>
          <button type="button" class="ws-btn ws-btn-primary" data-action="empty-new">新建对话</button>
        </div>
      `;
      boardEl.querySelector('[data-action="empty-new"]')?.addEventListener('click', triggerNewConversation);
      return;
    }

    function renderCardHtml(item, laneKey) {
      const isCurrent = currentCid && item.id === currentCid;
      const isIdle = item.boardStatus === 'idle';
      const isUnread = isIdle && !item.archived && item.isUnread && !isCurrent;
      const timeLabel = formatRelativeTime(item.lastModifiedTime);

      let cardToneClass = 'is-done';
      let pillHtml = '';
      if (item.boardStatus === 'waiting') {
        cardToneClass = 'is-waiting';
        pillHtml = '<span class="ws-state-pill tone-waiting">待确认</span>';
      } else if (item.boardStatus === 'error') {
        cardToneClass = 'is-error';
        pillHtml = '<span class="ws-state-pill tone-error">异常</span>';
      } else if (item.boardStatus === 'running') {
        cardToneClass = 'is-running';
        pillHtml = '<span class="ws-state-pill tone-running"><span class="ws-state-pill-dot" aria-hidden="true"></span><span>进行中</span></span>';
      } else if (item.archived) {
        cardToneClass = 'is-archived';
        pillHtml = '<span class="ws-state-pill tone-archived">已归档</span>';
      } else if (isUnread) {
        cardToneClass = 'is-unread';
        pillHtml = '<span class="ws-state-pill tone-unread">新完成</span>';
      }

      const tagParts = [];
      const cachedMetric = metricsByCid.get(item.id);
      const ctxPct = typeof cachedMetric?.context?.pct === 'number' ? Math.round(cachedMetric.context.pct) : null;
      if (ctxPct !== null) {
        const ctxCls = ctxPct >= 90 ? 'is-ctx-crit' : ctxPct >= 75 ? 'is-ctx-warn' : '';
        tagParts.push(`<span class="ws-tag num ${ctxCls}" title="上下文窗口占用 ${ctxPct}%">上下文 ${ctxPct}%</span>`);
      }
      if (item.workspaceName) {
        tagParts.push(
          `<span class="ws-tag ws-project-tag" title="项目：${escapeHtml(item.workspaceName)}"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0;" aria-hidden="true"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg><span class="truncate">${escapeHtml(item.workspaceName)}</span></span>`,
        );
      }
      if (item.branchName) {
        tagParts.push(
          `<span class="ws-tag" title="${escapeHtml(item.branchName)}"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0;" aria-hidden="true"><line x1="6" y1="3" x2="6" y2="15"></line><circle cx="18" cy="6" r="3"></circle><circle cx="6" cy="18" r="3"></circle><path d="M18 9a9 9 0 0 1-9 9"></path></svg><span class="truncate">${escapeHtml(item.branchName)}</span></span>`,
        );
      }
      if (item.subagentCount > 0) {
        tagParts.push(`<span class="ws-tag num">${item.subagentCount} 子代理</span>`);
      }

      const starBtnHtml = `
        <button type="button" class="ws-op-btn ${item.starred ? 'is-starred is-always' : 'is-star-idle'}" data-op="star" data-cid="${escapeHtml(item.id)}" data-next="${item.starred ? '0' : '1'}" aria-label="${item.starred ? '取消关注' : '关注此会话'}" title="${item.starred ? '取消关注' : '关注置顶'}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="${item.starred ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
          </svg>
        </button>
      `;

      let doneOpsHtml = '';
      if (laneKey === 'done' || (laneKey === 'starred' && isIdle)) {
        if (isUnread) {
          doneOpsHtml += `
            <button type="button" class="ws-op-btn" data-op="seen" data-cid="${escapeHtml(item.id)}" aria-label="标为已读" title="标为已读">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                <circle cx="12" cy="12" r="3"></circle>
              </svg>
            </button>
          `;
        }
        if (item.archived) {
          doneOpsHtml += `
            <button type="button" class="ws-op-btn" data-op="unarchive" data-cid="${escapeHtml(item.id)}" aria-label="移出归档" title="移出归档">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <polyline points="9 14 4 9 9 4"></polyline>
                <path d="M20 20v-7a4 4 0 0 0-4-4H4"></path>
              </svg>
            </button>
          `;
        } else {
          doneOpsHtml += `
            <button type="button" class="ws-op-btn" data-op="archive" data-cid="${escapeHtml(item.id)}" aria-label="归档会话" title="归档此会话">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <polyline points="21 8 21 21 3 21 3 8"></polyline>
                <rect x="1" y="3" width="22" height="5"></rect>
                <line x1="10" y1="12" x2="14" y2="12"></line>
              </svg>
            </button>
          `;
        }
      }

      const renameBtnHtml = `
        <button type="button" class="ws-op-btn" data-op="rename" data-cid="${escapeHtml(item.id)}" aria-label="重命名会话" title="重命名会话">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 20h9"></path>
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
          </svg>
        </button>
      `;

      return `
        <article class="ws-card ${cardToneClass} ${isCurrent ? 'is-current' : ''}" data-cid="${escapeHtml(item.id)}" data-col="${escapeHtml(laneKey)}" title="${escapeHtml(item.summary)}">
          <div class="ws-card-top">
            <div class="ws-card-title-wrap">
              <button type="button" class="ws-card-main" data-cid="${escapeHtml(item.id)}">
                <span class="ws-card-title">${escapeHtml(item.summary)}</span>
              </button>
            </div>
            <div class="ws-card-right">
              <div class="ws-card-ops">
                ${renameBtnHtml}
                ${doneOpsHtml}
                ${starBtnHtml}
              </div>
              ${isCurrent ? '<span class="ws-current-pill">当前</span>' : ''}
              ${pillHtml}
            </div>
          </div>
          <div class="ws-card-meta">
            <div class="ws-card-tags">${tagParts.join('')}</div>
            <span class="num">${escapeHtml(timeLabel)}</span>
          </div>
        </article>
      `;
    }

    function renderCollapsibleGroup(groupKey, label, items) {
      if (!items.length) return '';
      const expanded = wsExpandedGroups.has(groupKey);
      const restoreBtn = groupKey === 'archived' && expanded
        ? '<button type="button" class="ws-col-action" data-action="unarchive-all">全部恢复</button>'
        : '';
      const header = `
        <div class="ws-group-head">
          <button type="button" class="ws-group-toggle" data-group="${groupKey}" aria-expanded="${expanded}">
            <span class="ws-group-toggle-left">
              <span>${expanded ? '▾' : '▸'}</span>
              <span>${label}</span>
            </span>
            <span class="num">${items.length}</span>
          </button>
          ${restoreBtn}
        </div>
      `;
      if (!expanded) return header;
      return `${header}<div class="ws-cards-grid">${items.map((item) => renderCardHtml(item, 'done')).join('')}</div>`;
    }

    function renderDoneBodyHtml() {
      if (!doneItems.length) {
        return '';
      }
      if (q) {
        return `<div class="ws-cards-grid">${sortBoardCards(doneItems).map((item) => renderCardHtml(item, 'done')).join('')}</div>`;
      }
      const chunks = [];
      if (doneGroups.unread.length) {
        chunks.push(`<div class="ws-group-label is-unread"><span>待验收</span><span class="num">${doneGroups.unread.length}</span></div>`);
        chunks.push(`<div class="ws-cards-grid">${doneGroups.unread.map((item) => renderCardHtml(item, 'done')).join('')}</div>`);
      }
      if (doneGroups.today.length) {
        if (doneGroups.unread.length) {
          chunks.push(`<div class="ws-group-label"><span>今天</span><span class="num">${doneGroups.today.length}</span></div>`);
        }
        chunks.push(`<div class="ws-cards-grid">${doneGroups.today.map((item) => renderCardHtml(item, 'done')).join('')}</div>`);
      }
      chunks.push(renderCollapsibleGroup('week', '近 7 天', doneGroups.week));
      chunks.push(renderCollapsibleGroup('older', '更早', doneGroups.older));
      chunks.push(renderCollapsibleGroup('archived', '已归档', doneGroups.archived));
      return chunks.filter(Boolean).join('');
    }

    const hasWaiting = sortedAttention.some((i) => i.boardStatus === 'waiting');
    const hasError = sortedAttention.some((i) => i.boardStatus === 'error');
    const attentionDotClass = hasError && !hasWaiting ? 'ws-dot ws-dot-attention is-error-only' : 'ws-dot ws-dot-attention';
    const starHeadIconHtml = '<svg class="ws-star-head" width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>';

    const laneHtmlMap = {
      starred: {
        iconHtml: starHeadIconHtml,
        count: sortedStarred.length,
        totalCount: sortedStarred.length,
        headAction: '',
        bodyHtml: `<div class="ws-cards-grid">${sortedStarred.map((item) => renderCardHtml(item, 'starred')).join('')}</div>`,
      },
      attention: {
        iconHtml: `<span class="${attentionDotClass}" aria-hidden="true"></span>`,
        count: sortedAttention.length,
        totalCount: sortedAttention.length,
        headAction: '',
        bodyHtml: `<div class="ws-cards-grid">${sortedAttention.map((item) => renderCardHtml(item, 'attention')).join('')}</div>`,
      },
      running: {
        iconHtml: '<span class="ws-dot ws-dot-running" aria-hidden="true"></span>',
        count: sortedRunning.length,
        totalCount: sortedRunning.length,
        headAction: '',
        bodyHtml: `<div class="ws-cards-grid">${sortedRunning.map((item) => renderCardHtml(item, 'running')).join('')}</div>`,
      },
      done: {
        iconHtml: '<span class="ws-dot ws-dot-done" aria-hidden="true"></span>',
        count: doneItems.length - doneGroups.archived.length,
        totalCount: doneItems.length,
        headAction: batchArchivableIds.length > 0 && !q
          ? `<button type="button" class="ws-col-action" data-action="archive-read">归档已读 (${batchArchivableIds.length})</button>`
          : '',
        bodyHtml: renderDoneBodyHtml(),
      },
    };

    const activeLanes = [];
    const emptyLanes = [];
    for (const lane of WS_LANES) {
      const cfg = laneHtmlMap[lane.key];
      if (cfg.totalCount > 0) activeLanes.push({ lane, cfg });
      else emptyLanes.push({ lane, cfg });
    }

    if (stripEl) {
      if (emptyLanes.length > 0) {
        stripEl.hidden = false;
        stripEl.innerHTML = emptyLanes
          .map(
            ({ lane, cfg }) => `
              <span class="ws-empty-lane-pill" title="${escapeHtml(lane.emptyText)}">
                ${cfg.iconHtml}
                <span>${lane.label}</span>
                <span class="num">${cfg.count}</span>
              </span>
            `,
          )
          .join('');
      } else {
        stripEl.hidden = true;
        stripEl.innerHTML = '';
      }
    }

    boardEl.innerHTML = activeLanes
      .map(({ lane, cfg }) => {
        return `
          <section class="ws-col" data-col="${lane.key}" aria-label="${lane.label}">
            <header class="ws-col-head">
              <span class="ws-col-title">
                ${cfg.iconHtml}
                <span>${lane.label}</span>
              </span>
              <span class="ws-col-head-right">
                ${cfg.headAction}
                <span class="ws-col-count num">${cfg.count}</span>
              </span>
            </header>
            <div class="ws-col-body">${cfg.bodyHtml}</div>
          </section>
        `;
      })
      .join('');

    boardEl.querySelector('[data-action="archive-read"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (batchArchivableIds.length > 0) {
        performBoardAction({ action: 'archive_batch', ids: batchArchivableIds });
      }
    });

    boardEl.querySelector('[data-action="unarchive-all"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (doneGroups.archived.length > 0) {
        performBoardAction({ action: 'unarchive_batch', ids: doneGroups.archived.map((i) => i.id) });
      }
    });

    boardEl.querySelectorAll('.ws-group-toggle').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const key = btn.dataset.group || '';
        if (!key) return;
        if (wsExpandedGroups.has(key)) wsExpandedGroups.delete(key);
        else wsExpandedGroups.add(key);
        wsLastRenderKey = '';
        renderWorkspaceBoard();
      });
    });

    function startInlineRename(card, cid) {
      const mainBtn = card?.querySelector('.ws-card-main');
      const titleEl = card?.querySelector('.ws-card-title');
      if (!titleEl || !mainBtn) return;
      const original = (card.getAttribute('title') || titleEl.textContent || '').trim();
      wsEditingCid = cid;
      card.classList.add('is-renaming');
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'ws-rename-input';
      input.value = original;
      input.setAttribute('aria-label', '编辑会话名称，Enter 保存，Esc 取消');
      const hint = document.createElement('div');
      hint.className = 'ws-rename-hint';
      hint.textContent = 'Enter 保存 · Esc 取消';
      titleEl.innerHTML = '';
      titleEl.appendChild(input);
      titleEl.appendChild(hint);

      let finished = false;
      function cleanup(save) {
        if (finished) return;
        finished = true;
        const nextTitle = input.value.trim();
        wsEditingCid = '';
        card.classList.remove('is-renaming');
        if (save && nextTitle && nextTitle !== original) {
          performBoardAction({ action: 'rename', id: cid, title: nextTitle });
        } else {
          titleEl.textContent = original;
          wsLastRenderKey = '';
          renderWorkspaceBoard();
        }
      }

      input.addEventListener('pointerdown', (e) => e.stopPropagation());
      input.addEventListener('mousedown', (e) => e.stopPropagation());
      input.addEventListener('click', (e) => e.stopPropagation());
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          cleanup(true);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          cleanup(false);
        }
      });
      input.addEventListener('blur', () => cleanup(true));

      input.focus();
      input.select();
    }

    boardEl.querySelectorAll('.ws-op-btn').forEach((btn) => {
      btn.addEventListener('pointerdown', (e) => e.stopPropagation());
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const cid = btn.dataset.cid || '';
        const op = btn.dataset.op || '';
        if (!cid || !op) return;
        if (op === 'rename') {
          const card = btn.closest('.ws-card');
          if (card) startInlineRename(card, cid);
        } else if (op === 'star') {
          performBoardAction({ action: 'star', id: cid, value: btn.dataset.next === '1' });
        } else if (op === 'archive') {
          performBoardAction({ action: 'archive', id: cid, value: true });
        } else if (op === 'unarchive') {
          performBoardAction({ action: 'archive', id: cid, value: false });
        } else if (op === 'seen') {
          performBoardAction({ action: 'seen', id: cid });
        }
      });
    });

    boardEl.querySelectorAll('.ws-card-main').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        if (wsEditingCid) return;
        e.stopPropagation();
        const cid = btn.dataset.cid || '';
        if (cid) navigateToConversation(cid);
      });
    });
  }

  function setMainPaneSiblingsInert(mainPane, view, shouldInert) {
    if (!mainPane) return;
    for (const child of Array.from(mainPane.children)) {
      if (child === view) continue;
      if (shouldInert) {
        if (!child.hasAttribute('inert')) {
          child.setAttribute('inert', '');
          child.dataset.agyWsInert = '1';
        }
      } else if (child.dataset.agyWsInert === '1') {
        child.removeAttribute('inert');
        delete child.dataset.agyWsInert;
      }
    }
  }

  function ensureWorkspaceViewMounted() {
    ensureWsStyle();
    const mainPane = findWorkspaceMainPane();
    if (!mainPane) return null;
    let view = document.getElementById(WS_VIEW_ID);
    if (!view || !mainPane.contains(view)) {
      view?.remove();
      view = document.createElement('div');
      view.id = WS_VIEW_ID;
      view.setAttribute('role', 'region');
      view.setAttribute('aria-label', '会话看板');
      mainPane.appendChild(view);
      wsLastRenderKey = '';
    }
    view.classList.toggle('agy-ws-open', wsOpen);
    setMainPaneSiblingsInert(mainPane, view, wsOpen);
    if (wsOpen) {
      renderWorkspaceBoard();
    }
    return view;
  }

  function setWorkspaceOpen(next) {
    const nextOpen = Boolean(next);
    if (nextOpen === wsOpen) return;
    wsOpen = nextOpen;
    const menu = document.getElementById(WS_MENU_ID);
    if (menu) {
      menu.classList.toggle('agy-ws-menu-active', wsOpen);
      menu.setAttribute('aria-expanded', String(wsOpen));
    }
    if (wsLoadingTimer) {
      clearTimeout(wsLoadingTimer);
      wsLoadingTimer = null;
    }
    if (wsOpen) {
      wsLastFocusedEl = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      wsBoardOpenedAt = Date.now();
      wsLastRenderKey = '';
      if (wsBoardData === null) {
        wsLoadingTimer = setTimeout(() => {
          wsLastRenderKey = '';
          if (wsOpen) renderWorkspaceBoard();
        }, 4100);
      }
      const view = ensureWorkspaceViewMounted();
      requestAnimationFrame(() => view?.querySelector('.ws-search')?.focus());
    } else {
      setProjectMenuOpen(false);
      hideWsToast();
      ensureWorkspaceViewMounted();
      const targetFocus = wsLastFocusedEl && wsLastFocusedEl.isConnected ? wsLastFocusedEl : menu;
      wsLastFocusedEl = null;
      targetFocus?.focus?.();
    }
  }

  function mountWorkspaceMenu() {
    ensureWsStyle();
    const anchor = findSidebarMenuAnchor();
    if (!anchor) return null;
    const existing = document.getElementById(WS_MENU_ID);
    if (existing && anchor.list.contains(existing)) {
      existing.classList.toggle('agy-ws-menu-active', wsOpen);
      existing.setAttribute('aria-expanded', String(wsOpen));
      updateWorkspaceMenuBadge();
      return existing;
    }
    existing?.remove();

    const menu = document.createElement('button');
    menu.id = WS_MENU_ID;
    menu.type = 'button';
    menu.setAttribute('aria-expanded', String(wsOpen));
    menu.setAttribute('aria-label', '会话看板');
    menu.className = 'agy-button agy-button-custom inline-flex items-center font-medium transition-colors select-none outline-none cursor-pointer disabled:opacity-50 flex-grow w-full justify-start select-none font-normal min-w-0 gap-1.5 px-2 rounded-lg py-1.5 bg-transparent text-secondary-foreground hover:bg-sidebar-muted hover:text-foreground';
    menu.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0;" aria-hidden="true">
        <rect x="3" y="3" width="7" height="7" rx="1"></rect>
        <rect x="14" y="3" width="7" height="7" rx="1"></rect>
        <rect x="14" y="14" width="7" height="7" rx="1"></rect>
        <rect x="3" y="14" width="7" height="7" rx="1"></rect>
      </svg>
      <span class="truncate">会话看板</span>
      <span class="ws-menu-badge" aria-hidden="true"></span>
    `;
    menu.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      setWorkspaceOpen(!wsOpen);
    });

    anchor.list.insertBefore(menu, anchor.refNode.nextSibling);
    menu.classList.toggle('agy-ws-menu-active', wsOpen);
    updateWorkspaceMenuBadge();
    return menu;
  }

  function onWorkspaceGlobalClick(e) {
    if (!wsOpen) return;
    const target = e.target;
    if (!(target instanceof Element)) return;
    if (target.closest('#' + WS_MENU_ID) || target.closest('#' + WS_VIEW_ID)) return;
    if (target.closest('a, button, [role="button"]')) {
      setTimeout(() => setWorkspaceOpen(false), 0);
    }
  }

  function onWorkspaceKeydown(e) {
    if (!wsOpen || wsEditingCid) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      if (wsProjectMenuOpen) {
        setProjectMenuOpen(false);
        return;
      }
      if (wsQuery) {
        wsQuery = '';
        const input = document.querySelector(`#${WS_VIEW_ID} .ws-search`);
        if (input) input.value = '';
        wsLastRenderKey = '';
        renderWorkspaceBoard();
        return;
      }
      setWorkspaceOpen(false);
      return;
    }
    if (e.key === '/' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
      e.preventDefault();
      document.querySelector(`#${WS_VIEW_ID} .ws-search`)?.focus();
    }
  }

  document.addEventListener('click', onWorkspaceGlobalClick, true);
  document.addEventListener('keydown', onWorkspaceKeydown, true);

  window.__agyWsCleanup = () => {
    if (wsLoadingTimer) clearTimeout(wsLoadingTimer);
    if (wsToastTimer) clearTimeout(wsToastTimer);
    document.removeEventListener('click', onWorkspaceGlobalClick, true);
    document.removeEventListener('keydown', onWorkspaceKeydown, true);
    const mainPane = findWorkspaceMainPane();
    const view = document.getElementById(WS_VIEW_ID);
    setMainPaneSiblingsInert(mainPane, view, false);
    document.getElementById(WS_MENU_ID)?.remove();
    view?.remove();
    document.getElementById(WS_STYLE_ID)?.remove();
  };

  window.__agyCtxUpdateBoard = (boardData) => {
    applyPendingActionsToData(boardData);
    wsBoardData = boardData;
    if (wsLoadingTimer) {
      clearTimeout(wsLoadingTimer);
      wsLoadingTimer = null;
    }
    updateWorkspaceMenuBadge();
    if (wsOpen) renderWorkspaceBoard();
  };

  mountWorkspaceMenu();
  ensureWorkspaceViewMounted();

  function handleRouteChange() {
    const nextCid = getCurrentCid();
    if (nextCid === activeCid) return;
    activeCid = nextCid;
    if (nextCid) markConversationSeen(nextCid);
    if (wsOpen) setWorkspaceOpen(false);
    const cached = nextCid ? metricsByCid.get(nextCid) : null;
    const fallback = { empty: true, cascadeId: nextCid };
    if (lastData?.quota) fallback.quota = lastData.quota;
    renderData(cached || fallback);
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
      const qExisting = document.getElementById(QUOTA_BAR_ID);
      if (!existing || !existing.isConnected || !qExisting || !qExisting.isConnected) {
        if (lastData) {
          lastQuotaKey = '';
          renderData(lastData);
        } else {
          mountBar();
          mountQuotaBar();
        }
      }
      const wsMenu = document.getElementById(WS_MENU_ID);
      if (!wsMenu || !wsMenu.isConnected) {
        mountWorkspaceMenu();
      }
      if (wsOpen) {
        const wsView = document.getElementById(WS_VIEW_ID);
        if (!wsView || !wsView.isConnected) {
          ensureWorkspaceViewMounted();
        }
      }
    });
  });
  window.__agyCtxObserver = observer;
  observer.observe(document.body, { childList: true, subtree: true });

  return 'bootstrapped';
})();
