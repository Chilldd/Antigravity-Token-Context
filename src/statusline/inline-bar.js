(() => {
  const SCRIPT_VERSION = '19';
  if (window.__agyCtxBarVersion === SCRIPT_VERSION) return 'already-bootstrapped';
  window.__agyCtxBarVersion = SCRIPT_VERSION;
  window.__agyCtxBarBootstrapped = true;

  if (window.__agyCtxObserver) {
    try { window.__agyCtxObserver.disconnect(); } catch {}
  }
  document.querySelectorAll(
    '#agy-ctx-inline-bar, #agy-ctx-inline-popover, #agy-quota-inline-bar, #agy-quota-inline-popover, #agy-ctx-inline-style',
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
      #${BAR_ID} .agy-ctx-main:active,
      #${BAR_ID} .agy-ctx-alert:active {
        transform: scale(0.97);
      }
      #${BAR_ID} .agy-ctx-main *,
      #${BAR_ID} .agy-ctx-alert,
      #${BAR_ID} .agy-ctx-alert * {
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
      #${BAR_ID} .agy-ctx-main:focus-visible,
      #${BAR_ID} .agy-ctx-alert:focus-visible {
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
        #${BAR_ID} .agy-ctx-alert,
        #${BAR_ID} svg.agy-ring circle:nth-child(2),
        #${POPOVER_ID},
        #${POPOVER_ID} .agy-pop-bar > div,
        #${QUOTA_POP_ID},
        #${QUOTA_POP_ID} .agy-qpop-bar > div {
          transition: none;
        }
        #${BAR_ID} .agy-ctx-main:active,
        #${BAR_ID} .agy-ctx-alert:active {
          transform: none;
        }
        #${BAR_ID}.agy-crit {
          animation: none;
        }
      }
      #${BAR_ID} .agy-ctx-alert {
        appearance: none;
        border: none;
        margin: 0;
        font-family: inherit;
        font-size: 10px;
        font-weight: 600;
        padding: 1px 6px;
        border-radius: 999px;
        background: var(--bar-warn-fg);
        color: #18181b;
        line-height: 1.25;
        flex: none;
      }
      #${BAR_ID}.agy-warn.agy-light .agy-ctx-alert {
        background: var(--bar-warn-fg);
        color: #ffffff;
      }
      #${BAR_ID}.agy-crit .agy-ctx-alert {
        background: var(--bar-danger);
        color: #ffffff;
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
    const alertBtn = bar.querySelector('.agy-ctx-alert');

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
    alertBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      insertCompactCommand(alertBtn);
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
      <button type="button" class="agy-ctx-alert" data-slot="alert" title="点击填入 /compact" style="display:none"></button>
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
        bar.querySelector('[data-slot="alert"]').style.display = 'none';
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
      bar.querySelector('[data-slot="alert"]').style.display = 'none';
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
    const alertText = pct >= 90 ? '快满 · /compact' : (pct >= 75 ? '建议 /compact' : '');

    renderKey = `ok:${pctRounded}|${tokSpeed}|${totalTok}|${alertText}`;
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
      const alertEl = bar.querySelector('[data-slot="alert"]');
      if (alertText) {
        alertEl.style.display = '';
        if (!alertEl.dataset.origText) {
          alertEl.textContent = alertText;
        } else {
          alertEl.dataset.origText = alertText;
        }
      } else {
        alertEl.style.display = 'none';
        delete alertEl.dataset.origText;
      }
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

  function handleRouteChange() {
    const nextCid = getCurrentCid();
    if (nextCid === activeCid) return;
    activeCid = nextCid;
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
    });
  });
  window.__agyCtxObserver = observer;
  observer.observe(document.body, { childList: true, subtree: true });

  return 'bootstrapped';
})();
