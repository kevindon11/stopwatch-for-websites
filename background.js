const DEFAULT_SITES = ["chatgpt.com", "chatgpt.com/codex", "github.com", "x.com", "youtube.com", "music.youtube.com", "reddit.com"];

let activeTabId = null;
let activeKey = null;
let lastTickMs = null;
let activeWindowId = null;
let popupOpen = false;
let isScreenLocked = false;
const newTabIds = new Set();
const lastActivityByTabId = new Map();
const TAB_LIMIT_ALLOWLIST_KEY = "tabLimitAllowlist";
const IDLE_CURSOR_PAUSE_MS = 60000;
const BREAK_WARNING_WINDOW_MS = 10000;
const breakWarningSent = new Set();
const entryDelayByTabId = new Map();

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

function normalizeBreakLimits(raw) {
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

function normalizeWaitLimits(raw) {
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

function normalizeEntryDelayLimits(raw) {
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
    breakAfterLimits,
    breakDurationLimits,
    waitLimits,
    entryDelayLimits,
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
    breakAfterLimits: {},
    breakDurationLimits: {},
    waitLimits: {},
    entryDelayLimits: {},
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
    breakAfterLimits: normalizeBreakLimits(breakAfterLimits),
    breakDurationLimits: normalizeBreakLimits(breakDurationLimits),
    waitLimits: normalizeWaitLimits(waitLimits),
    entryDelayLimits: normalizeEntryDelayLimits(entryDelayLimits),
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

function extractSuspendedTargetUrl(url) {
  if (!url || url.protocol !== "chrome-extension:") return null;
  const filename = url.pathname.split("/").pop();
  if (filename !== "suspended.html") return null;
  const rawHash = url.hash ? url.hash.slice(1) : "";
  const params = new URLSearchParams(rawHash);
  const target =
    params.get("uri") ||
    params.get("url") ||
    params.get("target") ||
    params.get("tabUrl");
  if (!target) return null;
  try {
    return new URL(target);
  } catch {
    return null;
  }
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

function buildSiteKeyMap(entries = []) {
  const map = new Map();
  entries.forEach((entry) => {
    const parsed = parseTrackedEntry(entry);
    if (!parsed) return;
    map.set(parsed.key, entry);
  });
  return map;
}

function getMatchForUrl(url, list) {
  const suspendedTarget = extractSuspendedTargetUrl(url);
  if (suspendedTarget) {
    if (suspendedTarget.href === url.href) return null;
    return getMatchForUrl(suspendedTarget, list);
  }
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

function normalizeTabLimitAllowlist(raw) {
  const allowlist = {};
  if (!raw || typeof raw !== "object") return allowlist;
  Object.entries(raw).forEach(([key, value]) => {
    if (!Array.isArray(value)) return;
    const unique = Array.from(
      new Set(value.filter((id) => Number.isInteger(id))),
    );
    if (unique.length) {
      allowlist[key] = unique;
    }
  });
  return allowlist;
}

async function getTabLimitAllowlist() {
  const data = await chrome.storage.local.get({ [TAB_LIMIT_ALLOWLIST_KEY]: {} });
  return normalizeTabLimitAllowlist(data[TAB_LIMIT_ALLOWLIST_KEY]);
}

async function setTabLimitAllowlist(allowlist) {
  await chrome.storage.local.set({
    [TAB_LIMIT_ALLOWLIST_KEY]: allowlist,
  });
}

async function updateAllowlistForTab(tab, settings = null) {
  if (!Number.isInteger(tab?.id)) return;
  const allowlist = await getTabLimitAllowlist();
  if (!Object.keys(allowlist).length) return;
  const currentSettings = settings || (await getSettings());
  const match = getMatchForTab(tab, currentSettings.trackedSites);
  const currentKey = match?.key || null;
  let changed = false;
  for (const [key, ids] of Object.entries(allowlist)) {
    if (key === currentKey) continue;
    const nextIds = ids.filter((id) => id !== tab.id);
    if (nextIds.length !== ids.length) {
      changed = true;
      if (nextIds.length) {
        allowlist[key] = nextIds;
      } else {
        delete allowlist[key];
      }
    }
  }
  if (changed) {
    await setTabLimitAllowlist(allowlist);
  }
}

async function pruneAllowlistForKey(key, matchingTabs, allowlist) {
  const matchingIds = new Set(
    matchingTabs.map((tab) => tab.id).filter((id) => Number.isInteger(id)),
  );
  const allowed = new Set(allowlist[key] || []);
  const nextAllowed = Array.from(allowed).filter((id) => matchingIds.has(id));
  if (nextAllowed.length) {
    allowlist[key] = nextAllowed;
  } else if (key in allowlist) {
    delete allowlist[key];
  }
  return new Set(nextAllowed);
}

async function refreshAllowlistForTabLimitKeys(keys, settings) {
  if (!keys.length) return;
  const allowlist = await getTabLimitAllowlist();
  for (const key of keys) {
    const limit = Number(settings.tabLimits?.[key]);
    if (!Number.isFinite(limit) || limit <= 0) {
      if (key in allowlist) {
        delete allowlist[key];
      }
      continue;
    }
    const matching = await getTabsByKey(key, settings.trackedSites);
    const ids = matching
      .map((tab) => tab.id)
      .filter((id) => Number.isInteger(id));
    if (ids.length) {
      allowlist[key] = Array.from(new Set(ids));
    } else if (key in allowlist) {
      delete allowlist[key];
    }
  }
  await setTabLimitAllowlist(allowlist);
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
  const allowlist = await getTabLimitAllowlist();
  const allowedIds = await pruneAllowlistForKey(
    match.key,
    matching,
    allowlist,
  );
  await setTabLimitAllowlist(allowlist);
  if (matching.length <= limit) return;

  if (allowedIds.has(tab.id)) return;
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

function getCycleStoreKey() {
  return `cycle_${todayKey()}`;
}

function getCycleUpdatedStoreKey() {
  return `cycle_updated_${todayKey()}`;
}

function getCooldownStoreKey() {
  return `cooldown_${todayKey()}`;
}

async function getCycleTimeForKey(key) {
  const storeKey = getCycleStoreKey();
  const data = await chrome.storage.local.get({ [storeKey]: {} });
  return data[storeKey]?.[key] || 0;
}

async function getEditLocks() {
  const data = await chrome.storage.local.get({ editLocks: {} });
  return data.editLocks || {};
}

async function setEditLocks(locks) {
  await chrome.storage.local.set({ editLocks: locks });
}

async function setCycleTimeForKey(key, value) {
  const storeKey = getCycleStoreKey();
  const data = await chrome.storage.local.get({ [storeKey]: {} });
  const perKey = data[storeKey] || {};
  perKey[key] = value;
  await chrome.storage.local.set({ [storeKey]: perKey });
}

async function getCycleUpdatedForKey(key) {
  const storeKey = getCycleUpdatedStoreKey();
  const data = await chrome.storage.local.get({ [storeKey]: {} });
  return data[storeKey]?.[key] || 0;
}

async function setCycleUpdatedForKey(key, timestamp) {
  const storeKey = getCycleUpdatedStoreKey();
  const data = await chrome.storage.local.get({ [storeKey]: {} });
  const perKey = data[storeKey] || {};
  perKey[key] = timestamp;
  await chrome.storage.local.set({ [storeKey]: perKey });
}

async function applyCycleDecayForKey(key, now) {
  if (!key) return 0;
  const [cycleMs, lastUpdated] = await Promise.all([
    getCycleTimeForKey(key),
    getCycleUpdatedForKey(key),
  ]);
  if (!lastUpdated) {
    await setCycleUpdatedForKey(key, now);
    return cycleMs;
  }
  const elapsed = now - lastUpdated;
  if (elapsed <= 0) return cycleMs;
  const next = Math.max(0, cycleMs - elapsed);
  if (next !== cycleMs || lastUpdated !== now) {
    await setCycleTimeForKey(key, next);
    await setCycleUpdatedForKey(key, now);
  }
  return next;
}

async function addCycleTimeForKey(key, deltaMs) {
  if (!key || deltaMs <= 0) return 0;
  const storeKey = getCycleStoreKey();
  const data = await chrome.storage.local.get({ [storeKey]: {} });
  const perKey = data[storeKey] || {};
  const next = (perKey[key] || 0) + deltaMs;
  perKey[key] = next;
  await chrome.storage.local.set({ [storeKey]: perKey });
  await setCycleUpdatedForKey(key, Date.now());
  return next;
}

async function getCooldownUntilForKey(key) {
  const storeKey = getCooldownStoreKey();
  const data = await chrome.storage.local.get({ [storeKey]: {} });
  return data[storeKey]?.[key] || 0;
}

async function setCooldownUntilForKey(key, timestamp) {
  const storeKey = getCooldownStoreKey();
  const data = await chrome.storage.local.get({ [storeKey]: {} });
  const perKey = data[storeKey] || {};
  perKey[key] = timestamp;
  await chrome.storage.local.set({ [storeKey]: perKey });
}

async function resetCooldownStateForKey(key) {
  await setCycleTimeForKey(key, 0);
  await setCycleUpdatedForKey(key, Date.now());
  await setCooldownUntilForKey(key, 0);
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
  const now = Date.now();
  lastActivityByTabId.set(tab.id, now);
  await applyCycleDecayForKey(activeKey, now);
  await updateBadge(activeKey);
  await updateBlockState(tab.id, activeKey);
}

async function flushActiveTime() {
  if (!activeKey || !lastTickMs) return;
  const now = Date.now();
  const settings = await getSettings();
  const lastActivity = lastActivityByTabId.get(activeTabId);
  let delta = now - lastTickMs;
  if (Number.isFinite(lastActivity)) {
    const idleStartedAt = lastActivity + IDLE_CURSOR_PAUSE_MS;
    if (now >= idleStartedAt) {
      if (idleStartedAt <= lastTickMs) {
        lastTickMs = now;
        return;
      }
      delta = idleStartedAt - lastTickMs;
    }
  }
  lastTickMs = now;
  if (delta <= 0) return;
  const breakAfterMinutes = Number.parseFloat(
    settings.breakAfterLimits?.[activeKey],
  );
  const breakDurationMinutes = Number.parseFloat(
    settings.breakDurationLimits?.[activeKey],
  );
  const hasBreakConfig =
    Number.isFinite(breakAfterMinutes) &&
    breakAfterMinutes > 0 &&
    Number.isFinite(breakDurationMinutes) &&
    breakDurationMinutes > 0;

  if (hasBreakConfig) {
    const blockedUntil = await getCooldownUntilForKey(activeKey);
    if (Number.isFinite(blockedUntil) && blockedUntil > now) {
      return;
    }
  }

  await addTimeForKey(activeKey, delta);

  if (hasBreakConfig) {
    const cycleMs = await addCycleTimeForKey(activeKey, delta);
    const thresholdMs = breakAfterMinutes * 60000;
    if (cycleMs < thresholdMs - BREAK_WARNING_WINDOW_MS) {
      breakWarningSent.delete(activeKey);
    } else {
      const remainingMs = thresholdMs - cycleMs;
      if (
        remainingMs > 0 &&
        remainingMs <= BREAK_WARNING_WINDOW_MS &&
        !breakWarningSent.has(activeKey)
      ) {
        if (Number.isInteger(activeTabId)) {
          sendMessageToTab(activeTabId, {
            type: "BREAK_WARNING",
            remainingMs,
          });
        }
        breakWarningSent.add(activeKey);
      }
    }
    if (cycleMs >= thresholdMs) {
      const blockedUntil = now + breakDurationMinutes * 60000;
      await setCooldownUntilForKey(activeKey, blockedUntil);
      await setCycleTimeForKey(activeKey, 0);
      await setCycleUpdatedForKey(activeKey, now);
      breakWarningSent.delete(activeKey);
    }
  }

  await updateBadge(activeKey);
}

function canTrackTime() {
  if (!activeTabId) return false;
  if (isScreenLocked) return false;
  const lastActivity = lastActivityByTabId.get(activeTabId);
  if (!Number.isFinite(lastActivity)) return false;
  return Date.now() - lastActivity <= IDLE_CURSOR_PAUSE_MS;
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

function getEntryDelayBlockedUntil(tabId, key, entryDelayMinutes) {
  if (!Number.isInteger(tabId)) return 0;
  if (!Number.isFinite(entryDelayMinutes) || entryDelayMinutes <= 0) return 0;

  const now = Date.now();
  const existing = entryDelayByTabId.get(tabId);
  if (existing && existing.key === key) {
    if (existing.blockedUntil > now) {
      return existing.blockedUntil;
    }
    return 0;
  }

  const blockedUntil = now + entryDelayMinutes * 60000;
  entryDelayByTabId.set(tabId, { key, blockedUntil });
  return blockedUntil;
}

async function updateBlockState(tabId, key) {
  if (!Number.isInteger(tabId)) return;
  if (!key) {
    sendMessageToTab(tabId, { type: "BLOCK_HIDE" });
    return;
  }
  const settings = await getSettings();
  const { timeLimits, breakAfterLimits, breakDurationLimits, entryDelayLimits } = settings;
  const limitMinutes = Number.parseFloat(timeLimits?.[key]);
  if (!Number.isFinite(limitMinutes) || limitMinutes <= 0) {
    // continue to break check
  } else {
    const totalMs = await getTodayTotalForKey(key);
    if (totalMs >= limitMinutes * 60000) {
      sendMessageToTab(tabId, {
        type: "BLOCK_SHOW",
        key,
        limitMinutes,
        totalMs,
        reason: "daily",
      });
      return;
    }
  }

  const breakAfterMinutes = Number.parseFloat(breakAfterLimits?.[key]);
  const breakDurationMinutes = Number.parseFloat(breakDurationLimits?.[key]);
  const hasBreakConfig =
    Number.isFinite(breakAfterMinutes) &&
    breakAfterMinutes > 0 &&
    Number.isFinite(breakDurationMinutes) &&
    breakDurationMinutes > 0;
  if (hasBreakConfig) {
    const blockedUntil = await getCooldownUntilForKey(key);
    const now = Date.now();
    if (Number.isFinite(blockedUntil) && blockedUntil > now) {
      sendMessageToTab(tabId, {
        type: "BLOCK_SHOW",
        key,
        reason: "cooldown",
        blockedUntil,
        breakAfterMinutes,
        breakDurationMinutes,
      });
      return;
    }
  }

  const entryDelayMinutes = Number.parseFloat(entryDelayLimits?.[key]);
  if (Number.isFinite(entryDelayMinutes) && entryDelayMinutes > 0) {
    const blockedUntil = getEntryDelayBlockedUntil(tabId, key, entryDelayMinutes);
    if (Number.isFinite(blockedUntil) && blockedUntil > Date.now()) {
      sendMessageToTab(tabId, {
        type: "BLOCK_SHOW",
        key,
        reason: "entryDelay",
        blockedUntil,
        entryDelayMinutes,
      });
      return;
    }
  }

  sendMessageToTab(tabId, { type: "BLOCK_HIDE" });
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

chrome.idle?.setDetectionInterval?.(15);
chrome.idle?.onStateChanged?.addListener(async (state) => {
  if (state === "locked") {
    isScreenLocked = true;
    await flushActiveTime();
    lastTickMs = null;
    return;
  }
  if (state === "active") {
    isScreenLocked = false;
  }
});

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

  await updateAllowlistForTab(tab);
  await enforceTabLimit(tab);

  if (newTabIds.has(tabId)) {
    newTabIds.delete(tabId);
  }
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
      const existingSettings = await getSettings();
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
      const breakAfterLimits = normalizeBreakLimits(msg.breakAfterLimits);
      const breakDurationLimits = normalizeBreakLimits(msg.breakDurationLimits);
      const waitLimits = normalizeWaitLimits(msg.waitLimits);
      const entryDelayLimits = normalizeEntryDelayLimits(msg.entryDelayLimits);
      const tabLimits = normalizeTabLimits(msg.tabLimits);
      const tabLimitKeys = new Set([
        ...Object.keys(existingSettings.tabLimits || {}),
        ...Object.keys(tabLimits || {}),
      ]);
      const changedTabLimitKeys = [];
      for (const key of tabLimitKeys) {
        if ((existingSettings.tabLimits?.[key] ?? null) !==
          (tabLimits[key] ?? null)) {
          changedTabLimitKeys.push(key);
        }
      }

      const lockMap = await getEditLocks();
      const now = Date.now();
      const existingSites = buildSiteKeyMap(existingSettings.trackedSites);
      const nextSites = buildSiteKeyMap(trackedSites);
      const lockedKeys = Object.entries(lockMap)
        .filter(([, lockedUntil]) => Number(lockedUntil) > now)
        .map(([key]) => key);

      const hasChangesForKey = (key) => {
        const currentSite = existingSites.get(key);
        const nextSite = nextSites.get(key);
        if (!nextSite) return true;
        if (currentSite && currentSite !== nextSite) return true;
        if ((existingSettings.timeLimits?.[key] ?? null) !==
          (timeLimits[key] ?? null)) {
          return true;
        }
        if ((existingSettings.breakAfterLimits?.[key] ?? null) !==
          (breakAfterLimits[key] ?? null)) {
          return true;
        }
        if ((existingSettings.breakDurationLimits?.[key] ?? null) !==
          (breakDurationLimits[key] ?? null)) {
          return true;
        }
        if ((existingSettings.waitLimits?.[key] ?? null) !==
          (waitLimits[key] ?? null)) {
          return true;
        }
        if ((existingSettings.entryDelayLimits?.[key] ?? null) !==
          (entryDelayLimits[key] ?? null)) {
          return true;
        }
        if ((existingSettings.tabLimits?.[key] ?? null) !==
          (tabLimits[key] ?? null)) {
          return true;
        }
        return false;
      };

      for (const key of lockedKeys) {
        if (hasChangesForKey(key)) {
          sendResponse({
            ok: false,
            error: "This site is locked from edits. Please wait before updating its settings.",
          });
          return;
        }
      }

      await chrome.storage.sync.set({
        trackedSites,
        overlayEnabled,
        overlayScale,
        overlayBackgroundColor,
        overlayTextColor,
        overlayBackgroundOpacity,
        menuTextScale,
        timeLimits,
        breakAfterLimits,
        breakDurationLimits,
        waitLimits,
        entryDelayLimits,
        tabLimits,
      });
      await refreshAllowlistForTabLimitKeys(changedTabLimitKeys, {
        trackedSites,
        tabLimits,
      });

      const nextLocks = { ...lockMap };
      for (const [key] of nextSites) {
        const waitMinutes = Number.parseFloat(waitLimits[key]);
        const didChange = hasChangesForKey(key);
        if (didChange) {
          if (Number.isFinite(waitMinutes) && waitMinutes > 0) {
            nextLocks[key] = now + waitMinutes * 60000;
          } else {
            delete nextLocks[key];
          }
        } else if (!Number.isFinite(waitMinutes) || waitMinutes <= 0) {
          delete nextLocks[key];
        }
      }
      for (const key of Object.keys(nextLocks)) {
        if (!nextSites.has(key)) {
          delete nextLocks[key];
        }
      }
      for (const [tabId, entryDelayState] of entryDelayByTabId.entries()) {
        if (!nextSites.has(entryDelayState.key)) {
          entryDelayByTabId.delete(tabId);
        }
      }
      await setEditLocks(nextLocks);

      const [tab] = await chrome.tabs
        .query({ active: true, currentWindow: true })
        .catch(() => []);
      if (tab?.id) await updateOverlay(tab.id);
      if (tab?.id) await updateBlockState(tab.id, activeKey);
      await sendTabStatusForAll();

      sendResponse({ ok: true });
      return;
    }

    if (msg?.type === "RESET_TODAY") {
      const key = todayKey();
      const storeKey = `time_${key}`;
      await chrome.storage.local.set({ [storeKey]: {} });
      const cycleKey = `cycle_${key}`;
      const cooldownKey = `cooldown_${key}`;
      const cycleUpdatedKey = `cycle_updated_${key}`;
      await chrome.storage.local.set({
        [cycleKey]: {},
        [cooldownKey]: {},
        [cycleUpdatedKey]: {},
      });
      breakWarningSent.clear();

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

    if (msg?.type === "GET_EDIT_LOCKS") {
      const settings = await getSettings();
      const waitLimits = normalizeWaitLimits(settings.waitLimits);
      const existingLocks = await getEditLocks();
      const now = Date.now();
      const nextLocks = { ...existingLocks };
      let changed = false;

      for (const [key, value] of Object.entries(waitLimits)) {
        const waitMinutes = Number.parseFloat(value);
        if (!Number.isFinite(waitMinutes) || waitMinutes <= 0) {
          if (key in nextLocks) {
            delete nextLocks[key];
            changed = true;
          }
          continue;
        }
        const lockUntil = now + waitMinutes * 60000;
        const existingUntil = Number.parseInt(nextLocks[key], 10);
        if (!Number.isFinite(existingUntil) || existingUntil < lockUntil) {
          nextLocks[key] = lockUntil;
          changed = true;
        }
      }

      for (const key of Object.keys(nextLocks)) {
        if (!(key in waitLimits)) {
          delete nextLocks[key];
          changed = true;
        }
      }

      if (changed) {
        await setEditLocks(nextLocks);
      }
      sendResponse({ ok: true, locks: nextLocks });
      return;
    }

    if (msg?.type === "USER_ACTIVITY") {
      const tabId = sender?.tab?.id;
      if (Number.isInteger(tabId)) {
        lastActivityByTabId.set(tabId, Date.now());
        if (tabId === activeTabId && activeKey && !lastTickMs) {
          if (canTrackTime()) {
            lastTickMs = Date.now();
          }
        }
      }
      sendResponse({ ok: true });
      return;
    }
  })();

  return true;
});

chrome.tabs.onCreated.addListener((tab) => {
  if (Number.isInteger(tab?.id)) {
    newTabIds.add(tab.id);
  }
  void enforceTabLimit(tab);
  void sendTabStatusForTab(tab);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  lastActivityByTabId.delete(tabId);
  entryDelayByTabId.delete(tabId);
  void (async () => {
    const allowlist = await getTabLimitAllowlist();
    let changed = false;
    for (const [key, ids] of Object.entries(allowlist)) {
      const nextIds = ids.filter((id) => id !== tabId);
      if (nextIds.length !== ids.length) {
        changed = true;
        if (nextIds.length) {
          allowlist[key] = nextIds;
        } else {
          delete allowlist[key];
        }
      }
    }
    if (changed) {
      await setTabLimitAllowlist(allowlist);
    }
  })();
  void sendTabStatusForAll();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") return;
  if (changes.timeLimits || changes.tabLimits || changes.trackedSites) {
    void sendTabStatusForAll();
  }
});
