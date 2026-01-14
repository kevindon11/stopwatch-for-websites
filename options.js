const limitsList = document.getElementById("limits-list");
const addButton = document.getElementById("add-site");
const status = document.getElementById("status");
const resetButton = document.getElementById("reset-today");
const resetCountdown = document.getElementById("reset-countdown");

let cachedSettings = null;
let cachedLocks = {};
let resetTimerId = null;
let resetAvailableAt = null;
let lockRefreshId = null;

const RESET_DELAY_MS = 2 * 60 * 1000;
const LOCK_REFRESH_MS = 1000;

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

  const idleLimitInput = document.createElement("input");
  idleLimitInput.type = "number";
  idleLimitInput.min = "1";
  idleLimitInput.step = "1";
  idleLimitInput.placeholder = "—";
  idleLimitInput.value = entry.idleLimit || "";

  const waitLimitInput = document.createElement("input");
  waitLimitInput.type = "number";
  waitLimitInput.min = "1";
  waitLimitInput.step = "1";
  waitLimitInput.placeholder = "—";
  waitLimitInput.value = entry.waitLimit || "";

  const actionCell = document.createElement("div");
  actionCell.className = "action-cell";

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.textContent = "Remove";
  removeButton.addEventListener("click", () => {
    row.remove();
  });

  const lockStatus = document.createElement("span");
  lockStatus.className = "lock-status";
  lockStatus.hidden = true;

  actionCell.appendChild(removeButton);
  actionCell.appendChild(lockStatus);

  row.appendChild(siteInput);
  row.appendChild(timeInput);
  row.appendChild(breakAfterInput);
  row.appendChild(breakDurationInput);
  row.appendChild(idleLimitInput);
  row.appendChild(waitLimitInput);
  row.appendChild(tabInput);
  row.appendChild(actionCell);
  return row;
}

function setStatus(message, tone = "ok") {
  status.textContent = message;
  status.style.color = tone === "error" ? "#b91c1c" : "#0f766e";
}

