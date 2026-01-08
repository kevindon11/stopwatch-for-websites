const DEFAULT_SITES = ["chatgpt.com", "x.com", "youtube.com", "reddit.com"];

let activeTabId = null;
let activeHostname = null;
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

function hostMatchesList(hostname, list) {
  const normalized = normalizeHost(hostname);
  return list.some((entry) => {
    const value = normalizeHost(entry.trim());
    if (!value) return false;
    return normalized === value || normalized.endsWith(`.${value}`);
  });
}

async function addTimeForHost(hostname, deltaMs) {
  if (!hostname || deltaMs <= 0) return;

  const key = todayKey();
  const storeKey = `time_${key}`;
  const data = await chrome.storage.local.get({ [storeKey]: {} });
  const perHost = data[storeKey] || {};

  const normalized = normalizeHost(hostname);
  perHost[normalized] = (perHost[normalized] || 0) + deltaMs;

  await chrome.storage.local.set({ [storeKey]: perHost });
}

async function setActiveFromTab(tab) {
  if (!tab || !tab.id || !tab.url) {
    activeTabId = null;
    activeHostname = null;
    lastTickMs = null;
    return;
  }

  let url;
  try {
    url = new URL(tab.url);
  } catch {
    activeTabId = null;
    activeHostname = null;
    lastTickMs = null;
    return;
  }

  const { trackedSites } = await getSettings();
  const hostname = normalizeHost(url.hostname);

  if (!hostMatchesList(hostname, trackedSites)) {
    activeTabId = null;
    activeHostname = null;
    lastTickMs = null;
    return;
  }

  activeTabId = tab.id;
  activeHostname = hostname;
  lastTickMs = Date.now();
}

async function flushActiveTime() {
  if (!activeHostname || !lastTickMs) return;
  const now = Date.now();
  const delta = now - lastTickMs;
  lastTickMs = now;
  await addTimeForHost(activeHostname, delta);
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

  const hostname = normalizeHost(url.hostname);
  const shouldShow = hostMatchesList(hostname, trackedSites);

  if (!shouldShow) {
    chrome.tabs
      .sendMessage(tabId, { type: "OVERLAY_HIDE" })
      .catch(() => {});
    return;
  }

  chrome.tabs
    .sendMessage(tabId, { type: "OVERLAY_SHOW", hostname })
    .catch(() => {});
}

setInterval(async () => {
  if (!activeTabId || !activeHostname || !lastTickMs) return;

  const tab = await chrome.tabs.get(activeTabId).catch(() => null);
  if (!tab) {
    activeTabId = null;
    activeHostname = null;
    lastTickMs = null;
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
