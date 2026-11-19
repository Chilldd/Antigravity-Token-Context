(() => {
  const SCRIPT_VERSION = '16';
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
  let lastRenderKey = '';
  let mountScheduled = false;
  let popPinned = false;
  let compactFeedbackTimer = null;

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
        background: color-mix(in srgb, #3b82f6 12%, transparent);
        border-color: color-mix(in srgb, #3b82f6 45%, transparent);
      }
      #${BAR_ID} .agy-ctx-main:focus-visible,
      #${BAR_ID} .agy-ctx-alert:focus-visible {
        outline: 2px solid #3b82f6;
        outline-offset: 2px;
      }
      #${BAR_ID}.agy-err {
        border-style: dashed;
        opacity: 0.9;
      }
      #${BAR_ID}.agy-warn {
        background: rgba(245, 158, 11, 0.10);
        border-color: rgba(245, 158, 11, 0.45);
        color: #fbbf24;
      }
      #${BAR_ID}.agy-warn.agy-light {
        color: #b45309;
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
      #${BAR_ID}.agy-crit.agy-light {
        color: #dc2626;
      }
      #${BAR_ID}.agy-crit:hover {
        background: rgba(239, 68, 68, 0.18);
        border-color: rgba(239, 68, 68, 0.75);
      }
      @keyframes agy-pulse-crit {
        0%, 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.28); }
        50% { box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.08); }
      }
      @media (prefers-reduced-motion: reduce) {
        #${BAR_ID},
        #${BAR_ID} .agy-ctx-main,
        #${BAR_ID} .agy-ctx-alert,
        #${BAR_ID} svg.agy-ring circle:nth-child(2),
        #${POPOVER_ID},
        #${POPOVER_ID} .agy-pop-bar > div {
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
        background: #fbbf24;
        color: #18181b;
        line-height: 1.25;
        flex: none;
      }
      #${BAR_ID}.agy-warn.agy-light .agy-ctx-alert {
        background: #b45309;
        color: #ffffff;
      }
      #${BAR_ID}.agy-crit .agy-ctx-alert {
        background: #dc2626;
        color: #ffffff;
      }
      #${BAR_ID}.agy-warn .agy-ctx-strong { color: #fbbf24; }
      #${BAR_ID}.agy-warn.agy-light .agy-ctx-strong { color: #b45309; }
      #${BAR_ID}.agy-crit .agy-ctx-strong { color: #ef4444; }
      #${BAR_ID}.agy-crit.agy-light .agy-ctx-strong { color: #dc2626; }
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
      #${BAR_ID} svg.agy-ring circle:nth-child(2) {
        transition: stroke-dashoffset 0.55s cubic-bezier(0.25, 1, 0.5, 1), stroke 0.3s ease;
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
        width: 272px;
        padding: 11px 12px 10px;
        border-radius: 12px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
        font-size: 11.5px;
        line-height: 1.4;
        font-variant-numeric: tabular-nums;
        pointer-events: none;
        opacity: 0;
        transform: translateY(4px) scale(0.985);
        transition: opacity 0.26s ease, transform 0.26s cubic-bezier(0.25, 1, 0.5, 1);
        box-sizing: border-box;
      }
      #${POPOVER_ID}.visible {
        opacity: 1;
        transform: translateY(0) scale(1);
        pointer-events: auto;
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
        transition: width 0.55s cubic-bezier(0.25, 1, 0.5, 1);
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
        background: rgba(245, 158, 11, 0.12);
        color: #fbbf24;
        border: 1px solid rgba(245, 158, 11, 0.35);
      }
      #${POPOVER_ID}.light .agy-pop-alert.warn {
        color: #b45309;
      }
      #${POPOVER_ID} .agy-pop-alert.crit {
        background: rgba(239, 68, 68, 0.14);
        color: #ef4444;
        border: 1px solid rgba(239, 68, 68, 0.4);
      }
      #${POPOVER_ID} .agy-pop-err-msg {
        padding: 7px 8px;
        border-radius: 7px;
        background: rgba(239, 68, 68, 0.10);
        border: 1px solid rgba(239, 68, 68, 0.30);
        color: #f87171;
        font-size: 11px;
        line-height: 1.45;
        word-break: break-word;
        margin-bottom: 8px;
      }
      #${POPOVER_ID}.light .agy-pop-err-msg {
        color: #b91c1c;
        background: #fef2f2;
        border-color: rgba(220, 38, 38, 0.25);
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
    if (v >= 1e6) return (v / 1e6).toFixed(v % 1e6 === 0 ? 0 : 2) + 'M';
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
        if (b.id === BAR_ID || b.closest('#' + BAR_ID)) return false;
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
    const popWidth = 272;
    const left = Math.max(8, Math.min(window.innerWidth - popWidth - 8, br.left));
    pop.style.left = left + 'px';
    pop.style.bottom = (window.innerHeight - br.top + 8) + 'px';
    pop.style.top = 'auto';
  }

  function showPopover(bar) {
    if (!lastData || lastData.empty) return;
    const pop = ensurePopover();
    renderPopover(pop, lastData);
    positionPopover(bar, pop);
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
      if (e.key === 'Escape') hidePopover(true);
    });
    document.addEventListener('click', (e) => {
      if (!popPinned) return;
      const bar = document.getElementById(BAR_ID);
      const pop = document.getElementById(POPOVER_ID);
      if (bar && bar.contains(e.target)) return;
      if (pop && pop.contains(e.target)) return;
      hidePopover(true);
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
      if (popPinned) showPopover(bar);
      else hidePopover(true);
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

  function renderPopover(pop, data) {
    const light = isLightSurface();
    if (data.error) {
      const errMsg = (typeof data.error === 'string' && data.error)
        ? data.error
        : (data.message || '连接已断开');
      const badgeColor = light ? '#dc2626' : '#f87171';
      const badgeBg = light ? '#fef2f2' : 'rgba(239,68,68,0.16)';
      pop.innerHTML = `
        <div class="agy-pop-head">
          <span class="agy-pop-model">连接异常</span>
          <span class="agy-pop-badge" style="color:${badgeColor};background:${badgeBg}">离线</span>
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
    const color = pct >= 90 ? (light ? '#dc2626' : '#ef4444') : pct >= 75 ? (light ? '#b45309' : '#fbbf24') : (light ? '#2563eb' : '#60a5fa');
    const badgeBg = pct >= 90 ? (light ? '#fef2f2' : 'rgba(239,68,68,0.16)') : pct >= 75 ? (light ? '#fffbeb' : 'rgba(245,158,11,0.16)') : (light ? '#eff6ff' : 'rgba(59,130,246,0.18)');
    const latestSpeed = speed.latestTokensPerSec != null ? speed.latestTokensPerSec.toFixed(0) + ' tok/s' : '-';
    const avgSpeed = speed.avgTokensPerSec != null ? '均值 ' + speed.avgTokensPerSec.toFixed(0) + ' tok/s' : '均值 -';
    const ttft = speed.latestTtftSec != null ? '首字 ' + speed.latestTtftSec.toFixed(1) + 's' : '首字 -';
    const hitAll = cache.overallHitRate != null ? cache.overallHitRate.toFixed(1) + '%' : '-';
    const hitLast = cache.latestHitRate != null ? '本轮 ' + cache.latestHitRate.toFixed(1) + '%' : '本轮 -';

    const alertHtml = pct >= 90
      ? `<div class="agy-pop-alert crit"><span>已达 ${pct.toFixed(0)}%，建议压缩或开新对话</span><button type="button" class="agy-pop-action" data-compact>填入 /compact</button></div>`
      : (pct >= 75
          ? `<div class="agy-pop-alert warn"><span>已达 ${pct.toFixed(0)}%，建议适时压缩上下文</span><button type="button" class="agy-pop-action" data-compact>填入 /compact</button></div>`
          : '');

    pop.innerHTML = `
      <div class="agy-pop-head">
        <span class="agy-pop-model">${esc(data.modelName || '当前上下文')}</span>
        <span class="agy-pop-badge" style="color:${color};background:${badgeBg}">${pct.toFixed(1)}%</span>
      </div>
      <div class="agy-pop-row">
        <span class="agy-pop-dim">上下文占用</span>
        <span><b>${fmtTok(ctx.used)}</b> / ${ctx.max ? fmtTok(ctx.max) : '?'}</span>
      </div>
      <div class="agy-pop-bar"><div style="width:${pct.toFixed(1)}%;background:${color}"></div></div>
      ${alertHtml}
      <div class="agy-pop-grid">
        <div class="agy-pop-cell">
          <div class="agy-pop-k">生成速度</div>
          <div class="agy-pop-v">${latestSpeed}</div>
          <div class="agy-pop-sub">${avgSpeed}<br>${ttft}</div>
        </div>
        <div class="agy-pop-cell">
          <div class="agy-pop-k">缓存命中</div>
          <div class="agy-pop-v">${hitAll}</div>
          <div class="agy-pop-sub">${hitLast}</div>
        </div>
        <div class="agy-pop-cell">
          <div class="agy-pop-k">累计输入</div>
          <div class="agy-pop-v">${fmtTok(totals.inputAll)}</div>
          <div class="agy-pop-sub">新 ${fmtTok(totals.uncachedInput)}</div>
        </div>
        <div class="agy-pop-cell">
          <div class="agy-pop-k">累计输出</div>
          <div class="agy-pop-v">${fmtTok(totals.output)}</div>
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
            <circle class="agy-ring-prog" cx="8" cy="8" r="${r}" fill="none" stroke="#3b82f6" stroke-width="2"
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

  function renderData(data) {
    lastData = data;
    const bar = mountBar();
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
        positionPopover(bar, pop);
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
    const color = pct >= 90 ? '#ef4444' : pct >= 75 ? '#f59e0b' : '#3b82f6';
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
        prog.setAttribute('stroke', color);
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
