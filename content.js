let overlayEl = null;
let overlayHostname = null;
let overlayDismissed = false;
let dragState = null;

function fmtMinutes(ms) {
  const totalMinutes = Math.floor(ms / 60000);
  return `${totalMinutes}m`;
}

async function getTodayTimeForHost(hostname) {
  const res = await chrome.runtime.sendMessage({ type: "GET_TODAY_TIMES" });
  if (!res?.ok) return 0;
  const normalized = (hostname || "").toLowerCase().replace(/^www\./, "");
  return res.times?.[normalized] || 0;
}

function ensureOverlay() {
  if (overlayEl) return overlayEl;

  overlayEl = document.createElement("div");
  overlayEl.style.position = "fixed";
  overlayEl.style.top = "12px";
  overlayEl.style.left = "50%";
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

  overlayEl.innerHTML = `
    <div id="sst_time" style="font-weight:600; font-variant-numeric: tabular-nums;">0m</div>
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

  document.documentElement.appendChild(overlayEl);
  overlayEl.addEventListener("mouseenter", () => {
    const button = overlayEl.querySelector("#sst_close");
    if (button) button.style.display = "inline-flex";
  });
  overlayEl.addEventListener("mouseleave", () => {
    const button = overlayEl.querySelector("#sst_close");
    if (button) button.style.display = "none";
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
  return overlayEl;
}

function setOverlayVisible(visible) {
  if (!overlayEl) return;
  overlayEl.style.display = visible ? "block" : "none";
}

async function refreshOverlayTime() {
  if (!overlayEl || !overlayHostname) return;
  const ms = await getTodayTimeForHost(overlayHostname);
  const node = overlayEl.querySelector("#sst_time");
  if (node) node.textContent = fmtMinutes(ms);
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "OVERLAY_SHOW") {
    overlayHostname = msg.hostname || location.hostname;
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
