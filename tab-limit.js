const params = new URLSearchParams(window.location.search);
const targetUrl = params.get("targetUrl") || "";
const siteKey = params.get("key") || "";

const siteNameEl = document.getElementById("site-name");
const summaryEl = document.getElementById("summary");
const statusEl = document.getElementById("status");
const tabListEl = document.getElementById("tab-list");

let busy = false;
let refreshTimer = null;

function getSiteLabel() {
  try {
    return new URL(targetUrl).hostname.replace(/^www\./, "");
  } catch {
    return siteKey || "this site";
  }
}

function getFaviconUrl(pageUrl) {
  return chrome.runtime.getURL(
    `_favicon/?pageUrl=${encodeURIComponent(pageUrl)}&size=64`,
  );
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? "#fda4af" : "#fbbf24";
}

function setButtonsDisabled(disabled) {
  tabListEl.querySelectorAll("button").forEach((button) => {
    button.disabled = disabled;
  });
}

function createTabCard(tab) {
  const card = document.createElement("article");
  card.className = "tab-card";

  const iconWrap = document.createElement("div");
  iconWrap.className = "tab-icon-wrap";
  iconWrap.textContent = (tab.title || "T").trim().charAt(0).toUpperCase() || "T";

  if (tab.url) {
    const icon = document.createElement("img");
    icon.className = "tab-icon";
    icon.alt = "";
    icon.src = getFaviconUrl(tab.url);
    icon.addEventListener("load", () => {
      iconWrap.textContent = "";
      iconWrap.appendChild(icon);
    });
    icon.addEventListener("error", () => icon.remove());
  }

  const copy = document.createElement("div");
  copy.className = "tab-copy";
  const title = document.createElement("div");
  title.className = "tab-title";
  title.textContent = tab.title || "Untitled tab";
  const url = document.createElement("div");
  url.className = "tab-url";
  url.textContent = tab.url || "";
  copy.append(title, url);

  const button = document.createElement("button");
  button.className = "close-button";
  button.type = "button";
  button.textContent = "Close and continue";
  button.addEventListener("click", () => closeAndContinue(tab.id, button));

  card.append(iconWrap, copy, button);
  return card;
}

function renderState(state) {
  tabListEl.textContent = "";
  if (state.limit === 0) {
    summaryEl.textContent = `${getSiteLabel()} is currently limited to 0 tabs.`;
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent =
      "Change this site's tab limit in the extension settings to continue.";
    tabListEl.appendChild(empty);
    return;
  }

  const count = state.candidates.length;
  const noun = count === 1 ? "tab" : "tabs";
  summaryEl.textContent = `${count} open ${noun} for ${getSiteLabel()} - choose one to close.`;

  if (!count) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent =
      "Waiting for an available tab slot. This page will continue automatically.";
    tabListEl.appendChild(empty);
    return;
  }

  state.candidates.forEach((tab) => tabListEl.appendChild(createTabCard(tab)));
}

async function loadState() {
  if (busy) return;
  if (!targetUrl) {
    setStatus("The original site address is missing.", true);
    return;
  }

  try {
    const response = await chrome.runtime.sendMessage({
      type: "GET_TAB_LIMIT_STATE",
      targetUrl,
    });
    if (!response?.ok) {
      setStatus(response?.error || "The tab list could not be loaded.", true);
      return;
    }
    if (response.continuing) {
      busy = true;
      setStatus("A tab slot is available. Continuing...");
      return;
    }
    setStatus("");
    renderState(response);
  } catch {
    setStatus(
      "The tab list could not be loaded. Reload this page to try again.",
      true,
    );
  }
}

async function closeAndContinue(targetTabId, button) {
  if (busy) return;
  busy = true;
  setButtonsDisabled(true);
  button.textContent = "Closing...";
  setStatus("Closing the selected tab and continuing...");

  try {
    const response = await chrome.runtime.sendMessage({
      type: "CLOSE_TAB_AND_CONTINUE",
      targetTabId,
      targetUrl,
    });
    if (response?.ok && response.continuing) return;
    busy = false;
    setStatus(response?.error || "The tab could not be closed.", true);
    await loadState();
  } catch {
    busy = false;
    setStatus("The tab could not be closed. Please try again.", true);
    setButtonsDisabled(false);
    button.textContent = "Close and continue";
  }
}

siteNameEl.textContent = getSiteLabel();
loadState();
refreshTimer = window.setInterval(loadState, 1500);
window.addEventListener("pagehide", () => window.clearInterval(refreshTimer));
