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

async function getSettings() {
  const { trackedSites, overlayEnabled } = await chrome.storage.sync.get({
    trackedSites: DEFAULT_SITES,
    overlayEnabled: true,
  });
  return { trackedSites, overlayEnabled };
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
  chrome.action.setBadgeBackgroundColor({ color: "#4caf50" });
  chrome.action.setBadgeText({ text });
}

async function updateOverlay(tabId, forceHide = false) {
  const { overlayEnabled, trackedSites } = await getSettings();

  if (!overlayEnabled || forceHide) {
    if (tabId) {
      chrome.tabs
        .sendMessage(tabId, { type: "OVERLAY_HIDE" })
        .catch(() => {});
    }
    return;
  }

  if (!tabId) return;

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
    chrome.tabs
      .sendMessage(tabId, { type: "OVERLAY_HIDE" })
      .catch(() => {});
    return;
  }

  chrome.tabs
    .sendMessage(tabId, { type: "OVERLAY_SHOW", key: match.key })
    .catch(() => {});
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
  chrome.tabs
    .sendMessage(activeTabId, { type: "OVERLAY_TICK" })
    .catch(() => {});
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
      await chrome.storage.sync.set({ trackedSites, overlayEnabled });

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
