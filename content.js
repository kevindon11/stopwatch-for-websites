let overlayEl = null;
let overlayKey = null;
let overlayDismissed = false;
let dragState = null;
let overlayObserver = null;

function fmtMinutesSeconds(ms) {
  const totalMinutes = Math.floor(ms / 60000);
  const totalSeconds = Math.floor(ms / 1000);
  const seconds = totalSeconds % 60;
  return `${totalMinutes}m${String(seconds).padStart(2, "0")}s`;
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
  overlayEl.style.position = "fixed";
  overlayEl.style.resize = "none";
  overlayEl.style.overflow = "hidden";

  overlayEl.innerHTML = `
    <div id="sst_time" style="font-weight:600; font-variant-numeric: tabular-nums;">0m00s</div>
    <button id="sst_close" aria-label="Hide timer" title="Hide timer" style="
      border: none;
      background: rgba(255,255,255,0.2);
      color: #f7f7f7;
      width: 18px;
      height: 18px;
      border-radius: 50%;
      font-size: 12px;
      line-height: 18px;
      padding: 0;
      cursor: pointer;
      display: none;
    ">×</button>
  `;

  attachOverlay();
  overlayEl.addEventListener("mouseenter", () => {
    const button = overlayEl.querySelector("#sst_close");
    if (button) button.style.display = "inline-flex";
    overlayEl.style.resize = "both";
    overlayEl.style.overflow = "auto";
    overlayEl.style.cursor = "nwse-resize";
  });
  overlayEl.addEventListener("mouseleave", () => {
    const button = overlayEl.querySelector("#sst_close");
    if (button) button.style.display = "none";
    if (!dragState) {
      overlayEl.style.cursor = "grab";
    }
    overlayEl.style.resize = "none";
    overlayEl.style.overflow = "hidden";
  });
  overlayEl.querySelector("#sst_close")?.addEventListener("click", (event) => {
    event.stopPropagation();
    overlayDismissed = true;
    setOverlayVisible(false);
  });

  overlayEl.addEventListener("mousedown", (event) => {
    if (event.button !== 0) return;
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
  overlayEl.style.display = visible ? "block" : "none";
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
    ensureOverlay();
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
});

chrome.runtime.sendMessage({ type: "REQUEST_OVERLAY_STATE" }).catch(() => {});
