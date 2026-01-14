const limitsList = document.getElementById("limits-list");
const addButton = document.getElementById("add-site");
const status = document.getElementById("status");

let cachedSettings = null;

function normalizeHost(hostname) {
  return (hostname || "").toLowerCase().replace(/^www\./, "");
}

function normalizePath(pathname) {
  if (!pathname || pathname === "/") return "";
  const trimmed = pathname.replace(/\/+$/, "");
  return trimmed === "/" ? "" : trimmed;
}

function normalizeTrackedEntry(entry) {
  const raw = entry?.trim();
  if (!raw) return "";
  let url;
  try {
    url = new URL(raw.includes("://") ? raw : `https://${raw}`);
  } catch {
    return "";
  }
  const host = normalizeHost(url.hostname);
  if (!host) return "";
  const path = normalizePath(url.pathname);
  return `${host}${path}`;
}

function parseLimit(value) {
  if (value === "" || value == null) return null;
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function parseTabLimit(value) {
  const parsed = parseLimit(value);
  return parsed == null ? null : Math.floor(parsed);
}

function parseIdleLimit(value) {
  const parsed = parseLimit(value);
  return parsed == null ? null : Math.floor(parsed);
}

function createRow(entry = {}) {
  const row = document.createElement("div");
  row.className = "limit-row";

  const siteInput = document.createElement("input");
  siteInput.type = "text";
  siteInput.placeholder = "example.com";
  siteInput.value = entry.site || "";
  siteInput.required = true;

  const timeInput = document.createElement("input");
  timeInput.type = "number";
  timeInput.min = "1";
  timeInput.step = "1";
  timeInput.placeholder = "—";
  timeInput.value = entry.timeLimit || "";

  const tabInput = document.createElement("input");
  tabInput.type = "number";
  tabInput.min = "1";
  tabInput.step = "1";
  tabInput.placeholder = "—";
  tabInput.value = entry.tabLimit || "";

  const breakAfterInput = document.createElement("input");
  breakAfterInput.type = "number";
  breakAfterInput.min = "1";
  breakAfterInput.step = "1";
  breakAfterInput.placeholder = "—";
  breakAfterInput.value = entry.breakAfter || "";

  const breakDurationInput = document.createElement("input");
  breakDurationInput.type = "number";
  breakDurationInput.min = "1";
  breakDurationInput.step = "1";
  breakDurationInput.placeholder = "—";
  breakDurationInput.value = entry.breakDuration || "";

  const idleAfterInput = document.createElement("input");
  idleAfterInput.type = "number";
  idleAfterInput.min = "1";
  idleAfterInput.step = "1";
  idleAfterInput.placeholder = "—";
  idleAfterInput.value = entry.idleAfter || "";

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.textContent = "Remove";
  removeButton.addEventListener("click", () => {
    row.remove();
  });

  row.appendChild(siteInput);
  row.appendChild(timeInput);
  row.appendChild(breakAfterInput);
  row.appendChild(breakDurationInput);
  row.appendChild(idleAfterInput);
  row.appendChild(tabInput);
  row.appendChild(removeButton);
  return row;
}

function setStatus(message, tone = "ok") {
  status.textContent = message;
  status.style.color = tone === "error" ? "#b91c1c" : "#0f766e";
}

async function loadOptions() {
  const settingsRes = await chrome.runtime.sendMessage({ type: "GET_SETTINGS" });
  cachedSettings = settingsRes?.settings || {};
  const trackedSites = cachedSettings.trackedSites || [];
  const timeLimits = cachedSettings.timeLimits || {};
  const breakAfterLimits = cachedSettings.breakAfterLimits || {};
  const breakDurationLimits = cachedSettings.breakDurationLimits || {};
  const idleAfterLimits = cachedSettings.idleAfterLimits || {};
  const tabLimits = cachedSettings.tabLimits || {};
  limitsList.innerHTML = "";

  if (!trackedSites.length) {
    limitsList.appendChild(createRow());
    return;
  }

  trackedSites.forEach((site) => {
    const key = normalizeTrackedEntry(site);
    limitsList.appendChild(
      createRow({
        site,
        timeLimit: timeLimits[key] ?? "",
        breakAfter: breakAfterLimits[key] ?? "",
        breakDuration: breakDurationLimits[key] ?? "",
        idleAfter: idleAfterLimits[key] ?? "",
        tabLimit: tabLimits[key] ?? "",
      }),
    );
  });
}

async function saveOptions(event) {
  event.preventDefault();
  const rows = Array.from(limitsList.querySelectorAll(".limit-row"));
  const trackedSites = [];
  const timeLimits = {};
  const breakAfterLimits = {};
  const breakDurationLimits = {};
  const idleAfterLimits = {};
  const tabLimits = {};

  for (const row of rows) {
    const [
      siteInput,
      timeInput,
      breakAfterInput,
      breakDurationInput,
      idleAfterInput,
      tabInput,
    ] = row.querySelectorAll("input");
    const siteRaw = siteInput.value.trim();
    const key = normalizeTrackedEntry(siteRaw);
    if (!siteRaw || !key) {
      setStatus("Please enter a valid site.", "error");
      return;
    }

    trackedSites.push(siteRaw);
    const timeLimit = parseLimit(timeInput.value);
    if (timeLimit != null) {
      timeLimits[key] = timeLimit;
    }
    const breakAfter = parseLimit(breakAfterInput.value);
    if (breakAfter != null) {
      breakAfterLimits[key] = breakAfter;
    }
    const breakDuration = parseLimit(breakDurationInput.value);
    if (breakDuration != null) {
      breakDurationLimits[key] = breakDuration;
    }
    const idleAfter = parseIdleLimit(idleAfterInput.value);
    if (idleAfter != null) {
      idleAfterLimits[key] = idleAfter;
    }
    const tabLimit = parseTabLimit(tabInput.value);
    if (tabLimit != null) {
      tabLimits[key] = tabLimit;
    }
  }

  await chrome.runtime.sendMessage({
    type: "SET_SETTINGS",
    trackedSites,
    timeLimits,
    breakAfterLimits,
    breakDurationLimits,
    idleAfterLimits,
    tabLimits,
    overlayEnabled: cachedSettings?.overlayEnabled,
    overlayScale: cachedSettings?.overlayScale,
    overlayBackgroundColor: cachedSettings?.overlayBackgroundColor,
    overlayTextColor: cachedSettings?.overlayTextColor,
    overlayBackgroundOpacity: cachedSettings?.overlayBackgroundOpacity,
    menuTextScale: cachedSettings?.menuTextScale,
  });

  setStatus("Saved.");
  setTimeout(() => {
    setStatus("");
  }, 2000);
  await loadOptions();
}

addButton.addEventListener("click", () => {
  limitsList.appendChild(createRow());
});

document.getElementById("options-form").addEventListener("submit", saveOptions);

loadOptions();
