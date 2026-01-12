const DEFAULT_SITES = ["chatgpt.com", "chatgpt.com/codex", "github.com", "x.com", "youtube.com", "music.youtube.com", "reddit.com"];

let activeTabId = null;
let activeKey = null;
let lastTickMs = null;
let activeWindowId = null;
let popupOpen = false;
let idleState = "active";

function todayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const DEFAULT_OVERLAY_THEME = {
  backgroundColor: "#0f172a",
  textColor: "#ffffff",
  backgroundOpacity: 0.92,
  clickThrough: true,
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

function normalizeTimeLimits(raw) {
  const limits = {};
  if (!raw || typeof raw !== "object") return limits;
  Object.entries(raw).forEach(([key, value]) => {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      limits[key] = parsed;
    }
  });
  return limits;
}

function normalizeTabLimits(raw) {
  const limits = {};
  if (!raw || typeof raw !== "object") return limits;
  Object.entries(raw).forEach(([key, value]) => {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      limits[key] = Math.floor(parsed);
    }
  });
  return limits;
}

async function getSettings() {
  const {
    trackedSites,
    overlayEnabled,
    overlayScale,
    overlayBackgroundColor,
    overlayTextColor,
    overlayBackgroundOpacity,
    menuTextScale,
    timeLimits,
    tabLimits,
  } = await chrome.storage.sync.get({
    trackedSites: DEFAULT_SITES,
    overlayEnabled: true,
    overlayScale: 1,
    overlayBackgroundColor: DEFAULT_OVERLAY_THEME.backgroundColor,
    overlayTextColor: DEFAULT_OVERLAY_THEME.textColor,
    overlayBackgroundOpacity: DEFAULT_OVERLAY_THEME.backgroundOpacity,
    menuTextScale: 1,
    timeLimits: {},
    tabLimits: {},
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
    overlayClickThrough: true,
    menuTextScale: Number.isFinite(Number.parseFloat(menuTextScale))
      ? Number.parseFloat(menuTextScale)
      : 1,
    timeLimits: normalizeTimeLimits(timeLimits),
    tabLimits: normalizeTabLimits(tabLimits),
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

function getUrlFromTab(tab) {
  return tab?.pendingUrl || tab?.url || null;
}

function getMatchForTab(tab, trackedSites) {
  const rawUrl = getUrlFromTab(tab);
  if (!rawUrl) return null;
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  return getMatchForUrl(url, trackedSites);
}

async function getTabsByKey(key, trackedSites) {
  const tabs = await chrome.tabs.query({});
  return tabs.filter((tab) => {
    const match = getMatchForTab(tab, trackedSites);
    return match?.key === key;
  });
}

async function enforceTabLimit(tab, settings = null) {
  if (!tab || !tab.id) return;
  const currentSettings = settings || (await getSettings());
  const match = getMatchForTab(tab, currentSettings.trackedSites);
  if (!match) return;
  const limit = Number(currentSettings.tabLimits?.[match.key]);
  if (!Number.isFinite(limit) || limit <= 0) return;

  const matching = await getTabsByKey(match.key, currentSettings.trackedSites);
  if (matching.length <= limit) return;

  await chrome.tabs.remove(tab.id);
}

async function sendTabStatusForKey(key, settings) {
  const limit = Number(settings.tabLimits?.[key]);
  if (!Number.isFinite(limit) || limit <= 0) return;
  const matching = await getTabsByKey(key, settings.trackedSites);
  const payload = {
    type: "OVERLAY_TAB_STATUS",
    key,
    tabCount: matching.length,
    tabLimit: limit,
  };
  for (const tab of matching) {
    if (!tab.id) continue;
    chrome.tabs.sendMessage(tab.id, payload).catch(() => {});
  }
}

async function sendTabStatusForTab(tab, settings = null) {
  const currentSettings = settings || (await getSettings());
  const match = getMatchForTab(tab, currentSettings.trackedSites);
  if (!match) return;
  await sendTabStatusForKey(match.key, currentSettings);
}

async function sendTabStatusForAll(settings = null) {
  const currentSettings = settings || (await getSettings());
  const keys = Object.keys(currentSettings.tabLimits || {});
  for (const key of keys) {
    await sendTabStatusForKey(key, currentSettings);
  }
}

async function enforceTabLimitsForAllTabs() {
  const settings = await getSettings();
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    await enforceTabLimit(tab, settings);
  }
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

async function getTodayTotalForKey(key) {
  const today = todayKey();
  const storeKey = `time_${today}`;
  const data = await chrome.storage.local.get({ [storeKey]: {} });
  return data[storeKey]?.[key] || 0;
}

async function setActiveFromTab(tab) {
  if (!tab || !tab.id || !tab.url) {
    activeTabId = null;
    activeKey = null;
    lastTickMs = null;
    activeWindowId = null;
    await updateBadge(null);
    if (tab?.id) sendMessageToTab(tab.id, { type: "BLOCK_HIDE" });
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
    activeWindowId = null;
    await updateBadge(null);
    sendMessageToTab(tab.id, { type: "BLOCK_HIDE" });
    return;
  }

  activeTabId = tab.id;
  activeKey = match.key;
  lastTickMs = canTrackTime() ? Date.now() : null;
  activeWindowId = tab.windowId ?? null;
  await updateBadge(activeKey);
  await updateBlockState(tab.id, activeKey);
}

async function flushActiveTime() {
  if (!activeKey || !lastTickMs) return;
  const now = Date.now();
  const delta = now - lastTickMs;
  lastTickMs = now;
  await addTimeForKey(activeKey, delta);
  await updateBadge(activeKey);
}

function canTrackTime() {
  return idleState === "active";
}

async function updateBadge(key) {
  if (!key) {
    chrome.action.setBadgeText({ text: "" });
    return;
  }
  const totalMs = await getTodayTotalForKey(key);
  const minutes = Math.floor(totalMs / 60000);
  const text = minutes ? `${minutes}m` : "0m";
  chrome.action.setBadgeBackgroundColor({ color: "#00539c" });
  chrome.action.setBadgeText({ text });
}

function sendMessageToTab(tabId, message) {
  if (!Number.isInteger(tabId)) return;
  chrome.tabs.sendMessage(tabId, message).catch(() => {});
}

async function updateBlockState(tabId, key) {
  if (!Number.isInteger(tabId)) return;
  if (!key) {
    sendMessageToTab(tabId, { type: "BLOCK_HIDE" });
    return;
  }
  const { timeLimits } = await getSettings();
  const limitMinutes = Number.parseFloat(timeLimits?.[key]);
  if (!Number.isFinite(limitMinutes) || limitMinutes <= 0) {
    sendMessageToTab(tabId, { type: "BLOCK_HIDE" });
    return;
  }
  const totalMs = await getTodayTotalForKey(key);
  if (totalMs >= limitMinutes * 60000) {
    sendMessageToTab(tabId, {
      type: "BLOCK_SHOW",
      key,
      limitMinutes,
      totalMs,
    });
  } else {
    sendMessageToTab(tabId, { type: "BLOCK_HIDE" });
  }
}

async function updateOverlay(tabId, forceHide = false) {
  const {
    overlayEnabled,
    trackedSites,
    overlayScale,
    overlayBackgroundColor,
    overlayTextColor,
    overlayBackgroundOpacity,
    timeLimits,
    tabLimits,
  } = await getSettings();

  if (!overlayEnabled || forceHide) {
    sendMessageToTab(tabId, { type: "OVERLAY_HIDE" });
    await updateBlockState(tabId, activeKey);
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
    sendMessageToTab(tabId, { type: "BLOCK_HIDE" });
    return;
  }

  let tabCount = null;
  const tabLimit = Number(tabLimits?.[match.key]);
  if (Number.isFinite(tabLimit) && tabLimit > 0) {
    const matching = await getTabsByKey(match.key, trackedSites);
    tabCount = matching.length;
  }

  sendMessageToTab(tabId, {
    type: "OVERLAY_SHOW",
    key: match.key,
    scale: overlayScale,
    backgroundColor: overlayBackgroundColor,
    textColor: overlayTextColor,
    backgroundOpacity: overlayBackgroundOpacity,
    clickThrough: true,
    limitMinutes: timeLimits?.[match.key],
    tabCount,
    tabLimit: Number.isFinite(tabLimit) && tabLimit > 0 ? tabLimit : null,
  });
  await updateBlockState(tabId, match.key);
}

chrome.idle.setDetectionInterval(15);

chrome.idle.queryState(15, (state) => {
  idleState = state;
  if (state !== "active") {
    lastTickMs = null;
  }
});

chrome.idle.onStateChanged.addListener(async (state) => {
  if (idleState === state) return;
  idleState = state;
  if (state === "active") {
    if (activeKey) {
      lastTickMs = Date.now();
    }
    return;
  }
  await flushActiveTime();
  lastTickMs = null;
});

setInterval(async () => {
  if (!activeTabId || !activeKey || !lastTickMs) return;
  if (!canTrackTime()) return;

  const tab = await chrome.tabs.get(activeTabId).catch(() => null);
  if (!tab) {
    activeTabId = null;
    activeKey = null;
    lastTickMs = null;
    activeWindowId = null;
    await updateBadge(null);
    return;
  }

  if (!tab.active) return;
  if (!popupOpen && Number.isInteger(activeWindowId)) {
    const windowInfo = await chrome.windows
      .get(activeWindowId)
      .catch(() => null);
    if (!windowInfo?.focused) return;
  }

  await flushActiveTime();
  sendMessageToTab(activeTabId, { type: "OVERLAY_TICK" });
  await updateBlockState(activeTabId, activeKey);
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

  await enforceTabLimit(tab);
  await sendTabStatusForTab(tab);
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (!canTrackTime()) {
    await flushActiveTime();
    lastTickMs = null;
    return;
  }
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    await flushActiveTime();
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
      const parsedMenuTextScale = Number.parseFloat(msg.menuTextScale);
      const menuTextScale = Number.isFinite(parsedMenuTextScale)
        ? parsedMenuTextScale
        : 1;
      const timeLimits = normalizeTimeLimits(msg.timeLimits);
      const tabLimits = normalizeTabLimits(msg.tabLimits);
      await chrome.storage.sync.set({
        trackedSites,
        overlayEnabled,
        overlayScale,
        overlayBackgroundColor,
        overlayTextColor,
        overlayBackgroundOpacity,
        menuTextScale,
        timeLimits,
        tabLimits,
      });

      const [tab] = await chrome.tabs
        .query({ active: true, currentWindow: true })
        .catch(() => []);
      if (tab?.id) await updateOverlay(tab.id);
      if (tab?.id) await updateBlockState(tab.id, activeKey);
      await enforceTabLimitsForAllTabs();
      await sendTabStatusForAll();

      sendResponse({ ok: true });
      return;
    }

    if (msg?.type === "RESET_TODAY") {
      const key = todayKey();
      const storeKey = `time_${key}`;
      await chrome.storage.local.set({ [storeKey]: {} });

      lastTickMs = Date.now();
      await updateBadge(activeKey);
      if (activeTabId) await updateBlockState(activeTabId, activeKey);

      sendResponse({ ok: true });
      return;
    }

    if (msg?.type === "POPUP_OPEN") {
      popupOpen = true;
      sendResponse({ ok: true });
      return;
    }

    if (msg?.type === "POPUP_CLOSED") {
      popupOpen = false;
      sendResponse({ ok: true });
      return;
    }

    if (msg?.type === "REQUEST_OVERLAY_STATE") {
      const tabId = sender?.tab?.id;
      if (tabId) await updateOverlay(tabId);
      sendResponse({ ok: true });
    }

    if (msg?.type === "REQUEST_BLOCK_STATE") {
      const tabId = sender?.tab?.id;
      if (tabId) await updateBlockState(tabId, activeKey);
      sendResponse({ ok: true });
    }

    if (msg?.type === "GET_ACTIVE_SITE_TOTAL") {
      const [tab] = await chrome.tabs
        .query({ active: true, currentWindow: true })
        .catch(() => []);
      if (!tab?.url) {
        sendResponse({ ok: true, tracked: false });
        return;
      }
      let url;
      try {
        url = new URL(tab.url);
      } catch {
        sendResponse({ ok: true, tracked: false });
        return;
      }
      const { trackedSites } = await getSettings();
      const match = getMatchForUrl(url, trackedSites);
      if (!match) {
        sendResponse({ ok: true, tracked: false });
        return;
      }
      const key = todayKey();
      const storeKey = `time_${key}`;
      const data = await chrome.storage.local.get({ [storeKey]: {} });
      sendResponse({
        ok: true,
        tracked: true,
        siteKey: match.key,
        totalMs: data[storeKey]?.[match.key] || 0,
      });
    }
  })();

  return true;
});

chrome.tabs.onCreated.addListener((tab) => {
  void enforceTabLimit(tab);
  void sendTabStatusForTab(tab);
});

chrome.tabs.onRemoved.addListener(() => {
  void sendTabStatusForAll();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") return;
  if (changes.timeLimits || changes.tabLimits || changes.trackedSites) {
    void enforceTabLimitsForAllTabs();
    void sendTabStatusForAll();
  }
});
