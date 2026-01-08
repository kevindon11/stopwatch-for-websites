const DEFAULT_SITES = ["chatgpt.com", "chatgpt.com/codex", "github.com", "x.com", "youtube.com", "reddit.com"];

let activeTabId = null;
let activeKey = null;
let lastTickMs = null;

function todayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const DEFAULT_OVERLAY_THEME = {
  backgroundColor: "#7a7a7a",
  textColor: "#f7f7f7",
  backgroundOpacity: 0.85,
  clickThrough: false,
};

function normalizeHexColor(value, fallback) {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(normalized)) return normalized.toLowerCase();
  return fallback;
}

function normalizeOpacity(value, fallback) {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(1, Math.max(0, parsed));
}

async function getSettings() {
  const {
    trackedSites,
    overlayEnabled,
    overlayScale,
    overlayBackgroundColor,
    overlayTextColor,
    overlayBackgroundOpacity,
    overlayClickThrough,
  } = await chrome.storage.sync.get({
    trackedSites: DEFAULT_SITES,
    overlayEnabled: true,
    overlayScale: 1,
    overlayBackgroundColor: DEFAULT_OVERLAY_THEME.backgroundColor,
    overlayTextColor: DEFAULT_OVERLAY_THEME.textColor,
    overlayBackgroundOpacity: DEFAULT_OVERLAY_THEME.backgroundOpacity,
    overlayClickThrough: DEFAULT_OVERLAY_THEME.clickThrough,
  });
  return {
    trackedSites,
    overlayEnabled,
    overlayScale,
    overlayBackgroundColor: normalizeHexColor(
      overlayBackgroundColor,
      DEFAULT_OVERLAY_THEME.backgroundColor,
    ),
    overlayTextColor: normalizeHexColor(
      overlayTextColor,
      DEFAULT_OVERLAY_THEME.textColor,
    ),
    overlayBackgroundOpacity: normalizeOpacity(
      overlayBackgroundOpacity,
      DEFAULT_OVERLAY_THEME.backgroundOpacity,
    ),
    overlayClickThrough: !!overlayClickThrough,
  };
}

function normalizeHost(hostname) {
  return (hostname || "").toLowerCase().replace(/^www\./, "");
}

function normalizePath(pathname) {
  if (!pathname || pathname === "/") return "";
  const trimmed = pathname.replace(/\/+$/, "");
  return trimmed === "/" ? "" : trimmed;
}