function formatRemaining(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds}s`;
  if (seconds === 0) return `${minutes}m`;
  return `${minutes}m ${seconds}s`;
}

function formatWaitMinutes(value) {
  if (!Number.isFinite(value)) return "";
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(1).replace(/\.0$/, "");
}

function applyLockState(row, remainingMs, waitMinutes) {
  const inputs = row.querySelectorAll("input");
  const removeButton = row.querySelector("button");
  const lockStatus = row.querySelector(".lock-status");
  const locked = remainingMs > 0;
  const waitMinutesText = formatWaitMinutes(waitMinutes);
  inputs.forEach((input) => {
    input.disabled = locked;
    if (locked) {
      input.title = `Locked for ${formatRemaining(remainingMs)}`;
    } else {
      input.removeAttribute("title");
    }
  });
  if (removeButton) {
    removeButton.disabled = locked;
    removeButton.textContent = locked ? "Locked" : "Remove";
  }
  if (lockStatus) {
    lockStatus.hidden = !locked;
    lockStatus.textContent = locked
      ? `Locked for ${
          waitMinutesText ? `${waitMinutesText} min` : formatRemaining(remainingMs)
        }`
      : "";
  }
}

function formatCountdown(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function updateResetCountdown() {
  if (!resetButton || !resetCountdown || !resetAvailableAt) return;
  const remaining = resetAvailableAt - Date.now();
  if (remaining <= 0) {
    resetButton.disabled = false;
    resetCountdown.textContent = "Ready";
    if (resetTimerId) {
      clearInterval(resetTimerId);
      resetTimerId = null;
    }
    return;
  }
  resetButton.disabled = true;
  resetCountdown.textContent = `Available in ${formatCountdown(remaining)}`;
}

function startResetCountdown() {
  if (!resetButton || !resetCountdown) return;
  resetAvailableAt = Date.now() + RESET_DELAY_MS;
  updateResetCountdown();
  if (resetTimerId) clearInterval(resetTimerId);
  resetTimerId = setInterval(updateResetCountdown, 1000);
}

async function handleResetToday() {
  if (!resetButton || !resetCountdown) return;
  resetButton.disabled = true;
  resetCountdown.textContent = "Resetting…";
  await chrome.runtime.sendMessage({ type: "RESET_TODAY" });
  startResetCountdown();
  await loadOptions();
}

async function loadOptions() {
  const settingsRes = await chrome.runtime.sendMessage({ type: "GET_SETTINGS" });
  const locksRes = await chrome.runtime.sendMessage({ type: "GET_EDIT_LOCKS" });
  cachedSettings = settingsRes?.settings || {};
  cachedLocks = locksRes?.locks || {};
  const trackedSites = cachedSettings.trackedSites || [];
  const timeLimits = cachedSettings.timeLimits || {};
  const breakAfterLimits = cachedSettings.breakAfterLimits || {};
  const breakDurationLimits = cachedSettings.breakDurationLimits || {};
  const idleLimits = cachedSettings.idleLimits || {};
  const waitLimits = cachedSettings.waitLimits || {};
  const tabLimits = cachedSettings.tabLimits || {};
  limitsList.innerHTML = "";

  if (!trackedSites.length) {
    limitsList.appendChild(createRow());
    refreshLockStates();
    return;
  }

  trackedSites.forEach((site) => {
    const key = normalizeTrackedEntry(site);
    const waitLimit = waitLimits[key] ?? "";
    const row = createRow({
      site,
      timeLimit: timeLimits[key] ?? "",
      breakAfter: breakAfterLimits[key] ?? "",
      breakDuration: breakDurationLimits[key] ?? "",
      idleLimit: idleLimits[key] ?? "",
      waitLimit,
      tabLimit: tabLimits[key] ?? "",
    });
    row.dataset.key = key;
    row.dataset.waitLimit = waitLimit;
    const lockedUntil = Number.parseInt(cachedLocks[key], 10);
    if (Number.isFinite(lockedUntil)) {
      const remaining = lockedUntil - Date.now();
      applyLockState(row, remaining, Number.parseFloat(waitLimit));
    }
    limitsList.appendChild(row);
  });
  refreshLockStates();
}

function refreshLockStates() {
  const rows = Array.from(limitsList.querySelectorAll(".limit-row"));
  rows.forEach((row) => {
    const key = row.dataset.key;
    if (!key) return;
    const lockedUntil = Number.parseInt(cachedLocks[key], 10);
    const remaining = Number.isFinite(lockedUntil)
      ? lockedUntil - Date.now()
      : 0;
    const waitLimit = Number.parseFloat(row.dataset.waitLimit);
    applyLockState(row, remaining, waitLimit);
  });
  if (lockRefreshId) {
    clearInterval(lockRefreshId);
    lockRefreshId = null;
  }
  const hasActiveLocks = rows.some((row) => {
    const key = row.dataset.key;
    if (!key) return false;
    const lockedUntil = Number.parseInt(cachedLocks[key], 10);
    return Number.isFinite(lockedUntil) && lockedUntil > Date.now();
  });
  if (hasActiveLocks) {
    lockRefreshId = setInterval(refreshLockStates, LOCK_REFRESH_MS);
  }
}

async function saveOptions(event) {
  event.preventDefault();
  const rows = Array.from(limitsList.querySelectorAll(".limit-row"));
  const trackedSites = [];
  const timeLimits = {};
  const breakAfterLimits = {};
  const breakDurationLimits = {};
  const idleLimits = {};
  const waitLimits = {};
  const tabLimits = {};

  for (const row of rows) {
    const [
      siteInput,
      timeInput,
      breakAfterInput,
      breakDurationInput,
      idleLimitInput,
      waitLimitInput,
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
    const idleLimit = parseLimit(idleLimitInput.value);
    if (idleLimit != null) {
      idleLimits[key] = idleLimit;
    }
    const waitLimit = parseLimit(waitLimitInput.value);
    if (waitLimit != null) {
      waitLimits[key] = waitLimit;
    }
    const tabLimit = parseTabLimit(tabInput.value);
    if (tabLimit != null) {
      tabLimits[key] = tabLimit;
    }
  }

  const response = await chrome.runtime.sendMessage({
    type: "SET_SETTINGS",
    trackedSites,
    timeLimits,
    breakAfterLimits,
    breakDurationLimits,
    idleLimits,
    waitLimits,
    tabLimits,
    overlayEnabled: cachedSettings?.overlayEnabled,
    overlayScale: cachedSettings?.overlayScale,
    overlayBackgroundColor: cachedSettings?.overlayBackgroundColor,
    overlayTextColor: cachedSettings?.overlayTextColor,
    overlayBackgroundOpacity: cachedSettings?.overlayBackgroundOpacity,
    menuTextScale: cachedSettings?.menuTextScale,
  });

  if (!response?.ok) {
    setStatus(response?.error || "Unable to save settings.", "error");
    return;
  }

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

if (resetButton) {
  resetButton.addEventListener("click", handleResetToday);
  startResetCountdown();
}
