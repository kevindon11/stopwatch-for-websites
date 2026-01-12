let overlayEl = null;
let overlayKey = null;
let overlayDismissed = false;
let dragState = null;
let overlayObserver = null;
let overlayScale = 1;
let blockEl = null;
let blockState = {
  key: null,
  limitMinutes: null,
  totalMs: 0,
};
let overlayTheme = {
  backgroundColor: "#7a7a7a",
  textColor: "#f7f7f7",
  backgroundOpacity: 0.85,
  clickThrough: true,
};
let clickThroughOverride = false;
let overlayInteractionEnabled = false;
let hoverTimer = null;

const HOVER_REVEAL_DELAY_MS = 1500;

const BASE_OVERLAY_STYLE = {
  paddingY: 8,
  paddingX: 12,
  borderRadius: 12,
  fontSize: 13,
  gap: 8,
  minHeight: 34,
  closeSize: 18,
  closeFontSize: 12,
};

function applyOverlayScale(scale) {
  if (!overlayEl) return;
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  overlayScale = safeScale;
  const paddingY = Math.round(BASE_OVERLAY_STYLE.paddingY * safeScale);
  const paddingX = Math.round(BASE_OVERLAY_STYLE.paddingX * safeScale);
  const borderRadius = Math.round(BASE_OVERLAY_STYLE.borderRadius * safeScale);
  const fontSize = Math.round(BASE_OVERLAY_STYLE.fontSize * safeScale);
  const gap = Math.round(BASE_OVERLAY_STYLE.gap * safeScale);
  const minHeight = Math.round(BASE_OVERLAY_STYLE.minHeight * safeScale);
  const closeSize = Math.round(BASE_OVERLAY_STYLE.closeSize * safeScale);
  const closeFontSize = Math.round(
    BASE_OVERLAY_STYLE.closeFontSize * safeScale,
  );

  overlayEl.style.padding = `${paddingY}px ${paddingX}px`;
  overlayEl.style.borderRadius = `${borderRadius}px`;
  overlayEl.style.fontSize = `${fontSize}px`;
  overlayEl.style.gap = `${gap}px`;
  overlayEl.style.minHeight = `${minHeight}px`;

  const button = overlayEl.querySelector("#sst_close");
  if (button) {
    button.style.width = `${closeSize}px`;
    button.style.height = `${closeSize}px`;
    button.style.fontSize = `${closeFontSize}px`;
  }
}

function hexToRgb(hex) {
  const normalized = hex.replace("#", "");
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  return { r, g, b };
}

function applyOverlayTheme(theme) {
  if (!overlayEl) return;
  const { backgroundColor, textColor, backgroundOpacity } = theme;
  const { r, g, b } = hexToRgb(backgroundColor);
  const clampedOpacity = Math.min(1, Math.max(0, backgroundOpacity));
  overlayEl.style.background = `rgba(${r}, ${g}, ${b}, ${clampedOpacity})`;
  overlayEl.style.color = textColor;
}

function applyClickThroughState() {
  if (!overlayEl) return;
  if (!overlayTheme.clickThrough) {
    overlayEl.style.pointerEvents = "auto";
    return;
  }
  if (clickThroughOverride || overlayInteractionEnabled) {
    overlayEl.style.pointerEvents = "auto";
  } else {
    overlayEl.style.pointerEvents = "none";
  }
}

function setOverlayInteractionState(enabled) {
  if (!overlayEl) return;
  overlayInteractionEnabled = enabled;
  const button = overlayEl.querySelector("#sst_close");
  if (button) button.style.display = enabled ? "inline-flex" : "none";
  overlayEl.style.cursor =
    enabled || !overlayTheme.clickThrough ? "grab" : "default";
  applyClickThroughState();
}

function clearHoverTimer() {
  if (hoverTimer) {
    clearTimeout(hoverTimer);
    hoverTimer = null;
  }
}

function scheduleHoverReveal() {
  if (hoverTimer || overlayInteractionEnabled) return;
  hoverTimer = setTimeout(() => {
    hoverTimer = null;
    setOverlayInteractionState(true);
  }, HOVER_REVEAL_DELAY_MS);
}

function handleHoverExit() {
  clearHoverTimer();
  if (overlayInteractionEnabled) {
    setOverlayInteractionState(false);
  }
}

function fmtMinutesSeconds(ms) {
  const totalMinutes = Math.floor(ms / 60000);
  const totalSeconds = Math.floor(ms / 1000);
  const seconds = totalSeconds % 60;
  return `${totalMinutes}m${String(seconds).padStart(2, "0")}s`;
}

function fmtMinutes(ms) {
  const totalMinutes = Math.floor(ms / 60000);
  return `${totalMinutes}m`;
}