function parseTrackedEntry(entry) {
  const raw = entry?.trim();
  if (!raw) return null;
  let url;
  try {
    url = new URL(raw.includes("://") ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  const host = normalizeHost(url.hostname);
  if (!host) return null;
  const path = normalizePath(url.pathname);
  return {
    host,
    path,
    key: `${host}${path}`,
  };
}

function getMatchForUrl(url, list) {
  const host = normalizeHost(url.hostname);
  const path = normalizePath(url.pathname);
  let bestMatch = null;

  list.forEach((entry) => {
    const parsed = parseTrackedEntry(entry);
    if (!parsed) return;
    const hostMatches =
      host === parsed.host || host.endsWith(`.${parsed.host}`);
    if (!hostMatches) return;
    if (parsed.path) {
      if (!(path === parsed.path || path.startsWith(`${parsed.path}/`))) return;
    }
    if (
      !bestMatch ||
      parsed.path.length > bestMatch.path.length ||
      (parsed.path.length === bestMatch.path.length &&
        parsed.host.length > bestMatch.host.length)
    ) {
      bestMatch = parsed;
    }
  });

  return bestMatch;
}

async function addTimeForKey(key, deltaMs) {
  if (!key || deltaMs <= 0) return;

  const today = todayKey();
  const storeKey = `time_${today}`;
  const data = await chrome.storage.local.get({ [storeKey]: {} });
  const perHost = data[storeKey] || {};

  perHost[key] = (perHost[key] || 0) + deltaMs;

  await chrome.storage.local.set({ [storeKey]: perHost });
}

async function setActiveFromTab(tab) {
  if (!tab || !tab.id || !tab.url) {
    activeTabId = null;
    activeKey = null;
    lastTickMs = null;
    await updateBadge(null);
    return;
  }

  let url;
  try {
    url = new URL(tab.url);
  } catch {
    activeTabId = null;
    activeKey = null;
    lastTickMs = null;
    await updateBadge(null);
    return;
  }

  const { trackedSites } = await getSettings();
  const match = getMatchForUrl(url, trackedSites);

  if (!match) {
    activeTabId = null;
    activeKey = null;
    lastTickMs = null;
    await updateBadge(null);
    return;
  }

  activeTabId = tab.id;
  activeKey = match.key;
  lastTickMs = Date.now();
  await updateBadge(activeKey);
}

async function flushActiveTime() {
  if (!activeKey || !lastTickMs) return;
  const now = Date.now();
  const delta = now - lastTickMs;
  lastTickMs = now;
  await addTimeForKey(activeKey, delta);
  await updateBadge(activeKey);
}

async function updateBadge(key) {
  if (!key) {
    chrome.action.setBadgeText({ text: "" });
    return;
  }
  const today = todayKey();
  const storeKey = `time_${today}`;
  const data = await chrome.storage.local.get({ [storeKey]: {} });
  const totalMs = data[storeKey]?.[key] || 0;
  const minutes = Math.floor(totalMs / 60000);
  const text = minutes ? `${minutes}m` : "0m";
  chrome.action.setBadgeBackgroundColor({ color: "#00539c" });
  chrome.action.setBadgeText({ text });
}

function sendMessageToTab(tabId, message) {
  if (!Number.isInteger(tabId)) return;
  chrome.tabs.sendMessage(tabId, message).catch(() => {});
}

async function updateOverlay(tabId, forceHide = false) {
  const {
    overlayEnabled,
    trackedSites,
    overlayScale,
    overlayBackgroundColor,
    overlayTextColor,
    overlayBackgroundOpacity,
    overlayClickThrough,
  } = await getSettings();

  if (!overlayEnabled || forceHide) {
    sendMessageToTab(tabId, { type: "OVERLAY_HIDE" });
    return;
  }

  if (!Number.isInteger(tabId)) return;

  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab || !tab.url) return;

  let url;
  try {
    url = new URL(tab.url);
  } catch {
    return;
  }

  const match = getMatchForUrl(url, trackedSites);

  if (!match) {
    sendMessageToTab(tabId, { type: "OVERLAY_HIDE" });
    return;
  }

  sendMessageToTab(tabId, {
    type: "OVERLAY_SHOW",
    key: match.key,
    scale: overlayScale,
    backgroundColor: overlayBackgroundColor,
    textColor: overlayTextColor,
    backgroundOpacity: overlayBackgroundOpacity,
    clickThrough: overlayClickThrough,
  });
}

setInterval(async () => {
  if (!activeTabId || !activeKey || !lastTickMs) return;

  const tab = await chrome.tabs.get(activeTabId).catch(() => null);
  if (!tab) {
    activeTabId = null;
    activeKey = null;
    lastTickMs = null;
    await updateBadge(null);
    return;
  }

  if (!tab.active) return;

  await flushActiveTime();
  sendMessageToTab(activeTabId, { type: "OVERLAY_TICK" });
}, 1000);

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  await flushActiveTime();

  const tab = await chrome.tabs.get(tabId).catch(() => null);
  await setActiveFromTab(tab);

  await updateOverlay(tabId);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!changeInfo.url) return;

  if (tab.active) {
    await flushActiveTime();
    await setActiveFromTab(tab);
    await updateOverlay(tabId);
  }
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    await flushActiveTime();
    if (activeTabId) await updateOverlay(activeTabId, true);
    await updateBadge(null);
    return;
  }

  const [tab] = await chrome.tabs
    .query({ active: true, windowId })
    .catch(() => []);
  await setActiveFromTab(tab);
  if (tab?.id) await updateOverlay(tab.id);
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg?.type === "GET_TODAY_TIMES") {
      const key = todayKey();
      const storeKey = `time_${key}`;
      const data = await chrome.storage.local.get({ [storeKey]: {} });
      sendResponse({ ok: true, key, times: data[storeKey] || {} });
      return;
    }

    if (msg?.type === "GET_SETTINGS") {
      const settings = await getSettings();
      sendResponse({ ok: true, settings });
      return;
    }

    if (msg?.type === "SET_SETTINGS") {
      const trackedSites = Array.isArray(msg.trackedSites)
        ? msg.trackedSites
        : DEFAULT_SITES;
      const overlayEnabled = !!msg.overlayEnabled;
      const parsedScale = Number.parseFloat(msg.overlayScale);
      const overlayScale = Number.isFinite(parsedScale) && parsedScale > 0
        ? parsedScale
        : 1;
      const overlayBackgroundColor = normalizeHexColor(
        msg.overlayBackgroundColor,
        DEFAULT_OVERLAY_THEME.backgroundColor,
      );
      const overlayTextColor = normalizeHexColor(
        msg.overlayTextColor,
        DEFAULT_OVERLAY_THEME.textColor,
      );
      const overlayBackgroundOpacity = normalizeOpacity(
        msg.overlayBackgroundOpacity,
        DEFAULT_OVERLAY_THEME.backgroundOpacity,
      );
      const overlayClickThrough = !!msg.overlayClickThrough;
      await chrome.storage.sync.set({
        trackedSites,
        overlayEnabled,
        overlayScale,
        overlayBackgroundColor,
        overlayTextColor,
        overlayBackgroundOpacity,
        overlayClickThrough,
      });

      const [tab] = await chrome.tabs
        .query({ active: true, currentWindow: true })
        .catch(() => []);
      if (tab?.id) await updateOverlay(tab.id);

      sendResponse({ ok: true });
      return;
    }

    if (msg?.type === "RESET_TODAY") {
      const key = todayKey();
      const storeKey = `time_${key}`;
      await chrome.storage.local.set({ [storeKey]: {} });

      lastTickMs = Date.now();
      await updateBadge(activeKey);

      sendResponse({ ok: true });
      return;
    }

    if (msg?.type === "REQUEST_OVERLAY_STATE") {
      const tabId = sender?.tab?.id;
      if (tabId) await updateOverlay(tabId);
      sendResponse({ ok: true });
    }
  })();

  return true;
});
