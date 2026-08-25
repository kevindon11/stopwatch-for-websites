const params = new URLSearchParams(location.search);
const target = params.get("target") || "";
const key = params.get("key") || "";
const tabsEl = document.querySelector("#tabs");
const countEl = document.querySelector("#count");
const siteEl = document.querySelector("#site");
const statusEl = document.querySelector("#status");

function safeHost(url) {
  try { return new URL(url).hostname; } catch { return key; }
}

function fallbackIcon() {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#334155"/><path d="M9 10h14v12H9z" fill="none" stroke="#cbd5e1" stroke-width="2"/></svg>';
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

async function closeAndContinue(tabId) {
  document.querySelectorAll("button").forEach((button) => { button.disabled = true; });
  statusEl.textContent = "Closing the selected tab…";
  const response = await chrome.runtime.sendMessage({
    type: "CLOSE_TAB_AND_CONTINUE", tabId, target, key,
  });
  if (!response?.ok) {
    statusEl.textContent = response?.error || "That tab could not be closed. Refreshing the list…";
    await render();
  }
}

async function render() {
  const response = await chrome.runtime.sendMessage({
    type: "GET_TAB_LIMIT_CONTEXT", target, key,
  });
  if (!response?.ok) {
    statusEl.textContent = "This tab limit is no longer active. You can close this page and try again.";
    return;
  }
  const { context } = response;
  siteEl.textContent = safeHost(context.target);
  countEl.textContent = `${context.tabs.length} open · limit ${context.limit}`;
  tabsEl.replaceChildren();

  if (context.canContinue) {
    statusEl.textContent = "A space is available. Continuing…";
    await chrome.runtime.sendMessage({ type: "CONTINUE_AFTER_TAB_CLOSED", target, key });
    return;
  }

  if (!context.tabs.length) {
    statusEl.textContent = context.limit === 0
      ? "This site’s tab limit is set to 0. Change the limit in the extension options to continue."
      : "No open tabs were found. Try refreshing this page.";
    return;
  }

  for (const tab of context.tabs) {
    const button = document.createElement("button");
    button.className = "tab-card";
    button.type = "button";
    button.setAttribute("aria-label", `Close ${tab.title} and continue`);

    const icon = document.createElement("img");
    icon.className = "favicon-preview";
    icon.alt = "";
    icon.src = tab.favIconUrl || fallbackIcon();
    icon.addEventListener("error", () => { icon.src = fallbackIcon(); }, { once: true });

    const copy = document.createElement("span");
    copy.className = "tab-copy";
    const title = document.createElement("span");
    title.className = "tab-title";
    title.textContent = tab.title;
    const url = document.createElement("span");
    url.className = "tab-url";
    url.textContent = tab.url;
    copy.append(title, url);

    const action = document.createElement("span");
    action.className = "close-label";
    action.textContent = "Close & continue";
    button.append(icon, copy, action);
    button.addEventListener("click", () => closeAndContinue(tab.id));
    tabsEl.appendChild(button);
  }
  statusEl.textContent = "";
}

render();