async function getTodayTimeForKey(key) {
  const res = await chrome.runtime.sendMessage({ type: "GET_TODAY_TIMES" });
  if (!res?.ok) return 0;
  return res.times?.[key] || 0;
}

function ensureOverlay() {
  if (overlayEl) return overlayEl;

  overlayEl = document.createElement("div");
  overlayEl.style.position = "fixed";
  overlayEl.style.top = "12px";
  overlayEl.style.left = "25%";
  overlayEl.style.transform = "translateX(-50%)";
  overlayEl.style.zIndex = "2147483647";
  overlayEl.style.padding = "8px 12px";
  overlayEl.style.borderRadius = "12px";
  overlayEl.style.fontFamily =
    "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif";
  overlayEl.style.fontSize = "13px";
  overlayEl.style.lineHeight = "1";
  overlayEl.style.background = "rgba(120,120,120,0.85)";
  overlayEl.style.color = "#f7f7f7";
  overlayEl.style.boxShadow = "0 8px 24px rgba(0,0,0,0.2)";
  overlayEl.style.userSelect = "none";
  overlayEl.style.cursor = "grab";
  overlayEl.style.display = "flex";
  overlayEl.style.alignItems = "center";
  overlayEl.style.gap = "8px";
  overlayEl.style.flexWrap = "nowrap";
  overlayEl.style.whiteSpace = "nowrap";
  overlayEl.style.width = "fit-content";
  overlayEl.style.maxWidth = "100%";
  overlayEl.style.position = "fixed";
  overlayEl.style.overflow = "hidden";
  overlayEl.style.minHeight = "34px";

  overlayEl.innerHTML = `
    <button id="sst_close" aria-label="Hide timer" title="Hide timer" style="
      border: none;
      background: rgba(255,255,255,0.2);
      color: #f7f7f7;
      width: 18px;
      height: 18px;
      border-radius: 50%;
      font-size: 12px;
      line-height: 1;
      padding: 0;
      cursor: pointer;
      display: none;
      align-items: center;
      justify-content: center;
    ">×</button>
    <div id="sst_time" style="font-weight:600; font-variant-numeric: tabular-nums; white-space: nowrap;">0m00s</div>
  `;

  attachOverlay();
  applyOverlayScale(overlayScale);
  applyOverlayTheme(overlayTheme);
  applyClickThroughState();
  overlayEl.addEventListener("mouseenter", () => {
    if (!overlayTheme.clickThrough) {
      setOverlayInteractionState(true);
    }
  });
  overlayEl.addEventListener("mouseleave", () => {
    overlayEl.style.overflow = "hidden";
    if (!overlayTheme.clickThrough) {
      setOverlayInteractionState(false);
    }
  });
  overlayEl.querySelector("#sst_close")?.addEventListener("click", (event) => {
    event.stopPropagation();
    overlayDismissed = true;
    setOverlayVisible(false);
  });

  overlayEl.addEventListener("mousedown", (event) => {
    if (event.button !== 0) return;
    if (overlayTheme.clickThrough && !overlayInteractionEnabled) return;
    const target = event.target;
    if (target instanceof HTMLElement && target.id === "sst_close") return;
    const rect = overlayEl.getBoundingClientRect();
    overlayEl.style.left = `${rect.left}px`;
    overlayEl.style.top = `${rect.top}px`;
    dragState = {
      startX: event.clientX,
      startY: event.clientY,
      offsetX: rect.left,
      offsetY: rect.top,
    };
    overlayEl.style.cursor = "grabbing";
    overlayEl.style.transform = "none";
    event.preventDefault();
  });

  document.addEventListener("mousemove", (event) => {
    if (!dragState || !overlayEl) return;
    const nextLeft = dragState.offsetX + (event.clientX - dragState.startX);
    const nextTop = dragState.offsetY + (event.clientY - dragState.startY);
    overlayEl.style.left = `${nextLeft}px`;
    overlayEl.style.top = `${nextTop}px`;
  });

  document.addEventListener("mouseup", () => {
    if (!overlayEl || !dragState) return;
    overlayEl.style.cursor = "grab";
    dragState = null;
  });

  document.addEventListener("mousemove", (event) => {
    if (!overlayEl || !overlayTheme.clickThrough || clickThroughOverride) return;
    const rect = overlayEl.getBoundingClientRect();
    const within =
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom;
    if (within) {
      scheduleHoverReveal();
    } else {
      handleHoverExit();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (!overlayTheme.clickThrough) return;
    if (event.altKey && event.shiftKey && event.code === "KeyO") {
      clickThroughOverride = !clickThroughOverride;
      if (clickThroughOverride) {
        setOverlayInteractionState(true);
      } else {
        setOverlayInteractionState(false);
      }
      applyClickThroughState();
    }
  });

  if (!overlayObserver) {
    overlayObserver = new MutationObserver(() => {
      if (!overlayEl || overlayDismissed) return;
      if (!overlayEl.isConnected) {
        attachOverlay();
        setOverlayVisible(true);
      }
    });
    overlayObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }
  return overlayEl;
}

function attachOverlay() {
  if (!overlayEl) return;
  if (overlayEl.isConnected) return;
  (document.body || document.documentElement).appendChild(overlayEl);
}

function setOverlayVisible(visible) {
  if (!overlayEl) return;
  if (visible) {
    attachOverlay();
  }
  overlayEl.style.display = visible ? "flex" : "none";
}

function ensureBlockOverlay() {
  if (blockEl) return blockEl;
  blockEl = document.createElement("div");
  blockEl.style.position = "fixed";
  blockEl.style.top = "0";
  blockEl.style.left = "0";
  blockEl.style.width = "100%";
  blockEl.style.height = "100%";
  blockEl.style.zIndex = "2147483647";
  blockEl.style.background = "rgba(0, 0, 0, 0.92)";
  blockEl.style.color = "#f7f7f7";
  blockEl.style.display = "flex";
  blockEl.style.alignItems = "center";
  blockEl.style.justifyContent = "center";
  blockEl.style.textAlign = "center";
  blockEl.style.fontFamily =
    "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif";
  blockEl.style.fontSize = "16px";
  blockEl.style.padding = "24px";
  blockEl.style.boxSizing = "border-box";
  blockEl.style.pointerEvents = "auto";
  blockEl.innerHTML = `
    <div style="max-width: 360px;">
      <div style="font-size: 20px; font-weight: 600; margin-bottom: 12px;">
        Time limit reached
      </div>
      <div id="sst_block_details" style="line-height: 1.5;"></div>
    </div>
  `;
  (document.body || document.documentElement).appendChild(blockEl);
  return blockEl;
}

function updateBlockDetails() {
  if (!blockEl) return;
  const details = blockEl.querySelector("#sst_block_details");
  if (!details) return;
  const limitText = blockState.limitMinutes
    ? `${blockState.limitMinutes}m`
    : "No limit";
  const totalText = fmtMinutes(blockState.totalMs || 0);
  details.textContent = `Limit: ${limitText} · Today: ${totalText}`;
}

function setBlockVisible(visible) {
  const overlay = ensureBlockOverlay();
  overlay.style.display = visible ? "flex" : "none";
  if (visible) updateBlockDetails();
}

async function refreshOverlayTime() {
  if (!overlayEl || !overlayKey) return;
  const ms = await getTodayTimeForKey(overlayKey);
  const node = overlayEl.querySelector("#sst_time");
  if (node) node.textContent = fmtMinutesSeconds(ms);
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "OVERLAY_SHOW") {
    overlayKey = msg.key || null;
    overlayScale = Number.isFinite(msg.scale) ? msg.scale : 1;
    overlayTheme = {
      backgroundColor:
        typeof msg.backgroundColor === "string"
          ? msg.backgroundColor
          : "#7a7a7a",
      textColor:
        typeof msg.textColor === "string" ? msg.textColor : "#f7f7f7",
      backgroundOpacity: Number.isFinite(msg.backgroundOpacity)
        ? msg.backgroundOpacity
        : 0.85,
      clickThrough: !!msg.clickThrough,
    };
    clickThroughOverride = false;
    overlayInteractionEnabled = false;
    clearHoverTimer();
    ensureOverlay();
    applyOverlayScale(overlayScale);
    applyOverlayTheme(overlayTheme);
    applyClickThroughState();
    if (!overlayDismissed) {
      setOverlayVisible(true);
      refreshOverlayTime();
    }
  }

  if (msg?.type === "OVERLAY_HIDE") {
    setOverlayVisible(false);
  }

  if (msg?.type === "OVERLAY_TICK") {
    if (!overlayDismissed) {
      refreshOverlayTime();
    }
  }

  if (msg?.type === "BLOCK_SHOW") {
    blockState = {
      key: msg.key || null,
      limitMinutes: Number.isFinite(msg.limitMinutes) ? msg.limitMinutes : null,
      totalMs: Number.isFinite(msg.totalMs) ? msg.totalMs : 0,
    };
    setBlockVisible(true);
  }

  if (msg?.type === "BLOCK_HIDE") {
    if (blockEl) blockEl.style.display = "none";
  }
});

chrome.runtime.sendMessage({ type: "REQUEST_OVERLAY_STATE" }).catch(() => {});
chrome.runtime.sendMessage({ type: "REQUEST_BLOCK_STATE" }).catch(() => {});
